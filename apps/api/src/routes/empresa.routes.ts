import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getPrismaClient } from '@saas-contabil/database'
import { validarCNPJ } from '@saas-contabil/shared'

const createEmpresaSchema = z.object({
  cnpj: z.string().length(14).refine(validarCNPJ, { message: 'CNPJ inválido' }),
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
    const { incluiInativas } = request.query as { incluiInativas?: string }
    const where: any = { tenantId }
    if (incluiInativas !== 'true') where.ativa = true
    return db.empresaCliente.findMany({ where, orderBy: { razaoSocial: 'asc' } })
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

    const { nomeFantasia, ...requiredFields } = data
    return db.empresaCliente.create({
      data: {
        ...requiredFields,
        tenantId,
        dataAbertura: new Date(data.dataAbertura),
        ...(nomeFantasia !== undefined && { nomeFantasia }),
      },
    })
  })

  app.patch('/:id', async (request, reply) => {
    const { tenantId } = request.user as any
    const { id } = request.params as { id: string }
    const data = createEmpresaSchema.partial().parse(request.body)

    const empresa = await db.empresaCliente.findFirst({ where: { id, tenantId } })
    if (!empresa) return reply.code(404).send({ error: 'Empresa não encontrada' })

    // tenantId no where garante isolamento multi-tenant — filtra undefined para compatibilidade exactOptionalPropertyTypes
    const updateData = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
    return db.empresaCliente.update({
      where: { id, tenantId },
      data: updateData as Parameters<typeof db.empresaCliente.update>[0]['data'],
    })
  })

  app.delete('/:id', async (request, reply) => {
    const { tenantId } = request.user as any
    const { id } = request.params as { id: string }

    const empresa = await db.empresaCliente.findFirst({ where: { id, tenantId } })
    if (!empresa) return reply.code(404).send({ error: 'Empresa não encontrada' })

    await db.empresaCliente.update({ where: { id, tenantId }, data: { ativa: false } })
    return { success: true }
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
