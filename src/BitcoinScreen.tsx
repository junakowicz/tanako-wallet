import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { BackButton, CancelButton, Tools } from './ui'
import { store } from './store'
import { group, groupTyped } from './format'
import { CopyButton, DOTS, EyeButton, Icon, fmtAr, fmtUsd, PinInput } from './App'
import {
  BtcError,
  btcAddressOf,
  getBtcBalance,
  getBtcTxs,
  getBtcUsd,
  getFeeRate,
  isBtcAddress,
  sendBtc,
  TYPICAL_TX_VBYTES,
  type BtcTx,
} from './btc'
import type { Lang, Strings } from './i18n'
import { Scanner } from './Scanner'
import { openWallet, type StoredWallet } from './wallet'

const POLL_MS = 20_000
const fmtSats = (n: number) => `${group(Math.round(n))} sats`

/** Reads a scanned Bitcoin code: a plain address or a "bitcoin:" link with an optional amount in BTC. */
function parseBtcCode(text: string): { address: string; sats?: number } | null {
  const m = text.trim().match(/^(?:bitcoin:)?([a-zA-Z0-9]+)(?:\?(.*))?$/i)
  if (!m || !isBtcAddress(m[1])) return null
  const amount = Number(new URLSearchParams(m[2] ?? '').get('amount'))
  return { address: m[1], sats: amount > 0 ? Math.round(amount * 1e8) : undefined }
}

