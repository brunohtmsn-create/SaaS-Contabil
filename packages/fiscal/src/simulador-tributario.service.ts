import { getPrismaClient } from '@saas-contabil/database'
import { Decimal } from '@saas-contabil/shared'

// Simulador Tributário — Comparativo SN × LP × LR
// Finalidade: auxiliar o planejamento tributário estimando a carga fiscal total
// para cada regime, dado uma receita bruta anual projetada.
//
// Simplificações (modelo estimativo, não substitui análise contábil profissional):
//  SN: DAS calculado pela faixa da tabela do Anexo I-V + FGTS patronal
//  LP: IRPJ(15%+adicional) + CSLL(9%) + PIS(0,65%) + COFINS(3%) + FGTS patronal
//  LR: IRPJ(15%+adicional) + CSLL(9%) + PIS(1,65%) + COFINS(7,6%) + FGTS patronal
//
// Tabela SN Anexo I (Comércio) — faixas 2024/2025:
//   Até 180k: 4,0%; até 360k: 7,3%; até 720k: 9,5%; até 1.8M: 10,7%; até 3.6M: 14,3%
// Tabela SN Anexo III (Serviços c/ Fator R ≥ 28%):
//   Até 180k: 6,0%; até 360k: 11,2%; até 720k: 13,5%; até 1.8M: 16,0%; até 3.6M: 21,0%
// Tabela SN Anexo V (Serviços c/ Fator R < 28%):
//   Até 180k: 15,5%; até 360k: 18,0%; até 720k: 19,5%; até 1.8M: 20,5%; até 3.6M: 23,0%

type FaixaSN = { limite: number; aliquota: Decimal }

const ANEXO_I: FaixaSN[] = [
  { limite: 180000, aliquota: new Decimal('0.040') },
  { limite: 360000, aliquota: new Decimal('0.073') },
  { limite: 720000, aliquota: new Decimal('0.095') },
  { limite: 1800000, aliquota: new Decimal('0.107') },
  { limite: 3600000, aliquota: new Decimal('0.143') },
  { limite: Infinity, aliquota: new Decimal('0.190') }, // acima do limite SN
]

const ANEXO_III: FaixaSN[] = [
  { limite: 180000, aliquota: new Decimal('0.060') },
  { limite: 360000, aliquota: new Decimal('0.112') },
  { limite: 720000, aliquota: new Decimal('0.135') },
  { limite: 1800000, aliquota: new Decimal('0.160') },
  { limite: 3600000, aliquota: new Decimal('0.210') },
  { limite: Infinity, aliquota: new Decimal('0.330') },
]

const ANEXO_V: FaixaSN[] = [
  { limite: 180000, aliquota: new Decimal('0.155') },
  { limite: 360000, aliquota: new Decimal('0.180') },
  { limite: 720000, aliquota: new Decimal('0.195') },
  { limite: 1800000, aliquota: new Decimal('0.205') },
  { limite: 3600000, aliquota: new Decimal('0.230') },
  { limite: Infinity, aliquota: new Decimal('0.330') },
]

function aliquotaSN(receita: Decimal, tabela: FaixaSN[]): Decimal {
  const val = receita.toNumber()
  for (const faixa of tabela) {
    if (val <= faixa.limite) return faixa.aliquota
  }
  return tabela[tabela.length - 1]!.aliquota
}

// Presunções LP
const PRESUNCAO_IRPJ_LP: Record<string, Decimal> = {
  comercio: new Decimal('0.08'),
  industria: new Decimal('0.08'),
  servicos: new Decimal('0.32'),
  outros: new Decimal('0.32'),
}
const PRESUNCAO_CSLL_LP: Record<string, Decimal> = {
  comercio: new Decimal('0.12'),
  industria: new Decimal('0.12'),
  servicos: new Decimal('0.32'),
  outros: new Decimal('0.32'),
}

const IRPJ_ALIQ = new Decimal('0.15')
const IRPJ_ADIC = new Decimal('0.10')
const CSLL_ALIQ = new Decimal('0.09')
const PIS_LP = new Decimal('0.0065')
const COFINS_LP = new Decimal('0.03')
const PIS_LR = new Decimal('0.0165')
const COFINS_LR = new Decimal('0.076')
const LIMITE_ADICIONAL_TRIMESTRAL = new Decimal('60000')
const FGTS = new Decimal('0.08') // FGTS patronal (não inclui contribuição adicional)

export type ResultadoRegime = {
  regime: 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL'
  receitaBruta: Decimal
  tributos: {
    irpj: Decimal
    csll: Decimal
    pis: Decimal
    cofins: Decimal
    das?: Decimal
  }
  totalTributos: Decimal
  cargaEfetiva: Decimal
  indicacaoFGTS: Decimal
}

export type ResultadoSimulacao = {
  receitaBrutaAnual: Decimal
  atividade: string
  resultados: ResultadoRegime[]
  melhorRegime: 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL'
  economiaAnual: Decimal
}

export class SimuladorTributarioService {
  private db = getPrismaClient()

