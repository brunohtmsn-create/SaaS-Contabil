import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export function encrypt(data: Buffer, key: Buffer): { encrypted: Buffer; iv: Buffer; tag: Buffer } {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()])
  const tag = cipher.getAuthTag()
  return { encrypted, iv, tag }
}

export function decrypt(encrypted: Buffer, key: Buffer, iv: Buffer, tag: Buffer): Buffer {
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()])
}

export function deriveKey(masterKey: string, tenantId: string): Buffer {
  return createHash('sha256').update(`${masterKey}:${tenantId}`).digest()
}

export function generateSecureRandom(bytes = 32): string {
  return randomBytes(bytes).toString('hex')
}
