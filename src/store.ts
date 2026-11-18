import type { StoredWallet } from './wallet'
import type { Lang } from './i18n'

export type Payment = {
  id: string // txHash-logIndex
  tx: string
  from: string
  usd: number
  token: string
  block: number
  time: number // ms, when the app saw it
  rate: number // Ar per USD when seen
  // Set on money this phone sent; absent on money received.
  dir?: 'out'
  to?: string
  fee?: number // USDC paid as the sending fee
}

export type Contact = { label: string; address: string }

export type Settings = { lang: Lang; unit: 'MGA' | 'USD'; cashout?: string }

const K = {
  wallet: 'tanako.wallet',
  payments: 'tanako.payments',
  lastBlock: 'tanako.lastBlock',
  settings: 'tanako.settings',
  rate: 'tanako.rate',
  btcSeen: 'tanako.btcSeen',
  installLater: 'tanako.installLater',
  alertsOff: 'tanako.alertsOff',
  contacts: 'tanako.contacts',
  hidden: 'tanako.hidden',
  btcUnit: 'tanako.btcUnit',
}

function get<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
function set(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* storage unavailable: the app still works for this session */
  }
}

export const store = {
  wallet: () => get<StoredWallet | null>(K.wallet, null),
  setWallet: (w: StoredWallet) => set(K.wallet, w),
  payments: () => get<Payment[]>(K.payments, []),
  setPayments: (p: Payment[]) => set(K.payments, p),
  lastBlock: () => get<number | null>(K.lastBlock, null),
  setLastBlock: (b: number) => set(K.lastBlock, b),
  settings: () =>
    get<Settings>(K.settings, {
      lang: navigator.language.startsWith('mg') ? 'mg' : navigator.language.startsWith('en') ? 'en' : 'fr',
      unit: 'MGA',
    }),
  setSettings: (s: Settings) => set(K.settings, s),
  rate: () => get<{ rate: number; at: number } | null>(K.rate, null),
  setRate: (rate: number) => set(K.rate, { rate, at: Date.now() }),
  /** Bitcoin transactions already announced; null before the first look. */
  btcSeen: () => get<string[] | null>(K.btcSeen, null),
  setBtcSeen: (ids: string[]) => set(K.btcSeen, ids.slice(0, 200)),
  /** True when the user switched payment alerts off in Settings. */
  alertsOff: () => get<boolean>(K.alertsOff, false),
  setAlertsOff: (off: boolean) => set(K.alertsOff, off),
  /** Recipients the user saved with a name. */
  contacts: () => get<Contact[]>(K.contacts, []),
  setContacts: (c: Contact[]) => set(K.contacts, c),
  /** True when the user chose to hide amounts on the home screen. */
  hidden: () => get<boolean>(K.hidden, false),
  setHidden: (h: boolean) => set(K.hidden, h),
  /** How the Bitcoin balance is shown; null until the user picks one. */
  btcUnit: () => get<'BTC' | 'USD' | 'MGA' | null>(K.btcUnit, null),
  setBtcUnit: (u: 'BTC' | 'USD' | 'MGA') => set(K.btcUnit, u),
  /** Forgets everything this app keeps on the phone, wallet included. */
  wipe: () => {
    try {
      for (const k of Object.values(K)) localStorage.removeItem(k)
    } catch {
      /* storage unavailable: nothing was kept */
    }
  },
  installLater: () => get<boolean>(K.installLater, false),
  setInstallLater: () => set(K.installLater, true),
}
