import { create } from 'zustand'

export interface TokenSyncEvent {
  id: string
  provider: string // provider id, e.g. 'riverside'
  label: string
  icon: string
  action: 'replaced' | 'added'
  ts: number
  note?: string
}

interface TokenSyncState {
  events: TokenSyncEvent[]
  unread: number
  addEvent: (ev: Omit<TokenSyncEvent, 'id'>) => void
  markAllRead: () => void
  clearHistory: () => void
}

const STORAGE_KEY = 'arkxmotion.tokenSyncHistory'

function loadPersisted(): { events: TokenSyncEvent[]; unread: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        events: Array.isArray(parsed?.events) ? parsed.events : [],
        unread: typeof parsed?.unread === 'number' ? parsed.unread : 0,
      }
    }
  } catch (e) { console.warn('[tokenSyncStore] Failed to load history:', e) }
  return { events: [], unread: 0 }
}

const MAX_EVENTS = 30

export const useTokenSyncStore = create<TokenSyncState>((set) => {
  const initial = loadPersisted()

  return {
    events: initial.events,
    unread: initial.unread,

    addEvent: (ev) => {
      set((state) => {
        const id = Math.random().toString(36).slice(2, 10)
        const events = [{ ...ev, id }, ...state.events].slice(0, MAX_EVENTS)
        const unread = state.unread + 1
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ events, unread })) } catch (e) { console.warn('[tokenSyncStore] Failed to save history:', e) }
        return { events, unread }
      })
    },

    markAllRead: () => {
      set((state) => {
        if (state.unread === 0) return state
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ events: state.events, unread: 0 })) } catch (e) { console.warn('[tokenSyncStore] Failed to save history:', e) }
        return { unread: 0 }
      })
    },

    clearHistory: () => {
      set(() => {
        try { localStorage.removeItem(STORAGE_KEY) } catch (e) { console.warn('[tokenSyncStore] Failed to clear history:', e) }
        return { events: [], unread: 0 }
      })
    },
  }
})
