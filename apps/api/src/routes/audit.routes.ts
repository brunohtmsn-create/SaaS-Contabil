import { FastifyInstance } from 'fastify'
import { AuditService } from '@saas-contabil/audit'
import { AuditChainVerifier } from '@saas-contabil/audit'

export async function auditRoutes(app: FastifyInstance) {
  app.get('/eventos', async (request) => {
    const { tenantId } = request.user as any
    const { cnpj, limit } = request.query as { cnpj?: string; limit?: string }
    const audit = new AuditService()
    return audit.buscarEventos(tenantId, cnpj, limit ? Number(limit) : 100)
  })

  app.get('/pendentes-revisao', async (request) => {
    const { tenantId } = request.user as any
    const audit = new AuditService()
    return audit.buscarPendentesRevisao(tenantId)
  })

  app.post('/aprovar/:eventId', async (request) => {
    const { tenantId, sub: userId } = request.user as any
    const { eventId } = request.params as { eventId: string }
    const audit = new AuditService()
    await audit.aprovar(eventId, userId, tenantId)
    return { success: true }
  })

  app.get('/verificar-cadeia', async (request) => {
    const { tenantId } = request.user as any
    const verifier = new AuditChainVerifier()
    return verifier.verificar(tenantId)
  })
}
