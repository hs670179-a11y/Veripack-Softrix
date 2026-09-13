const ICON = { info: 'ℹ️', warn: '⚠️', bad: '⛔' }

/** Shared alert box for: no API key, unreadable photo, low-confidence photo, unexpected errors. */
export default function Notice({ tone = 'info', title, body, children }) {
  return (
    <div className={tone === 'bad' ? 'alert bad' : tone === 'warn' ? 'alert' : 'alert info'} role={tone === 'info' ? 'note' : 'alert'}>
      <p className="alert-title">
        <span aria-hidden="true">{ICON[tone] || ICON.info}</span>
        <span>{title}</span>
      </p>
      {body ? <p>{body}</p> : null}
      {children ? <div className="btn-row">{children}</div> : null}
    </div>
  )
}
