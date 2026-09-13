/**
 * Module 1 — client-side OCR via Tesseract.js.
 *
 * Privacy: the image is read in the browser and never uploaded to our server (there is no
 * server). Tesseract.js pulls its WASM engine + `eng` language data from public CDNs — that is
 * code and model data, not the user's photo; no label pixels and no extracted text are sent
 * anywhere except the explicit Gemini API call in lib/gemini.js.
 */
import { createWorker } from 'tesseract.js'

/** Below this word count the OCR output is treated as unusable, not as "no declarations". */
export const MIN_USABLE_WORDS = 4
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
 * The Tesseract engine code (WASM) still comes from the jsDelivr CDN, the way tesseract.js ships by
 * default; README §"Fully offline OCR" shows how to vendor that too. Either way no label pixels and
 * no extracted text are ever sent to a CDN.
 */
const SELF_HOSTED_LANG = '/tesseract'

/**
 * @param {(m: {status: string, progress: number}) => void} [logger]
 * @param {{langPath?: string|null, cacheMethod?: string}} [overrides] for the Node-side test run
 */
export async function createOcrWorker(logger, { langPath = SELF_HOSTED_LANG, cacheMethod = 'readWrite' } = {}) {
  // cacheMethod only ever caches the language model file, never anything about the scan.
  // tesseract.js rejects a present-but-non-function logger, so the key is added only when used.
  const options = {
    cacheMethod,
    ...(typeof logger === 'function' ? { logger } : {}),
    ...(langPath ? { langPath, gzip: true } : {}),
  }
  try {
    return await createWorker('eng', 1, options)
  } catch (err) {
    if (!langPath) throw err
    try {
      // Self-hosted file missing (incomplete deploy?) → fall back to tesseract.js' default host.
      const { langPath: _lang, gzip: _gzip, ...cdnOptions } = options
      return await createWorker('eng', 1, cdnOptions)
    } catch {
      throw err
    }
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
    const text = cleanOcrText(data?.text || '')
    const wordCount = countWords(text)
    const confidence = clampPercent(data?.confidence)

    if (wordCount < MIN_USABLE_WORDS) {
      return {
        text,
        confidence,
        wordCount,
        status: 'failed',
        message:
          text.length === 0
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
const MAX_OCR_EDGE = 1600

/**
 * Read a picked File into a data URL for preview + for the vision call in Module 3, downscaled so
 * a 12-megapixel camera shot does not take a minute to read on a cheap phone. Never upscales, and
 * falls back to the original bytes if the canvas step fails for any reason.
 * @param {File} file
 * @returns {Promise<{dataUrl: string, base64: string, mimeType: string, width: number, height: number}>}
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

      let dataUrl = original
      let mimeType = (file.type || 'image/jpeg').split(';')[0]
      const longest = Math.max(width, height)
      if (longest > MAX_OCR_EDGE) {
        try {
          const scale = MAX_OCR_EDGE / longest
          dataUrl = await redraw(original, Math.round(width * scale), Math.round(height * scale))
          mimeType = 'image/jpeg'
        } catch {
          /* keep the original */
        }
      }

      const commaAt = dataUrl.indexOf(',')
      resolve({ dataUrl, base64: dataUrl.slice(commaAt + 1), mimeType, width, height })
    }
    reader.readAsDataURL(file)
  })
}

function redraw(dataUrl, width, height) {
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
