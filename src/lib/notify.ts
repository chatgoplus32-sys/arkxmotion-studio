const NOTIF_KEY = 'arkxmotion_notifications_enabled'

export function isNotificationsEnabled(): boolean {
  try {
    const stored = localStorage.getItem(NOTIF_KEY)
    // Default aktif: kalau user sudah memberi izin browser, notifikasi
    // seharusnya langsung jalan tanpa harus menemukan toggle tersembunyi.
    return stored === null ? true : stored === 'true'
  } catch {
    return false
  }
}

export function isNotificationDeliveryReady(): boolean {
  return isNotificationsEnabled() && isNotificationSupported() && Notification.permission === 'granted'
}

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function isNotificationBlocked(): boolean {
  return isNotificationSupported() && Notification.permission === 'denied'
}

export function setNotificationsEnabled(enabled: boolean) {
  try { localStorage.setItem(NOTIF_KEY, String(enabled)) } catch {}
  if (enabled && isNotificationSupported() && Notification.permission === 'default') {
    Notification.requestPermission()
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNotificationSupported()) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

// Minta izin saat ada gestur user (klik Generate). Chrome menolak/menyembunyikan
// prompt yang muncul tanpa gestur, jadi notifikasi tidak pernah aktif.
export function promptForNotificationsIfNeeded(): Promise<boolean> {
  if (!isNotificationsEnabled() || !isNotificationSupported()) return Promise.resolve(false)
  if (Notification.permission === 'granted') return Promise.resolve(true)
  if (Notification.permission !== 'default') return Promise.resolve(false)
  return Notification.requestPermission().then((r) => r === 'granted').catch(() => false)
}

export function sendNotification(title: string, options?: NotificationOptions) {
  if (!isNotificationsEnabled()) return
  if (!isNotificationSupported()) return
  if (Notification.permission !== 'granted') return

  const opts: NotificationOptions = {
    icon: '/arkx-notify.png',
    badge: '/arkx-notify.png',
    data: { url: '/hasil' },
    ...options,
  }

  const fallback = () => {
    try { new Notification(title, opts) } catch (e) { console.warn('[notify] Notification failed:', e) }
  }

  // Chrome Android melarang `new Notification()` (Illegal constructor) —
  // notifikasi hanya bisa tampil lewat ServiceWorkerRegistration.
  if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
    let settled = false
    const settle = (fn: () => void) => { if (settled) return; settled = true; fn() }
    const timer = setTimeout(() => settle(fallback), 2000)
    navigator.serviceWorker.ready
      .then((reg) => {
        clearTimeout(timer)
        settle(() => {
          reg.showNotification(title, opts).catch((e) => {
            console.warn('[notify] showNotification failed:', e)
            fallback()
          })
        })
      })
      .catch((e) => {
        clearTimeout(timer)
        console.warn('[notify] service worker not ready:', e)
        settle(fallback)
      })
    return
  }

  fallback()
}

export function notifyGenerationComplete(model: string, provider: string) {
  sendNotification('✅ Video Selesai!', {
    body: `${model} (${provider}) sudah selesai di-generate.`,
  })
}

export function notifyResultReady(result: { page?: string; model?: string; provider?: string }) {
  const isImage = result.page === 'edit-image' || result.page === 'upscaler'
  const kind = isImage ? 'Gambar' : 'Video'
  const detail = [result.model, result.provider].filter(Boolean).join(' · ')
  sendNotification(`✅ ${kind} selesai!`, {
    body: detail ? `${detail} sudah siap di ARKXMotion.` : `Hasil ${kind.toLowerCase()} baru sudah siap.`,
    tag: 'arkxmotion-result',
  })
}

export function notifyBatchComplete(totalItems: number) {
  sendNotification('✅ Batch Selesai!', {
    body: `${totalItems} video sudah selesai di-generate.`,
  })
}
