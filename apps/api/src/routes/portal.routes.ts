import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getPrismaClient } from '@saas-contabil/database'
import { Queue } from 'bullmq'
import IORedis from 'ioredis'

export async function portalRoutes(app: FastifyInstance) {
  const db = getPrismaClient()
  const redis = new IORedis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', { maxRetriesPerRequest: null })
  const portalQueue = new Queue('portal', { connection: redis })

  app.post('/executar', async (request) => {
    const { tenantId } = request.user as any
    const body = z.object({
      empresaId: z.string().uuid(),
      cnpj: z.string().length(14),
      portal: z.string(),
      operacao: z.string(),
      credencialId: z.string().uuid(),
      competencia: z.string().optional(),
      dados: z.record(z.unknown()).optional(),
      prioridade: z.number().int().min(1).max(3).default(2),
    }).parse(request.body)

    const job = await portalQueue.add('portal-job', { ...body, tenantId }, {
      priority: body.prioridade,
      attempts: 4,
      backoff: { type: 'exponential', delay: 1000 },
    })

    return { jobId: job.id, status: 'AGUARDANDO' }
  })

  app.get('/jobs/:empresaId', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId } = request.params as { empresaId: string }
    return db.portalJob.findMany({
      where: { tenantId, empresaId },
      orderBy: { criadoEm: 'desc' },
      take: 50,
    })
  })
}
