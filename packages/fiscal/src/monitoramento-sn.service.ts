import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import {
  Decimal,
  parsePeriodo,
  competencias12Meses,
  LIMITES_SIMPLES_NACIONAL,
  addDays,
} from '@saas-contabil/shared'
import { getDay, getDaysInMonth } from 'date-fns'
import type { Obrigacao } from '@prisma/client'

// Dias de vencimento das obrigações Simples Nacional (CLAUDE.md)
const VENCIMENTOS: Record<string, number> = {
  DAS: 20,
  EFD_REINF: 15,
  DCTFWEB: 15,
  DESTDA: 28,
  DASN: 31, // tratado separadamente (anual, 31/03)
}

/**
 * Avança a data para o próximo dia útil se cair em sábado (6) ou domingo (0).
 */
function proximoDiaUtil(data: Date): Date {
  let d = new Date(data)
  const dow = getDay(d)
  if (dow === 6) d = addDays(d, 2) // sábado → segunda
  if (dow === 0) d = addDays(d, 1) // domingo → segunda
  return d
}

/**
 * Constrói a data de vencimento para um mês/ano considerando finais de semana.
 */
function montarVencimento(ano: number, mes: number, diaNominal: number): Date {
  // Garante que o dia nominal não exceda o total de dias do mês (ex: 31 em fevereiro)
  const diasNoMes = getDaysInMonth(new Date(ano, mes - 1, 1))
  const dia = Math.min(diaNominal, diasNoMes)
  const raw = new Date(ano, mes - 1, dia)
  return proximoDiaUtil(raw)
}

export class MonitoramentoSNService {
  private db = getPrismaClient()
  private audit = new AuditService()

