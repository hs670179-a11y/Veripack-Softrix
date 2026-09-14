/**
 * Module 1 — client-side OCR via Tesseract.js.
 *
 * Privacy: the image is read in the browser and never uploaded to our server (there is no
 * server). What the browser does download is engine code and letter-shape data — never the
 * user's photo, and no label pixels or extracted text leave the device except in the explicit
 * Gemini call in lib/gemini.js.
 *
 * Both downloads can come from our own origin: the `eng` model is committed in public/tesseract,
 * and `npm run vendor:ocr` drops the WASM engine beside it. This file detects that and prefers it;
 * with nothing vendored, the engine comes from the CDN tesseract.js uses by default.
 */
import { createWorker } from 'tesseract.js'

/**
 * Photo sizing for the scanner, learned the hard way on real photos: at 250–400 px wide Tesseract
 * drops whole declarations (confidence 75–87%, i.e. *above* the low-confidence gate), which then reads
 * as "the label is missing this". Interpolating up to ~900 px recovered every field (conf 90–91).
 * Oversized photos are shrunk to 1600 px, which is both enough for the text and kinder to memory.
 */
export const OCR_MAX_EDGE = 1600
export const OCR_MIN_EDGE = 900

/** Below this word count the OCR output is treated as unusable, not as "no declarations". */
export const MIN_USABLE_WORDS = 4
/**
 * …and below this many letters/digits it is unusable too. Punctuation-only scanner noise (" . , - |")
 * can clear a word count while containing nothing to read, which would then be reported as
 * "declarations are missing" — the mistake this line exists to prevent.
 */
export const MIN_USABLE_CHARS = 12
/** Tesseract mean confidence (0-100) under which we warn before doing anything with the text. */
export const LOW_CONFIDENCE_THRESHOLD = 55

const STAGE_LABELS = {
  'loading tesseract core': 'Loading the reader',
  'initializing tesseract': 'Starting the reader',
  'loading language traineddata': 'Loading Hindi/Latin letter shapes',
  'initializing api': 'Getting ready',
  'recognizing text': 'Reading the label',
}

/**
 * The English language model is served from our own origin (public/tesseract, ~2.9 MB gzipped) so a
 * first scan does not depend on a third-party host — which matters on a slow or filtered rural
 * network, and keeps the privacy story simple: the only OCR download is from VeriPack itself.
 */
const SELF_HOSTED_LANG = '/tesseract'

/**
 * `npm run vendor:ocr` writes this manifest; reading it is how we know the engine files are there too.
 * One small JSON request instead of probing three multi-megabyte URLs, and the `kind` marker means a
 * stray file of the same name cannot make the app load a half-written bundle.
 */
const ENGINE_MANIFEST = '/tesseract/engine.json'
/** The manifest kind scripts/vendor-ocr.mjs writes — kept in sync by tests/tooling.test.mjs. */
const ENGINE_MANIFEST_KIND = 'veripack-ocr-engine'
/** A directory, because tesseract.js appends `tesseract-core[-simd]-lstm.wasm.js` itself. */
const SELF_HOSTED_CORE = '/tesseract/core'
const SELF_HOSTED_WORKER = '/tesseract/worker.min.js'

/** Copy of `options` without `keys`. */
function without(options, keys) {
  const next = { ...options }
  for (const key of keys) delete next[key]
  return next
}

/**
 * Which tesseract.js options to use, given what our own origin turned out to serve.
 *
 * Pure and exported on purpose: this is the code that decides whether a phone loads its OCR engine
 * from VeriPack or from a CDN, and a wrong answer means either a needless third-party request or a
 * worker that never starts. Both are invisible until someone is standing in front of a queue.
 *
 * @param {{manifest: unknown, logger?: unknown, langPath?: string|null, cacheMethod?: string}} input
 * @returns {{options: Record<string, unknown>, engine: {workerPath: string, corePath: string}|null}}
 */
export function ocrWorkerOptions({ manifest, logger, langPath = SELF_HOSTED_LANG, cacheMethod = 'readWrite' }) {
  const engine = manifest?.kind === ENGINE_MANIFEST_KIND ? { workerPath: SELF_HOSTED_WORKER, corePath: SELF_HOSTED_CORE } : null
  return {
    engine,
    options: {
      // cacheMethod only ever caches the language model / engine files, never anything about the scan.
      cacheMethod,
      // tesseract.js rejects a present-but-non-function logger, so the key is added only when usable.
      ...(typeof logger === 'function' ? { logger } : {}),
      ...(langPath ? { langPath, gzip: true } : {}),
      ...(engine ?? {}),
    },
  }
}

