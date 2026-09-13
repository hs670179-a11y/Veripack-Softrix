import { useLang } from '../i18n/context.js'

/** Big, wordy progress card — rural-first: the user always knows what is happening and for how long. */
export default function ProgressCard({ stage, pct, done, total, detail, previewUrl }) {
  const { t } = useLang()
  const isReading = stage === 'reading'
  const title = isReading ? t('reading') : t('checking')
  const barPct = isReading ? Math.max(4, Math.min(100, pct || 0)) : total ? Math.round((done / total) * 100) : 20

  return (
    <section className="card" aria-live="polite" aria-busy="true">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span className="spinner" aria-hidden="true" />
        <div>
          <h2>{title}</h2>
          <p className="muted" style={{ margin: 0 }}>
            {isReading
              ? `${detail || t('reading')}… ${barPct}%`
              : `${t('checkingCount', { done, total })}${done === 0 ? '…' : ''}`}
          </p>
        </div>
      </div>

      <div className="progress-track" role="progressbar" aria-valuenow={barPct} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress-bar" style={{ width: `${barPct}%` }} />
      </div>

      <p className="muted" style={{ margin: 0 }}>
        {t('pleaseWait')}
      </p>

      {previewUrl ? (
        <img className="preview" style={{ marginTop: 14 }} src={previewUrl} alt={t('imageLabel')} />
      ) : null}
    </section>
  )
}
