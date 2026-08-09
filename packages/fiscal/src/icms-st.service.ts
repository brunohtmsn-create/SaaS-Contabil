/**
 * ICMS-ST (Substituição Tributária): regime em que o remetente (fornecedor) recolhe
 * antecipadamente o ICMS das operações subsequentes até o consumidor final. Em aquisições
 * interestaduais sem retenção pelo remetente, a empresa destinatária torna-se responsável
 * solidária pelo recolhimento via GNRE.
 */
import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal, parsePeriodo } from '@saas-contabil/shared'

export type ItemIcmsSt = {
  documentoId: string
  ufOrigem: string
  ufDestino: string
  baseCalculo: Decimal
  mvaPercentual: Decimal
  aliquotaInterna: Decimal
  aliquotaInterestadual: Decimal
  valorIcmsProprioRemetente: Decimal
  valorIcmsSt: Decimal
}

export type ResultadoIcmsSt = {
  competencia: string
  cnpj: string
  totalBaseCalculo: Decimal
  totalIcmsSt: Decimal
  itens: ItemIcmsSt[]
}

const CFOPS_ICMS_ST = new Set([
  '1.401',
  '1.402',
  '1.403',
  '1.406',
  '1.407',
  '1.408',
  '1.409',
  '2.401',
  '2.402',
  '2.403',
  '2.406',
  '2.407',
  '2.408',
  '2.409',
])

const ALIQUOTAS_INTERNAS: Record<string, Decimal> = {
  SP: new Decimal(18),
  RJ: new Decimal(20),
  MG: new Decimal(18),
  PR: new Decimal(19),
  RS: new Decimal(17),
  SC: new Decimal(17),
  BA: new Decimal(19),
  PE: new Decimal(20.5),
  CE: new Decimal(20),
  GO: new Decimal(17),
  MT: new Decimal(17),
  MS: new Decimal(17),
  DF: new Decimal(18),
  AM: new Decimal(20),
  PA: new Decimal(19),
  MA: new Decimal(22),
  PI: new Decimal(21),
  RN: new Decimal(18),
  PB: new Decimal(18),
  SE: new Decimal(19),
  AL: new Decimal(19),
  TO: new Decimal(18),
  RO: new Decimal(17),
  AC: new Decimal(17),
  RR: new Decimal(17),
  AP: new Decimal(18),
}

const REGIOES_SUL_SUDESTE_CO = new Set([
  'SP',
  'RJ',
  'MG',
  'ES',
  'PR',
  'RS',
  'SC',
  'GO',
  'MT',
  'MS',
  'DF',
])

const MVA_PADRAO = new Decimal('0.35')
const ALIQUOTA_INTERESTADUAL_SULCO = new Decimal(12)
const ALIQUOTA_INTERESTADUAL_NO_NE = new Decimal(7)
const CEM = new Decimal(100)

export class IcmsStService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async calcular(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<ResultadoIcmsSt> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')

    const { inicio, fim } = parsePeriodo(competencia)

    const docs = await this.db.documentoFiscal.findMany({
      where: {
        tenantId,
        empresaId,
        dataCompetencia: { gte: inicio, lte: fim },
        status: 'CONCILIADO',
        tipo: 'NFE',
        direcao: 'ENTRADA',
        operacaoInterestadual: true,
        ufOrigem: { not: null },
        ufDestino: { not: null },
      },
    })

    const docsSt = docs.filter((doc) => doc.cfop !== null && CFOPS_ICMS_ST.has(doc.cfop))

    const itens: ItemIcmsSt[] = []

    for (const doc of docsSt) {
      const ufOrigem = doc.ufOrigem!
      const ufDestino = doc.ufDestino!

      const baseCalculo = new Decimal(doc.valorTotal.toString())
      const mva = MVA_PADRAO
      const aliquotaInterna = ALIQUOTAS_INTERNAS[ufDestino] ?? new Decimal(18)
      const aliquotaInterestadual = REGIOES_SUL_SUDESTE_CO.has(ufOrigem)
        ? ALIQUOTA_INTERESTADUAL_SULCO
        : ALIQUOTA_INTERESTADUAL_NO_NE

      const valorIcmsProprioRemetente = baseCalculo
        .times(aliquotaInterestadual)
        .div(CEM)
        .toDecimalPlaces(2)

      const baseCalcSt = baseCalculo.times(new Decimal(1).plus(mva))
      const valorIcmsStBruto = baseCalcSt
        .times(aliquotaInterna)
        .div(CEM)
        .minus(valorIcmsProprioRemetente)
        .toDecimalPlaces(2)

      const valorIcmsSt = valorIcmsStBruto.lt(0) ? new Decimal(0) : valorIcmsStBruto

      itens.push({
        documentoId: doc.id,
        ufOrigem,
        ufDestino,
        baseCalculo,
        mvaPercentual: mva.times(CEM),
        aliquotaInterna,
        aliquotaInterestadual,
        valorIcmsProprioRemetente,
        valorIcmsSt,
      })
    }

    const totalBaseCalculo = itens.reduce((acc, item) => acc.plus(item.baseCalculo), new Decimal(0))
    const totalIcmsSt = itens.reduce((acc, item) => acc.plus(item.valorIcmsSt), new Decimal(0))

    const resultado: ResultadoIcmsSt = {
      competencia,
      cnpj: empresa.cnpj,
      totalBaseCalculo,
      totalIcmsSt,
      itens,
    }

    await this.db.apuracaoFiscal.upsert({
      where: {
        tenantId_empresaId_competencia_tipo: {
          tenantId,
          empresaId,
          competencia,
          tipo: 'ICMS_ST',
        },
      },
      update: { dados: resultado as any, status: 'CALCULADO' },
      create: {
        tenantId,
        empresaId,
        competencia,
        tipo: 'ICMS_ST',
        dados: resultado as any,
        status: 'CALCULADO',
      },
    })

    if (totalIcmsSt.gt(0)) {
      const obrigacaoExistente = await this.db.obrigacao.findFirst({
        where: { tenantId, empresaId, tipo: 'GNRE_ST', competencia },
      })

      if (!obrigacaoExistente) {
        // GNRE-ST vence no dia 9 do mês seguinte ao da competência
        const [ano, mes] = competencia.split('-').map(Number) as [number, number]
        const vencimento = new Date(ano, mes, 9)

        await this.db.obrigacao.create({
          data: {
            tenantId,
            empresaId,
            tipo: 'GNRE_ST',
            competencia,
            vencimento,
            status: 'PENDENTE',
            valor: totalIcmsSt.toFixed(2),
          },
        })
      }
    }

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'APURACAO_FISCAL',
      entidadeId: empresaId,
      evento: 'ICMS_ST_CALCULADO',
      estadoNovo: {
        competencia,
        totalDocs: itens.length,
        totalBaseCalculo: totalBaseCalculo.toFixed(2),
        totalIcmsSt: totalIcmsSt.toFixed(2),
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return resultado
  }
}
