import { create } from 'zustand'
import { isTokenExpiring } from '@/lib/sessionExpiry'

interface User {
  id: number
  email: string
  name: string
  role: string
  approved: boolean
}

interface AuthState {
  user: User | null
  token: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<{ error?: string }>
  register: (email: string, password: string, name: string) => Promise<{ error?: string; needsApproval?: boolean; paymentToken?: string | null }>
  logout: () => void
  checkAuth: () => Promise<void>
  refresh: () => Promise<boolean>
  /**
   * Perbarui access token kalau sisa umurnya sudah mepet — dipanggil berkala
   * dari App (tiap menit + saat tab kembali aktif). Tanpa ini sesi mati di
   * tengah jalan setiap 15 menit: token kedaluwarsa, dan semua permintaan
   * sesudahnya dijawab 401/403 sampai pengguna login ulang.
   */
  refreshIfExpiring: () => Promise<void>
}

const TOKEN_KEY = 'arkxmotion_token'
const REFRESH_KEY = 'arkxmotion_refresh'

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: localStorage.getItem(TOKEN_KEY),
  refreshToken: localStorage.getItem(REFRESH_KEY),
  isAuthenticated: false,
  isLoading: true,

  login: async (email: string, password: string) => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      const data = await response.json()
      if (!response.ok) return { error: data.error || 'Login failed' }
      localStorage.setItem(TOKEN_KEY, data.token)
      if (data.refreshToken) localStorage.setItem(REFRESH_KEY, data.refreshToken)
      set({ user: data.user, token: data.token, refreshToken: data.refreshToken ?? null, isAuthenticated: true })
      return {}
    } catch {
      return { error: 'Network error. Please try again.' }
    }
  },

  register: async (email: string, password: string, name: string) => {
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name })
      })
      const data = await response.json()
      if (!response.ok) return { error: data.error || 'Registration failed' }
      return { needsApproval: true, paymentToken: data.paymentToken ?? null }
    } catch {
      return { error: 'Network error. Please try again.' }
    }
  },

  logout: () => {
    const rt = get().refreshToken || localStorage.getItem(REFRESH_KEY)
    const tk = get().token || localStorage.getItem(TOKEN_KEY)
    fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify({ refreshToken: rt }), signal: AbortSignal.timeout(8000) }).then((res) => {
      if (!res.ok && import.meta.env.DEV) console.warn('[auth] logout HTTP', res.status)
    }).catch((e) => { if (import.meta.env.DEV) console.warn('[auth] logout failed:', e) })
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
    set({ user: null, token: null, refreshToken: null, isAuthenticated: false })
  },

  refresh: async () => {
    const rt = get().refreshToken || localStorage.getItem(REFRESH_KEY)
    if (!rt) return false
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) })
      if (!res.ok) return false
      const data = await res.json()
      localStorage.setItem(TOKEN_KEY, data.token)
      set({ token: data.token, isAuthenticated: true })
      return true
    } catch { return false }
  },

  refreshIfExpiring: async () => {
    const rt = get().refreshToken || localStorage.getItem(REFRESH_KEY)
    if (!rt) return
    // Token yang tidak ada / tidak terbaca juga dianggap mepet: lebih baik
    // dicoba dulu daripada sesi yang masih bisa diselamatkan dibiarkan mati.
    if (!isTokenExpiring(get().token)) return
    await get().refresh()
  },

  checkAuth: async () => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) { set({ isLoading: false, isAuthenticated: false }); return }
    try {
      const response = await fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${token}` } })
      if (response.ok) {
        const data = await response.json()
        set({ user: data.user, isAuthenticated: true, isLoading: false })
        return
      }
      // 401 DAN 403 sama-sama berarti "token tidak sah/kedaluwarsa": Express
      // dulu menjawab 403, versi Vercel menjawab 401. Keduanya hanya beda
      // kode, bukan beda arti bagi sesi yang masih punya refresh token.
      if (response.status === 401 || response.status === 403) {
        const ok = await get().refresh()
        if (ok) {
          const tok2 = localStorage.getItem(TOKEN_KEY)!
          const r2 = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${tok2}` } })
          if (r2.ok) {
            const d2 = await r2.json()
            set({ user: d2.user, token: tok2, isAuthenticated: true, isLoading: false })
            return
          }
        }
      }
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(REFRESH_KEY)
      set({ user: null, token: null, refreshToken: null, isAuthenticated: false, isLoading: false })
    } catch {
      localStorage.removeItem(TOKEN_KEY)
      set({ user: null, token: null, isAuthenticated: false, isLoading: false })
    }
  }
}))
