import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal } from '@saas-contabil/shared'

// Depreciação de Bens — Lucro Real
// Base legal: art. 305 a 323 do RIR/2018 (Decreto 9.580/2018), IN SRF 162/1998
// Método: linha reta (quotas constantes) — prazo em anos conforme tabela SRF
// Depreciação acelerada: turno duplo (50% acréscimo) ou triplo (100% acréscimo)
// A depreciação fiscal é dedutível como despesa operacional na apuração do IRPJ/CSLL

// Taxas anuais de depreciação (IN SRF 162/1998) — vida útil e taxa anual
const TAXAS_DEPRECIACAO: Record<string, { vidaUtilAnos: number; taxaAnual: Decimal }> = {
  edificacoes: { vidaUtilAnos: 25, taxaAnual: new Decimal('0.04') }, // 4% a.a.
  instalacoes: { vidaUtilAnos: 10, taxaAnual: new Decimal('0.10') }, // 10% a.a.
  maquinas_equipamentos: { vidaUtilAnos: 10, taxaAnual: new Decimal('0.10') }, // 10% a.a.
  moveis_utensilios: { vidaUtilAnos: 10, taxaAnual: new Decimal('0.10') }, // 10% a.a.
  veiculos: { vidaUtilAnos: 5, taxaAnual: new Decimal('0.20') }, // 20% a.a.
  computadores_perifericos: { vidaUtilAnos: 5, taxaAnual: new Decimal('0.20') }, // 20% a.a.
  software: { vidaUtilAnos: 5, taxaAnual: new Decimal('0.20') }, // 20% a.a.
  aeronaves: { vidaUtilAnos: 20, taxaAnual: new Decimal('0.05') }, // 5% a.a.
  embarcacoes: { vidaUtilAnos: 10, taxaAnual: new Decimal('0.10') }, // 10% a.a.
  outros: { vidaUtilAnos: 10, taxaAnual: new Decimal('0.10') }, // 10% a.a. padrão
}

// Fator de aceleração por turno de trabalho (art. 312 RIR/2018)
const FATOR_TURNO: Record<string, Decimal> = {
  simples: new Decimal('1.0'), // 1 turno: taxa normal
  duplo: new Decimal('1.5'), // 2 turnos: 50% acréscimo
  triplo: new Decimal('2.0'), // 3 turnos: 100% acréscimo (taxa dobrada)
}

export type BemDepreciavel = {
  id: string
  descricao: string
  categoria: string
  valorAquisicao: Decimal
  dataAquisicao: Date
  vidaUtilAnos: number
  taxaAnualPersonalizada?: Decimal // se definida, sobrepõe a tabela SRF
  turnoTrabalho: 'simples' | 'duplo' | 'triplo'
  valorResidual: Decimal // valor mínimo ao final da vida útil
}

export type ItemDepreciacao = {
  bemId: string
  descricao: string
  categoria: string
  valorAquisicao: Decimal
  valorContabil: Decimal // valor líquido (custo - depreciação acumulada)
  depreciacaoMensal: Decimal
  depreciacaoAcumulada: Decimal
  taxaMensal: Decimal
  totalMeses: number
  mesesDecorridos: number
  mesesRestantes: number
  percentualDepreciado: Decimal
  totalmenteDepreciado: boolean
}

export type ResultadoDepreciacaoLR = {
  cnpj: string
  competencia: string
  totalBens: number
  totalValorAquisicao: Decimal
  totalDepreciacaoMensal: Decimal
  totalDepreciacaoAcumulada: Decimal
  totalValorContabil: Decimal
  itens: ItemDepreciacao[]
}

function calcularMesesEntre(inicio: Date, fim: Date): number {
  const meses =
    (fim.getFullYear() - inicio.getFullYear()) * 12 + (fim.getMonth() - inicio.getMonth())
  return Math.max(0, meses)
}

