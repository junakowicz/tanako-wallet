// Non-custodial wallet: the recovery phrase is generated on the device and
// never leaves it. It is stored encrypted with the merchant's PIN.
import { english, generateMnemonic, mnemonicToAccount } from 'viem/accounts'
import { btcAddressOf } from './btc'

export type StoredWallet = {
  address: `0x${string}`
  /** Bitcoin address from the same words. Missing in wallets saved before Bitcoin was added. */
  btc?: string
  salt: string
  iv: string
  ct: string
}

const enc = new TextEncoder()
const dec = new TextDecoder()

const b64 = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer)))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function keyFromPin(pin: string, salt: Uint8Array<ArrayBuffer>) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export function newPhrase(): string {
  return generateMnemonic(english)
}

export function addressOf(phrase: string): `0x${string}` {
  return mnemonicToAccount(phrase.trim().toLowerCase().replace(/\s+/g, ' ')).address
}

export async function sealWallet(phrase: string, pin: string): Promise<StoredWallet> {
  const clean = phrase.trim().toLowerCase().replace(/\s+/g, ' ')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await keyFromPin(pin, salt)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(clean))
  return { address: addressOf(clean), btc: btcAddressOf(clean), salt: b64(salt), iv: b64(iv), ct: b64(ct) }
}

/** Returns the recovery phrase, or null when the PIN is wrong. */
export async function openWallet(w: StoredWallet, pin: string): Promise<string | null> {
  try {
    const key = await keyFromPin(pin, unb64(w.salt))
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(w.iv) }, key, unb64(w.ct))
    return dec.decode(pt)
  } catch {
    return null
  }
}

/** Backup file contents: the PIN-encrypted wallet, never the plain phrase. */
export type BackupContact = { label: string; address: string }

/** The backup file: the PIN-encrypted wallet, plus saved recipients in plain text. */
export function backupJson(w: StoredWallet, contacts: BackupContact[] = []): string {
  return JSON.stringify({ app: 'tanako', version: 1, ...w, contacts }, null, 2)
}

/** Saved recipients found in a backup file; anything malformed is skipped. */
export function contactsFromBackup(text: string): BackupContact[] {
  try {
    const list = JSON.parse(text)?.contacts
    if (!Array.isArray(list)) return []
    const seen = new Set<string>()
    const out: BackupContact[] = []
    for (const c of list) {
      if (typeof c?.label !== 'string' || typeof c?.address !== 'string') continue
      const label = c.label.trim().slice(0, 30)
      const key = c.address.toLowerCase()
      if (!label || !/^0x[0-9a-fA-F]{40}$/.test(c.address) || seen.has(key)) continue
      seen.add(key)
      out.push({ label, address: c.address })
      if (out.length >= 200) break
    }
    return out
  } catch {
    return []
  }
}

/** Parses a backup file. Returns null when it is not a Tanako backup. */
export function parseBackup(text: string): StoredWallet | null {
  try {
    const j = JSON.parse(text)
    const ok =
      j?.app === 'tanako' &&
      /^0x[0-9a-fA-F]{40}$/.test(j.address) &&
      [j.salt, j.iv, j.ct].every((x) => typeof x === 'string' && x.length > 0)
    if (!ok) return null
    const btc = typeof j.btc === 'string' ? j.btc : undefined
    return { address: j.address, btc, salt: j.salt, iv: j.iv, ct: j.ct }
  } catch {
    return null
  }
}

/**
 * Finds a recovery phrase in a text file: the numbered list written by the
 * "download the 12 words" button, or the words on their own. Returns null
 * when the text holds no valid phrase.
 */
export function phraseFromText(text: string): string | null {
  const numbered = [...text.matchAll(/^\s*\d{1,2}[.)]\s*([a-z]+)\s*$/gim)].map((m) => m[1].toLowerCase())
  const plain = text.trim().toLowerCase().split(/\s+/)
  for (const words of [numbered, plain]) {
    if (words.length !== 12 && words.length !== 24) continue
    const phrase = words.join(' ')
    try {
      addressOf(phrase)
      return phrase
    } catch {
      // not a valid phrase; try the next reading
    }
  }
  return null
}
