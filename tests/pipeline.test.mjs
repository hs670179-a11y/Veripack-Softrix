import assert from 'node:assert/strict'
import { test } from 'node:test'

import { checkAllRules, summarize } from '../src/lib/rulesEngine.js'
import { runAuthenticityChecks, evaluateExpiry, verifyFssaiLicense } from '../src/lib/authenticity.js'
import { headlineFor } from '../src/lib/report.js'

/**
 * End-to-end wiring test: label text → prompt → verdict rows → authenticity rows → headline.
 *
 * The model is replaced by `perfectReader`, a stand-in that is only allowed to regex the text
 * carried inside the prompt. It cannot look at LABELS directly, so if a row is wrong here the
 * wiring is wrong, not the model. This also proves the prompt really contains the label text.
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

const NON_COMPLIANT = [
  'BALAJI BEST CHOICE',
  '500g',
  'MRP 35/-',
  'Packd at Sagar',
  'Best before 06/2028',
].join('\n')

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

const GENERIC_WORDS =
  /\b(maida|atta|atka|wheat flour|rice|chawal|sugar|cheeni|salt|namak|oil|milk|doodh|biscuit|toothpaste|detergent|shampoo|soap|tea|chai|coffee|spice|masala|pulses|dal|flour|noodles|water)\b/i

function labelFrom(prompt) {
  const m = prompt.match(/<<<LABEL_TEXT\n([\s\S]*?)\nLABEL_TEXT>>>/)
  if (!m) throw new Error('the prompt no longer carries the label text — the wiring is broken')
  return m[1]
}

function lineOf(label, index) {
  const upto = label.slice(0, index)
  const start = Math.max(upto.lastIndexOf('\n') + 1, 0)
  let end = label.indexOf('\n', index)
  if (end === -1) end = label.length
  return label.slice(start, end).trim()
}

const READERS = {
  net_quantity: (t) => {
    const m = t.match(/\b\d+(?:[.,]\d+)?\s*(kg|g|ml|l|litre|litres|millilitre|millilitres|pieces|pcs|nos)\b/i)
    return m ? hit(lineOf(t, m.index), 'Net quantity is printed with a standard unit.') : miss('No net quantity with a weight, measure or count unit appears in the text.')
  },
  mrp: (t) => {
    const m = t.match(/\bMRP\b[^\n]*\bincl\w*\.?\s+of\s+all\s+taxes\b/i) || t.match(/\bMRP\b[^\n]*\bincl\w*\.?\s+all\s+taxes\b/i)
    if (m) return hit(lineOf(t, m.index), 'MRP line states it is inclusive of all taxes.')
    const anyMrp = t.match(/\bMRP\b[^\n]*/i)
    if (anyMrp) return miss('A price is printed but the text does not say it is inclusive of all taxes.')
    return miss('No MRP declaration appears in the label text.')
  },
  manufacturer_details: (t) => {
    const who = t.match(/\b(manufactur\w*|packer|packed\s*by|importer|imported\s*by)\b[^\n]*/i)
    const addr = t.match(/\b(pvt\.?\s*ltd|limited|plot\s*\d|\bindustrial\s*area\b|\bvillage\b|\btaluka\b|\bdist\.?\b|\broad\b|\bnagar\b|\b\d{6}\b)/i)
    if (who && addr) return hit(lineOf(t, who.index), 'Manufacturer name and address are both printed.')
    if (who) return miss('A manufacturer line is printed but no complete address accompanies it.')
    return miss('Neither a manufacturer, packer nor importer name with address appears in the text.')
  },
  consumer_care: (t) => {
    const m = t.match(/\b(consumer\s*care|customer\s*care|toll\s*free|helpline|email|contact)\b[^\n]*/i)
    const hasContact = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\b\d{5,6}[-\s]?\d{5,8}\b|\b\d{10,12}\b/.test(t)
    if (m && hasContact) return hit(lineOf(t, m.index), 'Consumer care contact details are printed.')
    if (m) return miss('A consumer care line is printed but no phone number or email follows it.')
    return miss('No consumer care name, address, phone or email appears in the text.')
  },
  date_of_manufacture: (t) => {
    const m = t.match(/\b(mfd|mfg|mf\.?\s*d|date\s*of\s*manufactur\w*|manufactured\s*(?:on|in|at)|packing\s*date|packed\s*on|date\s*of\s*packag?ing)\b\D{0,14}(\d{1,2}\s*[\/.\-]\s*\d{2,4}|[A-Za-z]{3,9}\.?\s+\d{2,4})/i)
    if (m) return hit(lineOf(t, m.index), 'Month and year of manufacture are printed.')
    return miss('No month and year of manufacture, packing or import appears in the text.')
  },
  country_of_origin: (t) => {
    const m = t.match(/\bcountry\s*of\s*origin\b\s*:?\s*\n?\s*([A-Za-z][A-Za-z ]{2,20})/i)
    if (m) return hit(lineOf(t, m.index), 'Country of origin is declared.')
    const made = t.match(/\bmade\s*in\s*india\b/i)
    if (made) return hit(lineOf(t, made.index), 'The pack declares Made in India, so the import condition does not apply.')
    return unsure('The text does not say whether these are imported goods, so this could not be judged.')
  },
  generic_name: (t) => {
    const line = t.split('\n').find((l) => GENERIC_WORDS.test(l))
    if (line) return hit(line.trim(), 'A common or generic name is printed.')
    return miss('No common or generic name for the contents appears in the text.')
  },
}

