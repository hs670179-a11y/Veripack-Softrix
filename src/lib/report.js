/**
 * Report helpers: summary counts, the headline verdict, and the print reference code.
 * Kept out of the components so both the screen and the print view use the same numbers.
 */
import { summarize } from './rulesEngine.js'

/**
 * Local reference code for the printed report. Generated in the browser and never sent
 * anywhere — it is only so a user can point at a sheet of paper later. Nothing is stored.
 */
export function makeReferenceCode(date = new Date()) {
  const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(
    date.getDate(),
  ).padStart(2, '0')}`
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  let tail = ''
  const bytes = new Uint8Array(4)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256)
  for (const b of bytes) tail += alphabet[b % alphabet.length]
  return `VP-${ymd}-${tail}`
}

/** Precedence: safety-relevant flag > legal non-compliance > could not confirm > all clear. */
export function headlineFor({ complianceRows, authRows }) {
  const compliance = summarize(complianceRows)
  const auth = summarize(authRows)
  const expired = authRows.find((r) => r.id === 'expiry' && r.status === 'fail')
  const damaged = authRows.find((r) => r.id === 'condition' && r.status === 'fail')

  if (expired) {
    return { variant: 'fail', key: 'headExpired', vars: {} }
  }
  if (damaged) {
    return { variant: 'fail', key: 'headDamaged', vars: {} }
  }
  if (compliance.fail > 0) {
    return { variant: 'fail', key: 'headMissing', vars: { n: compliance.fail, t: compliance.total } }
  }
  if (compliance.unknown > 0) {
    return { variant: 'warn', key: 'headNotConfirmed', vars: { n: compliance.unknown, t: compliance.total } }
  }
  if (auth.unknown > 0) {
    // The legal part is settled; only an optional/advisory extra could not be confirmed.
    return { variant: 'pass', key: 'headOkOtherUnclear', vars: { n: auth.unknown, t: compliance.total } }
  }
  return { variant: 'pass', key: 'headOk', vars: { n: compliance.pass, t: compliance.total } }
}

export function formatStamp(date = new Date()) {
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
