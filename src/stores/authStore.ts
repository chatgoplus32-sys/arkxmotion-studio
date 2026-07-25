import { create } from 'zustand'

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
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<{ error?: string }>
  register: (email: string, password: string, name: string) => Promise<{ error?: string; needsApproval?: boolean }>
  logout: () => void
  checkAuth: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('arkxmotion_token'),
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
      localStorage.setItem('arkxmotion_token', data.token)
      set({ user: data.user, token: data.token, isAuthenticated: true })
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
      return { needsApproval: true }
    } catch {
      return { error: 'Network error. Please try again.' }
    }
  },

  logout: () => {
    localStorage.removeItem('arkxmotion_token')
    set({ user: null, token: null, isAuthenticated: false })
  },

  checkAuth: async () => {
    const token = localStorage.getItem('arkxmotion_token')
    if (!token) {
      set({ isLoading: false, isAuthenticated: false })
      return
    }
    try {
      const response = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!response.ok) {
        localStorage.removeItem('arkxmotion_token')
        set({ user: null, token: null, isAuthenticated: false, isLoading: false })
        return
      }
      const data = await response.json()
      set({ user: data.user, isAuthenticated: true, isLoading: false })
    } catch {
      localStorage.removeItem('arkxmotion_token')
      set({ user: null, token: null, isAuthenticated: false, isLoading: false })
    }
  }
}))
