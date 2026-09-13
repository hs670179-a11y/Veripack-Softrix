/**
 * Module 3 — Authenticity & Quality Assurance (credential verification).
 *
 * What this module does: it compares what the label DECLARES against (a) date arithmetic, and
 * (b) a small, clearly-labelled DEMO dataset of registry records. That is all.
 *
 * Governance rule, do not relax it: this module must never claim that a product is fake.
 * That screening capability needs brand data this project does not have.
 * All this module does is verify a declared credential, so every string here and in the UI says
 * "credential verification" and reports only what the label itself declared.
 *
 * Everything here is deterministic pure logic except checkVisualCondition(), so it can be unit
 * tested without any network access.
 */
import fssaiData from '../data/fssaiSampleData.json' with { type: 'json' }
import gs1Data from '../data/gs1SampleData.json' with { type: 'json' }
import bisData from '../data/bisSampleData.json' with { type: 'json' }
import { complete, parseJsonObject, hasApiKey } from './gemini.js'

/** Within this many days of expiry a pack is flagged as "use it up soon". */
export const NEAR_EXPIRY_DAYS = 90

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
}

const EXPIRY_HINT = /(?:^|[^a-z0-9])(exp\w*|best\s*before|use\s*by|use\s*before|valid\w*|consume\w*)/i
const MANUFACTURE_HINT =
  /(?:^|[^a-z0-9])(mfd|mfg|manufactur\w*|produce\w*|packed|packing|bottled|import\w*|date\s*of\s*(?:manufactur|packing|production))/i

/* ------------------------------------------------------------------ *
 * shared text helpers
 * ------------------------------------------------------------------ */

function norm(text) {
  // OCR often splits "1001 8021 0005 57" or writes "1001/8021". Keep a spaced copy for
  // display and a digit-collapsed copy only for number-shape matching.
  return String(text ?? '').replace(/\u00a0/g, ' ')
}

/** 30 chars of text before a match, used to read the printed keyword that labels a number. */
function contextBefore(text, index, span = 60) {
  return text.slice(Math.max(0, index - span), index)
}

function unique(values) {
  const seen = new Set()
  const out = []
  for (const v of values) {
    const key = JSON.stringify(v)
    if (!seen.has(key)) {
      seen.add(key)
      out.push(v)
    }
  }
  return out
}

function monthName(m) {
  const names = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  return names[m - 1] || ''
}

function fmtMonthYear({ month, year }) {
  if (!year) return ''
  return month ? `${monthName(month)} ${year}` : String(year)
}

function fmtDay(d) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
}

function daysBetween(a, b) {
  const MS = 24 * 60 * 60 * 1000
  return Math.round((Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()) -
    Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())) / MS)
}

/* ------------------------------------------------------------------ *
 * 3.1  Expiry / freshness  —  pure date math, no external dependency
 * ------------------------------------------------------------------ */

/**
 * Find every printed date and classify it from the keyword that sits in front of it.
 * @returns {Array<{kind:'expiry'|'manufacture'|'unspecified', raw:string, month?:number, year:number, day?:number, readAs:string}>}
 */
