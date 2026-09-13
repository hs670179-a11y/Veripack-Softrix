import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  checkBisMark,
  checkBarcode,
  checkDigitValid,
  checkPlausibility,
  evaluateExpiry,
  extractBarcodes,
  extractBisMarks,
  extractFssaiNumbers,
  extractNetQuantity,
  findDateCandidates,
  findShelfLife,
  normalizeVisual,
  runAuthenticityChecks,
  verifyFssaiLicense,
} from '../src/lib/authenticity.js'

/** Fixed clock so date maths in these tests never drift. */
const NOW = new Date('2026-09-14T06:00:00Z')

/* --------------------------- 3.1 dates / expiry --------------------------- */

test('dates are classified by the keyword printed in front of them', () => {
  const text = 'MFD: 06/2024\nBATCH NO. L4B22\nBEST BEFORE 06/2027'
  const kinds = findDateCandidates(text).map((c) => `${c.kind}:${c.readAs}`)
  assert.ok(kinds.includes('manufacture:JUN 2024'), kinds.join(','))
  assert.ok(kinds.includes('expiry:JUN 2027'), kinds.join(','))
})

test('an expired pack is flagged, with the printed date as evidence', () => {
  const r = evaluateExpiry('BEST BEFORE DATE: 12/06/2026', NOW)
  assert.equal(r.status, 'fail')
  assert.match(r.reason, /Expired 76 days ago/)
  assert.equal(r.evidence, '12/06/2026')
})

test('expiry given as month/year covers the whole month', () => {
  assert.equal(evaluateExpiry('BEST BEFORE OCT 2026', NOW).status, 'unknown') // 47 days away → nearing
  assert.match(evaluateExpiry('BEST BEFORE OCT 2026', NOW).reason, /Expires in 47 days/)
  assert.equal(evaluateExpiry('BEST BEFORE JUN 2027', NOW).status, 'pass')
})

test('month/year written in the wrong order is still read, and says so', () => {
  const r = evaluateExpiry('EXP 2027/03', NOW)
  assert.equal(r.status, 'pass')
  assert.match(r.detail.candidates[0].note, /swapped|MM\/YY/)
})

test('shelf life is used to derive expiry when only the manufacture date is printed', () => {
  const r = evaluateExpiry('MFD 06/2024\nSHELF LIFE 12 MONTHS FROM PACKING', NOW)
  assert.equal(r.status, 'fail')
  assert.match(r.reason, /expiry 01 JUN 2025, derived from JUN 2024 \+ 12 months\)/)
  assert.equal(r.detail.derived, true)
})

test('manufacture date with no expiry date is "not sure", never a pass', () => {
  const r = evaluateExpiry('Manufactured in JUN 2026 at Plant 3, Sagar', NOW)
  assert.equal(r.status, 'unknown')
  assert.match(r.reason, /no expiry date or shelf life/)
})

test('a manufacture date in the future is a hard flag', () => {
  const r = evaluateExpiry('MFD: 01/2027', NOW)
  assert.equal(r.status, 'fail')
  assert.match(r.reason, /in the future/)
})

test('no dates at all is reported as "not sure"', () => {
  const r = evaluateExpiry('WHEAT ATKA 500 g MRP 35/-', NOW)
  assert.equal(r.status, 'unknown')
  assert.match(r.reason, /No date/)
})

test('findShelfLife reads months, years and days', () => {
  assert.equal(findShelfLife('Shelf life 18 months').months, 18)
  assert.equal(findShelfLife('Best before 2 years from packing').months, 24)
  assert.equal(findShelfLife('shelf life of 90 days').months, 3)
  assert.equal(findShelfLife('no duration here'), null)
})

/* ------------------------ 3.2 FSSAI demo lookup -------------------------- */

test('a 14-digit FSSAI number is found, spaced or solid', () => {
  assert.deepEqual(extractFssaiNumbers('FSSAI Lic. No. 10018021000557').map((n) => n.digits), ['10018021000557'])
  assert.deepEqual(extractFssaiNumbers('Food Licence No 1001 8021 0005 57').map((n) => n.digits), ['10018021000557'])
  assert.deepEqual(extractFssaiNumbers('ISIN 999999999999').map((n) => n.digits), [], '12 digits is not a licence')
})

