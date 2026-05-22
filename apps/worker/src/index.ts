import { Worker, Queue, QueueEvents } from 'bullmq'
import IORedis from 'ioredis'
import { fechamentoCompleto } from './jobs/fechamento.job.js'
import { scraperJob } from './jobs/scraper.job.js'
import { fiscalJob } from './jobs/fiscal.job.js'
import { portalJob } from './jobs/portal.job.js'
import { monitoramentoDiario } from './jobs/monitoramento.job.js'
import { gerarRelatorioMensal } from './jobs/relatorio.job.js'

const redis = new IORedis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
})

const QUEUE_FECHAMENTO = 'fechamento'
const QUEUE_SCRAPER = 'scraper'
const QUEUE_FISCAL = 'fiscal'
const QUEUE_PORTAL = 'portal'
const QUEUE_MONITORAMENTO = 'monitoramento'
const QUEUE_RELATORIO = 'relatorio'

export const queues = {
  fechamento: new Queue(QUEUE_FECHAMENTO, { connection: redis }),
  scraper: new Queue(QUEUE_SCRAPER, { connection: redis }),
  fiscal: new Queue(QUEUE_FISCAL, { connection: redis }),
  portal: new Queue(QUEUE_PORTAL, { connection: redis }),
  monitoramento: new Queue(QUEUE_MONITORAMENTO, { connection: redis }),
  relatorio: new Queue(QUEUE_RELATORIO, { connection: redis }),
}

// Cron: monitoramento:diario toda manhã às 7h BRT (= 10h UTC)
await queues.monitoramento.add(
  'monitoramento:diario',
  {},
  {
    repeat: { pattern: '0 10 * * *' },
    jobId: 'monitoramento:diario',
  },
)

const workers = [
  new Worker(QUEUE_FECHAMENTO, fechamentoCompleto, { connection: redis, concurrency: 3 }),
  new Worker(QUEUE_SCRAPER, scraperJob, { connection: redis, concurrency: 5 }),
  new Worker(QUEUE_FISCAL, fiscalJob, { connection: redis, concurrency: 5 }),
  new Worker(QUEUE_PORTAL, portalJob, { connection: redis, concurrency: 2 }),
  new Worker(QUEUE_MONITORAMENTO, monitoramentoDiario, { connection: redis, concurrency: 1 }),
  new Worker(QUEUE_RELATORIO, gerarRelatorioMensal, { connection: redis, concurrency: 2 }),
]

for (const worker of workers) {
  worker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.name} ${job.id} completed`)
  })

  worker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.name} ${job?.id} failed:`, err.message)
  })
}

console.log('[Worker] Started — listening to queues:', Object.keys(queues).join(', '))
console.log('[Worker] Cron job "monitoramento:diario" agendado para 10:00 UTC (07:00 BRT) diariamente')

process.on('SIGTERM', async () => {
  console.log('[Worker] SIGTERM received, shutting down...')
  await Promise.all(workers.map((w) => w.close()))
  await redis.quit()
  process.exit(0)
})
