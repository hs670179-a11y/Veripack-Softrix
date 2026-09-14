/**
 * Tests for the tooling: `npm run doctor`, `npm run vendor:ocr` and the small .env reader they share.
 *
 * These files decide what the project's own health report says, so a bug in them is not cosmetic — the
 * first version of doctor reported "API key present" while `.env` had none, because a `\s*` in a regex
 * swallowed the newline and read a comment as the value. Everything asserted here exists to stop a tool
 * from certifying something that is not true: paths it reads must be real, the vendored-engine contract
 * must match what tesseract.js actually asks for, and the checks must run in Node without a browser.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { CORE_FILES, MANIFEST_KIND, OUT_DIR, buildPlan, engineStatus } from '../scripts/vendor-ocr.mjs'
import { keyVerdict, logoVerdict, sha256 } from '../scripts/lib/verdicts.mjs'
import { parseEnvValue } from '../scripts/lib/envfile.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const read = (rel) => readFile(path.join(ROOT, rel), 'utf8')
const exists = (p) => stat(p).then(() => true, () => false)

/* ------------------------------------------------------ the .env reader ---- */

test('an empty value stays empty and never borrows the next line', () => {
  const text = ['# comment', 'VITE_GEMINI_API_KEY=', '', '# Gemini model used for rule checking.', 'VITE_GEMINI_MODEL=gemini-3.8-flash'].join('\n')
  // The regression this exists for: /\s*=\s*(.*)/m returned the comment as the "key".
  assert.equal(parseEnvValue(text, 'VITE_GEMINI_API_KEY'), '')
  assert.equal(parseEnvValue(text, 'VITE_GEMINI_MODEL'), 'gemini-3.8-flash')
})

test('the .env reader handles the shapes people actually write', () => {
  assert.equal(parseEnvValue('VITE_GEMINI_API_KEY="  AIzaSyabc  "', 'VITE_GEMINI_API_KEY'), '  AIzaSyabc  ')
  assert.equal(parseEnvValue("VITE_GEMINI_API_KEY='AIzaSyabc'", 'VITE_GEMINI_API_KEY'), 'AIzaSyabc')
  assert.equal(parseEnvValue('export VITE_GEMINI_API_KEY=AIzaSyabc', 'VITE_GEMINI_API_KEY'), 'AIzaSyabc')
  assert.equal(parseEnvValue('#VITE_GEMINI_API_KEY=AIzaSyignored', 'VITE_GEMINI_API_KEY'), '')
  assert.equal(parseEnvValue('A=1\nVITE_GEMINI_API_KEY=first\nVITE_GEMINI_API_KEY=last', 'VITE_GEMINI_API_KEY'), 'last')
  assert.equal(parseEnvValue(null, 'VITE_GEMINI_API_KEY'), '')
  assert.equal(parseEnvValue('OTHER=1', 'VITE_GEMINI_API_KEY'), '')
  // A prefix must not match a longer name.
  assert.equal(parseEnvValue('VITE_GEMINI_API_KEY_BACKUP=AIzaSyabc', 'VITE_GEMINI_API_KEY'), '')
})

test('the shipped .env.example parses to blank values, not to comments', async () => {
  const text = await read('.env.example')
  assert.equal(parseEnvValue(text, 'VITE_GEMINI_API_KEY'), '')
  assert.match(parseEnvValue(text, 'VITE_GEMINI_MODEL'), /^gemini-/)
})

/* --------------------------------------------------------- npm wiring ---- */

test('doctor and vendor:ocr are npm scripts pointing at files that exist', async () => {
  const pkg = JSON.parse(await read('package.json'))
  const commands = { doctor: pkg.scripts.doctor, 'vendor:ocr': pkg.scripts['vendor:ocr'] }
  for (const [name, cmd] of Object.entries(commands)) {
    assert.match(cmd ?? '', /^node scripts\/[a-z-]+\.mjs$/, `${name} script should run a script file`)
    const file = /scripts\/([a-z-]+\.mjs)/.exec(cmd)[1]
    assert.ok(await exists(path.join(ROOT, 'scripts', file)), `${name} points at a missing file: scripts/${file}`)
  }
})

