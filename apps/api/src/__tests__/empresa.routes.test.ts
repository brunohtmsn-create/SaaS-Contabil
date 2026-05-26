/**
 * Testes de integração — empresa.routes.ts
 *
 * Cobre:
 *  GET /empresas — lista empresas ativas do tenant com filtros
 *  GET /empresas/:id — detalhe com 404 em ausência
 *  POST /empresas — cria empresa, verifica duplicata CNPJ, valida campos
 *  PATCH /empresas/:id — atualiza parcialmente, 404 em ausência
 *  DELETE /empresas/:id — soft delete (ativa: false)
 *  GET /empresas/:id/alertas — alertas não lidos da empresa
 *
 * Isolamento: PrismaClient mockado; JWT bypassed via hook de teste.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import jwt from '@fastify/jwt'
import { ZodError } from 'zod'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    empresaCliente: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    alerta: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

import { empresaRoutes } from '../routes/empresa.routes.js'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-abc'
const USER_ID = 'user-abc'

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify({ logger: false })
  await app.register(jwt, { secret: 'test-secret-key-32-chars-minimum!!' })

  app.addHook('onRequest', async (request) => {
    if (request.headers['x-test-skip-auth'] === '1') {
      ;(request as any).user = { sub: USER_ID, tenantId: TENANT_ID, perfil: 'ADMIN' }
    }
  })

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'Dados inválidos', detalhes: error.errors })
    }
    const statusCode = error.statusCode ?? 500
    return reply.code(statusCode).send({ error: error.message ?? 'Erro interno' })
  })

  await app.register(empresaRoutes, { prefix: '/empresas' })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  vi.clearAllMocks()
})

function req(method: string, url: string, payload?: unknown) {
  return app.inject({
    method: method as any,
    url,
    headers: { 'x-test-skip-auth': '1' },
    payload: payload as any,
  })
}

function empresaBase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'emp-1',
    tenantId: TENANT_ID,
    cnpj: '11222333000181',
    razaoSocial: 'Tech Ltda',
    nomeFantasia: 'Tech',
    regime: 'SIMPLES_NACIONAL',
    cnae: '6201500',
    uf: 'SP',
    municipio: 'São Paulo',
    ibge: '3550308',
    dataAbertura: new Date('2020-01-01'),
    ativa: true,
    criadoEm: new Date(),
    ...overrides,
  }
}

// ===========================================================================
// GET /empresas
// ===========================================================================

describe('GET /empresas', () => {
  it('retorna lista de empresas do tenant', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([empresaBase()])

    const res = await req('GET', '/empresas')

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
    expect(res.json()[0].cnpj).toBe('11222333000181')
  })

  it('filtra por tenantId do JWT (isolamento)', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([])

    await req('GET', '/empresas')

    const { where } = mockDb.empresaCliente.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
  })

  it('por padrão filtra ativa: true', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([])

    await req('GET', '/empresas')

    const { where } = mockDb.empresaCliente.findMany.mock.calls[0][0]
    expect(where.ativa).toBe(true)
  })

  it('com incluiInativas=true não adiciona filtro ativa', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([])

    await req('GET', '/empresas?incluiInativas=true')

    const { where } = mockDb.empresaCliente.findMany.mock.calls[0][0]
    expect(where.ativa).toBeUndefined()
  })

  it('retorna array vazio quando não há empresas', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([])

    const res = await req('GET', '/empresas')

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })
})

// ===========================================================================
// GET /empresas/:id
// ===========================================================================

describe('GET /empresas/:id', () => {
  it('empresa encontrada → 200 com dados', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(empresaBase())

    const res = await req('GET', '/empresas/emp-1')

    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe('emp-1')
  })

  it('empresa não encontrada → 404', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(null)

    const res = await req('GET', '/empresas/nao-existe')

    expect(res.statusCode).toBe(404)
    expect(res.json().error).toMatch(/não encontrada/i)
  })

  it('busca com tenantId do JWT (não qualquer tenant)', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(empresaBase())

    await req('GET', '/empresas/emp-1')

    const { where } = mockDb.empresaCliente.findFirst.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.id).toBe('emp-1')
  })
})

// ===========================================================================
// POST /empresas
// ===========================================================================

describe('POST /empresas', () => {
  const payload = {
    cnpj: '11222333000181',
    razaoSocial: 'Nova Empresa Ltda',
    regime: 'SIMPLES_NACIONAL',
    cnae: '6201500',
    uf: 'SP',
    municipio: 'São Paulo',
    ibge: '3550308',
    dataAbertura: '2022-01-01',
  }

  it('empresa criada → 200 com id', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(null)
    mockDb.empresaCliente.create.mockResolvedValueOnce({ id: 'emp-new', ...payload })

    const res = await req('POST', '/empresas', payload)

    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe('emp-new')
  })

  it('CNPJ com length errado → 400', async () => {
    const res = await req('POST', '/empresas', { ...payload, cnpj: '123456' })
    expect(res.statusCode).toBe(400)
  })

  it('CNPJ com dígitos verificadores inválidos → 400', async () => {
    // 11222333000100 tem dígitos verificadores errados (correto seria 81)
    const res = await req('POST', '/empresas', { ...payload, cnpj: '11222333000100' })
    expect(res.statusCode).toBe(400)
  })

  it('regime inválido → 400', async () => {
    const res = await req('POST', '/empresas', { ...payload, regime: 'MEI_GOLD' })
    expect(res.statusCode).toBe(400)
  })

  it('CNPJ duplicado no tenant → 409', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(empresaBase())

    const res = await req('POST', '/empresas', payload)

    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/já cadastrado/i)
  })

  it('cria empresa com tenantId do JWT', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(null)
    mockDb.empresaCliente.create.mockResolvedValueOnce({ id: 'emp-new' })

    await req('POST', '/empresas', payload)

    const { data } = mockDb.empresaCliente.create.mock.calls[0][0]
    expect(data.tenantId).toBe(TENANT_ID)
  })

  it('nomeFantasia é opcional', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(null)
    mockDb.empresaCliente.create.mockResolvedValueOnce({ id: 'emp-new' })

    const res = await req('POST', '/empresas', payload) // sem nomeFantasia

    expect(res.statusCode).toBe(200)
  })
})

// ===========================================================================
// PATCH /empresas/:id
// ===========================================================================

describe('PATCH /empresas/:id', () => {
  it('atualiza razão social → 200', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(empresaBase())
    mockDb.empresaCliente.update.mockResolvedValueOnce(empresaBase({ razaoSocial: 'Novo Nome' }))

    const res = await req('PATCH', '/empresas/emp-1', { razaoSocial: 'Novo Nome' })

    expect(res.statusCode).toBe(200)
  })

  it('empresa não encontrada → 404', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(null)

    const res = await req('PATCH', '/empresas/nao-existe', { razaoSocial: 'X' })

    expect(res.statusCode).toBe(404)
  })

  it('update usa tenantId do JWT no where', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(empresaBase())
    mockDb.empresaCliente.update.mockResolvedValueOnce(empresaBase())

    await req('PATCH', '/empresas/emp-1', { razaoSocial: 'Testando' })

    const { where } = mockDb.empresaCliente.update.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.id).toBe('emp-1')
  })
})

// ===========================================================================
// DELETE /empresas/:id
// ===========================================================================

describe('DELETE /empresas/:id', () => {
  it('desativa empresa → 200 com success: true', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(empresaBase())
    mockDb.empresaCliente.update.mockResolvedValueOnce({})

    const res = await req('DELETE', '/empresas/emp-1')

    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it('empresa não encontrada → 404', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(null)

    const res = await req('DELETE', '/empresas/nao-existe')

    expect(res.statusCode).toBe(404)
  })

  it('soft delete: seta ativa: false (não deleta fisicamente)', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(empresaBase())
    mockDb.empresaCliente.update.mockResolvedValueOnce({})

    await req('DELETE', '/empresas/emp-1')

    const { data } = mockDb.empresaCliente.update.mock.calls[0][0]
    expect(data).toEqual({ ativa: false })
  })
})

// ===========================================================================
// GET /empresas/:id/alertas
// ===========================================================================

describe('GET /empresas/:id/alertas', () => {
  it('retorna alertas não lidos da empresa', async () => {
    const alertas = [
      { id: 'al-1', tipo: 'VENCIMENTO_OBRIGACAO', mensagem: 'DAS vence hoje', lido: false },
    ]
    mockDb.alerta.findMany.mockResolvedValueOnce(alertas)

    const res = await req('GET', '/empresas/emp-1/alertas')

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('filtra por tenantId, empresaId e lido: false', async () => {
    mockDb.alerta.findMany.mockResolvedValueOnce([])

    await req('GET', '/empresas/emp-1/alertas')

    const { where } = mockDb.alerta.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.empresaId).toBe('emp-1')
    expect(where.lido).toBe(false)
  })

  it('lista vazia → array vazio', async () => {
    mockDb.alerta.findMany.mockResolvedValueOnce([])

    const res = await req('GET', '/empresas/emp-1/alertas')

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })
})
