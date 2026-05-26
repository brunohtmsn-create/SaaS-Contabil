/**
 * Testes de integração — documento.routes.ts
 *
 * Cobre:
 *  GET   /documentos            — listagem paginada com filtros
 *  GET   /documentos/:id        — documento individual (404 se inexistente)
 *  PATCH /documentos/:id/status — atualização de status (conciliação manual)
 *  POST  /documentos/capturar/:empresaId/:comp — disparo do scraper
 *  GET   /documentos/stats/:empresaId/:comp    — estatísticas agregadas
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import { ZodError } from 'zod'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('bullmq', () => ({
  Queue: vi.fn(() => ({ add: vi.fn().mockResolvedValue({ id: 'scraper-job-1' }) })),
}))

vi.mock('ioredis', () => ({
  Redis: vi.fn(() => ({})),
}))

const mockNormalizer = { normalizar: vi.fn() }
vi.mock('@saas-contabil/normalizer', () => ({
  NormalizerService: vi.fn(() => mockNormalizer),
}))

const mockStorage = { upload: vi.fn(), exists: vi.fn(), getSignedUrl: vi.fn() }
vi.mock('@saas-contabil/storage', () => ({
  StorageService: vi.fn(() => mockStorage),
  S3KeyBuilder: {
    xmlNFeEmitida: vi.fn(() => 's3/nfe/key'),
    xmlNFCeEmitida: vi.fn(() => 's3/nfce/key'),
    xmlNFSe: vi.fn(() => 's3/nfse/key'),
  },
}))

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    empresaCliente: { findFirst: vi.fn() },
    credencial: { findFirst: vi.fn() },
    documentoFiscal: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}))

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@saas-contabil/shared')>()
  return {
    ...actual,
    parsePeriodo: vi.fn(() => ({
      inicio: new Date('2025-05-01'),
      fim: new Date('2025-05-31'),
    })),
    limparCNPJ: (v: string) => v.replace(/\D/g, ''),
    formatCompetencia: vi.fn(() => '2025-05'),
  }
})

import { documentoRoutes } from '../routes/documento.routes.js'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-docs'
const USER_ID = 'user-docs'
const EMPRESA_ID = '550e8400-e29b-41d4-a716-446655440003'
const COMPETENCIA = '2025-05'

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

  await app.register(documentoRoutes, { prefix: '/documentos' })
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
// GET /documentos
// ===========================================================================

describe('GET /documentos', () => {
  it('retorna documentos paginados do tenant → 200', async () => {
    const docs = [{ id: 'doc-1', tipo: 'NFE', status: 'CONCILIADO' }]
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce(docs)
    mockDb.documentoFiscal.count.mockResolvedValueOnce(1)

    const res = await req('GET', '/documentos')

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(1)
    expect(body.total).toBe(1)
    expect(body.page).toBe(1)
  })

  it('filtra por tenantId (isolamento)', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([])
    mockDb.documentoFiscal.count.mockResolvedValueOnce(0)

    await req('GET', '/documentos')

    const { where } = mockDb.documentoFiscal.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
  })

  it('com ?tipo=NFE adiciona filtro de tipo', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([])
    mockDb.documentoFiscal.count.mockResolvedValueOnce(0)

    await req('GET', '/documentos?tipo=NFE')

    const { where } = mockDb.documentoFiscal.findMany.mock.calls[0][0]
    expect(where.tipo).toBe('NFE')
  })

  it('com ?status=CONCILIADO adiciona filtro de status', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([])
    mockDb.documentoFiscal.count.mockResolvedValueOnce(0)

    await req('GET', '/documentos?status=CONCILIADO')

    const { where } = mockDb.documentoFiscal.findMany.mock.calls[0][0]
    expect(where.status).toBe('CONCILIADO')
  })

  it('com ?competencia=YYYY-MM adiciona filtro de período', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([])
    mockDb.documentoFiscal.count.mockResolvedValueOnce(0)

    await req('GET', `/documentos?competencia=${COMPETENCIA}`)

    const { where } = mockDb.documentoFiscal.findMany.mock.calls[0][0]
    expect(where.dataCompetencia).toBeDefined()
    expect(where.dataCompetencia.gte).toBeDefined()
    expect(where.dataCompetencia.lte).toBeDefined()
  })

  it('limit é clamped em 200', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([])
    mockDb.documentoFiscal.count.mockResolvedValueOnce(0)

    await req('GET', '/documentos?limit=999')

    const { take } = mockDb.documentoFiscal.findMany.mock.calls[0][0]
    expect(take).toBe(200)
  })

  it('com ?empresaId filtra por empresa', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([])
    mockDb.documentoFiscal.count.mockResolvedValueOnce(0)

    await req('GET', `/documentos?empresaId=${EMPRESA_ID}`)

    const { where } = mockDb.documentoFiscal.findMany.mock.calls[0][0]
    expect(where.empresaId).toBe(EMPRESA_ID)
  })
})

// ===========================================================================
// GET /documentos/:id
// ===========================================================================

describe('GET /documentos/:id', () => {
  it('documento encontrado → 200', async () => {
    mockDb.documentoFiscal.findFirst.mockResolvedValueOnce({
      id: 'doc-abc',
      tipo: 'NFSE_EMITIDA',
      status: 'NORMALIZADO',
    })

    const res = await req('GET', '/documentos/doc-abc')

    expect(res.statusCode).toBe(200)
    expect(res.json().tipo).toBe('NFSE_EMITIDA')
  })

  it('documento não encontrado → 404', async () => {
    mockDb.documentoFiscal.findFirst.mockResolvedValueOnce(null)

    const res = await req('GET', '/documentos/doc-inexistente')

    expect(res.statusCode).toBe(404)
    expect(res.json().error).toMatch(/não encontrado/i)
  })

  it('busca inclui tenantId (isolamento)', async () => {
    mockDb.documentoFiscal.findFirst.mockResolvedValueOnce({ id: 'doc-t' })

    await req('GET', '/documentos/doc-t')

    const where = mockDb.documentoFiscal.findFirst.mock.calls[0][0].where
    expect(where.tenantId).toBe(TENANT_ID)
  })
})

// ===========================================================================
// PATCH /documentos/:id/status
// ===========================================================================

describe('PATCH /documentos/:id/status', () => {
  it('atualiza para CONCILIADO → 200', async () => {
    mockDb.documentoFiscal.findFirst.mockResolvedValueOnce({ id: 'doc-1', tenantId: TENANT_ID })
    mockDb.documentoFiscal.update.mockResolvedValueOnce({
      id: 'doc-1',
      status: 'CONCILIADO',
    })

    const res = await req('PATCH', '/documentos/doc-1/status', { status: 'CONCILIADO' })

    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('CONCILIADO')
  })

  it('atualiza para DIVERGENTE → 200', async () => {
    mockDb.documentoFiscal.findFirst.mockResolvedValueOnce({ id: 'doc-2', tenantId: TENANT_ID })
    mockDb.documentoFiscal.update.mockResolvedValueOnce({ id: 'doc-2', status: 'DIVERGENTE' })

    const res = await req('PATCH', '/documentos/doc-2/status', { status: 'DIVERGENTE' })

    expect(res.statusCode).toBe(200)
  })

  it('atualiza para PENDENTE_REVISAO → 200', async () => {
    mockDb.documentoFiscal.findFirst.mockResolvedValueOnce({ id: 'doc-3', tenantId: TENANT_ID })
    mockDb.documentoFiscal.update.mockResolvedValueOnce({
      id: 'doc-3',
      status: 'PENDENTE_REVISAO',
    })

    const res = await req('PATCH', '/documentos/doc-3/status', { status: 'PENDENTE_REVISAO' })

    expect(res.statusCode).toBe(200)
  })

  it('documento não encontrado → 404', async () => {
    mockDb.documentoFiscal.findFirst.mockResolvedValueOnce(null)

    const res = await req('PATCH', '/documentos/doc-missing/status', { status: 'CONCILIADO' })

    expect(res.statusCode).toBe(404)
    expect(mockDb.documentoFiscal.update).not.toHaveBeenCalled()
  })

  it('status inválido → 400', async () => {
    const res = await req('PATCH', '/documentos/doc-1/status', { status: 'INEXISTENTE' })

    expect(res.statusCode).toBe(400)
    expect(mockDb.documentoFiscal.update).not.toHaveBeenCalled()
  })

  it('update inclui tenantId no where (isolamento)', async () => {
    mockDb.documentoFiscal.findFirst.mockResolvedValueOnce({ id: 'doc-iso' })
    mockDb.documentoFiscal.update.mockResolvedValueOnce({ id: 'doc-iso', status: 'CONCILIADO' })

    await req('PATCH', '/documentos/doc-iso/status', { status: 'CONCILIADO' })

    const updateWhere = mockDb.documentoFiscal.update.mock.calls[0][0].where
    expect(updateWhere.tenantId).toBe(TENANT_ID)
    expect(updateWhere.id).toBe('doc-iso')
  })
})

// ===========================================================================
// POST /documentos/capturar/:empresaId/:competencia
// ===========================================================================

describe('POST /documentos/capturar/:empresaId/:competencia', () => {
  it('empresa sem credencial → 400', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({
      id: EMPRESA_ID,
      cnpj: '12345678000195',
    })
    mockDb.credencial.findFirst.mockResolvedValueOnce(null)

    const res = await req('POST', `/documentos/capturar/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/credencial/i)
  })

  it('empresa não encontrada → 404', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(null)

    const res = await req('POST', `/documentos/capturar/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(404)
  })

  it('empresaId inválido (não UUID) → 400', async () => {
    const res = await req('POST', `/documentos/capturar/nao-uuid/${COMPETENCIA}`)
    expect(res.statusCode).toBe(400)
  })

  it('competencia inválida → 400', async () => {
    const res = await req('POST', `/documentos/capturar/${EMPRESA_ID}/2025`)
    expect(res.statusCode).toBe(400)
  })

  it('com credencial ativa → enfileira scraper e retorna jobId', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({
      id: EMPRESA_ID,
      cnpj: '12345678000195',
    })
    mockDb.credencial.findFirst.mockResolvedValueOnce({ id: 'cred-ativa' })

    const res = await req('POST', `/documentos/capturar/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('AGUARDANDO')
    expect(body.cnpj).toBe('12345678000195')
    expect(body.competencia).toBe(COMPETENCIA)
  })

  it('busca empresa por tenantId (isolamento)', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(null)

    await req('POST', `/documentos/capturar/${EMPRESA_ID}/${COMPETENCIA}`)

    const where = mockDb.empresaCliente.findFirst.mock.calls[0][0].where
    expect(where.tenantId).toBe(TENANT_ID)
  })
})

// ===========================================================================
// GET /documentos/stats/:empresaId/:competencia
// ===========================================================================

describe('GET /documentos/stats/:empresaId/:competencia', () => {
  const url = `/documentos/stats/${EMPRESA_ID}/${COMPETENCIA}`

  it('retorna total, porTipo e porStatus → 200', async () => {
    mockDb.documentoFiscal.count.mockResolvedValueOnce(15)
    mockDb.documentoFiscal.groupBy
      .mockResolvedValueOnce([
        { tipo: 'NFE', _count: 10, _sum: { valorTotal: '50000.00' } },
        { tipo: 'NFSE_EMITIDA', _count: 5, _sum: { valorTotal: '15000.00' } },
      ])
      .mockResolvedValueOnce([
        { status: 'CONCILIADO', _count: 12 },
        { status: 'PENDENTE_REVISAO', _count: 3 },
      ])

    const res = await req('GET', url)

    expect(res.statusCode).toBe(200)
    expect(res.json().total).toBe(15)
    expect(res.json().porTipo).toHaveLength(2)
    expect(res.json().porStatus).toHaveLength(2)
  })

  it('filtra por tenantId e empresaId (isolamento)', async () => {
    mockDb.documentoFiscal.count.mockResolvedValueOnce(0)
    mockDb.documentoFiscal.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    await req('GET', url)

    const countWhere = mockDb.documentoFiscal.count.mock.calls[0][0].where
    expect(countWhere.tenantId).toBe(TENANT_ID)
    expect(countWhere.empresaId).toBe(EMPRESA_ID)
  })

  it('usa datas de início e fim do período (parsePeriodo)', async () => {
    mockDb.documentoFiscal.count.mockResolvedValueOnce(0)
    mockDb.documentoFiscal.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    await req('GET', url)

    const countWhere = mockDb.documentoFiscal.count.mock.calls[0][0].where
    expect(countWhere.dataCompetencia.gte).toEqual(new Date('2025-05-01'))
    expect(countWhere.dataCompetencia.lte).toEqual(new Date('2025-05-31'))
  })

  it('total zero quando não há documentos', async () => {
    mockDb.documentoFiscal.count.mockResolvedValueOnce(0)
    mockDb.documentoFiscal.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    const res = await req('GET', url)

    expect(res.statusCode).toBe(200)
    expect(res.json().total).toBe(0)
    expect(res.json().porTipo).toHaveLength(0)
  })
})
