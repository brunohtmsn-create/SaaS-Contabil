import { getPrismaClient } from '@saas-contabil/database'
import { Decimal, competencias12Meses, parsePeriodo } from '@saas-contabil/shared'

export class FatorRService {
  private db = getPrismaClient()

  async calcular(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<{ fatorR: Decimal; anexo: 'III' | 'V' }> {
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

    // Busca lançamentos de folha dos últimos 12 meses
    // Critério: historico contém "Salário", "Folha" ou "Pro Labore"
    const lancamentosFolha = await this.db.lancamentoContabil.findMany({
      where: {
        tenantId,
        empresaId,
        competencia: { in: competencias },
        OR: [
          { historico: { contains: 'Salário', mode: 'insensitive' } },
          { historico: { contains: 'Salario', mode: 'insensitive' } },
          { historico: { contains: 'Folha', mode: 'insensitive' } },
          { historico: { contains: 'Pro Labore', mode: 'insensitive' } },
          { historico: { contains: 'Pró-Labore', mode: 'insensitive' } },
        ],
      },
      select: { partidas: true },
    })

    // Soma partidas do tipo DEBITO em contas de despesas de pessoal (iniciadas com '6.1.')
    let folha12m = new Decimal(0)
    for (const lancamento of lancamentosFolha) {
      const partidas = lancamento.partidas as Array<{
        conta: string
        valor: string | number
        tipo: string
      }>
      if (!Array.isArray(partidas)) continue
      for (const partida of partidas) {
        if (
          partida.tipo === 'DEBITO' &&
          typeof partida.conta === 'string' &&
          partida.conta.startsWith('6.1.')
        ) {
          folha12m = folha12m.plus(new Decimal(partida.valor.toString()))
        }
      }
    }

    const fatorR = receitaBruta12m.gt(0) ? folha12m.div(receitaBruta12m).times(100) : new Decimal(0)
    const anexo: 'III' | 'V' = fatorR.gte(28) ? 'III' : 'V'

    return { fatorR, anexo }
  }
}