export function findDateCandidates(text) {
  const src = norm(text)
  const found = []
  /** Ranges already claimed, so one printed date is never counted twice in two formats. */
  const taken = []
  const claim = (start, end) => {
    if (taken.some(([s, e]) => start < e && end > s)) return false
    taken.push([start, end])
    return true
  }
  const add = (start, end, fields) => {
    if (!claim(start, end)) return
    found.push(makeCandidate(src, start, fields))
  }

  // "JUN 2026", "JUN./26", "JUNE 2027" — month-name forms are the least ambiguous, so they go first.
  for (const m of src.matchAll(/\b([A-Za-z]{3,9})\.?\s*[/.-]\s*(\d{4}|\d{2})\b|\b([A-Za-z]{3,9})\.?\s+(\d{4}|\d{2})\b/g)) {
    const name = (m[1] || m[3] || '').toLowerCase().replace(/\.$/, '')
    const yearRaw = m[2] || m[4]
    const month = MONTHS[name]
    const year = month ? expandYear(yearRaw) : null
    if (!month || !year) continue
    add(m.index, m.index + m[0].length, { month, year, raw: m[0] })
  }

  // "12 JUN 2026", "12-JUN-26"
  for (const m of src.matchAll(/\b(\d{1,2})\s*[/.-]\s*([A-Za-z]{3,9})\.?\s*[/.-]\s*(\d{4}|\d{2})\b/g)) {
    const month = MONTHS[m[2].toLowerCase().replace(/\.$/, '')]
    const day = Number(m[1])
    const year = month ? expandYear(m[3]) : null
    if (!month || !year || day < 1 || day > 31) continue
    add(m.index, m.index + m[0].length, { day, month, year, raw: m[0] })
  }

  // "12/06/2026" — day/month/year, the Indian printed order.
  for (const m of src.matchAll(/\b(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2,4})(?!\d)/g)) {
    const day = Number(m[1])
    const month = Number(m[2])
    const year = expandYear(m[3])
    if (day < 1 || day > 31 || month < 1 || month > 12 || !year) continue
    add(m.index, m.index + m[0].length, { day, month, year, raw: m[0], note: 'read as DD/MM/YYYY (Indian order)' })
  }

  // "06/2027" or "06/27" — the Rule 6(1)(d) month/year form. A reversed pair is read and flagged.
  for (const m of src.matchAll(/\b(\d{1,2})\s*[/.-]\s*(\d{2,4})(?!\d)/g)) {
    const a = Number(m[1])
    const bRaw = String(m[2])
    const b = Number(bRaw)
    if (bRaw.length === 4 && a >= 1 && a <= 12) {
      add(m.index, m.index + m[0].length, { month: a, year: b, raw: m[0], note: 'read as MM/YYYY' })
    } else if (bRaw.length === 2 && a >= 1 && a <= 12) {
      add(m.index, m.index + m[0].length, { month: a, year: expandYear(bRaw), raw: m[0], note: 'read as MM/YY' })
    } else if (b >= 1 && b <= 12 && bRaw.length <= 2 && a > 12) {
      add(m.index, m.index + m[0].length, { month: b, year: expandYear(m[1]), raw: m[0], note: 'read as MM/YY (order swapped)' })
    }
  }

  // "2027/03" — year first; not a Legal Metrology print style, so the note says it was swapped.
  for (const m of src.matchAll(/\b(\d{4})\s*[/.-]\s*(\d{1,2})(?![\d/.-])/g)) {
    const year = Number(m[1])
    const month = Number(m[2])
    if (month < 1 || month > 12 || year < 1990 || year > 2100) continue
    add(m.index, m.index + m[0].length, { month, year, raw: m[0], note: 'read as YYYY/MM (order swapped)' })
  }

  return unique(found)
}

function makeCandidate(src, index, fields) {
  const ctx = contextBefore(src, index)
  // Whatever comes last before the date decides it: "MFD 06/24" is manufacture, "EXP 06/27" expiry.
  const expiryAt = ctx.search(EXPIRY_HINT)
  const mfgAt = ctx.search(MANUFACTURE_HINT)
  const kind = expiryAt > -1 && expiryAt > mfgAt ? 'expiry' : mfgAt > -1 ? 'manufacture' : 'unspecified'
  return { ...fields, kind, readAs: fmtMonthYear(fields) }
}

function expandYear(raw) {
  const s = String(raw).replace(/[^0-9]/g, '')
  if (s.length === 4) return Number(s)
  if (s.length <= 2) {
    const yy = Number(s)
    if (!Number.isFinite(yy)) return null
    return yy >= 70 ? 1900 + yy : 2000 + yy // 70→1970 per POSIX-style convention
  }
  return null
}