/**
 * The retry ladder, most self-hosted first: drop the vendored engine (a directory that exists but was
 * only half written), then the self-hosted language file (an incomplete deploy). Every rung still reads
 * labels — it just uses the hosts tesseract.js ships with. No rung sends anything about the photo.
 *
 * @param {Record<string, unknown>} options
 * @param {{hasEngine?: boolean, hasLangPath?: boolean}} used
 * @returns {Record<string, unknown>[]}
 */
export function ocrRetryRungs(options, { hasEngine = false, hasLangPath = false } = {}) {
  const rungs = []
  if (hasEngine) rungs.push(without(options, ['workerPath', 'corePath']))
  if (hasLangPath) rungs.push(without(rungs.at(-1) ?? options, ['langPath', 'gzip']))
  return rungs
}

let engineProbe

/** The manifest for this origin, fetched once per page load; `null` means "use CDN defaults". */
function readVendoredEngineManifest() {
  // Node (the test runner) has no same-origin directory to probe and takes its engine from node_modules.
  if (typeof window === 'undefined') return Promise.resolve(null)
  engineProbe ??= fetch(ENGINE_MANIFEST)
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
  return engineProbe
}

/**
 * @param {(m: {status: string, progress: number}) => void} [logger]
 * @param {{langPath?: string|null, cacheMethod?: string, manifest?: unknown}} [overrides]
 *   `manifest` lets the Node-side test run (and any caller) state what the origin serves instead of
 *   asking; leave it out in the browser and this file works it out for itself.
 */
export async function createOcrWorker(logger, { langPath = SELF_HOSTED_LANG, cacheMethod = 'readWrite', manifest } = {}) {
  const whatOriginServes = manifest === undefined ? await readVendoredEngineManifest() : manifest
  const { options, engine } = ocrWorkerOptions({ manifest: whatOriginServes, logger, langPath, cacheMethod })
  try {
    return await createWorker('eng', 1, options)
  } catch (err) {
    for (const rung of ocrRetryRungs(options, { hasEngine: !!engine, hasLangPath: !!langPath })) {
      try {
        return await createWorker('eng', 1, rung)
      } catch {
        /* try the next rung, then report the original error */
      }
    }
    throw err
  }
}


/**
 * @param {File|Blob|string} image  The user's photo (File/Blob preferred; a data URL also works).
 * @param {(pct: number, stage: string) => void} [onProgress]
 * @returns {Promise<{text: string, confidence: number, wordCount: number, status: 'ok'|'low-confidence'|'failed', message?: string}>}
 */
export async function readLabel(image, onProgress) {
  const logger = (m) => {
    if (!onProgress) return
    const pct = typeof m.progress === 'number' ? Math.round(m.progress * 100) : 0
    onProgress(pct, STAGE_LABELS[m.status] || 'Reading the label')
  }

  let worker
  try {
    worker = await createOcrWorker(logger)
  } catch (err) {
    return {
      text: '',
      confidence: 0,
      wordCount: 0,
      status: 'failed',
      message: `Could not start the text reader (${err?.message || 'network problem'}). Check your internet connection and try again.`,
    }
  }

  try {
    const { data } = await worker.recognize(image)
    return judgeOcr(data?.text, data?.confidence)
  } catch (err) {
    return {
      text: '',
      confidence: 0,
      wordCount: 0,
      status: 'failed',
      message: `Reading failed (${err?.message || 'unknown error'}). Try a clearer, well-lit photo.`,
    }
  } finally {
    try {
      await worker.terminate()
    } catch {
      /* worker already gone */
    }
  }
}

/** Collapse the OCR noise that breaks regexes: smart quotes, ligatures, run-together spaces. */
/**
 * The decision every caller depends on: is this OCR output usable, merely poor, or not readable at
 * all? Kept separate from the worker so the app, the tests and the fixtures all judge a photo by the
 * same rules — a look-alike threshold in a test would hide exactly the regressions we care about.
 * @returns {{text:string, confidence:number, wordCount:number, status:'ok'|'low-confidence'|'failed', message?:string}}
 */
