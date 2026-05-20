import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getPrismaClient } from '@saas-contabil/database'

export async function documentoRoutes(app: FastifyInstance) {
  const db = getPrismaClient()

  app.get('/', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia, tipo, status, page = '1', limit = '50' } = request.query as any

    const where: any = { tenantId }
    if (empresaId) where.empresaId = empresaId
    if (competencia) where.dataCompetencia = {
      gte: new Date(`${competencia}-01`),
      lte: new Date(`${competencia}-31`),
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

    const inicio = new Date(`${competencia}-01`)
    const fim = new Date(`${competencia}-31`)

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
