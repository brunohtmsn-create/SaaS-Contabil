import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal } from '@saas-contabil/shared'

// IRPJ/CSLL por Estimativa Mensal — Lucro Real (art. 2º Lei 9.430/96)
// A empresa LR pode pagar mensalmente por estimativa, em vez de apurar trimestralmente.
// Base: receita bruta mensal × percentual de presunção (igual ao LP)
// IRPJ: base × 15% + adicional 10% sobre base que exceder R$20.000/mês
// CSLL: base × 9%
// DARF até dia 31 do mês seguinte (código 2362 IRPJ / 2484 CSLL)
// Ajuste em 31/12: se pagamentos por estimativa > imposto real, diferença é restituível.
// Se pagamentos < imposto real, empresa deve DARF da diferença em 31/03 do ano seguinte.

// Percentuais de presunção para base de cálculo (IRPJ) — igual ao LP
const PRESUNCAO_IRPJ: Record<string, Decimal> = {
  comercio: new Decimal('0.08'), // 8%
  industria: new Decimal('0.08'), // 8%
  transporte_carga: new Decimal('0.08'), // 8%
  servicos_hospitalares: new Decimal('0.08'), // 8%
  transporte_passageiros: new Decimal('0.16'), // 16%
  servicos_gerais: new Decimal('0.32'), // 32%
  profissoes_regulamentadas: new Decimal('0.32'), // 32%
  outros: new Decimal('0.08'), // 8% padrão
}

// Percentuais de presunção para base de cálculo (CSLL)
const PRESUNCAO_CSLL: Record<string, Decimal> = {
  comercio: new Decimal('0.12'), // 12%
  industria: new Decimal('0.12'), // 12%
  transporte_carga: new Decimal('0.12'), // 12%
  servicos_hospitalares: new Decimal('0.12'), // 12%
  transporte_passageiros: new Decimal('0.12'), // 12%
  servicos_gerais: new Decimal('0.32'), // 32%
  profissoes_regulamentadas: new Decimal('0.32'), // 32%
  outros: new Decimal('0.12'), // 12% padrão
}

const ALIQUOTA_IRPJ = new Decimal('0.15')
const ALIQUOTA_IRPJ_ADICIONAL = new Decimal('0.10')
const LIMITE_ADICIONAL_MENSAL = new Decimal('20000') // R$20.000/mês
const ALIQUOTA_CSLL = new Decimal('0.09')

export type ResultadoIrpjCsllLREstimativa = {
  cnpj: string
  competencia: string
  regime: string
  receitaBruta: Decimal
  atividadePrincipal: string
  baseIRPJ: Decimal
  baseCSLL: Decimal
  irpjNormal: Decimal
  irpjAdicional: Decimal
  irpjTotal: Decimal
  csllDevida: Decimal
  totalDevido: Decimal
  prazoRecolhimento: string
  codigoDarfIRPJ: string
  codigoDarfCSLL: string
}

function prazoEstimativa(competencia: string): string {
  const [anoStr, mesStr] = competencia.split('-')
  let ano = parseInt(anoStr!, 10)
  let mes = parseInt(mesStr!, 10) + 1
  if (mes > 12) {
    mes = 1
    ano += 1
  }
  return `${ano}-${String(mes).padStart(2, '0')}-31`
}

