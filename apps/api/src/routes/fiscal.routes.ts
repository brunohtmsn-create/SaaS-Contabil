import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getPrismaClient } from '@saas-contabil/database'
import { nowBR, parsePeriodo } from '@saas-contabil/shared'
import {
  PGDASService,
  DifalService,
  GNREService,
  DeSTDAService,
  DCTFWebService,
  ESocialService,
  MonitoramentoSNService,
  FatorRService,
  FGTSDigitalService,
  EFDReinfService,
} from '@saas-contabil/fiscal'
import { Queue } from 'bullmq'
import { Redis as IORedis } from 'ioredis'

const params = z.object({
  empresaId: z.string().uuid(),
  competencia: z.string().regex(/^\d{4}-\d{2}$/),
})

const OPERACOES_FISCAIS = [
  'PGDAS',
  'DIFAL',
  'GNRE',
  'DESTDA',
  'EFDREINF',
  'ESOCIAL',
  'DCTFWEB',
  'FGTS',
  'TODOS',
] as const

export async function fiscalRoutes(app: FastifyInstance) {
  const db = getPrismaClient()
  const redis = new IORedis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  })
  const fiscalQueue = new Queue('fiscal', { connection: redis })

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
    const { inicio, fim } = parsePeriodo(competencia)
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
      const { inicio, fim } = parsePeriodo(mes)
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
      const { inicio, fim } = parsePeriodo(periodo)
      where.vencimento = { gte: inicio, lte: fim }
    }

    return db.obrigacao.findMany({
      where,
      include: { empresa: { select: { cnpj: true, razaoSocial: true } } },
      orderBy: { vencimento: 'asc' },
    })
  })

  app.patch('/obrigacoes/:id', async (request, reply) => {
    const { tenantId } = request.user as any
    const { id } = request.params as { id: string }
    const body = z
      .object({
        status: z.enum(['TRANSMITIDA', 'PAGA', 'DISPENSADA', 'PENDENTE', 'ERRO']),
        recibo: z.string().optional(),
        cumprideEm: z.string().optional(),
        valor: z.string().optional(),
      })
      .parse(request.body)

    const obrigacao = await db.obrigacao.findFirst({ where: { id, tenantId } })
    if (!obrigacao) return reply.code(404).send({ error: 'Obrigação não encontrada' })

    const updated = await db.obrigacao.update({
      where: { id, tenantId },
      data: {
        status: body.status as any,
        ...(body.recibo !== undefined && { recibo: body.recibo }),
        ...(body.cumprideEm !== undefined && { cumprideEm: new Date(body.cumprideEm) }),
        ...(body.valor !== undefined && { valor: body.valor }),
      },
    })

    return updated
  })

  app.post('/obrigacoes/calendario/:empresaId/:ano', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, ano } = z
      .object({ empresaId: z.string().uuid(), ano: z.string().regex(/^\d{4}$/) })
      .parse(request.params)

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

  app.post('/fgts/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new FGTSDigitalService()
    return service.apurar(tenantId, empresaId, competencia)
  })

  app.post('/fgts/grrf/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new FGTSDigitalService()
    return service.gerarGRRF(tenantId, empresaId, competencia)
  })

  app.post('/efdreinf/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new EFDReinfService()
    return service.processar(tenantId, empresaId, competencia)
  })

  // Enfileira job fiscal para uma empresa específica
  app.post('/job/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)
    const { operacao } = z
      .object({ operacao: z.enum(OPERACOES_FISCAIS).default('TODOS') })
      .parse(request.body ?? {})

    const empresa = await db.empresaCliente.findFirst({ where: { id: empresaId, tenantId } })
    if (!empresa) return reply.code(404).send({ error: 'Empresa não encontrada' })

    const job = await fiscalQueue.add(
      'fiscal-operacao',
      { tenantId, empresaId, cnpj: empresa.cnpj, competencia, operacao },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } }
    )

    return { jobId: job.id, status: 'ENFILEIRADO', operacao, competencia, empresa: empresa.cnpj }
  })

  // Enfileira jobs fiscais para todas as empresas ativas do tenant
  app.post('/batch/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { competencia } = z
      .object({ competencia: z.string().regex(/^\d{4}-\d{2}$/) })
      .parse(request.params)
    const { operacao } = z
      .object({ operacao: z.enum(OPERACOES_FISCAIS).default('TODOS') })
      .parse(request.body ?? {})

    const empresas = await db.empresaCliente.findMany({
      where: { tenantId, ativa: true },
      select: { id: true, cnpj: true },
    })

    const jobs = await Promise.all(
      empresas.map((empresa, idx) =>
        fiscalQueue.add(
          'fiscal-operacao',
          { tenantId, empresaId: empresa.id, cnpj: empresa.cnpj, competencia, operacao },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            delay: idx * 300,
          }
        )
      )
    )

    return {
      total: jobs.length,
      operacao,
      competencia,
      jobIds: jobs.map((j) => j.id),
    }
  })

  app.post('/monitoramento/calendario/:empresaId', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId } = request.params as { empresaId: string }
    const { ano } = request.query as { ano?: string }

    const service = new MonitoramentoSNService()
    return service.gerarCalendarioAnual(tenantId, empresaId, Number(ano ?? nowBR().getFullYear()))
  })
}
