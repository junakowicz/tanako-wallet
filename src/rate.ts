// USD to Ariary reference rate. Display only: balances are always USDC.
import { store } from './store'

const URL = 'https://open.er-api.com/v6/latest/USD'
const MAX_AGE = 60 * 60 * 1000

export async function loadRate(): Promise<{ rate: number; at: number } | null> {
  const cached = store.rate()
  if (cached && Date.now() - cached.at < MAX_AGE) return cached
  try {
    const r = await fetch(URL)
    const j = await r.json()
    const rate = Number(j?.rates?.MGA)
    if (rate > 0) {
      store.setRate(rate)
      return { rate, at: Date.now() }
    }
  } catch {
    /* offline: fall back to the last known rate */
  }
  return cached
}