/** Shelf life stated as a duration instead of a date, e.g. "SHELF LIFE 12 MONTHS FROM PACKING". */
export function findShelfLife(text) {
  const src = norm(text).replace(/\s+/g, ' ')
  const m =
    src.match(/\bshelf\s*life\s*(?:of|up\s*to|is|:)?\s*(\d{1,3})\s*(day|month|year)s?\b/i) ||
    src.match(/\b(?:best\s*before|use\s*within|keep\s*well\s*for)\s*(\d{1,3})\s*(day|month|year)s?\s*(?:from|after|of)?/i) ||
    src.match(/\bupto\s*(\d{1,3})\s*(month|year)s?\b/i)
  if (!m) return null
  const count = Number(m[1])
  const unit = m[2].toLowerCase()
  if (!Number.isFinite(count) || count <= 0 || count > 60 * 10) return null
  return { months: unit.startsWith('month') ? count : unit.startsWith('year') ? count * 12 : Math.max(1, Math.round(count / 30)), count, unit, raw: m[0] }
}

function addMonths(date, months) {
  const d = new Date(date.getTime())
  d.setUTCMonth(d.getUTCMonth() + months)
  return d
}

function monthStart({ year, month, day }) {
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1))
}

function monthEnd({ year, month, day }) {
  if (!month) return day ? new Date(Date.UTC(year, 0, 31)) : new Date(Date.UTC(year, 11, 31))
  return new Date(Date.UTC(year, month, 0, 23, 59, 59))
}

/**
 * @returns {{status:'pass'|'fail'|'unknown', reason:string, evidence:string, detail:object}}
 */
export function evaluateExpiry(text, now = new Date()) {
  const candidates = findDateCandidates(text)
  const shelfLife = findShelfLife(text)
  const expiry = candidates.filter((c) => c.kind === 'expiry')
  const manufacture = candidates.filter((c) => c.kind === 'manufacture')
  const unlabelled = candidates.filter((c) => c.kind === 'unspecified')

  const detail = { candidates, shelfLife }

  if (candidates.length === 0) {
    return {
      status: 'unknown',
      reason: 'No date of manufacture or expiry could be read from the label text.',
      evidence: '',
      detail,
    }
  }

  // Prefer an explicit expiry date; else derive one from manufacture + shelf life.
  let expiryDate = null
  let basis = ''
  let evidence = ''

  if (expiry.length > 0) {
    // Use the earliest printed expiry date — that is the one that governs the pack in hand.
    const sorted = [...expiry].sort((a, b) => monthEnd(a) - monthEnd(b))
    expiryDate = monthEnd(sorted[0])
    basis = sorted[0].note || ''
    evidence = String(sorted[0].raw)
  } else if (manufacture.length > 0 && shelfLife) {
    const mfg = [...manufacture].sort((a, b) => monthStart(a) - monthStart(b)).pop()
    expiryDate = addMonths(monthStart(mfg), shelfLife.months)
    basis = `derived from ${fmtMonthYear(mfg)} + ${shelfLife.count} ${shelfLife.unit}${shelfLife.count === 1 ? '' : 's'}`
    evidence = `${mfg.raw} ${shelfLife.raw}`.trim()
  } else if (manufacture.length > 0) {
    const mfg = [...manufacture].sort((a, b) => monthStart(a) - monthStart(b)).pop()
    const ageDays = daysBetween(now, monthStart(mfg))
    if (ageDays < -1) {
      return {
        status: 'fail',
        reason: `Manufacture date is in the future (${fmtMonthYear(mfg)}) — the label cannot be right.`,
        evidence: String(mfg.raw),
        detail,
      }
    }
    return {
      status: 'unknown',
      reason: `Manufacture date read as ${fmtMonthYear(mfg)} (${Math.max(0, Math.round(ageDays / 30))} months old), but no expiry date or shelf life is in the text.`,
      evidence: String(mfg.raw),
      detail,
    }
  } else {
    const first = unlabelled[0]
    return {
      status: 'unknown',
      reason: `A date (${fmtMonthYear(first)}) is printed but the text does not say whether it is the manufacture or expiry date.`,
      evidence: String(first.raw),
      detail,
    }
  }

  const delta = daysBetween(expiryDate, now)
  const shown = basis ? `${fmtDay(expiryDate)}, ${basis}` : fmtDay(expiryDate)

  if (delta < 0) {
    return {
      status: 'fail',
      reason: `Expired ${Math.abs(delta)} day${Math.abs(delta) === 1 ? '' : 's'} ago (expiry ${shown}). Do not buy.`,
      evidence: evidence || shown,
      detail: { ...detail, expiryDate: expiryDate.toISOString(), derived: !expiry.length },
    }
  }
  if (delta <= NEAR_EXPIRY_DAYS) {
    return {
      status: 'unknown',
      reason: `Expires in ${delta} day${delta === 1 ? '' : 's'} (expiry ${shown}) — use it up quickly or ask the shopkeeper.`,
      evidence: evidence || shown,
      detail: { ...detail, expiryDate: expiryDate.toISOString(), derived: !expiry.length },
    }
  }
  return {
    status: 'pass',
    reason: `Not expired — expiry ${shown}, which is ${Math.round(delta / 30)} month${Math.round(delta / 30) === 1 ? '' : 's'} from now.`,
    evidence: evidence || shown,
    detail: { ...detail, expiryDate: expiryDate.toISOString(), derived: !expiry.length },
  }
}

