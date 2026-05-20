import { getPrismaClient } from '@saas-contabil/database'
import { Decimal, competencias12Meses, parsePeriodo } from '@saas-contabil/shared'

export class FatorRService {
  private db = getPrismaClient()

  async calcular(tenantId: string, empresaId: string, competencia: string): Promise<{ fatorR: Decimal; anexo: 'III' | 'V' }> {
    const competencias = competencias12Meses(competencia)
    const primeiro = competencias[0]
    const { inicio } = parsePeriodo(primeiro ?? competencia)
    const { fim } = parsePeriodo(competencia)

    const rb12 = await this.db.documentoFiscal.aggregate({
      where: {
        tenantId,
        empresaId,
        dataCompetencia: { gte: inicio, lte: fim },
        status: 'CONCILIADO',
        tipo: { in: ['NFE', 'NFCE', 'NFSE_EMITIDA'] },
        direcao: { in: ['SAIDA', 'PRESTACAO'] },
      },
      _sum: { valorTotal: true },
    })

    const receitaBruta12m = new Decimal(rb12._sum.valorTotal?.toString() ?? '0')
    const folha12m = new Decimal(0)

    const fatorR = receitaBruta12m.gt(0) ? folha12m.div(receitaBruta12m).times(100) : new Decimal(0)
    const anexo: 'III' | 'V' = fatorR.gte(28) ? 'III' : 'V'

    return { fatorR, anexo }
  }
}
