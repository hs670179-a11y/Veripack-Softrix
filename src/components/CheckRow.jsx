import { useLang } from '../i18n/context.js'

const ICONS = { pass: '✅', fail: '❌', unknown: '⚠️' }
const WORDS = { pass: 'legendPass', fail: 'legendFail', unknown: 'legendWarn' }

/** One check: icon + name + citation + one-line reason, plus evidence quote and any badges. */
export default function CheckRow({ row }) {
  const { t } = useLang()
  const name = row.nameKey ? t(row.nameKey) : row.name
  const status = ICONS[row.status] ? row.status : 'unknown'

  return (
    <li className="row">
      <div className={`badge-icon ${status}`} aria-hidden="true">
        {ICONS[status]}
      </div>
      <div>
        <p className="row-name">{name}</p>
        <p className="row-cite">
          {row.section} · {t(WORDS[status])}
        </p>
        <p className="row-reason">{row.reason}</p>

        {row.evidence ? (
          <blockquote className="evidence">
            <span className="lbl">{t('evidenceLabel')}</span>
            {row.evidence}
          </blockquote>
        ) : null}

        {row.badge ? <Tags badge={row.badge} /> : null}

        {row.prompt ? (
          <details className="how no-print">
            <summary>{t('howChecked')}</summary>
            <p style={{ marginTop: 8 }}>{t('howCheckedBody')}</p>
            <pre>{row.prompt}</pre>
          </details>
        ) : null}
      </div>
    </li>
  )
}

function Tags({ badge }) {
  const { t } = useLang()
  if (badge === 'demo') {
    return (
      <p className="tags">
        <span className="tag warn">⚠ {t('demoDisclosure')}</span>
      </p>
    )
  }
  if (badge === 'soft') {
    return (
      <p className="tags">
        <span className="tag warn">{t('softBadge')}</span>
      </p>
    )
  }
  if (badge === 'advisory') {
    return (
      <p className="tags">
        <span className="tag warn">{t('advisoryBadge')}</span>
      </p>
    )
  }
  return null
}