export class IrpjCsllLREstimativaService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async apurar(
    tenantId: string,
    empresaId: string,
    competencia: string,
    atividadePrincipal: string = 'outros'
  ): Promise<ResultadoIrpjCsllLREstimativa> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')
    if (empresa.regime !== 'LUCRO_REAL')
      throw new Error('Estimativas mensais são exclusivas do Lucro Real')

    const [anoStr, mesStr] = competencia.split('-')
    const ano = parseInt(anoStr!, 10)
    const mes = parseInt(mesStr!, 10)
    const inicio = new Date(ano, mes - 1, 1)
    const fim = new Date(ano, mes, 0, 23, 59, 59)

    // Receita bruta: documentos de saída (NF-e, NFC-e, NFSe emitidas) conciliados
    const documentos = await this.db.documentoFiscal.findMany({
      where: {
        tenantId,
        empresaId,
        dataCompetencia: { gte: inicio, lte: fim },
        status: 'CONCILIADO',
        direcao: { in: ['SAIDA', 'EMITIDO'] },
        tipo: { in: ['NFE', 'NFCE', 'NFSE_EMITIDA'] },
      },
    })

    let receitaBruta = new Decimal(0)
    for (const doc of documentos) {
      receitaBruta = receitaBruta.plus(new Decimal(doc.valorTotal.toString()))
    }

    // Percentuais de presunção
    const percIRPJ = PRESUNCAO_IRPJ[atividadePrincipal] ?? PRESUNCAO_IRPJ['outros']!
    const percCSLL = PRESUNCAO_CSLL[atividadePrincipal] ?? PRESUNCAO_CSLL['outros']!

    const baseIRPJ = receitaBruta.times(percIRPJ).toDecimalPlaces(2)
    const baseCSLL = receitaBruta.times(percCSLL).toDecimalPlaces(2)

    // IRPJ: 15% normal + 10% adicional sobre base > R$20.000/mês
    const irpjNormal = baseIRPJ.times(ALIQUOTA_IRPJ).toDecimalPlaces(2)
    const excedente = baseIRPJ.minus(LIMITE_ADICIONAL_MENSAL)
    const irpjAdicional = excedente.gt(0)
      ? excedente.times(ALIQUOTA_IRPJ_ADICIONAL).toDecimalPlaces(2)
      : new Decimal(0)
    const irpjTotal = irpjNormal.plus(irpjAdicional)

    // CSLL: 9%
    const csllDevida = baseCSLL.times(ALIQUOTA_CSLL).toDecimalPlaces(2)

    const totalDevido = irpjTotal.plus(csllDevida)
    const prazo = prazoEstimativa(competencia)

    const resultado: ResultadoIrpjCsllLREstimativa = {
      cnpj: empresa.cnpj,
      competencia,
      regime: empresa.regime,
      receitaBruta,
      atividadePrincipal,
      baseIRPJ,
      baseCSLL,
      irpjNormal,
      irpjAdicional,
      irpjTotal,
      csllDevida,
      totalDevido,
      prazoRecolhimento: prazo,
      codigoDarfIRPJ: '2362',
      codigoDarfCSLL: '2484',
    }

    await this.db.apuracaoFiscal.upsert({
      where: {
        tenantId_empresaId_competencia_tipo: {
          tenantId,
          empresaId,
          competencia,
          tipo: 'IRPJ_LR',
        },
      },
      update: {
        dados: {
          baseIRPJ: baseIRPJ.toString(),
          irpjTotal: irpjTotal.toString(),
          csllDevida: csllDevida.toString(),
          totalDevido: totalDevido.toString(),
          atividadePrincipal,
          modalidade: 'ESTIMATIVA',
        } as any,
        status: 'CALCULADO',
      },
      create: {
        tenantId,
        empresaId,
        competencia,
        tipo: 'IRPJ_LR',
        dados: {
          baseIRPJ: baseIRPJ.toString(),
          irpjTotal: irpjTotal.toString(),
          csllDevida: csllDevida.toString(),
          totalDevido: totalDevido.toString(),
          atividadePrincipal,
          modalidade: 'ESTIMATIVA',
        } as any,
        status: 'CALCULADO',
      },
    })

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'EMPRESA_CLIENTE',
      entidadeId: empresaId,
      evento: 'IRPJ_CSLL_LR_APURADO',
      estadoNovo: {
        competencia,
        regime: empresa.regime,
        modalidade: 'ESTIMATIVA',
        atividadePrincipal,
        receitaBruta: receitaBruta.toString(),
        irpjTotal: irpjTotal.toString(),
        csllDevida: csllDevida.toString(),
        totalDevido: totalDevido.toString(),
        prazoRecolhimento: prazo,
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return resultado
  }
}
