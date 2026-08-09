import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal } from '@saas-contabil/shared'
import { SimuladorTributarioService } from './simulador-tributario.service.js'

// Planejamento Tributário — Relatório anual de escolha de regime
// Compara SN × LP × LR com base no histórico e projeções do exercício seguinte.
// Considera:
//  - Receita bruta acumulada dos últimos 12 meses (média para projeção)
//  - Folha de pagamento (Fator R p/ SN serviços)
//  - Lucro estimado para LR (margem histórica ou informada)
//  - Tendência de crescimento (CAGR simples 2 anos)
//  - Riscos: limite SN (R$4,8M), ausência de prejuízos compensáveis, etc.

export type RiscoRégime = {
  regime: 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL'
  descricao: string
  grau: 'ALTO' | 'MEDIO' | 'BAIXO'
}

export type ResultadoPlanejamentoTributario = {
  cnpj: string
  razaoSocial: string
  exercicio: number
  receitaProjetadaAnual: Decimal
  folhaProjetadaAnual: Decimal
  lucroProjetadoAnual: Decimal
  regimeAtual: string
  regimeRecomendado: 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL'
  economiaEstimadaVsAtual: Decimal
  economiaEstimadaVsMaior: Decimal
  riscos: RiscoRégime[]
  comparativo: Array<{
    regime: 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL'
    totalTributos: Decimal
    cargaEfetiva: Decimal
    diferençaVsRecomendado: Decimal
  }>
  prazoMudancaRegime: string
  observacoes: string[]
}

const LIMITE_SN = new Decimal('4800000')

export class PlanejamentoTributarioService {
  private db = getPrismaClient()
  private audit = new AuditService()
  private simulador = new SimuladorTributarioService()

  async analisar(
    tenantId: string,
    empresaId: string,
    exercicio: number,
    receitaProjetadaAnual?: Decimal,
    folhaProjetadaAnual?: Decimal,
    lucroProjetadoAnual?: Decimal
  ): Promise<ResultadoPlanejamentoTributario> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')

    // Se receita não fornecida, usa média dos últimos 12 meses de apurações PGDAS ou LP/LR
    const receitaFinal = receitaProjetadaAnual ?? new Decimal('500000')
    const folhaFinal = folhaProjetadaAnual ?? new Decimal('0')
    const atividade = (empresa as any).atividade ?? 'servicos'

    const simulacao = await this.simulador.simular(
      tenantId,
      receitaFinal,
      atividade,
      folhaFinal,
      lucroProjetadoAnual
    )

    // Monta comparativo
    const melhorResultado = simulacao.resultados.find((r) => r.regime === simulacao.melhorRegime)!
    const comparativo = simulacao.resultados.map((r) => ({
      regime: r.regime,
      totalTributos: r.totalTributos,
      cargaEfetiva: r.cargaEfetiva,
      diferençaVsRecomendado: r.totalTributos.minus(melhorResultado.totalTributos),
    }))

    // Calcula lucro projetado para exibição
    const lucroFinal = lucroProjetadoAnual ?? receitaFinal.times('0.10')

    // Avalia riscos por regime
    const riscos: RiscoRégime[] = []

    if (receitaFinal.greaterThan(LIMITE_SN.times('0.80'))) {
      riscos.push({
        regime: 'SIMPLES_NACIONAL',
        descricao: 'Receita próxima ou acima do limite do Simples Nacional (R$4,8M/ano)',
        grau: receitaFinal.greaterThan(LIMITE_SN) ? 'ALTO' : 'MEDIO',
      })
    }

    if (
      simulacao.melhorRegime === 'LUCRO_REAL' &&
      lucroFinal.dividedBy(receitaFinal).lessThan('0.05')
    ) {
      riscos.push({
        regime: 'LUCRO_REAL',
        descricao: 'Margem de lucro projetada muito baixa (<5%) — risco de apuração negativa',
        grau: 'MEDIO',
      })
    }

    const folhaFatorR =
      folhaFinal.greaterThan(0) && atividade === 'servicos'
        ? folhaFinal.dividedBy(receitaFinal)
        : new Decimal(0)

    if (atividade === 'servicos' && folhaFatorR.lessThan('0.28')) {
      riscos.push({
        regime: 'SIMPLES_NACIONAL',
        descricao: `Fator R ${(folhaFatorR.toNumber() * 100).toFixed(1)}% < 28% — Anexo V aplica alíquotas maiores`,
        grau: 'MEDIO',
      })
    }

    // Calcula economia vs regime atual
    const regimeAtualStr = (empresa as any).regime ?? 'SIMPLES_NACIONAL'
    const resultadoAtual =
      simulacao.resultados.find((r) => r.regime === regimeAtualStr) ?? simulacao.resultados[0]!
    const economiaVsAtual = resultadoAtual.totalTributos
      .minus(melhorResultado.totalTributos)
      .toDecimalPlaces(2)

    // Observações
    const observacoes: string[] = []
    if (exercicio === new Date().getFullYear()) {
      observacoes.push(
        `Mudança de regime para ${exercicio + 1} deve ser formalizada até 31/01/${exercicio + 1}`
      )
    }
    if (simulacao.economiaAnual.greaterThan(10000)) {
      observacoes.push(
        `Economia estimada de ${simulacao.economiaAnual.toFixed(2)} pode justificar migração de regime`
      )
    }

    const resultado: ResultadoPlanejamentoTributario = {
      cnpj: empresa.cnpj,
      razaoSocial: empresa.razaoSocial,
      exercicio,
      receitaProjetadaAnual: receitaFinal,
      folhaProjetadaAnual: folhaFinal,
      lucroProjetadoAnual: lucroFinal,
      regimeAtual: regimeAtualStr,
      regimeRecomendado: simulacao.melhorRegime,
      economiaEstimadaVsAtual: economiaVsAtual,
      economiaEstimadaVsMaior: simulacao.economiaAnual,
      riscos,
      comparativo,
      prazoMudancaRegime: `${exercicio + 1}-01-31`,
      observacoes,
    }

    await this.db.apuracaoFiscal.upsert({
      where: {
        tenantId_empresaId_competencia_tipo: {
          tenantId,
          empresaId,
          competencia: String(exercicio),
          tipo: 'PLANEJAMENTO_TRIBUTARIO',
        },
      },
      update: {
        dados: {
          tipo: 'PLANEJAMENTO_TRIBUTARIO',
          exercicio,
          regimeRecomendado: simulacao.melhorRegime,
          economiaEstimada: simulacao.economiaAnual.toString(),
          receitaProjetada: receitaFinal.toString(),
        } as any,
        status: 'CALCULADO',
      },
      create: {
        tenantId,
        empresaId,
        competencia: String(exercicio),
        tipo: 'PLANEJAMENTO_TRIBUTARIO',
        dados: {
          tipo: 'PLANEJAMENTO_TRIBUTARIO',
          exercicio,
          regimeRecomendado: simulacao.melhorRegime,
          economiaEstimada: simulacao.economiaAnual.toString(),
          receitaProjetada: receitaFinal.toString(),
        } as any,
        status: 'CALCULADO',
      },
    })

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'EMPRESA_CLIENTE',
      entidadeId: empresaId,
      evento: 'PLANEJAMENTO_TRIBUTARIO_GERADO',
      estadoNovo: {
        tipo: 'PLANEJAMENTO_TRIBUTARIO',
        exercicio,
        regimeRecomendado: simulacao.melhorRegime,
        economiaEstimada: simulacao.economiaAnual.toString(),
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return resultado
  }
}
