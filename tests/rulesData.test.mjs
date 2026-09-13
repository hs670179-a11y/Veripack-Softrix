import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

/**
 * The legal text is non-negotiable: this test pins rules.json to the seven clauses exactly as
 * given in the build spec (Section 3), so no later edit can silently paraphrase the law or add
 * an eighth rule.
 */
const EXPECTED = [
  {
    id: 'net_quantity',
    name: 'Net Quantity Declaration',
    section: 'Rule 6',
    description:
      'The package must declare the net quantity of the commodity in terms of standard units of weight, measure, or number (e.g., grams, kilograms, millilitres, litres, or count).',
  },
  {
    id: 'mrp',
    name: 'Maximum Retail Price Declaration',
    section: 'Rule 6(1)(f)',
    description:
      'The package must declare the Maximum Retail Price (MRP) and explicitly state that it is inclusive of all taxes.',
  },
  {
    id: 'manufacturer_details',
    name: 'Manufacturer/Packer/Importer Details',
    section: 'Rule 6(1)(a)',
    description: 'The package must declare the name and complete address of the manufacturer, or packer, or importer.',
  },
  {
    id: 'consumer_care',
    name: 'Consumer Care Details',
    section: 'Rule 6(1)(a)',
    description:
      'The package must declare a consumer care name, address, telephone number, or email address for complaints/queries.',
  },
  {
    id: 'date_of_manufacture',
    name: 'Month and Year of Manufacture/Import',
    section: 'Rule 6(1)(d)',
    description: 'The package must declare the month and year in which the commodity was manufactured, packed, or imported.',
  },
  {
    id: 'country_of_origin',
    name: 'Country of Origin (Imports)',
    section: 'Rule 6(1)(a) / Legal Metrology Import Rules',
    description: 'For imported goods, the package must declare the country of origin/manufacture/assembly.',
  },
  {
    id: 'generic_name',
    name: 'Common or Generic Name',
    section: 'Rule 6(1)(a)',
    description: 'The package must declare the common or generic name of the commodity contained within.',
  },
]

const rules = JSON.parse(readFileSync(new URL('../src/data/rules.json', import.meta.url), 'utf8'))

test('rules.json holds exactly the 7 specified rules, in order', () => {
  assert.equal(rules.length, 7, 'must be exactly 7 rules — Section 7 forbids adding more')
  for (let i = 0; i < EXPECTED.length; i++) {
    assert.deepEqual({ ...rules[i] }, EXPECTED[i], `rule ${i} drifted from the spec text`)
  }
})

test('every rule keeps its four fields and a non-empty legal description', () => {
  for (const rule of rules) {
    assert.deepEqual(Object.keys(rule).sort(), ['description', 'id', 'name', 'section'])
    assert.ok(rule.description.startsWith('The package must') || rule.description.startsWith('For imported goods'))
    assert.match(rule.section, /^Rule 6/)
  }
})
