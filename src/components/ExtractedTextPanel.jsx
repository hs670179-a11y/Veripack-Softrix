import { useState } from 'react'
import { useLang } from '../i18n/context.js'

/**
 * Collapsible raw OCR text. Shown on purpose (spec Module 1): it lets a user or a judge see
 * exactly what the app had to work with, instead of trusting a black box.
 */
export default function ExtractedTextPanel({ ocr }) {
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  if (!ocr?.text) return null

  const conf = typeof ocr.confidence === 'number' ? `${ocr.confidence}%` : '—'
  return (
    <details className="text-panel no-print" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span aria-hidden="true">📄</span>
        <span>
          {t('extractedText')} · {t('confidence')} {conf}
        </span>
        <span className="chev" aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
      </summary>
      <div className="text-body">
        <pre>{ocr.text}</pre>
      </div>
    </details>
  )
}
