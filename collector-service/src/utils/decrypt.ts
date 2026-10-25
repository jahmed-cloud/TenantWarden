import { createHash, createDecipheriv } from 'crypto'
import { logger } from './logger.js'

// Mirrors the API's AES-256-GCM format: base64( nonce[12] | tag[16] | ciphertext )
// Key = SHA256(ENCRYPTION_KEY). Rows inserted by hand with a plaintext secret still work.
const key = createHash('sha256')
  .update(process.env.ENCRYPTION_KEY ?? 'tenantwarden-default-key-change-me', 'utf8')
  .digest()

export class SecretDecryptionError extends Error {}

export function decryptSecret(value: string): string {
  const data = Buffer.from(value, 'base64')
  // Node's base64 decoder is lenient, so check the value really is base64 of our format
  const looksEncrypted = data.length >= 29 && data.toString('base64').replace(/=+$/, '') === value.replace(/=+$/, '')
  if (!looksEncrypted) {
    logger.debug('Secret is not in encrypted format — using it as plaintext')
    return value
  }
  try {
    const d = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12))
    d.setAuthTag(data.subarray(12, 28))
    return Buffer.concat([d.update(data.subarray(28)), d.final()]).toString('utf8')
  } catch {
    // Encrypted with a different key: sending the ciphertext to Entra ID would only produce a
    // confusing "invalid client secret". Fail with the real cause instead.
    throw new SecretDecryptionError(
      'Client secret cannot be decrypted — ENCRYPTION_KEY differs from the one used when the tenant was connected')
  }
}