/* ------------------------------------------------------------------ *
 * 3.2  FSSAI licence — 14-digit number vs DEMO dataset
 * ------------------------------------------------------------------ */

/** 14-digit licence numbers: contiguous runs anywhere, plus spaced groups only near a licence keyword. */
export function extractFssaiNumbers(text) {
  const src = norm(text)
  const found = []

  // (a) "10018021000557" — the normal printed form.
  for (const m of src.matchAll(/(?<!\d)\d{14}(?!\d)/g)) {
    const ctx = contextBefore(src, m.index, 90)
    found.push({ digits: m[0], anchored: /fssai|licen|reg\.?\s*no/i.test(ctx) })
  }

  // (b) "1001 8021 0005 57" — OCR and print styles split the number. Only trusted when a licence
  //     keyword sits next to it, otherwise unrelated numbers on the label could merge into 14 digits.
  for (const m of src.matchAll(/(?<!\d)\d(?:[ -]?\d){6,19}(?!\d)/g)) {
    const digits = m[0].replace(/\D/g, '')
    if (digits.length !== 14) continue
    if (found.some((f) => f.digits === digits)) continue
    const ctx = contextBefore(src, m.index, 90) + src.slice(m.index, m.index + 24)
    if (!/fssai|licen|reg\.?\s*no/i.test(ctx)) continue
    found.push({ digits, anchored: true })
  }

  found.sort((a, b) => Number(b.anchored) - Number(a.anchored))
  return unique(found.map((f) => ({ digits: f.digits, anchored: f.anchored })))
}

export function verifyFssaiLicense(text, { sample = fssaiData, now = new Date() } = {}) {
  const numbers = extractFssaiNumbers(text)
  if (numbers.length === 0) {
    return {
      status: 'unknown',
      reason: 'No 14-digit FSSAI licence or registration number appears in the label text.',
      evidence: '',
    }
  }
  const digits = numbers[0].digits
  const match = (sample.licences || []).find((l) => String(l.licenseNumber).replace(/\D/g, '') === digits)

  if (!match) {
    return {
      status: 'unknown',
      reason: `${digits} is not in the demo dataset, so this app cannot verify it. Nothing is being said about the number itself.`,
      evidence: digits,
    }
  }

  const validTo = match.validTo ? new Date(`${match.validTo}T23:59:59Z`) : null
  if (validTo && validTo < now) {
    return {
      status: 'fail',
      reason: `Demo record for ${digits} (${match.businessName}) shows the licence was valid only up to ${match.validTo}, which has passed.`,
      evidence: digits,
    }
  }
  return {
    status: 'pass',
    reason: `Demo record for ${digits}: ${match.businessName}${match.validTo ? ` (valid to ${match.validTo})` : ''}.`,
    evidence: digits,
  }
}

/* ------------------------------------------------------------------ *
 * 3.3  Declaration plausibility  —  SOFT, approximate, never a legal finding
 * ------------------------------------------------------------------ */

