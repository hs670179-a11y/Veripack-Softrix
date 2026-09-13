import { useCallback, useRef, useState } from 'react'
import { useLang } from './i18n/context.js'
import { loadImageData, readLabel } from './lib/ocr'
import { checkAllRules, defaultRules } from './lib/rulesEngine'
import { runAuthenticityChecks } from './lib/authenticity'
import { hasApiKey } from './lib/gemini'
import { formatStamp, makeReferenceCode } from './lib/report'
import Uploader from './components/Uploader'
import Steps from './components/Steps'
import ProgressCard from './components/ProgressCard'
import Report from './components/Report'
import ExtractedTextPanel from './components/ExtractedTextPanel'
import Notice from './components/Notice'
import AboutSheet from './components/AboutSheet'
import './styles/app.css'

const AUTH_ORDER = ['expiry', 'fssai', 'plausibility', 'condition', 'barcode', 'bis']
const COMPLIANCE_ORDER = defaultRules.map((r) => r.id)
const TOTAL_ROWS = COMPLIANCE_ORDER.length + AUTH_ORDER.length

/** Canonical row order, even while results are still arriving one by one. */
function order(map, ids) {
  return ids.map((id) => map[id]).filter(Boolean)
}

export default function App() {
  const { t, lang, setLang } = useLang()
  const [phase, setPhase] = useState('upload') // upload | reading | checking | ocr-low | ocr-failed | report | error
  const [image, setImage] = useState(null)
  const [ocr, setOcr] = useState(null)
  const [pct, setPct] = useState(0)
  const [detail, setDetail] = useState('')
  const [complianceMap, setComplianceMap] = useState({})
  const [authMap, setAuthMap] = useState({})
  const [received, setReceived] = useState(0)
  const [meta, setMeta] = useState(null)
  const [error, setError] = useState('')

  // Bumped on every pick/reset so a slow earlier run can never overwrite a newer one.
  const runId = useRef(0)
  const canCheck = hasApiKey()

  const reset = useCallback(() => {
    runId.current += 1
    setPhase('upload')
    setImage(null)
    setOcr(null)
    setPct(0)
    setDetail('')
    setComplianceMap({})
    setAuthMap({})
    setReceived(0)
    setMeta(null)
    setError('')
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [])

  const startChecks = useCallback(async (text, img, myRun, { lowConfidence = false } = {}) => {
    const fresh = () => myRun === runId.current
    setPhase('checking')
    setComplianceMap({})
    setAuthMap({})
    setReceived(0)

    const onRow = (row) => {
      if (!fresh()) return
      const setter = COMPLIANCE_ORDER.includes(row.id) ? setComplianceMap : setAuthMap
      setter((prev) => ({ ...prev, [row.id]: row }))
      setReceived((n) => n + 1)
    }

    const [rules] = await Promise.all([
      checkAllRules(text, { onResult: (row) => onRow(row), lowConfidence }),
      runAuthenticityChecks({ ocrText: text, image: img, onResult: (row) => onRow(row), lowConfidence }),
    ])
    if (!fresh()) return

    // Use the engine's own ordering as the final authority once every check has landed.
    setComplianceMap(Object.fromEntries(rules.map((r) => [r.id, r])))
    setMeta({ stamp: formatStamp(), reference: makeReferenceCode() })
    setPhase('report')
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [])

  const handlePick = useCallback(
    async (file) => {
      const myRun = (runId.current += 1)
      const fresh = () => myRun === runId.current
      setError('')
      setOcr(null)
      setPct(0)
      setDetail('')
      setPhase('reading')

      try {
        const img = await loadImageData(file)
        if (!fresh()) return
        setImage(img)

        const result = await readLabel(img.ocrDataUrl || img.dataUrl, (p, stage) => {
          if (!fresh()) return
          setPct(p)
          setDetail(stage)
        })
        if (!fresh()) return
        setOcr(result)

        if (result.status === 'failed') {
          setPhase('ocr-failed')
          return
        }
        if (result.status === 'low-confidence') {
          setPhase('ocr-low')
          return
        }
        await startChecks(result.text, img, myRun, { lowConfidence: false })
      } catch (err) {
        if (!fresh()) return
        setError(String(err?.message || err))
        setPhase('error')
      }
    },
    [startChecks],
  )

  const complianceRows = order(complianceMap, COMPLIANCE_ORDER)
  const authRows = order(authMap, AUTH_ORDER)

  return (
    <div className="app">
      <a className="skip" href="#main">
        {t('skipToMain')}
      </a>
      <header className="bar">
        <div className="bar-in">
          <span className="brand">
            <img src="/logo.svg" alt="" width="40" height="40" />
            <span>
              <span className="brand-name">{t('appName')}</span>
              <span className="brand-tag">{t('tagline')}</span>
            </span>
          </span>
          <button
            type="button"
            className="lang-btn"
            onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}
            aria-label={t('langAria')}
          >
            {t('langButton')}
          </button>
        </div>
      </header>
      <div className="tricolor" aria-hidden="true" />

      <main className="wrap" id="main">
        <Steps phase={phase} />

        {phase === 'upload' ? (
          <>
            {!canCheck ? <Notice tone="warn" title={t('noKeyTitle')} body={t('noKeyBody')} /> : null}
            <Uploader onPick={handlePick} busy={false} previewUrl={null} />
          </>
        ) : null}

        {phase === 'reading' || phase === 'checking' ? (
          <ProgressCard
            stage={phase === 'reading' ? 'reading' : 'checking'}
            pct={pct}
            detail={detail}
            done={phase === 'checking' ? Math.min(received, TOTAL_ROWS) : 0}
            total={TOTAL_ROWS}
            previewUrl={image?.dataUrl}
          />
        ) : null}

        {phase === 'ocr-failed' || phase === 'ocr-low' ? (
          <>
            <Notice
              tone={phase === 'ocr-failed' ? 'bad' : 'warn'}
              title={phase === 'ocr-failed' ? t('photoProblem') : t('lowConfidence')}
              body={(phase === 'ocr-failed' ? t('photoProblemBody') : t('lowConfidenceBody')) + (ocr?.message ? ` (${ocr.message})` : '')}
            >
              {phase === 'ocr-low' ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => startChecks(ocr.text, image, runId.current, { lowConfidence: true })}
                >
                  {t('checkAnyway')}
                </button>
              ) : null}
            </Notice>
            <Uploader onPick={handlePick} busy={false} previewUrl={image?.dataUrl} />
            <ExtractedTextPanel ocr={ocr} />
          </>
        ) : null}

        {phase === 'report' ? (
          <Report
            complianceRows={complianceRows}
            authRows={authRows}
            ocr={ocr}
            stamp={meta?.stamp}
            reference={meta?.reference}
            canCheck={canCheck}
            onNewScan={reset}
          />
        ) : null}

        {phase === 'error' ? (
          <Notice tone="bad" title={t('errorTitle')} body={error}>
            <button type="button" className="btn btn-primary" onClick={reset}>
              {t('retake')}
            </button>
          </Notice>
        ) : null}

        <AboutSheet />

        <footer className="foot">
          <p style={{ margin: 0 }}>{t('footerLine1')}</p>
          <p className="src" style={{ margin: '6px 0 0' }}>
            {t('footerLine2')}
          </p>
        </footer>
      </main>
    </div>
  )
}
