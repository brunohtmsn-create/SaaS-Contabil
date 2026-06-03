import { getPrismaClient } from '@saas-contabil/database'
import { Decimal, parsePeriodo, nowBR } from '@saas-contabil/shared'

// Diagnóstico Fiscal — Relatório de saúde fiscal de uma empresa em um período
// Consolida: status de obrigações, apurações pendentes, alertas ativos,
//            inconsistências de conciliação, e indicadores de compliance.

export type StatusItemDiagnostico = 'OK' | 'PENDENTE' | 'ATRASADO' | 'NAO_APLICAVEL' | 'INCOMPLETO'

export type ItemDiagnostico = {
  categoria: string
  item: string
  status: StatusItemDiagnostico
  detalhe?: string
  prazo?: string
}

export type IndicadorCompliance = {
  total: number
  ok: number
  pendentes: number
  atrasados: number
  percentualCompliance: number
}

export type ResultadoDiagnosticoFiscal = {
  cnpj: string
  razaoSocial: string
  regime: string
  competencia: string
  geradoEm: Date
  itens: ItemDiagnostico[]
  indicador: IndicadorCompliance
  alertasAtivos: number
  documentosPendenteConciliacao: number
  recomendacoes: string[]
}

export class DiagnosticoFiscalService {
  private db = getPrismaClient()

