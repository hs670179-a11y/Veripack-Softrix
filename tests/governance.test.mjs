import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

/**
 * Governance tests — the "non-negotiable accuracy & governance requirements" of the build spec,
 * machine-checked so they cannot rot in a later edit. Each test names the rule it enforces.
 *
 * These are deliberately wording-based checks (this is a hackathon MVP, not a legal parser): they
 * catch a future contributor who re-badges the authenticity module as a product-screening tool,
 * points the app at an analytics endpoint, or hardcodes a key.
 */
const ROOT = new URL('..', import.meta.url).pathname

function filesIn(dir, filter) {
  const out = []
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry)
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...filesIn(rel, filter))
    else if (filter(rel, entry)) out.push(rel)
  }
  return out
}

/** Everything the app actually ships: code + styles + data. */
const SRC_FILES = filesIn('src', (_rel, name) => /\.(jsx?|css|json)$/.test(name))
/** App *copy* only — UI strings and prompts, no data files, no styles. */
const COPY_FILES = SRC_FILES.filter((f) => /\.(jsx?)$/.test(f) && !f.includes(`${process.platform === 'win32' ? '\\' : '/'}data`))

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
/** Paths from filesIn are already relative to the repo root; normalise separators only. */
const rel = (f) => f.split(/[\\/]/).join('/')
const isSrcPath = (f, dir) => rel(f).startsWith(`src/${dir}/`)
const linesOf = (f) => read(f).split('\n')

/* ---------- spec rule 3: never claim fake / counterfeit detection ---------- */

const CLAIM = /\b(?:detects?|detecting|identifies|identifying|screens?|screening|spots?|catches|verifies?)\s+(?:that\s+)?(?:a\s+|the\s+)?(?:fake|counterfeit|knock-?off|duplicate)\w*/gi
const DISALLOWED_ANYWHERE = /\b(fake|counterfeit)\s*(detector|detection|checker|check|scanner|finding)\b|\b(is|was|were)\s+(this|the|it)\s+(product|pack|item)\s+(fake|counterfeit)\b/gi
const DISCLAIMER = /\bnot\b|\bnever\b|out of scope|different capabilit|unimplemented|नहीं/i

test('no code comment, prompt or UI string claims that this app detects fake products', () => {
  const offenders = []
  for (const f of SRC_FILES) {
    linesOf(f).forEach((line, i) => {
      if (DISALLOWED_ANYWHERE.test(line)) offenders.push(`${rel(f)}:${i + 1}: ${line.trim().slice(0, 120)}`)
      DISALLOWED_ANYWHERE.lastIndex = 0
      CLAIM.lastIndex = 0
      if (CLAIM.test(line) && !DISCLAIMER.test(line)) offenders.push(`${rel(f)}:${i + 1}: ${line.trim().slice(0, 120)}`)
      CLAIM.lastIndex = 0
    })
  }
  assert.deepEqual(offenders, [], 'mention of fake/counterfeit must sit in an explicit disclaimer')
})

test('UI copy that mentions fake or counterfeit products negates it in the same line', () => {
  const offenders = []
  for (const f of COPY_FILES) {
    linesOf(f).forEach((line, i) => {
      if (/\b(fak|counterfeit|knock-?off)\w*/i.test(line) && !DISCLAIMER.test(line)) {
        offenders.push(`${rel(f)}:${i + 1}: ${line.trim().slice(0, 120)}`)
      }
    })
  }
  assert.deepEqual(offenders, [], 'UI copy must not present the app as a fake-product tool')
})

test('the authenticity module calls itself credential verification', () => {
  assert.match(read('src/lib/authenticity.js'), /Authenticity & Quality Assurance \(credential verification\)/)
  assert.match(read('src/i18n/strings.js'), /Credential verification of what the label declares/)
  assert.match(read('src/i18n/strings.js'), /प्रमाण-जांच/)
})

/* ---------- spec rule 4: disclose the registry shortcut in the UI ---------- */

test('demo-dataset disclosure is rendered, not just documented', () => {
  assert.match(read('src/components/CheckRow.jsx'), /demoDisclosure/, 'every demo-sourced row carries its badge')
  assert.match(read('src/components/ReportSection.jsx'), /demoDisclosureLong/, 'the authenticity section carries the full note')
  assert.match(read('src/App.jsx'), /t\('footerLine2'\)/, 'the footer repeats it')
  assert.match(read('src/i18n/strings.js'), /not live FSSAI \/ GS1 \/ BIS registries/)
})

test('soft and advisory checks are labelled as such', () => {
  const rows = read('src/lib/authenticity.js')
  assert.match(rows, /badge: 'soft'/)
  assert.match(rows, /badge: 'advisory'/)
  assert.match(read('src/i18n/strings.js'), /Soft check — approximate, not a legal finding/)
})

