import { useLang } from '../i18n/context.js'
import { headlineFor } from '../lib/report'
import ReportSection from './ReportSection'
import ExtractedTextPanel from './ExtractedTextPanel'
import Notice from './Notice'

/**
 * Module 4 — the combined report. Same DOM is used on screen and for print/PDF (see the
 * @media print block in styles/app.css), so the exported sheet can never drift from what the
 * user saw.
 */
export default function Report({ complianceRows, authRows, ocr, stamp, reference, canCheck, onNewScan }) {
  const { t } = useLang()
  const head = headlineFor({ complianceRows, authRows })

  return (
    <>
      <div className="print-only print-report-head">
        <img src="/logo.svg" alt="" width="32" height="32" />
        <div>
          <b>{t('reportHead')}</b>
          <div className="print-meta">
            {t('reportWhen')}: {stamp} · {t('reportRef')}: {reference}
          </div>
        </div>
      </div>

      <div className={`verdict ${head.variant}`} role="status">
        <p className="verdict-line">
          <span aria-hidden="true">{head.variant === 'pass' ? '✅' : head.variant === 'fail' ? '❌' : '⚠️'}</span>{' '}
          {t(head.key, head.vars)}
        </p>
        <p className="muted" style={{ margin: '6px 0 0' }}>
          {t('reportIntro')}
        </p>
        <div className="legend">
          <span>
            <b aria-hidden="true">✅</b>
            {t('legendPass')}
          </span>
          <span>
            <b aria-hidden="true">❌</b>
            {t('legendFail')}
          </span>
          <span>
            <b aria-hidden="true">⚠️</b>
            {t('legendWarn')}
          </span>
        </div>
      </div>

      {!canCheck ? (
        <Notice tone="warn" title={t('noKeyTitle')} body={t('noKeyBody')} />
      ) : null}

      <ReportSection kind="compliance" rows={complianceRows} />
      <ReportSection kind="authenticity" rows={authRows} />

      <ExtractedTextPanel ocr={ocr} />

      <div className="btn-row no-print" style={{ marginTop: 16 }}>
        <button type="button" className="btn btn-navy" onClick={() => window.print()}>
          <span aria-hidden="true">🖨️</span>
          <span>{t('print')}</span>
        </button>
        <button type="button" className="btn btn-primary" onClick={onNewScan}>
          <span aria-hidden="true">🔄</span>
          <span>{t('newScan')}</span>
        </button>
      </div>
    </>
  )
}
