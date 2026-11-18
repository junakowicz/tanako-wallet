// Sending USDC out of the wallet.
//
// Merchants hold USDC only: they have no network coin (POL) and should never
// need to know it exists. So the wallet signs two USDC "transfers with
// authorization" (EIP-3009): the payment, and a small fee in USDC to the
// relayer. The relayer broadcasts both in one transaction and pays the
// network fee. It can only submit exactly what was signed: it never holds
// the keys and cannot change the recipient or the amounts.
import { createWalletClient, erc20Abi, fallback, http, isAddress, parseUnits, toHex } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { polygon } from 'viem/chains'
import { client, RPCS, TOKENS } from './chain'

export const RELAYER_URL: string = import.meta.env.VITE_RELAYER_URL ?? '/api'

const USDC = TOKENS[0].address
const TRANSFER_GAS = 120_000n

// 'unsure': sent but not confirmed, it may still arrive. 'earlier': the previous attempt went through instead.
export type SendFailure = 'balance' | 'fee' | 'relayer' | 'failed' | 'unsure' | 'earlier'
export class SendError extends Error {
  constructor(public kind: SendFailure, detail?: string) {
    super(detail ?? kind)
  }
}

export async function signAuthorization(phrase: string, to: `0x${string}`, value: bigint) {
  const account = mnemonicToAccount(phrase)
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)))
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 600)
  const signature = await account.signTypedData({
    domain: { name: 'USD Coin', version: '2', chainId: polygon.id, verifyingContract: USDC },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: { from: account.address, to, value, validAfter: 0n, validBefore, nonce },
  })
  return {
    from: account.address,
    to,
    value: value.toString(),
    validAfter: '0',
    validBefore: validBefore.toString(),
    nonce,
    signature,
  }
}

export type RelayerInfo = { relayer: `0x${string}`; fee: bigint }

/** Asks the relayer where the fee goes and how much it is (in USDC units). */
export async function getRelayerInfo(): Promise<RelayerInfo> {
  if (!RELAYER_URL) throw new SendError('relayer', 'no relayer configured')
  try {
    const res = await fetch(`${RELAYER_URL}/info`)
    const j = await res.json()
    if (!res.ok || !isAddress(j.relayer) || !j.ready) throw new Error('not ready')
    return { relayer: j.relayer, fee: BigInt(j.fee) }
  } catch (e) {
    throw new SendError('relayer', String(e))
  }
}

/** Sends `amount` USDC (decimal string) to `to`. Resolves once confirmed, with the hash and the fee paid in USDC. */
export async function sendUsdc(
  phrase: string,
  to: `0x${string}`,
  amount: string,
): Promise<{ hash: `0x${string}`; fee: number }> {
  const account = mnemonicToAccount(phrase)
  const value = parseUnits(amount, 6)
  if (value <= 0n) throw new SendError('balance')

  const [balances, pol, gasPrice] = await Promise.all([
    Promise.all(
      TOKENS.map((t) =>
        client.readContract({ address: t.address, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }),
      ),
    ),
    client.getBalance({ address: account.address }),
    client.getGasPrice(),
  ])

  let hash: `0x${string}`
  let feePaid = 0
  if (pol >= gasPrice * TRANSFER_GAS * 2n) {
    // The wallet happens to hold the network coin: send directly, no fee.
    const index = balances.findIndex((b) => b >= value)
    if (index < 0) throw new SendError('balance')
    const wallet = createWalletClient({ account, chain: polygon, transport: fallback(RPCS.map((u) => http(u))) })
    try {
      hash = await wallet.writeContract({
        address: TOKENS[index].address,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [to, value],
      })
    } catch (e) {
      throw new SendError('failed', String(e))
    }
  } else {
    const info = await getRelayerInfo()
    if (balances[0] < value + info.fee) throw new SendError(balances[1] >= value ? 'fee' : 'balance')
    const pay = await signAuthorization(phrase, to, value)
    const fee = await signAuthorization(phrase, info.relayer, info.fee)
    let res: Response
    try {
      res = await fetch(`${RELAYER_URL}/relay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pay, fee }),
      })
    } catch (e) {
      throw new SendError('relayer', String(e))
    }
    const body = await res.json().catch(() => ({}))
    if (res.status === 409) throw new SendError('earlier', body.error)
    if (res.status === 504) throw new SendError('unsure', body.error)
    if (!res.ok || !body.hash) throw new SendError('relayer', body.error)
    hash = body.hash
    feePaid = Number(info.fee) / 1e6
  }

  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 })
  if (receipt.status !== 'success') throw new SendError('failed')
  return { hash, fee: feePaid }
}
