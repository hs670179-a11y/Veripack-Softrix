import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { STRINGS } from '../src/i18n/strings.js'

/** The two language tables must never drift apart mid-demo. */
const ROOT = new URL('..', import.meta.url).pathname
const JSX_FILES = [
  join(ROOT, 'src/App.jsx'),
  ...readdirSync(join(ROOT, 'src/components')).map((f) => join(ROOT, 'src/components', f)),
]

test('English and Hindi tables hold the same keys, all filled', () => {
  assert.deepEqual(Object.keys(STRINGS.hi).sort(), Object.keys(STRINGS.en).sort(), 'a key is missing from one language')
  for (const [lang, table] of Object.entries(STRINGS)) {
    for (const [key, value] of Object.entries(table)) {
      assert.ok(typeof value === 'string' && value.trim().length > 0, `${lang}.${key} is empty`)
    }
  }
})

test('placeholders survive translation, so counts still render', () => {
  const tokens = (s) => (s.match(/\{[a-z]+\}/g) || []).sort().join(',')
  for (const key of Object.keys(STRINGS.en)) {
    assert.equal(tokens(STRINGS.hi[key]), tokens(STRINGS.en[key]), `${key} lost or gained a placeholder`)
  }
})

test('legal text is not translated anywhere in the UI strings', () => {
  assert.match(STRINGS.en.complianceSub, /Legal Metrology \(Packaged Commodities\) Rules, 2011/)
  // The Hindi table names the statute too, but no rule citation is reworded or invented.
  assert.doesNotMatch(Object.values(STRINGS.hi).join(' '), /Rule 6\(1\)\([a-f]\)/)
  assert.ok(!Object.keys(STRINGS.en).some((k) => /description/i.test(k)), 'rule descriptions do not live in i18n')
})

/*
 * The limitations and the privacy note are the copy a low-literacy user most needs in their own
 * language, so components must not carry English prose of their own. Statistics are the documented
 * exception: they come from src/data/approvedStats.json and must stay verbatim (Section 8).
 */
test('components take their copy from the string tables', () => {
  // Only real JSX text nodes: a run of text between '>' and '<' on one line, containing no {…}.
  const TEXT_NODE = />([^<>{}]+)</g
  const offenders = []
  for (const file of JSX_FILES) {
    const body = readFileSync(file, 'utf8')
    for (const line of body.split('\n')) {
      if (/^\s*(\*|\/\/|\/\*)/.test(line) || line.includes('=>')) continue
      for (const m of line.matchAll(TEXT_NODE)) {
        const text = m[1].replace(/&[a-z]+;/g, ' ').trim()
        const letters = (text.match(/[A-Za-z]/g) || []).length
        const words = text.split(/[^A-Za-z]+/).filter(Boolean).length
        if (letters >= 20 && words >= 4) offenders.push(`${file.split('/').pop()}: "${text.slice(0, 70)}"`)
      }
    }
  }
  assert.deepEqual(offenders, [], 'move this copy into src/i18n/strings.js for both languages')
})
