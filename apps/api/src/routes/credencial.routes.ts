import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { CredentialService } from '@saas-contabil/credentials'
import { getPrismaClient } from '@saas-contabil/database'

export async function credencialRoutes(app: FastifyInstance) {
  const credService = new CredentialService()
  const db = getPrismaClient()

  app.get('/', async (request) => {
    const { tenantId } = request.user as any
    const { vencendo } = request.query as { vencendo?: string }
    if (vencendo === 'true') {
      return credService.checkExpiring(tenantId, 30)
    }
    return db.credencial.findMany({
      where: { tenantId },
      include: { empresa: { select: { razaoSocial: true, cnpj: true } } },
      orderBy: { criadoEm: 'desc' },
    })
  })

  app.get('/:empresaId', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId } = request.params as { empresaId: string }
    const { cnpj } = request.query as { cnpj: string }
    return credService.findByCnpj(tenantId, cnpj)
  })

  app.get('/expirando', async (request) => {
    const { tenantId } = request.user as any
    const { dias } = request.query as { dias?: string }
    return credService.checkExpiring(tenantId, dias ? Number(dias) : 30)
  })

  app.delete('/:id', async (request) => {
    const { tenantId } = request.user as any
    const { id } = request.params as { id: string }
    await credService.revoke(id, tenantId)
    return { success: true }
  })
}
