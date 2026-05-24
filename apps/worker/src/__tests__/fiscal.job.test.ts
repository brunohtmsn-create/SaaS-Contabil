/**
 * Testes unitários — fiscalJob
 *
 * Cobre:
 *  - PGDAS → chama PGDASService.apurar()
 *  - DIFAL → chama DifalService.calcular()
 *  - GNRE  → chama GNREService.gerar()
 *  - DESTDA → chama DeSTDAService.gerar()
 *  - EFDREINF → chama EFDReinfService.processar()
 *  - TODOS → chama todos os serviços em sequência
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPGDAS = { apurar: vi.fn() }
const mockDifal = { calcular: vi.fn() }
const mockGNRE = { gerar: vi.fn() }
const mockDeSTDA = { gerar: vi.fn() }
const mockEFDReinf = { processar: vi.fn() }

vi.mock('@saas-contabil/fiscal', () => ({
  PGDASService: vi.fn(() => mockPGDAS),
  DifalService: vi.fn(() => mockDifal),
  GNREService: vi.fn(() => mockGNRE),
  DeSTDAService: vi.fn(() => mockDeSTDA),
  EFDReinfService: vi.fn(() => mockEFDReinf),
}))

import { fiscalJob } from '../jobs/fiscal.job.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(operacao: string) {
  return {
    data: {
      tenantId: 't-1',
      empresaId: 'emp-1',
      cnpj: '11111111000111',
      competencia: '2025-01',
      operacao,
    },
  } as any
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => vi.clearAllMocks())

describe('fiscalJob — roteamento de operações', () => {
  it('PGDAS → chama PGDASService.apurar com os parâmetros corretos', async () => {
    await fiscalJob(makeJob('PGDAS'))
    expect(mockPGDAS.apurar).toHaveBeenCalledOnce()
    expect(mockPGDAS.apurar).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
  })

  it('DIFAL → chama DifalService.calcular', async () => {
    await fiscalJob(makeJob('DIFAL'))
    expect(mockDifal.calcular).toHaveBeenCalledOnce()
    expect(mockDifal.calcular).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
  })

  it('GNRE → chama GNREService.gerar', async () => {
    await fiscalJob(makeJob('GNRE'))
    expect(mockGNRE.gerar).toHaveBeenCalledOnce()
    expect(mockGNRE.gerar).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
  })

  it('DESTDA → chama DeSTDAService.gerar', async () => {
    await fiscalJob(makeJob('DESTDA'))
    expect(mockDeSTDA.gerar).toHaveBeenCalledOnce()
    expect(mockDeSTDA.gerar).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
  })

  it('EFDREINF → chama EFDReinfService.processar', async () => {
    await fiscalJob(makeJob('EFDREINF'))
    expect(mockEFDReinf.processar).toHaveBeenCalledOnce()
    expect(mockEFDReinf.processar).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
  })

  it('TODOS → chama todos os serviços', async () => {
    await fiscalJob(makeJob('TODOS'))
    expect(mockPGDAS.apurar).toHaveBeenCalledOnce()
    expect(mockDifal.calcular).toHaveBeenCalledOnce()
    expect(mockGNRE.gerar).toHaveBeenCalledOnce()
    expect(mockDeSTDA.gerar).toHaveBeenCalledOnce()
    expect(mockEFDReinf.processar).toHaveBeenCalledOnce()
  })

  it('TODOS → mantém ordem: PGDAS antes de DIFAL', async () => {
    const order: string[] = []
    mockPGDAS.apurar.mockImplementation(() => { order.push('PGDAS'); return Promise.resolve() })
    mockDifal.calcular.mockImplementation(() => { order.push('DIFAL'); return Promise.resolve() })
    mockGNRE.gerar.mockImplementation(() => { order.push('GNRE'); return Promise.resolve() })
    mockDeSTDA.gerar.mockImplementation(() => { order.push('DESTDA'); return Promise.resolve() })
    mockEFDReinf.processar.mockImplementation(() => { order.push('EFDREINF'); return Promise.resolve() })

    await fiscalJob(makeJob('TODOS'))
    expect(order).toEqual(['PGDAS', 'DIFAL', 'GNRE', 'DESTDA', 'EFDREINF'])
  })

  it('PGDAS → não chama serviços não relacionados', async () => {
    await fiscalJob(makeJob('PGDAS'))
    expect(mockDifal.calcular).not.toHaveBeenCalled()
    expect(mockGNRE.gerar).not.toHaveBeenCalled()
  })
})