  /**
   * Gera as obrigações mensais do mês de `competencia` (se ainda não existirem)
   * e retorna todas as obrigações do período com suas datas de vencimento reais.
   */
  async verificarVencimentos(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<Obrigacao[]> {
    const empresa = await this.db.empresaCliente.findUnique({
      where: { id: empresaId },
    })
    if (!empresa) throw new Error('Empresa não encontrada')

    const [ano, mes] = competencia.split('-').map(Number) as [number, number]

    const tiposDoMes: Array<'DAS' | 'EFD_REINF' | 'DCTFWEB' | 'DESTDA'> = [
      'DAS',
      'EFD_REINF',
      'DCTFWEB',
      'DESTDA',
    ]

    // Cria obrigações mensais que ainda não existam
    for (const tipo of tiposDoMes) {
      const existing = await this.db.obrigacao.findFirst({
        where: { tenantId, empresaId, tipo, competencia },
      })

      if (!existing) {
        const diaNominal = VENCIMENTOS[tipo] ?? 20
        const vencimento = montarVencimento(ano, mes, diaNominal)

        await this.db.obrigacao.create({
          data: {
            tenantId,
            empresaId,
            tipo,
            competencia,
            vencimento,
            status: 'PENDENTE',
          },
        })
      }
    }

    return this.db.obrigacao.findMany({
      where: { tenantId, empresaId, competencia },
      orderBy: { vencimento: 'asc' },
    })
  }

  /**
   * Calcula a RB dos últimos 12 meses e cria alerta RISCO_EXCLUSAO_SN
   * se >= R$ 4.200.000 (alertaPreventivo) ou >= R$ 4.800.000 (limiteExclusao).
   */
  async verificarRiscoExclusao(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<void> {
    const empresa = await this.db.empresaCliente.findUnique({
      where: { id: empresaId },
    })
    if (!empresa) throw new Error('Empresa não encontrada')

    const competencias = competencias12Meses(competencia)
    const primeiro = competencias[0]
    const { inicio } = parsePeriodo(primeiro ?? competencia)
    const { fim } = parsePeriodo(competencia)

    const result = await this.db.documentoFiscal.aggregate({
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

    const rb12 = new Decimal(result._sum.valorTotal?.toString() ?? '0')

    if (rb12.gte(LIMITES_SIMPLES_NACIONAL.alertaPreventivo)) {
      const tipoAlerta = rb12.gte(LIMITES_SIMPLES_NACIONAL.limiteExclusao)
        ? 'RISCO_EXCLUSAO_SN'
        : 'SUBLIMITE_ESTADUAL'

      // Evita duplicar alerta no mesmo mês
      const existente = await this.db.alerta.findFirst({
        where: {
          tenantId,
          empresaId,
          tipo: tipoAlerta,
          criadoEm: { gte: parsePeriodo(competencia).inicio, lte: parsePeriodo(competencia).fim },
        },
      })

      if (!existente) {
        await this.db.alerta.create({
          data: {
            tenantId,
            empresaId,
            tipo: tipoAlerta,
            mensagem:
              `Receita bruta 12 meses: R$ ${rb12.toFixed(2)} — ` +
              (rb12.gte(LIMITES_SIMPLES_NACIONAL.limiteExclusao)
                ? 'RISCO DE EXCLUSÃO DO SIMPLES NACIONAL'
                : 'Atenção ao sublimite estadual'),
            dados: { rb12: rb12.toFixed(2), cnpj: empresa.cnpj, competencia },
          },
        })

        await this.audit.registrar({
          tenantId,
          cnpj: empresa.cnpj,
          entidadeTipo: 'EMPRESA_CLIENTE',
          entidadeId: empresaId,
          evento: 'RISCO_EXCLUSAO_SN_DETECTADO',
          estadoNovo: { rb12: rb12.toFixed(2), competencia, tipoAlerta },
          responsavel: 'sistema',
          responsavelTipo: 'SISTEMA',
        })
      }
    }
  }

  /**
   * Gera todas as obrigações do ano para a empresa:
   * - DAS: 12 meses (vence dia 20)
   * - EFD-Reinf: 12 meses (vence dia 15)
   * - DeSTDA: 12 meses (vence dia 28)
   * - DASN anual: vence 31/03 do ano seguinte
   */
  async gerarCalendarioAnual(
    tenantId: string,
    empresaId: string,
    ano: number
  ): Promise<Obrigacao[]> {
    const empresa = await this.db.empresaCliente.findUnique({
      where: { id: empresaId },
    })
    if (!empresa) throw new Error('Empresa não encontrada')

    const criados: string[] = []

    const tiposMensais: Array<{
      tipo: 'DAS' | 'EFD_REINF' | 'DESTDA'
      diaNominal: number
    }> = [
      { tipo: 'DAS', diaNominal: 20 },
      { tipo: 'EFD_REINF', diaNominal: 15 },
      { tipo: 'DESTDA', diaNominal: 28 },
    ]

    for (let mes = 1; mes <= 12; mes++) {
      const competencia = `${ano}-${String(mes).padStart(2, '0')}`

      for (const { tipo, diaNominal } of tiposMensais) {
        const existing = await this.db.obrigacao.findFirst({
          where: { tenantId, empresaId, tipo, competencia },
        })

        if (!existing) {
          const vencimento = montarVencimento(ano, mes, diaNominal)
          const obrigacao = await this.db.obrigacao.create({
            data: {
              tenantId,
              empresaId,
              tipo,
              competencia,
              vencimento,
              status: 'PENDENTE',
            },
          })
          criados.push(obrigacao.id)
        }
      }
    }

    // DASN anual: declaração relativa ao ano, vence 31/03 do ano seguinte
    const competenciaDASN = `${ano}-12` // representa o ano-base
    const existingDASN = await this.db.obrigacao.findFirst({
      where: { tenantId, empresaId, tipo: 'DASN', competencia: competenciaDASN },
    })

    if (!existingDASN) {
      const vencimentoDASN = proximoDiaUtil(new Date(ano + 1, 2, 31)) // 31/03 do ano seguinte
      const obrigacaoDASN = await this.db.obrigacao.create({
        data: {
          tenantId,
          empresaId,
          tipo: 'DASN',
          competencia: competenciaDASN,
          vencimento: vencimentoDASN,
          status: 'PENDENTE',
        },
      })
      criados.push(obrigacaoDASN.id)
    }

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'EMPRESA_CLIENTE',
      entidadeId: empresaId,
      evento: 'CALENDARIO_ANUAL_GERADO',
      estadoNovo: { ano, totalCriadas: criados.length, ids: criados },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return this.db.obrigacao.findMany({
      where: {
        tenantId,
        empresaId,
        competencia: {
          startsWith: `${ano}-`,
        },
      },
      orderBy: { vencimento: 'asc' },
    })
  }
}