export function Btc(p: {
  onHelp: () => void
  onSettings: () => void
  hidden: boolean
  onToggleHidden: () => void
  t: Strings
  wallet: StoredWallet
  onWallet: (w: StoredWallet) => void
  rate: number | null
  unit: 'MGA' | 'USD'
  lang: Lang
  onClose: () => void
}) {
  const { t, wallet } = p
  const address = wallet.btc
  const [view, setView] = useState<'main' | 'receive' | 'send' | 'charge'>('main')
  const [balance, setBalance] = useState<{ confirmed: number; pending: number } | null>(null)
  const [price, setPrice] = useState<number | null>(null)
  const [txs, setTxs] = useState<BtcTx[]>([])
  const [online, setOnline] = useState(true)
  // Shared with the home screen: hiding amounts there hides them here too.
  const { hidden } = p
  // The balance can be read in bitcoin, dollars or ariary; the choice is kept on this phone.
  const [unit, setUnitState] = useState<'BTC' | 'USD' | 'MGA'>(() => store.btcUnit() ?? p.unit)
  const setUnit = (u: 'BTC' | 'USD' | 'MGA') => {
    store.setBtcUnit(u)
    setUnitState(u)
  }
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!address) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const [b, x, usd] = await Promise.all([getBtcBalance(address), getBtcTxs(address), getBtcUsd()])
        if (stopped) return
        setBalance(b)
        setTxs(x)
        setPrice(usd)
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
  }, [address])

  const header = (title: string, back: () => void) => (
    <header className="top">
      <BackButton t={t} onClick={back} />
      <strong>{title}</strong>
    </header>
  )

  // Wallets saved before Bitcoin was added: derive the address once.
  if (!address)
    return (
      <div className="page theme-btc">
        {header(t.bitcoin, p.onClose)}
        <section className="stack">
          <p>{t.btcActivate}</p>
          <PinInput value={pin} onChange={setPin} label={t.enterPin} />
          {error && <p className="error">{error}</p>}
          <button
            className="primary"
            disabled={pin.length !== 6}
            onClick={async () => {
              const phrase = await openWallet(wallet, pin)
              if (!phrase) return setError(t.wrongPin)
              p.onWallet({ ...wallet, btc: btcAddressOf(phrase) })
            }}
          >
            {t.next}
          </button>
        </section>
      </div>
    )

  const total = balance ? balance.confirmed + balance.pending : 0
  const value = (sats: number) => {
    if (!price || unit === 'BTC') return fmtSats(sats)
    const usd = (sats / 1e8) * price
    return unit === 'MGA' && p.rate ? fmtAr(usd * p.rate) : fmtUsd(usd)
  }
  // Amounts are typed in money, never in bitcoin: fall back to the home screen's currency.
  const moneyUnit = unit === 'BTC' ? p.unit : unit
  const money = (sats: number) => {
    if (!price) return fmtSats(sats)
    const usd = (sats / 1e8) * price
    return moneyUnit === 'MGA' && p.rate ? fmtAr(usd * p.rate) : fmtUsd(usd)
  }

  if (view === 'receive')
    return (
      <div className="page theme-btc center">
        <section className="stack">
          <h2>
            {t.receive} · {t.bitcoin}
          </h2>
          <div className="qr">
            <QRCodeSVG value={address} size={240} marginSize={2} />
          </div>
          <code className="addr">{address}</code>
          <p className="muted">{t.btcReceiveNote}</p>
          <CopyButton t={t} text={address} />
          <BackButton t={t} label onClick={() => setView('main')} />
        </section>
      </div>
    )

  if (view === 'charge' && price)
    return (
      <BtcCharge
        t={t}
        address={address}
        price={price}
        rate={p.rate}
        unit={moneyUnit}
        value={money}
        onClose={() => setView('main')}
      />
    )

  if (view === 'send')
    return <BtcSend t={t} wallet={wallet} available={balance?.confirmed ?? 0} value={money} onClose={() => setView('main')} />

  return (
    <div className="page theme-btc">
      <header className="top">
        <BackButton t={t} onClick={p.onClose} />
        <Tools t={t} onHelp={p.onHelp} onSettings={p.onSettings} />
      </header>
      <div className="btc-mark">₿ {t.bitcoin}</div>
      {!online && <p className="banner">{t.offline}</p>}

      <section className="card balance">
        <div className="row">
          <span className="muted">
            {t.balance}
            <EyeButton t={t} hidden={hidden} onToggle={p.onToggleHidden} />
          </span>
          <div className="seg three" role="group" aria-label="Currency">
            {(['BTC', 'USD', 'MGA'] as const).map((u) => (
              <button key={u} className={unit === u ? 'on' : ''} aria-pressed={unit === u} onClick={() => setUnit(u)}>
                {u === 'MGA' ? 'Ar' : u === 'BTC' ? '₿' : 'USD'}
              </button>
            ))}
          </div>
        </div>
        <div className={`big${unit === 'BTC' ? ' long' : ''}`}>
          {balance ? (hidden ? DOTS : unit === 'BTC' ? `${(total / 1e8).toFixed(8)} BTC` : value(total)) : '—'}
        </div>
        <div className="muted">{balance && !hidden ? fmtSats(total) : ''}</div>
        {balance && balance.pending !== 0 && !hidden && (
          <div className="muted small">
            {fmtSats(balance.pending)} {t.btcPending}
          </div>
        )}
      </section>

      <button className="primary huge" disabled={!price} onClick={() => setView('charge')}>
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
          {t.sendBtcBtn}
        </button>
      </div>

      <section>
        <h3>{t.recent}</h3>
        {txs.length === 0 && <p className="muted">{t.none}</p>}
        <ul className="list">
          {txs.map((x) => (
            <li key={x.txid}>
              <Icon name={x.sats > 0 ? 'in' : 'out'} />
              <div>
                <strong>
                  {x.sats > 0 ? '+' : '−'}
                  {hidden ? DOTS : value(Math.abs(x.sats))}
                </strong>
                <div className="muted small">
                  {x.time
                    ? new Date(x.time).toLocaleString(p.lang === 'en' ? 'en-GB' : 'fr-FR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })
                    : t.btcPending}
                </div>
              </div>
              <a href={`https://blockstream.info/tx/${x.txid}`} target="_blank" rel="noreferrer">
                {hidden ? '' : `${fmtSats(Math.abs(x.sats))} `}↗
              </a>
            </li>
          ))}
        </ul>
      </section>
      <p className="muted small">
        {t.btcNote} {t.btcSafe}
      </p>
    </div>
  )
}

