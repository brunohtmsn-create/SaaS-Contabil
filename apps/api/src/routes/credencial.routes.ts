import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { CredentialService } from '@saas-contabil/credentials'
import { getPrismaClient } from '@saas-contabil/database'

const SAFE_SELECT = {
  id: true,
  tenantId: true,
  empresaId: true,
  cnpj: true,
  tipo: true,
  validade: true,
  status: true,
  escopos: true,
  criadoPor: true,
  ultimoUso: true,
  ultimoResultado: true,
  criadoEm: true,
  atualizadoEm: true,
  empresa: { select: { razaoSocial: true, cnpj: true } },
} as const

const storeBodySchema = z.object({
  empresaId: z.string().uuid(),
  cnpj: z.string().length(14),
  tipo: z.enum([
    'CERTIFICADO_A1',
    'CERTIFICADO_A3',
    'PROCURACAO_ECAC',
    'SENHA_PREFEITURA',
    'SENHA_SIMPLES',
  ]),
  validade: z.string().optional(),
  escopos: z.array(z.string()).default([]),
  senha: z.string().optional(),
})

export async function credencialRoutes(app: FastifyInstance) {
  const credService = new CredentialService()
  const db = getPrismaClient()

  app.get('/', async (request) => {
    const { tenantId } = request.user as any
    const { vencendo } = request.query as { vencendo?: string }
    if (vencendo === 'true') {
      const rows = await credService.checkExpiring(tenantId, 30)
      return rows.map(({ encryptedData: _e, iv: _i, authTag: _a, ...safe }) => safe)
    }
    return db.credencial.findMany({
      where: { tenantId },
      select: SAFE_SELECT,
      orderBy: { criadoEm: 'desc' },
    })
  })

  // POST /credenciais — armazenar novo certificado (.pfx via multipart) ou senha (JSON)
  app.post('/', async (request, reply) => {
    const { tenantId, sub: criadoPor } = request.user as any

    const contentType = request.headers['content-type'] ?? ''

    if (contentType.includes('multipart/form-data')) {
      const parts = request.parts()
      let fileBuffer: Buffer | null = null
      let fieldValues: Record<string, string> = {}

      for await (const part of parts) {
        if (part.type === 'file') {
          const chunks: Buffer[] = []
          for await (const chunk of part.file) chunks.push(chunk)
          fileBuffer = Buffer.concat(chunks)
        } else {
          fieldValues[part.fieldname] = part.value as string
        }
      }

      if (!fileBuffer) return reply.code(400).send({ error: 'Arquivo não enviado' })

      const parsed = storeBodySchema.safeParse(fieldValues)
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })
      const { empresaId, cnpj, tipo, validade, escopos } = parsed.data

      const cred = await credService.store({
        tenantId,
        empresaId,
        cnpj,
        tipo: tipo as any,
        rawData: fileBuffer,
        validade: validade ? new Date(validade) : undefined,
        escopos,
        criadoPor,
      })

      const { encryptedData: _e, iv: _i, authTag: _a, ...safe } = cred
      return reply.code(201).send(safe)
    }

    // JSON body — credenciais de senha (SENHA_PREFEITURA, SENHA_SIMPLES, PROCURACAO_ECAC)
    const parsed = storeBodySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })
    const { empresaId, cnpj, tipo, validade, escopos, senha } = parsed.data

    if (!senha)
      return reply.code(400).send({ error: 'Campo senha obrigatório para este tipo de credencial' })

    const cred = await credService.store({
      tenantId,
      empresaId,
      cnpj,
      tipo: tipo as any,
      rawData: Buffer.from(senha, 'utf-8'),
      validade: validade ? new Date(validade) : undefined,
      escopos,
      criadoPor,
    })

    const { encryptedData: _e, iv: _i, authTag: _a, ...safe } = cred
    return reply.code(201).send(safe)
  })

  app.get('/expirando', async (request) => {
    const { tenantId } = request.user as any
    const { dias } = request.query as { dias?: string }
    const rows = await credService.checkExpiring(tenantId, dias ? Number(dias) : 30)
    return rows.map(({ encryptedData: _e, iv: _i, authTag: _a, ...safe }) => safe)
  })

  app.get('/:empresaId/credenciais', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId } = request.params as { empresaId: string }
    const rows = await credService.findByCnpj(tenantId, empresaId)
    return rows.map(({ encryptedData: _e, iv: _i, authTag: _a, ...safe }) => safe)
  })

  app.delete('/:id', async (request) => {
    const { tenantId } = request.user as any
    const { id } = request.params as { id: string }
    await credService.revoke(id, tenantId)
    return { success: true }
  })
}