  async diagnosticar(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<ResultadoDiagnosticoFiscal> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')

    const { inicio, fim } = parsePeriodo(competencia)
    const regime = (empresa as any).regime ?? 'SIMPLES_NACIONAL'

    // Busca apurações do período
    const apuracoes = await this.db.apuracaoFiscal.findMany({
      where: { tenantId, empresaId, competencia },
    })

    const tiposApurados = new Set(apuracoes.map((a) => a.tipo))

    // Busca obrigações do período
    const obrigacoes = await this.db.obrigacao.findMany({
      where: { tenantId, empresaId, competencia },
    })

    const hoje = nowBR()

    // Busca alertas ativos
    const alertas = await this.db.alerta.findMany({
      where: { tenantId, empresaId, lido: false },
    })

    // Busca documentos não conciliados no período
    const docsPendentes = await this.db.documentoFiscal.count({
      where: {
        tenantId,
        empresaId,
        dataCompetencia: { gte: inicio, lte: fim },
        status: { in: ['CAPTURADO', 'NORMALIZADO', 'VALIDADO', 'EM_CONCILIACAO'] },
      },
    })

    const itens: ItemDiagnostico[] = []

    // --- SIMPLES NACIONAL ---
    if (regime === 'SIMPLES_NACIONAL') {
      itens.push(buildItemApuracao('DAS', 'PGDAS', tiposApurados, obrigacoes, hoje, competencia))
      itens.push(
        buildItemApuracao('EFD-Reinf', 'EFD_REINF', tiposApurados, obrigacoes, hoje, competencia)
      )
      itens.push({
        categoria: 'Estadual',
        item: 'DeSTDA / GNRE',
        status: tiposApurados.has('DESTDA') || tiposApurados.has('GNRE') ? 'OK' : 'PENDENTE',
      })
      itens.push({
        categoria: 'Competência',
        item: 'Fator R',
        status: tiposApurados.has('PGDAS') ? 'OK' : 'PENDENTE',
        detalhe: tiposApurados.has('PGDAS') ? 'Calculado com PGDAS' : 'Calcular antes do PGDAS',
      })
    }

    // --- LUCRO PRESUMIDO ---
    if (regime === 'LUCRO_PRESUMIDO') {
      itens.push(
        buildItemApuracao('IRPJ/CSLL', 'IRPJ_LP', tiposApurados, obrigacoes, hoje, competencia)
      )
      itens.push(
        buildItemApuracao('PIS/COFINS', 'PIS', tiposApurados, obrigacoes, hoje, competencia)
      )
      itens.push(
        buildItemApuracao('EFD-Reinf', 'EFD_REINF', tiposApurados, obrigacoes, hoje, competencia)
      )
      itens.push(
        buildItemApuracao('DCTFWeb', 'DCTFWEB', tiposApurados, obrigacoes, hoje, competencia)
      )
      itens.push(
        buildItemApuracao(
          'DCTF Mensal',
          'DCTF_MENSAL',
          tiposApurados as any,
          obrigacoes,
          hoje,
          competencia
        )
      )
    }

    // --- LUCRO REAL ---
    if (regime === 'LUCRO_REAL') {
      itens.push(
        buildItemApuracao('IRPJ/CSLL LR', 'IRPJ_LR', tiposApurados, obrigacoes, hoje, competencia)
      )
      itens.push(
        buildItemApuracao('PIS/COFINS LR', 'PIS', tiposApurados, obrigacoes, hoje, competencia)
      )
      itens.push(
        buildItemApuracao('EFD-Reinf', 'EFD_REINF', tiposApurados, obrigacoes, hoje, competencia)
      )
      itens.push(
        buildItemApuracao('DCTFWeb', 'DCTFWEB', tiposApurados, obrigacoes, hoje, competencia)
      )
      itens.push({
        categoria: 'Contábil',
        item: 'LALUR',
        status: tiposApurados.has('IRPJ_LR') ? 'OK' : 'PENDENTE',
        detalhe: 'Apuração do Lucro Real via LALUR',
      })
    }

    // Itens comuns a todos os regimes
    itens.push({
      categoria: 'FGTS',
      item: 'FGTS Digital',
      status: tiposApurados.has('DAS') ? 'OK' : 'PENDENTE',
    })

    itens.push({
      categoria: 'Conciliação',
      item: 'Documentos Conciliados',
      status: docsPendentes === 0 ? 'OK' : 'INCOMPLETO',
      detalhe:
        docsPendentes > 0
          ? `${docsPendentes} documento(s) pendente(s) de conciliação`
          : 'Todos conciliados',
    })

    // Calcula indicador
    const totalAplicavel = itens.filter((i) => i.status !== 'NAO_APLICAVEL').length
    const ok = itens.filter((i) => i.status === 'OK').length
    const pendentes = itens.filter((i) => i.status === 'PENDENTE').length
    const atrasados = itens.filter((i) => i.status === 'ATRASADO').length
    const percentualCompliance = totalAplicavel > 0 ? Math.round((ok / totalAplicavel) * 100) : 100

    // Recomendações
    const recomendacoes: string[] = []
    if (docsPendentes > 0) {
      recomendacoes.push(
        `Conciliar ${docsPendentes} documento(s) antes de fechar a competência ${competencia}`
      )
    }
    if (atrasados > 0) {
      recomendacoes.push(
        `${atrasados} obrigação(ões) em atraso — verificar multas e juros aplicáveis`
      )
    }
    if (alertas.length > 0) {
      recomendacoes.push(
        `${alertas.length} alerta(s) ativo(s) — verificar em Alertas e Vencimentos`
      )
    }
    if (percentualCompliance < 80) {
      recomendacoes.push(
        'Compliance abaixo de 80% — priorize o fechamento das obrigações pendentes'
      )
    }

    return {
      cnpj: empresa.cnpj,
      razaoSocial: empresa.razaoSocial,
      regime,
      competencia,
      geradoEm: hoje,
      itens,
      indicador: {
        total: totalAplicavel,
        ok,
        pendentes,
        atrasados,
        percentualCompliance,
      },
      alertasAtivos: alertas.length,
      documentosPendenteConciliacao: docsPendentes,
      recomendacoes,
    }
  }
}

function buildItemApuracao(
  label: string,
  tipo: string,
  tiposApurados: Set<string>,
  obrigacoes: any[],
  hoje: Date,
  competencia: string
): ItemDiagnostico {
  const apurado = tiposApurados.has(tipo)
  const obrigacao = obrigacoes.find((o) => o.tipo === tipo || o.tipo.includes(tipo))
  const transmitido = obrigacao?.status === 'TRANSMITIDA' || obrigacao?.status === 'PAGA'
  const vencimento = obrigacao ? new Date(obrigacao.vencimento) : null
  const atrasado = vencimento ? hoje > vencimento && !transmitido : false

  return {
    categoria: 'Apuração',
    item: label,
    status: atrasado ? 'ATRASADO' : transmitido ? 'OK' : apurado ? 'PENDENTE' : 'PENDENTE',
    detalhe: transmitido
      ? 'Transmitido'
      : apurado
        ? 'Apurado — aguardando transmissão'
        : `Pendente de apuração para ${competencia}`,
    ...(vencimento ? { prazo: vencimento.toLocaleDateString('pt-BR') } : {}),
  }
}
