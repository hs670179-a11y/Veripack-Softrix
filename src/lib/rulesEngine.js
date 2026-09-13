/**
 * Module 2 — Legal Metrology rule engine.
 *
 * Governance rule for this file: the model is a *reader*, never a lawyer. It is allowed to say
 * only what the quoted label text shows. Anything it cannot see in the text must come back as
 * "insufficient_evidence". Errors, timeouts and a missing API key are also mapped to
 * "insufficient_evidence" with reason "check unavailable" — a check that did not run is never a pass.
 */
import defaultRules from '../data/rules.json' with { type: 'json' }
import { complete, parseJsonObject, MissingKeyError } from './gemini.js'

const RULE_TIMEOUT_MS = 30_000
const MAX_REASON_WORDS = 30
/** Model replies longer than this are treated as noise, not evidence. */
const MAX_EVIDENCE_CHARS = 300

/**
 * The instruction that keeps verdicts grounded in retrieved evidence. Read this function to
 * audit the guarantee: it names the evidence set explicitly (LABEL TEXT only), forbids outside
 * knowledge, and makes "insufficient_evidence" the default answer when the text is unclear.
 */
export function buildRulePrompt(rule, ocrText) {
  const label = String(ocrText ?? '').trim()
  return [
    'You are checking ONE declaration rule from India\'s Legal Metrology (Packaged Commodities) Rules, 2011 against the text of ONE product label.',
    '',
    `RULE TO CHECK — ${rule.name} (${rule.section})`,
    `Rule text: "${rule.description}"`,
    '',
    'LABEL TEXT — the text below was read off a photograph of the label by OCR. It may contain spelling, spacing or line-break errors. It may be only part of the label.',
    '<<<LABEL_TEXT',
    label,
    'LABEL_TEXT>>>',
    '',
    'HOW TO ANSWER — follow every instruction:',
    '1. Use ONLY the text inside LABEL_TEXT. Do not use general knowledge about this product, brand, category, price, or about what labels usually print. Do not treat "this is normally on a label" as evidence that it is on this label.',
    '2. The RULE TEXT above is not evidence. Only LABEL_TEXT counts.',
    '3. Set satisfied to true ONLY when you can quote the required declaration from LABEL_TEXT. Copy that wording exactly into "evidence", keeping the OCR spelling as it is.',
    '4. Set satisfied to false ONLY when LABEL_TEXT is readable and complete enough that you can confirm the required declaration is absent.',
    '5. Set satisfied to "insufficient_evidence" whenever the text is short, garbled, cut off, ambiguous, or when the detail could be on a part of the pack not photographed. When in doubt, always choose "insufficient_evidence". Guessing in either direction is wrong.',
    '6. OCR tolerance: obvious scanner damage inside an otherwise exact match (for example "MRP  35/-" for "MRP Rs.35/-", or "l" for "1") still counts as the declaration being present. Never repair a missing declaration, and never merge unrelated words into one.',
    '7. If the RULE TEXT makes the requirement conditional (for example "for imported goods"), and LABEL_TEXT shows the condition does not apply (for example "Made in India", or an Indian manufacturer address), set satisfied to true, quote that text as evidence, and say in "reason" that the rule was checked as not applicable rather than as satisfied by a missing declaration.',
    '8. "reason" must be one plain sentence of at most 25 words for a rural Indian consumer: state what was found or not found in the label text. No legal advice, no penalty talk, and never describe the product as safe, good, genuine, fake or counterfeit.',
    '9. "evidence" must be a verbatim snippet from LABEL_TEXT, or an empty string when you found nothing to quote.',
    '',
    'Reply with ONLY this single JSON object — no markdown, no explanation outside it:',
    `{"ruleId":"${rule.id}","satisfied":true,"evidence":"verbatim text or empty string","reason":"one plain sentence"}`,
    '',
    'In that JSON, "satisfied" must be true, false, or the exact string "insufficient_evidence".',
  ].join('\n')
}

/**
 * Map whatever the model said onto a verdict, refusing to report a pass that has no quote.
 * @returns {{status:'pass'|'fail'|'unknown', evidence:string, reason:string}}
 */
