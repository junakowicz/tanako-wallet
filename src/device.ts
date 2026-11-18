// What the phone itself can do for the app: payment alerts, installing to the
// home screen, and the system share sheet. Everything here degrades quietly
// on phones that lack a feature.

// ---- Payment alerts -------------------------------------------------------
// Two sources, one notification per payment (they share a tag):
//  - the app itself, within seconds, while it is open or alive in the background;
//  - the Tanako server, within about a minute, even when the app is closed.
// For the second, the server keeps this phone's push address together with
// the wallet's public addresses. It never sees keys, the PIN or the 12 words.

export type AlertsState = 'unsupported' | 'default' | 'granted' | 'denied'
const API = (import.meta.env.VITE_RELAYER_URL as string | undefined) ?? '/api'

let registration: Promise<ServiceWorkerRegistration | null> | null = null
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  registration ??= navigator.serviceWorker.register('/sw.js').catch(() => null)
}

export function alertsState(): AlertsState {
  return 'Notification' in window ? (Notification.permission as AlertsState) : 'unsupported'
}

export async function askForAlerts(): Promise<AlertsState> {
  if (!('Notification' in window)) return 'unsupported'
  try {
    await Notification.requestPermission()
  } catch {
    /* some browsers reject instead of answering */
  }
  return alertsState()
}

/** Shows an alert from the app itself. `id` is the payment's transaction id. */
export async function notify(title: string, body: string, id: string) {
  if (alertsState() !== 'granted') return
  const options = { body, icon: '/icon-192.png', badge: '/icon-192.png', tag: `tanako-${id}`, renotify: true }
  try {
    const reg = await registration
    if (reg) return await reg.showNotification(title, options)
    new Notification(title, options)
  } catch {
    /* alerts are a convenience: never let one break the app */
  }
}

function keyBytes(base64url: string) {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

/**
 * Registers this phone with the Tanako server for alerts while the app is
 * closed. Safe to call again: it refreshes the language and addresses.
 * Returns false when the phone or browser cannot do it.
 */
export async function enablePush(address: string, btc: string | undefined, lang: string): Promise<boolean> {
  try {
    const reg = await registration
    if (!reg || !('pushManager' in reg) || alertsState() !== 'granted') return false
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      const { key } = await (await fetch(`${API}/push/key`)).json()
      await navigator.serviceWorker.ready
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) })
    }
    const res = await fetch(`${API}/push/subscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), address, btc, lang }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Removes this phone from the Tanako server. */
export async function disablePush() {
  try {
    const sub = await (await registration)?.pushManager?.getSubscription()
    if (!sub) return
    await fetch(`${API}/push/unsubscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => null)
    await sub.unsubscribe()
  } catch {
    /* nothing registered, or the browser has no push */
  }
}

// ---- Install to the home screen -------------------------------------------

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let installEvent: InstallEvent | null = null
const installWatchers = new Set<() => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // keep it for our own button
    installEvent = e as InstallEvent
    installWatchers.forEach((fn) => fn())
  })
  window.addEventListener('appinstalled', () => {
    installEvent = null
    installWatchers.forEach((fn) => fn())
  })
}

export const isInstalled = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
export const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/** 'button': we can open the install dialog. 'ios': show the manual steps. 'none': nothing to offer. */
export function installMode(): 'button' | 'ios' | 'none' {
  if (isInstalled()) return 'none'
  if (installEvent) return 'button'
  return isIos() ? 'ios' : 'none'
}
export function onInstallChange(fn: () => void) {
  installWatchers.add(fn)
  return () => {
    installWatchers.delete(fn)
  }
}
export async function promptInstall() {
  const e = installEvent
  if (!e) return
  await e.prompt()
  await e.userChoice.catch(() => null)
  installEvent = null
  installWatchers.forEach((fn) => fn())
}

// ---- Share ----------------------------------------------------------------

/** Opens the phone's share sheet, or copies the text where there is none. */
export async function share(text: string, url?: string): Promise<'shared' | 'copied' | 'cancelled'> {
  if (navigator.share) {
    try {
      await navigator.share(url ? { title: 'Tanako Wallet', text, url } : { text })
      return 'shared'
    } catch {
      return 'cancelled'
    }
  }
  try {
    await navigator.clipboard.writeText(url ? `${text} ${url}` : text)
    return 'copied'
  } catch {
    return 'cancelled'
  }
}
