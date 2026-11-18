// Payment alerts that reach a phone even when Tanako is closed.
//
// A phone that turns alerts on registers here: its push address (given by
// the phone's own push service) together with the wallet addresses to watch.
// Once a minute the watcher looks at the public networks for money arriving
// at those addresses and pushes a notification. Wallet addresses are public;
// this server never sees keys, PINs or recovery words.
import { createHash } from 'node:crypto'
import { createPublicClient, fallback, http, isAddress, parseAbiItem } from 'viem'
import { polygon } from 'viem/chains'
import * as webpush from 'web-push'
import { APP_URL, VAPID_PUBLIC_KEY } from './config.js'

const TOKENS = ['0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174']
const RPCS = ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.gateway.tenderly.co']
const ESPLORA = ['https://blockstream.info/api', 'https://mempool.space/api']
const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
const CONFIRMATIONS = 3
const MAX_CATCHUP = 3000 // blocks; older payments are not announced
const BLOCK_CHUNK = 500
const ADDRESS_CHUNK = 100
const MIN_UNITS = 10_000n // ignore dust under 0.01 USDC
const MAX_PER_ADDRESS = 5 // phones per wallet
const MAX_BTC_PER_RUN = 40
// Only real phone push services may be called.
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/
const BTC_ADDRESS = /^bc1[a-z0-9]{20,80}$/

const TITLE = { en: 'Money received', fr: 'Argent reçu', mg: 'Vola voaray' }
const idOf = (endpoint) => createHash('sha256').update(endpoint).digest('hex')
const fmtAr = (n) => `${Math.round(n).toLocaleString('fr-FR')} Ar`

