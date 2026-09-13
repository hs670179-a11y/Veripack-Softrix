import { createContext, useContext } from 'react'

/**
 * Split out of src/i18n.jsx so that file exports only the <LangProvider> component (keeps Vite's
 * Fast Refresh working) while every component gets `useLang()` from here.
 */
export const LangContext = createContext(null)

export function useLang() {
  const ctx = useContext(LangContext)
  if (!ctx) throw new Error('useLang must be used inside <LangProvider>')
  return ctx
}
