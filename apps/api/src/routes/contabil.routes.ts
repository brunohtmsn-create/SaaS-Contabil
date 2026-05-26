import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getPrismaClient } from '@saas-contabil/database'
import {
  LancamentoService,
  DepreciacaoService,
  ECDService,
  OpenFinanceService,
  ConciliacaoBancariaService,
} from '@saas-contabil/contabil'

const params = z.object({
  empresaId: z.string().uuid(),
  competencia: z.string().regex(/^\d{4}-\d{2}$/),
})

export async function contabilRoutes(app: FastifyInstance) {
  const db = getPrismaClient()

  app.post('/lancamentos/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)
    const service = new LancamentoService()
    return service.gerarLancamentos(tenantId, empresaId, competencia)
  })

  app.get('/lancamentos/:empresaId', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId } = request.params as { empresaId: string }
    const { competencia } = request.query as { competencia?: string }

    return db.lancamentoContabil.findMany({
      where: { tenantId, empresaId, ...(competencia ? { competencia } : {}) },
      orderBy: { data: 'desc' },
    })
  })

  app.post('/depreciacao/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)
    const service = new DepreciacaoService()
    await service.calcular(tenantId, empresaId, competencia)
    return { success: true }
  })

  app.post('/ecd/:empresaId/:ano', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, ano } = request.params as { empresaId: string; ano: string }
    const service = new ECDService()
    return service.gerar(tenantId, empresaId, Number(ano))
  })

  app.post('/open-finance/sincronizar/:empresaId', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId } = request.params as { empresaId: string }
    const service = new OpenFinanceService()
    await service.sincronizarContas(tenantId, empresaId)
    return { success: true }
  })

  app.post('/bancario/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)
    const service = new ConciliacaoBancariaService()
    await service.conciliar(tenantId, empresaId, competencia)
    return { success: true }
  })

  app.get('/transacoes/status/:empresaId', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId } = request.params as { empresaId: string }
    const { competencia } = request.query as { competencia?: string }

    const where: any = { tenantId, empresaId }
    if (competencia) {
      const { inicio, fim } = (await import('@saas-contabil/shared')).parsePeriodo(competencia)
      where.data = { gte: inicio, lte: fim }
    }

    const [total, conciliadas, naoConciliadas] = await Promise.all([
      db.transacaoBancaria.count({ where }),
      db.transacaoBancaria.count({ where: { ...where, status: 'CONCILIADA' } }),
      db.transacaoBancaria.count({ where: { ...where, status: 'NAO_CONCILIADA' } }),
    ])

    return { total, conciliadas, naoConciliadas }
  })

  app.get('/transacoes/:empresaId', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId } = request.params as { empresaId: string }
    const { competencia } = request.query as { competencia?: string }

    const where: any = { tenantId, empresaId }
    if (competencia) {
      const { inicio, fim } = (await import('@saas-contabil/shared')).parsePeriodo(competencia)
      where.data = { gte: inicio, lte: fim }
    }

    return db.transacaoBancaria.findMany({ where, orderBy: { data: 'desc' }, take: 200 })
  })

  app.get('/bens/:empresaId', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId } = request.params as { empresaId: string }
    return db.bemAtivo.findMany({
      where: { tenantId, empresaId },
      orderBy: { dataAquisicao: 'desc' },
    })
  })

  app.post('/bens/:empresaId', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId } = request.params as { empresaId: string }
    const body = z
      .object({
        descricao: z.string(),
        dataAquisicao: z.string(),
        valorAquisicao: z.number(),
        vidaUtil: z.number().int(),
        valorResidual: z.number().default(0),
      })
      .parse(request.body)

    return db.bemAtivo.create({
      data: {
        tenantId,
        empresaId,
        descricao: body.descricao,
        dataAquisicao: new Date(body.dataAquisicao),
        valorAquisicao: body.valorAquisicao,
        vidaUtil: body.vidaUtil,
        valorResidual: body.valorResidual,
        status: 'ATIVO',
      },
    })
  })

  app.get('/bens/:empresaId/:bemId', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, bemId } = request.params as { empresaId: string; bemId: string }

    const bem = await db.bemAtivo.findFirst({ where: { id: bemId, tenantId, empresaId } })
    if (!bem) return reply.code(404).send({ error: 'Bem ativo não encontrado' })
    return bem
  })

  app.patch('/bens/:empresaId/:bemId', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, bemId } = request.params as { empresaId: string; bemId: string }
    const body = z
      .object({
        status: z.enum(['ATIVO', 'BAIXADO', 'CONCLUIDO']).optional(),
        descricao: z.string().optional(),
        valorResidual: z.number().optional(),
      })
      .parse(request.body)

    const bem = await db.bemAtivo.findFirst({ where: { id: bemId, tenantId, empresaId } })
    if (!bem) return reply.code(404).send({ error: 'Bem ativo não encontrado' })

    const data: Record<string, unknown> = {}
    if (body.status !== undefined) data['status'] = body.status
    if (body.descricao !== undefined) data['descricao'] = body.descricao
    if (body.valorResidual !== undefined) data['valorResidual'] = body.valorResidual

    return db.bemAtivo.update({ where: { id: bemId }, data: data as any })
  })

  // Lista lançamentos de depreciação de um bem específico
  app.get('/bens/:empresaId/:bemId/depreciacao', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, bemId } = request.params as { empresaId: string; bemId: string }

    const bem = await db.bemAtivo.findFirst({ where: { id: bemId, tenantId, empresaId } })
    if (!bem) return reply.code(404).send({ error: 'Bem ativo não encontrado' })

    const lancamentos = await db.lancamentoContabil.findMany({
      where: {
        tenantId,
        empresaId,
        historico: { contains: bem.descricao },
      },
      orderBy: { data: 'asc' },
    })

    return { bem, lancamentos, totalLancamentos: lancamentos.length }
  })

  // Resumo de depreciação por competência
  app.get('/depreciacao/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const empresa = await db.empresaCliente.findFirst({ where: { id: empresaId, tenantId } })
    if (!empresa) return reply.code(404).send({ error: 'Empresa não encontrada' })

    const lancamentos = await db.lancamentoContabil.findMany({
      where: {
        tenantId,
        empresaId,
        competencia,
        historico: { startsWith: 'Depreciação' },
      },
      orderBy: { data: 'asc' },
    })

    return {
      empresaId,
      competencia,
      totalLancamentos: lancamentos.length,
      lancamentos,
    }
  })
}
