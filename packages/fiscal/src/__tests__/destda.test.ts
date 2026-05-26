/**
 * Testes unitários — DeSTDAService
 *
 * Cobre:
 *  - gerar() sem apuração DIFAL → arquivo sem registros E300/E310
 *  - gerar() com apuração DIFAL → arquivo inclui E300 e E310
 *  - Empresa não encontrada → lança erro
 *  - Arquivo começa com registro 0000 contendo CNPJ e razão social
 *  - Arquivo termina com registros 9001/9900/9999
 *  - Persiste ApuracaoFiscal com tipo DESTDA
 *  - retorno é string com separador | de campos SPED
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  apuracaoFiscal: { findFirst: vi.fn(), upsert: vi.fn() },
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

import { DeSTDAService } from '../destda.service.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-destda'
const EMPRESA_ID = 'emp-destda'
const COMPETENCIA = '2025-05'
const EMPRESA = {
  id: EMPRESA_ID,
  cnpj: '11222333000181',
  razaoSocial: 'Empresa DeSTDA Ltda',
  uf: 'SP',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA)
  mockDb.apuracaoFiscal.findFirst.mockResolvedValue(null)
  mockDb.apuracaoFiscal.upsert.mockResolvedValue({ id: 'ap-destda' })
})

// ===========================================================================

describe('DeSTDAService.gerar() — empresa não encontrada', () => {
  it('lança erro quando empresa não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new DeSTDAService()
    await expect(service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)).rejects.toThrow(
      'Empresa não encontrada'
    )
  })
})

describe('DeSTDAService.gerar() — estrutura do arquivo', () => {
  it('retorna uma string não vazia', async () => {
    const service = new DeSTDAService()
    const content = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(typeof content).toBe('string')
    expect(content.length).toBeGreaterThan(0)
  })

  it('arquivo começa com registro 0000', async () => {
    const service = new DeSTDAService()
    const content = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    const firstLine = content.split('\r\n')[0]!
    expect(firstLine).toMatch(/^\|0000\|/)
  })

  it('registro 0000 contém CNPJ da empresa', async () => {
    const service = new DeSTDAService()
    const content = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    const firstLine = content.split('\r\n')[0]!
    expect(firstLine).toContain(EMPRESA.cnpj)
  })

  it('registro 0000 contém razão social da empresa', async () => {
    const service = new DeSTDAService()
    const content = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    const firstLine = content.split('\r\n')[0]!
    expect(firstLine).toContain(EMPRESA.razaoSocial)
  })

  it('arquivo contém registro 0001', async () => {
    const service = new DeSTDAService()
    const content = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(content).toContain('|0001|')
  })

  it('arquivo termina com registro 9999', async () => {
    const service = new DeSTDAService()
    const content = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    const lines = content.split('\r\n')
    const lastLine = lines[lines.length - 1]!
    expect(lastLine).toMatch(/^\|9999\|/)
  })

  it('arquivo contém registro 9001 (fechamento do bloco 9)', async () => {
    const service = new DeSTDAService()
    const content = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(content).toContain('|9001|')
  })

  it('linhas separadas por \\r\\n (padrão SPED)', async () => {
    const service = new DeSTDAService()
    const content = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(content).toContain('\r\n')
  })
})

describe('DeSTDAService.gerar() — sem apuração DIFAL', () => {
  it('não inclui registros E300 quando não há apuração DIFAL', async () => {
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce(null)

    const service = new DeSTDAService()
    const content = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(content).not.toContain('|E300|')
    expect(content).not.toContain('|E310|')
  })
})

describe('DeSTDAService.gerar() — com apuração DIFAL', () => {
  it('inclui registros E300 e E310 quando há apuração DIFAL com dados', async () => {
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce({
      id: 'difal-1',
      dados: { valorDifal: '1200.00' },
    })

    const service = new DeSTDAService()
    const content = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(content).toContain('|E300|')
    expect(content).toContain('|E310|')
  })

  it('apuração DIFAL sem dados não inclui E300', async () => {
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce({
      id: 'difal-2',
      dados: null,
    })

    const service = new DeSTDAService()
    const content = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(content).not.toContain('|E300|')
  })
})

describe('DeSTDAService.gerar() — persistência', () => {
  it('persiste ApuracaoFiscal com tipo DESTDA', async () => {
    const service = new DeSTDAService()
    await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockDb.apuracaoFiscal.upsert).toHaveBeenCalledOnce()
    const upsertCall = mockDb.apuracaoFiscal.upsert.mock.calls[0][0]
    expect(upsertCall.create.tipo).toBe('DESTDA')
    expect(upsertCall.create.tenantId).toBe(TENANT_ID)
    expect(upsertCall.create.status).toBe('CALCULADO')
  })

  it('consulta apuração DIFAL com tenantId e empresaId corretos', async () => {
    const service = new DeSTDAService()
    await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const findFirstCall = mockDb.apuracaoFiscal.findFirst.mock.calls[0][0]
    expect(findFirstCall.where.tenantId).toBe(TENANT_ID)
    expect(findFirstCall.where.empresaId).toBe(EMPRESA_ID)
    expect(findFirstCall.where.tipo).toBe('DIFAL')
  })
})
