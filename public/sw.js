self.addEventListener('install', _e => self.skipWaiting())
self.addEventListener('activate', _e => self.clients.claim())
self.addEventListener('push', e => { if (e.data) self.registration.showNotification(e.data.text(), { icon: '/arkx-notify.png' }) })

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || '/hasil'
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) {
          if ('navigate' in client) return client.navigate(url).catch(() => {}).then(() => client.focus())
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    })
  )
})