export function createPush({ db, vapidPrivateKey, log = console }) {
  webpush.setVapidDetails(APP_URL, VAPID_PUBLIC_KEY, vapidPrivateKey)
  const subs = db.collection('subs')
  const pub = createPublicClient({ chain: polygon, transport: fallback(RPCS.map((u) => http(u, { timeout: 10_000 }))) })

  function validEndpoint(endpoint) {
    try {
      const u = new URL(endpoint)
      return u.protocol === 'https:' && PUSH_HOSTS.test(u.hostname) && endpoint.length < 1000
    } catch {
      return false
    }
  }

  /** HTTP routes under /api/push. Returns [status, json]. */
  async function handle(method, route, body) {
    if (method === 'GET' && route === '/push/key') return [200, { key: VAPID_PUBLIC_KEY }]
    if (method === 'POST' && route === '/push/subscribe') {
      const s = body?.subscription
      const address = String(body?.address ?? '').toLowerCase()
      const btc = body?.btc ? String(body.btc).toLowerCase() : null
      const lang = ['en', 'fr', 'mg'].includes(body?.lang) ? body.lang : 'fr'
      if (!s || !validEndpoint(s.endpoint) || typeof s.keys?.p256dh !== 'string' || typeof s.keys?.auth !== 'string')
        return [400, { error: 'bad subscription' }]
      if (s.keys.p256dh.length > 200 || s.keys.auth.length > 100) return [400, { error: 'bad subscription' }]
      if (!isAddress(address) || (btc && !BTC_ADDRESS.test(btc))) return [400, { error: 'bad address' }]
      const id = idOf(s.endpoint)
      const same = await subs.where('address', '==', address).limit(MAX_PER_ADDRESS + 1).get()
      if (same.size >= MAX_PER_ADDRESS && !same.docs.some((d) => d.id === id))
        return [429, { error: 'too many phones for this wallet' }]
      await subs.doc(id).set({
        endpoint: s.endpoint,
        keys: { p256dh: s.keys.p256dh, auth: s.keys.auth },
        address,
        btc,
        lang,
        updated: Date.now(),
      })
      return [200, { ok: true }]
    }
    if (method === 'POST' && route === '/push/unsubscribe') {
      if (typeof body?.endpoint !== 'string') return [400, { error: 'bad request' }]
      const ref = subs.doc(idOf(body.endpoint))
      const btc = (await ref.get()).data()?.btc
      await ref.delete()
      // The last phone watching a Bitcoin address takes its watch record with it.
      if (btc && (await subs.where('btc', '==', btc).limit(1).get()).empty) await db.doc(`btc/${btc}`).delete()
      return [200, { ok: true }]
    }
    return [404, { error: 'not found' }]
  }

  async function send(sub, payload) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload), { TTL: 3600 })
    } catch (e) {
      // The phone removed the app or turned alerts off: forget it.
      if (e.statusCode === 404 || e.statusCode === 410) await subs.doc(idOf(sub.endpoint)).delete()
      else log.error('push failed', e.statusCode ?? e.message)
    }
  }

  let rate = { ar: 0, at: 0 }
  async function arPerUsd() {
    if (Date.now() - rate.at < 3_600_000) return rate.ar
    try {
      const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(8000) })
      const ar = Number((await r.json()).rates.MGA)
      if (ar > 0) rate = { ar, at: Date.now() }
    } catch {
      /* fall back to the last known rate, or to dollars only */
    }
    return rate.ar
  }
  async function btcUsd() {
    try {
      const r = await fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot', { signal: AbortSignal.timeout(8000) })
      return Number((await r.json()).data.amount) || 0
    } catch {
      return 0
    }
  }

  async function watchUsdc(all) {
    const state = db.doc('state/usdc')
    const head = Number(await pub.getBlockNumber()) - CONFIRMATIONS
    const last = (await state.get()).data()?.lastBlock
    if (typeof last !== 'number') return state.set({ lastBlock: head }) // first run: start from now
    const from = Math.max(last + 1, head - MAX_CATCHUP)
    if (from > head) return
    const byAddress = new Map()
    for (const s of all) byAddress.set(s.address, [...(byAddress.get(s.address) ?? []), s])
    const addresses = [...byAddress.keys()]
    const logs = []
    for (let a = 0; a < addresses.length; a += ADDRESS_CHUNK)
      for (let b = from; b <= head; b += BLOCK_CHUNK)
        logs.push(
          ...(await pub.getLogs({
            address: TOKENS,
            event: TRANSFER,
            args: { to: addresses.slice(a, a + ADDRESS_CHUNK) },
            fromBlock: BigInt(b),
            toBlock: BigInt(Math.min(b + BLOCK_CHUNK - 1, head)),
          })),
        )
    // Move the marker before sending: a payment is announced at most once.
    await state.set({ lastBlock: head })
    const ar = logs.length ? await arPerUsd() : 0
    for (const l of logs) {
      if (l.args.value < MIN_UNITS) continue
      const usd = Number(l.args.value) / 1e6
      const body = ar ? `+ ${fmtAr(usd * ar)} (${usd.toFixed(2)} USDC)` : `+ ${usd.toFixed(2)} USDC`
      for (const s of byAddress.get(l.args.to.toLowerCase()) ?? [])
        await send(s, { title: TITLE[s.lang], body, tag: `tanako-${l.transactionHash}` })
    }
    return logs.length
  }

  async function btcTxs(address) {
    for (const base of ESPLORA) {
      try {
        const r = await fetch(`${base}/address/${address}/txs`, { signal: AbortSignal.timeout(8000) })
        if (r.ok) return await r.json()
      } catch {
        /* try the next source */
      }
    }
    throw new Error('no bitcoin source')
  }

  async function watchBtc(all) {
    const byAddress = new Map()
    for (const s of all) if (s.btc) byAddress.set(s.btc, [...(byAddress.get(s.btc) ?? []), s])
    // With many wallets, look at a rotating slice each minute.
    const list = [...byAddress.keys()].sort()
    const start = list.length > MAX_BTC_PER_RUN ? (Math.floor(Date.now() / 60_000) * MAX_BTC_PER_RUN) % list.length : 0
    const slice = list.length > MAX_BTC_PER_RUN ? [...list, ...list].slice(start, start + MAX_BTC_PER_RUN) : list
    let price = 0
    let ar = 0
    for (const address of slice) {
      try {
        const txs = await btcTxs(address)
        const ref = db.doc(`btc/${address}`)
        const seen = (await ref.get()).data()?.seen
        await ref.set({ seen: txs.map((t) => t.txid).slice(0, 50) })
        if (!seen) continue // first look: remember, do not announce history
        for (const t of txs) {
          if (seen.includes(t.txid)) continue
          const inn = t.vout.filter((o) => o.scriptpubkey_address === address).reduce((n, o) => n + o.value, 0)
          const out = t.vin.filter((i) => i.prevout?.scriptpubkey_address === address).reduce((n, i) => n + i.prevout.value, 0)
          const sats = inn - out
          if (sats <= 0) continue
          price ||= await btcUsd()
          ar ||= await arPerUsd()
          const text = `${sats.toLocaleString('fr-FR')} sats`
          const body = price && ar ? `+ ${fmtAr((sats / 1e8) * price * ar)} (${text})` : `+ ${text}`
          for (const s of byAddress.get(address)) await send(s, { title: TITLE[s.lang], body, tag: `tanako-${t.txid}` })
        }
      } catch (e) {
        log.error('bitcoin watch failed for one address:', e.message)
      }
    }
  }

  /** One round of watching: called every minute. */
  async function watch() {
    const snap = await subs.limit(5000).get()
    const all = snap.docs.map((d) => d.data())
    if (!all.length) {
      // Nobody to tell: just keep the marker current so old payments are never announced later.
      return db.doc('state/usdc').set({ lastBlock: Number(await pub.getBlockNumber()) - CONFIRMATIONS })
    }
    await watchUsdc(all).catch((e) => log.error('usdc watch failed:', e.shortMessage ?? e.message))
    await watchBtc(all)
  }

  return { handle, watch }
}
