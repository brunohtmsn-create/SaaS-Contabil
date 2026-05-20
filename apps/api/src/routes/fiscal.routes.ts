import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getPrismaClient } from '@saas-contabil/database'
import { PGDASService, DifalService, GNREService, DeSTDAService } from '@saas-contabil/fiscal'

const params = z.object({ empresaId: z.string().uuid(), competencia: z.string().regex(/^\d{4}-\d{2}$/) })

export async function fiscalRoutes(app: FastifyInstance) {
  const db = getPrismaClient()

  app.post('/pgdas/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new PGDASService()
    const resultado = await service.apurar(tenantId, empresaId, competencia)
    return resultado
  })

  app.get('/pgdas/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const apuracao = await db.apuracaoFiscal.findFirst({
      where: { tenantId, empresaId, competencia, tipo: 'PGDAS' },
    })

    if (!apuracao) return reply.code(404).send({ error: 'PGDAS não encontrado' })
    return apuracao
  })

  app.post('/difal/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new DifalService()
    return service.calcular(tenantId, empresaId, competencia)
  })

  app.post('/gnre/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new GNREService()
    return service.gerar(tenantId, empresaId, competencia)
  })

  app.post('/destda/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new DeSTDAService()
    return service.gerar(tenantId, empresaId, competencia)
  })

  app.get('/apuracoes/:empresaId', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId } = request.params as { empresaId: string }
    const { competencia } = request.query as { competencia?: string }

    const where: any = { tenantId, empresaId }
    if (competencia) where.competencia = competencia

    return db.apuracaoFiscal.findMany({ where, orderBy: { competencia: 'desc' } })
  })

  app.get('/obrigacoes/:empresaId', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId } = request.params as { empresaId: string }

    return db.obrigacao.findMany({
      where: { tenantId, empresaId },
      orderBy: { vencimento: 'asc' },
    })
  })
}
