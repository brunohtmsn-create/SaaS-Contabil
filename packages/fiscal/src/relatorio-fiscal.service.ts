import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal, parsePeriodo } from '@saas-contabil/shared'

// Relatório Fiscal Consolidado — Sumário de todos os tributos apurados no período.
// Agrega apurações, obrigações, documentos e pagamentos para gerar um relatório
// que o contador pode usar para revisar ou entregar ao cliente.

export type LinhaRelatorio = {
  tributo: string
  regime: string
  baseCalculo: Decimal
  aliquota: Decimal
  valorApurado: Decimal
  valorPago: Decimal
  status: 'PAGO' | 'PENDENTE' | 'TRANSMITIDO' | 'NAO_APURADO'
  vencimento?: string
  observacao?: string
}

export type ResultadoRelatorioFiscal = {
  cnpj: string
  razaoSocial: string
  competencia: string
  geradoEm: Date
  regime: string
  tributos: LinhaRelatorio[]
  totalApurado: Decimal
  totalPago: Decimal
  totalPendente: Decimal
  percentualPago: number
}

export class RelatorioFiscalService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async gerar(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<ResultadoRelatorioFiscal> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')

    const regime = (empresa as any).regime ?? 'SIMPLES_NACIONAL'

    // Busca todas as apurações do período
    const apuracoes = await this.db.apuracaoFiscal.findMany({
      where: { tenantId, empresaId, competencia },
    })

    // Busca obrigações (para status de transmissão/pagamento)
    const obrigacoes = await this.db.obrigacao.findMany({
      where: { tenantId, empresaId, competencia },
    })

    const tributos: LinhaRelatorio[] = []

    for (const ap of apuracoes) {
      const dados = ap.dados as any
      if (!dados) continue

      const obrig = obrigacoes.find((o) => o.tipo === ap.tipo)
      const statusObrig = (obrig?.status as string) ?? 'PENDENTE'
      const valorPago =
        statusObrig === 'PAGA' || statusObrig === 'TRANSMITIDA'
          ? new Decimal(dados.totalTributos ?? dados.valorDAS ?? dados.totalDAS ?? '0')
          : new Decimal('0')

      const linha = buildLinha(ap.tipo, regime, dados, statusObrig, valorPago, obrig)
      if (linha) tributos.push(linha)
    }

    // Preenche tributos ausentes como NAO_APURADO dependendo do regime
    const tiposApurados = new Set(apuracoes.map((a) => a.tipo as string))
    const tiposEsperados = getTiposEsperados(regime)

    for (const tipo of tiposEsperados) {
      if (!tiposApurados.has(tipo)) {
        tributos.push({
          tributo: getTributoLabel(tipo),
          regime,
          baseCalculo: new Decimal('0'),
          aliquota: new Decimal('0'),
          valorApurado: new Decimal('0'),
          valorPago: new Decimal('0'),
          status: 'NAO_APURADO',
          observacao: `${getTributoLabel(tipo)} não apurado para ${competencia}`,
        })
      }
    }

    // Totais
    const totalApurado = tributos.reduce((acc, t) => acc.plus(t.valorApurado), new Decimal('0'))
    const totalPago = tributos.reduce((acc, t) => acc.plus(t.valorPago), new Decimal('0'))
    const totalPendente = totalApurado.minus(totalPago)
    const percentualPago = totalApurado.greaterThan(0)
      ? totalPago.dividedBy(totalApurado).times(100).toNumber()
      : 0

    const resultado: ResultadoRelatorioFiscal = {
      cnpj: empresa.cnpj,
      razaoSocial: empresa.razaoSocial,
      competencia,
      geradoEm: new Date(),
      regime,
      tributos,
      totalApurado: totalApurado.toDecimalPlaces(2),
      totalPago: totalPago.toDecimalPlaces(2),
      totalPendente: totalPendente.toDecimalPlaces(2),
      percentualPago: Math.round(percentualPago),
    }

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'EMPRESA_CLIENTE',
      entidadeId: empresaId,
      evento: 'ARQUIVO_SALVO',
      estadoNovo: {
        tipo: 'RELATORIO_FISCAL',
        competencia,
        totalApurado: totalApurado.toString(),
        totalPago: totalPago.toString(),
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return resultado
  }
}

