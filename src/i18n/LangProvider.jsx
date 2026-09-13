/**
 * UI language provider: English + हिन्दी, one flat string table, no i18n library.
 *
 * DEVIATION FLAGGED ON PURPOSE (see README §7.1): Section 7 of the build spec lists
 * "multi-language UI/localization" as out of scope, but the app has to be usable by rural
 * consumers and the human partner asked for a Hindi toggle. Deliberate, small, and kept to this
 * folder: no per-locale files, no plural rules, no library.
 *
 * Only UI chrome is translated. Legal text is never translated — rule names, sections and rule
 * descriptions stay verbatim from src/data/rules.json, and model-written reasons stay English
 * because they quote the label.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { LangContext } from './context.js'
import { STRINGS } from './strings.js'

/** The only thing this app ever remembers on the device: the language the user picked. */
const STORAGE_KEY = 'veripack.lang'

export function LangProvider({ children }) {
  const [lang, setLang] = useState(() => {
    // Only a language preference is remembered, on the device itself. No label data, ever.
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved === 'hi' ? 'hi' : 'en'
    } catch {
      return 'en'
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch {
      /* private mode — the toggle still works for this session */
    }
    document.documentElement.lang = lang
  }, [lang])

  const t = useCallback(
    (key, vars) => {
      const table = STRINGS[lang] || STRINGS.en
      let out = table[key] ?? STRINGS.en[key] ?? key
      if (vars) {
        for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v))
      }
      return out
    },
    [lang],
  )

  const value = useMemo(() => ({ lang, setLang, t }), [lang, t, setLang])
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

