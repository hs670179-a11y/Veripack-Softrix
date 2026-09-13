/**
 * Shared test helpers.
 *
 * labelReader: a model stand-in that is only allowed to read the text inside the prompt, so a test
 * failure means the wiring is wrong rather than the model being unlucky. Used by the pipeline test
 * and by the OCR end-to-end test.
 */

const GENERIC_WORDS =
  /\b(maida|atta|atka|wheat flour|rice|chawal|sugar|cheeni|salt|namak|oil|milk|doodh|biscuit|toothpaste|detergent|shampoo|soap|tea|chai|coffee|spice|masala|pulses|dal|flour|noodles|water)\b/i

export function labelFrom(prompt) {
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

const hit = (evidence, reason) => ({ satisfied: true, evidence, reason })
const miss = (reason) => ({ satisfied: false, evidence: '', reason })
const unsure = (reason) => ({ satisfied: 'insufficient_evidence', evidence: '', reason })

const READERS = {
  net_quantity: (t) => {
    const m = t.match(/\b\d+(?:[.,]\d+)?\s*(kg|g|ml|l|litre|litres|millilitre|millilitres|pieces|pcs|nos)\b/i)
    return m ? hit(lineOf(t, m.index), 'Net quantity is printed with a standard unit.') : miss('No net quantity with a weight, measure or count unit appears in the text.')
  },
  mrp: (t) => {
    const m = t.match(/\bMRP\b[^\n]*\bincl\w*\.?\s+of\s+all\s+taxes\b/i) || t.match(/\bMRP\b[^\n]*\bincl\w*\.?\s+all\s+taxes\b/i)
    if (m) return hit(lineOf(t, m.index), 'MRP line states it is inclusive of all taxes.')
    if (t.match(/\bMRP\b[^\n]*/i)) return miss('A price is printed but the text does not say it is inclusive of all taxes.')
    return miss('No MRP declaration appears in the label text.')
  },
  manufacturer_details: (t) => {
    const who = t.match(/\b(manufactur\w*|packer|packed\s*by|importer|imported\s*by)\b[^\n]*/i)
    const addr = t.match(/\b(pvt\.?\s*ltd|limited|plot\s*\d|\bindustrial\s*area\b|\bvillage\b|\bdist\.?\b|\broad\b|\bnagar\b|\b\d{6}\b)/i)
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
    const m = t.match(
      /\b(mfd|mfg|mf\.?\s*d|date\s*of\s*manufactur\w*|manufactured\s*(?:on|in|at)|packing\s*date|packed\s*on|date\s*of\s*packag?ing)\b\D{0,14}(\d{1,2}\s*[/.-]\s*\d{2,4}|[A-Za-z]{3,9}\.?\s+\d{2,4})/i,
    )
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

/** A "model" that only ever reads the text it was given. */
export async function perfectReader({ prompt }) {
  const label = labelFrom(prompt)
  const ruleId = prompt.match(/"ruleId":"([a-z_]+)"/)[1]
  const reader = READERS[ruleId]
  if (!reader) throw new Error(`no test reader for ${ruleId}`)
  return JSON.stringify({ ruleId, ...reader(label) })
}

export const squash = (s) =>
  String(s)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

/** Every ✅ must quote words that really appear in the (OCR) text. */
export function assertEvidenceIsQuotedFromTheLabel(rows, label, assert) {
  for (const row of rows.filter((r) => r.status === 'pass')) {
    assert.ok(row.evidence, `${row.id}: a pass must carry evidence`)
    assert.ok(squash(label).includes(squash(row.evidence)), `${row.id}: evidence "${row.evidence}" is not in the label text`)
  }
}
