/**
 * Testes de integração — credencial.routes.ts
 *
 * Cobre:
 *  GET    /credenciais                         — lista todas / vencendo
 *  GET    /credenciais/expirando               — atalho com ?dias
 *  GET    /credenciais/:empresaId/credenciais  — por empresa
 *  POST   /credenciais (JSON)                  — credencial de senha
 *  DELETE /credenciais/:id                     — revogação
 *
 * Regra crítica: campos sensíveis (encryptedData, iv, authTag) NUNCA devem
 * aparecer na resposta — CLAUDE.md §5.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import { ZodError } from 'zod'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCredService = {
  store: vi.fn(),
  checkExpiring: vi.fn(),
  findByCnpj: vi.fn(),
  revoke: vi.fn(),
}

vi.mock('@saas-contabil/credentials', () => ({
  CredentialService: vi.fn(() => mockCredService),
}))

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    credencial: { findMany: vi.fn() },
  },
}))

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

import { credencialRoutes } from '../routes/credencial.routes.js'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-cred'
const USER_ID = 'user-cred'
const EMPRESA_ID = '550e8400-e29b-41d4-a716-446655440001'

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify({ logger: false })
  await app.register(jwt, { secret: 'test-secret-key-32-chars-minimum!!' })
  await app.register(multipart)

  app.addHook('onRequest', async (request) => {
    if (request.headers['x-test-skip-auth'] === '1') {
      ;(request as any).user = { sub: USER_ID, tenantId: TENANT_ID, perfil: 'CONTADOR' }
    }
  })

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'Dados inválidos', detalhes: error.errors })
    }
    const statusCode = error.statusCode ?? 500
    return reply.code(statusCode).send({ error: error.message ?? 'Erro interno' })
  })

  await app.register(credencialRoutes, { prefix: '/credenciais' })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  vi.clearAllMocks()
})

function req(
  method: string,
  url: string,
  payload?: unknown,
  extraHeaders?: Record<string, string>
) {
  return app.inject({
    method: method as any,
    url,
    headers: { 'x-test-skip-auth': '1', ...extraHeaders },
    payload: payload as any,
  })
}

// ===========================================================================
// GET /credenciais
// ===========================================================================

describe('GET /credenciais', () => {
  it('lista credenciais do tenant → 200', async () => {
    mockDb.credencial.findMany.mockResolvedValueOnce([
      { id: 'cred-1', tipo: 'CERTIFICADO_A1', status: 'ATIVO', tenantId: TENANT_ID },
    ])

    const res = await req('GET', '/credenciais')

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('com ?vencendo=true chama checkExpiring(tenantId, 30)', async () => {
    mockCredService.checkExpiring.mockResolvedValueOnce([
      { id: 'cred-2', tipo: 'CERTIFICADO_A1', encryptedData: 'secret', iv: 'iv1', authTag: 'tag1' },
    ])

    const res = await req('GET', '/credenciais?vencendo=true')

    expect(res.statusCode).toBe(200)
    expect(mockCredService.checkExpiring).toHaveBeenCalledWith(TENANT_ID, 30)
  })

  it('?vencendo=true nunca expõe encryptedData/iv/authTag (CLAUDE.md §5)', async () => {
    mockCredService.checkExpiring.mockResolvedValueOnce([
      { id: 'cred-3', encryptedData: 'SECRET', iv: 'IV', authTag: 'TAG', tipo: 'SENHA_SIMPLES' },
    ])

    const res = await req('GET', '/credenciais?vencendo=true')

    const cred = res.json()[0]
    expect(cred).not.toHaveProperty('encryptedData')
    expect(cred).not.toHaveProperty('iv')
    expect(cred).not.toHaveProperty('authTag')
  })
})

// ===========================================================================
// GET /credenciais/expirando
// ===========================================================================

describe('GET /credenciais/expirando', () => {
  it('sem ?dias usa 30 por padrão', async () => {
    mockCredService.checkExpiring.mockResolvedValueOnce([])

    const res = await req('GET', '/credenciais/expirando')

    expect(res.statusCode).toBe(200)
    expect(mockCredService.checkExpiring).toHaveBeenCalledWith(TENANT_ID, 30)
  })

  it('com ?dias=15 usa 15', async () => {
    mockCredService.checkExpiring.mockResolvedValueOnce([])

    await req('GET', '/credenciais/expirando?dias=15')

    expect(mockCredService.checkExpiring).toHaveBeenCalledWith(TENANT_ID, 15)
  })

  it('nunca expõe campos sensíveis', async () => {
    mockCredService.checkExpiring.mockResolvedValueOnce([
      { id: 'cred-x', encryptedData: 'E', iv: 'I', authTag: 'A' },
    ])

    const body = (await req('GET', '/credenciais/expirando')).json()
    expect(body[0]).not.toHaveProperty('encryptedData')
    expect(body[0]).not.toHaveProperty('iv')
    expect(body[0]).not.toHaveProperty('authTag')
  })
})

// ===========================================================================
// GET /credenciais/:empresaId/credenciais
// ===========================================================================

describe('GET /credenciais/:empresaId/credenciais', () => {
  it('retorna credenciais da empresa sem campos sensíveis', async () => {
    mockCredService.findByCnpj.mockResolvedValueOnce([
      {
        id: 'cred-emp-1',
        tipo: 'SENHA_SIMPLES',
        status: 'ATIVO',
        encryptedData: 'secret',
        iv: 'iv1',
        authTag: 'tag1',
      },
    ])

    const res = await req('GET', `/credenciais/${EMPRESA_ID}/credenciais`)

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body[0].tipo).toBe('SENHA_SIMPLES')
    expect(body[0]).not.toHaveProperty('encryptedData')
    expect(body[0]).not.toHaveProperty('iv')
    expect(body[0]).not.toHaveProperty('authTag')
  })

  it('passa tenantId correto para findByCnpj', async () => {
    mockCredService.findByCnpj.mockResolvedValueOnce([])

    await req('GET', `/credenciais/${EMPRESA_ID}/credenciais`)

    expect(mockCredService.findByCnpj).toHaveBeenCalledWith(TENANT_ID, EMPRESA_ID)
  })
})

// ===========================================================================
// POST /credenciais (JSON — senha)
// ===========================================================================

describe('POST /credenciais (JSON)', () => {
  it('cria credencial de senha → 201 sem campos sensíveis', async () => {
    mockCredService.store.mockResolvedValueOnce({
      id: 'cred-new',
      tipo: 'SENHA_SIMPLES',
      status: 'ATIVO',
      encryptedData: 'ENC',
      iv: 'IV',
      authTag: 'TAG',
    })

    const res = await req(
      'POST',
      '/credenciais',
      { empresaId: EMPRESA_ID, cnpj: '12345678000195', tipo: 'SENHA_SIMPLES', senha: 'abc123' },
      { 'content-type': 'application/json' }
    )

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.tipo).toBe('SENHA_SIMPLES')
    expect(body).not.toHaveProperty('encryptedData')
    expect(body).not.toHaveProperty('iv')
    expect(body).not.toHaveProperty('authTag')
    expect(mockCredService.store).toHaveBeenCalledOnce()
  })

  it('store recebe tenantId do JWT (nunca do body)', async () => {
    mockCredService.store.mockResolvedValueOnce({
      id: 'cred-t',
      encryptedData: 'x',
      iv: 'y',
      authTag: 'z',
    })

    await req(
      'POST',
      '/credenciais',
      { empresaId: EMPRESA_ID, cnpj: '12345678000195', tipo: 'SENHA_SIMPLES', senha: 'pwd' },
      { 'content-type': 'application/json' }
    )

    const storeArgs = mockCredService.store.mock.calls[0][0]
    expect(storeArgs.tenantId).toBe(TENANT_ID)
  })

  it('sem campo senha → 400', async () => {
    const res = await req(
      'POST',
      '/credenciais',
      { empresaId: EMPRESA_ID, cnpj: '12345678000195', tipo: 'SENHA_SIMPLES' },
      { 'content-type': 'application/json' }
    )

    expect(res.statusCode).toBe(400)
    expect(mockCredService.store).not.toHaveBeenCalled()
  })

  it('empresaId inválido (não UUID) → 400', async () => {
    const res = await req(
      'POST',
      '/credenciais',
      { empresaId: 'nao-uuid', cnpj: '12345678000195', tipo: 'SENHA_SIMPLES', senha: 'abc' },
      { 'content-type': 'application/json' }
    )

    expect(res.statusCode).toBe(400)
  })

  it('tipo inválido → 400', async () => {
    const res = await req(
      'POST',
      '/credenciais',
      { empresaId: EMPRESA_ID, cnpj: '12345678000195', tipo: 'TIPO_FANTASMA', senha: 'abc' },
      { 'content-type': 'application/json' }
    )

    expect(res.statusCode).toBe(400)
  })

  it('cnpj com tamanho errado → 400', async () => {
    const res = await req(
      'POST',
      '/credenciais',
      { empresaId: EMPRESA_ID, cnpj: '123', tipo: 'SENHA_SIMPLES', senha: 'abc' },
      { 'content-type': 'application/json' }
    )

    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// POST /credenciais (multipart — certificado .pfx)
// ===========================================================================

describe('POST /credenciais (multipart — certificado .pfx)', () => {
  function buildMultipart(
    boundary: string,
    fields: Record<string, string>,
    fileField?: { name: string; filename: string; data: Buffer }
  ): Buffer {
    const parts: string[] = []

    if (fileField) {
      parts.push(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"\r\n` +
          `Content-Type: application/octet-stream\r\n\r\n`
      )
    }

    const bufs: Buffer[] = []
    for (const part of parts) bufs.push(Buffer.from(part))
    if (fileField) bufs.push(fileField.data)
    bufs.push(Buffer.from('\r\n'))

    for (const [k, v] of Object.entries(fields)) {
      bufs.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`
        )
      )
    }

    bufs.push(Buffer.from(`--${boundary}--\r\n`))
    return Buffer.concat(bufs)
  }

  it('sem arquivo enviado → 400 com "Arquivo não enviado"', async () => {
    const boundary = 'TestBnd123'
    // Envia apenas campos de texto, sem file part
    const body = buildMultipart(boundary, {
      empresaId: EMPRESA_ID,
      cnpj: '12345678000195',
      tipo: 'CERTIFICADO_A1',
    })

    const res = await app.inject({
      method: 'POST',
      url: '/credenciais',
      headers: {
        'x-test-skip-auth': '1',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/Arquivo não enviado/)
    expect(mockCredService.store).not.toHaveBeenCalled()
  })

  it('com arquivo e campos válidos → 201 sem campos sensíveis', async () => {
    const boundary = 'TestBnd456'
    const pfxData = Buffer.from([0x30, 0x82, 0x00, 0x01])
    const body = buildMultipart(
      boundary,
      {
        empresaId: EMPRESA_ID,
        cnpj: '12345678000195',
        tipo: 'CERTIFICADO_A1',
      },
      { name: 'file', filename: 'cert.pfx', data: pfxData }
    )

    mockCredService.store.mockResolvedValueOnce({
      id: 'cred-pfx-1',
      tipo: 'CERTIFICADO_A1',
      status: 'ATIVO',
      encryptedData: 'ENC',
      iv: 'IV',
      authTag: 'TAG',
    })

    const res = await app.inject({
      method: 'POST',
      url: '/credenciais',
      headers: {
        'x-test-skip-auth': '1',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    })

    expect(res.statusCode).toBe(201)
    const result = res.json()
    expect(result.tipo).toBe('CERTIFICADO_A1')
    expect(result).not.toHaveProperty('encryptedData')
    expect(result).not.toHaveProperty('iv')
    expect(result).not.toHaveProperty('authTag')
    expect(mockCredService.store).toHaveBeenCalledOnce()
    // rawData deve ser o buffer do arquivo
    const storeArgs = mockCredService.store.mock.calls[0][0]
    expect(Buffer.isBuffer(storeArgs.rawData)).toBe(true)
    expect(storeArgs.tenantId).toBe(TENANT_ID)
  })

  it('com arquivo mas campos inválidos (tipo errado) → 400', async () => {
    const boundary = 'TestBnd789'
    const pfxData = Buffer.from([0x30, 0x82])
    const body = buildMultipart(
      boundary,
      {
        empresaId: EMPRESA_ID,
        cnpj: '12345678000195',
        tipo: 'TIPO_INVALIDO',
      },
      { name: 'file', filename: 'cert.pfx', data: pfxData }
    )

    const res = await app.inject({
      method: 'POST',
      url: '/credenciais',
      headers: {
        'x-test-skip-auth': '1',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    })

    expect(res.statusCode).toBe(400)
    expect(mockCredService.store).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// DELETE /credenciais/:id
// ===========================================================================

describe('DELETE /credenciais/:id', () => {
  it('revoga credencial → 200 { success: true }', async () => {
    mockCredService.revoke.mockResolvedValueOnce(undefined)

    const res = await req('DELETE', '/credenciais/cred-to-revoke')

    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it('revoke é chamado com id e tenantId corretos', async () => {
    mockCredService.revoke.mockResolvedValueOnce(undefined)

    await req('DELETE', '/credenciais/cred-abc-123')

    expect(mockCredService.revoke).toHaveBeenCalledWith('cred-abc-123', TENANT_ID)
  })
})
