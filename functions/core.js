// Tanako fee service.
//
// Merchants hold only USDC. To send it, their wallet signs two USDC transfer
// authorizations (EIP-3009): the payment itself and a small fee in USDC to
// this service. The service broadcasts both in one transaction (both happen
// or neither) and pays the network fee in POL from its own wallet.
//
// It keeps itself funded: when its POL runs low it swaps some of the USDC it
// has earned for POL, and it forwards earnings above a cap to the owner.
// It never holds merchant keys and cannot change a recipient or an amount.
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  fallback,
  formatUnits,
  http,
  isAddress,
  isHex,
  keccak256,
  parseAbi,
  parseSignature,
  parseUnits,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { polygon } from 'viem/chains'

export const USDC = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'
export const WPOL = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'
export const SWAP_ROUTER = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45' // Uniswap v3 SwapRouter02
const ROUTER_ITSELF = '0x0000000000000000000000000000000000000002' // router's marker for "keep it, I will unwrap"
export const POOL_FEE = 500 // USDC/WPOL 0.05% pool
const RPCS = [
  'https://polygon-bor-rpc.publicnode.com',
  'https://polygon.gateway.tenderly.co',
  'https://polygon.drpc.org',
  'https://1rpc.io/matic',
]
const CONFIRM_MS = 40_000 // how long a send may take before the service gives up on it
const MIN_TIP = 30_000_000_000n // 30 gwei: Polygon validators ignore lower tips

// The fee quoted to senders: what one relayed send costs, times a margin.
const RELAY_GAS = 190_000n
const FEE_MARGIN = 1.5
const FEE_MIN = 3_000n // 0.003 USDC
const FEE_STEP = 1_000n // quotes are rounded up to 0.001 USDC
const FEE_TOLERANCE = 0.8 // accept a fee signed against a slightly older quote
const QUOTE_TTL_MS = 60_000
const PRICE_TTL_MS = 10 * 60_000

// Self-funding.
const POL_LOW = parseUnits('3', 18) // refill below this
const REFILL_USDC = parseUnits('1', 6) // spend at most this per refill
const REFILL_MIN_USDC = parseUnits('0.2', 6)
const SWAP_SLIPPAGE = 0.97 // accept at worst 3% under the reference price
const PAYOUT_ABOVE = parseUnits('5', 6) // forward earnings above this…
const PAYOUT_KEEP = parseUnits('2', 6) // …keeping this much for refills

// Abuse limits per sending address.
const MIN_VALUE = 100_000n // 0.10 USDC
const COOLDOWN_MS = 15_000
const MAX_PER_DAY = 50
const MAX_VALIDITY_S = 900

const usdcAbi = parseAbi([
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
])
const multicallAbi = parseAbi([
  'struct Call3 { address target; bool allowFailure; bytes callData; }',
  'struct Result { bool success; bytes returnData; }',
  'function aggregate3(Call3[] calls) payable returns (Result[] returnData)',
])
export const routerAbi = parseAbi([
  'struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }',
  'function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)',
  'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
  'function multicall(bytes[] data) payable returns (bytes[] results)',
])

/** The router call that turns `usdcIn` USDC into at least `minPol` POL for `recipient`. */
export function swapCallData(usdcIn, minPol, recipient) {
  return [
    encodeFunctionData({
      abi: routerAbi,
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn: USDC,
          tokenOut: WPOL,
          fee: POOL_FEE,
          recipient: ROUTER_ITSELF,
          amountIn: usdcIn,
          amountOutMinimum: minPol,
          sqrtPriceLimitX96: 0n,
        },
      ],
    }),
    encodeFunctionData({ abi: routerAbi, functionName: 'unwrapWETH9', args: [minPol, recipient] }),
  ]
}

