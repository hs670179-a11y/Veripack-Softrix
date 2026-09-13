import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { checkAllRules, summarize } from '../src/lib/rulesEngine.js'
import { runAuthenticityChecks } from '../src/lib/authenticity.js'
import { headlineFor } from '../src/lib/report.js'
import { perfectReader, assertEvidenceIsQuotedFromTheLabel } from './helpers/labelReader.mjs'
import { SAMPLES, TESSDATA_DIR, ocrImage, closeOcr } from './helpers/ocrEngine.mjs'

/**
 * The real end-to-end test: actual image files → Tesseract.js OCR (same engine and worker options
 * the browser uses) → rule rows + authenticity rows → headline. This is checklist item 8 of the
 * build spec ("runs end to end on at least 3 real test images, including one deliberately
 * non-compliant and one expired/mismatched example"), run against generated label photos because a
 * hackathon sandbox has no real packets.
 *
 * Only the offline half of Module 3 and the plumbing of Module 2 are asserted here: the Gemini
 * calls themselves need a key and are covered by the stubbed tests.
 */
const ROOT = new URL('..', import.meta.url).pathname
const NOW = new Date('2026-09-14T06:00:00Z')

after(closeOcr)

test('the app ships its own OCR language data, so a first scan needs no third-party host', () => {
  const file = join(TESSDATA_DIR, 'eng.traineddata.gz')
  assert.ok(existsSync(file), `${file} must exist (see README: Fully offline OCR)`)
  const size = statSync(file).size
  assert.ok(size > 1_000_000 && size < 20_000_000, `unexpected traineddata size: ${size}`)
})

/** Strings each fixture must survive OCR with, because the checks key off them. */
const MUST_CONTAIN = {
  '1-compliant-atta-500g.jpg': [/NET QUANTITY: 500 g/, /MRP Rs\. 35\.00/, /MFD: 06\/2026/, /10018021000557/, /8901234567890/],
  '2-noncompliant-loose-pack.jpg': [/BALAJI BEST CHOICE/, /500g/, /MRP 35\/-/, /06\/2028/],
  '3-expired-milk-powder.jpg': [/1 kg/, /MFD: 01\/2024/, /12\/2024/, /13318025000421/, /8901234567890/],
}

const EXPECTED = {
  '1-compliant-atta-500g.jpg': {
    rules: { total: 7, pass: 7, fail: 0, unknown: 0 },
    auth: { expiry: 'pass', fssai: 'pass', plausibility: 'pass', barcode: 'pass' },
    headline: 'headOkOtherUnclear',
  },
  '2-noncompliant-loose-pack.jpg': {
    rules: { total: 7, pass: 1, fail: 5, unknown: 1 },
    auth: { expiry: 'pass', fssai: 'unknown', plausibility: 'pass', barcode: 'unknown' },
    headline: 'headMissing',
  },
  '3-expired-milk-powder.jpg': {
    rules: { total: 7, pass: 7, fail: 0, unknown: 0 },
    auth: { expiry: 'fail', fssai: 'fail', plausibility: 'pass', barcode: 'pass' },
    headline: 'headExpired',
  },
}

for (const sample of SAMPLES) {
  const name = sample.split('/').pop()

  test(`OCR of ${name} is readable enough to judge`, async () => {
    const ocr = await ocrImage(join(ROOT, sample))
    assert.equal(ocr.status, 'ok', `OCR failed: ${ocr.message || ''}`)
    assert.ok(ocr.confidence >= 70, `low confidence read: ${ocr.confidence}%`)
    assert.ok(ocr.wordCount >= 10, `only ${ocr.wordCount} words recovered`)
    // the numbers the checks depend on must survive the scan, or the fixtures are not usable
    for (const pattern of MUST_CONTAIN[name]) {
      assert.match(ocr.text, pattern, `${name}: expected ${pattern} in the OCR text`)
    }
  })

  test(`${name} produces the expected report`, async () => {
    const { text } = await ocrImage(join(ROOT, sample))
    const [rules, auth] = await Promise.all([
      checkAllRules(text, { complete: perfectReader }),
      runAuthenticityChecks({ ocrText: text, image: null, now: NOW }),
    ])
    const want = EXPECTED[name]
    assert.deepEqual(summarize(rules), want.rules, `rule counts differ for ${name}`)
    for (const [id, status] of Object.entries(want.auth)) {
      assert.equal(auth.find((r) => r.id === id).status, status, `${name} → ${id}`)
    }
    assertEvidenceIsQuotedFromTheLabel(rules, text, assert)
    assert.equal(headlineFor({ complianceRows: rules, authRows: auth }).key, want.headline)
  })
}
