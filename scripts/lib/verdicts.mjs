/**
 * The judgement calls `npm run doctor` makes, as pure functions.
 *
 * They live here rather than inline in the CLI for one reason: a health check that guesses whether a key
 * exists is worse than no health check, because it turns a broken setup into a green line. Kept separate
 * they can be tested against the awkward cases (missing .env, blank value, junk value) without running the
 * whole report. No verdict here ever includes the secret it is describing.
 */
import { createHash } from 'node:crypto'

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/**
 * Hash of the interim logo mark, i.e. the one VeriPack drew itself because the real logo never arrived.
 * Replacing public/logo.svg is the entire branding migration — nothing in src/ references the artwork.
 * If you swap it and want this script quiet, update this constant (or ignore the line; it is a reminder,
 * not an error).
 */
export const INTERIM_LOGO_SHA256 = '2abbe9d230ff47f35431f92d5638eb7583260126b32d9b8a960f12e5ffb9ee06'

/**
 * @param {{key: string, hasEnvFile: boolean}} state  `key` is the resolved value, '' when unset.
 * @returns {{level: 'ok'|'warn'|'fail', message: string, fix?: string}}
 */
export function keyVerdict({ key, hasEnvFile }) {
  if (!hasEnvFile) {
    return {
      level: 'warn',
      message: '.env does not exist — every rule row will honestly report "check unavailable"',
      fix: 'cp .env.example .env, paste the key, restart npm run dev',
    }
  }
  // A real Gemini key is 39-40 characters; >20 is a deliberate, loose bar — the point is only to tell
  // "something is in there" from "nothing is in there", and long junk still gets the sceptical line.
  if (key && key.length > 20) {
    return { level: 'ok', message: `present (${key.length} characters, value not shown)` }
  }
  if (key) {
    return {
      level: 'warn',
      message: `a ${key.length}-character value that does not look like a Gemini key`,
      fix: 'paste the key from https://aistudio.google.com/apikey',
    }
  }
  return {
    level: 'warn',
    message: 'VITE_GEMINI_API_KEY is empty — the 7 rule checks cannot run (Module 3 date/registry maths still will)',
    fix: 'paste the key into .env, then restart npm run dev',
  }
}

/**
 * @param {{bytes: Buffer|null, pinnedSha256?: string}} state  `bytes` is public/logo.svg, null when absent.
 */
export function logoVerdict({ bytes, pinnedSha256 = INTERIM_LOGO_SHA256 }) {
  if (!bytes || bytes.length === 0) {
    return {
      level: 'fail',
      message: 'public/logo.svg missing — the header has nothing to show',
      fix: 'add the logo as public/logo.svg',
    }
  }
  if (sha256(bytes) === pinnedSha256) {
    return {
      level: 'warn',
      message: 'public/logo.svg is still the interim mark — swap in the real logo and refresh favicon.svg',
      fix: 'overwrite public/logo.svg (no code change needed), then re-check the colours in src/styles/tokens.css',
    }
  }
  return {
    level: 'ok',
    message: 'a custom public/logo.svg is in place — verify favicon.svg matches and the palette in tokens.css still suits it',
  }
}
