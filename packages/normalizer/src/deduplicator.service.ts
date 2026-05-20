import { getPrismaClient } from '@saas-contabil/database'
import { sha256 } from '@saas-contabil/shared'

export class DeduplicatorService {
  private db = getPrismaClient()

  async isDuplicate(tenantId: string, chaveUnica: string): Promise<boolean> {
    const existing = await this.db.documentoFiscal.findFirst({
      where: { tenantId, chaveUnica },
      select: { id: true },
    })
    return !!existing
  }

  async findDuplicates(tenantId: string, empresaId: string): Promise<string[][]> {
    const docs = await this.db.documentoFiscal.findMany({
      where: { tenantId, empresaId },
      select: { id: true, chaveUnica: true },
    })

    const groups = new Map<string, string[]>()
    for (const doc of docs) {
      const existing = groups.get(doc.chaveUnica) ?? []
      existing.push(doc.id)
      groups.set(doc.chaveUnica, existing)
    }

    return Array.from(groups.values()).filter((g) => g.length > 1)
  }
}
