import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal, FUNDO_POBREZA, CFOPS_INTERESTADUAIS_DIFAL, parsePeriodo } from '@saas-contabil/shared'
import type { ResultadoDifal } from './types.js'

const ALIQUOTA_INTERESTADUAL_SULCO = new Decimal(12)
const ALIQUOTA_INTERESTADUAL_NO_NE = new Decimal(7)

const ALIQUOTAS_INTERNAS: Record<string, Decimal> = {
  SP: new Decimal(18), RJ: new Decimal(20), MG: new Decimal(18),
  PR: new Decimal(19), RS: new Decimal(17), SC: new Decimal(17),
  BA: new Decimal(19), PE: new Decimal(18), CE: new Decimal(18),
  GO: new Decimal(17), MT: new Decimal(17), MS: new Decimal(17),
  DF: new Decimal(18), AM: new Decimal(20), PA: new Decimal(19),
  MA: new Decimal(22), PI: new Decimal(21), RN: new Decimal(18),
  PB: new Decimal(18), SE: new Decimal(19), AL: new Decimal(19),
  TO: new Decimal(18), RO: new Decimal(17), AC: new Decimal(17),
  RR: new Decimal(17), AP: new Decimal(18),
}

export class DifalService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async calcular(tenantId: string, empresaId: string, competencia: string): Promise<ResultadoDifal[]> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')

    const { inicio, fim } = parsePeriodo(competencia)

    const docs = await this.db.documentoFiscal.findMany({
      where: {
        tenantId,
        empresaId,
        dataCompetencia: { gte: inicio, lte: fim },
        status: 'CONCILIADO',
        operacaoInterestadual: true,
        tipo: { in: ['NFE'] },
        direcao: 'ENTRADA',
        cfop: { in: CFOPS_INTERESTADUAIS_DIFAL },
        ufOrigem: { not: null },
        ufDestino: { not: null },
      },
    })

    const resultados: ResultadoDifal[] = []

    for (const doc of docs) {
      const aliquotaInterestadual = this.getAliquotaInterestadual(doc.ufOrigem!, doc.ufDestino!)
      const aliquotaInterna = this.getAliquotaInterna(doc.ufDestino!)

      const baseCalculo = new Decimal(doc.valorTotal.toString())
      const difal = baseCalculo.times(aliquotaInterna.minus(aliquotaInterestadual)).div(100).toDecimalPlaces(2)

      const percentualFundo = FUNDO_POBREZA[doc.ufDestino!] ?? new Decimal(0)
      const fundoPobreza = baseCalculo.times(percentualFundo).div(100).toDecimalPlaces(2)

      resultados.push({
        valorDifal: difal,
        valorFundoPobreza: fundoPobreza,
        valorTotal: difal.plus(fundoPobreza),
        aliquotaInterna,
        aliquotaInterestadual,
        ufDestino: doc.ufDestino!,
        competencia,
      })
    }

    await Promise.all(
      docs.map((doc, i) => {
        const r = resultados[i]!
        return this.db.documentoFiscal.update({
          where: { id: doc.id },
          data: {
            valorDifal: r.valorDifal,
            valorFundoPobreza: r.valorFundoPobreza,
            aliquotaInterna: r.aliquotaInterna,
            aliquotaInterestadual: r.aliquotaInterestadual,
          },
        })
      })
    )

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'APURACAO_FISCAL',
      entidadeId: empresaId,
      evento: 'DIFAL_CALCULADO',
      estadoNovo: { competencia, totalDocs: resultados.length, totalDifal: resultados.reduce((s, r) => s.plus(r.valorTotal), new Decimal(0)).toString() },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return resultados
  }

  private getAliquotaInterestadual(ufOrigem: string, ufDestino: string): Decimal {
    const regioesSulSudesteCO = ['SP', 'RJ', 'MG', 'ES', 'PR', 'RS', 'SC', 'GO', 'MT', 'MS', 'DF']
    return regioesSulSudesteCO.includes(ufDestino) ? ALIQUOTA_INTERESTADUAL_SULCO : ALIQUOTA_INTERESTADUAL_NO_NE
  }

  private getAliquotaInterna(uf: string): Decimal {
    return ALIQUOTAS_INTERNAS[uf] ?? new Decimal(18)
  }
}