export class DepreciacaoLRService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async apurar(
    tenantId: string,
    empresaId: string,
    competencia: string,
    bens: BemDepreciavel[]
  ): Promise<ResultadoDepreciacaoLR> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')
    if (empresa.regime !== 'LUCRO_REAL')
      throw new Error('Controle de depreciação fiscal é exclusivo do Lucro Real')

    const [anoStr, mesStr] = competencia.split('-')
    const ano = parseInt(anoStr!, 10)
    const mes = parseInt(mesStr!, 10)
    // Data final da competência (último dia do mês)
    const fimCompetencia = new Date(ano, mes, 0)

    const itens: ItemDepreciacao[] = []
    let totalDepreciacaoMensal = new Decimal(0)
    let totalDepreciacaoAcumulada = new Decimal(0)
    let totalValorAquisicao = new Decimal(0)
    let totalValorContabil = new Decimal(0)

    for (const bem of bens) {
      // Obtém taxa anual (personalizada ou da tabela)
      const entrada = TAXAS_DEPRECIACAO[bem.categoria] ?? TAXAS_DEPRECIACAO['outros']!
      const taxaAnual = bem.taxaAnualPersonalizada ?? entrada.taxaAnual
      const vidaUtilAnos = bem.taxaAnualPersonalizada
        ? Math.round(1 / bem.taxaAnualPersonalizada.toNumber())
        : entrada.vidaUtilAnos

      // Aplica fator de turno
      const fatorTurno = FATOR_TURNO[bem.turnoTrabalho] ?? FATOR_TURNO['simples']!
      const taxaAnualEfetiva = taxaAnual.times(fatorTurno)
      // Limita a 100% (bem não pode depreciar mais de 100% ao ano)
      const taxaAnualLimitada = Decimal.min(taxaAnualEfetiva, new Decimal('1.0'))
      const taxaMensal = taxaAnualLimitada.dividedBy(12)

      const totalMeses = vidaUtilAnos * 12
      const mesesDecorridos = calcularMesesEntre(bem.dataAquisicao, fimCompetencia)

      // Base de cálculo = valor de aquisição - valor residual
      const baseCalculo = bem.valorAquisicao.minus(bem.valorResidual)

      // Depreciação acumulada até a competência
      const mesesEfetivos = Math.min(mesesDecorridos, totalMeses)
      const depreciacaoAcumulada = baseCalculo
        .times(taxaMensal)
        .times(mesesEfetivos)
        .toDecimalPlaces(2)

      const totalmenteDepreciado = mesesDecorridos >= totalMeses

      // Depreciação do mês corrente (zero se totalmente depreciado)
      const depreciacaoMensal = totalmenteDepreciado
        ? new Decimal(0)
        : baseCalculo.times(taxaMensal).toDecimalPlaces(2)

      const valorContabil = Decimal.max(
        bem.valorAquisicao.minus(depreciacaoAcumulada),
        bem.valorResidual
      )

      const percentualDepreciado = baseCalculo.gt(0)
        ? depreciacaoAcumulada.dividedBy(baseCalculo).times(100).toDecimalPlaces(2)
        : new Decimal(0)

      totalDepreciacaoMensal = totalDepreciacaoMensal.plus(depreciacaoMensal)
      totalDepreciacaoAcumulada = totalDepreciacaoAcumulada.plus(depreciacaoAcumulada)
      totalValorAquisicao = totalValorAquisicao.plus(bem.valorAquisicao)
      totalValorContabil = totalValorContabil.plus(valorContabil)

      itens.push({
        bemId: bem.id,
        descricao: bem.descricao,
        categoria: bem.categoria,
        valorAquisicao: bem.valorAquisicao,
        valorContabil,
        depreciacaoMensal,
        depreciacaoAcumulada,
        taxaMensal,
        totalMeses,
        mesesDecorridos,
        mesesRestantes: Math.max(0, totalMeses - mesesDecorridos),
        percentualDepreciado,
        totalmenteDepreciado,
      })
    }

    const resultado: ResultadoDepreciacaoLR = {
      cnpj: empresa.cnpj,
      competencia,
      totalBens: itens.length,
      totalValorAquisicao,
      totalDepreciacaoMensal,
      totalDepreciacaoAcumulada,
      totalValorContabil,
      itens,
    }

    // Persiste o total de depreciação mensal (usado como ajuste no LALUR)
    await this.db.apuracaoFiscal.upsert({
      where: {
        tenantId_empresaId_competencia_tipo: {
          tenantId,
          empresaId,
          competencia,
          tipo: 'CSLL_LR',
        },
      },
      update: {
        dados: {
          totalDepreciacaoMensal: totalDepreciacaoMensal.toString(),
          totalBens: itens.length,
          tipo: 'DEPRECIACAO',
        } as any,
        status: 'CALCULADO',
      },
      create: {
        tenantId,
        empresaId,
        competencia,
        tipo: 'CSLL_LR',
        dados: {
          totalDepreciacaoMensal: totalDepreciacaoMensal.toString(),
          totalBens: itens.length,
          tipo: 'DEPRECIACAO',
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
        tipo: 'DEPRECIACAO',
        totalBens: itens.length,
        totalDepreciacaoMensal: totalDepreciacaoMensal.toString(),
        totalValorContabil: totalValorContabil.toString(),
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return resultado
  }

  getTaxaDepreciacao(categoria: string): { vidaUtilAnos: number; taxaAnual: Decimal } | undefined {
    return TAXAS_DEPRECIACAO[categoria]
  }

  getCategorias(): string[] {
    return Object.keys(TAXAS_DEPRECIACAO)
  }
}
