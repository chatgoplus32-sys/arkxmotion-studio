// ─── Store notifikasi server (lonceng header) ──────────────────────────────
//
// Sebelumnya logika ini hidup sebagai state lokal di NotificationPanel
// (fetch + polling 30 detik + tandai dibaca di dalam komponen). Dipindah ke
// store supaya angka belum-dibaca bisa dipakai di mana saja (panel, badge)
// dan perilakunya bisa diuji tanpa me-render komponen.
//
// Sumber data: endpoint yang SUDAH ADA di server/routes/admin.ts —
// GET /api/admin/notifications/mine (daftar + unread) dan
// PATCH /api/admin/notifications/:id/read — plus endpoint baru
// PATCH /api/notifications/read-all (server/routes/notifications.ts).
import { create } from 'zustand'
import { useAuthStore } from './authStore'

export interface NotifikasiServer {
  id: number
  title: string
  message: string
  type: 'info' | 'warning' | 'success' | 'error' | 'announcement'
  target: 'all' | 'users' | 'admins'
  read: number
  /** Tujuan klik (mis. '/queue'). Kosong/absen = tidak bisa diklik. */
  link?: string
  created_at: string
}

interface NotificationState {
  items: NotifikasiServer[]
  unread: number
  loading: boolean
  lastFetchedAt: number | null
  /** Ambil daftar terbaru dari server (sekali jalan; aman dipanggil berulang). */
  fetchNotifikasi: () => Promise<void>
  /** Tandai satu notifikasi dibaca (optimistis di UI, lalu ke server). */
  markAsRead: (id: number) => Promise<void>
  /** Tandai semua notifikasi pribadi dibaca. */
  markAllRead: () => Promise<void>
  /** Mulai polling tiap 30 detik; kembalikan fungsi berhenti. Aman dipanggil berulang. */
  startPolling: () => () => void
}

const POLL_MS = 30_000

function tokenSekarang(): string | null {
  try {
    return useAuthStore.getState().token || localStorage.getItem('arkxmotion_token')
  } catch {
    return null
  }
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const kirim = (token: string | null) =>
    fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers || {}),
      },
    })
  const store = useAuthStore.getState()
  let res = await kirim(tokenSekarang())
  if (res.status === 401 && (await store.refresh())) res = await kirim(tokenSekarang())
  return res
}

let timerPolling: ReturnType<typeof setInterval> | null = null

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  unread: 0,
  loading: false,
  lastFetchedAt: null,

  fetchNotifikasi: async () => {
    if (!tokenSekarang()) return
    set({ loading: true })
    try {
      const res = await apiFetch('/api/admin/notifications/mine?limit=20')
      if (!res.ok) return
      const data = await res.json().catch(() => null)
      if (!data) return
      set({
        items: Array.isArray(data.notifications) ? data.notifications : [],
        unread: typeof data.unread === 'number' ? data.unread : 0,
        lastFetchedAt: Date.now(),
      })
    } catch {
      // Diam-diam: lonceng tidak boleh mengganggu generate saat jaringan putus.
    } finally {
      set({ loading: false })
    }
  },

  markAsRead: async (id: number) => {
    set((state) => ({
      items: state.items.map((n) => (n.id === id ? { ...n, read: 1 } : n)),
      unread: Math.max(0, state.unread - (state.items.find((n) => n.id === id && !n.read) ? 1 : 0)),
    }))
    try {
      await apiFetch(`/api/admin/notifications/${id}/read`, { method: 'PATCH' })
    } catch {
      // Optimistis: kegagalan jaringan tidak mengembalikan badge; fetch
      // berikutnya akan menyelaraskan lagi dengan server.
    }
  },

  markAllRead: async () => {
    set((state) => ({
      items: state.items.map((n) => ({ ...n, read: 1 })),
      unread: 0,
    }))
    try {
      await apiFetch('/api/notifications/read-all', { method: 'PATCH' })
    } catch {
      // Sama seperti markAsRead: fetch berikutnya menyelaraskan lagi.
    }
  },

  startPolling: () => {
    void get().fetchNotifikasi()
    if (timerPolling) return () => { /* sudah berjalan — pemanggil lain yang menghentikan */ }
    timerPolling = setInterval(() => {
      void get().fetchNotifikasi()
    }, POLL_MS)
    return () => {
      if (timerPolling) {
        clearInterval(timerPolling)
        timerPolling = null
      }
    }
  },
}))
