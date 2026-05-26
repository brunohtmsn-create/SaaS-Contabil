/**
 * Testes de integração — audit.routes.ts
 *
 * Cobre:
 *  GET  /auditoria/eventos              — busca eventos por tenant
 *  GET  /auditoria/pendentes-revisao    — lista pendentes de aprovação humana
 *  POST /auditoria/aprovar/:eventId     — aprova evento de auditoria
 *  GET  /auditoria/verificar-cadeia     — verifica integridade do chain SHA-256
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import jwt from '@fastify/jwt'
import { ZodError } from 'zod'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAudit = {
  buscarEventos: vi.fn(),
  buscarPendentesRevisao: vi.fn(),
  aprovar: vi.fn(),
}

const mockVerifier = { verificar: vi.fn() }

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn(() => mockAudit),
  AuditChainVerifier: vi.fn(() => mockVerifier),
}))

import { auditRoutes } from '../routes/audit.routes.js'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-audit'
const USER_ID = 'user-audit'

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

  await app.register(auditRoutes, { prefix: '/auditoria' })
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
// GET /auditoria/eventos
// ===========================================================================

describe('GET /auditoria/eventos', () => {
  it('retorna eventos do tenant → 200', async () => {
    const eventos = [
      { id: 'ev-1', evento: 'PGDAS_TRANSMITIDO', tenantId: TENANT_ID, criadoEm: new Date() },
    ]
    mockAudit.buscarEventos.mockResolvedValueOnce(eventos)

    const res = await req('GET', '/auditoria/eventos')

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('chama buscarEventos com tenantId do JWT', async () => {
    mockAudit.buscarEventos.mockResolvedValueOnce([])

    await req('GET', '/auditoria/eventos')

    expect(mockAudit.buscarEventos).toHaveBeenCalledWith(TENANT_ID, undefined, 100)
  })

  it('com ?limit=5 usa 5 como limite', async () => {
    mockAudit.buscarEventos.mockResolvedValueOnce([])

    await req('GET', '/auditoria/eventos?limit=5')

    expect(mockAudit.buscarEventos).toHaveBeenCalledWith(TENANT_ID, undefined, 5)
  })

  it('com ?cnpj= passa cnpj para o serviço', async () => {
    mockAudit.buscarEventos.mockResolvedValueOnce([])

    await req('GET', '/auditoria/eventos?cnpj=12345678000195')

    expect(mockAudit.buscarEventos).toHaveBeenCalledWith(TENANT_ID, '12345678000195', 100)
  })

  it('com ?entidadeId= filtra por entidade no resultado', async () => {
    mockAudit.buscarEventos.mockResolvedValueOnce([
      { id: 'ev-a', entidadeId: 'ent-1' },
      { id: 'ev-b', entidadeId: 'ent-2' },
    ])

    const res = await req('GET', '/auditoria/eventos?entidadeId=ent-1')

    const body = res.json()
    expect(body).toHaveLength(1)
    expect(body[0].id).toBe('ev-a')
  })
})

// ===========================================================================
// GET /auditoria/pendentes-revisao
// ===========================================================================

describe('GET /auditoria/pendentes-revisao', () => {
  it('retorna pendentes do tenant → 200', async () => {
    mockAudit.buscarPendentesRevisao.mockResolvedValueOnce([
      { id: 'ev-pend-1', evento: 'PENDENTE_REVISAO_HUMANA' },
    ])

    const res = await req('GET', '/auditoria/pendentes-revisao')

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('chama buscarPendentesRevisao com tenantId do JWT', async () => {
    mockAudit.buscarPendentesRevisao.mockResolvedValueOnce([])

    await req('GET', '/auditoria/pendentes-revisao')

    expect(mockAudit.buscarPendentesRevisao).toHaveBeenCalledWith(TENANT_ID)
  })
})

// ===========================================================================
// POST /auditoria/aprovar/:eventId
// ===========================================================================

describe('POST /auditoria/aprovar/:eventId', () => {
  it('aprova evento → 200 { success: true }', async () => {
    mockAudit.aprovar.mockResolvedValueOnce(undefined)

    const res = await req('POST', '/auditoria/aprovar/ev-to-approve')

    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it('chama aprovar com eventId, userId e tenantId corretos', async () => {
    mockAudit.aprovar.mockResolvedValueOnce(undefined)

    await req('POST', '/auditoria/aprovar/ev-abc-123')

    expect(mockAudit.aprovar).toHaveBeenCalledWith('ev-abc-123', USER_ID, TENANT_ID)
  })
})

// ===========================================================================
// GET /auditoria/verificar-cadeia
// ===========================================================================

describe('GET /auditoria/verificar-cadeia', () => {
  it('retorna resultado da verificação → 200', async () => {
    mockVerifier.verificar.mockResolvedValueOnce({
      valida: true,
      totalEventos: 42,
      falhas: [],
    })

    const res = await req('GET', '/auditoria/verificar-cadeia')

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.valida).toBe(true)
    expect(body.totalEventos).toBe(42)
  })

  it('chama verificar com tenantId do JWT', async () => {
    mockVerifier.verificar.mockResolvedValueOnce({ valida: true })

    await req('GET', '/auditoria/verificar-cadeia')

    expect(mockVerifier.verificar).toHaveBeenCalledWith(TENANT_ID)
  })
})
