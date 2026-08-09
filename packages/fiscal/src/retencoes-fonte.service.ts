import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal } from '@saas-contabil/shared'

// Retenções na Fonte — IRRF, CSLL, PIS e COFINS
// Base legal: Lei 10.833/2003, IN SRF 459/2004, Lei 9.430/96
// Aplicável ao tomador de serviços: quando paga NFS-e, retém e recolhe impostos do prestador
// Retenções reduzem o valor a recolher pelo prestador (crédito)
//
// Limites de retenção (IN SRF 459/2004):
// - IRRF: retém quando pagamento mensal ao mesmo prestador > R$10,64 (IN 1.500/2014)
// - CSRF (PIS+COFINS+CSLL combinados): retém quando pagamento > R$5.000/mês ao mesmo prestador
// - Alíquotas CSRF: PIS 0,65%, COFINS 3%, CSLL 1% (total 4,65%)

const CSRF_ALIQUOTA_PIS = new Decimal('0.0065')
const CSRF_ALIQUOTA_COFINS = new Decimal('0.03')
const CSRF_ALIQUOTA_CSLL = new Decimal('0.01')
const LIMITE_CSRF = new Decimal('5000')

// IRRF sobre serviços: alíquotas por natureza do serviço
const IRRF_ALIQUOTAS: Record<string, Decimal> = {
  servicos_profissionais: new Decimal('0.015'), // 1,5%
  limpeza_conservacao: new Decimal('0.01'), // 1%
  vigilancia_seguranca: new Decimal('0.01'), // 1%
  transporte_cargas: new Decimal('0.005'), // 0,5%
  construcao_civil: new Decimal('0.015'), // 1,5%
  ti_software: new Decimal('0.015'), // 1,5%
  intermediacao: new Decimal('0.015'), // 1,5%
  outros: new Decimal('0.015'), // 1,5% padrão
}

export type RetencaoPorPrestador = {
  cnpjPrestador: string
  totalPago: Decimal
  irrfRetido: Decimal
  pisRetido: Decimal
  cofinsRetido: Decimal
  csllRetido: Decimal
  totalRetencoes: Decimal
  documentos: string[] // IDs dos documentos
}

export type ResultadoRetencoesNaFonte = {
  cnpj: string
  competencia: string
  regime: string
  totalPrestadores: number
  totalPago: Decimal
  totalIRRF: Decimal
  totalPIS: Decimal
  totalCOFINS: Decimal
  totalCSLL: Decimal
  totalRetencoes: Decimal
  prazoRecolhimento: string // DARF até o dia 20 do mês seguinte
  retencoesPorPrestador: RetencaoPorPrestador[]
}

function prazoRecolhimento(competencia: string): string {
  const [anoStr, mesStr] = competencia.split('-')
  let ano = parseInt(anoStr!, 10)
  let mes = parseInt(mesStr!, 10) + 1
  if (mes > 12) {
    mes = 1
    ano += 1
  }
  return `${ano}-${String(mes).padStart(2, '0')}-20`
}