const DRY_WORDS = /\b(atta|atka|flour|maida|suji|rava|semolina|rice|chaval|pulses|dal|daal|sugar|cheeni|salt|namak|spice|masala|haldi|mirch|tea|chai|coffee|biscuit|cookies|namkeen|nanakhatai|milk\s*powder|powder|granules|tablet|candy|chocolate|corn)\b/i
const LIQUID_WORDS = /\b(r refining oil|cooking oil|edible oil|mustard oil|sunflower oil|oil|water|juice|milk|doodh|curd|lassi|shikampuri|soft\s*drink|soda|cola|vinegar|phenyl|detergent|dishwash|shampoo|hair\s*oil|syrup|brandy|whisky|beer|liquor)\b/i

/** Net quantity as printed: "Net Qty: 500 g", "500ml", "Contains 12 pieces". */
export function extractNetQuantity(text) {
  const src = norm(text).replace(/\s*\n\s*/g, ' ')
  const weight = src.match(/\b(\d+(?:[.,]\d+)?)\s*(kg|kilogram[s]?|kgs?|g|gm|gms?|gram[s]?)\b/i)
  const volume = src.match(/\b(\d+(?:[.,]\d+)?)\s*(ml|millilitre[s]?|l|litre[s]?|ltr[s]?|liter[s]?)\b/i)
  const count = src.match(/\b(?:contains|no\.?\s*of|net\s*count)\s*:?\s*(\d{1,4})\s*(pieces?|pcs|nos?|units?|tablets?|sachets?)\b/i)

  const pick = (m, kind, unit) =>
    m ? { value: Number(String(m[1]).replace(',', '.')), unit, kind, raw: String(m[0]).trim() } : null

  const anchored = src.match(/\b(?:net\s*(?:qty|quantity|wt|weight|content)|contains)\s*:?\s*([^\n]{0,24})/i)
  const fromAnchor = anchored ? pick(anchored[1].match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|litre[s]?|pieces?|pcs)/i), 'anchored', null) : null

  return (
    pick(weight, 'weight', 'weight') ||
    pick(volume, 'volume', 'volume') ||
    pick(count, 'number', 'count') ||
    fromAnchor ||
    null
  )
}

/**
 * Soft plausibility check on the DECLARED quantity.
 *
 * Deliberate deviation from the build spec, flagged here and in the README: the spec suggested
 * comparing the declared weight against "visual package size" using image dimensions. A single
 * photo carries no scale reference (a 200 g sachet and a 20 kg sack can produce identical pixel
 * sizes), so inferring physical size from pixels would be a fabricated measurement. Instead this
 * check uses two honest signals that need no scale: the unit-vs-commodity contradiction, and a
 * magnitude band. It stays advisory (⚠️) and never returns a legal verdict.
 */