/** Fee in USDC units for a given network price (wei per gas) and POL price (USD). */
export function feeFor(gasPrice, polUsd) {
  const costUsd = (Number(gasPrice * RELAY_GAS) / 1e18) * polUsd
  const units = BigInt(Math.ceil(costUsd * FEE_MARGIN * 1e6))
  const stepped = ((units + FEE_STEP - 1n) / FEE_STEP) * FEE_STEP
  return stepped < FEE_MIN ? FEE_MIN : stepped
}

export function createRelayer({ key, payout, log = console }) {
  if (!key) throw new Error('RELAYER_PRIVATE_KEY is not set')
  if (payout && !isAddress(payout)) throw new Error('PAYOUT_ADDRESS is not an address')
  const account = privateKeyToAccount(key)
  const me = account.address.toLowerCase()
  const transport = fallback(RPCS.map((u) => http(u, { timeout: 10_000 })))
  const pub = createPublicClient({ chain: polygon, transport })
  const wallet = createWalletClient({ account, chain: polygon, transport })
  const nodes = RPCS.map((u) => createPublicClient({ chain: polygon, transport: http(u, { timeout: 10_000 }) }))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  // A transaction that was broadcast but not seen in a block before the
  // service gave up. It may still land, so whatever is sent next reuses its
  // sequence number at a higher price: the network can then accept only one
  // of the two, never both.
  let stuck = null
  const receiptOf = async (hash) => {
    const found = await Promise.allSettled(nodes.map((c) => c.getTransactionReceipt({ hash })))
    return found.find((r) => r.status === 'fulfilled')?.value
  }
  const fail = (code, message, hash) => Object.assign(new Error(message), { code, hash })

  /**
   * Signs one transaction, hands it to every node, and waits until it is in a
   * block. A single node may accept a transaction and never pass it on, so the
   * hash alone proves nothing: only a receipt does.
   * Errors carry a code: 'unconfirmed' (may still land) or 'superseded' (an
   * earlier unresolved transaction landed instead; its hash is attached).
   */
  async function submit({ address, abi, functionName, args }, from) {
    const data = encodeFunctionData({ abi, functionName, args })
    const [gasPrice, gas, nonce] = await Promise.all([
      pub.getGasPrice(),
      pub.estimateGas({ account, to: address, data }),
      pub.getTransactionCount({ address: account.address, blockTag: 'latest' }),
    ])
    if (stuck && nonce > stuck.nonce) stuck = null // it was settled one way or the other
    const old = stuck
    // Replacing needs a clearly higher price, or nodes keep the old one.
    const tip = old ? (old.tip * 13n) / 10n : MIN_TIP
    let maxFee = gasPrice * 2n + tip // a ceiling, not the price paid
    if (old && maxFee < (old.maxFee * 13n) / 10n) maxFee = (old.maxFee * 13n) / 10n
    const raw = await wallet.signTransaction({
      to: address,
      data,
      nonce,
      gas: (gas * 13n) / 10n,
      maxPriorityFeePerGas: tip,
      maxFeePerGas: maxFee,
    })
    const hash = keccak256(raw)
    const broadcast = async () => {
      const res = await Promise.allSettled(nodes.map((c) => c.sendRawTransaction({ serializedTransaction: raw })))
      const errors = res.filter((r) => r.status === 'rejected').map((r) => r.reason?.details ?? r.reason?.shortMessage ?? 'error')
      return { accepted: res.length - errors.length, errors }
    }
    const first = await broadcast()
    if (!first.accepted && !first.errors.some((e) => /known|nonce too low/i.test(e)))
      throw fail('rejected', `no node accepted it: ${first.errors[0]}`)
    stuck = { hash, nonce, tip, maxFee, from }
    const until = Date.now() + CONFIRM_MS
    for (let round = 1; Date.now() < until; round++) {
      await sleep(2500)
      const receipt = await receiptOf(hash)
      if (receipt) {
        stuck = null
        if (receipt.status !== 'success') throw fail('reverted', 'reverted on chain')
        return hash
      }
      if (old && (await receiptOf(old.hash))) {
        stuck = null
        throw fail('superseded', 'the earlier transaction landed instead', old.hash)
      }
      if (round % 4 === 0) await broadcast()
    }
    throw fail('unconfirmed', `not confirmed in time (${first.accepted}/${nodes.length} nodes took it) ${hash}`)
  }

  // One transaction at a time, so the service's own transactions never collide.
  let queue = Promise.resolve()
  const serial = (fn) => (queue = queue.then(fn, fn))

  let price = { usd: 0, at: 0 }
  async function polUsd() {
    if (Date.now() - price.at < PRICE_TTL_MS) return price.usd
    try {
      const r = await fetch('https://api.coinbase.com/v2/prices/POL-USD/spot', { signal: AbortSignal.timeout(8000) })
      const usd = Number((await r.json()).data.amount)
      if (!(usd > 0)) throw new Error('bad price')
      price = { usd, at: Date.now() }
    } catch (e) {
      if (!price.usd) throw e // never quote without a price
    }
    return price.usd
  }

  let quote = { fee: 0n, at: 0 }
  async function currentFee() {
    if (Date.now() - quote.at < QUOTE_TTL_MS) return quote.fee
    const [gasPrice, usd] = await Promise.all([pub.getGasPrice(), polUsd()])
    quote = { fee: feeFor(gasPrice, usd), at: Date.now() }
    return quote.fee
  }

  const usage = new Map() // from -> { last, day, count }
  function limited(from) {
    const now = Date.now()
    const day = Math.floor(now / 86_400_000)
    const u = usage.get(from) ?? { last: 0, day, count: 0 }
    if (u.day !== day) Object.assign(u, { day, count: 0 })
    usage.set(from, u)
    return now - u.last < COOLDOWN_MS || u.count >= MAX_PER_DAY
  }
  function record(from) {
    const u = usage.get(from)
    u.last = Date.now()
    u.count += 1
  }

  /** Checks one signed authorization and returns its contract call data, or an error string. */
  function parseAuth(a) {
    if (!a || !isAddress(a.from) || !isAddress(a.to)) return 'bad address'
    if (!isHex(a.nonce) || a.nonce.length !== 66 || !isHex(a.signature)) return 'bad signature'
    let value, validAfter, validBefore, sig
    try {
      value = BigInt(a.value)
      validAfter = BigInt(a.validAfter)
      validBefore = BigInt(a.validBefore)
      sig = parseSignature(a.signature)
    } catch {
      return 'bad request'
    }
    const now = BigInt(Math.floor(Date.now() / 1000))
    if (validAfter > now || validBefore <= now || validBefore > now + BigInt(MAX_VALIDITY_S))
      return 'authorization expired or too long'
    const v = Number(sig.v ?? 27n + BigInt(sig.yParity))
    const callData = encodeFunctionData({
      abi: usdcAbi,
      functionName: 'transferWithAuthorization',
      args: [a.from, a.to, value, validAfter, validBefore, a.nonce, v, sig.r, sig.s],
    })
    return { from: a.from.toLowerCase(), to: a.to.toLowerCase(), value, callData }
  }

  async function relay(b) {
    const pay = parseAuth(b?.pay)
    if (typeof pay === 'string') return [400, { error: pay }]
    const fee = parseAuth(b?.fee)
    if (typeof fee === 'string') return [400, { error: fee }]
    if (pay.value < MIN_VALUE) return [400, { error: 'amount too small' }]
    const needed = BigInt(Math.floor(Number(await currentFee()) * FEE_TOLERANCE))
    if (fee.from !== pay.from || fee.to !== me || fee.value < needed)
      return [400, { error: 'fee missing or too low' }]
    if (limited(pay.from)) return [429, { error: 'too many requests' }]

    // One transaction, both transfers: if either fails, neither happens.
    const calls = [pay, fee].map((a) => ({ target: USDC, allowFailure: false, callData: a.callData }))
    return serial(async () => {
      // If this wallet's previous send was left unresolved and has landed since,
      // say so instead of paying a second time.
      if (stuck && stuck.from === pay.from) {
        const earlier = await receiptOf(stuck.hash)
        if (earlier) {
          const hash = stuck.hash
          stuck = null
          if (earlier.status === 'success') return [409, { error: 'earlier send went through', hash }]
        }
      }
      let request
      try {
        // Dry run first: a bad signature or missing balance costs the service nothing.
        ;({ request } = await pub.simulateContract({
          account,
          address: MULTICALL3,
          abi: multicallAbi,
          functionName: 'aggregate3',
          args: [calls],
        }))
      } catch (e) {
        return [400, { error: e.shortMessage ?? 'transfer would fail' }]
      }
      let hash
      try {
        hash = await submit(request, pay.from)
      } catch (e) {
        log.error('send failed:', e.code ?? '', e.shortMessage ?? e.message)
        if (e.code === 'superseded' && stuck === null && e.hash)
          return [409, { error: 'earlier send went through', hash: e.hash }]
        if (e.code === 'unconfirmed') return [504, { error: 'not confirmed' }]
        return [502, { error: 'could not send' }]
      }
      record(pay.from)
      log.log('relayed', hash)
      await upkeep().catch((e) => log.error('upkeep failed:', e.shortMessage ?? e.message))
      return [200, { hash }]
    })
  }

  /** Refill POL from earned USDC when low; forward surplus earnings to the owner. */
  async function upkeep() {
    const [pol, usdc] = await Promise.all([
      pub.getBalance({ address: account.address }),
      pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }),
    ])
    if (pol < POL_LOW && usdc >= REFILL_MIN_USDC) {
      const spend = usdc < REFILL_USDC ? usdc : REFILL_USDC
      const expected = Number(formatUnits(spend, 6)) / (await polUsd())
      const minPol = parseUnits((expected * SWAP_SLIPPAGE).toFixed(6), 18)
      const allowance = await pub.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [account.address, SWAP_ROUTER],
      })
      if (allowance < spend) {
        await submit({ address: USDC, abi: erc20Abi, functionName: 'approve', args: [SWAP_ROUTER, spend] })
      }
      // Simulated first: if the price is worse than the limit, nothing is sent.
      const { request } = await pub.simulateContract({
        account,
        address: SWAP_ROUTER,
        abi: routerAbi,
        functionName: 'multicall',
        args: [swapCallData(spend, minPol, account.address)],
      })
      const h = await submit(request)
      log.log('refill: swapped', formatUnits(spend, 6), 'USDC for POL', h)
      return
    }
    if (payout && usdc > PAYOUT_ABOVE) {
      const h = await submit({ address: USDC, abi: erc20Abi, functionName: 'transfer', args: [payout, usdc - PAYOUT_KEEP] })
      log.log('payout:', formatUnits(usdc - PAYOUT_KEEP, 6), 'USDC', h)
    }
  }

  /** Routes one HTTP request. Returns [status, json]. */
  async function handle(method, path, body) {
    const route = path.replace(/^\/api/, '').replace(/\/$/, '') || '/'
    try {
      if (method === 'GET' && (route === '/info' || route === '/health')) {
        const [fee, pol] = await Promise.all([currentFee(), pub.getBalance({ address: account.address })])
        // "ready" is false when the service cannot pay for a send right now.
        return [200, { relayer: account.address, fee: fee.toString(), ready: pol > parseUnits('0.3', 18) }]
      }
      if (method === 'POST' && route === '/relay') return await relay(body)
      return [404, { error: 'not found' }]
    } catch (e) {
      log.error('request failed:', e.shortMessage ?? e.message)
      return [503, { error: 'service unavailable' }]
    }
  }

  return { address: account.address, handle, upkeep }
}
