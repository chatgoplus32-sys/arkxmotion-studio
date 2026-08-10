const NOTIF_KEY = 'arkxmotion_notifications_enabled'

export function isNotificationsEnabled(): boolean {
  try {
    return localStorage.getItem(NOTIF_KEY) === 'true'
  } catch {
    return false
  }
}

export function setNotificationsEnabled(enabled: boolean) {
  localStorage.setItem(NOTIF_KEY, String(enabled))
  if (enabled && Notification.permission === 'default') {
    Notification.requestPermission()
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

export function sendNotification(title: string, options?: NotificationOptions) {
  if (!isNotificationsEnabled()) return
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return

  try {
    new Notification(title, {
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      ...options,
    })
  } catch {}
}

export function notifyGenerationComplete(model: string, provider: string) {
  sendNotification('✅ Video Selesai!', {
    body: `${model} (${provider}) sudah selesai di-generate.`,
  })
}

export function notifyBatchComplete(totalItems: number) {
  sendNotification('✅ Batch Selesai!', {
    body: `${totalItems} video sudah selesai di-generate.`,
  })
}
