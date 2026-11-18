// How amounts are written everywhere in the app: digits in groups of three
// with a clear gap between the groups, so thousands are read at a glance.

// A third-of-an-em space, held between two joiners so a number never wraps.
const GAP = '⁠ ⁠'

const groupDigits = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, GAP)

/** 1234567.5 → "1 234 567.50" (with `decimals` = 2). */
export function group(n: number, decimals = 0): string {
  const [int, frac] = Math.abs(n).toFixed(decimals).split('.')
  return `${n < 0 ? '-' : ''}${groupDigits(int)}${frac ? `.${frac}` : ''}`
}

/** Groups an amount while it is being typed; the decimal part is left as typed. */
export function groupTyped(raw: string): string {
  // One ordinary no-break space here, so the caret and Backspace behave; the
  // stylesheet widens it in amount fields.
  const spaced = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')
  const at = raw.search(/[.,]/)
  return at < 0 ? spaced(raw) : spaced(raw.slice(0, at)) + raw.slice(at)
}
