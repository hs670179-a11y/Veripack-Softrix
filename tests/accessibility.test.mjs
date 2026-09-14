import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { contrastHex } from './helpers/contrast.mjs'

/**
 * The README claims this app is usable by a rural first-time smartphone user in daylight. Those are
 * measurable claims, so they are asserted rather than asserted-about: contrast, tap-target size,
 * type size, colour-not-alone status, focus visibility, and reduced-motion respect.
 */
const ROOT = new URL('..', import.meta.url).pathname
const read = (f) => readFileSync(join(ROOT, f), 'utf8')

const TOKENS = Object.fromEntries([...read('src/styles/tokens.css').matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{3,8}|[\w\s(),.'-]+?);/g)].map((m) => [m[1], m[2].trim()]))
const HEXES = Object.fromEntries([...read('src/styles/app.css').matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]))
void HEXES

const css = () => read('src/styles/app.css')

function hex(name) {
  const raw = TOKENS[name]
  assert.ok(raw, `token --${name} must exist in tokens.css`)
  assert.match(raw, /^#[0-9A-Fa-f]{6}$/, `--${name} should be a 6-digit hex for the contrast maths (got ${raw})`)
  return raw
}

// The formula itself lives in tests/helpers/contrast.mjs, shared with tests/brand.test.mjs, so the
// palette and the artwork cannot be measured two different ways.
const contrast = (a, b) => contrastHex(hex(a), hex(b))

test('body and decision text is AAA, secondary text is AA', () => {
  const aaa = [
    ['ink', 'paper'], // page body copy
    ['ink', 'card'], // card body copy
    ['card', 'navy'], // header text
    ['navy', 'navy-tint'], // step chips
    ['on-saffron', 'saffron'], // primary button + authenticity header text
  ]
  for (const [fg, bg] of aaa) {
    assert.ok(contrast(fg, bg) >= 7, `${fg} on ${bg} is only ${contrast(fg, bg).toFixed(2)}:1, needs 7:1`)
  }
  const aa = [
    ['muted', 'card'], // citations and secondary lines
    ['muted', 'paper'], // footer
    ['pass-ink', 'pass-bg'], // ✅ chip
    ['fail-ink', 'fail-bg'], // ❌ chip
    ['warn-ink', 'warn-bg'], // ⚠️ chip and the demo badges
    ['green', 'card'],
    ['amber-deep', 'card'],
    ['red-deep', 'card'],
  ]
  for (const [fg, bg] of aa) {
    assert.ok(contrast(fg, bg) >= 4.5, `${fg} on ${bg} is only ${contrast(fg, bg).toFixed(2)}:1, needs 4.5:1`)
  }
})

test('status is never carried by colour alone', () => {
  const row = read('src/components/CheckRow.jsx')
  assert.match(row, /const ICONS = \{ pass: '✅', fail: '❌', unknown: '⚠️' \}/)
  assert.match(row, /const WORDS = \{ pass: 'legendPass', fail: 'legendFail', unknown: 'legendWarn' \}/)
  assert.match(row, /t\(WORDS\[status\]\)/, 'each row prints the status word next to the icon')
  const report = read('src/components/Report.jsx')
  assert.match(report, /legend/, 'and the report explains the marks once, at the top')
  const i18n = read('src/i18n/strings.js')
  for (const key of ['legendPass', 'legendFail', 'legendWarn']) {
    assert.match(i18n, new RegExp(`${key}:`), `${key} must exist in both tables`)
  }
})

test('targets and type are sized for a thumb and for low vision', () => {
  const css = read('src/styles/app.css')
  const tokens = read('src/styles/tokens.css')

  const base = Number(tokens.match(/--text-base:\s*([\d.]+)rem/)[1])
  assert.ok(base >= 1.0625, `base type is ${base}rem; rural-first needs >= 1.0625rem (17px)`)

  const btn = css.match(/\.btn \{[^}]*min-height:\s*(\d+)px/)
  assert.ok(Number(btn[1]) >= 56, `primary buttons are ${btn[1]}px tall; aim for >= 56px`)
  const lang = css.match(/\.lang-btn \{[^}]*min-height:\s*(\d+)px/)
  assert.ok(Number(lang[1]) >= 44, 'the language toggle must still be a real target')

  assert.match(tokens, /--text-lg: 1\.[4-9]rem|--text-lg: \d\.\d+rem/)
  assert.ok(Number(tokens.match(/--text-lg:\s*([\d.]+)rem/)[1]) >= 1.4, 'row/section headings stay large')
})

test('keyboard focus is visible and motion can be reduced', () => {
  const css = read('src/styles/app.css')
  const focus = css.match(/:focus-visible \{[^}]*\}/)
  assert.ok(focus, 'a :focus-visible rule must exist')
  assert.match(focus[0], /outline:\s*[2-9]px|outline:\s*1[0-9]px/, 'focus ring should be at least 2px')
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(css, /animation-duration: 0\.001ms/)
})

test('the page is announced properly and every control is labelled', () => {
  const html = read('index.html')
  assert.match(html, /<html lang="en">/, 'starts with a language declared')
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1(\.0)?"/)
  assert.doesNotMatch(html, /maximum-scale|user-scalable=no/, 'never block pinch zoom')
  assert.match(html, /name="description"/)

  const provider = read('src/i18n/LangProvider.jsx')
  assert.match(provider, /documentElement\.lang = lang/, 'the declared language follows the toggle')

  const app = read('src/App.jsx')
  assert.match(app, /className="skip" href="#main"/, 'keyboard users get a skip link')
  assert.match(app, /id="main"/)

  const uploader = read('src/components/Uploader.jsx')
  assert.ok((uploader.match(/type="file"/g) || []).length >= 2, 'camera and gallery pickers both exist')
  assert.match(css(), /\.btn:focus-within \{[^}]*outline:/, 'the visible label shows the focus ring')
  // (whether every <label for=…> points at a real control is checked on the rendered DOM in
  //  tests/render.test.mjs — a regex over JSX cannot follow props)
  assert.match(uploader, /accept="image\/\*"/)
  assert.match(uploader, /capture="environment"/)
})

test('the photo preview is described, and decorative icons are hidden from readers', () => {
  const uploader = read('src/components/Uploader.jsx')
  assert.match(uploader, /alt=\{t\('imageLabel'\)\}/, 'the preview gets real alt text')
  const hidden = [...read('src/components/Report.jsx'), ...read('src/components/CheckRow.jsx')].join('')
  assert.ok((hidden.match(/aria-hidden="true"/g) || []).length >= 3, 'emoji status marks must not be read out')
})