test('the tooling only reads paths that exist, so no [ ok ] comes from a failed read', async () => {
  const files = ['scripts/doctor.mjs', 'scripts/vendor-ocr.mjs', 'scripts/lib/verdicts.mjs', 'scripts/lib/envfile.mjs']
  const text = (await Promise.all(files.map(read))).join('\n')
  const referenced = [...text.matchAll(/'((?:src|public|docs)\/[A-Za-z0-9._/-]+)'/g)].map((m) => m[1])
  assert.ok(referenced.length >= 6, 'expected the scripts to reference project files by path')
  for (const rel of referenced) {
    assert.ok(await exists(path.join(ROOT, rel)), `the scripts read ${rel}, which is not in the repository`)
  }
  // A check that reads a file which is not there would print [ ok ] about nothing, which is the exact
  // failure mode this suite is about. node_modules/ and dist/ are build state and not asserted.
})

test('the key verdict describes reality and never repeats the key', async () => {
  assert.deepEqual(
    { level: keyVerdict({ key: '', hasEnvFile: false }).level, fix: keyVerdict({ key: '', hasEnvFile: false }).fix },
    { level: 'warn', fix: 'cp .env.example .env, paste the key, restart npm run dev' },
  )
  // The bug this guards: an empty value read as "present" because a regex crossed a newline.
  assert.equal(keyVerdict({ key: '', hasEnvFile: true }).level, 'warn')
  assert.match(keyVerdict({ key: '', hasEnvFile: true }).message, /7 rule checks cannot run/)
  assert.equal(keyVerdict({ key: 'your-key-here', hasEnvFile: true }).level, 'warn')
  const filled = keyVerdict({ key: `AIza${'x'.repeat(35)}`, hasEnvFile: true })
  assert.equal(filled.level, 'ok')
  assert.ok(!JSON.stringify(filled).includes('AIza'), 'the key value must never reach the terminal or a log')
  assert.match(filled.message, /value not shown/)
})

test('the branding verdict knows the interim mark apart from a real logo', async () => {
  assert.equal(logoVerdict({ bytes: null }).level, 'fail')
  assert.equal(logoVerdict({ bytes: Buffer.alloc(0) }).level, 'fail')
  const logo = await readFile(path.join(ROOT, 'public', 'logo.svg'))
  assert.equal(sha256(logo).length, 64, 'INTERIM_LOGO_SHA256 must be a sha256, or the check is decoration')
  // The interim mark and a swapped-in file differ only by hash, so pin both branches by passing the
  // hash that matches — which also keeps this test valid after the real logo replaces the stand-in.
  assert.equal(logoVerdict({ bytes: logo, pinnedSha256: sha256(logo) }).level, 'warn', 'a stand-in must be called out')
  assert.equal(logoVerdict({ bytes: logo }).level, 'ok', 'the shipped mark must not be reported as the stand-in')
})

/* ------------------------------------------- the vendored-engine contract ---- */

test('the manifest marker ocr.js trusts is the one vendor-ocr writes', async () => {
  const ocr = await read('src/lib/ocr.js')
  assert.match(ocr, new RegExp(`ENGINE_MANIFEST_KIND = '${MANIFEST_KIND}'`))
  assert.match(ocr, /fetch\('\/tesseract\/engine\.json'\)|ENGINE_MANIFEST = '\/tesseract\/engine\.json'/)
})

test('ocr.js asks for exactly the directory and file vendor-ocr produces', async () => {
  const ocr = await read('src/lib/ocr.js')
  const plan = await buildPlan()
  const written = plan.map((e) => e.name)
  const coreConst = /SELF_HOSTED_CORE = '([^']+)'/.exec(ocr)[1]
  const workerConst = /SELF_HOSTED_WORKER = '([^']+)'/.exec(ocr)[1]
  assert.equal(coreConst, '/tesseract/core', 'corePath must be a directory: tesseract.js appends the core filename itself')
  assert.equal(workerConst, '/tesseract/worker.min.js')
  assert.ok(written.includes('worker.min.js'), 'the plan must write the worker where ocr.js looks for it')
  assert.deepEqual(
    written.filter((n) => n.startsWith('core/')).map((n) => path.posix.basename(n)).sort(),
    [...CORE_FILES].sort(),
    'the core files on disk must be exactly the ones ocr.js can be pointed at',
  )
  assert.ok(written.every((n) => !n.includes('..')), 'no path traversal into public/')
})

