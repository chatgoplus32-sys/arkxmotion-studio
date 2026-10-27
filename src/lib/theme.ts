import { useEffect, useState } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const THEME_KEY = 'arkxmotion.theme'
const THEME_EVENT = 'arkxmotion-theme-changed'
const LIGHT_QUERY = '(prefers-color-scheme: light)'

export function getThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {}
  return 'dark'
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') {
    return window.matchMedia(LIGHT_QUERY).matches ? 'light' : 'dark'
  }
  return preference
}

export function applyTheme(preference: ThemePreference) {
  const resolved = resolveTheme(preference)
  const root = document.documentElement
  root.classList.remove('dark', 'light')
  root.classList.add(resolved)
  try { localStorage.setItem(THEME_KEY, preference) } catch {}
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: preference }))
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(getThemePreference)
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(getThemePreference()))

  useEffect(() => {
    applyTheme(getThemePreference())
    const sync = () => {
      const next = getThemePreference()
      setPreference(next)
      setResolved(resolveTheme(next))
    }
    const media = window.matchMedia(LIGHT_QUERY)
    const onMediaChange = () => {
      if (getThemePreference() === 'system') applyTheme('system')
    }
    sync()
    window.addEventListener(THEME_EVENT, sync)
    media.addEventListener('change', onMediaChange)
    return () => {
      window.removeEventListener(THEME_EVENT, sync)
      media.removeEventListener('change', onMediaChange)
    }
  }, [])

  return { preference, resolved, setTheme: applyTheme }
}
