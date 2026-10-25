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

export function sendNotification(title: string, options?: NotificationOptions) {
  if (!isNotificationsEnabled()) return
  if (!isNotificationSupported()) return
  if (Notification.permission !== 'granted') return

  try {
    new Notification(title, {
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      ...options,
    })
  } catch (e) { console.warn('[notify] Notification failed:', e) }
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
