/**
 * Testes de integração — conciliacao.routes.ts
 *
 * Cobre:
 *  GET /conciliacao/status — retorna status por empresa com contagens corretas
 *  POST /conciliacao/run/:id/:comp — chama os 3 serviços de conciliação
 *  POST /conciliacao/nfse-tomadas/:id/:comp — chama serviço específico
 *  POST /conciliacao/nfse-emitidas/:id/:comp — chama serviço específico
 *  POST /conciliacao/nfce/:id/:comp — chama serviço específico
 *  POST /conciliacao/aprovar/:eventId — aprova evento via AuditService
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import jwt from '@fastify/jwt'
import { ZodError } from 'zod'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockConciliation = {
  conciliarNFSeTomadas: vi.fn(),
  conciliarNFSeEmitidas: vi.fn(),
  conciliarNFCe: vi.fn(),
}

const mockAudit = {
  aprovar: vi.fn(),
}

vi.mock('@saas-contabil/conciliation', () => ({
  ConciliationService: vi.fn(() => mockConciliation),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn(() => mockAudit),
}))

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    empresaCliente: { findMany: vi.fn() },
    documentoFiscal: { count: vi.fn() },
  },
}))

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@saas-contabil/shared')>()
  return { ...actual }
})

import { conciliacaoRoutes } from '../routes/conciliacao.routes.js'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-conc'
const USER_ID = 'user-conc'
const EMPRESA_ID = '550e8400-e29b-41d4-a716-446655440001'
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

  await app.register(conciliacaoRoutes, { prefix: '/conciliacao' })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  vi.clearAllMocks()
  mockConciliation.conciliarNFSeTomadas.mockResolvedValue(undefined)
  mockConciliation.conciliarNFSeEmitidas.mockResolvedValue(undefined)
  mockConciliation.conciliarNFCe.mockResolvedValue(undefined)
  mockAudit.aprovar.mockResolvedValue(undefined)
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
// GET /conciliacao/status
// ===========================================================================

describe('GET /conciliacao/status', () => {
  function setupStatusMocks(
    empresas: { id: string; cnpj: string; razaoSocial: string }[],
    counts: { total: number; conciliados: number; pendentesRevisao: number }[]
  ) {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce(empresas)
    for (const c of counts) {
      mockDb.documentoFiscal.count
        .mockResolvedValueOnce(c.total) // total
        .mockResolvedValueOnce(c.conciliados) // conciliados
        .mockResolvedValueOnce(c.pendentesRevisao) // pendentesRevisao
    }
  }

  it('retorna status de cada empresa ativa', async () => {
    setupStatusMocks(
      [{ id: EMPRESA_ID, cnpj: '11111111000111', razaoSocial: 'Empresa A' }],
      [{ total: 100, conciliados: 80, pendentesRevisao: 5 }]
    )

    const res = await req('GET', '/conciliacao/status')

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveLength(1)
    expect(body[0].empresaId).toBe(EMPRESA_ID)
    expect(body[0].totalDocumentos).toBe(100)
    expect(body[0].conciliados).toBe(80)
    expect(body[0].pendentesRevisao).toBe(5)
    expect(body[0].pendentes).toBe(15) // 100 - 80 - 5
  })

  it('pendentes calculado como total - conciliados - pendentesRevisao', async () => {
    setupStatusMocks(
      [{ id: EMPRESA_ID, cnpj: '11111111000111', razaoSocial: 'Empresa A' }],
      [{ total: 50, conciliados: 30, pendentesRevisao: 10 }]
    )

    const res = await req('GET', '/conciliacao/status')

    expect(res.json()[0].pendentes).toBe(10) // 50 - 30 - 10
  })

  it('busca apenas empresas ativas do tenant', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([])

    await req('GET', '/conciliacao/status')

    const { where } = mockDb.empresaCliente.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.ativa).toBe(true)
  })

  it('sem empresas → array vazio', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([])

    const res = await req('GET', '/conciliacao/status')

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('com ?competencia=YYYY-MM filtra documentos pelo período', async () => {
    setupStatusMocks(
      [{ id: EMPRESA_ID, cnpj: '11111111000111', razaoSocial: 'A' }],
      [{ total: 10, conciliados: 10, pendentesRevisao: 0 }]
    )

    await req('GET', '/conciliacao/status?competencia=2025-05')

    // O count deve ter sido chamado com filtro de dataCompetencia
    const countWhere = mockDb.documentoFiscal.count.mock.calls[0][0].where
    expect(countWhere.dataCompetencia).toBeDefined()
    expect(countWhere.dataCompetencia.gte).toBeInstanceOf(Date)
    expect(countWhere.dataCompetencia.lte).toBeInstanceOf(Date)
  })
})

// ===========================================================================
// POST /conciliacao/run/:empresaId/:competencia
// ===========================================================================

describe('POST /conciliacao/run/:empresaId/:competencia', () => {
  const url = `/conciliacao/run/${EMPRESA_ID}/${COMPETENCIA}`

  it('executa os 3 serviços de conciliação → 200 com success: true', async () => {
    const res = await req('POST', url)

    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it('chama conciliarNFSeTomadas com tenantId, empresaId e competencia', async () => {
    await req('POST', url)

    expect(mockConciliation.conciliarNFSeTomadas).toHaveBeenCalledWith(
      TENANT_ID,
      EMPRESA_ID,
      COMPETENCIA
    )
  })

  it('chama conciliarNFSeEmitidas', async () => {
    await req('POST', url)
    expect(mockConciliation.conciliarNFSeEmitidas).toHaveBeenCalledTimes(1)
  })

  it('chama conciliarNFCe', async () => {
    await req('POST', url)
    expect(mockConciliation.conciliarNFCe).toHaveBeenCalledTimes(1)
  })

  it('os 3 serviços são chamados em paralelo (todos chamados)', async () => {
    await req('POST', url)

    expect(mockConciliation.conciliarNFSeTomadas).toHaveBeenCalledTimes(1)
    expect(mockConciliation.conciliarNFSeEmitidas).toHaveBeenCalledTimes(1)
    expect(mockConciliation.conciliarNFCe).toHaveBeenCalledTimes(1)
  })

  it('competencia inválida → 400', async () => {
    const res = await req('POST', `/conciliacao/run/${EMPRESA_ID}/2025`)
    expect(res.statusCode).toBe(400)
  })

  it('empresaId não-UUID → 400', async () => {
    const res = await req('POST', `/conciliacao/run/nao-uuid/${COMPETENCIA}`)
    expect(res.statusCode).toBe(400)
  })

  it('falha em serviço → propaga erro', async () => {
    mockConciliation.conciliarNFSeTomadas.mockRejectedValueOnce(new Error('SEFAZ indisponível'))

    const res = await req('POST', url)

    expect(res.statusCode).toBe(500)
    expect(res.json().error).toMatch(/SEFAZ/i)
  })
})

// ===========================================================================
// POST /conciliacao/nfse-tomadas
// ===========================================================================

describe('POST /conciliacao/nfse-tomadas/:empresaId/:competencia', () => {
  it('chama apenas conciliarNFSeTomadas', async () => {
    mockConciliation.conciliarNFSeTomadas.mockResolvedValueOnce({ conciliados: 5 })

    const res = await req('POST', `/conciliacao/nfse-tomadas/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    expect(mockConciliation.conciliarNFSeTomadas).toHaveBeenCalledWith(
      TENANT_ID,
      EMPRESA_ID,
      COMPETENCIA
    )
    expect(mockConciliation.conciliarNFSeEmitidas).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// POST /conciliacao/nfse-emitidas
// ===========================================================================

describe('POST /conciliacao/nfse-emitidas/:empresaId/:competencia', () => {
  it('chama apenas conciliarNFSeEmitidas', async () => {
    mockConciliation.conciliarNFSeEmitidas.mockResolvedValueOnce({ conciliados: 3 })

    const res = await req('POST', `/conciliacao/nfse-emitidas/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    expect(mockConciliation.conciliarNFSeEmitidas).toHaveBeenCalledTimes(1)
    expect(mockConciliation.conciliarNFSeTomadas).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// POST /conciliacao/nfce
// ===========================================================================

describe('POST /conciliacao/nfce/:empresaId/:competencia', () => {
  it('chama apenas conciliarNFCe', async () => {
    mockConciliation.conciliarNFCe.mockResolvedValueOnce({ conciliados: 10 })

    const res = await req('POST', `/conciliacao/nfce/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    expect(mockConciliation.conciliarNFCe).toHaveBeenCalledTimes(1)
    expect(mockConciliation.conciliarNFSeTomadas).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// POST /conciliacao/aprovar/:eventId
// ===========================================================================

describe('POST /conciliacao/aprovar/:eventId', () => {
  it('chama AuditService.aprovar com eventId, userId e tenantId → 200', async () => {
    const res = await req('POST', '/conciliacao/aprovar/event-123')

    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
    expect(mockAudit.aprovar).toHaveBeenCalledWith('event-123', USER_ID, TENANT_ID)
  })

  it('falha no AuditService → 500', async () => {
    mockAudit.aprovar.mockRejectedValueOnce(new Error('Evento não encontrado'))

    const res = await req('POST', '/conciliacao/aprovar/event-inexistente')

    expect(res.statusCode).toBe(500)
  })
})