test('the sample datasets state that they are not verified live records', () => {
  for (const file of ['fssaiSampleData.json', 'gs1SampleData.json', 'bisSampleData.json']) {
    const note = JSON.parse(read(join('src/data', file)))._readme.join(' ')
    assert.match(note, /DEMO DATASET — NOT A LIVE REGISTRY FEED/, `${file} must disclose that it is demo data`)
    assert.match(note, /not verified|could not be (confirmed|verified)|illustrative/i, `${file} must not claim verification`)
  }
})

/* ---------- spec rule 2: verdicts grounded in retrieved evidence only ---------- */

test('the model is told to answer only from the supplied text', () => {
  const engine = read('src/lib/rulesEngine.js')
  const prompt = engine.slice(engine.indexOf('export function buildRulePrompt'), engine.indexOf('export function normalizeVerdict'))
  assert.match(prompt, /Use ONLY the text inside LABEL_TEXT/)
  assert.match(prompt, /Do not use general knowledge/)
  assert.match(prompt, /When in doubt, always choose "insufficient_evidence"/)
  assert.match(prompt, /LABEL_TEXT>>>/, 'the evidence set is delimited so it cannot be argued with')
})

test('a failed or absent check can never be reported as satisfied', () => {
  const engine = read('src/lib/rulesEngine.js')
  assert.match(engine, /err instanceof MissingKeyError \? 'check unavailable'/)
  assert.match(engine, /return 'unknown' \/\/ includes 'insufficient_evidence'/)
})

/* ---------- spec rule 5: nothing leaves the device except the LLM call ---------- */

test('exactly one module talks to the network, and it is the LLM client', () => {
  const axiosUsers = SRC_FILES.filter((f) => /from 'axios'/.test(read(f)))
  assert.deepEqual(axiosUsers.map(rel), ['src/lib/gemini.js'])
})

