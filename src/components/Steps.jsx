import { useLang } from '../i18n/context.js'

const ORDER = ['upload', 'reading', 'checking', 'report']

/** Three-word progress trail (photo / reading / report) so the flow never feels mysterious. */
export default function Steps({ phase }) {
  const { t } = useLang()
  const index = ORDER.includes(phase) ? ORDER.indexOf(phase) : ORDER.length
  const labels = [t('step1'), t('step2'), t('step3')]

  return (
    <ol className="steps no-print" aria-label={t('howItWorks')}>
      {labels.map((label, i) => (
        <li
          key={label}
          className={`step ${i === index ? 'on' : ''} ${i < index ? 'done' : ''}`}
          aria-current={i === index ? 'step' : undefined}
        >
          {i < index ? `✓ ${label}` : label}
        </li>
      ))}
    </ol>
  )
}
