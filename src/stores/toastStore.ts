import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: number
  message: string
  type: ToastType
  timestamp: number
}

interface NotificationPreference {
  enabled: boolean
  success: boolean
  error: boolean
  info: boolean
  warning: boolean
}

interface ToastState {
  toasts: Toast[]
  notifications: Toast[]
  preferences: NotificationPreference
  addToast: (message: string, type?: ToastType) => void
  removeToast: (id: number) => void
  clearNotifications: () => void
  toggleNotifications: () => void
  toggleNotificationType: (type: keyof NotificationPreference) => void
}

const defaultPreferences: NotificationPreference = {
  enabled: true,
  success: true,
  error: true,
  info: true,
  warning: true,
}

const loadPreferences = (): NotificationPreference => {
  try {
    const stored = localStorage.getItem('arkxmotion_notifications')
    if (stored) {
      return { ...defaultPreferences, ...JSON.parse(stored) }
    }
  } catch {}
  return defaultPreferences
}

let nextId = 0

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  notifications: [],
  preferences: loadPreferences(),

  addToast: (message: string, type: ToastType = 'info') => {
    const { preferences } = get()

    const id = nextId++
    const notification: Toast = { id, message, type, timestamp: Date.now() }

    set((state) => ({
      notifications: [notification, ...state.notifications].slice(0, 50)
    }))

    if (!preferences.enabled || !preferences[type]) return

    set((state) => ({
      toasts: [...state.toasts, notification]
    }))
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id)
      }))
    }, 4000)
  },

  removeToast: (id: number) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id)
    }))
  },

  clearNotifications: () => {
    set({ notifications: [] })
  },

  toggleNotifications: () => {
    set((state) => {
      const newPrefs = { ...state.preferences, enabled: !state.preferences.enabled }
      localStorage.setItem('arkxmotion_notifications', JSON.stringify(newPrefs))
      return { preferences: newPrefs }
    })
  },

  toggleNotificationType: (type: keyof NotificationPreference) => {
    if (type === 'enabled') return
    set((state) => {
      const newPrefs = { ...state.preferences, [type]: !state.preferences[type] }
      localStorage.setItem('arkxmotion_notifications', JSON.stringify(newPrefs))
      return { preferences: newPrefs }
    })
  }
}))
