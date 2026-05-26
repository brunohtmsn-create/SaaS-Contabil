/**
 * Testes de integração — contabil.routes.ts
 *
 * Cobre:
 *  POST /contabil/lancamentos/:empresaId/:competencia — gera lançamentos
 *  GET  /contabil/lancamentos/:empresaId             — lista lançamentos
 *  POST /contabil/depreciacao/:empresaId/:comp       — calcula depreciação
 *  POST /contabil/ecd/:empresaId/:ano                — gera ECD
 *  POST /contabil/open-finance/sincronizar/:id       — sincroniza Open Finance
 *  POST /contabil/bancario/:empresaId/:comp          — conciliação bancária
 *  GET  /contabil/transacoes/status/:empresaId       — status de conciliação bancária
 *  GET  /contabil/transacoes/:empresaId              — lista transações bancárias
 *  GET  /contabil/bens/:empresaId                    — lista bens ativos
 *  POST /contabil/bens/:empresaId                    — cadastra bem ativo
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import jwt from '@fastify/jwt'
import { ZodError } from 'zod'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockLancamento = { gerarLancamentos: vi.fn() }
const mockDepreciacao = { calcular: vi.fn() }
const mockECD = { gerar: vi.fn() }
const mockOpenFinance = { sincronizarContas: vi.fn() }
const mockConciliacaoBancaria = { conciliar: vi.fn() }

vi.mock('@saas-contabil/contabil', () => ({
  LancamentoService: vi.fn(() => mockLancamento),
  DepreciacaoService: vi.fn(() => mockDepreciacao),
  ECDService: vi.fn(() => mockECD),
  OpenFinanceService: vi.fn(() => mockOpenFinance),
  ConciliacaoBancariaService: vi.fn(() => mockConciliacaoBancaria),
}))

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    lancamentoContabil: { findMany: vi.fn() },
    transacaoBancaria: { findMany: vi.fn(), count: vi.fn() },
    bemAtivo: { findMany: vi.fn(), create: vi.fn() },
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
  }
})

import { contabilRoutes } from '../routes/contabil.routes.js'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-contabil'
const USER_ID = 'user-contabil'
const EMPRESA_ID = '550e8400-e29b-41d4-a716-446655440004'
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

  await app.register(contabilRoutes, { prefix: '/contabil' })
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
// POST /contabil/lancamentos/:empresaId/:competencia
// ===========================================================================

describe('POST /contabil/lancamentos/:empresaId/:competencia', () => {
  it('gera lançamentos e retorna resultado → 200', async () => {
    const resultado = [{ id: 'lanc-1', historico: 'DAS Simples Nacional', valor: '1500.00' }]
    mockLancamento.gerarLancamentos.mockResolvedValueOnce(resultado)

    const res = await req('POST', `/contabil/lancamentos/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
    expect(mockLancamento.gerarLancamentos).toHaveBeenCalledWith(TENANT_ID, EMPRESA_ID, COMPETENCIA)
  })

  it('empresaId inválido → 400', async () => {
    const res = await req('POST', `/contabil/lancamentos/nao-uuid/${COMPETENCIA}`)
    expect(res.statusCode).toBe(400)
  })

  it('competencia inválida → 400', async () => {
    const res = await req('POST', `/contabil/lancamentos/${EMPRESA_ID}/2025`)
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// GET /contabil/lancamentos/:empresaId
// ===========================================================================

describe('GET /contabil/lancamentos/:empresaId', () => {
  it('lista lançamentos do tenant → 200', async () => {
    mockDb.lancamentoContabil.findMany.mockResolvedValueOnce([
      { id: 'lanc-1', historico: 'Receita NF-e', competencia: COMPETENCIA },
    ])

    const res = await req('GET', `/contabil/lancamentos/${EMPRESA_ID}`)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('filtra por tenantId (isolamento)', async () => {
    mockDb.lancamentoContabil.findMany.mockResolvedValueOnce([])

    await req('GET', `/contabil/lancamentos/${EMPRESA_ID}`)

    const { where } = mockDb.lancamentoContabil.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.empresaId).toBe(EMPRESA_ID)
  })

  it('com ?competencia= adiciona filtro', async () => {
    mockDb.lancamentoContabil.findMany.mockResolvedValueOnce([])

    await req('GET', `/contabil/lancamentos/${EMPRESA_ID}?competencia=${COMPETENCIA}`)

    const { where } = mockDb.lancamentoContabil.findMany.mock.calls[0][0]
    expect(where.competencia).toBe(COMPETENCIA)
  })
})

// ===========================================================================
// POST /contabil/depreciacao/:empresaId/:competencia
// ===========================================================================

describe('POST /contabil/depreciacao/:empresaId/:competencia', () => {
  it('calcula depreciação → 200 { success: true }', async () => {
    mockDepreciacao.calcular.mockResolvedValueOnce(undefined)

    const res = await req('POST', `/contabil/depreciacao/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
    expect(mockDepreciacao.calcular).toHaveBeenCalledWith(TENANT_ID, EMPRESA_ID, COMPETENCIA)
  })

  it('params inválidos → 400', async () => {
    const res = await req('POST', `/contabil/depreciacao/nao-uuid/2025`)
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// POST /contabil/ecd/:empresaId/:ano
// ===========================================================================

describe('POST /contabil/ecd/:empresaId/:ano', () => {
  it('gera ECD e retorna resultado → 200', async () => {
    mockECD.gerar.mockResolvedValueOnce({ s3Key: 'tenant/ecd/2025.txt', linhas: 500 })

    const res = await req('POST', `/contabil/ecd/${EMPRESA_ID}/2025`)

    expect(res.statusCode).toBe(200)
    expect(res.json().linhas).toBe(500)
    expect(mockECD.gerar).toHaveBeenCalledWith(TENANT_ID, EMPRESA_ID, 2025)
  })
})

// ===========================================================================
// POST /contabil/open-finance/sincronizar/:empresaId
// ===========================================================================

describe('POST /contabil/open-finance/sincronizar/:empresaId', () => {
  it('sincroniza e retorna success → 200', async () => {
    mockOpenFinance.sincronizarContas.mockResolvedValueOnce(undefined)

    const res = await req('POST', `/contabil/open-finance/sincronizar/${EMPRESA_ID}`)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true })
    expect(mockOpenFinance.sincronizarContas).toHaveBeenCalledWith(TENANT_ID, EMPRESA_ID)
  })
})

// ===========================================================================
// GET /contabil/transacoes/:empresaId
// ===========================================================================

describe('GET /contabil/transacoes/:empresaId', () => {
  it('lista transações do tenant → 200', async () => {
    mockDb.transacaoBancaria.findMany.mockResolvedValueOnce([
      { id: 'tx-1', valor: '500.00', data: new Date() },
    ])

    const res = await req('GET', `/contabil/transacoes/${EMPRESA_ID}`)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('filtra por tenantId e empresaId', async () => {
    mockDb.transacaoBancaria.findMany.mockResolvedValueOnce([])

    await req('GET', `/contabil/transacoes/${EMPRESA_ID}`)

    const { where } = mockDb.transacaoBancaria.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.empresaId).toBe(EMPRESA_ID)
  })

  it('com ?competencia= adiciona filtro de período', async () => {
    mockDb.transacaoBancaria.findMany.mockResolvedValueOnce([])

    await req('GET', `/contabil/transacoes/${EMPRESA_ID}?competencia=${COMPETENCIA}`)

    const { where } = mockDb.transacaoBancaria.findMany.mock.calls[0][0]
    expect(where.data).toBeDefined()
    expect(where.data.gte).toBeDefined()
    expect(where.data.lte).toBeDefined()
  })
})

// ===========================================================================
// GET /contabil/bens/:empresaId
// ===========================================================================

describe('GET /contabil/bens/:empresaId', () => {
  it('lista bens ativos → 200', async () => {
    mockDb.bemAtivo.findMany.mockResolvedValueOnce([
      { id: 'bem-1', descricao: 'Veículo', status: 'ATIVO' },
    ])

    const res = await req('GET', `/contabil/bens/${EMPRESA_ID}`)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('filtra por tenantId e empresaId', async () => {
    mockDb.bemAtivo.findMany.mockResolvedValueOnce([])

    await req('GET', `/contabil/bens/${EMPRESA_ID}`)

    const { where } = mockDb.bemAtivo.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.empresaId).toBe(EMPRESA_ID)
  })
})

// ===========================================================================
// POST /contabil/bens/:empresaId
// ===========================================================================

describe('POST /contabil/bens/:empresaId', () => {
  it('cadastra bem ativo → 201', async () => {
    mockDb.bemAtivo.create.mockResolvedValueOnce({
      id: 'bem-new',
      descricao: 'Computador',
      status: 'ATIVO',
      tenantId: TENANT_ID,
    })

    const res = await req('POST', `/contabil/bens/${EMPRESA_ID}`, {
      descricao: 'Computador',
      dataAquisicao: '2025-01-15',
      valorAquisicao: 5000,
      vidaUtil: 60,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().descricao).toBe('Computador')
  })

  it('create inclui tenantId do JWT', async () => {
    mockDb.bemAtivo.create.mockResolvedValueOnce({ id: 'bem-t', tenantId: TENANT_ID })

    await req('POST', `/contabil/bens/${EMPRESA_ID}`, {
      descricao: 'Mesa',
      dataAquisicao: '2025-01-15',
      valorAquisicao: 800,
      vidaUtil: 60,
    })

    const data = mockDb.bemAtivo.create.mock.calls[0][0].data
    expect(data.tenantId).toBe(TENANT_ID)
    expect(data.empresaId).toBe(EMPRESA_ID)
  })

  it('sem campo obrigatório (descricao) → 400', async () => {
    const res = await req('POST', `/contabil/bens/${EMPRESA_ID}`, {
      dataAquisicao: '2025-01-15',
      valorAquisicao: 5000,
      vidaUtil: 60,
    })

    expect(res.statusCode).toBe(400)
    expect(mockDb.bemAtivo.create).not.toHaveBeenCalled()
  })

  it('vidaUtil não inteiro → 400', async () => {
    const res = await req('POST', `/contabil/bens/${EMPRESA_ID}`, {
      descricao: 'Notebook',
      dataAquisicao: '2025-01-15',
      valorAquisicao: 4000,
      vidaUtil: 12.5,
    })

    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// POST /contabil/bancario/:empresaId/:competencia
// ===========================================================================

describe('POST /contabil/bancario/:empresaId/:competencia', () => {
  it('chama ConciliacaoBancariaService.conciliar e retorna success → 200', async () => {
    mockConciliacaoBancaria.conciliar.mockResolvedValueOnce(undefined)

    const res = await req('POST', `/contabil/bancario/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true })
    expect(mockConciliacaoBancaria.conciliar).toHaveBeenCalledWith(
      TENANT_ID,
      EMPRESA_ID,
      COMPETENCIA
    )
  })

  it('usa tenantId do JWT, não do body', async () => {
    mockConciliacaoBancaria.conciliar.mockResolvedValueOnce(undefined)

    await req('POST', `/contabil/bancario/${EMPRESA_ID}/${COMPETENCIA}`)

    const [tenantArg] = mockConciliacaoBancaria.conciliar.mock.calls[0]
    expect(tenantArg).toBe(TENANT_ID)
  })

  it('competencia inválida → 400', async () => {
    const res = await req('POST', `/contabil/bancario/${EMPRESA_ID}/25-5`)

    expect(res.statusCode).toBe(400)
    expect(mockConciliacaoBancaria.conciliar).not.toHaveBeenCalled()
  })

  it('empresaId sem UUID → 400', async () => {
    const res = await req('POST', `/contabil/bancario/nao-uuid/${COMPETENCIA}`)

    expect(res.statusCode).toBe(400)
    expect(mockConciliacaoBancaria.conciliar).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// GET /contabil/transacoes/status/:empresaId
// ===========================================================================

describe('GET /contabil/transacoes/status/:empresaId', () => {
  it('retorna contagens total, conciliadas, naoConciliadas → 200', async () => {
    mockDb.transacaoBancaria.count
      .mockResolvedValueOnce(10) // total
      .mockResolvedValueOnce(7) // conciliadas
      .mockResolvedValueOnce(3) // naoConciliadas

    const res = await req(
      'GET',
      `/contabil/transacoes/status/${EMPRESA_ID}?competencia=${COMPETENCIA}`
    )

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ total: 10, conciliadas: 7, naoConciliadas: 3 })
  })

  it('usa tenantId do JWT nas queries de count', async () => {
    mockDb.transacaoBancaria.count.mockResolvedValue(0)

    await req('GET', `/contabil/transacoes/status/${EMPRESA_ID}`)

    for (const call of mockDb.transacaoBancaria.count.mock.calls) {
      expect(call[0].where.tenantId).toBe(TENANT_ID)
      expect(call[0].where.empresaId).toBe(EMPRESA_ID)
    }
  })

  it('sem competencia → busca sem filtro de data', async () => {
    mockDb.transacaoBancaria.count.mockResolvedValue(5)

    const res = await req('GET', `/contabil/transacoes/status/${EMPRESA_ID}`)

    expect(res.statusCode).toBe(200)
  })
})
