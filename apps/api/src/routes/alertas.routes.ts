import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getPrismaClient } from '@saas-contabil/database'

export async function alertasRoutes(app: FastifyInstance) {
  const db = getPrismaClient()

  // GET /alertas — lista alertas do tenant com filtros opcionais
  app.get('/', async (request) => {
    const { tenantId } = request.user as any
    const { lido, tipo, empresaId, limite } = request.query as {
      lido?: string
      tipo?: string
      empresaId?: string
      limite?: string
    }

    const where: any = { tenantId }
    if (lido === 'true') where.lido = true
    else if (lido === 'false') where.lido = false
    else if (lido !== 'todos') where.lido = false
    if (tipo) where.tipo = tipo
    if (empresaId) where.empresaId = empresaId

    return db.alerta.findMany({
      where,
      include: { empresa: { select: { cnpj: true, razaoSocial: true } } },
      orderBy: { criadoEm: 'desc' },
      take: limite ? Math.min(Number(limite), 200) : 100,
    })
  })

  // POST /alertas — cria alerta manualmente (uso interno/admin)
  app.post('/', async (request, reply) => {
    const { tenantId } = request.user as any
    const body = z
      .object({
        empresaId: z.string().uuid(),
        tipo: z.enum([
          'CREDENCIAL_VENCENDO',
          'CREDENCIAL_VENCIDA',
          'SUBLIMITE_ESTADUAL',
          'RISCO_EXCLUSAO_SN',
          'VENCIMENTO_OBRIGACAO',
          'DIVERGENCIA_CONCILIACAO',
          'DISTRIBUICAO_LUCROS',
          'FATOR_R_MUDOU',
          'PGDAS_PENDENTE',
          'CERTIFICADO_VENCENDO',
          'CONFIGURACAO_ISS',
        ]),
        mensagem: z.string().min(1),
        dados: z.record(z.unknown()).optional(),
      })
      .parse(request.body)

    const alerta = await db.alerta.create({
      data: { tenantId, ...body } as any,
    })

    return reply.code(201).send(alerta)
  })

  // PATCH /alertas/ler-todos — marca todos como lidos (filtro opcional por tipo)
  app.patch('/ler-todos', async (request) => {
    const { tenantId } = request.user as any
    const { tipo } = request.query as { tipo?: string }

    const where: any = { tenantId, lido: false }
    if (tipo) where.tipo = tipo

    const { count } = await db.alerta.updateMany({ where, data: { lido: true } })
    return { success: true, count }
  })

  // PATCH /alertas/:id/ler — marca um alerta como lido
  app.patch('/:id/ler', async (request, reply) => {
    const { tenantId } = request.user as any
    const { id } = request.params as { id: string }

    const { count } = await db.alerta.updateMany({
      where: { id, tenantId },
      data: { lido: true },
    })

    if (count === 0) return reply.code(404).send({ error: 'Alerta não encontrado' })
    return { success: true }
  })

  // DELETE /alertas/:id — remove alerta (somente lidos)
  app.delete('/:id', async (request, reply) => {
    const { tenantId } = request.user as any
    const { id } = request.params as { id: string }

    const alerta = await db.alerta.findFirst({ where: { id, tenantId } })
    if (!alerta) return reply.code(404).send({ error: 'Alerta não encontrado' })

    await db.alerta.delete({ where: { id } })
    return { success: true }
  })

  // GET /alertas/resumo — contagens por tipo e status
  app.get('/resumo', async (request) => {
    const { tenantId } = request.user as any

    const [total, naoLidos, porTipo] = await Promise.all([
      db.alerta.count({ where: { tenantId } }),
      db.alerta.count({ where: { tenantId, lido: false } }),
      db.alerta.groupBy({
        by: ['tipo'],
        where: { tenantId, lido: false },
        _count: true,
        orderBy: { tipo: 'asc' },
      }),
    ])

    return {
      total,
      naoLidos,
      porTipo: porTipo.map((r: any) => ({ tipo: r.tipo, count: r._count })),
    }
  })
}
