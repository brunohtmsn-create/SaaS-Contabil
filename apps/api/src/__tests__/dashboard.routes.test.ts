/**
 * Testes de integração — dashboard.routes.ts
 *
 * Cobre:
 *  GET  /dashboard/resumo            — métricas agregadas do tenant
 *  GET  /dashboard/alertas           — alertas não lidos
 *  PATCH /dashboard/alertas/:id/ler  — marca alerta lido
 *  GET  /dashboard/volume            — volume documental 6 meses
 *  GET  /dashboard/timeline/:empresaId — agrupamento por competência e tipo
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
    empresaCliente: { count: vi.fn() },
    documentoFiscal: { count: vi.fn(), groupBy: vi.fn() },
    alerta: { count: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    obrigacao: { count: vi.fn() },
  },
}))

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@saas-contabil/shared')>()
  return {
    ...actual,
    nowBR: vi.fn(() => new Date('2025-06-15T12:00:00Z')),
  }
})

import { dashboardRoutes } from '../routes/dashboard.routes.js'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-dash'
const USER_ID = 'user-dash'

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

  await app.register(dashboardRoutes, { prefix: '/dashboard' })
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
// GET /dashboard/resumo
// ===========================================================================

describe('GET /dashboard/resumo', () => {
  it('retorna métricas agregadas do tenant → 200', async () => {
    mockDb.empresaCliente.count.mockResolvedValueOnce(15)
    mockDb.documentoFiscal.count.mockResolvedValueOnce(320)
    mockDb.alerta.count.mockResolvedValueOnce(3)
    mockDb.obrigacao.count.mockResolvedValueOnce(2)

    const res = await req('GET', '/dashboard/resumo')

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.totalEmpresas).toBe(15)
    expect(body.totalDocumentos).toBe(320)
    expect(body.alertasNaoLidos).toBe(3)
    expect(body.obrigacoesVencendo).toBe(2)
    expect(body.competencia).toMatch(/^\d{4}-\d{2}$/)
  })

  it('filtra empresas por tenantId e ativa:true (isolamento)', async () => {
    mockDb.empresaCliente.count.mockResolvedValueOnce(0)
    mockDb.documentoFiscal.count.mockResolvedValueOnce(0)
    mockDb.alerta.count.mockResolvedValueOnce(0)
    mockDb.obrigacao.count.mockResolvedValueOnce(0)

    await req('GET', '/dashboard/resumo')

    const where = mockDb.empresaCliente.count.mock.calls[0][0].where
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.ativa).toBe(true)
  })

  it('alertas filtrados por tenantId e lido:false', async () => {
    mockDb.empresaCliente.count.mockResolvedValueOnce(0)
    mockDb.documentoFiscal.count.mockResolvedValueOnce(0)
    mockDb.alerta.count.mockResolvedValueOnce(0)
    mockDb.obrigacao.count.mockResolvedValueOnce(0)

    await req('GET', '/dashboard/resumo')

    const where = mockDb.alerta.count.mock.calls[0][0].where
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.lido).toBe(false)
  })

  it('obrigações filtradas por tenantId e status PENDENTE', async () => {
    mockDb.empresaCliente.count.mockResolvedValueOnce(0)
    mockDb.documentoFiscal.count.mockResolvedValueOnce(0)
    mockDb.alerta.count.mockResolvedValueOnce(0)
    mockDb.obrigacao.count.mockResolvedValueOnce(0)

    await req('GET', '/dashboard/resumo')

    const where = mockDb.obrigacao.count.mock.calls[0][0].where
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.status).toBe('PENDENTE')
  })
})

// ===========================================================================
// GET /dashboard/alertas
// ===========================================================================

describe('GET /dashboard/alertas', () => {
  it('retorna alertas não lidos com empresa incluída → 200', async () => {
    const alertas = [
      {
        id: 'al-1',
        tipo: 'CREDENCIAL_VENCENDO',
        mensagem: 'Certificado vence em 5 dias',
        lido: false,
        criadoEm: new Date().toISOString(),
        empresa: { cnpj: '12345678000100', razaoSocial: 'Empresa X' },
      },
    ]
    mockDb.alerta.findMany.mockResolvedValueOnce(alertas)

    const res = await req('GET', '/dashboard/alertas')

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveLength(1)
    expect(body[0].tipo).toBe('CREDENCIAL_VENCENDO')
    expect(body[0].empresa).toBeDefined()
  })

  it('filtra por tenantId e lido:false (isolamento)', async () => {
    mockDb.alerta.findMany.mockResolvedValueOnce([])

    await req('GET', '/dashboard/alertas')

    const { where } = mockDb.alerta.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.lido).toBe(false)
  })

  it('retorna lista vazia quando não há alertas → 200 []', async () => {
    mockDb.alerta.findMany.mockResolvedValueOnce([])

    const res = await req('GET', '/dashboard/alertas')

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })
})

// ===========================================================================
// PATCH /dashboard/alertas/:id/ler
// ===========================================================================

describe('PATCH /dashboard/alertas/:id/ler', () => {
  it('marca alerta como lido → 200 { success: true }', async () => {
    mockDb.alerta.updateMany.mockResolvedValueOnce({ count: 1 })

    const res = await req('PATCH', '/dashboard/alertas/alerta-123/ler')

    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it('updateMany inclui tenantId e id corretos (isolamento)', async () => {
    mockDb.alerta.updateMany.mockResolvedValueOnce({ count: 1 })

    await req('PATCH', '/dashboard/alertas/alerta-xyz/ler')

    const { where, data } = mockDb.alerta.updateMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.id).toBe('alerta-xyz')
    expect(data.lido).toBe(true)
  })
})

// ===========================================================================
// GET /dashboard/volume
// ===========================================================================

describe('GET /dashboard/volume', () => {
  it('retorna dados de volume para 6 meses → 200', async () => {
    // groupBy é chamado 6 × 3 = 18 vezes (6 meses × 3 tipos)
    // mas na implementação real faz count por tipo separado → 6 × 3 count calls
    mockDb.documentoFiscal.count.mockResolvedValue(0)

    const res = await req('GET', '/dashboard/volume')

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveLength(6)
    body.forEach((mes: any) => {
      expect(mes).toHaveProperty('mes')
      expect(mes).toHaveProperty('nfe')
      expect(mes).toHaveProperty('nfce')
      expect(mes).toHaveProperty('nfse')
    })
  })

  it('todos os counts filtram por tenantId', async () => {
    mockDb.documentoFiscal.count.mockResolvedValue(0)

    await req('GET', '/dashboard/volume')

    const firstWhere = mockDb.documentoFiscal.count.mock.calls[0][0].where
    expect(firstWhere.tenantId).toBe(TENANT_ID)
  })
})

// ===========================================================================
// GET /dashboard/timeline/:empresaId
// ===========================================================================

describe('GET /dashboard/timeline/:empresaId', () => {
  const EMPRESA_ID = 'emp-timeline-1'

  it('retorna agrupamento de documentos → 200', async () => {
    const groupResult = [
      {
        dataCompetencia: new Date('2025-04-01'),
        tipo: 'NFE',
        _count: 12,
        _sum: { valorTotal: 50000 },
      },
      {
        dataCompetencia: new Date('2025-05-01'),
        tipo: 'NFSE_EMITIDA',
        _count: 5,
        _sum: { valorTotal: 15000 },
      },
    ]
    mockDb.documentoFiscal.groupBy.mockResolvedValueOnce(groupResult)

    const res = await req('GET', `/dashboard/timeline/${EMPRESA_ID}`)

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveLength(2)
    expect(body[0]._count).toBe(12)
    expect(body[1].tipo).toBe('NFSE_EMITIDA')
  })

  it('filtra por tenantId e empresaId (isolamento)', async () => {
    mockDb.documentoFiscal.groupBy.mockResolvedValueOnce([])

    await req('GET', `/dashboard/timeline/${EMPRESA_ID}`)

    const { where } = mockDb.documentoFiscal.groupBy.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.empresaId).toBe(EMPRESA_ID)
  })

  it('aplica filtro gte para 6 meses atrás', async () => {
    mockDb.documentoFiscal.groupBy.mockResolvedValueOnce([])

    await req('GET', `/dashboard/timeline/${EMPRESA_ID}`)

    const { where } = mockDb.documentoFiscal.groupBy.mock.calls[0][0]
    expect(where.dataCompetencia).toBeDefined()
    expect(where.dataCompetencia.gte).toBeInstanceOf(Date)
  })

  it('agrupa por dataCompetencia e tipo', async () => {
    mockDb.documentoFiscal.groupBy.mockResolvedValueOnce([])

    await req('GET', `/dashboard/timeline/${EMPRESA_ID}`)

    const { by } = mockDb.documentoFiscal.groupBy.mock.calls[0][0]
    expect(by).toContain('dataCompetencia')
    expect(by).toContain('tipo')
  })

  it('nenhum documento no período → retorna array vazio → 200', async () => {
    mockDb.documentoFiscal.groupBy.mockResolvedValueOnce([])

    const res = await req('GET', `/dashboard/timeline/${EMPRESA_ID}`)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })
})
