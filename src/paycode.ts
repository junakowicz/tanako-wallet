// What a payment QR code can contain.
//
// A plain address is what other wallets and exchanges understand, so it is
// the default. A "tanako:" code also carries the amount, so a customer paying
// from Tanako does not have to type it.
import { isAddress } from 'viem'

export type PayCode = { address: `0x${string}`; amount?: string }

export function makePayCode(address: string, usd: number): string {
  return `tanako:${address}?amount=${usd.toFixed(2)}`
}

export function parsePayCode(text: string): PayCode | null {
  const s = text.trim()
  if (isAddress(s)) return { address: s }
  const m = s.match(/^(?:tanako|ethereum):(0x[0-9a-fA-F]{40})(?:@\d+)?(?:\?(.*))?$/)
  if (!m || !isAddress(m[1])) return null
  const amount = new URLSearchParams(m[2] ?? '').get('amount')
  return { address: m[1], amount: amount && /^\d+(\.\d{1,6})?$/.test(amount) ? amount : undefined }
}
