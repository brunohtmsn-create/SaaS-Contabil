/**
 * Testes unitários — GNREService
 *
 * Cobre:
 *  - gerar() sem documentos DIFAL → retorna array vazio
 *  - gerar() com documentos → agrega por UF e grava ApuracaoFiscal
 *  - Múltiplos documentos para a mesma UF → soma os valores
 *  - Documentos com ufDestino nulo → ignorados
 *  - Empresa não encontrada → lança erro
 *  - Valores usando Decimal (CLAUDE.md §1)
 *
 * PrismaClient e AuditService são mockados.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Decimal } from 'decimal.js'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  documentoFiscal: { findMany: vi.fn() },
  apuracaoFiscal: { upsert: vi.fn() },
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
  }
})

import { GNREService } from '../gnre.service.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-gnre'
const EMPRESA_ID = 'emp-gnre'
const COMPETENCIA = '2025-05'
const EMPRESA = {
  id: EMPRESA_ID,
  cnpj: '11222333000181',
  razaoSocial: 'Empresa GNRE Ltda',
  uf: 'SP',
}

function makeDoc(ufDestino: string | null, valorDifal: string, valorFundoPobreza = '0') {
  return {
    id: `doc-${Math.random()}`,
    ufDestino,
    valorDifal: new Decimal(valorDifal),
    valorFundoPobreza: new Decimal(valorFundoPobreza),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.documentoFiscal.findMany.mockResolvedValue([])
  mockDb.apuracaoFiscal.upsert.mockResolvedValue({ id: 'ap-1' })
  mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA)
})

// ===========================================================================

describe('GNREService.gerar() — sem documentos DIFAL', () => {
  it('sem documentos retorna array vazio', async () => {
    const service = new GNREService()
    const result = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(result).toHaveLength(0)
  })

  it('não chama upsert quando não há documentos com valorDifal > 0', async () => {
    const service = new GNREService()
    await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(mockDb.apuracaoFiscal.upsert).not.toHaveBeenCalled()
  })
})

describe('GNREService.gerar() — empresa não encontrada', () => {
  it('lança erro quando empresa não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new GNREService()
    await expect(service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)).rejects.toThrow(
      'Empresa não encontrada'
    )
  })
})

describe('GNREService.gerar() — com documentos DIFAL', () => {
  it('um documento → gera uma GNRE com tipo DIFAL', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDoc('BA', '1200.00')])

    const service = new GNREService()
    const result = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(result).toHaveLength(1)
    expect(result[0]!.tipo).toBe('DIFAL')
    expect(result[0]!.ufDestino).toBe('BA')
    expect(result[0]!.valor.toFixed(2)).toBe('1200.00')
  })

  it('CNPJ emitente copiado da empresa', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDoc('RJ', '800.00')])

    const service = new GNREService()
    const result = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(result[0]!.cnpjEmitente).toBe(EMPRESA.cnpj)
  })

  it('cod receita = 10008-0', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDoc('PR', '500.00')])

    const service = new GNREService()
    const result = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(result[0]!.codReceita).toBe('10008-0')
  })

  it('dois documentos para a mesma UF → valores somados', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc('BA', '1200.00'),
      makeDoc('BA', '800.00'),
    ])

    const service = new GNREService()
    const result = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(result).toHaveLength(1)
    expect(result[0]!.valor.toFixed(2)).toBe('2000.00')
  })

  it('documentos para UFs distintas → uma GNRE por UF', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc('BA', '1200.00'),
      makeDoc('AM', '900.00'),
      makeDoc('RJ', '600.00'),
    ])

    const service = new GNREService()
    const result = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(result).toHaveLength(3)
    const ufs = result.map((r) => r.ufDestino).sort()
    expect(ufs).toEqual(['AM', 'BA', 'RJ'])
  })

  it('documento com ufDestino nulo → ignorado', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc(null, '500.00'),
      makeDoc('SP', '300.00'),
    ])

    const service = new GNREService()
    const result = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(result).toHaveLength(1)
    expect(result[0]!.ufDestino).toBe('SP')
  })

  it('persiste ApuracaoFiscal com tipo GNRE para cada UF', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc('BA', '1200.00'),
      makeDoc('AM', '900.00'),
    ])

    const service = new GNREService()
    await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockDb.apuracaoFiscal.upsert).toHaveBeenCalledTimes(2)
    const firstCall = mockDb.apuracaoFiscal.upsert.mock.calls[0][0]
    expect(firstCall.create.tipo).toBe('GNRE')
    expect(firstCall.create.tenantId).toBe(TENANT_ID)
  })

  it('valor zero → não gera GNRE (filtra lte 0)', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDoc('SP', '0.00')])

    const service = new GNREService()
    const result = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(result).toHaveLength(0)
  })

  it('competencia é passada corretamente na GNRE', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDoc('MG', '700.00')])

    const service = new GNREService()
    const result = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(result[0]!.competencia).toBe(COMPETENCIA)
  })
})
