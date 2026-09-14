#!/usr/bin/env node
/**
 * Copies the Tesseract WASM engine next to the language model so a scan needs no third-party host.
 *
 * Why a script instead of committing the files: the engine is ~7.9 MB, and the only thing it buys is
 * resilience. The English model (2.9 MB) is in git because without it nothing reads text at all; the
 * engine is generated on demand — run `npm run vendor:ocr` before a demo day, or before
 * `npm run build` for a self-contained `dist/`. src/lib/ocr.js notices the manifest and uses these
 * files automatically; when they are absent it falls back to the CDN defaults, exactly as before.
 *
 *   node scripts/vendor-ocr.mjs            copy / refresh
 *   node scripts/vendor-ocr.mjs --dry-run  show what would be copied
 *   node scripts/vendor-ocr.mjs --check    verify what is on disk matches the manifest
 */
import { createRequire } from 'node:module'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const require = createRequire(import.meta.url)
export const ROOT = path.resolve(import.meta.dirname, '..')
export const OUT_DIR = path.join(ROOT, 'public', 'tesseract')
export const MANIFEST = path.join(OUT_DIR, 'engine.json')

/**
 * Marker src/lib/ocr.js looks for before trusting the files in this directory.
 * Kept in sync with that file by tests/tooling.test.mjs.
 */
export const MANIFEST_KIND = 'veripack-ocr-engine'

/**
 * The two core bundles tesseract.js' browser worker asks for. It appends one of these names to
 * `corePath` depending on whether the browser reports SIMD support, so both must be present — an
 * older phone without SIMD otherwise gets a 404 on a machine that is otherwise fully offline.
 */
export const CORE_FILES = ['tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js']

const LANG_MODEL = 'eng.traineddata.gz'

function packageDir(name) {
  try {
    return path.dirname(require.resolve(`${name}/package.json`))
  } catch {
    throw new Error(`${name} is not installed. Run \`npm ci\` first.`)
  }
}

/** @returns {Promise<{name: string, src: string, bytes: number, note: string}[]>} */
export async function buildPlan() {
  const tsDir = packageDir('tesseract.js')
  const coreDir = packageDir('tesseract.js-core')
  const entries = [
    { name: 'worker.min.js', src: path.join(tsDir, 'dist', 'worker.min.js'), note: 'tesseract.js worker' },
    ...CORE_FILES.map((f) => ({
      name: `core/${f}`,
      src: path.join(coreDir, f),
      note: f.includes('simd') ? 'engine (SIMD-capable browsers)' : 'engine (browsers without SIMD)',
    })),
    // Apache-2.0 code we redistribute inside the served bundle, so ship the licence texts too. The
    // filename differs between the two packages, hence the candidate list; a missing one is not fatal.
    { name: 'LICENSE-tesseract.js.txt', dir: tsDir, candidates: ['LICENSE.md', 'LICENSE'], note: 'licence', optional: true },
    { name: 'LICENSE-tesseract.js-core.txt', dir: coreDir, candidates: ['LICENSE', 'LICENSE.md'], note: 'licence', optional: true },
  ]

  const plan = []
  for (const e of entries) {
    const src = e.src ?? (await firstExisting(e.dir, e.candidates))
    if (!src) {
      if (!e.optional) throw new Error(`tesseract.js does not contain the file needed for ${e.name}`)
      continue
    }
    plan.push({ name: e.name, src, note: e.note, bytes: (await stat(src)).size })
  }
  return plan
}

async function firstExisting(dir, names) {
  for (const name of names) {
    const candidate = path.join(dir, name)
    if (await stat(candidate).then((s) => s.size > 0, () => false)) return candidate
  }
  return null
}

