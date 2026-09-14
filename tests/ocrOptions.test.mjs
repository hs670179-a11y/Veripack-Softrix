/**
 * The decision "load OCR from our own origin or from a CDN", tested without a browser.
 *
 * The app cannot see the files in public/tesseract — it only sees what a fetch of engine.json returned,
 * so these two functions are the entire trust boundary. What matters here: a missing, malformed or
 * unrelated manifest must never make the app load a partial bundle, a present-and-correct one must, and
 * the retry ladder must always end somewhere that works.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ocrRetryRungs, ocrWorkerOptions } from '../src/lib/ocr.js'

const VENDORED = { kind: 'veripack-ocr-engine', files: { 'worker.min.js': 1 } }

test('nothing vendored: tesseract.js defaults, plus our own language folder', () => {
  const { options, engine } = ocrWorkerOptions({ manifest: null })
  assert.equal(engine, null)
  assert.equal(options.workerPath, undefined, 'must not point at a worker that is not there')
  assert.equal(options.corePath, undefined)
  assert.equal(options.langPath, '/tesseract')
  assert.equal(options.gzip, true)
  assert.equal(options.cacheMethod, 'readWrite')
})

test('a manifest of the wrong shape is not a licence to load local engine files', () => {
  for (const manifest of [undefined, {}, { kind: 'something-else' }, { kind: true }, 'veripack-ocr-engine', [], 0]) {
    const { options, engine } = ocrWorkerOptions({ manifest })
    assert.equal(engine, null, `accepted ${JSON.stringify(manifest) ?? String(manifest)} as an engine manifest`)
    assert.equal(options.workerPath, undefined)
    assert.equal(options.corePath, undefined)
  }
  // A directory listing without the marker, i.e. files copied by hand: still ignored, deliberately.
  assert.notEqual(ocrWorkerOptions({ manifest: { kind: 'veripack-ocr-engine' } }).engine, null, 'a valid manifest must be trusted')
})

test('a valid manifest points at the worker and the core directory', () => {
  const { options, engine } = ocrWorkerOptions({ manifest: VENDORED })
  assert.deepEqual(engine, { workerPath: '/tesseract/worker.min.js', corePath: '/tesseract/core' })
  assert.equal(options.workerPath, '/tesseract/worker.min.js')
  // A directory, not a file: tesseract.js appends the SIMD-or-not core name itself.
  assert.equal(options.corePath, '/tesseract/core')
  assert.ok(!options.corePath.endsWith('.js'), 'corePath must stay a directory')
})

test('the logger key is only ever a function, because tesseract.js rejects anything else', () => {
  for (const logger of [undefined, null, false, {}, 'noop', 0]) {
    assert.equal('logger' in ocrWorkerOptions({ manifest: null, logger }).options, false, `passed ${String(logger)}`)
  }
  const withLogger = ocrWorkerOptions({ manifest: null, logger: () => {} })
  assert.equal(typeof withLogger.options.logger, 'function')
})

test('the Node test run can override paths, and the options can never carry label data', () => {
  const { options } = ocrWorkerOptions({ manifest: VENDORED, langPath: null })
  assert.equal(options.langPath, undefined, 'a null langPath means "use the default host", not "undefined"')
  assert.equal(options.gzip, undefined)
  const ALLOWED = new Set(['cacheMethod', 'logger', 'langPath', 'gzip', 'workerPath', 'corePath'])
  const withLogger = ocrWorkerOptions({ manifest: VENDORED, logger: () => {} }).options
  for (const key of [...Object.keys(options), ...Object.keys(withLogger)]) {
    assert.ok(ALLOWED.has(key), `unexpected option "${key}" — anything past paths and a cache mode is a privacy question`)
  }
})

test('the retry ladder only drops what was actually being used', () => {
  const vendored = ocrWorkerOptions({ manifest: VENDORED })
  const rungs = ocrRetryRungs(vendored.options, { hasEngine: true, hasLangPath: true })
  assert.equal(rungs.length, 2)
  assert.equal(rungs[0].workerPath, undefined, 'first rung: no self-hosted engine')
  assert.equal(rungs[0].corePath, undefined)
  assert.equal(rungs[0].langPath, '/tesseract', 'first rung still uses the committed language model')
  assert.equal(rungs[1].langPath, undefined, 'last rung: nothing self-hosted left, i.e. stock tesseract.js')
  assert.equal(rungs[1].gzip, undefined)
  assert.equal(rungs[1].cacheMethod, 'readWrite', 'the last rung must still be a usable options object')

  const cdnEngine = ocrWorkerOptions({ manifest: null })
  const single = ocrRetryRungs(cdnEngine.options, { hasEngine: false, hasLangPath: true })
  assert.equal(single.length, 1, 'with no engine in play there is only the language fallback')
  assert.equal(single[0].langPath, undefined)
  assert.deepEqual(ocrRetryRungs(cdnEngine.options, { hasEngine: false, hasLangPath: false }), [])
})

test('no rung ever contains an explicit undefined path key', () => {
  // `{ langPath: undefined }` is not "unset" to tesseract.js — it has bitten this project before.
  const options = ocrWorkerOptions({ manifest: VENDORED, langPath: '/somewhere' }).options
  for (const rung of [options, ...ocrRetryRungs(options, { hasEngine: true, hasLangPath: true })]) {
    for (const [key, value] of Object.entries(rung)) {
      assert.notEqual(value, undefined, `${key} was present-but-undefined, which tesseract.js rejects`)
    }
  }
})