test('no analytics or tracking endpoints, and no unexpected hosts', () => {
  const banned = /googletagmanager|google-analytics|gtag\(|posthog|mixpanel|sentry|clarity\.ms|doubleclick|hotjar|fbq\(|plausible|umami/i
  for (const f of [...SRC_FILES, 'index.html']) {
    const body = read(f)
    assert.ok(!banned.test(body), `${f} references a tracking or analytics endpoint`)
    for (const m of body.matchAll(/https?:\/\/[a-z0-9.-]+/gi)) {
      assert.match(
        m[0].toLowerCase(),
        /^https?:\/\/(generativelanguage\.googleapis\.com|ai\.google\.dev|aistudio\.google\.com|tessdata\.projectnaptha\.com|cdn\.jsdelivr\.net|www\.gs1\.org|foscos\.fssai\.gov\.in)$/,
        `${f} points at an unexpected host`,
      )
    }
  }
})

test('nothing about the user scan is persisted', () => {
  // actual API calls, not the word "cache" inside a comment
  const storageUsers = SRC_FILES.filter((f) => /\b(localStorage|sessionStorage|indexedDB|caches)\s*[.([]/.test(read(f)))
  for (const f of storageUsers) {
    assert.equal(rel(f), 'src/i18n/LangProvider.jsx', 'only the UI language preference may be remembered')
    assert.match(read(f), /Only a language preference is remembered/)
  }
})

/* ---------- spec rule 6: key hygiene ---------- */

test('.env is git-ignored and holds no secret', () => {
  const ignore = read('.gitignore').split('\n').map((l) => l.trim())
  assert.ok(ignore.includes('.env'), '.gitignore must contain .env as its own line')
  assert.match(read('.env'), /^VITE_GEMINI_API_KEY=$/m, 'the shipped .env keeps the key blank')
  assert.match(read('.env.example'), /^VITE_GEMINI_API_KEY=$/m)
})

test('no API key literal appears anywhere in the app source', () => {
  const keyShape = /AIza[0-9A-Za-z_-]{20,}|["'][0-9a-f]{32,}["']/
  for (const f of [...SRC_FILES, 'index.html']) assert.ok(!keyShape.test(read(f)), `${rel(f)} looks like it contains a key`)
})

test('the key is read through import.meta.env in exactly one file', () => {
  const keyFiles = SRC_FILES.filter((f) => read(f).includes('VITE_GEMINI_API_KEY')).map(rel).sort()
  // gemini.js reads it; i18n/strings.js only names it in help copy for the user.
  assert.deepEqual(keyFiles, ['src/i18n/strings.js', 'src/lib/gemini.js'])
  const gemini = read('src/lib/gemini.js')
  assert.match(gemini, /const ENV = import\.meta\.env \?\? \{\}/)
  assert.match(gemini, /ENV\.VITE_GEMINI_API_KEY/)
  assert.doesNotMatch(read('src/i18n/strings.js'), /import\.meta|process\.env/, 'help copy must not read config')
  for (const f of SRC_FILES) {
    assert.doesNotMatch(read(f), /process\.env/, `${rel(f)} would leak the key into the bundle`)
    assert.doesNotMatch(read(f), /VITE_GEMINI_API_KEY\s*[:=]\s*\S/, `${rel(f)} looks like it assigns the key`)
  }
})

/* ---------- spec section 1 / 7: dependency and scope discipline ---------- */

test('dependencies are exactly the stack the spec allows', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['axios', 'react', 'react-dom', 'tesseract.js'])
  assert.deepEqual(
    Object.keys(pkg.devDependencies).sort(),
    ['@types/react', '@types/react-dom', '@vitejs/plugin-react', 'oxlint', 'vite'],
    'only the Vite scaffold dev tooling is allowed',
  )
})

test('only FSSAI, GS1 and BIS appear as registries, and the rule set is the 7 given rules', () => {
  assert.deepEqual(readdirSync(join(ROOT, 'src/data')).sort(), [
    'approvedStats.json',
    'bisSampleData.json',
    'fssaiSampleData.json',
    'gs1SampleData.json',
    'rules.json',
  ])
  assert.equal(JSON.parse(read('src/data/rules.json')).length, 7)
})

/* ---------- spec section 8: statistics ---------- */

const APPROVED_STATS = [
  '89% of urban Indian consumers have bought a counterfeit product at least once',
  '27% of consumers reported encountering counterfeit FMCG products',
  '1,13,745 first-offence Legal Metrology Act cases booked in 2018-19',
  '$7 billion lost annually to illicit/counterfeit trade',
  'India packaged food market: $95.45B (2020) → $137.25B (2026) → $238.83B (2034 projected)',
]

test('every statistic in the app is a pre-approved figure, verbatim, with its source', () => {
  const data = JSON.parse(read(join('src/data', 'approvedStats.json')))
  assert.deepEqual(
    data.stats.map((s) => s.figure),
    APPROVED_STATS,
    'figures must match Section 8 exactly — no rounding, no extras',
  )
  assert.ok(data.stats.every((s) => typeof s.source === 'string' && s.source.length > 8), 'each figure needs a visible source')
  assert.match(read('src/components/AboutSheet.jsx'), /\{s\.figure\}[\s\S]*\{s\.source\}/, 'source renders beside the figure')
})

test('no invented numbers appear in UI copy', () => {
  const numberInCopy = /(?:^|[^\d{])(\d{1,3}(?:,\d{3})+|\d{2,3}(?:\.\d+)?)\s?(?:%|billion|crore|lakh|cases)/i
  const offenders = []
  for (const f of COPY_FILES) {
    linesOf(f).forEach((line, i) => {
      if (numberInCopy.test(line) && !/NEAR_EXPIRY/.test(line)) offenders.push(`${rel(f)}:${i + 1}: ${line.trim().slice(0, 100)}`)
    })
  }
  assert.deepEqual(offenders, [], 'statistics outside the approved list may not appear')
})

/* ---------- module 1: OCR honesty ---------- */

test('unreadable photos are stopped, not passed through as valid', () => {
  const ocr = read('src/lib/ocr.js')
  assert.match(ocr, /status: 'failed'/)
  assert.match(ocr, /status: 'low-confidence'/)
  const app = read('src/App.jsx')
  assert.match(app, /setPhase\('ocr-failed'\)/, 'a failed read must not reach the checkers')
  assert.match(app, /checkAnyway/, 'a low-confidence read needs an explicit user decision')
})

/* ---------- module 4: combined report + export ---------- */

test('the report has both sections, counts, a legend and a print route', () => {
  const report = read('src/components/Report.jsx')
  assert.match(report, /kind="compliance"/)
  assert.match(report, /kind="authenticity"/)
  assert.match(report, /window\.print\(\)/)
  assert.match(read('src/components/ReportSection.jsx'), /countLabel/)
  assert.match(read('src/components/Report.jsx'), /legend/)
  assert.match(read('src/styles/app.css'), /@media print/)
})

/* ---------- deployment notes ---------- */

test('README carries the env-var and demo-data warnings the spec asks for', () => {
  const readme = read('README.md')
  assert.match(readme, /Vercel/, 'README must remind about Vercel environment variables')
  assert.match(readme, /VITE_GEMINI_API_KEY/)
  assert.match(readme, /[Dd]emo dataset/)
  assert.match(readme, /SIH26034/)
})
