/**
 * Testes de integração — portal.routes.ts
 *
 * Cobre:
 *  POST /portais/executar               — enfileira job de portal
 *  GET  /portais/jobs/:empresaId        — lista jobs da empresa
 *  GET  /portais/status/:empresaId      — status por portal (SEFAZ, SN, e-CAC, etc.)
 *  POST /portais/ecac/sincronizar/:id   — dispara sincronização e-CAC
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import jwt from '@fastify/jwt'
import { ZodError } from 'zod'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPortalQueue = { add: vi.fn() }

vi.mock('bullmq', () => ({
  Queue: vi.fn(() => mockPortalQueue),
}))

vi.mock('ioredis', () => ({
  Redis: vi.fn(() => ({})),
}))

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    portalJob: { findMany: vi.fn() },
    empresaCliente: { findFirst: vi.fn() },
    credencial: { findFirst: vi.fn() },
    apuracaoFiscal: { findFirst: vi.fn() },
  },
}))

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

import { portalRoutes } from '../routes/portal.routes.js'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-portal'
const USER_ID = 'user-portal'
const EMPRESA_ID = '550e8400-e29b-41d4-a716-446655440005'

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

  await app.register(portalRoutes, { prefix: '/portais' })
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
// POST /portais/executar
// ===========================================================================

describe('POST /portais/executar', () => {
  it('enfileira job e retorna jobId + status AGUARDANDO → 200', async () => {
    mockPortalQueue.add.mockResolvedValueOnce({ id: 'portal-job-1' })

    const res = await req('POST', '/portais/executar', {
      empresaId: EMPRESA_ID,
      cnpj: '12345678000195',
      portal: 'SIMPLES_NACIONAL',
      operacao: 'CONSULTAR_DAS',
      credencialId: '550e8400-e29b-41d4-a716-446655440099',
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('AGUARDANDO')
    expect(body.jobId).toBe('portal-job-1')
  })

  it('job carrega tenantId do JWT', async () => {
    mockPortalQueue.add.mockResolvedValueOnce({ id: 'portal-job-2' })

    await req('POST', '/portais/executar', {
      empresaId: EMPRESA_ID,
      cnpj: '12345678000195',
      portal: 'ECAC',
      operacao: 'SINCRONIZAR_DEBITOS',
      credencialId: '550e8400-e29b-41d4-a716-446655440099',
    })

    const jobData = mockPortalQueue.add.mock.calls[0][1]
    expect(jobData.tenantId).toBe(TENANT_ID)
  })

  it('empresaId inválido (não UUID) → 400', async () => {
    const res = await req('POST', '/portais/executar', {
      empresaId: 'nao-uuid',
      cnpj: '12345678000195',
      portal: 'ECAC',
      operacao: 'SINCRONIZAR_DEBITOS',
      credencialId: '550e8400-e29b-41d4-a716-446655440099',
    })

    expect(res.statusCode).toBe(400)
    expect(mockPortalQueue.add).not.toHaveBeenCalled()
  })

  it('cnpj com tamanho errado → 400', async () => {
    const res = await req('POST', '/portais/executar', {
      empresaId: EMPRESA_ID,
      cnpj: '123',
      portal: 'ECAC',
      operacao: 'OP',
      credencialId: '550e8400-e29b-41d4-a716-446655440099',
    })

    expect(res.statusCode).toBe(400)
  })

  it('sem campo obrigatório (credencialId) → 400', async () => {
    const res = await req('POST', '/portais/executar', {
      empresaId: EMPRESA_ID,
      cnpj: '12345678000195',
      portal: 'ECAC',
      operacao: 'SINCRONIZAR_DEBITOS',
    })

    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// GET /portais/jobs/:empresaId
// ===========================================================================

describe('GET /portais/jobs/:empresaId', () => {
  it('lista jobs da empresa → 200', async () => {
    mockDb.portalJob.findMany.mockResolvedValueOnce([
      { id: 'pj-1', portal: 'ECAC', status: 'CONCLUIDO' },
      { id: 'pj-2', portal: 'SIMPLES_NACIONAL', status: 'EM_EXECUCAO' },
    ])

    const res = await req('GET', `/portais/jobs/${EMPRESA_ID}`)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(2)
  })

  it('filtra por tenantId e empresaId (isolamento)', async () => {
    mockDb.portalJob.findMany.mockResolvedValueOnce([])

    await req('GET', `/portais/jobs/${EMPRESA_ID}`)

    const { where } = mockDb.portalJob.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.empresaId).toBe(EMPRESA_ID)
  })
})

// ===========================================================================
// GET /portais/status/:empresaId
// ===========================================================================

describe('GET /portais/status/:empresaId', () => {
  it('retorna status dos 6 portais → 200', async () => {
    mockDb.portalJob.findMany.mockResolvedValueOnce([])

    const res = await req('GET', `/portais/status/${EMPRESA_ID}`)

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveLength(6)
    const portais = body.map((p: any) => p.portal)
    expect(portais).toContain('SEFAZ_FEDERAL')
    expect(portais).toContain('SIMPLES_NACIONAL')
    expect(portais).toContain('ECAC')
    expect(portais).toContain('DCTFWEB')
  })

  it('portal sem job → status PENDENTE', async () => {
    mockDb.portalJob.findMany.mockResolvedValueOnce([])

    const res = await req('GET', `/portais/status/${EMPRESA_ID}`)

    const body = res.json()
    body.forEach((p: any) => {
      expect(p.status).toBe('PENDENTE')
    })
  })

  it('portal com job CONCLUIDO → status OK', async () => {
    mockDb.portalJob.findMany.mockResolvedValueOnce([
      {
        portal: 'SIMPLES_NACIONAL',
        status: 'CONCLUIDO',
        concluidoEm: new Date().toISOString(),
        erro: null,
      },
    ])

    const res = await req('GET', `/portais/status/${EMPRESA_ID}`)

    const sn = res.json().find((p: any) => p.portal === 'SIMPLES_NACIONAL')
    expect(sn.status).toBe('OK')
  })

  it('portal com job ERRO → status ERRO com mensagem', async () => {
    mockDb.portalJob.findMany.mockResolvedValueOnce([
      {
        portal: 'ECAC',
        status: 'ERRO',
        concluidoEm: null,
        erro: 'Timeout ao acessar portal',
      },
    ])

    const res = await req('GET', `/portais/status/${EMPRESA_ID}`)

    const ecac = res.json().find((p: any) => p.portal === 'ECAC')
    expect(ecac.status).toBe('ERRO')
    expect(ecac.mensagem).toBe('Timeout ao acessar portal')
  })

  it('portal com job EM_EXECUCAO → status PROCESSANDO', async () => {
    mockDb.portalJob.findMany.mockResolvedValueOnce([
      { portal: 'SEFAZ_FEDERAL', status: 'EM_EXECUCAO', concluidoEm: null, erro: null },
    ])

    const res = await req('GET', `/portais/status/${EMPRESA_ID}`)

    const sefaz = res.json().find((p: any) => p.portal === 'SEFAZ_FEDERAL')
    expect(sefaz.status).toBe('PROCESSANDO')
  })
})

// ===========================================================================
// POST /portais/ecac/sincronizar/:empresaId
// ===========================================================================

describe('POST /portais/ecac/sincronizar/:empresaId', () => {
  it('empresa com credencial e-CAC → enfileira job → 200', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({
      id: EMPRESA_ID,
      cnpj: '12345678000195',
    })
    mockDb.credencial.findFirst.mockResolvedValueOnce({ id: 'cred-ecac-1' })
    mockPortalQueue.add.mockResolvedValueOnce({ id: 'ecac-job-1' })

    const res = await req('POST', `/portais/ecac/sincronizar/${EMPRESA_ID}`)

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('AGUARDANDO')
    expect(body.jobId).toBe('ecac-job-1')
  })

  it('empresa não encontrada → lança erro', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(null)

    const res = await req('POST', `/portais/ecac/sincronizar/${EMPRESA_ID}`)

    expect(res.statusCode).toBe(500)
    expect(mockPortalQueue.add).not.toHaveBeenCalled()
  })

  it('busca empresa com tenantId do JWT (isolamento)', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(null)

    await req('POST', `/portais/ecac/sincronizar/${EMPRESA_ID}`)

    const where = mockDb.empresaCliente.findFirst.mock.calls[0][0].where
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.id).toBe(EMPRESA_ID)
  })
})

// ===========================================================================
// POST /portais/dctfweb/transmitir/:empresaId/:competencia
// ===========================================================================

const COMPETENCIA = '2025-01'

describe('POST /portais/dctfweb/transmitir/:empresaId/:competencia', () => {
  it('empresa + credencial + apuração OK → enfileira job → 202', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({
      id: EMPRESA_ID,
      cnpj: '12345678000195',
    })
    mockDb.credencial.findFirst.mockResolvedValueOnce({ id: 'cred-a1-1' })
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce({ id: 'apur-dctf-1' })
    mockPortalQueue.add.mockResolvedValueOnce({ id: 'dctf-job-1' })

    const res = await req('POST', `/portais/dctfweb/transmitir/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(202)
    const body = res.json()
    expect(body.status).toBe('AGUARDANDO')
    expect(body.jobId).toBe('dctf-job-1')
    expect(body.competencia).toBe(COMPETENCIA)
  })

  it('empresa não encontrada → 404', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(null)

    const res = await req('POST', `/portais/dctfweb/transmitir/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(404)
    expect(mockPortalQueue.add).not.toHaveBeenCalled()
  })

  it('credencial A1 não encontrada → 422', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({
      id: EMPRESA_ID,
      cnpj: '12345678000195',
    })
    mockDb.credencial.findFirst.mockResolvedValueOnce(null)

    const res = await req('POST', `/portais/dctfweb/transmitir/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(422)
    expect(res.json().error).toMatch(/certificado/i)
    expect(mockPortalQueue.add).not.toHaveBeenCalled()
  })

  it('apuração DCTFWeb não calculada → 422', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({
      id: EMPRESA_ID,
      cnpj: '12345678000195',
    })
    mockDb.credencial.findFirst.mockResolvedValueOnce({ id: 'cred-a1-1' })
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce(null)

    const res = await req('POST', `/portais/dctfweb/transmitir/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(422)
    expect(res.json().error).toMatch(/dctfweb/i)
    expect(mockPortalQueue.add).not.toHaveBeenCalled()
  })

  it('competência inválida → 400', async () => {
    const res = await req('POST', `/portais/dctfweb/transmitir/${EMPRESA_ID}/202501`)

    expect(res.statusCode).toBe(400)
    expect(mockPortalQueue.add).not.toHaveBeenCalled()
  })

  it('job carrega tenantId, portal DCTFWEB e operação TRANSMITIR', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({
      id: EMPRESA_ID,
      cnpj: '12345678000195',
    })
    mockDb.credencial.findFirst.mockResolvedValueOnce({ id: 'cred-a1-2' })
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce({ id: 'apur-dctf-2' })
    mockPortalQueue.add.mockResolvedValueOnce({ id: 'dctf-job-2' })

    await req('POST', `/portais/dctfweb/transmitir/${EMPRESA_ID}/${COMPETENCIA}`)

    const jobData = mockPortalQueue.add.mock.calls[0][1]
    expect(jobData.tenantId).toBe(TENANT_ID)
    expect(jobData.portal).toBe('DCTFWEB')
    expect(jobData.operacao).toBe('TRANSMITIR')
    expect(jobData.competencia).toBe(COMPETENCIA)
    expect(jobData.credencialId).toBe('cred-a1-2')
  })
})

// ===========================================================================
// GET /portais/dctfweb/consultar/:empresaId/:competencia
// ===========================================================================

describe('GET /portais/dctfweb/consultar/:empresaId/:competencia', () => {
  it('empresa + credencial OK → enfileira job de consulta → 202', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({
      id: EMPRESA_ID,
      cnpj: '12345678000195',
    })
    mockDb.credencial.findFirst.mockResolvedValueOnce({ id: 'cred-a1-3' })
    mockPortalQueue.add.mockResolvedValueOnce({ id: 'dctf-consulta-1' })

    const res = await req('GET', `/portais/dctfweb/consultar/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(202)
    const body = res.json()
    expect(body.status).toBe('AGUARDANDO')
    expect(body.jobId).toBe('dctf-consulta-1')
    expect(body.competencia).toBe(COMPETENCIA)
  })

  it('empresa não encontrada → 404', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(null)

    const res = await req('GET', `/portais/dctfweb/consultar/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(404)
    expect(mockPortalQueue.add).not.toHaveBeenCalled()
  })

  it('credencial A1 não encontrada → 422', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({
      id: EMPRESA_ID,
      cnpj: '12345678000195',
    })
    mockDb.credencial.findFirst.mockResolvedValueOnce(null)

    const res = await req('GET', `/portais/dctfweb/consultar/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(422)
    expect(res.json().error).toMatch(/certificado/i)
    expect(mockPortalQueue.add).not.toHaveBeenCalled()
  })

  it('job carrega portal DCTFWEB e operação CONSULTAR', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({
      id: EMPRESA_ID,
      cnpj: '12345678000195',
    })
    mockDb.credencial.findFirst.mockResolvedValueOnce({ id: 'cred-a1-4' })
    mockPortalQueue.add.mockResolvedValueOnce({ id: 'dctf-consulta-2' })

    await req('GET', `/portais/dctfweb/consultar/${EMPRESA_ID}/${COMPETENCIA}`)

    const jobData = mockPortalQueue.add.mock.calls[0][1]
    expect(jobData.tenantId).toBe(TENANT_ID)
    expect(jobData.portal).toBe('DCTFWEB')
    expect(jobData.operacao).toBe('CONSULTAR')
    expect(jobData.competencia).toBe(COMPETENCIA)
  })
})
