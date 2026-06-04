/**
 * Testes de integração — fiscal.routes.ts (rotas não cobertas)
 *
 * Cobre:
 *  POST /fiscal/difal/:id/:comp — chama DifalService.calcular
 *  POST /fiscal/gnre/:id/:comp — chama GNREService.gerar
 *  POST /fiscal/destda/:id/:comp — chama DeSTDAService.gerar
 *  GET  /fiscal/apuracoes/:empresaId — filtra por tenantId + empresaId
 *  GET  /fiscal/obrigacoes/:empresaId — filtra por tenantId + empresaId
 *  GET  /fiscal/sped-contribuicoes/:id/:comp — 200 com dados / 404 se ausente
 *  GET  /fiscal/creditos-pis-cofins-lr/:id/:comp — 200 / 404
 *  POST /fiscal/dctfweb/:id/:comp — chama DCTFWebService.gerar
 *  POST /fiscal/monitoramento/calendario/:id — chama MonitoramentoSNService
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import jwt from '@fastify/jwt'
import { ZodError } from 'zod'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDifal = { calcular: vi.fn() }
const mockGNRE = { gerar: vi.fn() }
const mockDeSTDA = { gerar: vi.fn() }
const mockDCTFWeb = { gerar: vi.fn() }
const mockMonitoramento = {
  gerarCalendarioAnual: vi.fn(),
  verificarRiscoExclusao: vi.fn(),
  verificarVencimentos: vi.fn(),
}

vi.mock('@saas-contabil/fiscal', () => ({
  PGDASService: vi.fn(() => ({ apurar: vi.fn() })),
  DifalService: vi.fn(() => mockDifal),
  GNREService: vi.fn(() => mockGNRE),
  DeSTDAService: vi.fn(() => mockDeSTDA),
  DCTFWebService: vi.fn(() => mockDCTFWeb),
  ESocialService: vi.fn(() => ({ processar: vi.fn() })),
  MonitoramentoSNService: vi.fn(() => mockMonitoramento),
  FatorRService: vi.fn(() => ({ calcular: vi.fn() })),
  FGTSDigitalService: vi.fn(() => ({ apurar: vi.fn(), gerarGRRF: vi.fn() })),
  EFDReinfService: vi.fn(() => ({ processar: vi.fn() })),
  DMSService: vi.fn(() => ({ apurar: vi.fn() })),
  DasnService: vi.fn(() => ({ gerar: vi.fn() })),
  CalendarioLPLRService: vi.fn(() => ({ gerarCalendarioAnual: vi.fn() })),
  IrpjCsllLPService: vi.fn(() => ({ apurar: vi.fn() })),
  PisCofinsLPService: vi.fn(() => ({ apurar: vi.fn() })),
  ECFService: vi.fn(() => ({ gerar: vi.fn() })),
  DCTFMensalService: vi.fn(() => ({ gerar: vi.fn() })),
  SpedFiscalService: vi.fn(() => ({ gerar: vi.fn() })),
  SpedContribuicoesService: vi.fn(() => ({ gerar: vi.fn() })),
  IrpjCsllLRService: vi.fn(() => ({ apurar: vi.fn() })),
  CreditosPisCofinsLRService: vi.fn(() => ({ apurar: vi.fn() })),
  RetencoesNaFonteService: vi.fn(() => ({ apurar: vi.fn() })),
  IrpjCsllLREstimativaService: vi.fn(() => ({ apurar: vi.fn() })),
  PrejuizosFiscaisLRService: vi.fn(() => ({ registrarPrejuizo: vi.fn(), compensar: vi.fn() })),
  DepreciacaoLRService: vi.fn(() => ({
    apurar: vi.fn(),
    getCategorias: vi.fn(() => []),
    getTaxaDepreciacao: vi.fn(() => ({})),
  })),
  INSSPatronalService: vi.fn(() => ({ calcular: vi.fn() })),
  AjusteAnualLRService: vi.fn(() => ({ apurar: vi.fn() })),
  LALURService: vi.fn(() => ({ apurar: vi.fn() })),
  SimuladorTributarioService: vi.fn(() => ({ simular: vi.fn() })),
  PlanejamentoTributarioService: vi.fn(() => ({ analisar: vi.fn() })),
  DiagnosticoFiscalService: vi.fn(() => ({ diagnosticar: vi.fn() })),
  RelatorioFiscalService: vi.fn(() => ({ gerar: vi.fn() })),
}))

const { mockDb, mockQueue } = vi.hoisted(() => ({
  mockDb: {
    apuracaoFiscal: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    documentoFiscal: { count: vi.fn().mockResolvedValue(0) },
    obrigacao: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    empresaCliente: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    alerta: { findMany: vi.fn() },
  },
  mockQueue: { add: vi.fn().mockResolvedValue({ id: 'job-x' }) },
}))

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('bullmq', () => ({
  Queue: vi.fn(() => mockQueue),
}))

vi.mock('ioredis', () => ({
  Redis: vi.fn(() => ({})),
}))

vi.mock('@saas-contabil/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@saas-contabil/shared')>()
  return { ...actual, nowBR: vi.fn(() => new Date('2025-06-01T12:00:00Z')) }
})

import { fiscalRoutes } from '../routes/fiscal.routes.js'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-extra'
const EMPRESA_ID = '550e8400-e29b-41d4-a716-446655440001'
const COMPETENCIA = '2025-05'

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify({ logger: false })
  await app.register(jwt, { secret: 'test-secret-key-32-chars-minimum!!' })

  app.addHook('onRequest', async (request) => {
    if (request.headers['x-test-skip-auth'] === '1') {
      ;(request as any).user = { sub: 'user-extra', tenantId: TENANT_ID, perfil: 'CONTADOR' }
    }
  })

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'Dados inválidos', detalhes: error.errors })
    }
    const statusCode = error.statusCode ?? 500
    return reply.code(statusCode).send({ error: error.message ?? 'Erro interno' })
  })

  await app.register(fiscalRoutes, { prefix: '/fiscal' })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  vi.clearAllMocks()
  mockQueue.add.mockResolvedValue({ id: 'job-x' })
  mockDb.documentoFiscal.count.mockResolvedValue(0)
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
// POST /fiscal/difal
// ===========================================================================

describe('POST /fiscal/difal/:empresaId/:competencia', () => {
  it('chama DifalService.calcular com tenantId, empresaId e competencia', async () => {
    mockDifal.calcular.mockResolvedValueOnce({ valorDifal: '100.00' })

    await req('POST', `/fiscal/difal/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(mockDifal.calcular).toHaveBeenCalledWith(TENANT_ID, EMPRESA_ID, COMPETENCIA)
  })

  it('retorna resultado do DifalService', async () => {
    const resultado = { valorDifal: '150.00', ufDestino: 'RJ' }
    mockDifal.calcular.mockResolvedValueOnce(resultado)

    const res = await req('POST', `/fiscal/difal/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.valorDifal).toBe('150.00')
  })

  it('empresaId não-UUID → 400', async () => {
    const res = await req('POST', `/fiscal/difal/nao-uuid/${COMPETENCIA}`)
    expect(res.statusCode).toBe(400)
  })

  it('competencia com formato inválido → 400', async () => {
    const res = await req('POST', `/fiscal/difal/${EMPRESA_ID}/2025-AB`)
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// POST /fiscal/gnre
// ===========================================================================

describe('POST /fiscal/gnre/:empresaId/:competencia', () => {
  it('chama GNREService.gerar com tenantId, empresaId e competencia', async () => {
    mockGNRE.gerar.mockResolvedValueOnce([])

    await req('POST', `/fiscal/gnre/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(mockGNRE.gerar).toHaveBeenCalledWith(TENANT_ID, EMPRESA_ID, COMPETENCIA)
  })

  it('retorna resultado do GNREService', async () => {
    const resultado = [{ uf: 'SP', valor: '200.00' }]
    mockGNRE.gerar.mockResolvedValueOnce(resultado)

    const res = await req('POST', `/fiscal/gnre/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload)).toHaveLength(1)
  })

  it('empresaId não-UUID → 400', async () => {
    const res = await req('POST', `/fiscal/gnre/nao-uuid/${COMPETENCIA}`)
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// POST /fiscal/destda
// ===========================================================================

describe('POST /fiscal/destda/:empresaId/:competencia', () => {
  it('chama DeSTDAService.gerar com tenantId, empresaId e competencia', async () => {
    mockDeSTDA.gerar.mockResolvedValueOnce('|0000|...')

    await req('POST', `/fiscal/destda/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(mockDeSTDA.gerar).toHaveBeenCalledWith(TENANT_ID, EMPRESA_ID, COMPETENCIA)
  })

  it('retorna conteúdo do DeSTDA', async () => {
    mockDeSTDA.gerar.mockResolvedValueOnce('|0000|DESTDA_CONTENT|')

    const res = await req('POST', `/fiscal/destda/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
  })

  it('empresaId não-UUID → 400', async () => {
    const res = await req('POST', `/fiscal/destda/nao-uuid/${COMPETENCIA}`)
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// GET /fiscal/apuracoes/:empresaId
// ===========================================================================

describe('GET /fiscal/apuracoes/:empresaId', () => {
  it('retorna apurações filtradas por tenantId e empresaId', async () => {
    const apuracoes = [
      { id: 'ap-1', tipo: 'PGDAS' },
      { id: 'ap-2', tipo: 'DIFAL' },
    ]
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce(apuracoes)

    const res = await req('GET', `/fiscal/apuracoes/${EMPRESA_ID}`)

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload)).toHaveLength(2)
  })

  it('passa tenantId e empresaId corretos para findMany', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([])

    await req('GET', `/fiscal/apuracoes/${EMPRESA_ID}`)

    const { where } = mockDb.apuracaoFiscal.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.empresaId).toBe(EMPRESA_ID)
  })

  it('query param competencia → incluído no filtro', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([])

    await req('GET', `/fiscal/apuracoes/${EMPRESA_ID}?competencia=2025-03`)

    const { where } = mockDb.apuracaoFiscal.findMany.mock.calls[0][0]
    expect(where.competencia).toBe('2025-03')
  })

  it('sem query param → sem filtro de competencia', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([])

    await req('GET', `/fiscal/apuracoes/${EMPRESA_ID}`)

    const { where } = mockDb.apuracaoFiscal.findMany.mock.calls[0][0]
    expect(where.competencia).toBeUndefined()
  })
})

// ===========================================================================
// GET /fiscal/obrigacoes/:empresaId
// ===========================================================================

describe('GET /fiscal/obrigacoes/:empresaId', () => {
  it('retorna obrigações filtradas por tenantId e empresaId', async () => {
    const obrigacoes = [{ id: 'ob-1', tipo: 'DAS' }]
    mockDb.obrigacao.findMany.mockResolvedValueOnce(obrigacoes)

    const res = await req('GET', `/fiscal/obrigacoes/${EMPRESA_ID}`)

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload)).toHaveLength(1)
  })

  it('passa tenantId e empresaId corretos', async () => {
    mockDb.obrigacao.findMany.mockResolvedValueOnce([])

    await req('GET', `/fiscal/obrigacoes/${EMPRESA_ID}`)

    const { where } = mockDb.obrigacao.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.empresaId).toBe(EMPRESA_ID)
  })

  it('query param mes → aplica filtro de vencimento', async () => {
    mockDb.obrigacao.findMany.mockResolvedValueOnce([])

    await req('GET', `/fiscal/obrigacoes/${EMPRESA_ID}?mes=2025-05`)

    const { where } = mockDb.obrigacao.findMany.mock.calls[0][0]
    expect(where.vencimento).toBeDefined()
    expect(where.vencimento.gte).toBeInstanceOf(Date)
    expect(where.vencimento.lte).toBeInstanceOf(Date)
  })
})

// ===========================================================================
// GET /fiscal/sped-contribuicoes
// ===========================================================================

describe('GET /fiscal/sped-contribuicoes/:empresaId/:competencia', () => {
  it('retorna apuração quando encontrada', async () => {
    const apuracao = { id: 'sp-1', tipo: 'PIS', dados: {} }
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce(apuracao)

    const res = await req('GET', `/fiscal/sped-contribuicoes/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload).id).toBe('sp-1')
  })

  it('retorna 404 quando não encontrada', async () => {
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce(null)

    const res = await req('GET', `/fiscal/sped-contribuicoes/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(404)
  })

  it('filtra por tipo PIS', async () => {
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce(null)

    await req('GET', `/fiscal/sped-contribuicoes/${EMPRESA_ID}/${COMPETENCIA}`)

    const { where } = mockDb.apuracaoFiscal.findFirst.mock.calls[0][0]
    expect(where.tipo).toBe('PIS')
    expect(where.tenantId).toBe(TENANT_ID)
  })

  it('empresaId não-UUID → 400', async () => {
    const res = await req('GET', `/fiscal/sped-contribuicoes/nao-uuid/${COMPETENCIA}`)
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// GET /fiscal/creditos-pis-cofins-lr
// ===========================================================================

describe('GET /fiscal/creditos-pis-cofins-lr/:empresaId/:competencia', () => {
  it('retorna apuração quando encontrada', async () => {
    const apuracao = { id: 'cr-1', tipo: 'COFINS' }
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce(apuracao)

    const res = await req('GET', `/fiscal/creditos-pis-cofins-lr/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload).id).toBe('cr-1')
  })

  it('retorna 404 quando não encontrada', async () => {
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce(null)

    const res = await req('GET', `/fiscal/creditos-pis-cofins-lr/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(404)
  })

  it('filtra por tipo COFINS', async () => {
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce(null)

    await req('GET', `/fiscal/creditos-pis-cofins-lr/${EMPRESA_ID}/${COMPETENCIA}`)

    const { where } = mockDb.apuracaoFiscal.findFirst.mock.calls[0][0]
    expect(where.tipo).toBe('COFINS')
  })

  it('empresaId não-UUID → 400', async () => {
    const res = await req('GET', `/fiscal/creditos-pis-cofins-lr/nao-uuid/${COMPETENCIA}`)
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// POST /fiscal/dctfweb
// ===========================================================================

describe('POST /fiscal/dctfweb/:empresaId/:competencia', () => {
  it('chama DCTFWebService.gerar com tenantId, empresaId e competencia', async () => {
    mockDCTFWeb.gerar.mockResolvedValueOnce({ competencia: COMPETENCIA })

    await req('POST', `/fiscal/dctfweb/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(mockDCTFWeb.gerar).toHaveBeenCalledWith(TENANT_ID, EMPRESA_ID, COMPETENCIA)
  })

  it('retorna resultado do DCTFWebService', async () => {
    const resultado = { competencia: COMPETENCIA, totalDebitos: '500.00' }
    mockDCTFWeb.gerar.mockResolvedValueOnce(resultado)

    const res = await req('POST', `/fiscal/dctfweb/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.competencia).toBe(COMPETENCIA)
  })

  it('empresaId não-UUID → 400', async () => {
    const res = await req('POST', `/fiscal/dctfweb/nao-uuid/${COMPETENCIA}`)
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// POST /fiscal/monitoramento/calendario/:empresaId
// ===========================================================================

describe('POST /fiscal/monitoramento/calendario/:empresaId', () => {
  it('chama MonitoramentoSNService.gerarCalendarioAnual', async () => {
    mockMonitoramento.gerarCalendarioAnual.mockResolvedValueOnce([])

    await req('POST', `/fiscal/monitoramento/calendario/${EMPRESA_ID}`)

    expect(mockMonitoramento.gerarCalendarioAnual).toHaveBeenCalledWith(
      TENANT_ID,
      EMPRESA_ID,
      expect.any(Number)
    )
  })

  it('query param ano → usa ano fornecido', async () => {
    mockMonitoramento.gerarCalendarioAnual.mockResolvedValueOnce([])

    await req('POST', `/fiscal/monitoramento/calendario/${EMPRESA_ID}?ano=2026`)

    expect(mockMonitoramento.gerarCalendarioAnual).toHaveBeenCalledWith(TENANT_ID, EMPRESA_ID, 2026)
  })

  it('sem query param ano → usa ano atual (2025 via nowBR mock)', async () => {
    mockMonitoramento.gerarCalendarioAnual.mockResolvedValueOnce([])

    await req('POST', `/fiscal/monitoramento/calendario/${EMPRESA_ID}`)

    const [, , anoArg] = mockMonitoramento.gerarCalendarioAnual.mock.calls[0]!
    expect(typeof anoArg).toBe('number')
    expect(anoArg).toBe(2025)
  })

  it('retorna array de obrigações do calendário', async () => {
    const obrigacoes = [{ tipo: 'DAS', vencimento: '2025-01-20' }]
    mockMonitoramento.gerarCalendarioAnual.mockResolvedValueOnce(obrigacoes)

    const res = await req('POST', `/fiscal/monitoramento/calendario/${EMPRESA_ID}`)

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload)).toHaveLength(1)
  })
})
