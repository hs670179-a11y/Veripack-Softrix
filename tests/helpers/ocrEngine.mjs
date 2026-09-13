/**
 * Real OCR in Node, using the same worker configuration the browser uses (src/lib/ocr.js), pointed
 * at the language file the app ships in public/tesseract. No network needed: this is what lets the
 * end-to-end test read actual image pixels instead of a text fixture.
 */
import { createOcrWorker, judgeOcr } from '../../src/lib/ocr.js'

export const TESSDATA_DIR = new URL('../../public/tesseract', import.meta.url).pathname
export const SAMPLES = [
  'docs/test-samples/1-compliant-atta-500g.jpg',
  'docs/test-samples/2-noncompliant-loose-pack.jpg',
  'docs/test-samples/3-expired-milk-powder.jpg',
]

let worker

/**
 * OCR a file exactly the way the app does: real engine, real cleaning, real quality gate
 * (judgeOcr), so a fixture that becomes unreadable fails the suite instead of quietly producing
 * verdicts the app would never have attempted.
 * @returns {Promise<{text: string, confidence: number, wordCount: number, status: string, message?: string}>}
 */
export async function ocrImage(file) {
  worker ??= await createOcrWorker(undefined, { langPath: TESSDATA_DIR, cacheMethod: 'none' })
  const { data } = await worker.recognize(file)
  return judgeOcr(data?.text, data?.confidence)
}

export async function closeOcr() {
  await worker?.terminate()
  worker = null
}
