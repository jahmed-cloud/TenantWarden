import { createHash, createDecipheriv } from 'crypto'
import { logger } from './logger.js'

// Mirrors the API's AES-256-GCM format: base64( nonce[12] | tag[16] | ciphertext )
// Key = SHA256(ENCRYPTION_KEY). Falls back to raw value for legacy plaintext rows.
const key = createHash('sha256')
  .update(process.env.ENCRYPTION_KEY ?? 'tenantwarden-default-key-change-me', 'utf8')
  .digest()

export function decryptSecret(value: string): string {
  try {
    const data = Buffer.from(value, 'base64')
    if (data.length < 29) return value          // too short to be our format → plaintext
    const nonce = data.subarray(0, 12)
    const tag   = data.subarray(12, 28)
    const ct    = data.subarray(28)
    const d = createDecipheriv('aes-256-gcm', key, nonce)
    d.setAuthTag(tag)
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8')
  } catch {
    logger.debug('Secret not in encrypted format — using raw value')
    return value                                 // plaintext row (manual SQL insert)
  }
}