test('a demo-record hit is reported as verified against the demo dataset', () => {
  const r = verifyFssaiLicense('FSSAI: 10018021000557', { now: NOW })
  assert.equal(r.status, 'pass')
  assert.match(r.reason, /Demo record for 10018021000557: Demo Foods Pvt Ltd/)
})

test('a demo record whose validity has passed is flagged', () => {
  const r = verifyFssaiLicense('FSSAI Lic No: 13318025000421', { now: NOW })
  assert.equal(r.status, 'fail')
  assert.match(r.reason, /valid only up to 2025-12-31/)
})

test('an unknown number is "cannot verify", never "invalid"', () => {
  const r = verifyFssaiLicense('FSSAI: 13579246801234', { now: NOW })
  assert.equal(r.status, 'unknown')
  assert.match(r.reason, /not in the demo dataset, so this app cannot verify it/)
  assert.doesNotMatch(r.reason, /\binvalid\b|\bfake\b|\bduplicate\b/i)
})

test('a label with no licence number says so instead of failing the check', () => {
  const r = verifyFssaiLicense('ATKA 500 g MRP 35/-', { now: NOW })
  assert.equal(r.status, 'unknown')
  assert.match(r.reason, /No 14-digit FSSAI/)
})

/* ---------------------- 3.3 declared-quantity plausibility ---------------- */

test('net quantity is read in weight, volume and count forms', () => {
  assert.equal(extractNetQuantity('Net Qty: 500 g').value, 500)
  assert.equal(extractNetQuantity('Net Quantity: 1.5 L').value, 1.5)
  assert.equal(extractNetQuantity('Contains 12 pieces').value, 12)
  assert.equal(extractNetQuantity('500ml').kind, 'volume')
  assert.equal(extractNetQuantity('nothing here'), null)
})

test('a normal retail quantity passes the soft check', () => {
  const r = checkPlausibility('WHEAT ATKA\nNet Qty: 500 g\nMRP 35/-')
  assert.equal(r.status, 'pass')
  assert.match(r.reason, /Soft check/)
})

test('unit-vs-commodity contradiction is a caution, not a legal failure', () => {
  const r = checkPlausibility('WHEAT ATKA\nNet Quantity: 1 L')
  assert.equal(r.status, 'unknown')
  assert.match(r.reason, /not a rule violation/)
})

test('absurd magnitudes are caught', () => {
  assert.equal(checkPlausibility('COOKING OIL\nNet Qty: 900000 kg').status, 'unknown')
  assert.match(checkPlausibility('COOKING OIL\nNet Qty: 900000 kg').reason, /far outside/)
  assert.equal(checkPlausibility('SUGAR\nNet Qty: 0 g').status, 'unknown')
})

test('with no quantity to judge, the check admits it cannot judge', () => {
  const r = checkPlausibility('MRP 35/- only')
  assert.equal(r.status, 'unknown')
  assert.match(r.reason, /plausibility cannot be judged/)
})

/* ---------------------- 3.5 barcode / GS1 / BIS marks ------------------- */

test('EAN-13 check digit arithmetic is real verification', () => {
  assert.equal(checkDigitValid('8901234567890'), true)
  assert.equal(checkDigitValid('8901234567891'), false)
  assert.equal(checkDigitValid('890123456781'), true, '12-digit UPC-A uses the 3-1 weighting')
  assert.equal(checkDigitValid('890123456789'), false, 'wrong UPC-A check digit')
  assert.equal(checkDigitValid('12345'), null, 'not a barcode-length number')
})

test('a well-formed Indian barcode passes, with the demo company note attached', () => {
  const r = checkBarcode('8901234567890')
  assert.equal(r.status, 'pass')
  assert.match(r.reason, /range allocated to India \(890–899\)/)
  assert.match(r.reason, /Demo dataset maps prefix 8901234/)
})

test('a barcode outside the India range is explained, not failed', () => {
  const r = checkBarcode('6941234567898')
  assert.equal(r.status, 'pass')
  assert.match(r.reason, /outside the India range/)
  assert.match(r.reason, /not in the demo dataset, so it cannot be verified/)
})

test('a barcode whose check digit does not add up is flagged as mis-read or mis-printed', () => {
  const r = checkBarcode('8901234567891')
  assert.equal(r.status, 'fail')
  assert.match(r.reason, /check-digit test/)
})

