import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ConciliationService } from '@saas-contabil/conciliation'
import { AuditService } from '@saas-contabil/audit'

const params = z.object({ empresaId: z.string().uuid(), competencia: z.string().regex(/^\d{4}-\d{2}$/) })

export async function conciliacaoRoutes(app: FastifyInstance) {
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
