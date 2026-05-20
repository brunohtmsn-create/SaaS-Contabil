import { getPrismaClient, Credencial, StatusCredencial } from '@saas-contabil/database'
import { deriveKey, encrypt, decrypt, nowBR, addMeses } from '@saas-contabil/shared'
import type { CredentialDecrypted, CredentialCreateInput } from './types.js'

const MASTER_KEY = process.env['CREDENTIALS_MASTER_KEY'] ?? ''

export class CredentialService {
  private db = getPrismaClient()

  async store(input: CredentialCreateInput): Promise<Credencial> {
    const key = deriveKey(MASTER_KEY, input.tenantId)
    const { encrypted, iv, tag } = encrypt(input.rawData, key)

    return this.db.credencial.create({
      data: {
        tenantId: input.tenantId,
        empresaId: input.empresaId,
        cnpj: input.cnpj,
        tipo: input.tipo,
        encryptedData: encrypted,
        iv,
        authTag: tag,
        validade: input.validade ?? null,
        status: 'ATIVO',
        escopos: input.escopos,
        criadoPor: input.criadoPor,
      },
    })
  }

  async retrieve(credentialId: string, tenantId: string): Promise<CredentialDecrypted> {
    const cred = await this.db.credencial.findFirst({
      where: { id: credentialId, tenantId },
    })

    if (!cred) throw new Error(`Credencial ${credentialId} não encontrada`)
    if (cred.status === 'VENCIDO') throw new Error('Credencial vencida')
    if (cred.status === 'REVOGADO') throw new Error('Credencial revogada')

    const key = deriveKey(MASTER_KEY, tenantId)
    const data = decrypt(
      Buffer.from(cred.encryptedData),
      key,
      Buffer.from(cred.iv),
      Buffer.from(cred.authTag)
    )

    await this.db.credencial.update({
      where: { id: credentialId },
      data: { ultimoUso: nowBR(), ultimoResultado: 'SUCESSO' },
    })

    return {
      id: cred.id,
      tenantId: cred.tenantId,
      cnpj: cred.cnpj,
      tipo: cred.tipo,
      data,
      validade: cred.validade,
      escopos: cred.escopos,
    }
  }

  async markError(credentialId: string): Promise<void> {
    await this.db.credencial.update({
      where: { id: credentialId },
      data: { ultimoResultado: 'FALHA' },
    })
  }

  async revoke(credentialId: string, tenantId: string): Promise<void> {
    await this.db.credencial.updateMany({
      where: { id: credentialId, tenantId },
      data: { status: 'REVOGADO' },
    })
  }

  async checkExpiring(tenantId: string, daysBefore = 30): Promise<Credencial[]> {
    const cutoff = addMeses(nowBR(), 0)
    cutoff.setDate(cutoff.getDate() + daysBefore)

    return this.db.credencial.findMany({
      where: {
        tenantId,
        status: 'ATIVO',
        validade: {
          lte: cutoff,
          gte: nowBR(),
        },
      },
    })
  }

  async updateExpiredStatuses(tenantId: string): Promise<number> {
    const result = await this.db.credencial.updateMany({
      where: {
        tenantId,
        status: 'ATIVO',
        validade: { lt: nowBR() },
      },
      data: { status: 'VENCIDO' },
    })
    return result.count
  }

  async findByCnpj(tenantId: string, cnpj: string): Promise<Credencial[]> {
    return this.db.credencial.findMany({
      where: { tenantId, cnpj, status: 'ATIVO' },
      orderBy: { criadoEm: 'desc' },
    })
  }

  async findByTipo(tenantId: string, cnpj: string, tipo: string): Promise<Credencial | null> {
    return this.db.credencial.findFirst({
      where: { tenantId, cnpj, tipo: tipo as any, status: 'ATIVO' },
      orderBy: { criadoEm: 'desc' },
    })
  }
}
