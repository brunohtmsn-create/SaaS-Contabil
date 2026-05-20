import { getPrismaClient } from '@saas-contabil/database'
import { sha256 } from '@saas-contabil/shared'

export type VerificacaoResult = {
  integro: boolean
  totalEventos: number
  eventosVerificados: number
  primeiraFalha?: { sequencia: bigint; id: string }
}

export class AuditChainVerifier {
  private db = getPrismaClient()

  async verificar(tenantId: string): Promise<VerificacaoResult> {
    const eventos = await this.db.auditEvent.findMany({
      where: { tenantId },
      orderBy: { sequencia: 'asc' },
    })

    let hashAnterior = sha256('GENESIS')
    let primeiraFalha: { sequencia: bigint; id: string } | undefined

    for (const evento of eventos) {
      const { hashEvento, hashAnterior: storedHashAnterior, ...rest } = evento

      if (storedHashAnterior !== hashAnterior) {
        primeiraFalha = { sequencia: evento.sequencia, id: evento.id }
        break
      }

      const payload = { ...rest, hashAnterior }
      const expectedHash = sha256(JSON.stringify(payload))

      if (expectedHash !== hashEvento) {
        primeiraFalha = { sequencia: evento.sequencia, id: evento.id }
        break
      }

      hashAnterior = hashEvento
    }

    return {
      integro: !primeiraFalha,
      totalEventos: eventos.length,
      eventosVerificados: primeiraFalha
        ? Number(primeiraFalha.sequencia) - 1
        : eventos.length,
      primeiraFalha,
    }
  }
}
