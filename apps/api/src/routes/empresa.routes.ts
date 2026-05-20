import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getPrismaClient } from '@saas-contabil/database'

const createEmpresaSchema = z.object({
  cnpj: z.string().length(14),
  razaoSocial: z.string().min(1),
  nomeFantasia: z.string().optional(),
  regime: z.enum(['SIMPLES_NACIONAL', 'MEI', 'LUCRO_PRESUMIDO', 'LUCRO_REAL']),
  cnae: z.string(),
  uf: z.string().length(2),
  municipio: z.string(),
  ibge: z.string().length(7),
  dataAbertura: z.string(),
})

export async function empresaRoutes(app: FastifyInstance) {
  const db = getPrismaClient()

  app.get('/', async (request) => {
    const { tenantId } = request.user as any
    return db.empresaCliente.findMany({
      where: { tenantId, ativa: true },
      orderBy: { razaoSocial: 'asc' },
    })
  })

  app.get('/:id', async (request, reply) => {
    const { tenantId } = request.user as any
    const { id } = request.params as { id: string }
    const empresa = await db.empresaCliente.findFirst({ where: { id, tenantId } })
    if (!empresa) return reply.code(404).send({ error: 'Empresa não encontrada' })
    return empresa
  })

  app.post('/', async (request, reply) => {
    const { tenantId } = request.user as any
    const data = createEmpresaSchema.parse(request.body)

    const existing = await db.empresaCliente.findFirst({ where: { tenantId, cnpj: data.cnpj } })
    if (existing) return reply.code(409).send({ error: 'CNPJ já cadastrado' })

    return db.empresaCliente.create({
      data: { ...data, tenantId, dataAbertura: new Date(data.dataAbertura) },
    })
  })

  app.patch('/:id', async (request, reply) => {
    const { tenantId } = request.user as any
    const { id } = request.params as { id: string }
    const data = createEmpresaSchema.partial().parse(request.body)

    const empresa = await db.empresaCliente.findFirst({ where: { id, tenantId } })
    if (!empresa) return reply.code(404).send({ error: 'Empresa não encontrada' })

    return db.empresaCliente.update({ where: { id }, data })
  })

  app.get('/:id/alertas', async (request) => {
    const { tenantId } = request.user as any
    const { id } = request.params as { id: string }
    return db.alerta.findMany({
      where: { tenantId, empresaId: id, lido: false },
      orderBy: { criadoEm: 'desc' },
    })
  })
}
