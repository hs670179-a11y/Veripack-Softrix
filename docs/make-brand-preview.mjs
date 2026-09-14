/**
 * Regenerates docs/brand-preview.png — both brand assets rendered at the sizes the app actually draws
 * them, so a logo swap can be checked for legibility without opening a browser. That is how the 16 px
 * favicon problem was found: the full mark turns to mush at tab-bar size, which no unit test can see.
 *
 * A rasteriser is deliberately NOT a project dependency (the app ships no image tooling), so it is
 * fetched into a git-ignored side directory once:
 *
 *   npm i --prefix .brand-preview @resvg/resvg-js
 *   node docs/make-brand-preview.mjs
 *
 * It writes only docs/brand-preview.png and reads only public/*.svg.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'docs', 'brand-preview.png')
const require = createRequire(import.meta.url)

const vendor = path.join(ROOT, '.brand-preview', 'node_modules', '@resvg', 'resvg-js')
if (!existsSync(vendor)) {
  console.error('Missing rasteriser. Run:  npm i --prefix .brand-preview @resvg/resvg-js')
  process.exit(1)
}
const { Resvg } = require(vendor)

const SIZES = { logo: [96, 40, 32], card: [40, 32], favicon: [48, 32, 16] }

/** Inline the asset's own markup at its real display size, so the sheet scales uniformly. */
function tile(file, size, x, y) {
  const src = readFileSync(path.join(ROOT, 'public', file), 'utf8')
  const inner = src.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 96 96">${inner}</svg>`
}

function row(file, sizes, x0, y0, gap, label, labelFill) {
  let x = x0
  const tiles = sizes
    .map((s) => {
      const cell = `${tile(file, s, x, y0)}<text x="${x}" y="${y0 + s + 22}" font-size="15" font-family="sans-serif" fill="${labelFill}">${s}px</text>`
      x += s + gap
      return cell
    })
    .join('')
  return `<text x="${x0}" y="${y0 - 14}" font-size="17" font-family="sans-serif" fill="${labelFill}">${label}</text>${tiles}`
}

const W = 730
const H = 470
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <text x="20" y="30" font-size="19" font-weight="bold" font-family="sans-serif" fill="#14213d">VeriPack brand assets as shipped</text>

  <rect x="0" y="52" width="${W}" height="180" fill="#14276b"/>
  ${row('logo.svg', SIZES.logo, 24, 72, 46, 'logo on the navy header — sizes as the app draws them', '#dbe4ff')}

  <rect x="0" y="252" width="${W}" height="180" fill="#ffffff" stroke="#e3ded2"/>
  ${row('logo.svg', SIZES.card, 24, 276, 40, 'logo on the report card', '#14213d')}
  ${row('favicon.svg', SIZES.favicon, 300, 276, 36, 'favicon (simplified for 16 px)', '#14213d')}

  <text x="20" y="${H - 22}" font-size="15" font-family="sans-serif" fill="#5a6478">Both assets carry their own paper tile — olive on navy alone is 2.33:1, so the mark would vanish in the header.</text>
</svg>`

writeFileSync(OUT, new Resvg(sheet, { fitTo: { mode: 'width', value: W * 2 } }).render().asPng())
console.log(`wrote ${path.relative(ROOT, OUT)} (${W * 2}px wide)`)
