import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getPrismaClient } from '@saas-contabil/database'
import { Queue } from 'bullmq'
import { Redis as IORedis } from 'ioredis'

export async function fechamentoRoutes(app: FastifyInstance) {
  const db = getPrismaClient()
  const redis = new IORedis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  })
  const fechamentoQueue = new Queue('fechamento', { connection: redis })

  app.post('/run/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = z
      .object({
        empresaId: z.string().uuid(),
        competencia: z.string().regex(/^\d{4}-\d{2}$/),
      })
      .parse(request.params)

    const empresa = await db.empresaCliente.findFirst({ where: { id: empresaId, tenantId } })
    if (!empresa) return reply.code(404).send({ error: 'Empresa não encontrada' })

    // Busca credencial ativa mais recente (prefere CERTIFICADO_A1, aceita e-CAC)
    const credencial = await db.credencial.findFirst({
      where: { tenantId, empresaId, status: 'ATIVO' },
      orderBy: [{ tipo: 'asc' }, { criadoEm: 'desc' }],
      select: { id: true },
    })

    const job = await fechamentoQueue.add(
      'fechamento-completo',
      {
        tenantId,
        empresaId,
        cnpj: empresa.cnpj,
        competencia,
        ...(credencial && { credencialId: credencial.id }),
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      }
    )

    return {
      jobId: job.id,
      status: 'INICIADO',
      empresa: empresa.cnpj,
      competencia,
      comCredencial: !!credencial,
    }
  })

  app.get('/status/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = request.params as { empresaId: string; competencia: string }

    const [apuracoes, lancamentos, obrigacoes] = await Promise.all([
      db.apuracaoFiscal.findMany({ where: { tenantId, empresaId, competencia } }),
      db.lancamentoContabil.count({ where: { tenantId, empresaId, competencia } }),
      db.obrigacao.findMany({ where: { tenantId, empresaId, competencia } }),
    ])

    return { apuracoes, lancamentos, obrigacoes }
  })

  app.post('/batch/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { competencia } = request.params as { competencia: string }

    // Busca empresas ativas com sua credencial ativa mais recente em uma query só
    const empresas = await db.empresaCliente.findMany({
      where: { tenantId, ativa: true },
      select: {
        id: true,
        cnpj: true,
        credenciais: {
          where: { status: 'ATIVO' },
          orderBy: [{ tipo: 'asc' }, { criadoEm: 'desc' }],
          take: 1,
          select: { id: true },
        },
      },
    })

    const jobs = await Promise.all(
      empresas.map((empresa, idx) => {
        const credencial = empresa.credenciais[0]
        return fechamentoQueue.add(
          'fechamento-completo',
          {
            tenantId,
            empresaId: empresa.id,
            cnpj: empresa.cnpj,
            competencia,
            ...(credencial && { credencialId: credencial.id }),
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            // Escalonamento: stagger de 500ms por empresa para não sobrecarregar
            delay: idx * 500,
          }
        )
      })
    )

    const semCredencial = empresas.filter((e) => !e.credenciais[0]).length

    return {
      total: jobs.length,
      semCredencial,
      jobIds: jobs.map((j) => j.id),
      competencia,
    }
  })
}