export function judgeOcr(rawText, rawConfidence) {
  const text = cleanOcrText(rawText || '')
  const wordCount = countWords(text)
  const confidence = clampPercent(rawConfidence)

  const meaningfulChars = (text.match(/[A-Za-z0-9]/g) || []).length
  if (wordCount < MIN_USABLE_WORDS || meaningfulChars < MIN_USABLE_CHARS) {
    return {
      text,
      confidence,
      wordCount,
      status: 'failed',
      message:
        meaningfulChars === 0
          ? 'No readable text found in this photo.'
          : 'Too little text could be read from this photo, so the result cannot be trusted.',
    }
  }

  if (confidence < LOW_CONFIDENCE_THRESHOLD) {
    return {
      text,
      confidence,
      wordCount,
      status: 'low-confidence',
      message: `The photo was hard to read (confidence ${confidence}%). Blurry, dark, curved or cut-off labels cause this.`,
    }
  }

  return { text, confidence, wordCount, status: 'ok' }
}

export function cleanOcrText(raw) {
  return String(raw)
    .replace(/\r\n/g, '\n')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/-{2,}/g, '-')
    .trim()
}

export function countWords(text) {
  const t = String(text).trim()
  return t === '' ? 0 : t.split(/\s+/).length
}

function clampPercent(n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v < 0) return 0
  return Math.min(100, Math.round(v))
}

/** Phones return 12 MP photos; Tesseract is both faster and slightly more accurate near this size. */

/**
 * How big the scanner's copy of the photo should be. Pure (no canvas), so it can be asserted in
 * plain Node — see tests/ocrPlan.test.mjs for the measurements behind the numbers.
 * @returns {{width:number, height:number, scale:number}|null} null when the size is unknown
 */
export function planOcrSize(width, height) {
  const longest = Math.max(width || 0, height || 0)
  if (!longest) return null
  if (longest > OCR_MAX_EDGE) {
    const scale = OCR_MAX_EDGE / longest
    return { width: Math.round(width * scale), height: Math.round(height * scale), scale }
  }
  if (longest < OCR_MIN_EDGE) {
    const scale = Math.min(2, OCR_MIN_EDGE / longest) // interpolate up, but never beyond 2×
    return { width: Math.round(width * scale), height: Math.round(height * scale), scale }
  }
  return { width, height, scale: 1 }
}

/**
 * Read a picked File into two copies: a colour `dataUrl` (preview + the Module 3 vision check) and a
 * greyscale, re-sized `ocrDataUrl` for Tesseract. Oversized shots are shrunk so a 12 MP photo does
 * not take a minute to read on a cheap phone; small ones are interpolated up so the scanner does not
 * silently drop whole lines of print. Falls back to the original bytes if canvas work is unavailable.
 * @param {File} file
 * @returns {Promise<{dataUrl: string, base64: string, mimeType: string, width: number, height: number, ocrDataUrl: string}>}
 */
export function loadImageData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not open this image file.'))
    reader.onload = async () => {
      const original = String(reader.result)
      let width = 0
      let height = 0
      try {
        const dims = await measure(original)
        width = dims.width
        height = dims.height
      } catch {
        /* dimensions only feed a soft hint and the resize decision, so failure is not fatal */
      }

      const mimeType = (file.type || 'image/jpeg').split(';')[0]
      const plan = planOcrSize(width, height)

      // Preview and the vision check need colour — a leak or a discoloured seam is a colour
      // judgement — but not pixels beyond what a model can use, so shrink only.
      // The scanner gets its own greyscale copy, allowed to grow, because small print disappears.
      let dataUrl = original
      let ocrDataUrl = original
      if (plan) {
        try {
          if (plan.scale < 1) dataUrl = await redraw(original, plan.width, plan.height, { grayscale: false })
          ocrDataUrl = await redraw(original, plan.width, plan.height, { grayscale: true })
        } catch {
          /* keep the original bytes — a worse read is better than no read */
        }
      }

      const commaAt = dataUrl.indexOf(',')
      resolve({
        dataUrl,
        base64: dataUrl.slice(commaAt + 1),
        mimeType: dataUrl === original ? mimeType : 'image/jpeg',
        width,
        height,
        ocrDataUrl,
      })
    }
    reader.readAsDataURL(file)
  })
}

/** @param {{grayscale?: boolean}} opts greyscale for the scanner, colour for preview and the vision model */
function redraw(dataUrl, width, height, { grayscale = false } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, width, height)
        if (grayscale) ctx.filter = 'grayscale(1)' // ignored where unsupported, which is harmless
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', 0.92))
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = () => reject(new Error('decode failed'))
    img.src = dataUrl
  })
}


function measure(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('decode failed'))
    img.src = dataUrl
  })
}
