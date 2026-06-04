import { getPrismaClient } from '@saas-contabil/database'
import { Decimal, competencias12Meses, parsePeriodo } from '@saas-contabil/shared'

// Alíquotas efetivas médias do Anexo III e V por faixa de RBT12
// Fonte: LC 123/2006 Anexo III e V (tabelas vigentes desde 2018)
const ALIQUOTAS_ANEXO_III = [
  { limite: new Decimal('180000'), aliquota: new Decimal('0.06'), deducao: new Decimal('0') },
  { limite: new Decimal('360000'), aliquota: new Decimal('0.112'), deducao: new Decimal('9360') },
  { limite: new Decimal('720000'), aliquota: new Decimal('0.135'), deducao: new Decimal('17640') },
  { limite: new Decimal('1800000'), aliquota: new Decimal('0.16'), deducao: new Decimal('35640') },
  { limite: new Decimal('3600000'), aliquota: new Decimal('0.21'), deducao: new Decimal('125640') },
  { limite: new Decimal('4800000'), aliquota: new Decimal('0.33'), deducao: new Decimal('648000') },
]

const ALIQUOTAS_ANEXO_V = [
  { limite: new Decimal('180000'), aliquota: new Decimal('0.155'), deducao: new Decimal('0') },
  { limite: new Decimal('360000'), aliquota: new Decimal('0.18'), deducao: new Decimal('4500') },
  { limite: new Decimal('720000'), aliquota: new Decimal('0.195'), deducao: new Decimal('9900') },
  { limite: new Decimal('1800000'), aliquota: new Decimal('0.205'), deducao: new Decimal('17100') },
  { limite: new Decimal('3600000'), aliquota: new Decimal('0.23'), deducao: new Decimal('62100') },
  {
    limite: new Decimal('4800000'),
    aliquota: new Decimal('0.305'),
    deducao: new Decimal('540000'),
  },
]

function calcularAliquotaEfetiva(rbt12: Decimal, tabela: typeof ALIQUOTAS_ANEXO_III): Decimal {
  if (rbt12.lte(0)) return new Decimal('0')
  for (const faixa of tabela) {
    if (rbt12.lte(faixa.limite)) {
      return rbt12.times(faixa.aliquota).minus(faixa.deducao).div(rbt12).times(100)
    }
  }
  return new Decimal('33')
}

export type ResultadoFatorR = {
  cnpj: string
  razaoSocial: string
  competencia: string
  folha12meses: string
  receita12meses: string
  fatorR: string
  anexo: 'III' | 'V'
  aliquotaAnexoIII: string
  aliquotaAnexoV: string
  economiaAnexoIII: string
  recomendacao: string
}

export class FatorRService {
  private db = getPrismaClient()

  async calcular(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<ResultadoFatorR> {
    const empresa = await this.db.empresaCliente.findFirst({ where: { id: empresaId, tenantId } })
    if (!empresa) throw new Error('Empresa não encontrada')

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

    const aliquotaIII = calcularAliquotaEfetiva(receitaBruta12m, ALIQUOTAS_ANEXO_III)
    const aliquotaV = calcularAliquotaEfetiva(receitaBruta12m, ALIQUOTAS_ANEXO_V)

    // Economia mensal se enquadrar no Anexo III em vez do V
    const receitaMensal = receitaBruta12m.div(12)
    const economiaIII = receitaMensal.times(aliquotaV.minus(aliquotaIII).div(100))

    let recomendacao: string
    if (fatorR.gte(28)) {
      recomendacao =
        `Fator R de ${fatorR.toFixed(2)}% permite enquadramento no Anexo III. ` +
        `Economia estimada de ${economiaIII.toFixed(2)} por mês em relação ao Anexo V.`
    } else {
      const folhaNecessaria = receitaBruta12m.times('0.28').minus(folha12m)
      recomendacao =
        `Fator R de ${fatorR.toFixed(2)}% resulta no Anexo V (maior carga). ` +
        `Para mudar para Anexo III, seria necessário aumentar a folha em R$ ${folhaNecessaria.toFixed(2)}/ano.`
    }

    return {
      cnpj: empresa.cnpj,
      razaoSocial: (empresa as any).razaoSocial ?? '',
      competencia,
      folha12meses: folha12m.toFixed(2),
      receita12meses: receitaBruta12m.toFixed(2),
      fatorR: fatorR.toFixed(2),
      anexo,
      aliquotaAnexoIII: aliquotaIII.toFixed(4),
      aliquotaAnexoV: aliquotaV.toFixed(4),
      economiaAnexoIII: economiaIII.toFixed(2),
      recomendacao,
    }
  }
}