test('no barcode is "not sure"', () => {
  assert.equal(extractBarcodes('no code here').length, 0)
  assert.match(checkBarcode('nothing').reason, /No barcode number/)
})

test('BIS marks are read as declared, and unknown numbers are not called invalid', () => {
  assert.equal(extractBisMarks('ISI Mark Licence No. CM/L-1234567')[0].digits, '1234567')
  assert.equal(checkBisMark('ISI Mark Licence No. CM/L-1234567').status, 'pass')
  const unknown = checkBisMark('ISI 4242424')
  assert.equal(unknown.status, 'unknown')
  assert.match(unknown.reason, /not in the demo dataset, so this app cannot verify it/)
  assert.doesNotMatch(unknown.reason, /\binvalid\b|\bfake\b/i)
})

test('absence of a BIS mark stays advisory because ISI is not required for every food', () => {
  const r = checkBisMark('ATKA 500 g')
  assert.equal(r.status, 'unknown')
  assert.match(r.reason, /advisory only/)
})

/* --------------------- 3.4 visual condition (model output) -------------- */

test('visual findings map onto the three-state UI vocabulary', () => {
  assert.equal(normalizeVisual({ finding: 'none', description: 'Sealed and intact.' }).status, 'pass')
  assert.equal(normalizeVisual({ finding: 'possible_damage', description: 'Torn corner.' }).status, 'fail')
  assert.equal(normalizeVisual({ finding: 'insufficient_evidence' }).status, 'unknown')
  assert.equal(normalizeVisual({ finding: 'maybe torn' }).status, 'unknown')
  assert.equal(normalizeVisual(null).status, 'unknown')
})

test('the vision prompt forbids counterfeit language and guessing', async () => {
  const fs = await import('node:fs')
  const src = fs.readFileSync(new URL('../src/lib/authenticity.js', import.meta.url), 'utf8')
  const prompt = src.slice(src.indexOf('const VISION_PROMPT'), src.indexOf('export function normalizeVisual'))
  assert.match(prompt, /Do not state or hint whether the product is genuine, original, fake or counterfeit/)
  assert.match(prompt, /When in doubt, choose "insufficient_evidence"/)
})

/* --------------------------- orchestration rows -------------------------- */

test('runAuthenticityChecks returns all six rows in order, each with a citation', async () => {
  const rows = await runAuthenticityChecks({
    ocrText: 'WHEAT ATKA\nNet Qty: 500 g\nMFD 06/2024\nBEST BEFORE 06/2027\nFSSAI 10018021000557\n8901234567890',
    image: null,
    now: NOW,
  })
  assert.deepEqual(
    rows.map((r) => r.id),
    ['expiry', 'fssai', 'plausibility', 'condition', 'barcode', 'bis'],
  )
  assert.ok(rows.every((r) => typeof r.section === 'string' && r.section.length > 5), 'every row is cited')
  assert.equal(rows.find((r) => r.id === 'expiry').status, 'pass')
  assert.equal(rows.find((r) => r.id === 'fssai').status, 'pass')
  // nothing can be judged without a photo, and no key in tests: never a silent pass
  const condition = rows.find((r) => r.id === 'condition')
  assert.equal(condition.status, 'unknown')
  assert.match(condition.reason, /No photo available/)
  assert.equal(rows.find((r) => r.id === 'bis').status, 'unknown')
  assert.ok(rows.filter((r) => r.badge === 'demo').length >= 3, 'demo-sourced rows are badged')
})

test('a photo but no API key gives "check unavailable" for the vision row, and sends nothing', async () => {
  const rows = await runAuthenticityChecks({
    ocrText: 'ATKA 500 g MRP 35/-',
    image: { base64: 'ZmFrZQ==', mimeType: 'image/jpeg', width: 800, height: 600 },
    now: NOW,
  })
  const condition = rows.find((r) => r.id === 'condition')
  assert.equal(condition.status, 'unknown')
  assert.equal(condition.reason, 'check unavailable')
})

test('rows stream in through onResult as each check finishes', async () => {
  const seen = []
  await runAuthenticityChecks({ ocrText: 'ATKA 500 g', now: NOW, onResult: (r) => seen.push(r.id) })
  assert.deepEqual(seen, ['expiry', 'fssai', 'plausibility', 'condition', 'barcode', 'bis'])
})
