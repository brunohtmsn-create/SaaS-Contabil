import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal } from '@saas-contabil/shared'

// Percentuais de presunção de lucro por categoria de atividade (Receita Federal)
// Art. 15 da Lei 9.249/95 — IRPJ; Art. 20 da Lei 9.249/95 — CSLL
const PRESUNCAO_IRPJ: Record<string, number> = {
  comercio: 8,
  industria: 8,
  transporte_cargas: 8,
  transporte_passageiros: 16,
  servicos_financeiros: 16,
  servicos_gerais: 32,
  profissoes_regulamentadas: 32,
}

const PRESUNCAO_CSLL: Record<string, number> = {
  comercio: 12,
  industria: 12,
  transporte_cargas: 12,
  transporte_passageiros: 12,
  servicos_financeiros: 12,
  servicos_gerais: 32,
  profissoes_regulamentadas: 32,
}

// Mapeamento simplificado de CNAE para categoria
// Ref: Instrução Normativa RFB 1.700/2017
function categoriaAtividade(cnae: string): string {
  const grupo = parseInt(cnae.substring(0, 2), 10)
  if (grupo >= 45 && grupo <= 47) return 'comercio'
  if ((grupo >= 10 && grupo <= 33) || (grupo >= 5 && grupo <= 9)) return 'industria'
  if (grupo === 49 && cnae.startsWith('4930')) return 'transporte_cargas'
  if (grupo === 49) return 'transporte_passageiros'
  if (grupo >= 64 && grupo <= 66) return 'servicos_financeiros'
  if ([69, 70, 71, 72, 73, 74, 75].includes(grupo)) return 'profissoes_regulamentadas'
  return 'servicos_gerais'
}

// Trimestre: retorna {trimestreLabel, inicio, fim} para uma competência YYYY-MM
// Ex: "2025-01" → { trimestreLabel: "2025-T1", inicio: Date(2025-01-01), fim: Date(2025-03-31) }
function trimestDeCompetencia(competencia: string): {
  trimestreLabel: string
  inicio: Date
  fim: Date
  numero: 1 | 2 | 3 | 4
} {
  const [anoStr, mesStr] = competencia.split('-')
  const ano = parseInt(anoStr!, 10)
  const mes = parseInt(mesStr!, 10)

  if (mes >= 1 && mes <= 3)
    return {
      trimestreLabel: `${ano}-T1`,
      inicio: new Date(ano, 0, 1),
      fim: new Date(ano, 2, 31),
      numero: 1,
    }
  if (mes >= 4 && mes <= 6)
    return {
      trimestreLabel: `${ano}-T2`,
      inicio: new Date(ano, 3, 1),
      fim: new Date(ano, 5, 30),
      numero: 2,
    }
  if (mes >= 7 && mes <= 9)
    return {
      trimestreLabel: `${ano}-T3`,
      inicio: new Date(ano, 6, 1),
      fim: new Date(ano, 8, 30),
      numero: 3,
    }
  return {
    trimestreLabel: `${ano}-T4`,
    inicio: new Date(ano, 9, 1),
    fim: new Date(ano, 11, 31),
    numero: 4,
  }
}

export type ResultadoIrpjCsllLP = {
  cnpj: string
  competencia: string
  trimestreLabel: string
  categoria: string
  percentualPresuncaoIRPJ: number
  percentualPresuncaoCSLL: number
  receitaBrutaTrimestral: Decimal
  baseCalculoIRPJ: Decimal
  baseCalculoCSLL: Decimal
  irpjNormal: Decimal
  irpjAdicional: Decimal
  irpjTotal: Decimal
  csllTotal: Decimal
  totalDevido: Decimal
}

export class IrpjCsllLPService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async apurar(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<ResultadoIrpjCsllLP> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')
    if (empresa.regime !== 'LUCRO_PRESUMIDO') throw new Error('Empresa não é Lucro Presumido')

    const { trimestreLabel, inicio, fim } = trimestDeCompetencia(competencia)

    // Agrega receita bruta do trimestre — somente documentos CONCILIADOS (CLAUDE.md §10)
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

    const receitaBrutaTrimestral = docs.reduce(
      (acc, doc) => acc.plus(new Decimal(doc.valorTotal.toString())),
      new Decimal(0)
    )

    const categoria = categoriaAtividade(empresa.cnae)
    const pctIRPJ = PRESUNCAO_IRPJ[categoria] ?? 32
    const pctCSLL = PRESUNCAO_CSLL[categoria] ?? 32

    const baseCalculoIRPJ = receitaBrutaTrimestral.times(pctIRPJ).div(100).toDecimalPlaces(2)
    const baseCalculoCSLL = receitaBrutaTrimestral.times(pctCSLL).div(100).toDecimalPlaces(2)

    // IRPJ: 15% sobre a base + 10% adicional sobre o que exceder R$60.000/trimestre
    const irpjNormal = baseCalculoIRPJ.times('0.15').toDecimalPlaces(2)
    const limiteAdicional = new Decimal('60000')
    const baseAdicional = baseCalculoIRPJ.minus(limiteAdicional)
    const irpjAdicional = baseAdicional.gt(0)
      ? baseAdicional.times('0.10').toDecimalPlaces(2)
      : new Decimal(0)
    const irpjTotal = irpjNormal.plus(irpjAdicional)

    // CSLL: 9% sobre a base
    const csllTotal = baseCalculoCSLL.times('0.09').toDecimalPlaces(2)

    const totalDevido = irpjTotal.plus(csllTotal)

    const resultado: ResultadoIrpjCsllLP = {
      cnpj: empresa.cnpj,
      competencia,
      trimestreLabel,
      categoria,
      percentualPresuncaoIRPJ: pctIRPJ,
      percentualPresuncaoCSLL: pctCSLL,
      receitaBrutaTrimestral,
      baseCalculoIRPJ,
      baseCalculoCSLL,
      irpjNormal,
      irpjAdicional,
      irpjTotal,
      csllTotal,
      totalDevido,
    }

    await Promise.all([
      this.db.apuracaoFiscal.upsert({
        where: {
          tenantId_empresaId_competencia_tipo: {
            tenantId,
            empresaId,
            competencia: trimestreLabel,
            tipo: 'IRPJ_LP',
          },
        },
        update: { dados: resultado as any, status: 'CALCULADO' },
        create: {
          tenantId,
          empresaId,
          competencia: trimestreLabel,
          tipo: 'IRPJ_LP',
          dados: resultado as any,
          status: 'CALCULADO',
        },
      }),
      this.db.apuracaoFiscal.upsert({
        where: {
          tenantId_empresaId_competencia_tipo: {
            tenantId,
            empresaId,
            competencia: trimestreLabel,
            tipo: 'CSLL_LP',
          },
        },
        update: { dados: resultado as any, status: 'CALCULADO' },
        create: {
          tenantId,
          empresaId,
          competencia: trimestreLabel,
          tipo: 'CSLL_LP',
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
      evento: 'IRPJ_CSLL_LP_APURADO',
      estadoNovo: {
        trimestreLabel,
        irpjTotal: irpjTotal.toString(),
        csllTotal: csllTotal.toString(),
        totalDevido: totalDevido.toString(),
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return resultado
  }
}
