import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { judgeOcr, LOW_CONFIDENCE_THRESHOLD, MIN_USABLE_WORDS, cleanOcrText } from '../src/lib/ocr.js'

/**
 * Two of the app's most important behaviours live in browser-only code (the canvas copy and the OCR
 * gate), and this sandbox has no browser. So the decision logic is pure and tested here, and the
 * canvas path is guarded by shape assertions that fail if the fallback is ever removed.
 */
const ROOT = new URL('..', import.meta.url).pathname
const ocrSource = readFileSync(join(ROOT, 'src/lib/ocr.js'), 'utf8')

test('a photo with no readable words is "failed", not an empty success', () => {
  for (const text of ['', '   ', '\n\n', 'atka', '500 g', '   . . , , ', ' | - . | - . | MRP ', '\u2022 \u2022 \u2022']) {
    const r = judgeOcr(text, 90)
    assert.equal(r.status, 'failed', `should refuse: ${JSON.stringify(text)}`)
    assert.ok(r.message, 'and must say why')
  }
})

test('the difference between "nothing found" and "too little found" is explained differently', () => {
  assert.match(judgeOcr('', 0).message, /No readable text/)
  assert.match(judgeOcr(' | - . |', 0).message, /No readable text/, 'punctuation is not text')
  assert.match(judgeOcr('atka 500', 80).message, /Too little text/)
})

test('a poor read is flagged as poor, at the threshold and just below it', () => {
  const r = judgeOcr('MAIDA ATKA 500 g MRP 35/- best before 06/2028 some more words here', LOW_CONFIDENCE_THRESHOLD - 1)
  assert.equal(r.status, 'low-confidence')
  assert.match(r.message, new RegExp(`confidence ${LOW_CONFIDENCE_THRESHOLD - 1}%`))
  assert.equal(
    judgeOcr('MAIDA ATKA 500 g MRP 35/- best before 06/2028 and more', LOW_CONFIDENCE_THRESHOLD).status,
    'ok',
    'at the threshold the read is allowed through',
  )
})

test('a good read passes with its numbers attached, for the report to quote', () => {
  const r = judgeOcr('SHREE BALAJI MAIDA\nNET QUANTITY: 500 g\nMRP Rs. 35.00', 92)
  assert.equal(r.status, 'ok')
  assert.equal(r.confidence, 92)
  assert.equal(r.wordCount, 10)
})

test('confidence is clamped, because a broken scanner should not crash the gate', () => {
  for (const bad of [undefined, null, NaN, -5, 'x']) {
    const r = judgeOcr('MAIDA ATKA 500 g MRP 35/- best before 06/2028 words', bad)
    assert.equal(r.confidence, 0, `confidence came back as ${r.confidence}`)
    assert.equal(r.status, 'low-confidence', 'an unknown confidence is treated as a poor read, not a good one')
  }
  // a nonsensical 1000 is clamped to 100 rather than thrown away
  assert.equal(judgeOcr('MAIDA ATKA 500 g MRP 35/- best before 06/2028 words', 1000).confidence, 100)
})

test('the thresholds are the ones the README describes', () => {
  assert.equal(MIN_USABLE_WORDS, 4)
  assert.equal(LOW_CONFIDENCE_THRESHOLD, 55)
})

test('OCR noise is normalised before anything is matched against it', () => {
  const cleaned = cleanOcrText('MRP\u00a0₹35/-\t\t\n\n\n\n“incl.”  ﬁne\u000d')
  assert.ok(!cleaned.includes('\r'), 'carriage returns gone')
  assert.ok(!/ {2,}\n/.test(cleaned), 'no trailing space runs before a break')
  assert.ok(cleaned.includes('"incl."'), 'curly quotes normalised for the regexes')
  assert.ok(cleaned.includes('fine'), 'ligature ﬁ expanded')
})

/* ---------------------- browser-only canvas path, by shape ---------------------- */

test('the canvas copies are optional: any failure keeps the original bytes', () => {
  const block = ocrSource.slice(ocrSource.indexOf('const plan = planOcrSize'), ocrSource.indexOf('const commaAt'))
  const calls = (block.match(/await redraw\(/g) || []).length
  assert.equal(calls, 2, 'one colour copy for preview/vision, one greyscale copy for the scanner')
  assert.ok(block.includes('try {') && block.includes('} catch {'), 'both redraws sit inside a try/catch')
  assert.match(block, /let dataUrl = original\s*\n\s*let ocrDataUrl = original/, 'both fall back to the original')
})

test('the vision model gets colour, the scanner gets greyscale', () => {
  assert.match(ocrSource, /redraw\(original, plan\.width, plan\.height, \{ grayscale: false \}\)/)
  assert.match(ocrSource, /redraw\(original, plan\.width, plan\.height, \{ grayscale: true \}\)/)
  assert.match(ocrSource, /if \(plan\.scale < 1\)/, 'the colour copy never grows')
  assert.match(ocrSource, /ocrDataUrl,/, 'the scanner copy is handed to the caller')
  assert.match(readFileSync(join(ROOT, 'src/App.jsx'), 'utf8'), /readLabel\(img\.ocrDataUrl \|\| img\.dataUrl/)
})

test('the extracted-text panel does not mirror native state in React', () => {
  const panel = readFileSync(join(ROOT, 'src/components/ExtractedTextPanel.jsx'), 'utf8')
  assert.ok(!/onToggle=/.test(panel), 'a native <details> owns its open flag, so no mirrored state')
  assert.match(readFileSync(join(ROOT, 'src/styles/app.css'), 'utf8'), /details\.text-panel\[open\] > summary \.chev/)
})
