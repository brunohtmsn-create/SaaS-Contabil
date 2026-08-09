import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal, parsePeriodo } from '@saas-contabil/shared'

// Regime cumulativo (LP): PIS 0,65% / COFINS 3% — Lei 9.718/98
const ALIQUOTA_PIS = new Decimal('0.0065')
const ALIQUOTA_COFINS = new Decimal('0.03')

export type ResultadoPisCofinsLP = {
  cnpj: string
  competencia: string
  receitaBruta: Decimal
  baseCalculo: Decimal
  pis: Decimal
  cofins: Decimal
  totalDevido: Decimal
}

export class PisCofinsLPService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async apurar(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<ResultadoPisCofinsLP> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')
    if (empresa.regime !== 'LUCRO_PRESUMIDO' && empresa.regime !== 'LUCRO_REAL') {
      throw new Error(`Regime ${empresa.regime} não é LP ou LR`)
    }

    const { inicio, fim } = parsePeriodo(competencia)

    // Agrega receita bruta do mês — somente documentos CONCILIADOS (CLAUDE.md §10)
    const docs = await this.db.documentoFiscal.findMany({
      where: {
        tenantId,
        empresaId,
        dataCompetencia: { gte: inicio, lte: fim },
        status: 'CONCILIADO',
        tipo: { in: ['NFE', 'NFCE', 'NFSE_EMITIDA'] },
        direcao: { in: ['SAIDA', 'PRESTACAO'] },
      },
    })

    const receitaBruta = docs.reduce(
      (acc, doc) => acc.plus(new Decimal(doc.valorTotal.toString())),
      new Decimal(0)
    )

    // Para LP: regime cumulativo — sem créditos, base = receita bruta integral
    const baseCalculo = receitaBruta
    const pis = baseCalculo.times(ALIQUOTA_PIS).toDecimalPlaces(2)
    const cofins = baseCalculo.times(ALIQUOTA_COFINS).toDecimalPlaces(2)
    const totalDevido = pis.plus(cofins)

    const resultado: ResultadoPisCofinsLP = {
      cnpj: empresa.cnpj,
      competencia,
      receitaBruta,
      baseCalculo,
      pis,
      cofins,
      totalDevido,
    }

    await Promise.all([
      this.db.apuracaoFiscal.upsert({
        where: {
          tenantId_empresaId_competencia_tipo: { tenantId, empresaId, competencia, tipo: 'PIS' },
        },
        update: { dados: resultado as any, status: 'CALCULADO' },
        create: {
          tenantId,
          empresaId,
          competencia,
          tipo: 'PIS',
          dados: resultado as any,
          status: 'CALCULADO',
        },
      }),
      this.db.apuracaoFiscal.upsert({
        where: {
          tenantId_empresaId_competencia_tipo: { tenantId, empresaId, competencia, tipo: 'COFINS' },
        },
        update: { dados: resultado as any, status: 'CALCULADO' },
        create: {
          tenantId,
          empresaId,
          competencia,
          tipo: 'COFINS',
          dados: resultado as any,
          status: 'CALCULADO',
        },
      }),
    ])

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'EMPRESA_CLIENTE',
      entidadeId: empresaId,
      evento: 'PIS_COFINS_LP_APURADO',
      estadoNovo: {
        competencia,
        receitaBruta: receitaBruta.toString(),
        pis: pis.toString(),
        cofins: cofins.toString(),
        totalDevido: totalDevido.toString(),
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return resultado
  }
}
