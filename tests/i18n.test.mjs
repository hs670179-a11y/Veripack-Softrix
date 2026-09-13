import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STRINGS } from '../src/i18n/strings.js'

/** The Hindi table must never fall behind the English one mid-demo. */
test('English and Hindi tables hold the same keys, all filled', () => {
  const en = Object.keys(STRINGS.en).sort()
  const hi = Object.keys(STRINGS.hi).sort()
  assert.deepEqual(hi, en, 'a key is missing from one language')
  for (const [lang, table] of Object.entries(STRINGS)) {
    for (const [key, value] of Object.entries(table)) {
      assert.ok(typeof value === 'string' && value.trim().length > 0, `${lang}.${key} is empty`)
    }
  }
})

test('placeholders survive translation, so counts still render', () => {
  for (const key of Object.keys(STRINGS.en)) {
    const tokens = (s) => (s.match(/\{[a-z]+\}/g) || []).sort().join(',')
    assert.equal(tokens(STRINGS.hi[key]), tokens(STRINGS.en[key]), `${key} lost or gained a placeholder`)
  }
})

test('legal text is not translated anywhere in the UI strings', () => {
  const legal = /Legal Metrology \(Packaged Commodities\) Rules, 2011/
  assert.ok(STRINGS.en.complianceSub.match(legal), 'English keeps the statute name in full')
  assert.ok(!/Rule 6\(1\)\([a-f]\)/.test(Object.values(STRINGS.hi).join(' ')), 'no rule citations are reworded in Hindi')
})
