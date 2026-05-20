import { CredentialDecrypted } from './types.js'

export class CertificateLoader {
  static extractPFX(credential: CredentialDecrypted): { pfxBuffer: Buffer; password: string } {
    const json = JSON.parse(credential.data.toString('utf8'))
    return {
      pfxBuffer: Buffer.from(json.pfx, 'base64'),
      password: json.password,
    }
  }

  static async withCertificate<T>(
    credential: CredentialDecrypted,
    fn: (pfx: Buffer, password: string) => Promise<T>
  ): Promise<T> {
    const { pfxBuffer, password } = CertificateLoader.extractPFX(credential)
    try {
      return await fn(pfxBuffer, password)
    } finally {
      pfxBuffer.fill(0)
    }
  }
}