function buildLinha(
  tipo: string,
  regime: string,
  dados: any,
  statusObrig: string,
  valorPago: Decimal,
  obrig: any
): LinhaRelatorio | null {
  const vencimento = obrig?.vencimento
    ? new Date(obrig.vencimento).toLocaleDateString('pt-BR')
    : undefined

  const status: LinhaRelatorio['status'] =
    statusObrig === 'PAGA' ? 'PAGO' : statusObrig === 'TRANSMITIDA' ? 'TRANSMITIDO' : 'PENDENTE'

  switch (tipo) {
    case 'PGDAS':
      return {
        tributo: 'DAS (Simples Nacional)',
        regime,
        baseCalculo: new Decimal(dados.receitaBruta ?? dados.receitaTotal ?? '0'),
        aliquota: new Decimal(dados.aliquotaEfetiva ?? '0'),
        valorApurado: new Decimal(dados.totalDAS ?? dados.valorDAS ?? '0'),
        valorPago,
        status,
        ...(vencimento ? { vencimento } : {}),
      }
    case 'IRPJ_LP':
      return {
        tributo: 'IRPJ (Lucro Presumido)',
        regime,
        baseCalculo: new Decimal(dados.baseIRPJ ?? '0'),
        aliquota: new Decimal('0.15'),
        valorApurado: new Decimal(dados.irpjTotal ?? dados.irpj ?? '0'),
        valorPago,
        status,
        ...(vencimento ? { vencimento } : {}),
      }
    case 'IRPJ_LR':
      return {
        tributo: 'IRPJ/LALUR (Lucro Real)',
        regime,
        baseCalculo: new Decimal(dados.lucroReal ?? dados.baseIRPJ ?? '0'),
        aliquota: new Decimal('0.15'),
        valorApurado: new Decimal(dados.irpjTotal ?? dados.irpj ?? '0'),
        valorPago,
        status,
        ...(vencimento ? { vencimento } : {}),
      }
    case 'CSLL_LP':
    case 'CSLL_LR':
      return {
        tributo: 'CSLL',
        regime,
        baseCalculo: new Decimal(dados.baseCSLL ?? '0'),
        aliquota: new Decimal('0.09'),
        valorApurado: new Decimal(dados.csllTotal ?? dados.csll ?? '0'),
        valorPago,
        status,
        ...(vencimento ? { vencimento } : {}),
      }
    case 'PIS':
      return {
        tributo: 'PIS',
        regime,
        baseCalculo: new Decimal(dados.baseCalculo ?? dados.receitaBruta ?? '0'),
        aliquota: new Decimal(dados.aliquota ?? (regime === 'LUCRO_REAL' ? '0.0165' : '0.0065')),
        valorApurado: new Decimal(dados.pis ?? dados.totalPIS ?? '0'),
        valorPago,
        status,
        ...(vencimento ? { vencimento } : {}),
      }
    case 'COFINS':
      return {
        tributo: 'COFINS',
        regime,
        baseCalculo: new Decimal(dados.baseCalculo ?? dados.receitaBruta ?? '0'),
        aliquota: new Decimal(dados.aliquota ?? (regime === 'LUCRO_REAL' ? '0.076' : '0.03')),
        valorApurado: new Decimal(dados.cofins ?? dados.totalCOFINS ?? '0'),
        valorPago,
        status,
        ...(vencimento ? { vencimento } : {}),
      }
    case 'DIFAL':
      return {
        tributo: 'DIFAL',
        regime,
        baseCalculo: new Decimal(dados.baseCalculo ?? '0'),
        aliquota: new Decimal('0'),
        valorApurado: new Decimal(dados.totalDIFAL ?? dados.valorDifal ?? '0'),
        valorPago,
        status,
        ...(vencimento ? { vencimento } : {}),
      }
    case 'GNRE':
      return {
        tributo: 'GNRE',
        regime,
        baseCalculo: new Decimal('0'),
        aliquota: new Decimal('0'),
        valorApurado: new Decimal(dados.totalGNRE ?? dados.valorTotal ?? '0'),
        valorPago,
        status,
        ...(vencimento ? { vencimento } : {}),
      }
    case 'ISS':
    case 'DMS':
      return {
        tributo: 'ISS/DMS',
        regime,
        baseCalculo: new Decimal(dados.receitaServicos ?? '0'),
        aliquota: new Decimal(dados.aliquotaISS ?? '0'),
        valorApurado: new Decimal(dados.totalISS ?? dados.totalDMS ?? '0'),
        valorPago,
        status,
        ...(vencimento ? { vencimento } : {}),
      }
    default:
      return null
  }
}

function getTiposEsperados(regime: string): string[] {
  if (regime === 'SIMPLES_NACIONAL') return ['PGDAS']
  if (regime === 'LUCRO_PRESUMIDO') return ['IRPJ_LP', 'PIS', 'COFINS']
  if (regime === 'LUCRO_REAL') return ['IRPJ_LR', 'PIS', 'COFINS']
  return []
}

function getTributoLabel(tipo: string): string {
  const labels: Record<string, string> = {
    PGDAS: 'DAS (Simples Nacional)',
    IRPJ_LP: 'IRPJ (Lucro Presumido)',
    IRPJ_LR: 'IRPJ (Lucro Real)',
    PIS: 'PIS',
    COFINS: 'COFINS',
    CSLL_LP: 'CSLL (Lucro Presumido)',
    CSLL_LR: 'CSLL (Lucro Real)',
  }
  return labels[tipo] ?? tipo
}
