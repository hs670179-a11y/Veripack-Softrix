import { useLang } from '../i18n/context.js'
import approved from '../data/approvedStats.json' with { type: 'json' }

/**
 * Collapsible "about" sheet: what the app is, what it cannot do, and where the numbers come from.
 *
 * Statistics come from src/data/approvedStats.json — the pre-approved list in Section 8 of the
 * build spec, quoted verbatim, each with its source shown next to it. They stay in English
 * because a translation would change published wording.
 */
export default function AboutSheet() {
  const { t } = useLang()

  return (
    <details className="text-panel no-print">
      <summary>
        <span aria-hidden="true">ℹ️</span>
        <span>{t('aboutTitle')}</span>
        <span className="chev" aria-hidden="true">▼</span>
      </summary>
      <div className="text-body">
        <h3>{t('privacyTitle')}</h3>
        <p style={{ fontSize: 'var(--text-sm)' }}>{t('privacyBody')}</p>

        <h3>What this report cannot do</h3>
        <ul style={{ fontSize: 'var(--text-sm)', marginTop: 0 }}>
          <li>It reads the label. It does not open the pack and does not test the contents in a lab.</li>
          <li>
            The “Authenticity &amp; Quality Assurance” part is credential verification only: it matches
            the numbers the label declares against a demo registry sample. It is not a product
            screening system and has no brand data of its own, so it cannot say anything about a
            product being genuine or otherwise. A “not in demo dataset” answer is not a statement
            about the number itself.
          </li>
          <li>
            A Legal Metrology finding here is machine reading of one photo, not an adjudication. Only
            a competent authority can decide a violation.
          </li>
        </ul>

        <h3>Market context</h3>
        <ul className="stats">
          {approved.stats.map((s) => (
            <li key={s.figure}>
              <b>{s.figure}</b>
              <span style={{ color: 'var(--muted)' }}>{s.source}</span>
            </li>
          ))}
        </ul>

        <h3>Law used</h3>
        <p style={{ fontSize: 'var(--text-sm)', marginBottom: 0 }}>
          Legal Metrology (Packaged Commodities) Rules, 2011 — Rule 6 declarations, as encoded in{' '}
          <code>src/data/rules.json</code>.
        </p>
      </div>
    </details>
  )
}
