import { useLang } from '../i18n/context.js'
import { summarize } from '../lib/rulesEngine'
import CheckRow from './CheckRow'

/** A titled block of checks with the summary count on the right of its header bar. */
export default function ReportSection({ kind, rows }) {
  const { t } = useLang()
  const isCompliance = kind === 'compliance'
  const title = isCompliance ? t('complianceTitle') : t('authenticityTitle')
  const sub = isCompliance ? t('complianceSub') : t('authenticitySub')
  const counts = summarize(rows)
  const countLabel = t(isCompliance ? 'satisfied' : 'checks', { done: counts.pass, total: counts.total })

  return (
    <section className={`section ${isCompliance ? 'section-legal' : 'section-auth'}`} aria-label={title}>
      <div className="section-head">
        <h2>{title}</h2>
        <span className="count">{countLabel}</span>
      </div>
      <div className="section-body">
        <p className="muted" style={{ marginTop: 12 }}>
          {sub}
        </p>
        {!isCompliance ? (
          <div className="disclosure">
            <span className="ico" aria-hidden="true">
              🧪
            </span>
            <span>
              <b>{t('demoDisclosure')}.</b> {t('demoDisclosureLong')}
            </span>
          </div>
        ) : null}
        <ul className="checks">
          {rows.map((row) => (
            <CheckRow key={row.id} row={row} />
          ))}
        </ul>
      </div>
    </section>
  )
}
