#!/usr/bin/env node
/**
 * `npm run doctor` — reads the project the way a demo morning does, and says what to fix.
 *
 * Everything VeriPack needs to behave honestly is either a file, a number in a file, or an
 * environment variable, and all three are easy to get wrong on a borrowed laptop or after a rebuilt
 * sandbox. This checks the ones that silently degrade the app (a missing key, a stripped demo
 * disclosure, an un-vendored engine) and prints one line each, with the command that fixes it.
 *
 * It changes nothing and reads nothing outside this project. Exit code is 1 only for `fail` lines.
 */
import { readFile, readdir } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'

import { ROOT, OUT_DIR, engineStatus } from './vendor-ocr.mjs'
import { parseEnvValue } from './lib/envfile.mjs'
import { keyVerdict, logoVerdict } from './lib/verdicts.mjs'

const read = (rel) => readFile(path.join(ROOT, rel), 'utf8').catch(() => null)
const readJson = async (rel) => JSON.parse(await read(rel) ?? 'null')
const mb = (bytes) => `${(bytes / 1000 / 1000).toFixed(1)} MB`

const results = []
/** @param {'ok'|'warn'|'fail'} level */
function check(level, area, message, fix) {
  results.push({ level, area, message, fix })
}

/* ---------------------------------------------------------------- runtime ---- */

const nodeMajor = Number(process.versions.node.split('.')[0])
const nodeVersion = `node ${process.versions.node}`
if (nodeMajor >= 24) check('ok', 'Runtime', `${nodeVersion} — matches the stack note in the problem statement`)
else if (nodeMajor >= 20) {
  check('warn', 'Runtime', `${nodeVersion} works, but the spec pins Node 24 — if a judge clones this repo, use 24`, 'nvm install 24')
} else {
  check('fail', 'Runtime', `${nodeVersion} is too old for Vite 8 / tesseract.js 5`, 'install Node 24 (nvm install 24)')
}

// Read node_modules/<name>/package.json directly rather than require()ing it: some packages do not
// re-export ./package.json through their `exports` map, and require() would then report a dependency
// as missing while the build works fine — a false alarm is worse than no check at all.
const deps = ['react', 'react-dom', 'axios', 'tesseract.js', 'vite', '@vitejs/plugin-react']
const missing = []
const found = []
for (const name of deps) {
  const pkg = await readJson(path.join('node_modules', name, 'package.json'))
  if (pkg?.version) found.push(`${name}@${pkg.version}`)
  else missing.push(name)
}
if (missing.length) {
  check('fail', 'Dependencies', `not installed: ${missing.join(', ')} — the app cannot build or run`, 'npm ci')
} else {
  check('ok', 'Dependencies', found.join(' '))
}

/* ------------------------------------------------------- Gemini access ---- */

const envText = await read('.env')
const key = process.env.VITE_GEMINI_API_KEY?.trim() || parseEnvValue(envText, 'VITE_GEMINI_API_KEY')
// One line either way, and the wording comes from the same tested function the unit tests assert on.
const keyLine = keyVerdict({ key, hasEnvFile: envText !== null })
check(keyLine.level, 'API key', keyLine.message, keyLine.fix)

const gitignore = (await read('.gitignore')) ?? ''
if (!/(^|\n)\/?\.env(\s|$)/.test(gitignore)) {
  check('fail', 'API key', '.env is NOT git-ignored — a real key could be committed', 'add .env to .gitignore')
} else {
  check('ok', 'API key', '.env is git-ignored, so the key stays out of the repository')
}

// The key must live in .env / Vercel only. A literal here would ship to every visitor's browser bundle.
const srcFiles = (await readdir(path.join(ROOT, 'src'), { recursive: true }))
  .filter((f) => typeof f === 'string' && /\.(js|jsx|css|json)$/.test(f))
  .map((f) => path.join(ROOT, 'src', f))
const keyLiteral = /AIza[0-9A-Za-z_-]{20,}/
let hardcodedIn = []
for (const file of srcFiles) {
  const text = await readFile(file, 'utf8').catch(() => '')
  if (keyLiteral.test(text)) hardcodedIn.push(path.relative(ROOT, file))
}
if (hardcodedIn.length) {
  check('fail', 'API key', `key literal found in ${hardcodedIn.join(', ')} — it must come from import.meta.env only`, 'delete the literal, keep it in .env')
} else {
  check('ok', 'API key', 'no key literal anywhere in src/ (read from import.meta.env at runtime)')
}

const geminiSrc = (await read('src/lib/gemini.js')) ?? ''
const model = parseEnvValue(envText, 'VITE_GEMINI_MODEL') || /DEFAULT_MODEL\s*=\s*'([^']+)'/.exec(geminiSrc)?.[1] || '?'
check(
  'ok',
  'Model',
  `using ${model} — model codes change often, so re-check https://ai.google.dev/gemini-api/docs/models before a demo (override with VITE_GEMINI_MODEL)`,
)

/* ------------------------------------------------------------- OCR assets ---- */

