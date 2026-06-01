import { getPrismaClient, type Obrigacao } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { addDays } from '@saas-contabil/shared'
import { getDay, getDaysInMonth } from 'date-fns'

// Vencimentos LP/LR por tipo (dia nominal)
// Referência: Calendário Receita Federal 2025
const VENCIMENTOS_LP: Record<string, number> = {
  EFD_REINF: 15,
  DCTFWEB: 15,
  DCTF: 25, // DCTF mensal — LP/LR quando não usa DCTFWeb
  PIS: 25,
  COFINS: 25,
  FGTS_DIGITAL: 20,
}

// IRPJ/CSLL LP — trimestral, último dia útil do mês seguinte ao trimestre
// T1 → 30/04, T2 → 31/07, T3 → 31/10, T4 → 31/01 ano seguinte
const TRIMESTRES_LP = [
  { mes: 4, dia: 30 }, // T1 (jan-mar) vence 30/04
  { mes: 7, dia: 31 }, // T2 (abr-jun) vence 31/07
  { mes: 10, dia: 31 }, // T3 (jul-set) vence 31/10
  { mes: 1, dia: 31, anoSeguinte: true }, // T4 (out-dez) vence 31/01 ano seguinte
]

function proximoDiaUtil(data: Date): Date {
  let d = new Date(data)
  const dow = getDay(d)
  if (dow === 6) d = addDays(d, 2)
  if (dow === 0) d = addDays(d, 1)
  return d
}

function montarVencimento(ano: number, mes: number, diaNominal: number): Date {
  const diasNoMes = getDaysInMonth(new Date(ano, mes - 1, 1))
  const dia = Math.min(diaNominal, diasNoMes)
  return proximoDiaUtil(new Date(ano, mes - 1, dia))
}

export class CalendarioLPLRService {
  private db = getPrismaClient()
  private audit = new AuditService()

  /**
   * Gera todas as obrigações anuais para empresa LP ou LR:
   * - EFD_REINF: 12 meses (dia 15)
   * - DCTFWEB: 12 meses (dia 15)
   * - DCTF: 12 meses (dia 25)
   * - PIS + COFINS: 12 meses (dia 25)
   * - FGTS_DIGITAL: 12 meses (dia 20)
   * - IRPJ + CSLL: 4 trimestres
   * - ECD: anual, 30/06 do ano seguinte
   * - ECF: anual, 31/07 do ano seguinte
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

    const regimes = ['LUCRO_PRESUMIDO', 'LUCRO_REAL']
    if (!regimes.includes(empresa.regime)) {
      throw new Error(`Regime ${empresa.regime} não é LP ou LR`)
    }

    const criados: string[] = []

    // ── Obrigações mensais ────────────────────────────────────────────────────
    const tiposMensais = Object.entries(VENCIMENTOS_LP) as Array<
      [keyof typeof VENCIMENTOS_LP, number]
    >

    for (let mes = 1; mes <= 12; mes++) {
      const competencia = `${ano}-${String(mes).padStart(2, '0')}`

      for (const [tipo, diaNominal] of tiposMensais) {
        const existing = await this.db.obrigacao.findFirst({
          where: { tenantId, empresaId, tipo: tipo as any, competencia },
        })

        if (!existing) {
          const vencimento = montarVencimento(ano, mes, diaNominal)
          const obrigacao = await this.db.obrigacao.create({
            data: {
              tenantId,
              empresaId,
              tipo: tipo as any,
              competencia,
              vencimento,
              status: 'PENDENTE',
            },
          })
          criados.push(obrigacao.id)
        }
      }
    }

    // ── IRPJ + CSLL trimestrais ───────────────────────────────────────────────
    for (const trimestre of TRIMESTRES_LP) {
      const anoVenc = trimestre.anoSeguinte ? ano + 1 : ano
      const competenciaTrimestre = `${ano}-T${TRIMESTRES_LP.indexOf(trimestre) + 1}`

      for (const tipo of ['IRPJ', 'CSLL'] as const) {
        const existing = await this.db.obrigacao.findFirst({
          where: { tenantId, empresaId, tipo, competencia: competenciaTrimestre },
        })

        if (!existing) {
          const vencimento = montarVencimento(anoVenc, trimestre.mes, trimestre.dia)
          const obrigacao = await this.db.obrigacao.create({
            data: {
              tenantId,
              empresaId,
              tipo,
              competencia: competenciaTrimestre,
              vencimento,
              status: 'PENDENTE',
            },
          })
          criados.push(obrigacao.id)
        }
      }
    }

    // ── ECD: 30/06 do ano seguinte ────────────────────────────────────────────
    const competenciaECD = `${ano}-12`
    const existingECD = await this.db.obrigacao.findFirst({
      where: { tenantId, empresaId, tipo: 'ECD', competencia: competenciaECD },
    })
    if (!existingECD) {
      const vencimentoECD = montarVencimento(ano + 1, 6, 30)
      const obrigacaoECD = await this.db.obrigacao.create({
        data: {
          tenantId,
          empresaId,
          tipo: 'ECD',
          competencia: competenciaECD,
          vencimento: vencimentoECD,
          status: 'PENDENTE',
        },
      })
      criados.push(obrigacaoECD.id)
    }

    // ── ECF: 31/07 do ano seguinte ────────────────────────────────────────────
    const competenciaECF = `${ano}-12`
    const existingECF = await this.db.obrigacao.findFirst({
      where: { tenantId, empresaId, tipo: 'ECF', competencia: competenciaECF },
    })
    if (!existingECF) {
      const vencimentoECF = montarVencimento(ano + 1, 7, 31)
      const obrigacaoECF = await this.db.obrigacao.create({
        data: {
          tenantId,
          empresaId,
          tipo: 'ECF',
          competencia: competenciaECF,
          vencimento: vencimentoECF,
          status: 'PENDENTE',
        },
      })
      criados.push(obrigacaoECF.id)
    }

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'EMPRESA_CLIENTE',
      entidadeId: empresaId,
      evento: 'CALENDARIO_ANUAL_GERADO',
      estadoNovo: { ano, regime: empresa.regime, totalCriadas: criados.length, ids: criados },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return this.db.obrigacao.findMany({
      where: {
        tenantId,
        empresaId,
        competencia: { startsWith: `${ano}-` },
      },
      orderBy: { vencimento: 'asc' },
    })
  }
}
