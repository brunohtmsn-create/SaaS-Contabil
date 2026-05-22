import { FastifyInstance } from 'fastify'
import { getPrismaClient } from '@saas-contabil/database'
import { nowBR, formatCompetencia, subMeses, addDays, parsePeriodo } from '@saas-contabil/shared'

export async function dashboardRoutes(app: FastifyInstance) {
  const db = getPrismaClient()

  app.get('/resumo', async (request) => {
    const { tenantId } = request.user as any
    const now = nowBR()
    const competenciaAtual = formatCompetencia(now)
    const { inicio } = parsePeriodo(competenciaAtual)

    const [totalEmpresas, totalDocs, alertas, obrigacoesVencendo] = await Promise.all([
      db.empresaCliente.count({ where: { tenantId, ativa: true } }),
      db.documentoFiscal.count({ where: { tenantId, dataCompetencia: { gte: inicio } } }),
      db.alerta.count({ where: { tenantId, lido: false } }),
      db.obrigacao.count({
        where: {
          tenantId,
          status: 'PENDENTE',
          vencimento: { lte: addDays(now, 7) },
        },
      }),
    ])

    return {
      competencia: competenciaAtual,
      totalEmpresas,
      totalDocumentos: totalDocs,
      alertasNaoLidos: alertas,
      obrigacoesVencendo,
    }
  })

  app.get('/timeline/:empresaId', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId } = request.params as { empresaId: string }

    const seisMesesAtras = subMeses(nowBR(), 6)

    const docs = await db.documentoFiscal.groupBy({
      by: ['dataCompetencia', 'tipo'],
      where: { tenantId, empresaId, dataCompetencia: { gte: seisMesesAtras } },
      _count: true,
      _sum: { valorTotal: true },
    })

    return docs
  })

  app.get('/alertas', async (request) => {
    const { tenantId } = request.user as any

    return db.alerta.findMany({
      where: { tenantId, lido: false },
      include: { empresa: { select: { cnpj: true, razaoSocial: true } } },
      orderBy: { criadoEm: 'desc' },
      take: 50,
    })
  })

  app.patch('/alertas/:id/ler', async (request) => {
    const { tenantId } = request.user as any
    const { id } = request.params as { id: string }
    await db.alerta.updateMany({ where: { id, tenantId }, data: { lido: true } })
    return { success: true }
  })
}