function BtcSend(p: {
  t: Strings
  wallet: StoredWallet
  available: number
  value: (sats: number) => string
  onClose: () => void
}) {
  const { t } = p
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [max, setMax] = useState(false)
  const [pin, setPin] = useState('')
  const [state, setState] = useState<'form' | 'busy' | 'done'>('form')
  const [txid, setTxid] = useState('')
  const [error, setError] = useState('')
  const [scanning, setScanning] = useState(false)

  const sats = Number(amount)
  const addressOk = isBtcAddress(to)
  const ready = addressOk && (max || (sats > 0 && sats <= p.available)) && p.available > 0 && pin.length === 6

  const submit = async () => {
    setError('')
    setState('busy')
    try {
      const phrase = await openWallet(p.wallet, pin)
      if (!phrase) {
        setError(t.wrongPin)
        return setState('form')
      }
      setTxid(await sendBtc(phrase, to, max ? 'max' : sats))
      setState('done')
    } catch (e) {
      const kind = e instanceof BtcError ? e.kind : 'network'
      setError({ balance: t.errBalance.replace('USDC', 'BTC'), address: t.badAddress, network: t.errNetwork }[kind])
      setState('form')
    }
  }

  if (scanning)
    return (
      <Scanner
        t={t}
        onClose={() => setScanning(false)}
        onCode={(text) => {
          const code = parseBtcCode(text)
          if (!code) return false
          setTo(code.address)
          if (code.sats) {
            setAmount(String(code.sats))
            setMax(false)
          }
          setScanning(false)
          return true
        }}
      />
    )

  if (state === 'done')
    return (
      <div className="page theme-btc center">
        <section className="stack result ok">
          <div className="tick">✓</div>
          <h1>{t.sent}</h1>
          <a className="textlink" href={`https://blockstream.info/tx/${txid}`} target="_blank" rel="noreferrer">
            {t.viewTx} ↗
          </a>
          <button className="primary" onClick={p.onClose}>
            {t.done}
          </button>
        </section>
      </div>
    )

  return (
    <div className="page theme-btc">
      <header className="top">
        <BackButton t={t} onClick={p.onClose} />
        <strong>{t.sendBtcBtn}</strong>
      </header>

      <section className="card stack">
        <button className="secondary" onClick={() => setScanning(true)}>
          <Icon name="qr" />
          {t.scan}
        </button>
        <label className="field">
          <span>{t.toBtcAddress}</span>
          <input
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="bc1…"
            value={to}
            onChange={(e) => setTo(e.target.value.trim())}
          />
        </label>
        {to !== '' && !addressOk && <p className="error">{t.badAddress}</p>}
      </section>

      <section className="card stack money">
        <label className="field">
          <span>
            {t.amountSats} · {t.balance}: {group(p.available)}
          </span>
          <div className="row">
            <input
              className="amount mid"
              inputMode="numeric"
              placeholder="0"
              value={max ? t.max : groupTyped(amount)}
              onChange={(e) => {
                setMax(false)
                setAmount(e.target.value.replace(/\D/g, ''))
              }}
            />
            <button className="secondary" onClick={() => setMax(true)}>
              {t.max}
            </button>
          </div>
        </label>
        {!max && sats > 0 && <p className="muted small">≈ {p.value(sats)}</p>}
        {!max && sats > p.available && <p className="error">{t.errBalance.replace('USDC', 'BTC')}</p>}
      </section>

      <section className="stack">
        <PinInput value={pin} onChange={setPin} label={t.enterPin} />
        <p className="warn">
          {t.irreversible} {t.btcFeeNote}
        </p>
        {error && <p className="error">{error}</p>}
        <button className="primary huge" disabled={!ready || state === 'busy'} onClick={() => void submit()}>
          <Icon name="out" />
          {state === 'busy' ? t.sending : t.sendBtcBtn}
        </button>
      </section>
    </div>
  )
}

const CHARGE_POLL_MS = 5000

