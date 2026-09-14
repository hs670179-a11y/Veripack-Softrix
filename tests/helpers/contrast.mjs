/**
 * The contrast maths both accessibility-style suites need, from the WCAG relative-luminance formula.
 * Shared so the UI palette and the brand artwork are measured the same way — two copies of this would
 * be two chances for one of them to be quietly wrong.
 */

/** @param {string} hex `#rgb` or `#rrggbb` */
export function relLuminance(hex) {
  const full = normalise(hex)
  const c = [1, 3, 5].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
  const lin = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

/** Contrast ratio between two hex colours, as a number (1 = identical, 21 = black on white). */
export function contrastHex(fg, bg) {
  const a = relLuminance(fg)
  const b = relLuminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** Same, comparing lowercase-insensitively so an SVG's `#F7F5EF` matches a token's `#f7f5ef`. */
export const sameColour = (a, b) => normalise(a).toLowerCase() === normalise(b).toLowerCase()

function normalise(hex) {
  const h = String(hex).trim().toLowerCase()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(h)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  if (!/^#[0-9a-f]{6}$/.test(h)) throw new Error(`not a hex colour: ${hex}`)
  return h
}
