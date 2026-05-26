/**
 * Testes de integração — fechamento.routes.ts
 *
 * Cobre:
 *  POST /fechamento/run/:empresaId/:competencia   — enfileira fechamento individual
 *  GET  /fechamento/status/:empresaId/:competencia — status do fechamento
 *  POST /fechamento/batch/:competencia             — lote de todas as empresas ativas
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import jwt from '@fastify/jwt'
import { ZodError } from 'zod'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockQueue = { add: vi.fn() }

vi.mock('bullmq', () => ({
  Queue: vi.fn(() => mockQueue),
}))

vi.mock('ioredis', () => ({
  Redis: vi.fn(() => ({})),
}))

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    empresaCliente: { findFirst: vi.fn(), findMany: vi.fn() },
    credencial: { findFirst: vi.fn() },
    apuracaoFiscal: { findMany: vi.fn() },
    lancamentoContabil: { count: vi.fn() },
    obrigacao: { findMany: vi.fn() },
  },
}))

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

import { fechamentoRoutes } from '../routes/fechamento.routes.js'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-fechamento'
const USER_ID = 'user-fechamento'
const EMPRESA_ID = '550e8400-e29b-41d4-a716-446655440002'
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

  await app.register(fechamentoRoutes, { prefix: '/fechamento' })
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
// POST /fechamento/run/:empresaId/:competencia
// ===========================================================================

describe('POST /fechamento/run/:empresaId/:competencia', () => {
  it('enfileira fechamento e retorna jobId + status INICIADO → 200', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({
      id: EMPRESA_ID,
      cnpj: '12345678000195',
    })
    mockDb.credencial.findFirst.mockResolvedValueOnce({ id: 'cred-1' })
    mockQueue.add.mockResolvedValueOnce({ id: 'job-abc' })

    const res = await req('POST', `/fechamento/run/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('INICIADO')
    expect(body.jobId).toBe('job-abc')
    expect(body.comCredencial).toBe(true)
    expect(body.empresa).toBe('12345678000195')
    expect(body.competencia).toBe(COMPETENCIA)
  })

  it('empresa não encontrada → 404', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(null)

    const res = await req('POST', `/fechamento/run/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(404)
    expect(mockQueue.add).not.toHaveBeenCalled()
  })

  it('empresa sem credencial → comCredencial: false, job ainda enfileirado', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({
      id: EMPRESA_ID,
      cnpj: '12345678000195',
    })
    mockDb.credencial.findFirst.mockResolvedValueOnce(null)
    mockQueue.add.mockResolvedValueOnce({ id: 'job-sem-cred' })

    const res = await req('POST', `/fechamento/run/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    expect(res.json().comCredencial).toBe(false)
    expect(mockQueue.add).toHaveBeenCalledOnce()
  })

  it('job carrega tenantId do JWT (não do body)', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({
      id: EMPRESA_ID,
      cnpj: '12345678000195',
    })
    mockDb.credencial.findFirst.mockResolvedValueOnce(null)
    mockQueue.add.mockResolvedValueOnce({ id: 'job-t' })

    await req('POST', `/fechamento/run/${EMPRESA_ID}/${COMPETENCIA}`)

    const jobData = mockQueue.add.mock.calls[0][1]
    expect(jobData.tenantId).toBe(TENANT_ID)
    expect(jobData.empresaId).toBe(EMPRESA_ID)
    expect(jobData.competencia).toBe(COMPETENCIA)
  })

  it('empresaId inválido (não UUID) → 400', async () => {
    const res = await req('POST', `/fechamento/run/nao-uuid/${COMPETENCIA}`)
    expect(res.statusCode).toBe(400)
  })

  it('competencia inválida (não YYYY-MM) → 400', async () => {
    const res = await req('POST', `/fechamento/run/${EMPRESA_ID}/2025`)
    expect(res.statusCode).toBe(400)
  })

  it('busca empresa com tenantId do JWT (isolamento)', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(null)

    await req('POST', `/fechamento/run/${EMPRESA_ID}/${COMPETENCIA}`)

    const where = mockDb.empresaCliente.findFirst.mock.calls[0][0].where
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.id).toBe(EMPRESA_ID)
  })
})

// ===========================================================================
// GET /fechamento/status/:empresaId/:competencia
// ===========================================================================

describe('GET /fechamento/status/:empresaId/:competencia', () => {
  it('retorna apurações, count de lançamentos e obrigações → 200', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([{ id: 'ap-1', tipo: 'PGDAS' }])
    mockDb.lancamentoContabil.count.mockResolvedValueOnce(12)
    mockDb.obrigacao.findMany.mockResolvedValueOnce([{ id: 'obr-1', tipo: 'DAS' }])

    const res = await req('GET', `/fechamento/status/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.apuracoes).toHaveLength(1)
    expect(body.lancamentos).toBe(12)
    expect(body.obrigacoes).toHaveLength(1)
  })

  it('todos os queries filtram por tenantId (isolamento)', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([])
    mockDb.lancamentoContabil.count.mockResolvedValueOnce(0)
    mockDb.obrigacao.findMany.mockResolvedValueOnce([])

    await req('GET', `/fechamento/status/${EMPRESA_ID}/${COMPETENCIA}`)

    const apWhere = mockDb.apuracaoFiscal.findMany.mock.calls[0][0].where
    expect(apWhere.tenantId).toBe(TENANT_ID)
    expect(apWhere.empresaId).toBe(EMPRESA_ID)
    expect(apWhere.competencia).toBe(COMPETENCIA)
  })
})

// ===========================================================================
// POST /fechamento/batch/:competencia
// ===========================================================================

describe('POST /fechamento/batch/:competencia', () => {
  it('enfileira job para cada empresa ativa → retorna total e semCredencial', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([
      { id: 'emp-1', cnpj: '11111111000100', credenciais: [{ id: 'cred-1' }] },
      { id: 'emp-2', cnpj: '22222222000100', credenciais: [{ id: 'cred-2' }] },
      { id: 'emp-3', cnpj: '33333333000100', credenciais: [] },
    ])
    mockQueue.add.mockResolvedValue({ id: 'job-batch' })

    const res = await req('POST', `/fechamento/batch/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(3)
    expect(body.semCredencial).toBe(1)
    expect(body.competencia).toBe(COMPETENCIA)
    expect(mockQueue.add).toHaveBeenCalledTimes(3)
  })

  it('sem empresas ativas → total: 0, semCredencial: 0', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([])

    const res = await req('POST', `/fechamento/batch/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    expect(res.json().total).toBe(0)
    expect(res.json().semCredencial).toBe(0)
    expect(mockQueue.add).not.toHaveBeenCalled()
  })

  it('filtra empresas por tenantId e ativa:true (isolamento)', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([])

    await req('POST', `/fechamento/batch/${COMPETENCIA}`)

    const { where } = mockDb.empresaCliente.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.ativa).toBe(true)
  })

  it('cada job inclui tenantId e competencia corretos', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([
      { id: 'emp-x', cnpj: '99999999000100', credenciais: [] },
    ])
    mockQueue.add.mockResolvedValueOnce({ id: 'job-x' })

    await req('POST', `/fechamento/batch/${COMPETENCIA}`)

    const jobData = mockQueue.add.mock.calls[0][1]
    expect(jobData.tenantId).toBe(TENANT_ID)
    expect(jobData.competencia).toBe(COMPETENCIA)
    expect(jobData.cnpj).toBe('99999999000100')
  })

  it('jobIds retornados correspondem aos jobs criados', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([
      { id: 'emp-a', cnpj: '11111111000100', credenciais: [] },
      { id: 'emp-b', cnpj: '22222222000100', credenciais: [] },
    ])
    mockQueue.add.mockResolvedValueOnce({ id: 'job-1' }).mockResolvedValueOnce({ id: 'job-2' })

    const res = await req('POST', `/fechamento/batch/${COMPETENCIA}`)

    const { jobIds } = res.json()
    expect(jobIds).toEqual(['job-1', 'job-2'])
  })
})
