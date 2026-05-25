import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getPrismaClient } from '@saas-contabil/database'
import {
  PGDASService,
  DifalService,
  GNREService,
  DeSTDAService,
  DCTFWebService,
  ESocialService,
  MonitoramentoSNService,
  FatorRService,
} from '@saas-contabil/fiscal'

const params = z.object({
  empresaId: z.string().uuid(),
  competencia: z.string().regex(/^\d{4}-\d{2}$/),
})

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

  app.get('/apuracoes', async (request) => {
    const { tenantId } = request.user as any
    const { competencia, tipo } = request.query as { competencia?: string; tipo?: string }

    const where: any = { tenantId }
    if (competencia) where.competencia = competencia
    if (tipo) where.tipo = tipo

    return db.apuracaoFiscal.findMany({
      where,
      include: { empresa: { select: { cnpj: true, razaoSocial: true } } },
      orderBy: { competencia: 'desc' },
    })
  })

  app.get('/apuracoes/:empresaId', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId } = request.params as { empresaId: string }
    const { competencia } = request.query as { competencia?: string }

    const where: any = { tenantId, empresaId }
    if (competencia) where.competencia = competencia

    return db.apuracaoFiscal.findMany({ where, orderBy: { competencia: 'desc' } })
  })

  app.post('/pgdas/transmitir/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    // PGDAS → transmitir SOMENTE após conciliação completa do período (CLAUDE.md regra 11)
    const { parsePeriodo: pp } = await import('@saas-contabil/shared')
    const { inicio, fim } = pp(competencia)
    const pendentes = await db.documentoFiscal.count({
      where: {
        tenantId,
        empresaId,
        dataCompetencia: { gte: inicio, lte: fim },
        status: { in: ['PENDENTE_REVISAO', 'NORMALIZADO', 'CAPTURADO', 'EM_CONCILIACAO'] },
      },
    })
    if (pendentes > 0) {
      return reply.code(422).send({
        error: `Existem ${pendentes} documentos não conciliados — conclua a conciliação antes de transmitir o PGDAS`,
      })
    }

    const apuracao = await db.apuracaoFiscal.findFirst({
      where: { tenantId, empresaId, competencia, tipo: 'PGDAS' },
    })
    if (!apuracao) return reply.code(404).send({ error: 'PGDAS não apurado para este período' })

    await db.apuracaoFiscal.update({
      where: { id: apuracao.id },
      data: { status: 'TRANSMITIDO' },
    })

    return { success: true, status: 'TRANSMITIDO' }
  })

  app.get('/obrigacoes/:empresaId', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId } = request.params as { empresaId: string }
    const { mes } = request.query as { mes?: string }

    const where: any = { tenantId, empresaId }
    if (mes) {
      const { inicio, fim } = (await import('@saas-contabil/shared')).parsePeriodo(mes)
      where.vencimento = { gte: inicio, lte: fim }
    }

    return db.obrigacao.findMany({ where, orderBy: { vencimento: 'asc' } })
  })

  app.get('/obrigacoes', async (request) => {
    const { tenantId } = request.user as any
    const { mes, competencia, status } = request.query as {
      mes?: string
      competencia?: string
      status?: string
    }

    const where: any = { tenantId }
    if (status) where.status = status
    const periodo = competencia ?? mes
    if (periodo) {
      const { inicio, fim } = (await import('@saas-contabil/shared')).parsePeriodo(periodo)
      where.vencimento = { gte: inicio, lte: fim }
    }

    return db.obrigacao.findMany({
      where,
      include: { empresa: { select: { cnpj: true, razaoSocial: true } } },
      orderBy: { vencimento: 'asc' },
    })
  })

  app.post('/obrigacoes/calendario/:empresaId/:ano', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, ano } = request.params as { empresaId: string; ano: string }

    const service = new MonitoramentoSNService()
    return service.gerarCalendarioAnual(tenantId, empresaId, Number(ano))
  })

  app.get('/fator-r/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new FatorRService()
    const resultado = await service.calcular(tenantId, empresaId, competencia)
    return {
      empresaId,
      competencia,
      fatorR: resultado.fatorR.toFixed(2),
      anexo: resultado.anexo,
    }
  })

  app.post('/esocial/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new ESocialService()
    return service.processar(tenantId, empresaId, competencia)
  })

  app.post('/dctfweb/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new DCTFWebService()
    return service.gerar(tenantId, empresaId, competencia)
  })

  app.post('/monitoramento/calendario/:empresaId', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId } = request.params as { empresaId: string }
    const { ano } = request.query as { ano?: string }

    const service = new MonitoramentoSNService()
    return service.gerarCalendarioAnual(
      tenantId,
      empresaId,
      Number(ano ?? new Date().getFullYear())
    )
  })
}
