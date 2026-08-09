import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ConciliationService } from '@saas-contabil/conciliation'
import { AuditService } from '@saas-contabil/audit'
import { getPrismaClient } from '@saas-contabil/database'
import { parsePeriodo } from '@saas-contabil/shared'

const params = z.object({
  empresaId: z.string().uuid(),
  competencia: z.string().regex(/^\d{4}-\d{2}$/),
})

export async function conciliacaoRoutes(app: FastifyInstance) {
  const db = getPrismaClient()

  app.get('/status', async (request) => {
    const { tenantId } = request.user as any
    const { competencia } = request.query as { competencia?: string }

    const empresas = await db.empresaCliente.findMany({
      where: { tenantId, ativa: true },
      select: { id: true, cnpj: true, razaoSocial: true },
    })

    const resultado = await Promise.all(
      empresas.map(async (emp) => {
        const where: any = { tenantId, empresaId: emp.id }
        if (competencia) {
          const { inicio, fim } = parsePeriodo(competencia)
          where.dataCompetencia = { gte: inicio, lte: fim }
        }
        const [total, conciliados, pendentesRevisao] = await Promise.all([
          db.documentoFiscal.count({ where }),
          db.documentoFiscal.count({ where: { ...where, status: 'CONCILIADO' } }),
          db.documentoFiscal.count({ where: { ...where, status: 'PENDENTE_REVISAO' } }),
        ])
        return {
          empresaId: emp.id,
          cnpj: emp.cnpj,
          razaoSocial: emp.razaoSocial,
          totalDocumentos: total,
          conciliados,
          pendentes: total - conciliados - pendentesRevisao,
          pendentesRevisao,
        }
      })
    )

    return resultado
  })

  app.post('/run/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)
    const service = new ConciliationService()
    await Promise.all([
      service.conciliarNFSeTomadas(tenantId, empresaId, competencia),
      service.conciliarNFSeEmitidas(tenantId, empresaId, competencia),
      service.conciliarNFCe(tenantId, empresaId, competencia),
    ])
    return { success: true }
  })

  app.post('/nfse-tomadas/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)
    const service = new ConciliationService()
    return service.conciliarNFSeTomadas(tenantId, empresaId, competencia)
  })

  app.post('/nfse-emitidas/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)
    const service = new ConciliationService()
    return service.conciliarNFSeEmitidas(tenantId, empresaId, competencia)
  })

  app.post('/nfce/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)
    const service = new ConciliationService()
    return service.conciliarNFCe(tenantId, empresaId, competencia)
  })

  app.post('/aprovar/:eventId', async (request) => {
    const { tenantId, sub: userId } = request.user as any
    const { eventId } = request.params as { eventId: string }
    const audit = new AuditService()
    await audit.aprovar(eventId, userId, tenantId)
    return { success: true }
  })
}
