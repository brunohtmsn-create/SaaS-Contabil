import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getPrismaClient } from '@saas-contabil/database'
import { LancamentoService, DepreciacaoService, ECDService } from '@saas-contabil/contabil'

const params = z.object({ empresaId: z.string().uuid(), competencia: z.string().regex(/^\d{4}-\d{2}$/) })

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

  app.get('/bens/:empresaId', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId } = request.params as { empresaId: string }
    return db.bemAtivo.findMany({ where: { tenantId, empresaId }, orderBy: { dataAquisicao: 'desc' } })
  })

  app.post('/bens/:empresaId', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId } = request.params as { empresaId: string }
    const body = z.object({
      descricao: z.string(),
      dataAquisicao: z.string(),
      valorAquisicao: z.number(),
      vidaUtil: z.number().int(),
      valorResidual: z.number().default(0),
    }).parse(request.body)

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
}
