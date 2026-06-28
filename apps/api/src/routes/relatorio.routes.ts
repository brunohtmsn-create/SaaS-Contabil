import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getPrismaClient } from '@saas-contabil/database'
import { StorageService } from '@saas-contabil/storage'
import { Queue } from 'bullmq'
import { Redis as IORedis } from 'ioredis'
import { nowBR, addDays } from '@saas-contabil/shared'

export async function relatorioRoutes(app: FastifyInstance) {
  const db = getPrismaClient()
  const storage = new StorageService()
  const redis = new IORedis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  })
  const relatorioQueue = new Queue('relatorio', { connection: redis })

  const competenciaSchema = z.object({
    competencia: z.string().regex(/^\d{4}-\d{2}$/),
  })

  const empresaCompetenciaSchema = z.object({
    empresaId: z.string().uuid(),
    competencia: z.string().regex(/^\d{4}-\d{2}$/),
  })

  // POST /relatorios/consolidado/:competencia — enfileira geração do relatório
  app.post('/consolidado/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { competencia } = competenciaSchema.parse(request.params)

    const job = await relatorioQueue.add(
      'relatorio-mensal',
      { tenantId, competencia },
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
      }
    )

    return { jobId: job.id, status: 'AGUARDANDO', competencia }
  })

  // GET /relatorios/consolidado/:competencia — URL de download do relatório gerado
  app.get('/consolidado/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { competencia } = competenciaSchema.parse(request.params)

    const s3Key = `${tenantId}/relatorios/${competencia}/consolidado.csv`
    const exists = await storage.exists(s3Key)
    if (!exists) {
      return reply.code(404).send({ error: 'Relatório não encontrado — gere-o primeiro via POST' })
    }

    const url = await storage.getSignedUrl(s3Key, 3600)
    return { competencia, url, validade: '1 hora' }
  })

  // GET /relatorios/competencias — lista competências que possuem apurações fiscais
  app.get('/competencias', async (request) => {
    const { tenantId } = request.user as any
    const { limit = '24' } = request.query as { limit?: string }
    const safeLimit = Math.min(60, Math.max(1, Number(limit) || 24))

    const raw = await db.apuracaoFiscal.groupBy({
      by: ['competencia'],
      where: { tenantId },
      orderBy: { competencia: 'desc' },
      take: safeLimit,
    })

    return raw.map((r) => r.competencia)
  })

  // POST /relatorios/empresa/:empresaId/:competencia — relatório individual de empresa
  app.post('/empresa/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = empresaCompetenciaSchema.parse(request.params)

    const empresa = await db.empresaCliente.findFirst({ where: { id: empresaId, tenantId } })
    if (!empresa) return reply.code(404).send({ error: 'Empresa não encontrada' })

    const job = await relatorioQueue.add(
      'relatorio-empresa',
      { tenantId, empresaId, competencia },
      { attempts: 2, backoff: { type: 'exponential', delay: 5000 } }
    )

    return { jobId: job.id, status: 'AGUARDANDO', empresaId, competencia }
  })

  // GET /relatorios/empresa/:empresaId/:competencia — URL do relatório individual de empresa
  app.get('/empresa/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = empresaCompetenciaSchema.parse(request.params)

    const s3Key = `${tenantId}/relatorios/${competencia}/empresa-${empresaId}.csv`
    const exists = await storage.exists(s3Key)
    if (!exists) {
      return reply.code(404).send({ error: 'Relatório não encontrado — gere-o primeiro via POST' })
    }

    const url = await storage.getSignedUrl(s3Key, 3600)
    return { empresaId, competencia, url, validade: '1 hora' }
  })

  // GET /relatorios/obrigacoes-vencendo — obrigações pendentes nos próximos N dias
  app.get('/obrigacoes-vencendo', async (request) => {
    const { tenantId } = request.user as any
    const { dias = '7' } = request.query as { dias?: string }
    const safeDias = Math.min(90, Math.max(1, Number(dias) || 7))

    const hoje = nowBR()
    const limite = addDays(hoje, safeDias)

    const obrigacoes = await db.obrigacao.findMany({
      where: {
        tenantId,
        status: 'PENDENTE',
        vencimento: { gte: hoje, lte: limite },
      },
      include: { empresa: { select: { razaoSocial: true, cnpj: true } } },
      orderBy: { vencimento: 'asc' },
    })

    return {
      periodo: { de: hoje.toISOString(), ate: limite.toISOString() },
      total: obrigacoes.length,
      obrigacoes: obrigacoes.map((o) => ({
        id: o.id,
        tipo: o.tipo,
        competencia: o.competencia,
        vencimento: o.vencimento,
        valor: o.valor,
        empresa: o.empresa,
      })),
    }
  })

  // GET /relatorios/historico — lista alertas de relatórios do tenant
  app.get('/historico', async (request) => {
    const { tenantId } = request.user as any
    const { limit = '12' } = request.query as { limit?: string }
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 12))

    const alertas = await db.alerta.findMany({
      where: {
        tenantId,
        tipo: 'PGDAS_PENDENTE',
        dados: { path: ['tipo'], equals: 'RELATORIO_CONSOLIDADO' },
      },
      orderBy: { criadoEm: 'desc' },
      take: safeLimit,
    })

    return alertas.map((a) => {
      const dados = a.dados as Record<string, unknown>
      return {
        id: a.id,
        competencia: dados['competencia'],
        empresasCount: dados['empresasCount'],
        geradoEm: dados['geradoEm'],
        lido: a.lido,
      }
    })
  })

  // PATCH /relatorios/historico/:id/lido — marca relatório como lido
  app.patch('/historico/:id/lido', async (request, reply) => {
    const { tenantId } = request.user as any
    const { id } = request.params as { id: string }

    const alerta = await db.alerta.findFirst({ where: { id, tenantId } })
    if (!alerta) return reply.code(404).send({ error: 'Registro não encontrado' })

    await db.alerta.update({ where: { id, tenantId }, data: { lido: true } })
    return { ok: true }
  })
}
