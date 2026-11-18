import { useCallback, useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { getBalance, getIncoming, MAX_CATCHUP, safeHead } from './chain'
import { CONTACT, strings, type Lang, type Strings } from './i18n'
import { makePayCode, parsePayCode } from './paycode'
import { Btc } from './BitcoinScreen'
import { Help, type Topic } from './Help'
import { BackButton, CancelButton, Tools } from './ui'
import { group, groupTyped } from './format'
import { getBtcTxs, getBtcUsd } from './btc'
import {
  alertsState,
  askForAlerts,
  disablePush,
  enablePush,
  installMode,
  notify,
  onInstallChange,
  promptInstall,
  share,
  type AlertsState,
} from './device'
import { loadRate } from './rate'
import { Scanner } from './Scanner'
import { isAddress } from 'viem'
import { getRelayerInfo, sendUsdc, SendError } from './send'
import { store, type Contact, type Payment, type Settings } from './store'
import { addressOf, backupJson, contactsFromBackup, newPhrase, openWallet, parseBackup, phraseFromText, sealWallet, type StoredWallet } from './wallet'

const POLL_MS = 5000

export const fmtAr = (n: number) => `${group(Math.round(n))} Ar`
export const fmtUsd = (n: number) =>
  `$${group(n, 2)}`
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

function beep() {
  try {
    const ctx = new AudioContext()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.connect(g)
    g.connect(ctx.destination)
    o.frequency.value = 880
    g.gain.setValueAtTime(0.2, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
    o.onended = () => void ctx.close()
    o.start()
    o.stop(ctx.currentTime + 0.5)
  } catch {
    /* no audio available */
  }
}

export function App() {
  const [wallet, setWallet] = useState<StoredWallet | null>(store.wallet)
  const [settings, setSettingsState] = useState<Settings>(store.settings)
  const t = strings[settings.lang]
  const setSettings = (s: Settings) => {
    store.setSettings(s)
    setSettingsState(s)
  }

  if (!wallet)
    return (
      <Onboarding
        t={t}
        lang={settings.lang}
        onLang={(lang) => setSettings({ ...settings, lang })}
        onDone={(w) => {
          store.setWallet(w)
          setWallet(w)
        }}
      />
    )
  return (
    <Main
      wallet={wallet}
      onWallet={(w) => {
        store.setWallet(w)
        setWallet(w)
      }}
      t={t}
      settings={settings}
      setSettings={setSettings}
    />
  )
}

/** The Tanako mark: the name set in the banknote face, with "wallet" beneath. */
export function Brand({ motto, hero = false }: { motto: string; hero?: boolean }) {
  return (
    <div className={hero ? 'brand hero' : 'brand'}>
      <b>TANAKO</b>
      <span>WALLET</span>
      <i>{motto}</i>
    </div>
  )
}

function LangSwitch({ lang, onLang }: { lang: Lang; onLang: (l: Lang) => void }) {
  return (
    <div className="seg" role="group" aria-label="Language">
      {(['mg', 'fr', 'en'] as Lang[]).map((l) => (
        <button key={l} className={lang === l ? 'on' : ''} onClick={() => onLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

export function PinInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      />
    </label>
  )
}

function WordsDownload({ t, phrase }: { t: Strings; phrase: string }) {
  const words = phrase.split(' ')
  const text = [
    'Tanako recovery phrase',
    addressOf(phrase),
    '',
    ...words.map((w, i) => `${i + 1}. ${w}`),
    '',
    t.wordsFileNote,
    '',
  ].join('\n')
  return (
    <a
      className="filebtn"
      download="tanako-recovery-phrase.txt"
      href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
    >
      {t.downloadWords}
    </a>
  )
}

function Onboarding(p: { t: Strings; lang: Lang; onLang: (l: Lang) => void; onDone: (w: StoredWallet) => void }) {
  const { t } = p
  const [step, setStep] = useState<'start' | 'restore' | 'pin' | 'phrase' | 'filepin'>('start')
  const [fileWallet, setFileWallet] = useState<StoredWallet | null>(null)
  const [fileContacts, setFileContacts] = useState<Contact[]>([])
  const [phrase, setPhrase] = useState('')
  const [restoring, setRestoring] = useState(false)
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const finish = async () => {
    setBusy(true)
    p.onDone(await sealWallet(phrase, pin))
  }

  return (
    <div className="page center">
      <header className="top">
        <Brand motto={t.motto} />
        <LangSwitch lang={p.lang} onLang={p.onLang} />
      </header>

      {step === 'start' && (
        <section className="stack">
          <Brand hero motto={t.motto} />
          <h1>{t.tagline}</h1>
          <button
            className="primary"
            onClick={() => {
              setPhrase(newPhrase())
              setRestoring(false)
              setStep('pin')
            }}
          >
            {t.create}
          </button>
          <button className="link" onClick={() => setStep('restore')}>
            {t.restore}
          </button>
        </section>
      )}

      {step === 'restore' && (
        <section className="stack">
          <h2>{t.enterPhrase}</h2>
          <textarea
            rows={3}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
          />
          {error && <p className="error">{error}</p>}
          <button
            className="primary"
            onClick={() => {
              try {
                addressOf(phrase)
                setError('')
                setRestoring(true)
                setStep('pin')
              } catch {
                setError(t.badPhrase)
              }
            }}
          >
            {t.next}
          </button>
          <label className="filebtn">
            {t.restoreFile}
            <input
              type="file"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = '' // let the same file be picked again after an error
                if (!file) return
                const text = await file.text()
                const w = parseBackup(text)
                if (w) {
                  setError('')
                  setFileWallet(w)
                  setFileContacts(contactsFromBackup(text))
                  return setStep('filepin')
                }
                // Not the encrypted backup: it may be the saved 12-word text file.
                const words = phraseFromText(text)
                if (!words) return setError(t.badFile)
                setError('')
                setPhrase(words)
                setRestoring(true)
                setStep('pin')
              }}
            />
          </label>
          <BackButton t={t} label onClick={() => setStep('start')} />
        </section>
      )}

      {step === 'filepin' && fileWallet && (
        <section className="stack">
          <h2>{t.enterPin}</h2>
          <code className="addr">{fileWallet.address}</code>
          <PinInput value={pin} onChange={setPin} label={t.enterPin} />
          {error && <p className="error">{error}</p>}
          <button
            className="primary"
            disabled={pin.length !== 6 || busy}
            onClick={async () => {
              setBusy(true)
              const ph = await openWallet(fileWallet, pin)
              // The phrase must open and must belong to the address in the file.
              if (ph && addressOf(ph) === fileWallet.address) {
                // Bring back the saved recipients from the file, keeping any already on this phone.
                const here = store.contacts()
                const has = new Set(here.map((c) => c.address.toLowerCase()))
                store.setContacts([...here, ...fileContacts.filter((c) => !has.has(c.address.toLowerCase()))])
                return p.onDone(fileWallet)
              }
              setBusy(false)
              setError(t.wrongPin)
            }}
          >
            {t.next}
          </button>
          <BackButton t={t} label onClick={() => setStep('restore')} />
        </section>
      )}

      {step === 'pin' && (
        <section className="stack">
          <h2>{t.choosePin}</h2>
          <p className="muted">{t.pinHint}</p>
          <PinInput value={pin} onChange={setPin} label={t.choosePin} />
          <PinInput value={pin2} onChange={setPin2} label={t.repeatPin} />
          {error && <p className="error">{error}</p>}
          <button
            className="primary"
            disabled={pin.length !== 6 || pin2.length !== 6 || busy}
            onClick={() => {
              if (pin !== pin2) return setError(t.pinMismatch)
              setError('')
              if (restoring) void finish()
              else setStep('phrase')
            }}
          >
            {t.next}
          </button>
        </section>
      )}

      {step === 'phrase' && (
        <section className="stack">
          <h2>{t.phraseTitle}</h2>
          <p className="warn">{t.phraseWarn}</p>
          <ol className="words">
            {phrase.split(' ').map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ol>
          <WordsDownload t={t} phrase={phrase} />
          <button className="primary" disabled={busy} onClick={() => void finish()}>
            {t.phraseDone}
          </button>
        </section>
      )}
    </div>
  )
}

function Main(p: {
  wallet: StoredWallet
  onWallet: (w: StoredWallet) => void
  t: Strings
  settings: Settings
  setSettings: (s: Settings) => void
}) {
  const { wallet, t, settings } = p
  const [view, setView] = useState<'home' | 'charge' | 'settings' | 'send' | 'receive' | 'btc' | 'help'>('home')
  // Set when Help is opened from another screen for one guide; leaving returns there.
  const [helpFrom, setHelpFrom] = useState<{ topic: Topic; back: 'receive' } | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [payments, setPayments] = useState<Payment[]>(store.payments)
  const [contacts, setContactsState] = useState<Contact[]>(store.contacts)
  // Where Back leads from Help or Settings: the screen they were opened from.
  const [returnTo, setReturnTo] = useState<'home' | 'btc'>('home')
  const [hidden, setHiddenState] = useState<boolean>(store.hidden)
  const toggleHidden = () => {
    store.setHidden(!hidden)
    setHiddenState(!hidden)
  }
  const setContacts = (c: Contact[]) => {
    store.setContacts(c)
    setContactsState(c)
  }
  const nameOf = (address: string) =>
    contacts.find((c) => c.address.toLowerCase() === address.toLowerCase())?.label ?? short(address)
  const [rate, setRate] = useState<number | null>(store.rate()?.rate ?? null)
  const [online, setOnline] = useState(true)
  const rateRef = useRef(rate)
  rateRef.current = rate
  const listeners = useRef(new Set<(p: Payment) => void>())
  const viewRef = useRef(view)
  viewRef.current = view
  const tRef = useRef(t)
  tRef.current = t

  useEffect(() => {
    const refresh = () => void loadRate().then((r) => r && setRate(r.rate))
    refresh()
    const id = setInterval(refresh, 15 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  // Watch the chain for incoming USDC.
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const head = await safeHead()
        const last = store.lastBlock()
        const from = last === null ? head : Math.max(last + 1, head - MAX_CATCHUP)
        if (from <= head) {
          const incoming = await getIncoming(wallet.address, from, head)
          if (stopped) return
          if (incoming.length) {
            const known = new Set(store.payments().map((x) => x.id))
            const fresh: Payment[] = incoming
              .filter((x) => !known.has(x.id))
              .map((x) => ({ ...x, time: Date.now(), rate: rateRef.current ?? 0 }))
            if (fresh.length) {
              const all = [...fresh.reverse(), ...store.payments()]
              store.setPayments(all)
              setPayments(all)
              fresh.forEach((f) => listeners.current.forEach((fn) => fn(f)))
              // The charge screen announces its own payment; everywhere else, alert.
              if (viewRef.current !== 'charge' || document.hidden) {
                const r = rateRef.current
                if (viewRef.current !== 'charge') beep()
                if (!store.alertsOff())
                  for (const f of fresh)
                    void notify(
                      tRef.current.notifTitle,
                      r ? `+ ${fmtAr(f.usd * r)} (${group(f.usd, 2)} USDC)` : `+ ${group(f.usd, 2)} USDC`,
                      f.tx,
                    )
              }
            }
          }
          store.setLastBlock(head)
        }
        const b = await getBalance(wallet.address)
        if (stopped) return
        setBalance(b)
        setOnline(true)
      } catch {
        if (!stopped) setOnline(false)
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS)
    }
    void tick()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [wallet.address])

  // Watch for incoming bitcoin too, so it is announced from any screen.
  useEffect(() => {
    const address = wallet.btc
    if (!address) return
    let stopped = false
    const look = async () => {
      try {
        const txs = await getBtcTxs(address)
        if (stopped) return
        const seen = store.btcSeen()
        const fresh = seen ? txs.filter((x) => x.sats > 0 && !seen.includes(x.txid)) : []
        store.setBtcSeen([...txs.map((x) => x.txid), ...(seen ?? [])].filter((id, i, a) => a.indexOf(id) === i))
        if (!fresh.length) return
        const r = rateRef.current
        const price = r ? await getBtcUsd().catch(() => 0) : 0
        if (viewRef.current !== 'btc') beep()
        if (!store.alertsOff())
          for (const x of fresh) {
            const text = `${group(x.sats)} sats`
            void notify(
              tRef.current.notifTitle,
              price && r ? `+ ${fmtAr((x.sats / 1e8) * price * r)} (${text})` : `+ ${text}`,
              x.txid,
            )
          }
      } catch {
        /* try again on the next round */
      }
    }
    void look()
    const id = setInterval(look, 30_000)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [wallet.btc])

  // Keep this phone registered for alerts while the app is closed.
  useEffect(() => {
    if (alertsState() === 'granted' && !store.alertsOff()) void enablePush(wallet.address, wallet.btc, settings.lang)
  }, [wallet.address, wallet.btc, settings.lang])

  const subscribe = useCallback((fn: (p: Payment) => void) => {
    listeners.current.add(fn)
    return () => {
      listeners.current.delete(fn)
    }
  }, [])

  const show = (usd: number, r = rate) =>
    settings.unit === 'MGA' && r ? fmtAr(usd * r) : fmtUsd(usd)
  const other = (usd: number) => (settings.unit === 'MGA' || !rate ? fmtUsd(usd) : fmtAr(usd * rate))

  if (view === 'charge')
    return (
      <Charge
        t={t}
        address={wallet.address}
        rate={rate}
        unit={settings.unit}
        subscribe={subscribe}
        onClose={() => setView('home')}
      />
    )
  if (view === 'btc')
    return (
      <Btc
        t={t}
        wallet={wallet}
        onWallet={p.onWallet}
        rate={rate}
        unit={settings.unit}
        lang={settings.lang}
        hidden={hidden}
        onToggleHidden={toggleHidden}
        onHelp={() => {
          setReturnTo('btc')
          setView('help')
        }}
        onSettings={() => {
          setReturnTo('btc')
          setView('settings')
        }}
        onClose={() => setView('home')}
      />
    )
  if (view === 'receive')
    return (
      <div className="page center">
        <section className="stack">
          <h2>{t.receive}</h2>
          <div className="qr">
            <QRCodeSVG value={wallet.address} size={240} marginSize={2} />
          </div>
          <code className="addr">{wallet.address}</code>
          <p className="muted">{t.receiveNote}</p>
          <CopyButton t={t} text={wallet.address} />
          <ShareButton t={t} label={t.shareAddr} text={wallet.address} />
          <BackButton t={t} label onClick={() => setView('home')} />
        </section>

        <button
          className="secondary"
          onClick={() => {
            setHelpFrom({ topic: 'add', back: 'receive' })
            setView('help')
          }}
        >
          {t.addHelp}
        </button>
      </div>
    )
  if (view === 'help')
    return (
      <Help
        t={t}
        start={helpFrom?.topic}
        onClose={() => {
          setView(helpFrom?.back ?? returnTo)
          setHelpFrom(null)
          setReturnTo('home')
        }}
      />
    )
  if (view === 'send')
    return (
      <Send
        t={t}
        wallet={wallet}
        balance={balance ?? 0}
        rate={rate}
        unit={settings.unit}
        saved={settings.cashout ?? ''}
        onSaved={(cashout) => p.setSettings({ ...settings, cashout })}
        contacts={contacts}
        onContacts={setContacts}
        onSent={(x) => {
          // Read the stored list, not the state: a payment may have arrived meanwhile.
          const all = [{ ...x, rate: rate ?? 0 }, ...store.payments()]
          store.setPayments(all)
          setPayments(all)
        }}
        onClose={() => setView('home')}
      />
    )
  if (view === 'settings')
    return <SettingsView t={t} wallet={wallet} settings={settings} setSettings={p.setSettings}
        onClose={() => {
          setView(returnTo)
          setReturnTo('home')
        }}
      />

  return (
    <div className="page">
      <header className="top">
        <Brand motto={t.motto} />
        <Tools t={t} onHelp={() => setView('help')} onSettings={() => setView('settings')} />
      </header>

      {!online && <p className="banner">{t.offline}</p>}
      <DeviceCards t={t} wallet={wallet} lang={settings.lang} />

      <section className="card balance">
        <div className="row">
          <span className="muted">
            {t.balance}
            <EyeButton t={t} hidden={hidden} onToggle={toggleHidden} />
          </span>
          <div className="seg" role="group" aria-label="Currency">
            {(['MGA', 'USD'] as const).map((u) => (
              <button
                key={u}
                className={settings.unit === u ? 'on' : ''}
                onClick={() => p.setSettings({ ...settings, unit: u })}
              >
                {u === 'MGA' ? 'Ar' : 'USD'}
              </button>
            ))}
          </div>
        </div>
        <div className="big">{balance === null ? '—' : hidden ? DOTS : show(balance)}</div>
        <div className="muted">{balance === null || hidden ? '' : `≈ ${other(balance)}`}</div>
        <div className="muted small">
          {rate ? t.rateLine.replace('{r}', group(Math.round(rate))) : t.noRate}
        </div>
        {/* The note's serial number: the start of this wallet's address. */}
        <div className="serial" aria-hidden="true">
          TK {wallet.address.slice(2, 10).toUpperCase()}
        </div>
      </section>

      <button className="primary huge" onClick={() => setView('charge')}>
        <Icon name="qr" />
        {t.charge}
      </button>
      <div className="row two">
        <button className="secondary" onClick={() => setView('receive')}>
          <Icon name="in" />
          {t.receive}
        </button>
        <button className="secondary" onClick={() => setView('send')}>
          <Icon name="out" />
          {t.cashOut}
        </button>
      </div>
      <button className="secondary btc" onClick={() => setView('btc')}>
        ₿ {t.bitcoin}
      </button>

      <section>
        <h3>{t.recent}</h3>
        {payments.length === 0 && <p className="muted">{t.none}</p>}
        <ul className="list">
          {payments.map((x) => (
            <li key={x.id}>
              <Icon name={x.dir === 'out' ? 'out' : 'in'} />
              <div>
                <strong className={x.dir === 'out' ? 'out' : 'in'}>
                  {x.dir === 'out' ? '−' : '+'}
                  {hidden ? DOTS : show(x.usd, x.rate || rate)}
                </strong>
                <div className="muted small">
                  {new Date(x.time).toLocaleString(settings.lang === 'en' ? 'en-GB' : 'fr-FR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}{' '}
                  · {x.dir === 'out' ? `${t.sentTo} ${nameOf(x.to ?? '')}` : `${t.receivedFrom} ${nameOf(x.from)}`}
                  {x.fee && !hidden ? ` · ${t.feeShort} ${x.fee} USDC` : ''}
                </div>
              </div>
              <a href={`https://polygonscan.com/tx/${x.tx}`} target="_blank" rel="noreferrer">
                {hidden ? '' : `${x.dir === 'out' ? '−' : ''}${fmtUsd(x.usd)} `}↗
              </a>
            </li>
          ))}
        </ul>
      </section>
      <p className="muted small">{t.holdNote}</p>
    </div>
  )
}

function ShareButton({ t, label, text, url }: { t: Strings; label: string; text: string; url?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="secondary"
      onClick={async () => {
        if ((await share(text, url)) !== 'copied') return
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? t.copied : label}
    </button>
  )
}

/**
 * Payment alerts and installing to the home screen. On the home screen these
 * are prompts that disappear once dealt with; in Settings (`full`) they stay
 * visible with their current state, next to "share Tanako".
 */
function DeviceCards({ t, wallet, lang, full = false }: { t: Strings; wallet: StoredWallet; lang: Lang; full?: boolean }) {
  const [alerts, setAlerts] = useState<AlertsState>(alertsState)
  const [off, setOff] = useState(store.alertsOff)
  const [install, setInstall] = useState(installMode)
  const [later, setLater] = useState(store.installLater)
  useEffect(() => onInstallChange(() => setInstall(installMode())), [])

  const turnOn = async () => {
    const state = await askForAlerts()
    setAlerts(state)
    if (state !== 'granted') return
    store.setAlertsOff(false)
    setOff(false)
    void enablePush(wallet.address, wallet.btc, lang)
  }
  const turnOff = () => {
    store.setAlertsOff(true)
    setOff(true)
    void disablePush()
  }

  const canAsk = alerts === 'default' || (alerts === 'granted' && off)
  const showAlerts = full ? alerts !== 'unsupported' : alerts === 'default'
  const showInstall = install !== 'none' && (full || !later)
  if (!showAlerts && !showInstall && !full) return null

  return (
    <>
      {showAlerts && (
        <section className="card stack notice">
          {canAsk && (
            <>
              <p>{t.alertsAsk}</p>
              <button className="secondary" onClick={() => void turnOn()}>
                {t.alertsOn}
              </button>
            </>
          )}
          {alerts === 'granted' && !off && (
            <>
              <p>✓ {t.alertsEnabled}</p>
              {full && (
                <button className="link" onClick={turnOff}>
                  {t.alertsOffBtn}
                </button>
              )}
            </>
          )}
          {alerts === 'denied' && <p className="error">{t.alertsBlocked}</p>}
          <p className="muted small">{full ? t.alertsNote : t.alertsPrivacy}</p>
        </section>
      )}
      {showInstall && (
        <section className="card stack notice">
          <p>{t.installAsk}</p>
          {install === 'button' ? (
            <button className="secondary" onClick={() => void promptInstall()}>
              {t.installBtn}
            </button>
          ) : (
            <p className="small">{t.installIos}</p>
          )}
          {!full && (
            <button
              className="link"
              onClick={() => {
                store.setInstallLater()
                setLater(true)
              }}
            >
              {t.notNow}
            </button>
          )}
        </section>
      )}
      {full && (
        <section className="card stack">
          <ShareButton t={t} label={t.shareApp} text={t.shareAppText} url={location.origin} />
        </section>
      )}
    </>
  )
}

/** The eye beside a balance: open when amounts show, closed when they are hidden. */
export function EyeButton({ t, hidden, onToggle }: { t: Strings; hidden: boolean; onToggle: () => void }) {
  return (
    <button className="eye" aria-label={hidden ? t.showAmounts : t.hideAmounts} aria-pressed={hidden} onClick={onToggle}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {hidden ? (
          <>
            <path d="M3 10c2.2 3 5.3 4.5 9 4.5s6.800-1.500 9-4.500" />
            <path d="M12 14.500V18M7.500 13.700 6 16.800M16.500 13.700 18 16.800M4.200 11.300 2.200 13.300M19.800 11.300l2 2" />
          </>
        ) : (
          <>
            <path d="M2.500 12C4.800 8 8.100 6 12 6s7.200 2 9.500 6c-2.300 4-5.600 6-9.500 6s-7.200-2-9.500-6Z" />
            <circle cx="12" cy="12" r="3" />
          </>
        )}
      </svg>
    </button>
  )
}

/**
 * A round seal with a pictogram: money coming in (arrow down into the hand),
 * money going out (arrow up and away), or a code to be scanned.
 */
export function Icon({ name, className = '' }: { name: 'in' | 'out' | 'qr'; className?: string }) {
  return (
    <svg className={`ico ico-${name} ${className}`} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="15" />
      <circle className="ring" cx="16" cy="16" r="12.4" />
      {name === 'in' && <path d="M21 9 12.500 17.500M12.500 11v6.500H19" />}
      {name === 'out' && <path d="M12 18.500 20.500 10M14 10h6.500v6.500" />}
      {name !== 'qr' && <path className="base" d="M11.500 24h9" />}
      {name === 'qr' && <path d="M10 10h4.500v4.500H10zM17.500 10H22v4.500h-4.500zM10 17.500h4.500V22H10zM18 18h1.500M21.500 18v0M18 21.500h4" />}
    </svg>
  )
}

export const DOTS = '••••••'

export function CopyButton({ t, text }: { t: Strings; text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="secondary"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true))
      }}
    >
      {copied ? t.copied : t.copy}
    </button>
  )
}

function Charge(p: {
  t: Strings
  address: string
  rate: number | null
  unit: 'MGA' | 'USD'
  subscribe: (fn: (p: Payment) => void) => () => void
  onClose: () => void
}) {
  const { t, rate } = p
  const unit = p.unit === 'MGA' && rate ? 'MGA' : 'USD'
  const [input, setInput] = useState('')
  const [asked, setAsked] = useState<number | null>(null) // USDC requested
  const [got, setGot] = useState<Payment | null>(null)
  const [viaTanako, setViaTanako] = useState(false)

  const value = Number(input.replace(',', '.'))
  // Round up to the cent so the merchant is never short.
  const usd = unit === 'MGA' && rate ? Math.ceil((value / rate) * 100) / 100 : Math.round(value * 100) / 100

  useEffect(() => {
    if (asked === null || got) return
    return p.subscribe((pay) => {
      setGot(pay)
      beep()
    })
  }, [asked, got, p])

  if (got && asked !== null) {
    const short = got.usd + 0.005 < asked
    return (
      <div className="page center">
        <section className={`stack result ${short ? 'short' : 'ok'}`}>
          <div className="tick">{short ? '!' : '✓'}</div>
          <h1>{t.received}</h1>
          <div className="big">{fmtUsd(got.usd)}</div>
          {rate && <div className="muted">≈ {fmtAr(got.usd * rate)}</div>}
          {short && (
            <p className="error">
              {t.less}: {fmtUsd(asked)}
            </p>
          )}
          <button className="primary" onClick={p.onClose}>
            {t.done}
          </button>
        </section>
      </div>
    )
  }

  if (asked !== null)
    return (
      <div className="page">
        <header className="top">
          <BackButton t={t} onClick={() => setAsked(null)} />
          <strong>{t.charge}</strong>
        </header>
        <section className="card stack money ticket">
          <p className="muted">{t.askCustomer}</p>
          <div className="big">{group(asked, 2)} USDC</div>
          {rate && <div className="muted">≈ {fmtAr(asked * rate)}</div>}
          <div className="qr">
            <QRCodeSVG value={viaTanako ? makePayCode(p.address, asked) : p.address} size={240} marginSize={2} />
          </div>
          <strong>{t.network}</strong>
          <code className="addr">{p.address}</code>
          <label className="check">
            <input type="checkbox" checked={viaTanako} onChange={(e) => setViaTanako(e.target.checked)} />
            {t.tanakoCustomer}
          </label>
          <CopyButton t={t} text={p.address} />
        </section>
        <p className="pulse waiting">{t.waiting}</p>
        <CancelButton t={t} onClick={p.onClose} />
      </div>
    )

  return (
    <div className="page">
      <header className="top">
        <BackButton t={t} onClick={p.onClose} />
        <strong>{t.charge}</strong>
      </header>
      <section className="card stack money">
        <label className="field">
          <span>
            {t.amount} ({unit === 'MGA' ? 'Ar' : 'USD'})
          </span>
          <input
            className="amount"
            inputMode="decimal"
            autoFocus
            placeholder="0"
            value={groupTyped(input)}
            onChange={(e) => setInput(e.target.value.replace(/[^\d.,]/g, ''))}
          />
        </label>
        <div className="muted equals">{usd > 0 ? `= ${group(usd, 2)} USDC` : ' '}</div>
      </section>
      <button className="primary huge" disabled={!(usd > 0)} onClick={() => setAsked(usd)}>
        <Icon name="qr" />
        {t.showQr}
      </button>
    </div>
  )
}

function SettingsView(p: {
  t: Strings
  wallet: StoredWallet
  settings: Settings
  setSettings: (s: Settings) => void
  onClose: () => void
}) {
  const { t } = p
  const [pin, setPin] = useState('')
  const [phrase, setPhrase] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')

  return (
    <div className="page">
      <header className="top">
        <BackButton t={t} onClick={p.onClose} />
        <strong>{t.settings}</strong>
      </header>

      <section className="card stack">
        <div className="row">
          <span>{t.language}</span>
          <LangSwitch lang={p.settings.lang} onLang={(lang) => p.setSettings({ ...p.settings, lang })} />
        </div>
      </section>

      <DeviceCards t={t} wallet={p.wallet} lang={p.settings.lang} full />

      <section className="card stack">
        <span className="muted">{t.address}</span>
        <code className="addr">{p.wallet.address}</code>
        <span className="muted small">{t.network}</span>
        <a
          className="filebtn"
          href={`https://polygonscan.com/address/${p.wallet.address}#tokentxns`}
          target="_blank"
          rel="noreferrer"
        >
          {t.viewOnChain} ↗
        </a>
        {p.wallet.btc && (
          <a
            className="filebtn"
            href={`https://blockstream.info/address/${p.wallet.btc}`}
            target="_blank"
            rel="noreferrer"
          >
            {t.viewBtcOnChain} ↗
          </a>
        )}
        <p className="muted small">{t.viewNote}</p>
      </section>

      <section className="card stack">
        {!asking && !phrase && (
          <button className="secondary" onClick={() => setAsking(true)}>
            {t.backup}
          </button>
        )}
        {asking && !phrase && (
          <>
            <PinInput value={pin} onChange={setPin} label={t.enterPin} />
            {error && <p className="error">{error}</p>}
            <button
              className="primary"
              disabled={pin.length !== 6}
              onClick={async () => {
                const ph = await openWallet(p.wallet, pin)
                if (ph) {
                  setPhrase(ph)
                  setError('')
                } else setError(t.wrongPin)
              }}
            >
              {t.next}
            </button>
          </>
        )}
        {phrase && (
          <>
            <p className="warn">{t.phraseWarn}</p>
            <ol className="words">
              {phrase.split(' ').map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ol>
            <WordsDownload t={t} phrase={phrase} />
          </>
        )}
      </section>

      <details className="card help">
        <summary>{t.outsideTitle}</summary>
        <p className="small" style={{ marginTop: 10 }}>
          {t.outsideIntro}
        </p>
        <ol className="steps">
          <li>{t.outside1}</li>
          <li>{t.outside2}</li>
          <li>{t.outside3}</li>
          <li>{t.outside4}</li>
          <li>{t.outside5}</li>
        </ol>
        <p className="warn small" style={{ marginTop: 12 }}>
          {t.outsideWarn}
        </p>
      </details>

      <section className="card stack">
        <a
          className="filebtn"
          download={`tanako-backup-${p.wallet.address.slice(2, 8)}.json`}
          href={`data:application/json;charset=utf-8,${encodeURIComponent(backupJson(p.wallet, store.contacts()))}`}
        >
          {t.downloadBackup}
        </a>
        <p className="muted small">{t.backupNote}</p>
      </section>

      <PrivacyCards t={t} wallet={p.wallet} />

      <VersionCard t={t} />
    </div>
  )
}

/** What Tanako keeps and where, and the way to remove all of it. */
function PrivacyCards({ t, wallet }: { t: Strings; wallet: StoredWallet }) {
  const v = t.privacy
  const [asking, setAsking] = useState(false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function remove() {
    if (!(await openWallet(wallet, pin))) return setError(t.wrongPin)
    setBusy(true)
    await disablePush() // while the phone still knows its alert address
    store.wipe()
    location.reload()
  }

  return (
    <>
      <details className="card help">
        <summary>{v.title}</summary>
        <p className="small" style={{ marginTop: 10 }}>
          {v.intro}
        </p>
        {v.parts.map(([head, body]) => (
          <p className="small" style={{ marginTop: 10 }} key={head}>
            <b>{head}.</b> {body}
          </p>
        ))}
        <p className="muted small" style={{ marginTop: 10 }}>
          {v.contact.replace('{c}', '')}
          <a className="textlink" href={CONTACT} target="_blank" rel="noreferrer">
            {CONTACT.replace('https://', '')}
          </a>
          <br />
          {v.updated}
        </p>
      </details>

      <details className="card help">
        <summary>{v.removeTitle}</summary>
        <p className="small" style={{ marginTop: 10 }}>
          {v.removeIntro}
        </p>
        <ol className="steps">
          {v.removeSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <div className="stack" style={{ marginTop: 14 }}>
          {!asking ? (
            <button className="secondary" onClick={() => setAsking(true)}>
              {v.removeBtn}
            </button>
          ) : (
            <>
              <p className="warn small">{v.removeWarn}</p>
              <PinInput value={pin} onChange={setPin} label={t.enterPin} />
              {error && <p className="error">{error}</p>}
              <div className="row two">
                <button
                  className="secondary"
                  onClick={() => {
                    setAsking(false)
                    setPin('')
                    setError('')
                  }}
                >
                  {t.cancel}
                </button>
                <button className="secondary danger" disabled={pin.length !== 6 || busy} onClick={remove}>
                  {v.removeConfirm}
                </button>
              </div>
            </>
          )}
        </div>
      </details>
    </>
  )
}

/** Shows which build is running and whether a newer one is published. */
function VersionCard({ t }: { t: Strings }) {
  const [latest, setLatest] = useState<string | null | 'unknown'>(null)
  useEffect(() => {
    let live = true
    fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => live && setLatest(typeof j.build === 'string' ? j.build : 'unknown'))
      .catch(() => live && setLatest('unknown'))
    return () => {
      live = false
    }
  }, [])
  const outdated = latest !== null && latest !== 'unknown' && latest !== __BUILD__
  return (
    <section className="card stack">
      <p className="small">
        {t.version} <b style={{ fontFamily: "var(--mono)" }}>{__BUILD__}</b>
      </p>
      {latest === null ? null : latest === 'unknown' ? (
        <p className="muted small">{t.versionUnknown}</p>
      ) : outdated ? (
        <>
          <p className="warn small">{t.versionOld.replace('{v}', latest)}</p>
          <button onClick={() => location.reload()}>{t.versionUpdate}</button>
        </>
      ) : (
        <p className="muted small">{t.versionLatest}</p>
      )}
    </section>
  )
}

function Send(p: {
  t: Strings
  wallet: StoredWallet
  balance: number
  rate: number | null
  unit: 'MGA' | 'USD'
  saved: string
  onSaved: (address: string) => void
  contacts: Contact[]
  onContacts: (c: Contact[]) => void
  onSent: (x: Omit<Payment, 'rate'>) => void
  onClose: () => void
}) {
  const { t } = p
  const [to, setTo] = useState(p.saved)
  const [name, setName] = useState('')
  // An exact USDC amount (scanned code, or Max) that typing in ariary could not express.
  const [exact, setExact] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [pin, setPin] = useState('')
  const [state, setState] = useState<'form' | 'busy' | 'done'>('form')
  const [hash, setHash] = useState('')
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')

  // The fee is paid in USDC out of the balance; null until the fee service answers.
  const [fee, setFee] = useState<number | null | 'off'>(null)
  useEffect(() => {
    let live = true
    getRelayerInfo()
      .then((i) => live && setFee(Number(i.fee) / 1e6))
      .catch(() => live && setFee('off'))
    return () => {
      live = false
    }
  }, [])
  const feeNum = typeof fee === 'number' ? fee : 0

  // Amounts are typed in the currency chosen on the home screen.
  const rate = p.unit === 'MGA' && p.rate ? p.rate : null
  const typed = Number(amount.replace(',', '.'))
  const value = exact !== null ? Number(exact) : rate ? Math.floor((typed / rate) * 1e6) / 1e6 : typed
  const money = (usd: number) => (rate ? fmtAr(usd * rate) : `${group(usd, 2)} USDC`)
  const addressOk = isAddress(to.trim())
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  const known = addressOk ? p.contacts.find((c) => same(c.address, to.trim())) : undefined
  const saveContact = () => {
    const label = name.trim().slice(0, 30)
    if (!label || !addressOk || known) return
    p.onContacts([...p.contacts, { label, address: to.trim() }])
    setName('')
  }
  const tooMuch = value + feeNum > p.balance + 1e-9
  const ready = addressOk && value > 0 && !tooMuch && pin.length === 6 && typeof fee === 'number'

  const submit = async () => {
    setError('')
    setState('busy')
    try {
      const phrase = await openWallet(p.wallet, pin)
      if (!phrase) {
        setError(t.wrongPin)
        return setState('form')
      }
      const dest = to.trim() as `0x${string}`
      const done = await sendUsdc(phrase, dest, value.toFixed(6))
      setHash(done.hash)
      p.onSent({
        id: `${done.hash}-out`,
        tx: done.hash,
        from: p.wallet.address,
        to: dest,
        usd: value,
        fee: done.fee || undefined,
        token: 'USDC',
        block: 0,
        time: Date.now(),
        dir: 'out',
      })
      p.onSaved(dest)
      saveContact()
      setState('done')
    } catch (e) {
      const kind = e instanceof SendError ? e.kind : 'unknown'
      setError(
        { balance: t.errBalance, fee: t.errFee, relayer: t.errRelayer, failed: t.errFailed, unsure: t.errUnsure, earlier: t.errEarlier, unknown: t.errUnknown }[kind],
      )
      setState('form')
    }
  }

  if (scanning)
    return (
      <Scanner
        t={t}
        onClose={() => setScanning(false)}
        onCode={(text) => {
          const code = parsePayCode(text)
          if (!code) return false
          setTo(code.address)
          if (code.amount) {
            setExact(code.amount)
            setAmount(rate ? String(Math.round(Number(code.amount) * rate)) : code.amount)
          }
          setScanning(false)
          return true
        }}
      />
    )

  if (state === 'done')
    return (
      <div className="page center">
        <section className="stack result ok">
          <div className="tick">✓</div>
          <h1>{t.sent}</h1>
          <div className="big">{money(value)}</div>
          {rate && <div className="muted">{group(value, 2)} USDC</div>}
          <a className="textlink" href={`https://polygonscan.com/tx/${hash}`} target="_blank" rel="noreferrer">
            {t.viewTx} ↗
          </a>
          <a className="textlink" href="https://p2p.binance.com/" target="_blank" rel="noreferrer">
            {t.openBinance} ↗
          </a>
          <button className="primary" onClick={p.onClose}>
            {t.done}
          </button>
        </section>
      </div>
    )

  return (
    <div className="page">
      <header className="top">
        <BackButton t={t} onClick={p.onClose} />
        <strong>{t.sendTitle}</strong>
      </header>

      <section className="card stack">
        <button className="secondary" onClick={() => setScanning(true)}>
          <Icon name="qr" />
          {t.scan}
        </button>
        <label className="field">
          <span>{t.toAddress}</span>
          <input
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="0x…"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        {to.trim() !== '' && !addressOk && <p className="error">{t.badAddress}</p>}
        {known && (
          <p className="muted small">
            {t.savedAs} <b>{known.label}</b>
          </p>
        )}
        {addressOk && !known && (
          <div className="row">
            <input
              className="grow"
              maxLength={30}
              placeholder={t.saveName}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="secondary" disabled={!name.trim()} onClick={saveContact}>
              {t.saveBtn}
            </button>
          </div>
        )}
        {p.contacts.length > 0 && (
          <div className="field">
            <span>{t.savedTitle}</span>
            <div className="chips">
              {p.contacts.map((c) => (
                <span key={c.address} className={`chip${addressOk && same(c.address, to.trim()) ? ' on' : ''}`}>
                  <button onClick={() => setTo(c.address)}>{c.label}</button>
                  <button
                    aria-label={`${t.removeLabel} ${c.label}`}
                    onClick={() => {
                      if (window.confirm(t.removeAsk.replace('{n}', c.label)))
                        p.onContacts(p.contacts.filter((x) => x.address !== c.address))
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

      </section>

      <section className="card stack money">
        <label className="field">
          <span>
            {t.amountIn.replace('{u}', rate ? 'Ar' : 'USDC')} · {t.balance}: {rate ? fmtAr(p.balance * rate) : group(p.balance, 2)}
          </span>
          <div className="row">
            <input
              className="amount mid"
              inputMode="decimal"
              placeholder={rate ? '0' : '0.00'}
              value={groupTyped(amount)}
              onChange={(e) => {
                setExact(null)
                setAmount(e.target.value.replace(/[^\d.,]/g, ''))
              }}
            />
            <button
              className="secondary"
              onClick={() => {
                const all = (Math.max(0, Math.floor((p.balance - feeNum) * 100)) / 100).toFixed(2)
                setExact(all)
                setAmount(rate ? String(Math.floor(Number(all) * rate)) : all)
              }}
            >
              {t.max}
            </button>
          </div>
        </label>
        {rate && value > 0 && <p className="muted small">= {group(value, 2)} USDC</p>}
        {value > p.balance ? (
          <p className="error">{t.errBalance}</p>
        ) : (
          tooMuch && <p className="error">{t.errFee}</p>
        )}
        {typeof fee === 'number' && <p className="muted small">{t.sendFee.replace('{f}', String(fee)).replace('{ar}', p.rate ? fmtAr(Math.max(1, fee * p.rate)) : `$${fee}`)}</p>}
        {fee === 'off' && <p className="error">{t.sendOff}</p>}

      </section>

      <section className="stack">
        <PinInput value={pin} onChange={setPin} label={t.enterPin} />
        <p className="warn">{t.irreversible}</p>
        {error && <p className="error">{error}</p>}
        <button className="primary huge" disabled={!ready || state === 'busy'} onClick={() => void submit()}>
          <Icon name="out" />
          {state === 'busy' ? t.sending : t.sendBtn.replace('{a}', value > 0 ? money(value) : rate ? 'Ar' : 'USDC')}
        </button>
      </section>

      <details className="card help">
        <summary>{t.binanceHelp}</summary>
        <ol className="steps">
          <li>{t.step1}</li>
          <li>{t.step2}</li>
          <li>{t.step3}</li>
        </ol>
        <a
          className="filebtn"
          style={{ marginTop: 12 }}
          href="https://p2p.binance.com/en/trade/sell/USDC?fiat=MGA&payment=all-payments"
          target="_blank"
          rel="noreferrer"
        >
          {t.openBinance} ↗
        </a>
      </details>
    </div>
  )
}
