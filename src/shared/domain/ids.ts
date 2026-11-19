export function nowIso(): string {
  return new Date().toISOString()
}

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/** URL-safe, collision-resistant identifier with a stable type prefix. */
export function newId(prefix: string, length = 14): string {
  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length]
  return `${prefix}_${out}`
}

export function uid(): string {
  return newId('tmp', 10)
}
