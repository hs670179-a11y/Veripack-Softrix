import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OCR_MAX_EDGE, OCR_MIN_EDGE, planOcrSize } from '../src/lib/ocr.js'

/**
 * Sizing the scanner's copy of the photo is the difference between "the label omits the FSSAI number"
 * and "the photo was too small to read it" — on a real 250 px-wide photo Tesseract silently dropped
 * two declarations, and confidence was still above the low-confidence gate. So the decision is a pure
 * function and is asserted here.
 */
test('an oversized phone photo is shrunk to the OCR cap', () => {
  const plan = planOcrSize(4000, 3000)
  assert.equal(Math.max(plan.width, plan.height), OCR_MAX_EDGE)
  assert.ok(plan.scale < 1, 'shrinking')
  assert.equal(plan.width / plan.height, 4000 / 3000, 0.02, 'aspect ratio preserved')
})

test('a small photo is interpolated up, but never beyond 2x', () => {
  const small = planOcrSize(400, 400)
  assert.deepEqual({ width: small.width, height: small.height }, { width: 800, height: 800 })

  const tiny = planOcrSize(200, 200)
  assert.deepEqual({ width: tiny.width, height: tiny.height }, { width: 400, height: 400 })
  assert.ok(tiny.scale <= 2, 'upscaling past 2x invents detail the camera never captured')

  const narrow = planOcrSize(300, 1200) // tall receipt crop: the long edge drives the decision
  assert.ok(Math.max(narrow.width, narrow.height) <= 1200)
  assert.equal(narrow.scale, 1)
})

test('a reasonably sized photo is passed through untouched', () => {
  const ok = planOcrSize(1200, 900)
  assert.equal(ok.scale, 1)
  assert.deepEqual({ width: ok.width, height: ok.height }, { width: 1200, height: 900 })
})

test('unknown dimensions mean no resize, not a divide by zero', () => {
  assert.equal(planOcrSize(0, 0), null)
  assert.equal(planOcrSize(undefined, undefined), null)
})

test('the chosen window matches what the measurements justified', () => {
  assert.equal(OCR_MAX_EDGE, 1600)
  assert.ok(OCR_MIN_EDGE >= 800 && OCR_MIN_EDGE <= 1000, 'measured sweet spot for legible print')
})
