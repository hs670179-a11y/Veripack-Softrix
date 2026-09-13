/**
 * The single place the Gemini API is called (Module 2 rule checks + Module 3 vision check).
 *
 * - The API key is read from import.meta.env only. It is never hardcoded and never logged.
 * - No `@google/genai` SDK: the stack spec pins axios as the HTTP client, and the REST shape
 *   below was verified against https://ai.google.dev/gemini-api/docs on 2026-09-14
 *   (endpoint v1beta/models/<model>:generateContent, auth header x-goog-api-key).
 * - Structured-output config is deliberately NOT used. Google's docs currently show two
 *   different field spellings for it (the newer `generationConfig.responseFormat.text.schema`
 *   and the older `responseMimeType` / `responseSchema`), so a hardcoded field name is a
 *   silent breakage risk for a hackathon MVP. Instead we demand JSON in the prompt and parse
 *   it defensively in parseJsonObject(). Same result, smaller API surface.
 */
import axios from 'axios'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * Vite injects `import.meta.env`, so the key is read as import.meta.env.VITE_GEMINI_API_KEY and
 * is never written into source. The `?? {}` fallback only exists so these modules stay
 * importable from plain Node when the unit tests run.
 */
const ENV = import.meta.env ?? {}

/** Verified current default at build time (2026-09-14). Override with VITE_GEMINI_MODEL. */
export const DEFAULT_MODEL = 'gemini-3.8-flash'

export function getModel() {
  return String(ENV.VITE_GEMINI_MODEL || DEFAULT_MODEL).trim()
}

export function getApiKey() {
  return String(ENV.VITE_GEMINI_API_KEY || '').trim()
}

export function hasApiKey() {
  return getApiKey().length > 0
}

export class MissingKeyError extends Error {}

/**
 * @param {object} opts
 * @param {string} opts.prompt            Full instruction text (rule text + OCR text).
 * @param {{base64: string, mimeType: string}} [opts.image]  Optional image for the vision check.
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<string>} model output, expected to be one JSON object.
 * @throws {MissingKeyError} when no key is configured.
 */
export async function complete({ prompt, image, timeoutMs = 30_000 }) {
  const key = getApiKey()
  if (!key) {
    throw new MissingKeyError(
      'VITE_GEMINI_API_KEY is not set. Add it to .env (and to Vercel environment variables) to run the rule checks.',
    )
  }

  const parts = []
  if (image?.base64) {
    // Field naming follows the REST docs' `inline_data` form (proto JSON accepts both).
    parts.push({ inline_data: { mime_type: image.mimeType || 'image/jpeg', data: image.base64 } })
  }
  parts.push({ text: prompt })

  const url = `${API_BASE}/${getModel()}:generateContent`
  const { data } = await axios.post(
    url,
    {
      contents: [{ role: 'user', parts }],
      // temperature 0: we want a deterministic read of the evidence, not creative labelling.
      generationConfig: { temperature: 0 },
    },
    {
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      timeout: timeoutMs,
      // Everything is discarded; nothing is persisted or forwarded.
      maxRedirects: 0,
      transitional: { silentJSONParsing: true },
    },
  )

  const candidate = data?.candidates?.[0]
  const partsOut = candidate?.content?.parts ?? []
  const text = partsOut.map((p) => p?.text ?? '').join('').trim()

  if (!text) {
    const blocked = data?.promptFeedback?.blockReason
    throw new Error(blocked ? `Model returned no text (blocked: ${blocked}).` : 'Model returned no text.')
  }
  return text
}

/**
 * Pull the first JSON object out of a model reply. Models frequently wrap it in ``` fences or
 * add a sentence, so we scan for a balanced object rather than assuming the body is pure JSON.
 * Returns null instead of throwing — callers turn null into "insufficient evidence".
 */
export function parseJsonObject(text) {
  const raw = String(text ?? '').trim()
  const candidates = []

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) candidates.push(fenced[1].trim())
  candidates.push(raw)

  const balanced = extractBalancedObject(raw)
  if (balanced) candidates.push(balanced)

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {
      /* try next */
    }
  }
  return null
}

function extractBalancedObject(text) {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}