export function normalizeVerdict(parsed, rule) {
  if (!parsed || typeof parsed !== 'object') {
    return {
      status: 'unknown',
      evidence: '',
      reason: 'The checker replied in a form that could not be read, so this rule was not verified.',
    }
  }
  const status = verdictOf(parsed.satisfied)
  let evidence = clipText(parsed.evidence, MAX_EVIDENCE_CHARS)
  const reason = clipText(firstSentence(parsed.reason, MAX_REASON_WORDS), 200)

  // Guard: a "pass" that quotes nothing is not evidence-backed, so it must not be reported as a pass.
  if (status === 'pass' && evidence.trim() === '') {
    return {
      status: 'unknown',
      evidence: '',
      reason: 'The checker reported the declaration as present but quoted no label text, so it is not verified.',
    }
  }
  if (status === 'unknown' && !reason) {
    return { status: 'unknown', evidence: '', reason: 'The checker could not decide from the label text.' }
  }
  return { status, evidence, reason: reason || fallbackReason(status, rule) }
}

function verdictOf(value) {
  if (value === true) return 'pass'
  if (value === false) return 'fail'
  const v = String(value ?? '')
    .trim()
    .toLowerCase()
  if (v === 'true') return 'pass'
  if (v === 'false') return 'fail'
  return 'unknown' // includes 'insufficient_evidence', null, and anything unrecognised
}

function fallbackReason(status, rule) {
  if (status === 'pass') return `Label text quotes the ${rule.name.toLowerCase()} declaration.`
  if (status === 'fail') return `No ${rule.name.toLowerCase()} declaration appears in the readable label text.`
  return 'The label text was not clear enough to check this rule.'
}

function clipText(value, max) {
  const s = String(value ?? '')
    .replace(/```/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function firstSentence(value, maxWords) {
  const s = String(value ?? '').trim()
  if (!s) return ''
  const first = s.split(/(?<=[.!?])\s+/)[0] || s
  const words = first.split(/\s+/)
  return words.length > maxWords ? `${words.slice(0, maxWords).join(' ')}…` : words.join(' ')
}

/** A row that never reached the model, or reached it and failed: always ⚠️, never ✅. */
export function unavailableRow(rule, reason = 'check unavailable') {
  return {
    id: rule.id,
    name: rule.name,
    section: rule.section,
    description: rule.description,
    status: 'unknown',
    evidence: '',
    reason,
    checked: false,
    prompt: '',
  }
}

function toRow(rule, ocrText, parsed) {
  const verdict = normalizeVerdict(parsed, rule)
  return {
    id: rule.id,
    name: rule.name,
    section: rule.section,
    description: rule.description,
    status: verdict.status,
    evidence: verdict.evidence,
    reason: verdict.reason,
    checked: true,
    prompt: buildRulePrompt(rule, ocrText),
  }
}

/**
 * Run all 7 rule checks in parallel.
 * @param {string} ocrText
 * @param {object} [options]
 * @param {Array}  [options.rules]        Injectable for tests; defaults to src/data/rules.json.
 * @param {Function} [options.complete]   Injectable LLM call; defaults to lib/gemini.complete.
 * @param {(row: object, done: number, total: number) => void} [options.onResult]
 */
export async function checkAllRules(ocrText, { rules = defaultRules, complete: callModel = complete, onResult } = {}) {
  const text = String(ocrText ?? '').trim()
  const rows = new Array(rules.length)
  let done = 0

  await Promise.all(
    rules.map(async (rule, index) => {
      let row
      if (text === '') {
        row = unavailableRow(rule, 'no label text to check')
      } else {
        try {
          const raw = await callModel({ prompt: buildRulePrompt(rule, text), timeoutMs: RULE_TIMEOUT_MS })
          row = toRow(rule, text, parseJsonObject(raw))
        } catch (err) {
          // A missing key or a failed call is reported as "not sure", never as a pass.
          const reason = err instanceof MissingKeyError ? 'check unavailable' : `check unavailable (${shortError(err)})`
          row = unavailableRow(rule, reason)
        }
      }
      rows[index] = row
      done += 1
      onResult?.(row, done, rules.length)
    }),
  )

  return rows
}

function shortError(err) {
  const status = err?.response?.status
  if (status) return `API ${status}`
  if (err?.code === 'ECONNABORTED') return 'timed out'
  const msg = String(err?.message || 'error').split('\n')[0]
  return msg.length > 48 ? `${msg.slice(0, 47)}…` : msg
}

/** Summary counts for the section header, e.g. "6/7 satisfied". */
export function summarize(rows) {
  const list = Array.isArray(rows) ? rows : []
  return {
    total: list.length,
    pass: list.filter((r) => r.status === 'pass').length,
    fail: list.filter((r) => r.status === 'fail').length,
    unknown: list.filter((r) => r.status === 'unknown').length,
  }
}

export { defaultRules }