export function checkPlausibility(text, { image = null } = {}) {
  const qty = extractNetQuantity(text)
  if (!qty || !Number.isFinite(qty.value)) {
    return {
      status: 'unknown',
      reason: 'No numeric net quantity could be read, so plausibility cannot be judged.',
      evidence: '',
    }
  }

  const unit = qty.raw.toLowerCase()
  const isWeight = /\b(kg|kgs|kilogram|g|gm|gms|gram)s?\b/.test(unit)
  const isVolume = /\b(ml|millilitre|l|ltr|liter|litre)s?\b/.test(unit)
  const label = norm(text).slice(0, 4000)
  const looksDry = DRY_WORDS.test(label)
  const looksLiquid = LIQUID_WORDS.test(label)
  const grams = isWeight ? (/\bkg\b|kilogram/i.test(unit) ? qty.value * 1000 : qty.value) : null
  const ml = isVolume ? (/\b[l]\b|litre|ltr|liter/i.test(unit) ? qty.value * 1000 : qty.value) : null

  if (qty.value <= 0) {
    return { status: 'unknown', reason: `Declared quantity "${qty.raw}" has no usable number.`, evidence: qty.raw }
  }
  if (grams !== null && (grams < 0.5 || grams > 200_000)) {
    return {
      status: 'unknown',
      reason: `"${qty.raw}" is far outside the usual retail weight range for a packet — please look at the pack. Soft check only.`,
      evidence: qty.raw,
    }
  }
  if (ml !== null && (ml < 1 || ml > 200_000)) {
    return {
      status: 'unknown',
      reason: `"${qty.raw}" is far outside the usual retail volume range for a packet — please look at the pack. Soft check only.`,
      evidence: qty.raw,
    }
  }
  if (qty.kind === 'number' && (qty.value < 1 || qty.value > 5000)) {
    return {
      status: 'unknown',
      reason: `"${qty.raw}" is an unusual piece count for a retail pack — verify on the packet. Soft check only.`,
      evidence: qty.raw,
    }
  }

  if (isVolume && looksDry && !looksLiquid) {
    return {
      status: 'unknown',
      reason: `Dry item declared in volume ("${qty.raw}") while such items are normally sold by weight — check the pack yourself. Soft check, not a rule violation.`,
      evidence: qty.raw,
    }
  }
  if (isWeight && looksLiquid && !looksDry) {
    return {
      status: 'unknown',
      reason: `Liquid declared by weight ("${qty.raw}") — liquids may be sold by weight legally, so verify on the pack. Soft check, not a rule violation.`,
      evidence: qty.raw,
    }
  }

  const sizeNote = image && image.width > 0 && Math.max(image.width, image.height) < 600 ? ' The photo is small, so the reading is less certain.' : ''
  return {
    status: 'pass',
    reason: `Declared quantity "${qty.raw}" is a normal size for a retail packet.${sizeNote} Soft check, not a measurement.`,
    evidence: qty.raw,
  }
}

/* ------------------------------------------------------------------ *
 * 3.4  Visual packaging condition — one Gemini vision call
 * ------------------------------------------------------------------ */

const VISION_PROMPT = [
  'You are looking at ONE photograph of a packaged product. Report only physical packaging condition that is visible in this photo.',
  '',
  'Answer these three questions:',
  '- Is the package surface visibly torn, punctured, cut, split open, crushed, leaking, or bulging?',
  '- Is a seal, cap seal, tape, stitch line, or tamper-evident band missing, broken, or already opened?',
  '- Is the photographed area too blurry, dark, cropped, or out of frame to judge?',
  '',
  'Rules:',
  '1. Describe only what this photo shows. Do not use outside knowledge of the product or brand.',
  '2. Set finding to "none" only when the visible packaging is clearly intact.',
  '3. Set finding to "possible_damage" only when you can point to a specific visible defect; name it in description.',
  '4. Set finding to "insufficient_evidence" whenever the photo does not clearly show the packaging surface. When in doubt, choose "insufficient_evidence".',
  '5. Do not state or hint whether the product is genuine, original, fake or counterfeit — that is out of scope for you.',
  '6. description: one plain sentence of at most 20 words for a rural Indian consumer. No medical or safety advice.',
  '',
  'Reply with ONLY this JSON object, no markdown:',
  '{"finding":"none","description":"one plain sentence"}',
  'where "finding" is one of "none", "possible_damage", "insufficient_evidence".',
].join('\n')

