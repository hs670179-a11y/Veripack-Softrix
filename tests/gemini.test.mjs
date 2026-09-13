import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_MODEL, buildBody, endpointUrl, extractText, parseJsonObject } from '../src/lib/gemini.js'

/**
 * The API contract, asserted offline. The sandbox cannot reach generativelanguage.googleapis.com, so
 * these tests pin the request/response shape against the REST documentation instead of trusting
 * that a live call "looks right".
 */
const PROMPT = 'RULE TO CHECK…\n<<<LABEL_TEXT\nATKA 500 g\nLABEL_TEXT>>>'

test('endpoint is the v1beta generateContent URL for the verified model', () => {
  assert.equal(
    endpointUrl('gemini-3.8-flash'),
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
  )
})

test('the model actually shipped is the current one, not a retired default', () => {
  assert.equal(DEFAULT_MODEL, 'gemini-3.8-flash')
  assert.doesNotMatch(DEFAULT_MODEL, /2\.5|preview/, 'gemini-2.5-flash is retired in Oct 2026')
})

test('the key never appears in the URL or the body', () => {
  const url = endpointUrl()
  const body = JSON.stringify(buildBody({ prompt: PROMPT }))
  assert.doesNotMatch(url, /[?&]key=/, 'no query-string key')
  assert.doesNotMatch(body.toLowerCase(), /api[_-]?key|goog-api-key|secret/)
})

test('a text-only request sends exactly one text part', () => {
  const body = buildBody({ prompt: PROMPT })
  assert.equal(body.contents.length, 1)
  assert.deepEqual(body.contents[0].parts, [{ text: PROMPT }])
  assert.equal(body.contents[0].role, 'user')
})

test('the vision request puts the photo in inline_data before the instruction', () => {
  const body = buildBody({ prompt: 'look', image: { base64: 'aW1n', mimeType: 'image/png' } })
  assert.deepEqual(body.contents[0].parts[0], { inline_data: { mime_type: 'image/png', data: 'aW1n' } })
  assert.deepEqual(body.contents[0].parts[1], { text: 'look' })
  assert.equal(buildBody({ prompt: 'x', image: { base64: 'aW1n' } }).contents[0].parts[0].inline_data.mime_type, 'image/jpeg')
})

test('temperature is pinned so evidence reading stays repeatable', () => {
  assert.deepEqual(buildBody({ prompt: 'x' }).generationConfig, { temperature: 0 })
})

test('response text is joined across parts', () => {
  assert.equal(extractText({ candidates: [{ content: { parts: [{ text: '{"a"' }, { text: ':1}' }] } }] }), '{"a":1}')
})

test('an empty or blocked reply is an error with a reason, never empty success', () => {
  assert.throws(() => extractText({}), /no text/)
  assert.throws(() => extractText({ candidates: [{ content: { parts: [] } }] }), /no text/)
  assert.throws(() => extractText({ promptFeedback: { blockReason: 'SAFETY' } }), /blocked: SAFETY/)
  assert.throws(
    () => extractText({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '' }] } }] }),
    /finished: MAX_TOKENS/,
  )
})

test('parseJsonObject survives every wrapper the model is known to use', () => {
  assert.deepEqual(parseJsonObject('{"ruleId":"mrp","satisfied":true}'), { ruleId: 'mrp', satisfied: true })
  assert.deepEqual(parseJsonObject('```json\n{"satisfied":false}\n```'), { satisfied: false })
  assert.deepEqual(parseJsonObject('Answer:\n{"satisfied":"insufficient_evidence"}\n\nDone.'), {
    satisfied: 'insufficient_evidence',
  })
  assert.equal(parseJsonObject('{"unterminated": '), null)
  assert.equal(parseJsonObject('I cannot answer that.'), null)
})
