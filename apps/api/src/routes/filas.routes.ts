import { FastifyInstance } from 'fastify'
import { Queue } from 'bullmq'
import { Redis as IORedis } from 'ioredis'

const NOMES_FILAS = [
  'fechamento',
  'scraper',
  'fiscal',
  'portal',
  'monitoramento',
  'relatorio',
  'bancario',
] as const

export async function filasRoutes(app: FastifyInstance) {
  const redis = new IORedis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  })

  // GET /filas — resumo de todas as filas (só ADMIN)
  app.get('/', async (request, reply) => {
    const { perfil } = request.user as any
    if (perfil !== 'ADMIN') return reply.code(403).send({ error: 'Apenas administradores' })

    const resultados = await Promise.all(
      NOMES_FILAS.map(async (nome) => {
        const q = new Queue(nome, { connection: redis })
        const [waiting, active, completed, failed, delayed] = await Promise.all([
          q.getWaitingCount(),
          q.getActiveCount(),
          q.getCompletedCount(),
          q.getFailedCount(),
          q.getDelayedCount(),
        ])
        await q.close()
        return { nome, waiting, active, completed, failed, delayed }
      })
    )

    return resultados
  })

  // GET /filas/:nome/falhas — jobs com falha (só ADMIN)
  app.get('/:nome/falhas', async (request, reply) => {
    const { perfil } = request.user as any
    if (perfil !== 'ADMIN') return reply.code(403).send({ error: 'Apenas administradores' })

    const { nome } = request.params as { nome: string }
    if (!NOMES_FILAS.includes(nome as (typeof NOMES_FILAS)[number])) {
      return reply.code(404).send({ error: 'Fila não encontrada' })
    }

    const q = new Queue(nome, { connection: redis })
    const jobs = await q.getFailed(0, 19)
    await q.close()

    return jobs.map((j) => ({
      id: j.id,
      name: j.name,
      data: j.data,
      failedReason: j.failedReason,
      attemptsMade: j.attemptsMade,
      timestamp: j.timestamp,
      processedOn: j.processedOn,
      finishedOn: j.finishedOn,
    }))
  })

  // POST /filas/:nome/falhas/:jobId/retry — retentar job falho (só ADMIN)
  app.post('/:nome/falhas/:jobId/retry', async (request, reply) => {
    const { perfil } = request.user as any
    if (perfil !== 'ADMIN') return reply.code(403).send({ error: 'Apenas administradores' })

    const { nome, jobId } = request.params as { nome: string; jobId: string }
    if (!NOMES_FILAS.includes(nome as (typeof NOMES_FILAS)[number])) {
      return reply.code(404).send({ error: 'Fila não encontrada' })
    }

    const q = new Queue(nome, { connection: redis })
    const job = await q.getJob(jobId)
    if (!job) {
      await q.close()
      return reply.code(404).send({ error: 'Job não encontrado' })
    }
    await job.retry()
    await q.close()

    return { success: true, jobId }
  })
}
