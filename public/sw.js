self.addEventListener('install', _e => self.skipWaiting())
self.addEventListener('activate', _e => self.clients.claim())
self.addEventListener('push', e => { if (e.data) self.registration.showNotification(e.data.text(), { icon: '/arkx-logo.svg' }) })
