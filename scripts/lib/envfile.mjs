/**
 * The two lines of .env parsing VeriPack's tooling needs, written carefully because the obvious regex
 * is wrong. `/NAME\s*=\s*(.*)/m` looks fine and quietly returns the *next* line when the value is
 * empty: `\s` matches the newline, so `VITE_GEMINI_API_KEY=` followed by a comment yields that
 * comment as the "key", and a health check would report a key present when there is none. An .env
 * file is line-oriented, so it is parsed line by line.
 */

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/

/**
 * Value of `name` in .env text, or '' when it is absent or deliberately left blank.
 * @param {string|null} text
 * @param {string} name
 */
export function parseEnvValue(text, name) {
  if (!text) return ''
  let last = ''
  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue
    const m = LINE.exec(line)
    if (m?.[1] === name) last = unquote(m[2].trim())
  }
  return last
}

function unquote(value) {
  const quoted = /^["'](.*)["']$/s.exec(value)
  return quoted ? quoted[1] : value
}