export function normalizeVisual(parsed) {
  const f = String(parsed?.finding ?? '')
    .trim()
    .toLowerCase()
  const description = String(parsed?.description ?? '')
    .replace(/```/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
  if (f === 'none') {
    return { status: 'pass', reason: description || 'No visible damage to the packaging in this photo.', evidence: 'vision check' }
  }
  if (f === 'possible_damage' || f === 'possible damage') {
    return {
      status: 'fail',
      reason: description || 'Something in the photo looks damaged, torn, or opened.',
      evidence: 'vision check',
    }
  }
  return {
    status: 'unknown',
    reason: description || 'The photo does not clearly show the packaging surface, so damage cannot be judged.',
    evidence: '',
  }
}

export async function checkVisualCondition(image, { complete: callModel = complete } = {}) {
  if (!image?.base64) {
    return { status: 'unknown', reason: 'No photo available for this check.', evidence: '' }
  }
  if (!hasApiKey()) {
    return { status: 'unknown', reason: 'check unavailable', evidence: '' }
  }
  try {
    const raw = await callModel({
      prompt: VISION_PROMPT,
      image: { base64: image.base64, mimeType: image.mimeType },
      timeoutMs: 45_000,
    })
    return normalizeVisual(parseJsonObject(raw))
  } catch (err) {
    void err
    return { status: 'unknown', reason: 'check unavailable', evidence: '' }
  }
}

/* ------------------------------------------------------------------ *
 * 3.5  Barcode / GS1 and BIS  —  demo dataset + real check-digit arithmetic
 * ------------------------------------------------------------------ */

/** Standard GTIN/EAN-13 (and UPC-A) check digit. Pure arithmetic, no registry needed. */
export function checkDigitValid(digits) {
  const s = String(digits).replace(/\D/g, '')
  if (s.length !== 13 && s.length !== 12) return null
  const body = s.slice(0, -1)
  const stated = Number(s.slice(-1))
  let sum = 0
  for (let i = 0; i < body.length; i++) {
    // EAN-13: weights 1,3,1,3... from the left. UPC-A: weights 3,1,3,1...
    const weight = s.length === 13 ? (i % 2 === 0 ? 1 : 3) : i % 2 === 0 ? 3 : 1
    sum += Number(body[i]) * weight
  }
  const expected = (10 - (sum % 10)) % 10
  return expected === stated
}

export function extractBarcodes(text) {
  const src = norm(text).replace(/[ \t]/g, ' ')
  const hits = [...src.matchAll(/(?<!\d)(\d{13}|\d{12})(?!\d)/g)].map((m) => m[1])
  return unique(hits.map((d) => ({ digits: d, valid: checkDigitValid(d) })))
}

export function checkBarcode(text, { sample = gs1Data } = {}) {
  const codes = extractBarcodes(text)
  if (codes.length === 0) {
    return {
      status: 'unknown',
      reason: 'No barcode number could be read from the label text.',
      evidence: '',
    }
  }
  const code = codes[0]
  if (code.valid === false) {
    return {
      status: 'fail',
      reason: `The barcode digits ${code.digits} fail the GS1 check-digit test, so the number as printed cannot be a valid code (recheck the photo).`,
      evidence: code.digits,
    }
  }

  const prefix3 = code.digits.slice(0, 3)
  const inIndiaRange = (sample.gs1PrefixRanges || []).some((r) => r.range === prefix3)
  const company = (sample.sampleCompanies || []).find((c) => code.digits.startsWith(String(c.prefix)))
  const companyNote = company
    ? ` Demo dataset maps prefix ${company.prefix} to ${company.businessName}.`
    : ' The company behind this prefix is not in the demo dataset, so it cannot be verified.'

  return {
    status: 'pass',
    reason: `Barcode ${code.digits} is a correctly formed ${code.digits.length}-digit code; prefix ${prefix3} is ${inIndiaRange ? 'in the range allocated to India (890–899)' : 'outside the India range (a foreign-issued code is normal for imported goods)'}.${companyNote}`,
    evidence: code.digits,
  }
}

const BIS_PATTERN = /\b(?:isi|bis)\s*(?:mark|licence|lic\.?\s*no\.?|reg\.?\s*no\.?)?\s*[:#-]?\s*([A-Za-z]{0,4}[/-]?\s*\d{4,8})\b|\b(cm\s*\/?\s*l|c)\s*[/-]\s*(\d{5,8})\b|\bIS\s*(\d{3,6})\b/gi

export function extractBisMarks(text) {
  const src = norm(text)
  const out = []
  for (const m of src.matchAll(BIS_PATTERN)) {
    const raw = String(m[0]).replace(/\s+/g, ' ').trim()
    const digits = (m[1] || m[3] || m[4] || '').replace(/\D/g, '')
    if (digits.length >= 3) out.push({ raw, digits })
  }
  return unique(out)
}

export function checkBisMark(text, { sample = bisData } = {}) {
  const marks = extractBisMarks(text)
  if (marks.length === 0) {
    return {
      status: 'unknown',
      reason: 'No ISI/BIS mark number appears in the label text. This is advisory only — BIS marking is not required for every packaged food.',
      evidence: '',
    }
  }
  const mark = marks[0]
  const match = (sample.licences || []).find((l) => String(l.licenceNumber).replace(/\D/g, '').endsWith(mark.digits))
  if (!match) {
    return {
      status: 'unknown',
      reason: `${mark.raw} is not in the demo dataset, so this app cannot verify it. Nothing is being said about the mark itself.`,
      evidence: mark.raw,
    }
  }
  return {
    status: 'pass',
    reason: `Demo record found for ${match.licenceNumber}: ${match.businessName}.`,
    evidence: mark.raw,
  }
}

/* ------------------------------------------------------------------ *
 * orchestration
 * ------------------------------------------------------------------ */

const ROW_META = [
  { id: 'expiry', nameKey: 'checkExpiry', citation: 'Date arithmetic on the label text (no external source)', badge: null },
  { id: 'fssai', nameKey: 'checkFssai', citation: 'FSSAI licence number — demo dataset', badge: 'demo' },
  { id: 'plausibility', nameKey: 'checkPlausibility', citation: 'Soft heuristic on declared quantity', badge: 'soft' },
  { id: 'condition', nameKey: 'checkCondition', citation: 'Gemini vision read of the photo', badge: 'advisory' },
  { id: 'barcode', nameKey: 'checkBarcode', citation: 'GS1 check digit + prefix range (published) — company data from demo dataset', badge: 'demo' },
  { id: 'bis', nameKey: 'checkBis', citation: 'BIS/ISI mark — demo dataset', badge: 'demo' },
]

function row(meta, verdict) {
  return {
    id: meta.id,
    nameKey: meta.nameKey,
    section: meta.citation,
    badges: meta.badge ? [meta.badge] : [],
    status: verdict?.status ?? 'unknown',
    reason: verdict?.reason ?? 'check unavailable',
    evidence: verdict?.evidence ?? '',
    checked: verdict != null,
  }
}

/**
 * Same rule as the legal checks: a photo the scanner could not read may not accuse the pack. Date and
 * number findings come straight off OCR text, so on a low-confidence read a ❌ becomes ⚠️ and a ✅ keeps
 * its place but gains an "unclear photo" tag. The vision row is exempt — it judges the photo itself,
 * not the scanner's transcript of it.
 */
export function capForReadQuality(row, lowConfidence) {
  if (!lowConfidence || row.id === 'condition') return row
  if (row.status === 'fail') {
    return {
      ...row,
      status: 'unknown',
      reason: `The photo was too unclear to rely on this, so it is not being reported as a problem. It looked like: ${lower(row.reason)}`,
    }
  }
  if (row.status === 'pass') return { ...row, badges: [...row.badges, 'unclear'] }
  return row
}

const lower = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t)

/**
 * Runs every Module 3 check. `onResult` lets the UI fill rows as they land.
 * @param {{ocrText: string, image?: object, now?: Date, onResult?: Function}} input
 */
export async function runAuthenticityChecks({ ocrText, image, now = new Date(), onResult, lowConfidence = false } = {}) {
  const text = String(ocrText ?? '').trim()
  const rows = []
  const push = (meta, verdict) => {
    const r = capForReadQuality(row(meta, verdict), lowConfidence)
    rows.push(r)
    onResult?.(r)
    return r
  }

  // 1–3 are local and instant.
  const [expiry, fssai, plaus] = [
    evaluateExpiry(text, now),
    verifyFssaiLicense(text, { now }),
    checkPlausibility(text, { image }),
  ]
  push(ROW_META[0], expiry)
  push(ROW_META[1], fssai)
  push(ROW_META[2], plaus)

  // 4 needs the vision model.
  push(ROW_META[3], await checkVisualCondition(image))

  // 5–6 are local again.
  push(ROW_META[4], checkBarcode(text))
  push(ROW_META[5], checkBisMark(text))

  return rows
}

export { fssaiData, gs1Data, bisData }
