import { useLang } from '../i18n/context.js'
import approved from '../data/approvedStats.json' with { type: 'json' }

/**
 * Collapsible "about" sheet: what the app is, what it cannot do, and where the numbers come from.
 *
 * All of this copy goes through the language tables — the limitations are the part a low-literacy
 * user most needs to read in their own language. Statistics are the one exception: they come from
 * src/data/approvedStats.json (Section 8 of the build spec) and must stay verbatim, each with its
 * source, because a translation would change published wording.
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

        <h3>{t('aboutCannotTitle')}</h3>
        <ul style={{ fontSize: 'var(--text-sm)', marginTop: 0 }}>
          <li>{t('aboutCannot1')}</li>
          <li>{t('aboutCannot2')}</li>
          <li>{t('aboutCannot3')}</li>
        </ul>

        <h3>{t('aboutContextTitle')}</h3>
        <ul className="stats">
          {approved.stats.map((s) => (
            <li key={s.figure}>
              <b>{s.figure}</b>
              <span style={{ color: 'var(--muted)' }}>{s.source}</span>
            </li>
          ))}
        </ul>

        <h3>{t('aboutLawTitle')}</h3>
        <p style={{ fontSize: 'var(--text-sm)', marginBottom: 0 }}>
          {t('aboutLawBody')} <code>src/data/rules.json</code>.
        </p>
      </div>
    </details>
  )
}
