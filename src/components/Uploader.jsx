import { useId } from 'react'
import { useLang } from '../i18n/context.js'

/**
 * Upload UI for Module 1. Two big buttons (camera / gallery) plus a drop zone.
 * The camera button uses capture="environment" so phones open the back camera directly.
 */
export default function Uploader({ onPick, busy, previewUrl }) {
  const { t } = useLang()
  const camId = useId()
  const galId = useId()

  const handleFiles = (files) => {
    const file = [...(files || [])].find((f) => f && f.type.startsWith('image/'))
    if (file) onPick(file)
  }

  return (
    <section className="card card-lead" aria-labelledby="up-title">
      <h1 id="up-title">{t('takePhoto')}</h1>
      <p className="lead-sub">{t('takePhotoHelp')}</p>

      {previewUrl ? (
        <img className="preview" src={previewUrl} alt={t('imageLabel')} style={{ margin: '14px 0' }} />
      ) : null}

      <div className="btn-row" style={{ marginTop: previewUrl ? 0 : 18 }}>
        <label className="btn btn-primary" htmlFor={camId}>
          <span aria-hidden="true">📷</span>
          <span>{t('takePhoto')}</span>
        </label>
        <input
          id={camId}
          className="sr-only"
          type="file"
          accept="image/*"
          capture="environment"
          disabled={busy}
          onChange={(e) => {
            handleFiles(e.target.files)
            e.target.value = ''
          }}
        />

        <label className="btn btn-ghost" htmlFor={galId}>
          <span aria-hidden="true">🖼️</span>
          <span>{t('choosePhoto')}</span>
        </label>
        <input
          id={galId}
          className="sr-only"
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(e) => {
            handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      <DropZone onFiles={handleFiles} busy={busy} />
      <p className="hint">{t('startHint')}</p>
    </section>
  )
}

function DropZone({ onFiles, busy }) {
  const { t } = useLang()
  const zoneId = useId()

  return (
    <label
      className="dropzone"
      htmlFor={zoneId}
      onDragOver={(e) => {
        e.preventDefault()
        e.currentTarget.classList.add('over')
      }}
      onDragLeave={(e) => e.currentTarget.classList.remove('over')}
      onDrop={(e) => {
        e.preventDefault()
        e.currentTarget.classList.remove('over')
        if (!busy) onFiles(e.dataTransfer?.files)
      }}
    >
      <span aria-hidden="true">⬆️</span> {t('dropOr')}
    </label>
  )
}
