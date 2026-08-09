/**
 * Testes de integração — filas.routes.ts
 *
 * Cobre:
 *  GET  /filas                           — status de todas as filas (ADMIN)
 *  GET  /filas/:nome/falhas              — jobs com falha (ADMIN)
 *  POST /filas/:nome/falhas/:jobId/retry — retentar job falho (ADMIN)
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import jwt from '@fastify/jwt'
import { ZodError } from 'zod'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockJob = {
  id: 'job-1',
  name: 'test-job',
  data: { tenantId: 'tenant-x', empresaId: 'emp-1' },
  failedReason: 'Connection refused',
  attemptsMade: 3,
  timestamp: 1700000000000,
  processedOn: 1700000001000,
  finishedOn: 1700000002000,
  retry: vi.fn(),
}

const mockQueue = {
  getWaitingCount: vi.fn(),
  getActiveCount: vi.fn(),
  getCompletedCount: vi.fn(),
  getFailedCount: vi.fn(),
  getDelayedCount: vi.fn(),
  getFailed: vi.fn(),
  getJob: vi.fn(),
  close: vi.fn(),
}

vi.mock('bullmq', () => ({
  Queue: vi.fn(() => mockQueue),
}))

vi.mock('ioredis', () => ({
  Redis: vi.fn(() => ({})),
}))

import { filasRoutes } from '../routes/filas.routes.js'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-filas'
const USER_ID = 'user-filas'

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify({ logger: false })
  await app.register(jwt, { secret: 'test-secret-key-32-chars-minimum!!' })

  app.addHook('onRequest', async (request) => {
    if (request.headers['x-test-admin'] === '1') {
      ;(request as any).user = { sub: USER_ID, tenantId: TENANT_ID, perfil: 'ADMIN' }
    } else if (request.headers['x-test-skip-auth'] === '1') {
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

  await app.register(filasRoutes, { prefix: '/filas' })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  vi.clearAllMocks()
  mockQueue.getWaitingCount.mockResolvedValue(0)
  mockQueue.getActiveCount.mockResolvedValue(0)
  mockQueue.getCompletedCount.mockResolvedValue(0)
  mockQueue.getFailedCount.mockResolvedValue(0)
  mockQueue.getDelayedCount.mockResolvedValue(0)
  mockQueue.getFailed.mockResolvedValue([])
  mockQueue.getJob.mockResolvedValue(null)
  mockQueue.close.mockResolvedValue(undefined)
  mockJob.retry.mockResolvedValue(undefined)
})

function reqAdmin(method: string, url: string) {
  return app.inject({ method: method as any, url, headers: { 'x-test-admin': '1' } })
}

function reqContador(method: string, url: string) {
  return app.inject({ method: method as any, url, headers: { 'x-test-skip-auth': '1' } })
}

// ===========================================================================
// GET /filas
// ===========================================================================

describe('GET /filas', () => {
  it('ADMIN recebe resumo de todas as 7 filas → 200', async () => {
    mockQueue.getWaitingCount.mockResolvedValue(2)
    mockQueue.getActiveCount.mockResolvedValue(1)
    mockQueue.getCompletedCount.mockResolvedValue(100)
    mockQueue.getFailedCount.mockResolvedValue(3)
    mockQueue.getDelayedCount.mockResolvedValue(0)

    const res = await reqAdmin('GET', '/filas')

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveLength(7)
    expect(body[0]).toHaveProperty('nome')
    expect(body[0]).toHaveProperty('waiting')
    expect(body[0]).toHaveProperty('active')
    expect(body[0]).toHaveProperty('completed')
    expect(body[0]).toHaveProperty('failed')
    expect(body[0]).toHaveProperty('delayed')
  })

  it('retorna as 7 filas esperadas', async () => {
    const res = await reqAdmin('GET', '/filas')

    const body = res.json()
    const nomes = body.map((f: { nome: string }) => f.nome)
    expect(nomes).toContain('fechamento')
    expect(nomes).toContain('scraper')
    expect(nomes).toContain('fiscal')
    expect(nomes).toContain('portal')
    expect(nomes).toContain('monitoramento')
    expect(nomes).toContain('relatorio')
    expect(nomes).toContain('bancario')
  })

  it('métricas corretas são refletidas na resposta', async () => {
    mockQueue.getWaitingCount.mockResolvedValue(5)
    mockQueue.getActiveCount.mockResolvedValue(2)
    mockQueue.getFailedCount.mockResolvedValue(1)

    const res = await reqAdmin('GET', '/filas')
    const body = res.json()

    expect(body[0].waiting).toBe(5)
    expect(body[0].active).toBe(2)
    expect(body[0].failed).toBe(1)
  })

  it('CONTADOR recebe 403 (acesso negado)', async () => {
    const res = await reqContador('GET', '/filas')
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatch(/administrador/i)
  })

  it('fecha cada fila após consulta (evita vazamento de conexão)', async () => {
    await reqAdmin('GET', '/filas')
    expect(mockQueue.close).toHaveBeenCalledTimes(7)
  })
})

// ===========================================================================
// GET /filas/:nome/falhas
// ===========================================================================

describe('GET /filas/:nome/falhas', () => {
  it('retorna lista de jobs com falha para fila válida → 200', async () => {
    mockQueue.getFailed.mockResolvedValueOnce([mockJob])

    const res = await reqAdmin('GET', '/filas/scraper/falhas')

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveLength(1)
    expect(body[0].id).toBe('job-1')
    expect(body[0].failedReason).toBe('Connection refused')
    expect(body[0].attemptsMade).toBe(3)
  })

  it('expõe campos esperados nos jobs', async () => {
    mockQueue.getFailed.mockResolvedValueOnce([mockJob])

    const res = await reqAdmin('GET', '/filas/fechamento/falhas')
    const job = res.json()[0]

    expect(job).toHaveProperty('id')
    expect(job).toHaveProperty('name')
    expect(job).toHaveProperty('data')
    expect(job).toHaveProperty('failedReason')
    expect(job).toHaveProperty('attemptsMade')
    expect(job).toHaveProperty('timestamp')
    expect(job).toHaveProperty('processedOn')
    expect(job).toHaveProperty('finishedOn')
  })

  it('lista vazia quando não há falhas → 200 []', async () => {
    mockQueue.getFailed.mockResolvedValueOnce([])

    const res = await reqAdmin('GET', '/filas/fiscal/falhas')

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('fila inválida → 404', async () => {
    const res = await reqAdmin('GET', '/filas/inexistente/falhas')
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toMatch(/fila não encontrada/i)
  })

  it('CONTADOR recebe 403', async () => {
    const res = await reqContador('GET', '/filas/scraper/falhas')
    expect(res.statusCode).toBe(403)
  })

  it('consulta os últimos 20 jobs (range 0–19)', async () => {
    mockQueue.getFailed.mockResolvedValueOnce([])

    await reqAdmin('GET', '/filas/portal/falhas')

    expect(mockQueue.getFailed).toHaveBeenCalledWith(0, 19)
  })

  it('fecha a fila após consulta', async () => {
    mockQueue.getFailed.mockResolvedValueOnce([])

    await reqAdmin('GET', '/filas/bancario/falhas')

    expect(mockQueue.close).toHaveBeenCalledTimes(1)
  })
})

// ===========================================================================
// POST /filas/:nome/falhas/:jobId/retry
// ===========================================================================

describe('POST /filas/:nome/falhas/:jobId/retry', () => {
  it('retenta job existente → 200 { success: true, jobId }', async () => {
    mockQueue.getJob.mockResolvedValueOnce(mockJob)

    const res = await reqAdmin('POST', '/filas/scraper/falhas/job-1/retry')

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.jobId).toBe('job-1')
  })

  it('chama job.retry() para executar a reexecução', async () => {
    mockQueue.getJob.mockResolvedValueOnce(mockJob)

    await reqAdmin('POST', '/filas/scraper/falhas/job-1/retry')

    expect(mockJob.retry).toHaveBeenCalledTimes(1)
  })

  it('fila inválida → 404', async () => {
    const res = await reqAdmin('POST', '/filas/naoexiste/falhas/job-1/retry')
    expect(res.statusCode).toBe(404)
    expect(mockJob.retry).not.toHaveBeenCalled()
  })

  it('job não encontrado → 404', async () => {
    mockQueue.getJob.mockResolvedValueOnce(null)

    const res = await reqAdmin('POST', '/filas/fiscal/falhas/job-naoexiste/retry')

    expect(res.statusCode).toBe(404)
    expect(mockJob.retry).not.toHaveBeenCalled()
  })

  it('fecha a fila mesmo quando job não existe', async () => {
    mockQueue.getJob.mockResolvedValueOnce(null)

    await reqAdmin('POST', '/filas/fiscal/falhas/job-xyz/retry')

    expect(mockQueue.close).toHaveBeenCalledTimes(1)
  })

  it('fecha a fila após retry bem-sucedido', async () => {
    mockQueue.getJob.mockResolvedValueOnce(mockJob)

    await reqAdmin('POST', '/filas/scraper/falhas/job-1/retry')

    expect(mockQueue.close).toHaveBeenCalledTimes(1)
  })

  it('CONTADOR recebe 403', async () => {
    const res = await reqContador('POST', '/filas/scraper/falhas/job-1/retry')
    expect(res.statusCode).toBe(403)
    expect(mockJob.retry).not.toHaveBeenCalled()
  })
})
