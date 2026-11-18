// Tanako service worker. It exists so the phone can show payment alerts,
// including ones pushed while the app is closed, and reopen the app when one
// is tapped. It does not cache or intercept anything.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
// A payment alert pushed by the Tanako server. The app may already have shown
// the same payment itself; the shared tag makes this replace it quietly.
self.addEventListener('push', (e) => {
  let data = {}
  try {
    data = e.data.json()
  } catch {
    /* an empty push still has to show something */
  }
  e.waitUntil(
    self.registration.showNotification(data.title || 'Tanako', {
      body: data.body || '',
      tag: data.tag || 'tanako-payment',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    }),
  )
})
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => 'focus' in c)
      return open ? open.focus() : self.clients.openWindow('/')
    }),
  )
})
