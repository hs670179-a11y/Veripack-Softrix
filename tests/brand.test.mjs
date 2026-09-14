/**
 * Brand assets — the supplied logo, rebuilt as a vector, and the favicon derived from it.
 *
 * The upload reached the conversation but not this sandbox, so `public/logo.svg` is a redraw of the mark
 * from the image (shield crest in olive, terracotta carton, a check sweeping out through the right edge),
 * and the numbers below are what make that a reviewable asset instead of a sketch: the artwork's palette
 * is the declared brand tokens, the tile behind it is load-bearing rather than decoration, the files are
 * self-contained, and the app uses them without double-announcing the name.
 *
 * To use the original raster instead: save it over `public/logo.png`, point the two `<img src>` tags and
 * `index.html` at it, and delete these two files. Nothing else references the artwork.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { INTERIM_LOGO_SHA256 } from '../scripts/lib/verdicts.mjs'
import { contrastHex, sameColour } from './helpers/contrast.mjs'

const ROOT = new URL('..', import.meta.url).pathname
const read = (f) => readFileSync(join(ROOT, f), 'utf8')

const LOGO = read('public/logo.svg')
const FAVICON = read('public/favicon.svg')
const TOKENS = Object.fromEntries(
  [...read('src/styles/tokens.css').matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{3,8}|[\w\s(),.'-]+?);/g)].map((m) => [m[1], m[2].trim()]),
)
const PAPER = TOKENS.paper
const NAVY = TOKENS.navy

const coloursIn = (svg) => [...new Set([...svg.matchAll(/(?:fill|stroke)="(#[0-9a-fA-F]{3,6})"/g)].map((m) => m[1].toLowerCase()))]
const firstFill = (svg) => /<rect[^>]*fill="(#[0-9a-fA-F]{6})"/.exec(svg)?.[1]?.toLowerCase()

test('the artwork uses the declared brand palette, nothing invented', () => {
  const inks = coloursIn(LOGO)
  const allowed = [TOKENS['brand-olive'], TOKENS['brand-terracotta'], PAPER].map((c) => c.toLowerCase())
  for (const colour of inks) {
    assert.ok(allowed.some((a) => sameColour(a, colour)), `public/logo.svg uses ${colour}, which is not a brand token`)
  }
  assert.ok(
    allowed.slice(0, 2).every((brand) => inks.some((c) => sameColour(c, brand))),
    'both brand inks must actually appear in the mark (the tokens exist to describe it)',
  )
})

test('the tile behind the mark is what makes it readable on the navy header', () => {
  // The plate is the whole reason one asset works on the navy header, the white report and on paper.
  const plate = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"[^/]*fill="(#[0-9a-fA-F]{6})"/.exec(LOGO)
  assert.ok(plate, 'public/logo.svg must carry its own background tile')
  const [, , , w, h, fill] = plate
  assert.ok(Number(w) >= 88 && Number(h) >= 88, 'the tile must cover the viewBox, not sit as a small badge')
  assert.ok(sameColour(fill, PAPER), 'the tile colour must be --paper, so it disappears against the page')
  // …and the raw inks genuinely do not survive navy, which is the claim the tile exists to answer.
  assert.ok(
    contrastHex(TOKENS['brand-olive'], NAVY) < 3,
    'olive now reads on navy without the tile — if the tile is dropped, revisit this instead of deleting the test',
  )
})

test('the inks meet the graphical-contrast minimum against their ground', () => {
  const olive = contrastHex(TOKENS['brand-olive'], PAPER)
  const terra = contrastHex(TOKENS['brand-terracotta'], PAPER)
  // WCAG 1.4.11 needs 3:1 for graphical objects; the mark's primary stroke is held to the text bar
  // because it carries the meaning (shield + tick), while the carton is detail. Neither colour is ever
  // used for text — the UI palette in tokens.css is the one with the AAA pairs.
  assert.ok(olive >= 4.5, `brand-olive on paper is ${olive.toFixed(2)}:1, needs 4.5:1`)
  assert.ok(terra >= 3, `brand-terracotta on paper is ${terra.toFixed(2)}:1, needs 3:1 for the carton lines`)
})

test('both brand files are self-contained: no fetches, no scripts, no external references', () => {
  for (const [name, raw] of [['public/logo.svg', LOGO], ['public/favicon.svg', FAVICON]]) {
    // The SVG namespace URI is a vocabulary identifier, never a request, so it is set aside before the
    // "no absolute URL" rule. Anything else that looks like a host would be the app reaching out to
    // somewhere at report-print time, which is the privacy promise the whole project is built on.
    const svg = raw.replace(/\sxmlns(:\w+)?="[^"]*"/g, '')
    assert.ok(!/<script|foreignObject|<image/i.test(svg), `${name} contains an executable or embedded-raster element`)
    assert.ok(!/xlink:href|\bhref=/.test(svg), `${name} references something outside itself`)
    assert.ok(!/url\(\s*(?!#)/.test(svg), `${name} uses a url() that is not a same-document fragment`)
    assert.ok(!/https?:\/\//i.test(svg), `${name} contains an absolute URL — a brand asset must not fetch anything`)
    const used = [...svg.matchAll(/url\(#([\w-]+)\)/g)].map((m) => m[1])
    const defined = [...svg.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1])
    for (const id of used) assert.ok(defined.includes(id), `${name} points at #${id}, which is not defined`)
  }
})

test('the favicon is a deliberate simplification, not a shrunk copy', () => {
  const logoInks = coloursIn(LOGO).filter((c) => !sameColour(c, PAPER))
  const favInks = coloursIn(FAVICON)
  const palette = [TOKENS['brand-olive'], TOKENS['brand-olive-deep'], TOKENS['brand-terracotta'], PAPER].map((c) => c.toLowerCase())
  for (const ink of favInks) {
    assert.ok(palette.some((p) => sameColour(p, ink)), `public/favicon.svg uses ${ink}, which is not a brand token`)
  }
  assert.ok(!favInks.some((c) => sameColour(c, TOKENS['brand-terracotta'])), 'the carton must stay out of the favicon')
  assert.ok(favInks.some((c) => sameColour(c, TOKENS['brand-olive-deep'])), 'the favicon shield should be the deep brand olive')
  // Two independent facts that it is *simplified*, not merely recoloured: fewer shapes, and the tick is
  // knocked out in the tile colour instead of drawn on top.
  const shapes = (svg) => (svg.match(/<(path|rect|g)\b/g) ?? []).length
  assert.ok(shapes(FAVICON) < shapes(LOGO), `favicon has ${shapes(FAVICON)} shapes vs the logo's ${shapes(LOGO)} — it should be the simpler drawing`)
  assert.ok(
    /<path[^>]*stroke="#F7F5EF"/i.test(FAVICON),
    'the favicon tick should be knocked out of the shield (paper on olive), which is what survives 16 px',
  )
  assert.ok(sameColour(firstFill(FAVICON), PAPER), 'the favicon tile must be the same paper colour')
  // A solid shield at 16 px needs real contrast, since there is no room for a hairline. The tile colour
  // itself is excluded: it is what the knockout is drawn *with*, so it must match the tile exactly.
  for (const ink of favInks.filter((c) => !sameColour(c, PAPER))) {
    assert.ok(contrastHex(ink, PAPER) >= 4.5, `favicon ink ${ink} is only ${contrastHex(ink, PAPER).toFixed(2)}:1 on the tile`)
  }
  assert.ok(logoInks.length === 2, 'the logo is expected to carry both brand inks; if that changes, revisit the favicon too')
})

test('the app uses the brand once and does not announce the name twice', () => {
  for (const file of ['src/App.jsx', 'src/components/Report.jsx']) {
    const src = read(file)
    assert.match(src, /src="\/logo\.svg"/, `${file} should show the brand mark`)
    assert.match(src, /src="\/logo\.svg" alt=""/, `${file}: the wordmark is next to the image, so the image must stay decorative`)
  }
  assert.match(read('index.html'), /rel="icon"[^>]*href="\/favicon\.svg"/)
  // Opening the file on its own should still say what it is.
  for (const [name, svg] of [['logo.svg', LOGO], ['favicon.svg', FAVICON]]) {
    assert.match(svg, /role="img"/, `${name} needs a role so AT announces it as an image`)
    assert.match(svg, /aria-label="VeriPack"/, `${name} needs its own label`)
    assert.match(svg, /<title>VeriPack<\/title>/, `${name} needs a title element`)
  }
})

test('the real mark replaced the interim one, and the doctor stopped nagging about it', () => {
  const hash = createHash('sha256').update(readFileSync(join(ROOT, 'public', 'logo.svg'))).digest('hex')
  assert.notEqual(hash, INTERIM_LOGO_SHA256, 'public/logo.svg is still the interim stand-in')
  const report = execFileSync('node', [join(ROOT, 'scripts', 'doctor.mjs')], { encoding: 'utf8' })
  assert.match(report, /\[ ok \] Branding/, `npm run doctor still reports branding as a problem:\n${report}`)
})
