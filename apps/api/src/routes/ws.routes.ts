import { FastifyInstance } from 'fastify'
import { Queue, QueueEvents } from 'bullmq'
import IORedis from 'ioredis'

export async function wsRoutes(app: FastifyInstance) {
  const redis = new IORedis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  })
  const fechamentoQueue = new Queue('fechamento', { connection: redis })

  // WS: status em tempo real do job de fechamento
  // GET /ws/fechamento/:jobId
  app.get('/fechamento/:jobId', { websocket: true }, async (socket, request) => {
    const { jobId } = request.params as { jobId: string }

    const queueEvents = new QueueEvents('fechamento', {
      connection: new IORedis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
        maxRetriesPerRequest: null,
      }),
    })

    const send = (data: object) => {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify(data))
      }
    }

    const onProgress = async ({ jobId: jid, data }: { jobId: string; data: number | object }) => {
      if (jid !== jobId) return
      send({ type: 'progress', progress: data, jobId })
    }

    const onCompleted = ({ jobId: jid }: { jobId: string }) => {
      if (jid !== jobId) return
      send({ type: 'completed', jobId })
      cleanup()
    }

    const onFailed = ({ jobId: jid, failedReason }: { jobId: string; failedReason: string }) => {
      if (jid !== jobId) return
      send({ type: 'failed', jobId, erro: failedReason })
      cleanup()
    }

    const onLog = ({ jobId: jid, log }: { jobId: string; log: string }) => {
      if (jid !== jobId) return
      send({ type: 'log', jobId, log })
    }

    const cleanup = () => {
      queueEvents.off('progress', onProgress)
      queueEvents.off('completed', onCompleted)
      queueEvents.off('failed', onFailed)
      queueEvents.off('added', onLog)
      queueEvents.close()
    }

    queueEvents.on('progress', onProgress)
    queueEvents.on('completed', onCompleted)
    queueEvents.on('failed', onFailed)

    socket.on('close', cleanup)
    socket.on('error', cleanup)

    // Envia estado atual do job
    try {
      const job = await fechamentoQueue.getJob(jobId)
      if (job) {
        const state = await job.getState()
        const progress = job.progress
        send({ type: 'state', state, progress, jobId })
        if (state === 'completed') {
          send({ type: 'completed', jobId })
          cleanup()
        } else if (state === 'failed') {
          send({ type: 'failed', jobId, erro: job.failedReason })
          cleanup()
        }
      } else {
        send({ type: 'error', message: 'Job não encontrado' })
        cleanup()
      }
    } catch (err) {
      send({ type: 'error', message: String(err) })
      cleanup()
    }
  })
}