  async simular(
    tenantId: string,
    receitaBrutaAnual: Decimal,
    atividade: string = 'servicos',
    folhaPagamentoAnual: Decimal = new Decimal(0),
    lucroEstimadoAnual?: Decimal
  ): Promise<ResultadoSimulacao> {
    // Simples Nacional (Anexo I para comércio, III para serviços com Fator R alto, V para outros serviços)
    let tabelaSN = ANEXO_I
    if (atividade === 'servicos') {
      const fatorR = folhaPagamentoAnual.greaterThan(0)
        ? folhaPagamentoAnual.dividedBy(receitaBrutaAnual)
        : new Decimal(0)
      tabelaSN = fatorR.greaterThanOrEqualTo('0.28') ? ANEXO_III : ANEXO_V
    }
    const aliqSN = aliquotaSN(receitaBrutaAnual, tabelaSN)
    const dasSN = receitaBrutaAnual.times(aliqSN).toDecimalPlaces(2)
    const fgtsAnual = folhaPagamentoAnual.times(FGTS).toDecimalPlaces(2)

    const sn: ResultadoRegime = {
      regime: 'SIMPLES_NACIONAL',
      receitaBruta: receitaBrutaAnual,
      tributos: {
        irpj: new Decimal(0),
        csll: new Decimal(0),
        pis: new Decimal(0),
        cofins: new Decimal(0),
        das: dasSN,
      },
      totalTributos: dasSN,
      cargaEfetiva: aliqSN,
      indicacaoFGTS: fgtsAnual,
    }

    // Lucro Presumido
    const presuncaoIRPJ = PRESUNCAO_IRPJ_LP[atividade] ?? PRESUNCAO_IRPJ_LP['outros']!
    const presuncaoCSLL = PRESUNCAO_CSLL_LP[atividade] ?? PRESUNCAO_CSLL_LP['outros']!
    const baseIRPJ_LP = receitaBrutaAnual.times(presuncaoIRPJ)
    const baseCSLL_LP = receitaBrutaAnual.times(presuncaoCSLL)

    const irpjLP = baseIRPJ_LP.times(IRPJ_ALIQ).toDecimalPlaces(2)
    const adicBaseTrimestralLP = Decimal.max(
      new Decimal(0),
      baseIRPJ_LP.dividedBy(4).minus(LIMITE_ADICIONAL_TRIMESTRAL)
    )
    const irpjAdicLP = adicBaseTrimestralLP.times(4).times(IRPJ_ADIC).toDecimalPlaces(2)
    const csllLP = baseCSLL_LP.times(CSLL_ALIQ).toDecimalPlaces(2)
    const pisLP = receitaBrutaAnual.times(PIS_LP).toDecimalPlaces(2)
    const cofinsLP = receitaBrutaAnual.times(COFINS_LP).toDecimalPlaces(2)
    const totalLP = irpjLP.plus(irpjAdicLP).plus(csllLP).plus(pisLP).plus(cofinsLP)

    const lp: ResultadoRegime = {
      regime: 'LUCRO_PRESUMIDO',
      receitaBruta: receitaBrutaAnual,
      tributos: {
        irpj: irpjLP.plus(irpjAdicLP),
        csll: csllLP,
        pis: pisLP,
        cofins: cofinsLP,
      },
      totalTributos: totalLP,
      cargaEfetiva: totalLP.dividedBy(receitaBrutaAnual).toDecimalPlaces(4),
      indicacaoFGTS: fgtsAnual,
    }

    // Lucro Real
    const lucroLR = lucroEstimadoAnual ?? receitaBrutaAnual.times('0.10') // estimativa: 10% de margem
    const baseIRPJ_LR = Decimal.max(new Decimal(0), lucroLR)
    const adicBaseTrimestralLR = Decimal.max(
      new Decimal(0),
      baseIRPJ_LR.dividedBy(4).minus(LIMITE_ADICIONAL_TRIMESTRAL)
    )
    const irpjLR = baseIRPJ_LR.times(IRPJ_ALIQ).toDecimalPlaces(2)
    const irpjAdicLR = adicBaseTrimestralLR.times(4).times(IRPJ_ADIC).toDecimalPlaces(2)
    const csllLR = baseIRPJ_LR.times(CSLL_ALIQ).toDecimalPlaces(2)
    const pisLR = receitaBrutaAnual.times(PIS_LR).toDecimalPlaces(2)
    const cofinsLR = receitaBrutaAnual.times(COFINS_LR).toDecimalPlaces(2)
    const totalLR = irpjLR.plus(irpjAdicLR).plus(csllLR).plus(pisLR).plus(cofinsLR)

    const lr: ResultadoRegime = {
      regime: 'LUCRO_REAL',
      receitaBruta: receitaBrutaAnual,
      tributos: {
        irpj: irpjLR.plus(irpjAdicLR),
        csll: csllLR,
        pis: pisLR,
        cofins: cofinsLR,
      },
      totalTributos: totalLR,
      cargaEfetiva: totalLR.dividedBy(receitaBrutaAnual).toDecimalPlaces(4),
      indicacaoFGTS: fgtsAnual,
    }

    const resultados = [sn, lp, lr]
    const menorCarga = resultados.reduce((min, r) =>
      r.totalTributos.lessThan(min.totalTributos) ? r : min
    )
    const maiorCarga = resultados.reduce((max, r) =>
      r.totalTributos.greaterThan(max.totalTributos) ? r : max
    )
    const economiaAnual = maiorCarga.totalTributos
      .minus(menorCarga.totalTributos)
      .toDecimalPlaces(2)

    return {
      receitaBrutaAnual,
      atividade,
      resultados,
      melhorRegime: menorCarga.regime,
      economiaAnual,
    }
  }
}
