/**
 * Testes de integração — fiscal.routes.ts
 *
 * Foco nos caminhos críticos:
 *  POST /fiscal/pgdas/transmitir/:id/:comp — bloqueia se há docs não conciliados (CLAUDE.md §11)
 *  GET  /fiscal/apuracoes — filtra por tenantId
 *  GET  /fiscal/obrigacoes — filtra por tenantId + competência + status
 *  POST /fiscal/pgdas/:id/:comp — chama PGDASService.apurar
 *  GET  /fiscal/pgdas/:id/:comp — busca apuração, 404 se ausente
 *  GET  /fiscal/fator-r/:id/:comp — retorna fatorR e anexo
 *  POST /fiscal/obrigacoes/calendario/:id/:ano — valida ano com regex
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import jwt from '@fastify/jwt'
import { ZodError } from 'zod'

// ---------------------------------------------------------------------------
// Mocks de serviços fiscais e Prisma
// ---------------------------------------------------------------------------

const mockPGDAS = { apurar: vi.fn() }
const mockDifal = { calcular: vi.fn() }
const mockGNRE = { gerar: vi.fn() }
const mockDeSTDA = { gerar: vi.fn() }
const mockDCTFWeb = { gerar: vi.fn() }
const mockESocial = { processar: vi.fn() }
const mockMonitoramento = {
  gerarCalendarioAnual: vi.fn(),
  verificarRiscoExclusao: vi.fn(),
  verificarVencimentos: vi.fn(),
}
const mockFatorR = { calcular: vi.fn() }
const mockFGTS = { apurar: vi.fn() }
const mockEFDReinf = { processar: vi.fn() }
const mockDMS = { apurar: vi.fn() }
const mockDasn = { gerar: vi.fn() }
const mockCalendarioLPLR = { gerarCalendarioAnual: vi.fn() }

vi.mock('@saas-contabil/fiscal', () => ({
  PGDASService: vi.fn(() => mockPGDAS),
  DifalService: vi.fn(() => mockDifal),
  GNREService: vi.fn(() => mockGNRE),
  DeSTDAService: vi.fn(() => mockDeSTDA),
  DCTFWebService: vi.fn(() => mockDCTFWeb),
  ESocialService: vi.fn(() => mockESocial),
  MonitoramentoSNService: vi.fn(() => mockMonitoramento),
  FatorRService: vi.fn(() => mockFatorR),
  FGTSDigitalService: vi.fn(() => mockFGTS),
  EFDReinfService: vi.fn(() => mockEFDReinf),
  DMSService: vi.fn(() => mockDMS),
  DasnService: vi.fn(() => mockDasn),
  CalendarioLPLRService: vi.fn(() => mockCalendarioLPLR),
}))

const { mockDb, mockQueue } = vi.hoisted(() => ({
  mockDb: {
    apuracaoFiscal: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    documentoFiscal: {
      count: vi.fn(),
    },
    obrigacao: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    empresaCliente: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    alerta: {
      findMany: vi.fn(),
    },
  },
  mockQueue: { add: vi.fn() },
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
  return {
    ...actual,
    nowBR: vi.fn(() => new Date('2025-06-01T12:00:00Z')),
  }
})

import { fiscalRoutes } from '../routes/fiscal.routes.js'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-fiscal'
const USER_ID = 'user-fiscal'
const EMPRESA_ID = '550e8400-e29b-41d4-a716-446655440000'
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

  await app.register(fiscalRoutes, { prefix: '/fiscal' })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  vi.clearAllMocks()
  mockQueue.add.mockResolvedValue({ id: 'job-123' })
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
// POST /fiscal/pgdas/transmitir — regra crítica CLAUDE.md §11
// ===========================================================================

describe('POST /fiscal/pgdas/transmitir/:empresaId/:competencia', () => {
  const url = `/fiscal/pgdas/transmitir/${EMPRESA_ID}/${COMPETENCIA}`

  it('com todos documentos conciliados → 200 e status TRANSMITIDO', async () => {
    mockDb.documentoFiscal.count.mockResolvedValueOnce(0) // sem pendentes
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce({ id: 'apuracao-1', status: 'CALCULADO' })
    mockDb.apuracaoFiscal.update.mockResolvedValueOnce({})

    const res = await req('POST', url)

    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
    expect(res.json().status).toBe('TRANSMITIDO')
  })

  it('com documentos PENDENTE_REVISAO → 422 (bloqueia transmissão)', async () => {
    mockDb.documentoFiscal.count.mockResolvedValueOnce(3) // 3 pendentes

    const res = await req('POST', url)

    expect(res.statusCode).toBe(422)
    expect(res.json().error).toMatch(/não conciliados/i)
    // Não deve atualizar o status
    expect(mockDb.apuracaoFiscal.update).not.toHaveBeenCalled()
  })

  it('com 1 documento pendente → 422 com count correto na mensagem', async () => {
    mockDb.documentoFiscal.count.mockResolvedValueOnce(1)

    const res = await req('POST', url)

    expect(res.statusCode).toBe(422)
    expect(res.json().error).toMatch(/1/)
  })

  it('PGDAS não apurado → 404', async () => {
    mockDb.documentoFiscal.count.mockResolvedValueOnce(0) // sem pendentes
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce(null)

    const res = await req('POST', url)

    expect(res.statusCode).toBe(404)
    expect(res.json().error).toMatch(/não apurado/i)
  })

  it('update seta status TRANSMITIDO na apuração', async () => {
    mockDb.documentoFiscal.count.mockResolvedValueOnce(0)
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce({ id: 'apuracao-1' })
    mockDb.apuracaoFiscal.update.mockResolvedValueOnce({})

    await req('POST', url)

    const updateData = mockDb.apuracaoFiscal.update.mock.calls[0][0].data
    expect(updateData.status).toBe('TRANSMITIDO')
  })

  it('count filtra por tenantId e empresaId (isolamento)', async () => {
    mockDb.documentoFiscal.count.mockResolvedValueOnce(0)
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce({ id: 'ap-1' })
    mockDb.apuracaoFiscal.update.mockResolvedValueOnce({})

    await req('POST', url)

    const countWhere = mockDb.documentoFiscal.count.mock.calls[0][0].where
    expect(countWhere.tenantId).toBe(TENANT_ID)
    expect(countWhere.empresaId).toBe(EMPRESA_ID)
  })

  it('competencia inválida (não YYYY-MM) → 400', async () => {
    const res = await req('POST', `/fiscal/pgdas/transmitir/${EMPRESA_ID}/2025`)
    expect(res.statusCode).toBe(400)
  })

  it('empresaId inválido (não UUID) → 400', async () => {
    const res = await req('POST', `/fiscal/pgdas/transmitir/nao-uuid/${COMPETENCIA}`)
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// POST /fiscal/pgdas/:id/:comp — apuração
// ===========================================================================

describe('POST /fiscal/pgdas/:empresaId/:competencia', () => {
  it('chama PGDASService.apurar e retorna resultado', async () => {
    const resultado = { tipo: 'PGDAS', status: 'CALCULADO', valorDAS: '1500.00' }
    mockPGDAS.apurar.mockResolvedValueOnce(resultado)

    const res = await req('POST', `/fiscal/pgdas/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    expect(mockPGDAS.apurar).toHaveBeenCalledWith(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(res.json().valorDAS).toBe('1500.00')
  })
})

// ===========================================================================
// GET /fiscal/pgdas/:id/:comp — busca apuração
// ===========================================================================

describe('GET /fiscal/pgdas/:empresaId/:competencia', () => {
  it('apuração encontrada → 200', async () => {
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce({
      id: 'ap-1',
      tipo: 'PGDAS',
      status: 'CALCULADO',
    })

    const res = await req('GET', `/fiscal/pgdas/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    expect(res.json().tipo).toBe('PGDAS')
  })

  it('apuração não encontrada → 404', async () => {
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce(null)

    const res = await req('GET', `/fiscal/pgdas/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(404)
    expect(res.json().error).toMatch(/não encontrado/i)
  })

  it('busca com tenantId do JWT', async () => {
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce({ id: 'ap-1' })

    await req('GET', `/fiscal/pgdas/${EMPRESA_ID}/${COMPETENCIA}`)

    const where = mockDb.apuracaoFiscal.findFirst.mock.calls[0][0].where
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.empresaId).toBe(EMPRESA_ID)
    expect(where.tipo).toBe('PGDAS')
  })
})

// ===========================================================================
// GET /fiscal/apuracoes
// ===========================================================================

describe('GET /fiscal/apuracoes', () => {
  it('retorna apurações do tenant', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([{ id: 'ap-1', tipo: 'PGDAS' }])

    const res = await req('GET', '/fiscal/apuracoes')

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('filtra por tenantId (isolamento)', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([])

    await req('GET', '/fiscal/apuracoes')

    const { where } = mockDb.apuracaoFiscal.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
  })

  it('com ?competencia=YYYY-MM adiciona filtro', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([])

    await req('GET', '/fiscal/apuracoes?competencia=2025-05')

    const { where } = mockDb.apuracaoFiscal.findMany.mock.calls[0][0]
    expect(where.competencia).toBe('2025-05')
  })

  it('com ?tipo=PGDAS adiciona filtro de tipo', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([])

    await req('GET', '/fiscal/apuracoes?tipo=PGDAS')

    const { where } = mockDb.apuracaoFiscal.findMany.mock.calls[0][0]
    expect(where.tipo).toBe('PGDAS')
  })
})

// ===========================================================================
// GET /fiscal/obrigacoes
// ===========================================================================

describe('GET /fiscal/obrigacoes', () => {
  it('retorna obrigações do tenant', async () => {
    mockDb.obrigacao.findMany.mockResolvedValueOnce([{ id: 'obr-1', tipo: 'DAS' }])

    const res = await req('GET', '/fiscal/obrigacoes')

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('filtra por tenantId', async () => {
    mockDb.obrigacao.findMany.mockResolvedValueOnce([])

    await req('GET', '/fiscal/obrigacoes')

    const { where } = mockDb.obrigacao.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
  })

  it('com ?status=PENDENTE adiciona filtro de status', async () => {
    mockDb.obrigacao.findMany.mockResolvedValueOnce([])

    await req('GET', '/fiscal/obrigacoes?status=PENDENTE')

    const { where } = mockDb.obrigacao.findMany.mock.calls[0][0]
    expect(where.status).toBe('PENDENTE')
  })

  it('com ?competencia=YYYY-MM adiciona filtro de vencimento por período', async () => {
    mockDb.obrigacao.findMany.mockResolvedValueOnce([])

    await req('GET', '/fiscal/obrigacoes?competencia=2025-05')

    const { where } = mockDb.obrigacao.findMany.mock.calls[0][0]
    expect(where.vencimento).toBeDefined()
    expect(where.vencimento.gte).toBeDefined()
    expect(where.vencimento.lte).toBeDefined()
  })
})

// ===========================================================================
// GET /fiscal/fator-r/:id/:comp
// ===========================================================================

describe('GET /fiscal/fator-r/:empresaId/:competencia', () => {
  it('retorna fatorR e anexo calculado', async () => {
    const { Decimal } = await import('@saas-contabil/shared')
    mockFatorR.calcular.mockResolvedValueOnce({
      fatorR: new Decimal('0.28'),
      anexo: 'III',
    })

    const res = await req('GET', `/fiscal/fator-r/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.empresaId).toBe(EMPRESA_ID)
    expect(body.competencia).toBe(COMPETENCIA)
    expect(body.fatorR).toBe('0.28')
    expect(body.anexo).toBe('III')
  })
})

// ===========================================================================
// POST /fiscal/obrigacoes/calendario/:empresaId/:ano
// ===========================================================================

describe('POST /fiscal/obrigacoes/calendario/:empresaId/:ano', () => {
  beforeEach(() => vi.clearAllMocks())

  it('empresa SN → chama MonitoramentoSNService.gerarCalendarioAnual', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({
      id: EMPRESA_ID,
      regime: 'SIMPLES_NACIONAL',
    })
    mockMonitoramento.gerarCalendarioAnual.mockResolvedValueOnce([])

    const res = await req('POST', `/fiscal/obrigacoes/calendario/${EMPRESA_ID}/2025`)

    expect(res.statusCode).toBe(200)
    expect(mockMonitoramento.gerarCalendarioAnual).toHaveBeenCalledWith(TENANT_ID, EMPRESA_ID, 2025)
    expect(mockCalendarioLPLR.gerarCalendarioAnual).not.toHaveBeenCalled()
  })

  it('empresa MEI → chama MonitoramentoSNService.gerarCalendarioAnual', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({ id: EMPRESA_ID, regime: 'MEI' })
    mockMonitoramento.gerarCalendarioAnual.mockResolvedValueOnce([])

    const res = await req('POST', `/fiscal/obrigacoes/calendario/${EMPRESA_ID}/2025`)

    expect(res.statusCode).toBe(200)
    expect(mockMonitoramento.gerarCalendarioAnual).toHaveBeenCalledOnce()
  })

  it('empresa LP → chama CalendarioLPLRService.gerarCalendarioAnual', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({
      id: EMPRESA_ID,
      regime: 'LUCRO_PRESUMIDO',
    })
    mockCalendarioLPLR.gerarCalendarioAnual.mockResolvedValueOnce([])

    const res = await req('POST', `/fiscal/obrigacoes/calendario/${EMPRESA_ID}/2025`)

    expect(res.statusCode).toBe(200)
    expect(mockCalendarioLPLR.gerarCalendarioAnual).toHaveBeenCalledWith(
      TENANT_ID,
      EMPRESA_ID,
      2025
    )
    expect(mockMonitoramento.gerarCalendarioAnual).not.toHaveBeenCalled()
  })

  it('empresa LR → chama CalendarioLPLRService.gerarCalendarioAnual', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({
      id: EMPRESA_ID,
      regime: 'LUCRO_REAL',
    })
    mockCalendarioLPLR.gerarCalendarioAnual.mockResolvedValueOnce([])

    const res = await req('POST', `/fiscal/obrigacoes/calendario/${EMPRESA_ID}/2025`)

    expect(res.statusCode).toBe(200)
    expect(mockCalendarioLPLR.gerarCalendarioAnual).toHaveBeenCalledOnce()
  })

  it('empresa não encontrada → 404', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(null)

    const res = await req('POST', `/fiscal/obrigacoes/calendario/${EMPRESA_ID}/2025`)

    expect(res.statusCode).toBe(404)
  })

  it('ano inválido (texto) → 400', async () => {
    const res = await req('POST', `/fiscal/obrigacoes/calendario/${EMPRESA_ID}/ABCD`)
    expect(res.statusCode).toBe(400)
  })

  it('empresaId não-UUID → 400', async () => {
    const res = await req('POST', `/fiscal/obrigacoes/calendario/nao-uuid/2025`)
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// POST /fiscal/obrigacoes/calendario/batch/:ano
// ===========================================================================

describe('POST /fiscal/obrigacoes/calendario/batch/:ano', () => {
  beforeEach(() => vi.clearAllMocks())

  it('gera calendário para todas as empresas SN/MEI ativas → 200 com totais', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([
      { id: EMPRESA_ID, razaoSocial: 'Empresa A' },
      { id: '550e8400-e29b-41d4-a716-446655440001', razaoSocial: 'Empresa B' },
    ])
    mockMonitoramento.gerarCalendarioAnual.mockResolvedValue([])

    const res = await req('POST', '/fiscal/obrigacoes/calendario/batch/2025')

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ano).toBe(2025)
    expect(body.totalEmpresas).toBe(2)
    expect(body.sucesso).toBe(2)
    expect(body.erros).toHaveLength(0)
  })

  it('empresa com erro → retorna no array erros mas conta sucesso correto', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([
      { id: EMPRESA_ID, razaoSocial: 'Empresa OK' },
      { id: '550e8400-e29b-41d4-a716-446655440001', razaoSocial: 'Empresa Erro' },
    ])
    mockMonitoramento.gerarCalendarioAnual
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('DB timeout'))

    const res = await req('POST', '/fiscal/obrigacoes/calendario/batch/2025')

    const body = res.json()
    expect(body.sucesso).toBe(1)
    expect(body.erros).toHaveLength(1)
    expect(body.erros[0].erro).toContain('timeout')
  })

  it('filtra por tenantId, ativa=true e regime SN/MEI', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([])

    await req('POST', '/fiscal/obrigacoes/calendario/batch/2025')

    const { where } = mockDb.empresaCliente.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.ativa).toBe(true)
    expect(where.regime.in).toContain('SIMPLES_NACIONAL')
    expect(where.regime.in).toContain('MEI')
  })

  it('ano inválido → 400', async () => {
    const res = await req('POST', '/fiscal/obrigacoes/calendario/batch/XYZ')
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// POST /fiscal/obrigacoes/calendario/batch-lplr/:ano
// ===========================================================================

describe('POST /fiscal/obrigacoes/calendario/batch-lplr/:ano', () => {
  beforeEach(() => vi.clearAllMocks())

  it('gera calendário para todas as empresas LP/LR ativas → 200 com totais', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([
      { id: EMPRESA_ID, razaoSocial: 'Empresa LP' },
      { id: '550e8400-e29b-41d4-a716-446655440002', razaoSocial: 'Empresa LR' },
    ])
    mockCalendarioLPLR.gerarCalendarioAnual.mockResolvedValue([])

    const res = await req('POST', '/fiscal/obrigacoes/calendario/batch-lplr/2025')

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ano).toBe(2025)
    expect(body.totalEmpresas).toBe(2)
    expect(body.sucesso).toBe(2)
    expect(body.erros).toHaveLength(0)
  })

  it('empresa com erro → retorna no array erros mas conta sucesso correto', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([
      { id: EMPRESA_ID, razaoSocial: 'Empresa OK' },
      { id: '550e8400-e29b-41d4-a716-446655440002', razaoSocial: 'Empresa Erro' },
    ])
    mockCalendarioLPLR.gerarCalendarioAnual
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('regime inválido'))

    const res = await req('POST', '/fiscal/obrigacoes/calendario/batch-lplr/2025')

    const body = res.json()
    expect(body.sucesso).toBe(1)
    expect(body.erros).toHaveLength(1)
    expect(body.erros[0].erro).toContain('regime')
  })

  it('filtra por tenantId, ativa=true e regime LP/LR', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([])

    await req('POST', '/fiscal/obrigacoes/calendario/batch-lplr/2025')

    const { where } = mockDb.empresaCliente.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.ativa).toBe(true)
    expect(where.regime.in).toContain('LUCRO_PRESUMIDO')
    expect(where.regime.in).toContain('LUCRO_REAL')
  })

  it('ano inválido → 400', async () => {
    const res = await req('POST', '/fiscal/obrigacoes/calendario/batch-lplr/XYZ')
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// PATCH /fiscal/obrigacoes/:id
// ===========================================================================

describe('PATCH /fiscal/obrigacoes/:id', () => {
  it('atualiza status para PAGA → 200', async () => {
    mockDb.obrigacao.findFirst.mockResolvedValueOnce({ id: 'obr-1', tenantId: TENANT_ID })
    mockDb.obrigacao.update.mockResolvedValueOnce({ id: 'obr-1', status: 'PAGA' })

    const res = await req('PATCH', '/fiscal/obrigacoes/obr-1', { status: 'PAGA' })

    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('PAGA')
  })

  it('atualiza para DISPENSADA → 200', async () => {
    mockDb.obrigacao.findFirst.mockResolvedValueOnce({ id: 'obr-2' })
    mockDb.obrigacao.update.mockResolvedValueOnce({ id: 'obr-2', status: 'DISPENSADA' })

    const res = await req('PATCH', '/fiscal/obrigacoes/obr-2', { status: 'DISPENSADA' })

    expect(res.statusCode).toBe(200)
  })

  it('obrigação não encontrada → 404', async () => {
    mockDb.obrigacao.findFirst.mockResolvedValueOnce(null)

    const res = await req('PATCH', '/fiscal/obrigacoes/nao-existe', { status: 'PAGA' })

    expect(res.statusCode).toBe(404)
    expect(mockDb.obrigacao.update).not.toHaveBeenCalled()
  })

  it('status inválido → 400', async () => {
    const res = await req('PATCH', '/fiscal/obrigacoes/obr-1', { status: 'STATUS_INVENTADO' })
    expect(res.statusCode).toBe(400)
  })

  it('update usa tenantId do JWT no where (isolamento)', async () => {
    mockDb.obrigacao.findFirst.mockResolvedValueOnce({ id: 'obr-iso' })
    mockDb.obrigacao.update.mockResolvedValueOnce({ id: 'obr-iso', status: 'PAGA' })

    await req('PATCH', '/fiscal/obrigacoes/obr-iso', { status: 'PAGA' })

    const updateWhere = mockDb.obrigacao.update.mock.calls[0][0].where
    expect(updateWhere.tenantId).toBe(TENANT_ID)
    expect(updateWhere.id).toBe('obr-iso')
  })
})

// ===========================================================================
// POST /fiscal/fgts/:empresaId/:competencia
// ===========================================================================

describe('POST /fiscal/fgts/:empresaId/:competencia', () => {
  it('chama FGTSDigitalService.apurar e retorna resultado', async () => {
    const resultado = { tipo: 'FGTS', status: 'CALCULADO', totalFGTS: '800.00' }
    mockFGTS.apurar.mockResolvedValueOnce(resultado)

    const res = await req('POST', `/fiscal/fgts/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    expect(mockFGTS.apurar).toHaveBeenCalledWith(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(res.json().totalFGTS).toBe('800.00')
  })

  it('empresaId inválido → 400', async () => {
    const res = await req('POST', `/fiscal/fgts/nao-uuid/${COMPETENCIA}`)
    expect(res.statusCode).toBe(400)
  })

  it('competencia inválida → 400', async () => {
    const res = await req('POST', `/fiscal/fgts/${EMPRESA_ID}/202505`)
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// POST /fiscal/fgts/grrf/:empresaId/:competencia
// ===========================================================================

describe('POST /fiscal/fgts/grrf/:empresaId/:competencia', () => {
  it('chama FGTSDigitalService.gerarGRRF e retorna resultado', async () => {
    const resultado = { saldoFGTS: '3000.00', multaRescisoria: '1200.00', totalGuia: '4200.00' }
    mockFGTS.gerarGRRF = vi.fn().mockResolvedValueOnce(resultado)

    const res = await req('POST', `/fiscal/fgts/grrf/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    expect(mockFGTS.gerarGRRF).toHaveBeenCalledWith(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(res.json().totalGuia).toBe('4200.00')
  })

  it('empresaId inválido → 400', async () => {
    const res = await req('POST', `/fiscal/fgts/grrf/nao-uuid/${COMPETENCIA}`)
    expect(res.statusCode).toBe(400)
  })

  it('competencia inválida → 400', async () => {
    const res = await req('POST', `/fiscal/fgts/grrf/${EMPRESA_ID}/2025`)
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// POST /fiscal/efdreinf/:empresaId/:competencia
// ===========================================================================

describe('POST /fiscal/efdreinf/:empresaId/:competencia', () => {
  it('chama EFDReinfService.processar e retorna resultado', async () => {
    const resultado = { eventos: ['R-2010', 'R-2020'], status: 'PROCESSADO' }
    mockEFDReinf.processar.mockResolvedValueOnce(resultado)

    const res = await req('POST', `/fiscal/efdreinf/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    expect(mockEFDReinf.processar).toHaveBeenCalledWith(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(res.json().status).toBe('PROCESSADO')
  })

  it('empresaId inválido → 400', async () => {
    const res = await req('POST', `/fiscal/efdreinf/nao-uuid/${COMPETENCIA}`)
    expect(res.statusCode).toBe(400)
  })

  it('competencia inválida → 400', async () => {
    const res = await req('POST', `/fiscal/efdreinf/${EMPRESA_ID}/2025`)
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// POST /fiscal/job/:empresaId/:competencia
// ===========================================================================

describe('POST /fiscal/job/:empresaId/:competencia', () => {
  it('empresa encontrada → enfileira job e retorna jobId', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({
      id: EMPRESA_ID,
      cnpj: '11222333000181',
    })

    const res = await req('POST', `/fiscal/job/${EMPRESA_ID}/${COMPETENCIA}`, {
      operacao: 'PGDAS',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe('job-123')
    expect(res.json().operacao).toBe('PGDAS')
    expect(res.json().status).toBe('ENFILEIRADO')
  })

  it('empresa não encontrada → 404', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(null)

    const res = await req('POST', `/fiscal/job/${EMPRESA_ID}/${COMPETENCIA}`, {
      operacao: 'TODOS',
    })

    expect(res.statusCode).toBe(404)
    expect(mockQueue.add).not.toHaveBeenCalled()
  })

  it('sem operacao no body → usa TODOS por default', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({
      id: EMPRESA_ID,
      cnpj: '11222333000181',
    })

    const res = await req('POST', `/fiscal/job/${EMPRESA_ID}/${COMPETENCIA}`, {})

    expect(res.statusCode).toBe(200)
    expect(res.json().operacao).toBe('TODOS')
  })

  it('operacao inválida → 400', async () => {
    const res = await req('POST', `/fiscal/job/${EMPRESA_ID}/${COMPETENCIA}`, {
      operacao: 'OPERACAO_INEXISTENTE',
    })
    expect(res.statusCode).toBe(400)
  })

  it('job enfileirado inclui tenantId do JWT', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({
      id: EMPRESA_ID,
      cnpj: '11222333000181',
    })

    await req('POST', `/fiscal/job/${EMPRESA_ID}/${COMPETENCIA}`, { operacao: 'DIFAL' })

    const jobData = mockQueue.add.mock.calls[0][1]
    expect(jobData.tenantId).toBe(TENANT_ID)
    expect(jobData.empresaId).toBe(EMPRESA_ID)
    expect(jobData.operacao).toBe('DIFAL')
  })
})

// ===========================================================================
// POST /fiscal/batch/:competencia
// ===========================================================================

describe('POST /fiscal/batch/:competencia', () => {
  it('enfileira job para cada empresa ativa', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([
      { id: 'emp-1', cnpj: '11222333000181' },
      { id: 'emp-2', cnpj: '99888777000166' },
    ])

    const res = await req('POST', `/fiscal/batch/${COMPETENCIA}`, { operacao: 'PGDAS' })

    expect(res.statusCode).toBe(200)
    expect(res.json().total).toBe(2)
    expect(res.json().jobIds).toHaveLength(2)
    expect(mockQueue.add).toHaveBeenCalledTimes(2)
  })

  it('sem empresas ativas → total: 0', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([])

    const res = await req('POST', `/fiscal/batch/${COMPETENCIA}`, {})

    expect(res.statusCode).toBe(200)
    expect(res.json().total).toBe(0)
    expect(mockQueue.add).not.toHaveBeenCalled()
  })

  it('sem operacao → usa TODOS por default', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([{ id: 'emp-1', cnpj: '11111111000191' }])

    const res = await req('POST', `/fiscal/batch/${COMPETENCIA}`, {})

    expect(res.statusCode).toBe(200)
    expect(res.json().operacao).toBe('TODOS')
  })

  it('filtra empresas por tenantId do JWT', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([])

    await req('POST', `/fiscal/batch/${COMPETENCIA}`, {})

    const { where } = mockDb.empresaCliente.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.ativa).toBe(true)
  })

  it('competencia inválida → 400', async () => {
    const res = await req('POST', '/fiscal/batch/202505', {})
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// GET /fiscal/monitoramento/risco-exclusao/:empresaId/:competencia
// ===========================================================================

describe('GET /fiscal/monitoramento/risco-exclusao/:empresaId/:competencia', () => {
  const url = `/fiscal/monitoramento/risco-exclusao/${EMPRESA_ID}/${COMPETENCIA}`

  it('empresa não encontrada → 404', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(null)

    const res = await req('GET', url)

    expect(res.statusCode).toBe(404)
    expect(res.json().error).toMatch(/empresa não encontrada/i)
    expect(mockMonitoramento.verificarRiscoExclusao).not.toHaveBeenCalled()
  })

  it('empresa encontrada → chama verificarRiscoExclusao com tenantId e competencia', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({
      id: EMPRESA_ID,
      cnpj: '11222333000181',
    })
    mockMonitoramento.verificarRiscoExclusao.mockResolvedValueOnce(undefined)
    mockDb.alerta.findMany.mockResolvedValueOnce([])

    await req('GET', url)

    expect(mockMonitoramento.verificarRiscoExclusao).toHaveBeenCalledWith(
      TENANT_ID,
      EMPRESA_ID,
      COMPETENCIA
    )
  })

  it('retorna empresaId, cnpj, competencia e alertas', async () => {
    const cnpj = '11222333000181'
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({ id: EMPRESA_ID, cnpj })
    mockMonitoramento.verificarRiscoExclusao.mockResolvedValueOnce(undefined)
    mockDb.alerta.findMany.mockResolvedValueOnce([
      { id: 'al-1', tipo: 'RISCO_EXCLUSAO_SN', mensagem: 'Receita excedida' },
    ])

    const res = await req('GET', url)

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.empresaId).toBe(EMPRESA_ID)
    expect(body.cnpj).toBe(cnpj)
    expect(body.competencia).toBe(COMPETENCIA)
    expect(body.alertas).toHaveLength(1)
    expect(body.alertas[0].tipo).toBe('RISCO_EXCLUSAO_SN')
  })

  it('alerta.findMany filtra por tenantId e empresaId (isolamento)', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({
      id: EMPRESA_ID,
      cnpj: '11222333000181',
    })
    mockMonitoramento.verificarRiscoExclusao.mockResolvedValueOnce(undefined)
    mockDb.alerta.findMany.mockResolvedValueOnce([])

    await req('GET', url)

    const { where } = mockDb.alerta.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.empresaId).toBe(EMPRESA_ID)
  })

  it('alerta.findMany filtra tipos RISCO_EXCLUSAO_SN e SUBLIMITE_ESTADUAL', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce({
      id: EMPRESA_ID,
      cnpj: '11222333000181',
    })
    mockMonitoramento.verificarRiscoExclusao.mockResolvedValueOnce(undefined)
    mockDb.alerta.findMany.mockResolvedValueOnce([])

    await req('GET', url)

    const { where } = mockDb.alerta.findMany.mock.calls[0][0]
    expect(where.tipo.in).toContain('RISCO_EXCLUSAO_SN')
    expect(where.tipo.in).toContain('SUBLIMITE_ESTADUAL')
  })

  it('empresaId não-UUID → 400', async () => {
    const res = await req('GET', `/fiscal/monitoramento/risco-exclusao/nao-uuid/${COMPETENCIA}`)
    expect(res.statusCode).toBe(400)
  })

  it('competencia inválida → 400', async () => {
    const res = await req('GET', `/fiscal/monitoramento/risco-exclusao/${EMPRESA_ID}/2025`)
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// GET /fiscal/monitoramento/vencimentos
// ===========================================================================

describe('GET /fiscal/monitoramento/vencimentos', () => {
  const OBRIGACAO_PENDENTE = {
    id: 'obr-1',
    tipo: 'DAS',
    status: 'PENDENTE',
    vencimento: new Date('2025-06-05T00:00:00Z'),
  }
  const OBRIGACAO_FUTURA = {
    id: 'obr-2',
    tipo: 'EFD_REINF',
    status: 'PENDENTE',
    vencimento: new Date('2025-06-30T00:00:00Z'),
  }

  it('retorna empresas ativas com obrigações próximas', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([
      { id: 'emp-1', cnpj: '11222333000181', razaoSocial: 'Acme LTDA' },
    ])
    mockMonitoramento.verificarVencimentos.mockResolvedValueOnce([OBRIGACAO_PENDENTE])

    const res = await req('GET', '/fiscal/monitoramento/vencimentos')

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(1)
    expect(body[0].cnpj).toBe('11222333000181')
  })

  it('filtra obrigações com vencimento dentro do prazo padrão (7 dias)', async () => {
    // nowBR mocked to 2025-06-01 → vencendoEm = 2025-06-08
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([
      { id: 'emp-1', cnpj: '11222333000181', razaoSocial: 'Acme LTDA' },
    ])
    mockMonitoramento.verificarVencimentos.mockResolvedValueOnce([
      OBRIGACAO_PENDENTE, // 2025-06-05 → dentro do prazo
      OBRIGACAO_FUTURA, // 2025-06-30 → fora do prazo
    ])

    const res = await req('GET', '/fiscal/monitoramento/vencimentos')

    const body = res.json()
    expect(body[0].obrigacoesProximas).toBe(1)
    expect(body[0].obrigacoes).toHaveLength(1)
    expect(body[0].obrigacoes[0].tipo).toBe('DAS')
  })

  it('filtra por tenantId do JWT (isolamento)', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([])

    await req('GET', '/fiscal/monitoramento/vencimentos')

    const { where } = mockDb.empresaCliente.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.ativa).toBe(true)
  })

  it('respeita ?diasAntecedencia=1 (apenas vencimento amanhã)', async () => {
    // nowBR = 2025-06-01 → vencendoEm com 1 dia = 2025-06-02
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([
      { id: 'emp-1', cnpj: '11222333000181', razaoSocial: 'Acme LTDA' },
    ])
    mockMonitoramento.verificarVencimentos.mockResolvedValueOnce([
      OBRIGACAO_PENDENTE, // 2025-06-05 → fora do prazo de 1 dia
    ])

    const res = await req('GET', '/fiscal/monitoramento/vencimentos?diasAntecedencia=1')

    const body = res.json()
    expect(body[0].obrigacoesProximas).toBe(0)
    expect(body[0].obrigacoes).toHaveLength(0)
  })

  it('usa competencia atual quando não informada', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([
      { id: 'emp-1', cnpj: '11222333000181', razaoSocial: 'Acme LTDA' },
    ])
    mockMonitoramento.verificarVencimentos.mockResolvedValueOnce([])

    await req('GET', '/fiscal/monitoramento/vencimentos')

    // nowBR mocked to '2025-06-01' → competencia = '2025-06'
    expect(mockMonitoramento.verificarVencimentos).toHaveBeenCalledWith(
      TENANT_ID,
      'emp-1',
      '2025-06'
    )
  })

  it('respeita ?competencia=YYYY-MM passada na query', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([
      { id: 'emp-2', cnpj: '99888777000166', razaoSocial: 'Beta LTDA' },
    ])
    mockMonitoramento.verificarVencimentos.mockResolvedValueOnce([])

    await req('GET', '/fiscal/monitoramento/vencimentos?competencia=2025-03')

    expect(mockMonitoramento.verificarVencimentos).toHaveBeenCalledWith(
      TENANT_ID,
      'emp-2',
      '2025-03'
    )
  })

  it('processa múltiplas empresas em paralelo', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([
      { id: 'emp-1', cnpj: '11222333000181', razaoSocial: 'Acme' },
      { id: 'emp-2', cnpj: '99888777000166', razaoSocial: 'Beta' },
      { id: 'emp-3', cnpj: '55444333000122', razaoSocial: 'Gama' },
    ])
    mockMonitoramento.verificarVencimentos
      .mockResolvedValueOnce([OBRIGACAO_PENDENTE])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([OBRIGACAO_PENDENTE, OBRIGACAO_PENDENTE])

    const res = await req('GET', '/fiscal/monitoramento/vencimentos')

    expect(res.statusCode).toBe(200)
    expect(mockMonitoramento.verificarVencimentos).toHaveBeenCalledTimes(3)
    const body = res.json()
    expect(body).toHaveLength(3)
    expect(body[2].obrigacoesProximas).toBe(2)
  })

  it('sem empresas ativas → retorna array vazio', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([])

    const res = await req('GET', '/fiscal/monitoramento/vencimentos')

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(0)
    expect(mockMonitoramento.verificarVencimentos).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// POST /fiscal/dms/:empresaId/:competencia
// ===========================================================================

describe('POST /fiscal/dms/:empresaId/:competencia', () => {
  it('chama DMSService.apurar e retorna resultado', async () => {
    const resultado = {
      competencia: COMPETENCIA,
      cnpj: '11222333000181',
      totalNFSe: 3,
      totalServicos: '15000.00',
      totalISS: '300.00',
      porMunicipio: [],
    }
    mockDMS.apurar.mockResolvedValueOnce(resultado)

    const res = await req('POST', `/fiscal/dms/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    expect(mockDMS.apurar).toHaveBeenCalledWith(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(res.json().totalNFSe).toBe(3)
    expect(res.json().totalISS).toBe('300.00')
  })

  it('empresaId inválido → 400', async () => {
    const res = await req('POST', `/fiscal/dms/nao-uuid/${COMPETENCIA}`)
    expect(res.statusCode).toBe(400)
  })

  it('competencia inválida → 400', async () => {
    const res = await req('POST', `/fiscal/dms/${EMPRESA_ID}/2025`)
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// GET /fiscal/difal/:empresaId/:competencia
// ===========================================================================

describe('GET /fiscal/difal/:empresaId/:competencia', () => {
  it('apuração existente → 200 com dados', async () => {
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce({
      id: 'ap-difal-1',
      tipo: 'DIFAL',
      competencia: COMPETENCIA,
      status: 'CALCULADO',
    })

    const res = await req('GET', `/fiscal/difal/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    expect(res.json().tipo).toBe('DIFAL')
    const where = mockDb.apuracaoFiscal.findFirst.mock.calls[0][0].where
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.tipo).toBe('DIFAL')
  })

  it('não encontrado → 404', async () => {
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce(null)
    const res = await req('GET', `/fiscal/difal/${EMPRESA_ID}/${COMPETENCIA}`)
    expect(res.statusCode).toBe(404)
  })

  it('empresaId inválido → 400', async () => {
    const res = await req('GET', `/fiscal/difal/nao-uuid/${COMPETENCIA}`)
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// GET /fiscal/gnre/:empresaId/:competencia
// ===========================================================================

describe('GET /fiscal/gnre/:empresaId/:competencia', () => {
  it('apuração existente → 200 com dados', async () => {
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce({
      id: 'ap-gnre-1',
      tipo: 'GNRE',
      competencia: COMPETENCIA,
      status: 'PENDENTE',
    })

    const res = await req('GET', `/fiscal/gnre/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    expect(res.json().tipo).toBe('GNRE')
    const where = mockDb.apuracaoFiscal.findFirst.mock.calls[0][0].where
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.tipo).toBe('GNRE')
  })

  it('não encontrado → 404', async () => {
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce(null)
    const res = await req('GET', `/fiscal/gnre/${EMPRESA_ID}/${COMPETENCIA}`)
    expect(res.statusCode).toBe(404)
  })
})

// ===========================================================================
// GET /fiscal/destda/:empresaId/:competencia
// ===========================================================================

describe('GET /fiscal/destda/:empresaId/:competencia', () => {
  it('apuração existente → 200 com dados', async () => {
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce({
      id: 'ap-destda-1',
      tipo: 'DESTDA',
      competencia: COMPETENCIA,
      status: 'CALCULADO',
    })

    const res = await req('GET', `/fiscal/destda/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    expect(res.json().tipo).toBe('DESTDA')
    const where = mockDb.apuracaoFiscal.findFirst.mock.calls[0][0].where
    expect(where.tipo).toBe('DESTDA')
  })

  it('não encontrado → 404', async () => {
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce(null)
    const res = await req('GET', `/fiscal/destda/${EMPRESA_ID}/${COMPETENCIA}`)
    expect(res.statusCode).toBe(404)
  })
})

// ===========================================================================
// GET /fiscal/dms/:empresaId/:competencia
// ===========================================================================

describe('GET /fiscal/dms/:empresaId/:competencia', () => {
  it('apuração existente → 200 com dados', async () => {
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce({
      id: 'ap-dms-1',
      tipo: 'DMS',
      competencia: COMPETENCIA,
      status: 'PENDENTE',
    })

    const res = await req('GET', `/fiscal/dms/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    expect(res.json().tipo).toBe('DMS')
    const where = mockDb.apuracaoFiscal.findFirst.mock.calls[0][0].where
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.tipo).toBe('DMS')
  })

  it('não encontrado → 404', async () => {
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce(null)
    const res = await req('GET', `/fiscal/dms/${EMPRESA_ID}/${COMPETENCIA}`)
    expect(res.statusCode).toBe(404)
  })

  it('empresaId inválido → 400', async () => {
    const res = await req('GET', `/fiscal/dms/nao-uuid/${COMPETENCIA}`)
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// GET /fiscal/efdreinf/:empresaId/:competencia
// ===========================================================================

describe('GET /fiscal/efdreinf/:empresaId/:competencia', () => {
  it('apuração existente → 200 com dados', async () => {
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce({
      id: 'ap-reinf-1',
      tipo: 'EFD_REINF',
      competencia: COMPETENCIA,
      status: 'CALCULADO',
    })

    const res = await req('GET', `/fiscal/efdreinf/${EMPRESA_ID}/${COMPETENCIA}`)

    expect(res.statusCode).toBe(200)
    expect(res.json().tipo).toBe('EFD_REINF')
    const where = mockDb.apuracaoFiscal.findFirst.mock.calls[0][0].where
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.tipo).toBe('EFD_REINF')
  })

  it('não encontrado → 404', async () => {
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce(null)
    const res = await req('GET', `/fiscal/efdreinf/${EMPRESA_ID}/${COMPETENCIA}`)
    expect(res.statusCode).toBe(404)
  })

  it('competencia inválida → 400', async () => {
    const res = await req('GET', `/fiscal/efdreinf/${EMPRESA_ID}/202505`)
    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// POST + GET /fiscal/dasn/:empresaId/:ano
// ===========================================================================

describe('POST /fiscal/dasn/:empresaId/:ano', () => {
  const ANO = '2024'
  const url = `/fiscal/dasn/${EMPRESA_ID}/${ANO}`

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.empresaCliente.findFirst.mockResolvedValue({
      id: EMPRESA_ID,
      regime: 'SIMPLES_NACIONAL',
    })
  })

  it('retorna resultado do DasnService → 200', async () => {
    const resultado = {
      cnpj: '12345678000195',
      ano: 2024,
      receitaMensal: [],
      receitaAnualTotal: '120000.00',
      mesesComPGDAS: 12,
      mesesCompletos: true,
      obrigacaoId: 'obrig-1',
      vencimento: '2025-03-31T12:00:00.000Z',
    }
    mockDasn.gerar.mockResolvedValue(resultado)

    const res = await req('POST', url)

    expect(res.statusCode).toBe(200)
    expect(res.json().mesesCompletos).toBe(true)
    expect(res.json().receitaAnualTotal).toBe('120000.00')
  })

  it('empresa não encontrada → 404', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(null)

    const res = await req('POST', url)

    expect(res.statusCode).toBe(404)
  })

  it('ano inválido → 400', async () => {
    const res = await req('POST', `/fiscal/dasn/${EMPRESA_ID}/abc`)
    expect(res.statusCode).toBe(400)
  })

  it('passa tenantId para isolamento multi-tenant', async () => {
    mockDasn.gerar.mockResolvedValue({ mesesCompletos: true, receitaAnualTotal: '0' })

    await req('POST', url)

    expect(mockDb.empresaCliente.findFirst.mock.calls[0][0].where.tenantId).toBe(TENANT_ID)
  })
})

describe('GET /fiscal/dasn/:empresaId/:ano', () => {
  const ANO = '2024'
  const url = `/fiscal/dasn/${EMPRESA_ID}/${ANO}`

  beforeEach(() => vi.clearAllMocks())

  it('retorna obrigacao DASN → 200', async () => {
    mockDb.obrigacao.findFirst.mockResolvedValueOnce({
      id: 'obrig-1',
      tipo: 'DASN',
      competencia: ANO,
      status: 'PENDENTE',
    })

    const res = await req('GET', url)

    expect(res.statusCode).toBe(200)
    expect(res.json().tipo).toBe('DASN')
  })

  it('DASN não gerada → 404', async () => {
    mockDb.obrigacao.findFirst.mockResolvedValueOnce(null)

    const res = await req('GET', url)

    expect(res.statusCode).toBe(404)
  })

  it('filtra por tenantId (isolamento)', async () => {
    mockDb.obrigacao.findFirst.mockResolvedValueOnce({
      id: 'obrig-1',
      tipo: 'DASN',
    })

    await req('GET', url)

    const where = mockDb.obrigacao.findFirst.mock.calls[0][0].where
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.tipo).toBe('DASN')
  })
})

// ---------------------------------------------------------------------------
// GET /fiscal/compliance/resumo
// ---------------------------------------------------------------------------

describe('GET /fiscal/compliance/resumo', () => {
  const url = '/fiscal/compliance/resumo?competencia=2025-01'

  beforeEach(() => vi.clearAllMocks())

  it('retorna totais e lista de empresas → 200', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([
      {
        id: EMPRESA_ID,
        cnpj: '11111111000111',
        razaoSocial: 'Empresa A',
        regime: 'SIMPLES_NACIONAL',
      },
    ])
    mockDb.obrigacao.findMany.mockResolvedValueOnce([
      { id: 'o1', tipo: 'DAS', vencimento: new Date('2025-01-20'), status: 'PAGA' },
    ])

    const res = await req('GET', url)

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.competencia).toBe('2025-01')
    expect(body.totais.totalEmpresas).toBe(1)
    expect(body.empresas).toHaveLength(1)
    expect(body.empresas[0].statusGeral).toBe('EM_DIA')
    expect(body.empresas[0].cumpridas).toBe(1)
  })

  it('empresa com obrigação atrasada → statusGeral ATRASADA', async () => {
    // nowBR mocked to 2025-06-01T12:00:00Z — usar data anterior ao mock
    const vencidaOntem = new Date('2025-05-20T12:00:00Z')

    mockDb.empresaCliente.findMany.mockResolvedValueOnce([
      {
        id: EMPRESA_ID,
        cnpj: '11111111000111',
        razaoSocial: 'Empresa B',
        regime: 'SIMPLES_NACIONAL',
      },
    ])
    mockDb.obrigacao.findMany.mockResolvedValueOnce([
      { id: 'o2', tipo: 'DAS', vencimento: vencidaOntem, status: 'PENDENTE' },
    ])

    const res = await req('GET', url)

    const empresa = res.json().empresas[0]
    expect(empresa.statusGeral).toBe('ATRASADA')
    expect(empresa.atrasadas).toBe(1)
    expect(res.json().totais.totalAtrasadas).toBe(1)
  })

  it('sem obrigações → statusGeral SEM_OBRIGACOES', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([
      { id: EMPRESA_ID, cnpj: '11111111000111', razaoSocial: 'Empresa C', regime: 'MEI' },
    ])
    mockDb.obrigacao.findMany.mockResolvedValueOnce([])

    const res = await req('GET', url)

    expect(res.json().empresas[0].statusGeral).toBe('SEM_OBRIGACOES')
  })

  it('filtra obrigações pelo tenantId', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([])

    await req('GET', url)

    const where = mockDb.empresaCliente.findMany.mock.calls[0][0].where
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.ativa).toBe(true)
  })
})
