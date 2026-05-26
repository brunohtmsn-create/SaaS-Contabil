/**
 * Testes de integração — relatorio.routes.ts
 *
 * Cobre:
 *  POST  /relatorios/consolidado/:competencia — enfileira geração do relatório
 *  GET   /relatorios/consolidado/:competencia — URL de download (404 se não gerado)
 *  GET   /relatorios/historico               — lista registros de relatórios
 *  PATCH /relatorios/historico/:id/lido      — marca relatório como lido
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import jwt from '@fastify/jwt'
import { ZodError } from 'zod'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRelQueue = { add: vi.fn() }

vi.mock('bullmq', () => ({
  Queue: vi.fn(() => mockRelQueue),
}))

vi.mock('ioredis', () => ({
  Redis: vi.fn(() => ({})),
}))

const mockStorage = {
  exists: vi.fn(),
  getSignedUrl: vi.fn(),
}

vi.mock('@saas-contabil/storage', () => ({
  StorageService: vi.fn(() => mockStorage),
}))

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    alerta: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  },
}))

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

import { relatorioRoutes } from '../routes/relatorio.routes.js'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-rel'
const USER_ID = 'user-rel'
const COMPETENCIA = '2025-05'

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
    const statusCode = error.statusCode ?? 500
    return reply.code(statusCode).send({ error: error.message ?? 'Erro interno' })
  })

  await app.register(relatorioRoutes, { prefix: '/relatorios' })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  vi.clearAllMocks()
})

function req(method: string, url: string) {
  return app.inject({
    method: method as any,
    url,
    headers: { 'x-test-skip-auth': '1' },
  })
}

// ===========================================================================
// POST /relatorios/consolidado/:competencia
// ===========================================================================

describe('POST /relatorios/consolidado/:competencia', () => {
  it('enfileira geração e retorna jobId + status AGUARDANDO → 200', async () => {
    mockRelQueue.add.mockResolvedValueOnce({ id: 'rel-job-1' })

    const res = await req('POST', `/relatorios/consolidado/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('AGUARDANDO')
    expect(body.jobId).toBe('rel-job-1')
    expect(body.competencia).toBe(COMPETENCIA)
  })

  it('competencia inválida (não YYYY-MM) → 400', async () => {
    const res = await req('POST', '/relatorios/consolidado/2025')
    expect(res.statusCode).toBe(400)
    expect(mockRelQueue.add).not.toHaveBeenCalled()
  })

  it('job carrega tenantId do JWT', async () => {
    mockRelQueue.add.mockResolvedValueOnce({ id: 'rel-job-2' })

    await req('POST', `/relatorios/consolidado/${COMPETENCIA}`)

    const jobData = mockRelQueue.add.mock.calls[0][1]
    expect(jobData.tenantId).toBe(TENANT_ID)
    expect(jobData.competencia).toBe(COMPETENCIA)
  })
})

// ===========================================================================
// GET /relatorios/consolidado/:competencia
// ===========================================================================

describe('GET /relatorios/consolidado/:competencia', () => {
  it('relatório existente no S3 → 200 com URL de download', async () => {
    mockStorage.exists.mockResolvedValueOnce(true)
    mockStorage.getSignedUrl.mockResolvedValueOnce('https://s3.example.com/relatorio.csv')

    const res = await req('GET', `/relatorios/consolidado/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.url).toContain('s3.example.com')
    expect(body.competencia).toBe(COMPETENCIA)
    expect(body.validade).toBeDefined()
  })

  it('relatório ainda não gerado → 404', async () => {
    mockStorage.exists.mockResolvedValueOnce(false)

    const res = await req('GET', `/relatorios/consolidado/${COMPETENCIA}`)

    expect(res.statusCode).toBe(404)
    expect(res.json().error).toMatch(/gere-o primeiro/i)
  })

  it('competencia inválida → 400', async () => {
    const res = await req('GET', '/relatorios/consolidado/invalido')
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// GET /relatorios/historico
// ===========================================================================

describe('GET /relatorios/historico', () => {
  it('retorna histórico de relatórios do tenant → 200', async () => {
    mockDb.alerta.findMany.mockResolvedValueOnce([
      {
        id: 'rel-hist-1',
        tipo: 'PGDAS_PENDENTE',
        lido: false,
        dados: {
          tipo: 'RELATORIO_CONSOLIDADO',
          competencia: '2025-04',
          empresasCount: 15,
          geradoEm: '2025-04-30T10:00:00Z',
        },
      },
    ])

    const res = await req('GET', '/relatorios/historico')

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveLength(1)
    expect(body[0].competencia).toBe('2025-04')
    expect(body[0].empresasCount).toBe(15)
    expect(body[0].lido).toBe(false)
  })

  it('filtra por tenantId (isolamento)', async () => {
    mockDb.alerta.findMany.mockResolvedValueOnce([])

    await req('GET', '/relatorios/historico')

    const { where } = mockDb.alerta.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
  })

  it('limita a 12 registros por padrão', async () => {
    mockDb.alerta.findMany.mockResolvedValueOnce([])

    await req('GET', '/relatorios/historico')

    const { take } = mockDb.alerta.findMany.mock.calls[0][0]
    expect(take).toBe(12)
  })

  it('com ?limit=5 usa 5', async () => {
    mockDb.alerta.findMany.mockResolvedValueOnce([])

    await req('GET', '/relatorios/historico?limit=5')

    const { take } = mockDb.alerta.findMany.mock.calls[0][0]
    expect(take).toBe(5)
  })

  it('limit é clamped em 100', async () => {
    mockDb.alerta.findMany.mockResolvedValueOnce([])

    await req('GET', '/relatorios/historico?limit=999')

    const { take } = mockDb.alerta.findMany.mock.calls[0][0]
    expect(take).toBe(100)
  })
})

// ===========================================================================
// PATCH /relatorios/historico/:id/lido
// ===========================================================================

describe('PATCH /relatorios/historico/:id/lido', () => {
  it('marca relatório como lido → 200', async () => {
    mockDb.alerta.findFirst.mockResolvedValueOnce({ id: 'rel-lido-1', tenantId: TENANT_ID })
    mockDb.alerta.update.mockResolvedValueOnce({})

    const res = await req('PATCH', '/relatorios/historico/rel-lido-1/lido')

    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })

  it('registro não encontrado → 404', async () => {
    mockDb.alerta.findFirst.mockResolvedValueOnce(null)

    const res = await req('PATCH', '/relatorios/historico/nao-existe/lido')

    expect(res.statusCode).toBe(404)
    expect(mockDb.alerta.update).not.toHaveBeenCalled()
  })

  it('findFirst inclui tenantId (isolamento)', async () => {
    mockDb.alerta.findFirst.mockResolvedValueOnce(null)

    await req('PATCH', '/relatorios/historico/some-id/lido')

    const where = mockDb.alerta.findFirst.mock.calls[0][0].where
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.id).toBe('some-id')
  })
})
