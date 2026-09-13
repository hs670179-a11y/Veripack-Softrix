import assert from 'node:assert/strict'
import { test } from 'node:test'

import { checkAllRules, summarize } from '../src/lib/rulesEngine.js'
import { runAuthenticityChecks, evaluateExpiry, verifyFssaiLicense } from '../src/lib/authenticity.js'
import { headlineFor } from '../src/lib/report.js'
import { perfectReader, assertEvidenceIsQuotedFromTheLabel, squash } from './helpers/labelReader.mjs'

/**
 * End-to-end wiring test on text fixtures: label text → prompt → verdict rows → authenticity rows →
 * headline. The model is replaced by `perfectReader` (tests/helpers), a stand-in that is only
 * allowed to read the text inside the prompt, so a failure here means the wiring is wrong, not that
 * the model was unlucky. It also proves the prompt really carries the label text.
 *
 * tests/ocrE2E.test.mjs runs the same assertions on text OCR'd from real image files.
 */
const NOW = new Date('2026-09-14T06:00:00Z')

const COMPLIANT = [
  'MAIDA (REFINED WHEAT FLOUR)',
  'NET QUANTITY: 500 g',
  'MRP Rs. 35.00 (INCL. OF ALL TAXES)',
  'MFD: 06/2026   BEST BEFORE 12 MONTHS FROM PACKING',
  'MANUFACTURED & PACKED BY:',
  'Shree Balaji Foods Pvt. Ltd.',
  'Plot 14, Industrial Area, Sagar, M.P. 470002',
  'CONSUMER CARE: 07542-220145 | care@balajifoods.example',
  'COUNTRY OF ORIGIN: INDIA',
  'FSSAI Lic. No. 10018021000557',
  'Barcode 8901234567890',
  'ISI Mark Lic. No. CM/L-1234567',
].join('\n')

const NON_COMPLIANT = ['BALAJI BEST CHOICE', '500g', 'MRP 35/-', 'Packd at Sagar', 'Best before 06/2028'].join('\n')

const EXPIRED = [
  'ATKA (WHEAT FLOUR)',
  'NET QUANTITY: 1 kg',
  'MRP Rs. 45.00 (INCLUSIVE OF ALL TAXES)',
  'MFD: 01/2024   BEST BEFORE 12/2024',
  'MANUFACTURED BY: Shree Balaji Foods Pvt. Ltd., Plot 14, Industrial Area, Sagar',
  'CONSUMER CARE: care@balajifoods.example',
  'Made in India',
  'FSSAI Lic. No. 13318025000421',
].join('\n')

const runAll = (label) =>
  Promise.all([
    checkAllRules(label, { complete: perfectReader }),
    runAuthenticityChecks({ ocrText: label, image: null, now: NOW }),
  ])

/**
 * The vision row needs a real photo plus the model, which no stand-in can produce, so this supplies
 * a clean read for that one row. The unmodified rows are asserted separately, to prove an unchecked
 * row keeps the headline honest instead of silently going green.
 */
const withCleanVisionRead = (auth) =>
  auth.map((r) => (r.id === 'condition' ? { ...r, status: 'pass', reason: 'No visible damage in this photo.' } : r))

test('a fully declared label comes out 7/7 with quoted evidence', async () => {
  const [rules, auth] = await runAll(COMPLIANT)
  const notPassing = rules.filter((r) => r.status !== 'pass').map((r) => `${r.id}: ${r.reason}`)
  assert.deepEqual(notPassing, [], 'every declaration should be found on this label')
  assert.deepEqual(summarize(rules), { total: 7, pass: 7, fail: 0, unknown: 0 })
  assertEvidenceIsQuotedFromTheLabel(rules, COMPLIANT, assert)
  assert.ok(rules.every((r) => r.section.startsWith('Rule 6')), 'each row cites its rule')
  assert.equal(headlineFor({ complianceRows: rules, authRows: withCleanVisionRead(auth) }).key, 'headOk')
  // without a photo the vision row cannot be judged, so the headline says so instead of going quiet
  assert.equal(headlineFor({ complianceRows: rules, authRows: auth }).key, 'headOkOtherUnclear')
})

