import { useLang } from '../i18n/context.js'

/**
 * Collapsible raw OCR text. Shown on purpose (spec Module 1): it lets a user or a judge see
 * exactly what the app had to work with, instead of trusting a black box.
 */
export default function ExtractedTextPanel({ ocr }) {
  const { t } = useLang()
  if (!ocr?.text) return null

  const conf = typeof ocr.confidence === 'number' ? `${ocr.confidence}%` : '—'
  return (
    // The chevron is driven by details[open] in CSS rather than React state: a native <details> owns
    // its open flag, and mirroring it through onToggle only adds a way for the two to disagree.
    <details className="text-panel no-print">
      <summary>
        <span aria-hidden="true">📄</span>
        <span>
          {t('extractedText')} · {t('confidence')} {conf}
        </span>
        <span className="chev" aria-hidden="true">
          ▼
        </span>
      </summary>
      <div className="text-body">
        <pre>{ocr.text}</pre>
      </div>
    </details>
  )
}
