import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseJsonObject, MissingKeyError } from '../src/lib/gemini.js'
import { buildRulePrompt, normalizeVerdict, summarize, unavailableRow, checkAllRules } from '../src/lib/rulesEngine.js'

const RULE = {
  id: 'mrp',
  name: 'Maximum Retail Price Declaration',
  section: 'Rule 6(1)(f)',
  description: 'The package must declare the Maximum Retail Price (MRP) and explicitly state that it is inclusive of all taxes.',
}
const OCR = 'WHEAT ATKA\nNet Qty: 500 g\nMRP  35/- (incl. of all taxes)\nMFD 06/2024'

/* ------------------------------ the prompt ------------------------------ */

test('prompt hands the model only the rule text and the OCR text as evidence', () => {
  const prompt = buildRulePrompt(RULE, OCR)
  assert.ok(prompt.includes(RULE.description), 'rule text present')
  assert.ok(prompt.includes(OCR), 'label text present verbatim')
  assert.ok(prompt.includes('<<<LABEL_TEXT'), 'evidence set is delimited')
  // the anti-outside-knowledge instructions must be in there, in these words
  assert.match(prompt, /Use ONLY the text inside LABEL_TEXT/)
  assert.match(prompt, /Do not use general knowledge/)
  assert.match(prompt, /never merge unrelated words/)
  assert.match(prompt, /When in doubt, always choose "insufficient_evidence"/)
})

test('the label text is embedded exactly once, so nothing is smuggled in twice', () => {
  const prompt = buildRulePrompt(RULE, OCR)
  const occurrences = prompt.split(OCR).length - 1
  assert.equal(occurrences, 1)
})

test('conditional rules may be reported as not applicable, but only with a quote', () => {
  const prompt = buildRulePrompt({ ...RULE, description: 'For imported goods, the package must declare the country of origin.' }, OCR)
  assert.match(prompt, /condition does not apply/)
})

/* ---------------------------- verdict handling --------------------------- */

test('a pass with no quoted evidence is downgraded to "could not confirm"', () => {
  const v = normalizeVerdict({ satisfied: true, evidence: '   ', reason: 'Looks fine.' }, RULE)
  assert.equal(v.status, 'unknown')
  assert.doesNotMatch(v.reason, /looks fine/i)
})

test('insufficient_evidence, garbage and unknown words all map to unknown', () => {
  for (const satisfied of ['insufficient_evidence', null, undefined, 'maybe', 'partial', 'unknown']) {
    assert.equal(normalizeVerdict({ satisfied, evidence: '', reason: 'x' }, RULE).status, 'unknown')
  }
})

test('boolean and stringified-boolean verdicts are accepted', () => {
  assert.equal(normalizeVerdict({ satisfied: true, evidence: 'MRP  35/-', reason: 'MRP is printed.' }, RULE).status, 'pass')
  assert.equal(normalizeVerdict({ satisfied: 'false', evidence: '', reason: 'No MRP line in the text.' }, RULE).status, 'fail')
})

test('reasons are trimmed to one short sentence and evidence is clipped', () => {
  const long = 'The label states MRP. ' + 'This should have been dropped entirely because it is a second sentence. '.repeat(4)
  const v = normalizeVerdict({ satisfied: true, evidence: 'x'.repeat(900), reason: long }, RULE)
  assert.ok(v.reason.split(/(?<=[.!?])\s/)[0] === 'The label states MRP.')
  assert.ok(v.evidence.length <= 300)
})

test('unavailableRow never reports a pass', () => {
  const row = unavailableRow(RULE)
  assert.equal(row.status, 'unknown')
  assert.equal(row.reason, 'check unavailable')
  assert.equal(row.checked, false)
})

/* ------------------------- parse of model replies ------------------------ */

test('parseJsonObject survives code fences and surrounding prose', () => {
  assert.deepEqual(parseJsonObject('{"a":1}'), { a: 1 })
  assert.deepEqual(parseJsonObject('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseJsonObject('Sure! Here it is:\n{"a":{"b":2},\n"x":"y"}\nHope that helps.'), {
    a: { b: 2 },
    x: 'y',
  })
  assert.equal(parseJsonObject('no json here'), null)
  assert.equal(parseJsonObject('{"unbalanced": '), null)
})

/* ----------------------------- graceful failure -------------------------- */

const RULES = [
  { id: 'a', name: 'A', section: 'Rule 6', description: 'The package must declare A.' },
  { id: 'b', name: 'B', section: 'Rule 6', description: 'The package must declare B.' },
]

test('an API error marks that rule "check unavailable", other rules still resolve', async () => {
  const rows = await checkAllRules(OCR, {
    rules: RULES,
    complete: async ({ prompt }) => {
      if (prompt.includes('declare A')) throw new Error('HTTP 503 upstream')
      return '{"ruleId":"b","satisfied":true,"evidence":"MFD 06/2024","reason":"A date is printed."}'
    },
  })
  const a = rows.find((r) => r.id === 'a')
  const b = rows.find((r) => r.id === 'b')
  assert.equal(a.status, 'unknown')
  assert.match(a.reason, /^check unavailable/)
  assert.equal(b.status, 'pass')
})

test('a timeout is treated as "not sure", not as a pass', async () => {
  const err = Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' })
  const rows = await checkAllRules(OCR, { rules: RULES, complete: async () => { throw err } })
  assert.deepEqual(summarize(rows), { total: 2, pass: 0, fail: 0, unknown: 2 })
  assert.match(rows[0].reason, /timed out/)
})

test('a missing API key produces "check unavailable" and sends nothing', async () => {
  let calls = 0
  const rows = await checkAllRules(OCR, {
    rules: RULES,
    complete: async () => {
      calls += 1
      throw new MissingKeyError('no key')
    },
  })
  assert.equal(calls, RULES.length, 'each rule attempts exactly one call, then gives up')
  assert.ok(rows.every((r) => r.status === 'unknown' && r.reason === 'check unavailable'))
})

test('empty OCR text is refused instead of being checked as if valid', async () => {
  const rows = await checkAllRules('   ', { rules: RULES, complete: async () => ({ satisfied: true }) })
  assert.ok(rows.every((r) => r.status === 'unknown' && /no label text/.test(r.reason)))
})

test('malformed model output becomes "not sure" rather than a crash', async () => {
  const rows = await checkAllRules(OCR, { rules: RULES, complete: async () => 'sorry, I cannot answer' })
  assert.ok(rows.every((r) => r.status === 'unknown'))
})

test('onResult streams rows in as they finish', async () => {
  const seen = []
  await checkAllRules(OCR, {
    rules: RULES,
    complete: async ({ prompt }) => {
      if (prompt.includes('declare B')) return '{"ruleId":"b","satisfied":false,"evidence":"","reason":"No B line found."}'
      return '{"ruleId":"a","satisfied":true,"evidence":"Net Qty: 500 g","reason":"A is printed."}'
    },
    onResult: (row, done, total) => seen.push([row.id, done, total]),
  })
  assert.equal(seen.length, 2)
  assert.deepEqual(seen.map((s) => s[2]), [2, 2])
  assert.deepEqual(seen.map((s) => s[1]).sort(), [1, 2])
})