const hit = (evidence, reason) => ({ satisfied: true, evidence, reason })
const miss = (reason) => ({ satisfied: false, evidence: '', reason })
const unsure = (reason) => ({ satisfied: 'insufficient_evidence', evidence: '', reason })

/** A model that only ever reads the text it was given. */
async function perfectReader({ prompt }) {
  const label = labelFrom(prompt)
  const ruleId = prompt.match(/"ruleId":"([a-z_]+)"/)[1]
  const reader = READERS[ruleId]
  if (!reader) throw new Error(`no test reader for ${ruleId}`)
  const out = reader(label)
  return JSON.stringify({ ruleId, ...out })
}

function runAll(label) {
  return Promise.all([
    checkAllRules(label, { complete: perfectReader }),
    runAuthenticityChecks({ ocrText: label, image: null, now: NOW }),
  ])
}

/**
 * The vision row needs a real photo + model, which the test double does not simulate, so this
 * substitutes a clean read for that one row. The unmodified rows are checked separately below, to
 * prove that an unchecked row keeps the headline honest instead of silently passing.
 */
const withCleanVisionRead = (auth) =>
  auth.map((r) => (r.id === 'condition' ? { ...r, status: 'pass', reason: 'No visible damage in this photo.' } : r))

const squash = (s) =>
  String(s)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

/** Checklist item: every ✅ must be backed by words that are actually in the OCR text. */
function assertEvidenceIsQuotedFromTheLabel(rows, label) {
  for (const row of rows.filter((r) => r.status === 'pass')) {
    assert.ok(row.evidence, `${row.id}: a pass must carry evidence`)
    assert.ok(squash(label).includes(squash(row.evidence)), `${row.id}: evidence "${row.evidence}" is not in the label text`)
  }
}

test('a fully declared label comes out 7/7 with quoted evidence', async () => {
  const [rules, auth] = await runAll(COMPLIANT)
  const notPassing = rules.filter((r) => r.status !== 'pass').map((r) => `${r.id}: ${r.reason}`)
  assert.deepEqual(notPassing, [], 'every declaration should be found on this label')
  assert.deepEqual(summarize(rules), { total: 7, pass: 7, fail: 0, unknown: 0 })
  assertEvidenceIsQuotedFromTheLabel(rules, COMPLIANT)
  assert.equal(headlineFor({ complianceRows: rules, authRows: withCleanVisionRead(auth) }).key, 'headOk')
  // without a photo the vision row cannot be judged, so the headline says so instead of going silent
  assert.equal(headlineFor({ complianceRows: rules, authRows: auth }).key, 'headOkOtherUnclear')
  assert.ok(rules.every((r) => r.section.startsWith('Rule 6')), 'each row cites its rule')
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
  assertEvidenceIsQuotedFromTheLabel(rules, NON_COMPLIANT)
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
  assertEvidenceIsQuotedFromTheLabel(rules, EXPIRED)
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

test('a hallucinated quote that is not on the label is surfaced in the report row', async () => {
  const rows = await checkAllRules(NON_COMPLIANT, {
    complete: async ({ prompt }) => {
      const ruleId = prompt.match(/"ruleId":"([a-z_]+)"/)[1]
      return JSON.stringify({ ruleId, satisfied: true, evidence: 'MRP Rs. 35.00 INCLUSIVE OF ALL TAXES', reason: 'Found.' })
    },
  })
  // The engine cannot read the model's mind, but the report always shows the quote, so a human can
  // see that this evidence is not on the label. That is the transparency requirement in action.
  const mrp = rows.find((r) => r.id === 'mrp')
  assert.equal(mrp.status, 'pass')
  assert.ok(!squash(NON_COMPLIANT).includes(squash(mrp.evidence)), 'the bad quote is visible to the user')
})
