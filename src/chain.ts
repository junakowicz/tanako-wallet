// Reads USDC on Polygon: balance and incoming transfers to the merchant.
import { createPublicClient, erc20Abi, fallback, formatUnits, http, parseAbiItem } from 'viem'
import { polygon } from 'viem/chains'

export const TOKENS = [
  { symbol: 'USDC', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' },
  { symbol: 'USDC.e', address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' },
] as const
const DECIMALS = 6
// Smallest transfer treated as a payment: 0.01 USDC.
const MIN_UNITS = 10_000n

export const RPCS = [
  // Both checked to serve filtered transfer lookups over 2,000 blocks.
  'https://polygon-bor-rpc.publicnode.com',
  'https://polygon.gateway.tenderly.co',
]

export const client = createPublicClient({
  chain: polygon,
  transport: fallback(RPCS.map((u) => http(u, { timeout: 10_000 }))),
})

const transferEvent = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
)

// Blocks held back from the chain tip before a payment is shown as received.
export const CONFIRMATIONS = 3
// Largest block span asked for in one request (public nodes cap this).
const CHUNK = 500
// How far back the app looks after being closed (about 6 hours on Polygon).
export const MAX_CATCHUP = 10_000

export type Incoming = {
  id: string
  tx: string
  from: string
  usd: number
  token: string
  block: number
}

export async function getBalance(owner: `0x${string}`): Promise<number> {
  const parts = await Promise.all(
    TOKENS.map((t) =>
      client.readContract({ address: t.address, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }),
    ),
  )
  return parts.reduce((sum, v) => sum + Number(formatUnits(v, DECIMALS)), 0)
}

export async function safeHead(): Promise<number> {
  return Number(await client.getBlockNumber()) - CONFIRMATIONS
}

/** Incoming USDC transfers to `owner` in blocks [from, to], inclusive. */
export async function getIncoming(owner: `0x${string}`, from: number, to: number): Promise<Incoming[]> {
  const out: Incoming[] = []
  for (let start = from; start <= to; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, to)
    const logs = await client.getLogs({
      address: TOKENS.map((t) => t.address),
      event: transferEvent,
      args: { to: owner },
      fromBlock: BigInt(start),
      toBlock: BigInt(end),
    })
    for (const l of logs) {
      // Zero and dust transfers are spam ("address poisoning"), not payments.
      if (l.args.value === undefined || !l.args.from || l.args.value < MIN_UNITS) continue
      const token = TOKENS.find((t) => t.address.toLowerCase() === l.address.toLowerCase())
      out.push({
        id: `${l.transactionHash}-${l.logIndex}`,
        tx: l.transactionHash,
        from: l.args.from,
        usd: Number(formatUnits(l.args.value, DECIMALS)),
        token: token?.symbol ?? 'USDC',
        block: Number(l.blockNumber),
      })
    }
  }
  return out
}