export async function readManifest(outDir = OUT_DIR) {
  try {
    return JSON.parse(await readFile(path.join(outDir, 'engine.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Is the vendored engine complete? Shared by --check, scripts/doctor.mjs and the tests, so all three
 * agree on what "fine" means instead of each inventing its own definition.
 * @returns {Promise<{state: 'complete'|'missing'|'stale', files: string[], detail: string}>}
 */
export async function engineStatus(outDir = OUT_DIR) {
  const manifest = await readManifest(outDir)
  if (!manifest || manifest.kind !== MANIFEST_KIND) {
    return { state: 'missing', files: [], detail: 'not vendored — the OCR engine loads from the CDN tesseract.js uses by default' }
  }
  const problems = []
  const files = Object.keys(manifest.files ?? {})
  for (const [name, bytes] of Object.entries(manifest.files ?? {})) {
    const actual = await stat(path.join(outDir, name)).then((s) => s.size, () => null)
    if (actual === null) problems.push(`${name} is absent`)
    else if (actual !== bytes) problems.push(`${name} is ${actual} bytes, manifest says ${bytes}`)
  }
  for (const f of CORE_FILES) {
    if (!files.includes(`core/${f}`)) problems.push(`manifest omits core/${f}`)
  }
  if (!files.includes(LANG_MODEL) && !(await stat(path.join(outDir, LANG_MODEL)).then(() => true, () => false))) {
    problems.push(`${LANG_MODEL} is absent`)
  }
  if (problems.length) return { state: 'stale', files, detail: problems.join('; ') }
  return {
    state: 'complete',
    files,
    detail: `tesseract.js ${manifest['tesseract.js']} / core ${manifest['tesseract.js-core']}, ${(manifest.totalBytes / 1000 / 1000).toFixed(1)} MB`,
  }
}

// Decimal MB, to match the sizes quoted in the README and by `npm run doctor`.
const fmt = (bytes) => `${(bytes / 1000 / 1000).toFixed(1)} MB`

/** CLI body, so importing the helpers above has no side effects. */
async function main() {
  const args = new Set(process.argv.slice(2))
  if (args.has('--dry-run') && args.has('--check')) {
    console.error('Use either --dry-run or --check, not both.')
    process.exit(2)
  }

  if (args.has('--check')) {
    const status = await engineStatus()
    if (status.state !== 'complete') {
      console.error(`Vendored OCR engine is ${status.state}: ${status.detail}\nRe-run \`npm run vendor:ocr\`.`)
      process.exit(1)
    }
    console.log(`Vendored OCR engine is complete (${status.files.length} files) — ${status.detail}.`)
    process.exit(0)
  }

  let plan
  try {
    plan = await buildPlan()
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
  const total = plan.reduce((n, e) => n + e.bytes, 0)

  if (args.has('--dry-run')) {
    console.log(`Would copy ${plan.length} files (${fmt(total)}) into ${path.relative(ROOT, OUT_DIR)}/:`)
    for (const e of plan) console.log(`  ${e.name.padEnd(40)} ${fmt(e.bytes).padStart(9)}  ${e.note}`)
    process.exit(0)
  }

  await mkdir(path.join(OUT_DIR, 'core'), { recursive: true })
  const written = {}
  for (const e of plan) {
    const dest = path.join(OUT_DIR, e.name)
    const existing = await stat(dest).then((s) => s.size, () => null)
    // Only touch files that differ, so a repeat run right before a demo is instant.
    if (existing !== e.bytes) await copyFile(e.src, dest)
    written[e.name] = e.bytes
  }

  const manifest = {
    kind: MANIFEST_KIND,
    generatedBy: 'scripts/vendor-ocr.mjs',
    'tesseract.js': require('tesseract.js/package.json').version,
    'tesseract.js-core': require('tesseract.js-core/package.json').version,
    files: written,
    totalBytes: total,
  }
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)

  console.log(`OCR engine vendored into ${path.relative(ROOT, OUT_DIR)}/ (${fmt(total)} + manifest).`)
  console.log('A scan now needs no third-party host. These files are git-ignored on purpose: re-run this')
  console.log('command after any fresh checkout or rebuilt sandbox, and before `npm run build` for an offline dist/.')
  for (const e of plan) console.log(`  ${e.name.padEnd(40)} ${fmt(e.bytes).padStart(9)}`)
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename
if (invokedDirectly) await main()
