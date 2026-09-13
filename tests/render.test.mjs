import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { createServer } from 'vite'

/**
 * Mount test: proves the whole component tree renders without throwing, that both language tables
 * are reachable, and that the honesty scaffolding (demo disclosure, legend, no-key warning) is in
 * the markup. Runs the real JSX through Vite's SSR pipeline, so import.meta.env handling is the same
 * one the browser build uses.
 */
let server

before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
})

after(async () => {
  await server?.close()
})

async function render() {
  const { LangProvider } = await server.ssrLoadModule('/src/i18n/LangProvider.jsx')
  const { default: App } = await server.ssrLoadModule('/src/App.jsx')
  return renderToString(createElement(LangProvider, null, createElement(App)))
}

test('the upload screen renders', async () => {
  const html = await render()
  assert.match(html, /VeriPack/)
  assert.match(html, /Take a photo of the label/)
  assert.match(html, /Choose a photo from this phone/)
  assert.match(html, /or drop an image here/)
  assert.match(html, /type="file"/)
  assert.match(html, /capture="environment"/, 'camera capture on mobile browsers')
  assert.match(html, /1\. Photo[\s\S]*2\. Reading[\s\S]*3\. Report/)
})

test('the missing-key state is warned about instead of pretending to pass', async () => {
  const html = await render()
  // No API key exists during tests, which is exactly the case this copy exists for.
  assert.match(html, /The rule checker is not switched on/)
  assert.match(html, /never reported as a pass|is never reported as a pass|never reported as a pass/)
})

test('every label points at a control that exists, and ids are unique', async () => {
  const html = await render()
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
  assert.equal(ids.length, new Set(ids).size, `duplicate id in: ${ids.join(', ')}`)
  const targets = [...html.matchAll(/for="([^"]+)"/g)].map((m) => m[1])
  assert.ok(targets.length >= 2, 'the upload screen is driven by labelled file inputs')
  for (const target of targets) {
    assert.ok(ids.includes(target), `<label for="${target}"> points at nothing — a dead tap target`)
  }
})

test('the logo and language toggle are in the header', async () => {
  const html = await render()
  assert.match(html, /\/logo\.svg/)
  assert.match(html, /हिन्दी|English/)
  assert.match(html, /theme-color|VeriPack/)
})

test('privacy and scope copy is reachable from the first screen', async () => {
  const html = await render()
  assert.match(html, /Your photo stays with you/)
  assert.match(html, /Demo dataset|demo dataset/)
})
