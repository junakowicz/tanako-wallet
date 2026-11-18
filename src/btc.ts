// On-chain Bitcoin, kept deliberately plain so funds can never get stuck:
// one standard native-segwit address (BIP84, m/84'/0'/0'/0/0) derived from the
// same 12 words. Any Bitcoin wallet restores it from those words, with or
// without Tanako and with or without any Lightning service.
import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync } from '@scure/bip39'
import { hex } from '@scure/base'
import { Address, NETWORK, p2wpkh, selectUTXO } from '@scure/btc-signer'

const PATH = "m/84'/0'/0'/0/0"
// Two independent public block explorers with the same API; the second is a fallback.
const APIS = ['https://blockstream.info/api', 'https://mempool.space/api']

export type Utxo = { txid: string; vout: number; value: number }
export type BtcTx = { txid: string; sats: number; confirmed: boolean; time: number | null }

const clean = (phrase: string) => phrase.trim().toLowerCase().replace(/\s+/g, ' ')

function keyOf(phrase: string) {
  const key = HDKey.fromMasterSeed(mnemonicToSeedSync(clean(phrase))).derive(PATH)
  if (!key.privateKey || !key.publicKey) throw new Error('key derivation failed')
  return { priv: key.privateKey, pay: p2wpkh(key.publicKey) }
}

export function btcAddressOf(phrase: string): string {
  return keyOf(phrase).pay.address!
}

export function isBtcAddress(address: string): boolean {
  try {
    Address(NETWORK).decode(address.trim())
    return true
  } catch {
    return false
  }
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  let last: unknown
  for (const api of APIS) {
    try {
      const r = await fetch(`${api}${path}`, { ...init, signal: AbortSignal.timeout(10_000) })
      if (r.ok) return r
      last = new Error(`${api} ${r.status} ${await r.text()}`)
    } catch (e) {
      last = e
    }
  }
  throw last
}

async function get<T>(path: string): Promise<T> {
  return (await request(path)).json() as Promise<T>
}

type Stats = { funded_txo_sum: number; spent_txo_sum: number }

/** Balance in sats: confirmed, and still-unconfirmed movement. */
export async function getBtcBalance(address: string): Promise<{ confirmed: number; pending: number }> {
  const a = await get<{ chain_stats: Stats; mempool_stats: Stats }>(`/address/${address}`)
  return {
    confirmed: a.chain_stats.funded_txo_sum - a.chain_stats.spent_txo_sum,
    pending: a.mempool_stats.funded_txo_sum - a.mempool_stats.spent_txo_sum,
  }
}

type RawTx = {
  txid: string
  vin: { prevout: { scriptpubkey_address?: string; value: number } | null }[]
  vout: { scriptpubkey_address?: string; value: number }[]
  status: { confirmed: boolean; block_time?: number }
}

/** Recent transactions with the net effect on this address (positive = received). */
export async function getBtcTxs(address: string): Promise<BtcTx[]> {
  const txs = await get<RawTx[]>(`/address/${address}/txs`)
  return txs.map((t) => {
    const incoming = t.vout.filter((o) => o.scriptpubkey_address === address).reduce((s, o) => s + o.value, 0)
    const outgoing = t.vin
      .filter((i) => i.prevout?.scriptpubkey_address === address)
      .reduce((s, i) => s + (i.prevout?.value ?? 0), 0)
    return {
      txid: t.txid,
      sats: incoming - outgoing,
      confirmed: t.status.confirmed,
      time: t.status.block_time ? t.status.block_time * 1000 : null,
    }
  })
}

export async function getBtcUsd(): Promise<number> {
  const r = await fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot', { signal: AbortSignal.timeout(10_000) })
  const price = Number((await r.json())?.data?.amount)
  if (!(price > 0)) throw new Error('no price')
  return price
}

/** Fee rate in sat/vB aimed at confirmation within about three blocks. */
export async function getFeeRate(): Promise<number> {
  const estimates = await get<Record<string, number>>('/fee-estimates')
  return Math.max(1, estimates['3'] ?? estimates['6'] ?? 2)
}

/** Size in vbytes of an ordinary payment: one input, payment plus change. */
export const TYPICAL_TX_VBYTES = 141

export type BtcFailure = 'balance' | 'address' | 'network'
export class BtcError extends Error {
  constructor(public kind: BtcFailure, detail?: string) {
    super(detail ?? kind)
  }
}

/**
 * Builds and signs a transaction. `sats` is the amount to send, or 'max' to
 * empty the address. Pure: no network access, so it can be tested offline.
 */
export function buildBtcTx(phrase: string, utxos: Utxo[], to: string, sats: number | 'max', feeRate: number) {
  const { priv, pay } = keyOf(phrase)
  const dest = to.trim()
  if (!isBtcAddress(dest)) throw new BtcError('address')
  const inputs = utxos.map((u) => ({
    txid: hex.decode(u.txid),
    index: u.vout,
    witnessUtxo: { amount: BigInt(u.value), script: pay.script },
  }))
  const opts = { feePerByte: BigInt(Math.max(1, Math.ceil(feeRate))), bip69: true, createTx: true, network: NETWORK }
  const picked =
    sats === 'max'
      ? // Everything goes to the destination as the single "change" output.
        selectUTXO(inputs, [], 'all', { ...opts, changeAddress: dest, alwaysChange: true })
      : selectUTXO(inputs, [{ address: dest, amount: BigInt(sats) }], 'default', {
          ...opts,
          changeAddress: pay.address!,
        })
  if (!picked?.tx) throw new BtcError('balance')
  picked.tx.sign(priv)
  picked.tx.finalize()
  return { hex: picked.tx.hex, txid: picked.tx.id, fee: Number(picked.fee) }
}

/** Sends bitcoin. Resolves with the transaction id once broadcast. */
export async function sendBtc(phrase: string, to: string, sats: number | 'max'): Promise<string> {
  const from = btcAddressOf(phrase)
  let utxos: Utxo[]
  let rate: number
  try {
    ;[utxos, rate] = await Promise.all([
      get<Utxo[]>(`/address/${from}/utxo`),
      getFeeRate(),
    ])
  } catch (e) {
    throw new BtcError('network', String(e))
  }
  const tx = buildBtcTx(phrase, utxos, to, sats, rate)
  try {
    await request('/tx', { method: 'POST', body: tx.hex })
  } catch (e) {
    throw new BtcError('network', String(e))
  }
  return tx.txid
}
