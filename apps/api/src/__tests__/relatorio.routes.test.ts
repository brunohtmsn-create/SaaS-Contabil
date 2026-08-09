/**
 * Testes de integração — relatorio.routes.ts
 *
 * Cobre:
 *  POST  /relatorios/consolidado/:competencia         — enfileira geração do relatório
 *  GET   /relatorios/consolidado/:competencia         — URL de download (404 se não gerado)
 *  GET   /relatorios/competencias                     — lista competências com apurações
 *  POST  /relatorios/empresa/:empresaId/:competencia  — relatório individual de empresa
 *  GET   /relatorios/empresa/:empresaId/:competencia  — URL do relatório individual
 *  GET   /relatorios/obrigacoes-vencendo              — obrigações vencendo em N dias
 *  GET   /relatorios/historico                        — lista registros de relatórios
 *  PATCH /relatorios/historico/:id/lido               — marca relatório como lido
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

vi.mock('@saas-contabil/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@saas-contabil/shared')>()
  return {
    ...actual,
    nowBR: vi.fn(() => new Date('2025-06-15T12:00:00Z')),
    addDays: vi.fn((date: Date, n: number) => {
      const d = new Date(date)
      d.setDate(d.getDate() + n)
      return d
    }),
  }
})

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    alerta: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    apuracaoFiscal: { groupBy: vi.fn() },
    empresaCliente: { findFirst: vi.fn() },
    obrigacao: { findMany: vi.fn() },
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

  it('?limit=0 cai no fallback 12 (0 é falsy)', async () => {
    mockDb.alerta.findMany.mockResolvedValueOnce([])

    await req('GET', '/relatorios/historico?limit=0')

    const { take } = mockDb.alerta.findMany.mock.calls[0][0]
    expect(take).toBe(12)
  })

  it('?limit=abc (NaN) cai no fallback 12', async () => {
    mockDb.alerta.findMany.mockResolvedValueOnce([])

    await req('GET', '/relatorios/historico?limit=abc')

    const { take } = mockDb.alerta.findMany.mock.calls[0][0]
    expect(take).toBe(12)
  })

  it('?limit=-5 (negativo) é clamped para 1 pelo Math.max', async () => {
    mockDb.alerta.findMany.mockResolvedValueOnce([])

    await req('GET', '/relatorios/historico?limit=-5')

    const { take } = mockDb.alerta.findMany.mock.calls[0][0]
    expect(take).toBe(1)
  })

  it('ordenado por criadoEm descendente', async () => {
    mockDb.alerta.findMany.mockResolvedValueOnce([])

    await req('GET', '/relatorios/historico')

    const { orderBy } = mockDb.alerta.findMany.mock.calls[0][0]
    expect(orderBy).toEqual({ criadoEm: 'desc' })
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

  it('update seta lido=true no alerta', async () => {
    mockDb.alerta.findFirst.mockResolvedValueOnce({ id: 'rel-lido-upd', tenantId: TENANT_ID })
    mockDb.alerta.update.mockResolvedValueOnce({})

    await req('PATCH', '/relatorios/historico/rel-lido-upd/lido')

    const updateCall = mockDb.alerta.update.mock.calls[0][0]
    expect(updateCall.data.lido).toBe(true)
    expect(updateCall.where.id).toBe('rel-lido-upd')
    expect(updateCall.where.tenantId).toBe(TENANT_ID)
  })
})

// ===========================================================================
// GET /relatorios/competencias
// ===========================================================================

describe('GET /relatorios/competencias', () => {
  it('retorna lista de competências em ordem descendente → 200', async () => {
    mockDb.apuracaoFiscal.groupBy.mockResolvedValueOnce([
      { competencia: '2025-06' },
      { competencia: '2025-05' },
      { competencia: '2025-04' },
    ])

    const res = await req('GET', '/relatorios/competencias')

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toEqual(['2025-06', '2025-05', '2025-04'])
  })

  it('filtra por tenantId (isolamento)', async () => {
    mockDb.apuracaoFiscal.groupBy.mockResolvedValueOnce([])

    await req('GET', '/relatorios/competencias')

    const { where } = mockDb.apuracaoFiscal.groupBy.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
  })

  it('padrão de 24 competências', async () => {
    mockDb.apuracaoFiscal.groupBy.mockResolvedValueOnce([])

    await req('GET', '/relatorios/competencias')

    const { take } = mockDb.apuracaoFiscal.groupBy.mock.calls[0][0]
    expect(take).toBe(24)
  })

  it('?limit=6 usa 6', async () => {
    mockDb.apuracaoFiscal.groupBy.mockResolvedValueOnce([])

    await req('GET', '/relatorios/competencias?limit=6')

    const { take } = mockDb.apuracaoFiscal.groupBy.mock.calls[0][0]
    expect(take).toBe(6)
  })

  it('?limit=999 é clamped em 60', async () => {
    mockDb.apuracaoFiscal.groupBy.mockResolvedValueOnce([])

    await req('GET', '/relatorios/competencias?limit=999')

    const { take } = mockDb.apuracaoFiscal.groupBy.mock.calls[0][0]
    expect(take).toBe(60)
  })
})

// ===========================================================================
// POST /relatorios/empresa/:empresaId/:competencia
// ===========================================================================

describe('POST /relatorios/empresa/:empresaId/:competencia', () => {
  const EMPRESA_ID = 'a0000000-0000-0000-0000-000000000001'
  const COMPETENCIA = '2025-05'

  it('empresa encontrada → enfileira job e retorna 200', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({ id: EMPRESA_ID })
    mockRelQueue.add.mockResolvedValueOnce({ id: 'emp-job-1' })

    const res = await req('POST', `/relatorios/empresa/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe('emp-job-1')
    expect(body.status).toBe('AGUARDANDO')
    expect(body.empresaId).toBe(EMPRESA_ID)
    expect(body.competencia).toBe(COMPETENCIA)
  })

  it('empresa não encontrada → 404', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(null)

    const res = await req('POST', `/relatorios/empresa/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(404)
    expect(mockRelQueue.add).not.toHaveBeenCalled()
  })

  it('empresaId inválido (não UUID) → 400', async () => {
    const res = await req('POST', `/relatorios/empresa/nao-uuid/${COMPETENCIA}`)
    expect(res.statusCode).toBe(400)
    expect(mockDb.empresaCliente.findFirst).not.toHaveBeenCalled()
  })

  it('competencia inválida → 400', async () => {
    const res = await req('POST', `/relatorios/empresa/${EMPRESA_ID}/202505`)
    expect(res.statusCode).toBe(400)
  })

  it('findFirst filtra por tenantId e empresaId (isolamento)', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(null)

    await req('POST', `/relatorios/empresa/${EMPRESA_ID}/${COMPETENCIA}`)

    const { where } = mockDb.empresaCliente.findFirst.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.id).toBe(EMPRESA_ID)
  })

  it('job contém tenantId, empresaId e competencia corretos', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({ id: EMPRESA_ID })
    mockRelQueue.add.mockResolvedValueOnce({ id: 'emp-job-2' })

    await req('POST', `/relatorios/empresa/${EMPRESA_ID}/${COMPETENCIA}`)

    const jobData = mockRelQueue.add.mock.calls[0][1]
    expect(jobData.tenantId).toBe(TENANT_ID)
    expect(jobData.empresaId).toBe(EMPRESA_ID)
    expect(jobData.competencia).toBe(COMPETENCIA)
  })
})

// ===========================================================================
// GET /relatorios/empresa/:empresaId/:competencia
// ===========================================================================

describe('GET /relatorios/empresa/:empresaId/:competencia', () => {
  const EMPRESA_ID = 'a0000000-0000-0000-0000-000000000002'
  const COMPETENCIA = '2025-04'

  it('relatório existente no S3 → 200 com URL', async () => {
    mockStorage.exists.mockResolvedValueOnce(true)
    mockStorage.getSignedUrl.mockResolvedValueOnce('https://s3.example.com/empresa.csv')

    const res = await req('GET', `/relatorios/empresa/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.url).toContain('s3.example.com')
    expect(body.empresaId).toBe(EMPRESA_ID)
    expect(body.competencia).toBe(COMPETENCIA)
    expect(body.validade).toBeDefined()
  })

  it('relatório não gerado → 404', async () => {
    mockStorage.exists.mockResolvedValueOnce(false)

    const res = await req('GET', `/relatorios/empresa/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(404)
    expect(res.json().error).toMatch(/gere-o primeiro/i)
  })

  it('empresaId inválido → 400', async () => {
    const res = await req('GET', `/relatorios/empresa/nao-uuid/${COMPETENCIA}`)
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// GET /relatorios/obrigacoes-vencendo
// ===========================================================================

describe('GET /relatorios/obrigacoes-vencendo', () => {
  it('retorna obrigações vencendo nos próximos 7 dias → 200', async () => {
    const obrigacoes = [
      {
        id: 'obr-1',
        tipo: 'DAS',
        competencia: '2025-05',
        vencimento: new Date('2025-06-20'),
        valor: '150.00',
        empresa: { razaoSocial: 'Empresa X', cnpj: '12345678000100' },
      },
    ]
    mockDb.obrigacao.findMany.mockResolvedValueOnce(obrigacoes)

    const res = await req('GET', '/relatorios/obrigacoes-vencendo')

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(1)
    expect(body.obrigacoes).toHaveLength(1)
    expect(body.obrigacoes[0].tipo).toBe('DAS')
    expect(body.obrigacoes[0].empresa.razaoSocial).toBe('Empresa X')
    expect(body.periodo).toHaveProperty('de')
    expect(body.periodo).toHaveProperty('ate')
  })

  it('filtra por tenantId e status PENDENTE (isolamento)', async () => {
    mockDb.obrigacao.findMany.mockResolvedValueOnce([])

    await req('GET', '/relatorios/obrigacoes-vencendo')

    const { where } = mockDb.obrigacao.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.status).toBe('PENDENTE')
  })

  it('?dias=14 consulta próximos 14 dias', async () => {
    mockDb.obrigacao.findMany.mockResolvedValueOnce([])

    await req('GET', '/relatorios/obrigacoes-vencendo?dias=14')

    const { where } = mockDb.obrigacao.findMany.mock.calls[0][0]
    expect(where.vencimento.gte).toBeDefined()
    expect(where.vencimento.lte).toBeDefined()
  })

  it('?dias=0 usa fallback 1', async () => {
    mockDb.obrigacao.findMany.mockResolvedValueOnce([])

    await req('GET', '/relatorios/obrigacoes-vencendo?dias=0')

    const { where } = mockDb.obrigacao.findMany.mock.calls[0][0]
    expect(where.vencimento).toBeDefined()
  })

  it('?dias=999 é clamped em 90', async () => {
    mockDb.obrigacao.findMany.mockResolvedValueOnce([])

    await req('GET', '/relatorios/obrigacoes-vencendo?dias=999')

    expect(mockDb.obrigacao.findMany).toHaveBeenCalledTimes(1)
    const { where } = mockDb.obrigacao.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
  })

  it('nenhuma obrigação vencendo → retorna lista vazia com total=0', async () => {
    mockDb.obrigacao.findMany.mockResolvedValueOnce([])

    const res = await req('GET', '/relatorios/obrigacoes-vencendo')

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(0)
    expect(body.obrigacoes).toEqual([])
  })

  it('ordenado por vencimento ascendente', async () => {
    mockDb.obrigacao.findMany.mockResolvedValueOnce([])

    await req('GET', '/relatorios/obrigacoes-vencendo')

    const { orderBy } = mockDb.obrigacao.findMany.mock.calls[0][0]
    expect(orderBy).toEqual({ vencimento: 'asc' })
  })
})
