import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getPrismaClient } from '@saas-contabil/database'
import { parsePeriodo } from '@saas-contabil/shared'
import { Queue } from 'bullmq'
import IORedis from 'ioredis'

export async function documentoRoutes(app: FastifyInstance) {
  const db = getPrismaClient()
  const redis = new IORedis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', { maxRetriesPerRequest: null })
  const scraperQueue = new Queue('scraper', { connection: redis })

  app.post('/capturar/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = z.object({
      empresaId: z.string().uuid(),
      competencia: z.string().regex(/^\d{4}-\d{2}$/),
    }).parse(request.params)

    const empresa = await db.empresaCliente.findFirst({ where: { id: empresaId, tenantId } })
    if (!empresa) return reply.code(404).send({ error: 'Empresa não encontrada' })

    const credencial = await db.credencial.findFirst({
      where: { tenantId, empresaId, status: 'ATIVO' },
    })
    if (!credencial) return reply.code(400).send({ error: 'Nenhuma credencial ativa para esta empresa' })

    const job = await scraperQueue.add('scraper-job', {
      tenantId,
      empresaId,
      cnpj: empresa.cnpj,
      competencia,
      credencialId: credencial.id,
      tipo: 'TODOS',
    }, { attempts: 3, backoff: { type: 'exponential', delay: 3000 } })

    return { jobId: job.id, status: 'AGUARDANDO', cnpj: empresa.cnpj, competencia }
  })

  app.get('/', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia, tipo, status, page = '1', limit = '50' } = request.query as any

    const where: any = { tenantId }
    if (empresaId) where.empresaId = empresaId
    if (competencia) {
      const { inicio, fim } = parsePeriodo(competencia)
      where.dataCompetencia = { gte: inicio, lte: fim }
    }
    if (tipo) where.tipo = tipo
    if (status) where.status = status

    const [docs, total] = await Promise.all([
      db.documentoFiscal.findMany({
        where,
        orderBy: { dataEmissao: 'desc' },
        take: Number(limit),
        skip: (Number(page) - 1) * Number(limit),
      }),
      db.documentoFiscal.count({ where }),
    ])

    return { data: docs, total, page: Number(page), limit: Number(limit) }
  })

  app.get('/:id', async (request, reply) => {
    const { tenantId } = request.user as any
    const { id } = request.params as { id: string }
    const doc = await db.documentoFiscal.findFirst({ where: { id, tenantId } })
    if (!doc) return reply.code(404).send({ error: 'Documento não encontrado' })
    return doc
  })

  app.get('/stats/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = request.params as any

    const { inicio, fim } = parsePeriodo(competencia)

    const [total, porTipo, porStatus] = await Promise.all([
      db.documentoFiscal.count({ where: { tenantId, empresaId, dataCompetencia: { gte: inicio, lte: fim } } }),
      db.documentoFiscal.groupBy({
        by: ['tipo'],
        where: { tenantId, empresaId, dataCompetencia: { gte: inicio, lte: fim } },
        _count: true,
        _sum: { valorTotal: true },
      }),
      db.documentoFiscal.groupBy({
        by: ['status'],
        where: { tenantId, empresaId, dataCompetencia: { gte: inicio, lte: fim } },
        _count: true,
      }),
    ])

    return { total, porTipo, porStatus }
  })
}