function BtcCharge(p: {
  t: Strings
  address: string
  price: number
  rate: number | null
  unit: 'MGA' | 'USD'
  value: (sats: number) => string
  onClose: () => void
}) {
  const { t } = p
  const unit = p.unit === 'MGA' && p.rate ? 'MGA' : 'USD'
  const [input, setInput] = useState('')
  const [asked, setAsked] = useState<number | null>(null) // sats requested
  const [got, setGot] = useState<BtcTx | null>(null)
  const [feeRate, setFeeRate] = useState<number | null>(null)

  useEffect(() => {
    getFeeRate().then(setFeeRate, () => setFeeRate(null))
  }, [])

  // Watch the address: first for a new incoming payment, then for its confirmation.
  useEffect(() => {
    if (asked === null || got?.confirmed) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    let known: Set<string> | null = null
    const tick = async () => {
      try {
        const txs = await getBtcTxs(p.address)
        if (stopped) return
        if (got) {
          const now = txs.find((x) => x.txid === got.txid)
          if (now?.confirmed) setGot(now)
        } else if (!known) {
          known = new Set(txs.map((x) => x.txid))
        } else {
          const fresh = txs.find((x) => !known!.has(x.txid) && x.sats > 0)
          if (fresh) setGot(fresh)
        }
      } catch {
        /* keep trying */
      }
      if (!stopped) timer = setTimeout(tick, CHARGE_POLL_MS)
    }
    void tick()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [asked, got, p.address])

  const number = Number(input.replace(',', '.'))
  const usd = unit === 'MGA' && p.rate ? number / p.rate : number
  const sats = Math.ceil((usd / p.price) * 1e8)

  const feeSats = feeRate ? Math.ceil(feeRate * TYPICAL_TX_VBYTES) : null
  const feeLine = feeSats !== null && feeRate !== null && (
    <p className="card small">
      <strong>{feeRate <= 5 ? t.feeCheap : feeRate <= 30 ? t.feeNormal : t.feeHigh}.</strong>{' '}
      {t.btcFeeToday.replace('{f}', p.value(feeSats))}
    </p>
  )

  if (got && asked !== null) {
    const short = got.sats < asked
    return (
      <div className="page theme-btc center">
        <section className={`stack result ${short ? 'short' : 'ok'}`}>
          <div className="tick">{short ? '!' : got.confirmed ? '✓' : '…'}</div>
          <h1>{got.confirmed ? t.btcConfirmed : t.btcSeen}</h1>
          <div className="big">{p.value(got.sats)}</div>
          <div className="muted">{fmtSats(got.sats)}</div>
          {short && (
            <p className="error">
              {t.less}: {fmtSats(asked)}
            </p>
          )}
          {!got.confirmed && <p className="warn">{t.btcSeenNote}</p>}
          <button className="primary" onClick={p.onClose}>
            {t.done}
          </button>
        </section>
      </div>
    )
  }

  if (asked !== null)
    return (
      <div className="page theme-btc">
        <header className="top">
          <BackButton t={t} onClick={() => setAsked(null)} />
          <strong>{t.charge}</strong>
        </header>
        <section className="card stack money ticket">
          <p className="muted">{t.askCustomer}</p>
          <div className="big">{fmtSats(asked)}</div>
          <div className="muted">
            {(asked / 1e8).toFixed(8)} BTC · ≈ {p.value(asked)}
          </div>
          <div className="qr">
            <QRCodeSVG value={`bitcoin:${p.address}?amount=${(asked / 1e8).toFixed(8)}`} size={240} marginSize={2} />
          </div>
          <strong>{t.btcNetwork}</strong>
          <code className="addr">{p.address}</code>
          <CopyButton t={t} text={p.address} />
        </section>
        {feeLine}
        <p className="pulse waiting">{t.waiting}</p>
        <CancelButton t={t} onClick={p.onClose} />
      </div>
    )

  return (
    <div className="page theme-btc">
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
        <div className="muted equals">{sats > 0 ? `= ${fmtSats(sats)}` : ' '}</div>
      </section>
      {feeLine}
      <button className="primary huge" disabled={!(sats > 0)} onClick={() => setAsked(sats)}>
        <Icon name="qr" />
        {t.showQr}
      </button>
    </div>
  )
}
