/**
 * Testes de integração — alertas.routes.ts
 *
 * Cobre:
 *  GET    /alertas              — lista alertas com filtros lido/tipo/empresaId/limite
 *  POST   /alertas              — cria alerta manual
 *  PATCH  /alertas/ler-todos    — marca todos como lidos
 *  PATCH  /alertas/:id/ler      — marca um alerta como lido
 *  DELETE /alertas/:id          — remove alerta
 *  GET    /alertas/resumo       — contagens por tipo
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
    alerta: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}))

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

import { alertasRoutes } from '../routes/alertas.routes.js'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-alertas'
const USER_ID = 'user-alertas'
const EMPRESA_ID = '550e8400-e29b-41d4-a716-446655440007'
const ALERTA_ID = 'alerta-uuid-001'

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify({ logger: false })
  await app.register(jwt, { secret: 'test-secret-key-32-chars-minimum!!' })

  app.addHook('onRequest', async (request) => {
    if (request.headers['x-test-skip-auth'] === '1') {
      ;(request as any).user = { sub: USER_ID, tenantId: TENANT_ID, perfil: 'CONTADOR' }
    }
  })

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'Dados inválidos', detalhes: error.errors })
    }
    const statusCode = (error as any).statusCode ?? 500
    return reply.code(statusCode).send({ error: error.message ?? 'Erro interno' })
  })

  await app.register(alertasRoutes, { prefix: '/alertas' })
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

// ===========================================================================
// GET /alertas
// ===========================================================================

describe('GET /alertas', () => {
  it('retorna lista de alertas não lidos por padrão → 200', async () => {
    const alertas = [
      { id: ALERTA_ID, tipo: 'VENCIMENTO_OBRIGACAO', mensagem: 'DAS vence em 3 dias', lido: false },
    ]
    mockDb.alerta.findMany.mockResolvedValueOnce(alertas)

    const res = await req('GET', '/alertas')

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('filtra por tenantId (isolamento)', async () => {
    mockDb.alerta.findMany.mockResolvedValueOnce([])

    await req('GET', '/alertas')

    const { where } = mockDb.alerta.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.lido).toBe(false)
  })

  it('lido=todos — não aplica filtro de lido', async () => {
    mockDb.alerta.findMany.mockResolvedValueOnce([])

    await req('GET', '/alertas?lido=todos')

    const { where } = mockDb.alerta.findMany.mock.calls[0][0]
    expect(where.lido).toBeUndefined()
  })

  it('lido=true — filtra somente lidos', async () => {
    mockDb.alerta.findMany.mockResolvedValueOnce([])

    await req('GET', '/alertas?lido=true')

    const { where } = mockDb.alerta.findMany.mock.calls[0][0]
    expect(where.lido).toBe(true)
  })

  it('?tipo= filtra por tipo de alerta', async () => {
    mockDb.alerta.findMany.mockResolvedValueOnce([])

    await req('GET', '/alertas?tipo=VENCIMENTO_OBRIGACAO&lido=todos')

    const { where } = mockDb.alerta.findMany.mock.calls[0][0]
    expect(where.tipo).toBe('VENCIMENTO_OBRIGACAO')
  })

  it('?empresaId= filtra por empresa', async () => {
    mockDb.alerta.findMany.mockResolvedValueOnce([])

    await req('GET', `/alertas?empresaId=${EMPRESA_ID}&lido=todos`)

    const { where } = mockDb.alerta.findMany.mock.calls[0][0]
    expect(where.empresaId).toBe(EMPRESA_ID)
  })

  it('?limite=5 limita o take a 5', async () => {
    mockDb.alerta.findMany.mockResolvedValueOnce([])

    await req('GET', '/alertas?limite=5&lido=todos')

    const { take } = mockDb.alerta.findMany.mock.calls[0][0]
    expect(take).toBe(5)
  })

  it('limite máximo capped em 200', async () => {
    mockDb.alerta.findMany.mockResolvedValueOnce([])

    await req('GET', '/alertas?limite=9999&lido=todos')

    const { take } = mockDb.alerta.findMany.mock.calls[0][0]
    expect(take).toBe(200)
  })
})

// ===========================================================================
// POST /alertas
// ===========================================================================

describe('POST /alertas', () => {
  it('cria alerta manual → 201', async () => {
    mockDb.alerta.create.mockResolvedValueOnce({ id: 'novo-alerta', tipo: 'VENCIMENTO_OBRIGACAO' })

    const res = await req('POST', '/alertas', {
      empresaId: EMPRESA_ID,
      tipo: 'VENCIMENTO_OBRIGACAO',
      mensagem: 'DAS vence amanhã',
    })

    expect(res.statusCode).toBe(201)
    expect(mockDb.alerta.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          tipo: 'VENCIMENTO_OBRIGACAO',
          mensagem: 'DAS vence amanhã',
        }),
      })
    )
  })

  it('empresaId não UUID → 400', async () => {
    const res = await req('POST', '/alertas', {
      empresaId: 'nao-uuid',
      tipo: 'VENCIMENTO_OBRIGACAO',
      mensagem: 'msg',
    })

    expect(res.statusCode).toBe(400)
    expect(mockDb.alerta.create).not.toHaveBeenCalled()
  })

  it('mensagem vazia → 400', async () => {
    const res = await req('POST', '/alertas', {
      empresaId: EMPRESA_ID,
      tipo: 'VENCIMENTO_OBRIGACAO',
      mensagem: '',
    })

    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// PATCH /alertas/ler-todos
// ===========================================================================

describe('PATCH /alertas/ler-todos', () => {
  it('marca todos os não lidos como lidos → { success: true, count }', async () => {
    mockDb.alerta.updateMany.mockResolvedValueOnce({ count: 5 })

    const res = await req('PATCH', '/alertas/ler-todos')

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ success: true, count: 5 })
  })

  it('filtra por tenantId (isolamento)', async () => {
    mockDb.alerta.updateMany.mockResolvedValueOnce({ count: 0 })

    await req('PATCH', '/alertas/ler-todos')

    const { where } = mockDb.alerta.updateMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.lido).toBe(false)
  })

  it('?tipo= filtra por tipo antes de marcar', async () => {
    mockDb.alerta.updateMany.mockResolvedValueOnce({ count: 2 })

    await req('PATCH', '/alertas/ler-todos?tipo=PGDAS_PENDENTE')

    const { where } = mockDb.alerta.updateMany.mock.calls[0][0]
    expect(where.tipo).toBe('PGDAS_PENDENTE')
  })
})

// ===========================================================================
// PATCH /alertas/:id/ler
// ===========================================================================

describe('PATCH /alertas/:id/ler', () => {
  it('marca alerta como lido → { success: true }', async () => {
    mockDb.alerta.updateMany.mockResolvedValueOnce({ count: 1 })

    const res = await req('PATCH', `/alertas/${ALERTA_ID}/ler`)

    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it('alerta não encontrado → 404', async () => {
    mockDb.alerta.updateMany.mockResolvedValueOnce({ count: 0 })

    const res = await req('PATCH', '/alertas/inexistente/ler')

    expect(res.statusCode).toBe(404)
  })

  it('filtra por tenantId (isolamento)', async () => {
    mockDb.alerta.updateMany.mockResolvedValueOnce({ count: 1 })

    await req('PATCH', `/alertas/${ALERTA_ID}/ler`)

    const { where } = mockDb.alerta.updateMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.id).toBe(ALERTA_ID)
  })
})

// ===========================================================================
// DELETE /alertas/:id
// ===========================================================================

describe('DELETE /alertas/:id', () => {
  it('remove alerta existente → { success: true }', async () => {
    mockDb.alerta.findFirst.mockResolvedValueOnce({ id: ALERTA_ID })
    mockDb.alerta.delete.mockResolvedValueOnce({})

    const res = await req('DELETE', `/alertas/${ALERTA_ID}`)

    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
    expect(mockDb.alerta.delete).toHaveBeenCalledWith({ where: { id: ALERTA_ID } })
  })

  it('alerta não encontrado → 404', async () => {
    mockDb.alerta.findFirst.mockResolvedValueOnce(null)

    const res = await req('DELETE', `/alertas/inexistente`)

    expect(res.statusCode).toBe(404)
    expect(mockDb.alerta.delete).not.toHaveBeenCalled()
  })

  it('busca alerta com tenantId (isolamento)', async () => {
    mockDb.alerta.findFirst.mockResolvedValueOnce(null)

    await req('DELETE', `/alertas/${ALERTA_ID}`)

    const { where } = mockDb.alerta.findFirst.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.id).toBe(ALERTA_ID)
  })
})

// ===========================================================================
// GET /alertas/resumo
// ===========================================================================

describe('GET /alertas/resumo', () => {
  it('retorna total, naoLidos e porTipo → 200', async () => {
    mockDb.alerta.count
      .mockResolvedValueOnce(15) // total
      .mockResolvedValueOnce(7) // naoLidos
    mockDb.alerta.groupBy.mockResolvedValueOnce([
      { tipo: 'VENCIMENTO_OBRIGACAO', _count: 4 },
      { tipo: 'PGDAS_PENDENTE', _count: 3 },
    ])

    const res = await req('GET', '/alertas/resumo')

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(15)
    expect(body.naoLidos).toBe(7)
    expect(body.porTipo).toHaveLength(2)
    expect(body.porTipo[0]).toMatchObject({ tipo: 'VENCIMENTO_OBRIGACAO', count: 4 })
  })

  it('filtra contagens por tenantId (isolamento)', async () => {
    mockDb.alerta.count.mockResolvedValue(0)
    mockDb.alerta.groupBy.mockResolvedValueOnce([])

    await req('GET', '/alertas/resumo')

    expect(mockDb.alerta.count.mock.calls[0][0].where.tenantId).toBe(TENANT_ID)
  })
})
