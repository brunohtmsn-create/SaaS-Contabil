import { FastifyInstance } from 'fastify'
import { AuditService } from '@saas-contabil/audit'
import { AuditChainVerifier } from '@saas-contabil/audit'

export async function auditRoutes(app: FastifyInstance) {
  app.get('/eventos', async (request) => {
    const { tenantId } = request.user as any
    const { cnpj, entidadeId, limit } = request.query as {
      cnpj?: string
      entidadeId?: string
      limit?: string
    }
    const audit = new AuditService()
    const eventos = await audit.buscarEventos(tenantId, cnpj, limit ? Number(limit) : 100)
    if (entidadeId) {
      return eventos.filter((e: any) => e.entidadeId === entidadeId)
    }
    return eventos
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
