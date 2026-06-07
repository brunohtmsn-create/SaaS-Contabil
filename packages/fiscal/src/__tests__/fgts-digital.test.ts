/**
 * Testes unitários — FGTSDigitalService
 *
 * Cobre:
 *  - apurar() sem lançamentos de folha → base = 0, valorFGTS = 0
 *  - apurar() com lançamentos → aplica 8% sobre base débitos conta 6.1.x
 *  - Apenas partidas DEBITO em contas 6.1.x entram na base
 *  - Contagem de empregados por CPF único
 *  - Empresa não encontrada → lança erro
 *  - gerarGRRF() calcula multa rescisória de 40% sobre saldo FGTS
 *  - Decimal em todos os valores (CLAUDE.md §1)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Decimal } from 'decimal.js'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  lancamentoContabil: { findMany: vi.fn() },
  apuracaoFiscal: { upsert: vi.fn(), findMany: vi.fn() },
  obrigacao: { upsert: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => ({
    registrar: vi.fn(),
  })),
}))

vi.mock('@saas-contabil/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@saas-contabil/shared')>()
  return {
    ...actual,
    parsePeriodo: vi.fn(() => ({
      inicio: new Date('2025-05-01'),
      fim: new Date('2025-05-31'),
    })),
    addMeses: vi.fn((d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1)),
  }
})

import { FGTSDigitalService } from '../fgts-digital.service.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-fgts'
const EMPRESA_ID = 'emp-fgts'
const COMPETENCIA = '2025-05'
const EMPRESA = { id: EMPRESA_ID, cnpj: '11222333000181', razaoSocial: 'Empresa FGTS Ltda' }

function makeLancamento(
  partidas: Array<{ conta: string; tipo: string; valor: string | number; cpf?: string }>
) {
  return { partidas }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA)
  mockDb.lancamentoContabil.findMany.mockResolvedValue([])
  mockDb.apuracaoFiscal.upsert.mockResolvedValue({ id: 'ap-1' })
  mockDb.apuracaoFiscal.findMany.mockResolvedValue([])
  mockDb.obrigacao.findFirst.mockResolvedValue(null)
  mockDb.obrigacao.upsert.mockResolvedValue({})
  mockDb.obrigacao.create.mockResolvedValue({})
})

// ===========================================================================

describe('FGTSDigitalService.apurar() — empresa não encontrada', () => {
  it('lança erro quando empresa não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new FGTSDigitalService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)).rejects.toThrow(
      'Empresa não encontrada'
    )
  })
})

describe('FGTSDigitalService.apurar() — sem lançamentos de folha', () => {
  it('base = 0 e valorFGTS = 0 quando não há lançamentos', async () => {
    const service = new FGTSDigitalService()
    const result = await service.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(result.baseCalculo.toFixed(2)).toBe('0.00')
    expect(result.valorFGTS.toFixed(2)).toBe('0.00')
    expect(result.totalEmpregados).toBe(0)
  })

  it('alíquota retornada = 8% (percentual)', async () => {
    const service = new FGTSDigitalService()
    const result = await service.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(result.aliquota.toFixed(0)).toBe('8')
  })
})

describe('FGTSDigitalService.apurar() — com lançamentos de folha', () => {
  it('aplica 8% sobre débito em conta 6.1.x', async () => {
    mockDb.lancamentoContabil.findMany.mockResolvedValueOnce([
      makeLancamento([
        { conta: '6.1.01', tipo: 'DEBITO', valor: '5000.00', cpf: '123.456.789-00' },
      ]),
    ])

    const service = new FGTSDigitalService()
    const result = await service.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    // 5000 * 8% = 400.00
    expect(result.baseCalculo.toFixed(2)).toBe('5000.00')
    expect(result.valorFGTS.toFixed(2)).toBe('400.00')
  })

  it('CREDITO em conta 6.1.x NÃO entra na base', async () => {
    mockDb.lancamentoContabil.findMany.mockResolvedValueOnce([
      makeLancamento([
        { conta: '6.1.01', tipo: 'DEBITO', valor: '3000.00' },
        { conta: '6.1.01', tipo: 'CREDITO', valor: '1000.00' },
      ]),
    ])

    const service = new FGTSDigitalService()
    const result = await service.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    // Apenas débitos: 3000 * 8% = 240
    expect(result.baseCalculo.toFixed(2)).toBe('3000.00')
    expect(result.valorFGTS.toFixed(2)).toBe('240.00')
  })

  it('partidas em conta 5.x (não folha) são ignoradas', async () => {
    mockDb.lancamentoContabil.findMany.mockResolvedValueOnce([
      makeLancamento([
        { conta: '6.1.02', tipo: 'DEBITO', valor: '4000.00', cpf: '111.222.333-44' },
        { conta: '5.1.01', tipo: 'DEBITO', valor: '9999.00' }, // não é 6.1.x
      ]),
    ])

    const service = new FGTSDigitalService()
    const result = await service.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(result.baseCalculo.toFixed(2)).toBe('4000.00')
  })

  it('múltiplos lançamentos → base acumulada corretamente', async () => {
    mockDb.lancamentoContabil.findMany.mockResolvedValueOnce([
      makeLancamento([
        { conta: '6.1.01', tipo: 'DEBITO', valor: '2000.00', cpf: '111.111.111-11' },
      ]),
      makeLancamento([
        { conta: '6.1.02', tipo: 'DEBITO', valor: '3000.00', cpf: '222.222.222-22' },
      ]),
    ])

    const service = new FGTSDigitalService()
    const result = await service.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    // (2000 + 3000) * 8% = 400
    expect(result.baseCalculo.toFixed(2)).toBe('5000.00')
    expect(result.valorFGTS.toFixed(2)).toBe('400.00')
  })

  it('conta 6.1.x unique CPFs conta empregados corretamente', async () => {
    mockDb.lancamentoContabil.findMany.mockResolvedValueOnce([
      makeLancamento([
        { conta: '6.1.01', tipo: 'DEBITO', valor: '1000.00', cpf: 'cpf-a' },
        { conta: '6.1.01', tipo: 'DEBITO', valor: '1000.00', cpf: 'cpf-a' }, // duplicado
        { conta: '6.1.01', tipo: 'DEBITO', valor: '1000.00', cpf: 'cpf-b' },
      ]),
    ])

    const service = new FGTSDigitalService()
    const result = await service.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(result.totalEmpregados).toBe(2) // cpf-a e cpf-b = 2 únicos
  })

  it('persiste ApuracaoFiscal com tipo FGTS', async () => {
    mockDb.lancamentoContabil.findMany.mockResolvedValueOnce([
      makeLancamento([{ conta: '6.1.01', tipo: 'DEBITO', valor: '5000.00' }]),
    ])

    const service = new FGTSDigitalService()
    await service.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const upsertCall = mockDb.apuracaoFiscal.upsert.mock.calls[0][0]
    expect(upsertCall.create.tipo).toBe('FGTS')
    expect(upsertCall.create.tenantId).toBe(TENANT_ID)
    expect(upsertCall.create.status).toBe('CALCULADO')
  })

  it('resultado inclui cnpj da empresa', async () => {
    const service = new FGTSDigitalService()
    const result = await service.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(result.cnpj).toBe(EMPRESA.cnpj)
  })
})

describe('FGTSDigitalService.apurar() — partidas não-array', () => {
  it('lançamento com partidas null → ignorado (baseCalculo permanece 0)', async () => {
    mockDb.lancamentoContabil.findMany.mockResolvedValueOnce([
      { partidas: null },
      { partidas: { conta: '6.1.01', tipo: 'DEBITO', valor: '5000.00' } }, // objeto, não array
    ])

    const service = new FGTSDigitalService()
    const result = await service.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(result.baseCalculo.toFixed(2)).toBe('0.00')
    expect(result.valorFGTS.toFixed(2)).toBe('0.00')
  })

  it('lançamentos sem CPF nas partidas → totalEmpregados = número de lançamentos', async () => {
    mockDb.lancamentoContabil.findMany.mockResolvedValueOnce([
      makeLancamento([{ conta: '6.1.01', tipo: 'DEBITO', valor: '2000.00' }]), // sem cpf
      makeLancamento([{ conta: '6.1.01', tipo: 'DEBITO', valor: '3000.00' }]), // sem cpf
    ])

    const service = new FGTSDigitalService()
    const result = await service.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    // Nenhum CPF informado → totalEmpregados = número de lançamentos (2)
    expect(result.totalEmpregados).toBe(2)
  })
})

describe('FGTSDigitalService.apurar() — buscarOuGerarIdObrigacao', () => {
  it('obrigação existente → upsert usa ID existente (update path)', async () => {
    mockDb.obrigacao.findFirst.mockResolvedValueOnce({ id: 'obrigacao-existente-123' })
    mockDb.obrigacao.upsert.mockResolvedValue({ id: 'obrigacao-existente-123' })

    const service = new FGTSDigitalService()
    await service.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const upsertCall = mockDb.obrigacao.upsert.mock.calls[0][0]
    expect(upsertCall.where.id).toBe('obrigacao-existente-123')
    // update deve conter valor e status
    expect(upsertCall.update).toMatchObject({ status: 'PENDENTE' })
  })

  it('sem obrigação existente → upsert usa ID inválido (força create)', async () => {
    mockDb.obrigacao.findFirst.mockResolvedValueOnce(null)

    const service = new FGTSDigitalService()
    await service.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const upsertCall = mockDb.obrigacao.upsert.mock.calls[0][0]
    // UUID sentinela que garante que o where nunca bate e força o create
    expect(upsertCall.where.id).toBe('00000000-0000-0000-0000-000000000000')
  })
})

describe('FGTSDigitalService.gerarGRRF() — multa rescisória', () => {
  it('empresa não encontrada → lança erro', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new FGTSDigitalService()
    await expect(service.gerarGRRF(TENANT_ID, EMPRESA_ID, COMPETENCIA)).rejects.toThrow(
      'Empresa não encontrada'
    )
  })

  it('sem apurações anteriores → saldo = 0, multa = 0', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([])

    const service = new FGTSDigitalService()
    const result = await service.gerarGRRF(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(result.saldoFGTS.toFixed(2)).toBe('0.00')
    expect(result.multaRescisoria.toFixed(2)).toBe('0.00')
    expect(result.totalGuia.toFixed(2)).toBe('0.00')
  })

  it('com saldo de apurações → multa = 40% do saldo', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      { dados: { valorFGTS: new Decimal('1000.00') }, competencia: '2025-01' },
      { dados: { valorFGTS: new Decimal('1000.00') }, competencia: '2025-02' },
      { dados: { valorFGTS: new Decimal('1000.00') }, competencia: '2025-03' },
    ])

    const service = new FGTSDigitalService()
    const result = await service.gerarGRRF(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    // saldo = 3000, multa = 3000 * 40% = 1200, total = 4200
    expect(result.saldoFGTS.toFixed(2)).toBe('3000.00')
    expect(result.multaRescisoria.toFixed(2)).toBe('1200.00')
    expect(result.totalGuia.toFixed(2)).toBe('4200.00')
  })

  it('cria obrigação FGTS_DIGITAL para GRRF', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      { dados: { valorFGTS: new Decimal('500.00') } },
    ])

    const service = new FGTSDigitalService()
    await service.gerarGRRF(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockDb.obrigacao.create).toHaveBeenCalledOnce()
    const createCall = mockDb.obrigacao.create.mock.calls[0][0]
    expect(createCall.data.tipo).toBe('FGTS_DIGITAL')
    expect(createCall.data.tenantId).toBe(TENANT_ID)
  })

  it('apurações com status RASCUNHO são excluídas do saldo', async () => {
    // findMany filtra por status CALCULADO/TRANSMITIDO/PAGO, não RASCUNHO
    // O mock retorna apenas os dados filtrados pelo Prisma — testamos o where
    const service = new FGTSDigitalService()
    await service.gerarGRRF(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const findManyWhere = mockDb.apuracaoFiscal.findMany.mock.calls[0][0].where
    expect(findManyWhere.status.in).toContain('CALCULADO')
    expect(findManyWhere.status.in).toContain('TRANSMITIDO')
    expect(findManyWhere.status.in).toContain('PAGO')
    expect(findManyWhere.status.in).not.toContain('RASCUNHO')
  })

  it('vencimento GRRF = fim do período + 10 dias', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([])

    const service = new FGTSDigitalService()
    await service.gerarGRRF(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const createCall = mockDb.obrigacao.create.mock.calls[0][0]
    const vencimento = createCall.data.vencimento as Date
    // parsePeriodo mockado retorna fim = 2025-05-31
    const fimEsperado = new Date('2025-05-31')
    fimEsperado.setDate(fimEsperado.getDate() + 10)
    expect(vencimento.getDate()).toBe(fimEsperado.getDate())
    expect(vencimento.getMonth()).toBe(fimEsperado.getMonth())
  })
})