test('a bare street-market pack fails the five declarations it is missing', async () => {
  const [rules, auth] = await runAll(NON_COMPLIANT)
  const byId = Object.fromEntries(rules.map((r) => [r.id, r.status]))
  assert.equal(byId.net_quantity, 'pass')
  assert.equal(byId.mrp, 'fail', 'MRP without "inclusive of all taxes" is not compliant')
  assert.equal(byId.manufacturer_details, 'fail')
  assert.equal(byId.consumer_care, 'fail')
  assert.equal(byId.date_of_manufacture, 'fail', 'only a best-before date is printed')
  assert.equal(byId.generic_name, 'fail')
  assert.equal(byId.country_of_origin, 'unknown', 'cannot tell whether it is an import')
  assert.deepEqual(summarize(rules), { total: 7, pass: 1, fail: 5, unknown: 1 })
  assertEvidenceIsQuotedFromTheLabel(rules, NON_COMPLIANT, assert)
  const head = headlineFor({ complianceRows: rules, authRows: auth })
  assert.equal(head.key, 'headMissing')
  assert.equal(head.vars.n, 5)
})

test('an expired pack overrides the headline even when all 7 declarations are present', async () => {
  const [rules, auth] = await runAll(EXPIRED)
  assert.equal(summarize(rules).pass, 7)
  assert.equal(summarize(rules).fail, 0)
  assert.equal(evaluateExpiry(EXPIRED, NOW).status, 'fail')
  assert.equal(auth.find((r) => r.id === 'expiry').status, 'fail')
  assert.equal(verifyFssaiLicense(EXPIRED, { now: NOW }).status, 'fail', 'the demo licence record has lapsed')
  assert.equal(headlineFor({ complianceRows: rules, authRows: auth }).key, 'headExpired')
  assertEvidenceIsQuotedFromTheLabel(rules, EXPIRED, assert)
})

test('a garbled OCR read never produces passes', async () => {
  const garbled = 'MA1DA 5OO g\nMRP 3s/-\n...unintelligible...'
  const rows = await checkAllRules(garbled, {
    complete: async ({ prompt }) => {
      const ruleId = prompt.match(/"ruleId":"([a-z_]+)"/)[1]
      // a well-behaved model answers "insufficient_evidence" on noise
      return JSON.stringify({ ruleId, satisfied: 'insufficient_evidence', evidence: '', reason: 'Text is unclear.' })
    },
  })
  assert.equal(summarize(rows).pass, 0)
  assert.equal(summarize(rows).unknown, 7)
})

test('a pass asserted without a quote is refused by the engine, not shown as satisfied', async () => {
  const rows = await checkAllRules(COMPLIANT, {
    complete: async ({ prompt }) => {
      const ruleId = prompt.match(/"ruleId":"([a-z_]+)"/)[1]
      return JSON.stringify({ ruleId, satisfied: true, evidence: '', reason: 'It is usually printed.' })
    },
  })
  assert.equal(summarize(rows).pass, 0, 'evidence-free passes must be refused')
  assert.equal(summarize(rows).unknown, 7)
})

test('a hallucinated quote that is not on the label stays visible for a human to catch', async () => {
  const rows = await checkAllRules(NON_COMPLIANT, {
    complete: async ({ prompt }) => {
      const ruleId = prompt.match(/"ruleId":"([a-z_]+)"/)[1]
      return JSON.stringify({ ruleId, satisfied: true, evidence: 'MRP Rs. 35.00 INCLUSIVE OF ALL TAXES', reason: 'Found.' })
    },
  })
  // The engine cannot read the model's mind, but every row shows its quote, so a made-up piece of
  // evidence is obvious on screen. That is the transparency requirement working as intended.
  const mrp = rows.find((r) => r.id === 'mrp')
  assert.equal(mrp.status, 'pass')
  assert.ok(!squash(NON_COMPLIANT).includes(squash(mrp.evidence)), 'the bad quote is not from this label')
})