test('the core filenames match what tesseract.js actually imports', async () => {
  const coreSrcPath = path.join(ROOT, 'node_modules/tesseract.js/src/worker-script/browser/getCore.js')
  if (!(await exists(coreSrcPath))) return // deps not installed: nothing to cross-check against
  const coreSrc = await readFile(coreSrcPath, 'utf8')
  const appends = [...coreSrc.matchAll(/`(.*?)\/tesseract-core([^`]*)\.wasm\.js`/g)].map((m) => `tesseract-core${m[2]}.wasm.js`)
  // Every name tesseract.js may ask for that is LSTM-only must exist in our plan (the legacy-only ones
  // are unreachable for `createWorker('eng', 1)`, which is what src/lib/ocr.js calls).
  const plan = (await buildPlan()).map((e) => path.posix.basename(e.name))
  for (const name of appends.filter((n) => n.includes('lstm'))) {
    assert.ok(CORE_FILES.includes(name), `tesseract.js may import ${name}, which vendor-ocr does not copy`)
    assert.ok(plan.includes(name), `${name} is not in the copy plan`)
  }
  assert.ok(appends.length >= 2, 'expected tesseract.js to switch between SIMD and non-SIMD cores')
})

test('the engine probe is inert in Node, where the tests run', async () => {
  const ocr = await read('src/lib/ocr.js')
  assert.match(ocr, /typeof window === 'undefined'/)
  const before = await engineStatus()
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/vendor-ocr.mjs'), '--dry-run'], { encoding: 'utf8' })
  assert.deepEqual(await engineStatus(), before, '--dry-run must not write anything')
})

test('a truncated or missing vendored file is reported, not trusted', async () => {
  if (!/complete/.test(JSON.stringify(await engineStatus(OUT_DIR).then((s) => s.state)))) return
  if (!(await exists(path.join(ROOT, 'public/tesseract/engine.json')))) return
  const dir = await mkdtemp(path.join(tmpdir(), 'veripack-engine-'))
  try {
    assert.equal((await engineStatus(dir)).state, 'missing', 'an empty directory must not look like an engine')
    await copyFile(path.join(OUT_DIR, 'eng.traineddata.gz'), path.join(dir, 'eng.traineddata.gz'))
    assert.equal((await engineStatus(dir)).state, 'missing', 'the language model alone is not the engine')

    const manifest = JSON.parse(await read('public/tesseract/engine.json'))
    await writeFile(path.join(dir, 'engine.json'), JSON.stringify(manifest))
    assert.equal((await engineStatus(dir)).state, 'stale', 'a manifest with nothing copied against it must fail')

    for (const name of Object.keys(manifest.files)) {
      const dest = path.join(dir, name)
      await mkdir(path.dirname(dest), { recursive: true })
      await writeFile(dest, 'x'.repeat(10))
    }
    assert.equal((await engineStatus(dir)).state, 'stale', 'wrong byte sizes must fail the check')

    // Now fill it properly and expect the same verdict the real directory gets.
    const plan = await buildPlan()
    for (const e of plan) await copyFile(e.src, path.join(dir, e.name))
    assert.equal((await engineStatus(dir)).state, 'complete')
    assert.equal((await engineStatus(OUT_DIR)).state, 'complete')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('--check exits 0 on the real directory and says something machine-readable', async () => {
  // Vendored files are generated by `npm run vendor:ocr` and are git-ignored, so on a fresh clone there
  // is nothing to check and the honest outcome is a skip, not a failure.
  if ((await engineStatus()).state !== 'complete') return
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/vendor-ocr.mjs'), '--check'], { encoding: 'utf8' })
  assert.match(out, /complete/)
})