const langModel = path.join(OUT_DIR, 'eng.traineddata.gz')
const langSize = await readFile(langModel).then((b) => b.length, () => 0)
if (langSize > 2_500_000) {
  check('ok', 'OCR model', `eng.traineddata.gz served from our own origin (${mb(langSize)} gzipped)`)
} else if (langSize > 0) {
  check('fail', 'OCR model', `eng.traineddata.gz is only ${langSize} bytes — truncated download`, 'git checkout -- public/tesseract/eng.traineddata.gz')
} else {
  check('warn', 'OCR model', 'public/tesseract/eng.traineddata.gz missing — first scan depends on a third-party CDN', 'git checkout -- public/tesseract/  (or npm ci + npm run vendor:ocr)')
}

const engine = await engineStatus()
if (engine.state === 'complete') {
  check('ok', 'OCR engine', `self-hosted — ${engine.detail}`)
} else {
  check(
    'warn',
    'OCR engine',
    `${engine.state}: ${engine.detail}`,
    'npm run vendor:ocr   (makes a scan work with no third-party host at all)',
  )
}

/* --------------------------------------------------------- data integrity ---- */

const rules = (await readJson('src/data/rules.json')) ?? []
const badRules = rules.filter((r) => !r.id || !r.name || !r.section || !r.description)
if (rules.length === 7 && badRules.length === 0) {
  check('ok', 'Rule set', '7 LM Rules 2011 checks, each with name, citation and verbatim text')
} else {
  check(
    'fail',
    'Rule set',
    `expected 7 complete rules, found ${rules.length} with ${badRules.length} incomplete — Module 2 will look wrong`,
    'restore src/data/rules.json (the 7 rules are fixed by the problem statement)',
  )
}

for (const [file, label] of [
  ['src/data/fssaiSampleData.json', 'FSSAI'],
  ['src/data/gs1SampleData.json', 'GS1'],
  ['src/data/bisSampleData.json', 'BIS'],
]) {
  const text = await read(file)
  if (text === null) {
    check('fail', 'Demo data', `${file} missing — that credential lookup cannot answer at all`, 'restore the sample dataset')
    continue
  }
  const readme = JSON.parse(text)?._readme ?? ''
  if (/DEMO DATASET/i.test(readme)) check('ok', 'Demo data', `${label} sample file carries its "DEMO DATASET" disclosure`)
  else check('fail', 'Demo data', `${label} sample file lost its DEMO DATASET disclosure — that would present a fake registry as real`, `restore _readme in ${file}`)
}

const stats = await readJson('src/data/approvedStats.json')
const statsList = Array.isArray(stats) ? stats : (stats?.stats ?? [])
if (statsList.length === 5 && statsList.every((s) => s.source)) {
  check('ok', 'Statistics', 'exactly the 5 approved figures, each with a visible source')
} else {
  check('fail', 'Statistics', `${statsList.length} figures / ${statsList.filter((s) => !s.source).length} without a source — the brief allows 5, each sourced`, 'restore src/data/approvedStats.json')
}

/* ------------------------------------------------------------ branding ---- */

const logoLine = logoVerdict({ bytes: await readFile(path.join(ROOT, 'public', 'logo.svg')).catch(() => null) })
check(logoLine.level, 'Branding', logoLine.message, logoLine.fix)

/* ------------------------------------------------------------ build out ---- */

const distIndex = await read('dist/index.html')
if (distIndex === null) {
  check('ok', 'Build', 'no dist/ yet (normal while developing) — `npm run build` before deploying')
} else {
  check('ok', 'Build', 'dist/index.html exists — `npm run preview` serves it the way Vercel would')
}

const port = Number(process.env.PORT || 5173)
const portBusy = await new Promise((resolve) => {
  const probe = net.connect({ host: '127.0.0.1', port })
  probe.once('connect', () => {
    probe.destroy()
    resolve(true)
  })
  probe.once('error', () => resolve(false))
})
check('ok', 'Dev server', portBusy ? `port ${port} is serving (npm run dev already running)` : `port ${port} is free — start it with npm run dev`)

/* --------------------------------------------------------------- report ---- */

const order = { fail: 0, warn: 1, ok: 2 }
results.sort((a, b) => order[a.level] - order[b.level] || a.area.localeCompare(b.area))
const icon = { ok: '[ ok ]', warn: '[warn]', fail: '[FAIL]' }
const width = Math.max(...results.map((r) => r.area.length))
for (const r of results) {
  console.log(`${icon[r.level]} ${r.area.padEnd(width)}  ${r.message}`)
  if (r.fix) console.log(`         ${' '.repeat(width)}  → ${r.fix}`)
}

const fails = results.filter((r) => r.level === 'fail').length
const warns = results.filter((r) => r.level === 'warn').length
console.log(`\n${results.length} checks: ${fails} blocking, ${warns} to look at, ${results.length - fails - warns} fine.`)
if (fails) console.log('Fix the [FAIL] lines before a demo — the app would misreport otherwise.')
else if (warns) console.log('VeriPack will run. The [warn] lines are things it reports honestly instead of faking.')
process.exit(fails ? 1 : 0)
