import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getPrismaClient } from '@saas-contabil/database'
import { Queue } from 'bullmq'
import { Redis as IORedis } from 'ioredis'

export async function portalRoutes(app: FastifyInstance) {
  const db = getPrismaClient()
  const redis = new IORedis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  })
  const portalQueue = new Queue('portal', { connection: redis })

  app.post('/executar', async (request) => {
    const { tenantId } = request.user as any
    const body = z
      .object({
        empresaId: z.string().uuid(),
        cnpj: z.string().length(14),
        portal: z.string(),
        operacao: z.string(),
        credencialId: z.string().uuid(),
        competencia: z.string().optional(),
        dados: z.record(z.unknown()).optional(),
        prioridade: z.number().int().min(1).max(3).default(2),
      })
      .parse(request.body)

    const job = await portalQueue.add(
      'portal-job',
      { ...body, tenantId },
      {
        priority: body.prioridade,
        attempts: 4,
        backoff: { type: 'exponential', delay: 1000 },
      }
    )

    return { jobId: job.id, status: 'AGUARDANDO' }
  })

  app.get('/jobs/:empresaId', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId } = request.params as { empresaId: string }
    return db.portalJob.findMany({
      where: { tenantId, empresaId },
      orderBy: { criadoEm: 'desc' },
      take: 50,
    })
  })

  app.get('/status/:empresaId', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId } = request.params as { empresaId: string }

    const jobs = await db.portalJob.findMany({
      where: { tenantId, empresaId },
      orderBy: { criadoEm: 'desc' },
      take: 100,
    })

    const PORTAIS = [
      { portal: 'SEFAZ_FEDERAL', label: 'SEFAZ Federal (NF-e/NFC-e)' },
      { portal: 'SIMPLES_NACIONAL', label: 'Portal Simples Nacional (PGDAS)' },
      { portal: 'ECAC', label: 'e-CAC (Receita Federal)' },
      { portal: 'DCTFWEB', label: 'DCTFWeb — SPED Receita Federal' },
      { portal: 'SEFAZ_ESTADUAL', label: 'SEFAZ Estadual (DIFAL/GNRE)' },
      { portal: 'PREFEITURA', label: 'Prefeitura (NFS-e)' },
    ]

    return PORTAIS.map(({ portal, label }) => {
      const ultimoJob = jobs.find((j: any) => j.portal === portal)
      return {
        portal,
        label,
        status: ultimoJob
          ? ultimoJob.status === 'CONCLUIDO'
            ? 'OK'
            : ultimoJob.status === 'ERRO'
              ? 'ERRO'
              : ultimoJob.status === 'EM_EXECUCAO'
                ? 'PROCESSANDO'
                : 'PENDENTE'
          : 'PENDENTE',
        ultimaVerificacao: ultimoJob?.concluidoEm ?? ultimoJob?.criadoEm ?? null,
        mensagem: ultimoJob?.erro ?? null,
      }
    })
  })

  app.post('/ecac/sincronizar/:empresaId', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId } = request.params as { empresaId: string }

    const empresa = await db.empresaCliente.findFirst({ where: { id: empresaId, tenantId } })
    if (!empresa) throw new Error('Empresa não encontrada')

    const credencial = await db.credencial.findFirst({
      where: { tenantId, empresaId, tipo: 'PROCURACAO_ECAC', status: 'ATIVO' },
    })

    const job = await portalQueue.add(
      'portal-job',
      {
        tenantId,
        empresaId,
        cnpj: empresa.cnpj,
        portal: 'ECAC',
        operacao: 'SINCRONIZAR_DEBITOS',
        credencialId: credencial?.id,
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } }
    )

    return { jobId: job.id, status: 'AGUARDANDO' }
  })

  // POST /portais/dctfweb/transmitir/:empresaId/:competencia
  app.post('/dctfweb/transmitir/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = z
      .object({
        empresaId: z.string().uuid(),
        competencia: z.string().regex(/^\d{4}-\d{2}$/),
      })
      .parse(request.params)

    const empresa = await db.empresaCliente.findFirst({ where: { id: empresaId, tenantId } })
    if (!empresa) return reply.code(404).send({ error: 'Empresa não encontrada' })

    const credencial = await db.credencial.findFirst({
      where: {
        tenantId,
        empresaId,
        tipo: { in: ['CERTIFICADO_A1_ECNPJ', 'CERTIFICADO_A1_ECPF'] },
        status: 'ATIVO',
      },
    })
    if (!credencial) return reply.code(422).send({ error: 'Certificado A1 ativo não encontrado' })

    const apuracao = await db.apuracaoFiscal.findFirst({
      where: { tenantId, empresaId, competencia, tipo: 'DCTFWEB', status: 'CALCULADO' },
    })
    if (!apuracao)
      return reply
        .code(422)
        .send({ error: 'DCTFWeb não calculada para esta competência — gere antes de transmitir' })

    const body = (request.body ?? {}) as { certSenha?: string }

    const job = await portalQueue.add(
      'portal-job',
      {
        tenantId,
        empresaId,
        cnpj: empresa.cnpj,
        portal: 'DCTFWEB',
        operacao: 'TRANSMITIR',
        credencialId: credencial.id,
        competencia,
        dados: { certSenha: body.certSenha },
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
    )

    return reply.code(202).send({ jobId: job.id, status: 'AGUARDANDO', competencia })
  })

  // GET /portais/dctfweb/consultar/:empresaId/:competencia
  app.get('/dctfweb/consultar/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = z
      .object({
        empresaId: z.string().uuid(),
        competencia: z.string().regex(/^\d{4}-\d{2}$/),
      })
      .parse(request.params)

    const empresa = await db.empresaCliente.findFirst({ where: { id: empresaId, tenantId } })
    if (!empresa) return reply.code(404).send({ error: 'Empresa não encontrada' })

    const credencial = await db.credencial.findFirst({
      where: {
        tenantId,
        empresaId,
        tipo: { in: ['CERTIFICADO_A1_ECNPJ', 'CERTIFICADO_A1_ECPF'] },
        status: 'ATIVO',
      },
    })
    if (!credencial) return reply.code(422).send({ error: 'Certificado A1 ativo não encontrado' })

    const body = (request.body ?? {}) as { certSenha?: string }

    const job = await portalQueue.add(
      'portal-job',
      {
        tenantId,
        empresaId,
        cnpj: empresa.cnpj,
        portal: 'DCTFWEB',
        operacao: 'CONSULTAR',
        credencialId: credencial.id,
        competencia,
        dados: { certSenha: body.certSenha },
      },
      { attempts: 2, backoff: { type: 'exponential', delay: 3000 } }
    )

    return reply.code(202).send({ jobId: job.id, status: 'AGUARDANDO', competencia })
  })
}