export class RetencoesNaFonteService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async apurar(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<ResultadoRetencoesNaFonte> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')
    if (empresa.regime !== 'LUCRO_PRESUMIDO' && empresa.regime !== 'LUCRO_REAL')
      throw new Error('Retenções na fonte são aplicáveis apenas para Lucro Presumido ou Lucro Real')

    const [anoStr, mesStr] = competencia.split('-')
    const ano = parseInt(anoStr!, 10)
    const mes = parseInt(mesStr!, 10)
    const inicio = new Date(ano, mes - 1, 1)
    const fim = new Date(ano, mes, 0, 23, 59, 59)

    // Busca NFS-e tomadas (serviços pagos — onde a empresa é o tomador)
    const documentos = await this.db.documentoFiscal.findMany({
      where: {
        tenantId,
        empresaId,
        dataCompetencia: { gte: inicio, lte: fim },
        status: 'CONCILIADO',
        tipo: { in: ['NFSE_TOMADA'] },
        direcao: { in: ['ENTRADA'] },
      },
      orderBy: { dataEmissao: 'asc' },
    })

    // Agrupa por CNPJ do prestador para calcular CSRF (limite R$5.000/prestador/mês)
    const porPrestador = new Map<string, { total: Decimal; docs: string[] }>()

    for (const doc of documentos) {
      const cnpjPrestador = (doc as any).cnpjEmitente ?? (doc as any).cnpjDestinatario ?? 'SEM_CNPJ'
      const valor = new Decimal(doc.valorTotal.toString())
      const existing = porPrestador.get(cnpjPrestador)
      if (existing) {
        existing.total = existing.total.plus(valor)
        existing.docs.push(doc.id)
      } else {
        porPrestador.set(cnpjPrestador, { total: valor, docs: [doc.id] })
      }
    }

    const retencoesPorPrestador: RetencaoPorPrestador[] = []
    let totalPago = new Decimal(0)
    let totalIRRF = new Decimal(0)
    let totalPIS = new Decimal(0)
    let totalCOFINS = new Decimal(0)
    let totalCSLL = new Decimal(0)

    for (const [cnpjPrestador, { total, docs }] of porPrestador) {
      totalPago = totalPago.plus(total)

      // IRRF: 1,5% padrão (serviços profissionais) — independente do limite
      const irrfRetido = total.times(IRRF_ALIQUOTAS['servicos_profissionais']!).toDecimalPlaces(2)

      // CSRF: PIS+COFINS+CSLL somente quando total pago ao prestador > R$5.000
      let pisRetido = new Decimal(0)
      let cofinsRetido = new Decimal(0)
      let csllRetido = new Decimal(0)

      if (total.gt(LIMITE_CSRF)) {
        pisRetido = total.times(CSRF_ALIQUOTA_PIS).toDecimalPlaces(2)
        cofinsRetido = total.times(CSRF_ALIQUOTA_COFINS).toDecimalPlaces(2)
        csllRetido = total.times(CSRF_ALIQUOTA_CSLL).toDecimalPlaces(2)
      }

      const totalRetencoes = irrfRetido.plus(pisRetido).plus(cofinsRetido).plus(csllRetido)

      totalIRRF = totalIRRF.plus(irrfRetido)
      totalPIS = totalPIS.plus(pisRetido)
      totalCOFINS = totalCOFINS.plus(cofinsRetido)
      totalCSLL = totalCSLL.plus(csllRetido)

      retencoesPorPrestador.push({
        cnpjPrestador,
        totalPago: total,
        irrfRetido,
        pisRetido,
        cofinsRetido,
        csllRetido,
        totalRetencoes,
        documentos: docs,
      })
    }

    const totalRetencoes = totalIRRF.plus(totalPIS).plus(totalCOFINS).plus(totalCSLL)
    const prazo = prazoRecolhimento(competencia)

    const resultado: ResultadoRetencoesNaFonte = {
      cnpj: empresa.cnpj,
      competencia,
      regime: empresa.regime,
      totalPrestadores: retencoesPorPrestador.length,
      totalPago,
      totalIRRF,
      totalPIS,
      totalCOFINS,
      totalCSLL,
      totalRetencoes,
      prazoRecolhimento: prazo,
      retencoesPorPrestador,
    }

    await this.db.apuracaoFiscal.upsert({
      where: {
        tenantId_empresaId_competencia_tipo: {
          tenantId,
          empresaId,
          competencia,
          tipo: 'DCTFWEB',
        },
      },
      update: {
        dados: {
          totalIRRF: totalIRRF.toString(),
          totalPIS: totalPIS.toString(),
          totalCOFINS: totalCOFINS.toString(),
          totalCSLL: totalCSLL.toString(),
          totalRetencoes: totalRetencoes.toString(),
          tipo: 'RETENCOES',
        } as any,
        status: 'CALCULADO',
      },
      create: {
        tenantId,
        empresaId,
        competencia,
        tipo: 'DCTFWEB',
        dados: {
          totalIRRF: totalIRRF.toString(),
          totalPIS: totalPIS.toString(),
          totalCOFINS: totalCOFINS.toString(),
          totalCSLL: totalCSLL.toString(),
          totalRetencoes: totalRetencoes.toString(),
          tipo: 'RETENCOES',
        } as any,
        status: 'CALCULADO',
      },
    })

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'EMPRESA_CLIENTE',
      entidadeId: empresaId,
      evento: 'DCTFWEB_TRANSMITIDA',
      estadoNovo: {
        competencia,
        regime: empresa.regime,
        totalIRRF: totalIRRF.toString(),
        totalRetencoes: totalRetencoes.toString(),
        totalPrestadores: retencoesPorPrestador.length,
        prazoRecolhimento: prazo,
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return resultado
  }
}
