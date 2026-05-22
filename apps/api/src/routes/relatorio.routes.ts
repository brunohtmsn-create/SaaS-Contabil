import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Queue } from 'bullmq'
import IORedis from 'ioredis'

export async function relatorioRoutes(app: FastifyInstance) {
  const redis = new IORedis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', { maxRetriesPerRequest: null })
  const relatorioQueue = new Queue('relatorio', { connection: redis })

  app.post('/consolidado/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { competencia } = z.object({
      competencia: z.string().regex(/^\d{4}-\d{2}$/),
    }).parse(request.params)

    const job = await relatorioQueue.add('relatorio-mensal', { tenantId, competencia }, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
    })

    return { jobId: job.id, status: 'AGUARDANDO', competencia }
  })
}
