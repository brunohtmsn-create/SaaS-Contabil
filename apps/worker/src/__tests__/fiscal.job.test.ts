/**
 * Testes unitários — fiscalJob
 *
 * Cobre:
 *  - PGDAS → chama PGDASService.apurar()
 *  - DIFAL → chama DifalService.calcular()
 *  - GNRE  → chama GNREService.gerar()
 *  - DESTDA → chama DeSTDAService.gerar()
 *  - EFDREINF → chama EFDReinfService.processar()
 *  - ESOCIAL → chama ESocialService.processar()
 *  - DCTFWEB → chama DCTFWebService.gerar()
 *  - DMS → chama DMSService.apurar()
 *  - DASN → chama DasnService.gerar() com ano numérico
 *  - CALENDARIO_SN → chama MonitoramentoSNService.gerarCalendarioAnual() com ano numérico
 *  - CALENDARIO_LPLR → chama CalendarioLPLRService.gerarCalendarioAnual() com ano numérico
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
const mockESocial = { processar: vi.fn() }
const mockDCTFWeb = { gerar: vi.fn() }
const mockFGTS = { apurar: vi.fn() }
const mockDMS = { apurar: vi.fn() }
const mockDasn = { gerar: vi.fn() }
const mockMonitoramento = { gerarCalendarioAnual: vi.fn() }
const mockCalendarioLPLR = { gerarCalendarioAnual: vi.fn() }
const mockIrpjCsllLP = { apurar: vi.fn() }
const mockPisCofinsLP = { apurar: vi.fn() }
const mockECF = { gerar: vi.fn() }
const mockDCTFMensal = { gerar: vi.fn() }
const mockSpedFiscal = { gerar: vi.fn() }
const mockSpedContrib = { gerar: vi.fn() }
const mockIrpjCsllLR = { apurar: vi.fn() }
const mockCreditosLR = { apurar: vi.fn() }

vi.mock('@saas-contabil/fiscal', () => ({
  PGDASService: vi.fn(() => mockPGDAS),
  DifalService: vi.fn(() => mockDifal),
  GNREService: vi.fn(() => mockGNRE),
  DeSTDAService: vi.fn(() => mockDeSTDA),
  EFDReinfService: vi.fn(() => mockEFDReinf),
  ESocialService: vi.fn(() => mockESocial),
  DCTFWebService: vi.fn(() => mockDCTFWeb),
  FGTSDigitalService: vi.fn(() => mockFGTS),
  DMSService: vi.fn(() => mockDMS),
  DasnService: vi.fn(() => mockDasn),
  MonitoramentoSNService: vi.fn(() => mockMonitoramento),
  CalendarioLPLRService: vi.fn(() => mockCalendarioLPLR),
  IrpjCsllLPService: vi.fn(() => mockIrpjCsllLP),
  PisCofinsLPService: vi.fn(() => mockPisCofinsLP),
  ECFService: vi.fn(() => mockECF),
  DCTFMensalService: vi.fn(() => mockDCTFMensal),
  SpedFiscalService: vi.fn(() => mockSpedFiscal),
  SpedContribuicoesService: vi.fn(() => mockSpedContrib),
  IrpjCsllLRService: vi.fn(() => mockIrpjCsllLR),
  CreditosPisCofinsLRService: vi.fn(() => mockCreditosLR),
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

  it('ESOCIAL → chama ESocialService.processar', async () => {
    await fiscalJob(makeJob('ESOCIAL'))
    expect(mockESocial.processar).toHaveBeenCalledOnce()
    expect(mockESocial.processar).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
  })

  it('DCTFWEB → chama DCTFWebService.gerar', async () => {
    await fiscalJob(makeJob('DCTFWEB'))
    expect(mockDCTFWeb.gerar).toHaveBeenCalledOnce()
    expect(mockDCTFWeb.gerar).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
  })

  it('FGTS → chama FGTSDigitalService.apurar', async () => {
    await fiscalJob(makeJob('FGTS'))
    expect(mockFGTS.apurar).toHaveBeenCalledOnce()
    expect(mockFGTS.apurar).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
  })

  it('DMS → chama DMSService.apurar', async () => {
    await fiscalJob(makeJob('DMS'))
    expect(mockDMS.apurar).toHaveBeenCalledOnce()
    expect(mockDMS.apurar).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
  })

  it('TODOS → chama todos os serviços principais', async () => {
    await fiscalJob(makeJob('TODOS'))
    expect(mockPGDAS.apurar).toHaveBeenCalledOnce()
    expect(mockDifal.calcular).toHaveBeenCalledOnce()
    expect(mockGNRE.gerar).toHaveBeenCalledOnce()
    expect(mockDeSTDA.gerar).toHaveBeenCalledOnce()
    expect(mockEFDReinf.processar).toHaveBeenCalledOnce()
  })

  it('TODOS → tenta DMS, eSocial, FGTS e DCTFWeb (continua se falhar)', async () => {
    mockDMS.apurar.mockRejectedValueOnce(new Error('sem NFSe no período'))
    mockESocial.processar.mockRejectedValueOnce(new Error('sem empregados'))
    mockFGTS.apurar.mockRejectedValueOnce(new Error('sem folha'))
    mockDCTFWeb.gerar.mockRejectedValueOnce(new Error('EFD não fechado'))
    await expect(fiscalJob(makeJob('TODOS'))).resolves.toBeUndefined()
    expect(mockPGDAS.apurar).toHaveBeenCalledOnce()
  })

  it('DASN → chama DasnService.gerar com ano numérico', async () => {
    mockDasn.gerar.mockResolvedValue({ mesesCompletos: true, receitaAnualTotal: '120000.00' })
    const job = {
      data: {
        tenantId: 't-1',
        empresaId: 'emp-1',
        cnpj: '11111111000111',
        competencia: '2024',
        operacao: 'DASN',
      },
    } as any
    await fiscalJob(job)
    expect(mockDasn.gerar).toHaveBeenCalledOnce()
    expect(mockDasn.gerar).toHaveBeenCalledWith('t-1', 'emp-1', 2024)
  })

  it('CALENDARIO_SN → chama MonitoramentoSNService.gerarCalendarioAnual com ano numérico', async () => {
    mockMonitoramento.gerarCalendarioAnual.mockResolvedValue([])
    const job = {
      data: {
        tenantId: 't-1',
        empresaId: 'emp-1',
        cnpj: '11111111000111',
        competencia: '2025',
        operacao: 'CALENDARIO_SN',
      },
    } as any
    await fiscalJob(job)
    expect(mockMonitoramento.gerarCalendarioAnual).toHaveBeenCalledOnce()
    expect(mockMonitoramento.gerarCalendarioAnual).toHaveBeenCalledWith('t-1', 'emp-1', 2025)
  })

  it('CALENDARIO_LPLR → chama CalendarioLPLRService.gerarCalendarioAnual com ano numérico', async () => {
    mockCalendarioLPLR.gerarCalendarioAnual.mockResolvedValue([])
    const job = {
      data: {
        tenantId: 't-1',
        empresaId: 'emp-1',
        cnpj: '11111111000111',
        competencia: '2025',
        operacao: 'CALENDARIO_LPLR',
      },
    } as any
    await fiscalJob(job)
    expect(mockCalendarioLPLR.gerarCalendarioAnual).toHaveBeenCalledOnce()
    expect(mockCalendarioLPLR.gerarCalendarioAnual).toHaveBeenCalledWith('t-1', 'emp-1', 2025)
  })

  it('IRPJ_CSLL_LP → chama IrpjCsllLPService.apurar com competencia', async () => {
    mockIrpjCsllLP.apurar.mockResolvedValue({ irpjTotal: '0', csllTotal: '0' })
    await fiscalJob(makeJob('IRPJ_CSLL_LP'))
    expect(mockIrpjCsllLP.apurar).toHaveBeenCalledOnce()
    expect(mockIrpjCsllLP.apurar).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
  })

  it('PIS_COFINS_LP → chama PisCofinsLPService.apurar com competencia', async () => {
    mockPisCofinsLP.apurar.mockResolvedValue({ pis: '0', cofins: '0' })
    await fiscalJob(makeJob('PIS_COFINS_LP'))
    expect(mockPisCofinsLP.apurar).toHaveBeenCalledOnce()
    expect(mockPisCofinsLP.apurar).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
  })

  it('DCTF_MENSAL → chama DCTFMensalService.gerar com competencia', async () => {
    mockDCTFMensal.gerar.mockResolvedValue({ totalDebitos: '3650', saldoDevedor: '3650' })
    await fiscalJob(makeJob('DCTF_MENSAL'))
    expect(mockDCTFMensal.gerar).toHaveBeenCalledOnce()
    expect(mockDCTFMensal.gerar).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
  })

  it('SPED_CONTRIBUICOES → chama SpedContribuicoesService.gerar com competencia', async () => {
    mockSpedContrib.gerar.mockResolvedValue({ totalPIS: '650', totalCOFINS: '3000' })
    await fiscalJob(makeJob('SPED_CONTRIBUICOES'))
    expect(mockSpedContrib.gerar).toHaveBeenCalledOnce()
    expect(mockSpedContrib.gerar).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
  })

  it('IRPJ_CSLL_LR → chama IrpjCsllLRService.apurar com competencia', async () => {
    mockIrpjCsllLR.apurar.mockResolvedValue({ irpjTotal: '0', csllTotal: '0' })
    const job = {
      data: {
        tenantId: 't-1',
        empresaId: 'emp-1',
        cnpj: '11111111000111',
        competencia: '2025-01',
        operacao: 'IRPJ_CSLL_LR',
        meta: { lucroContabilTrimestral: '100000', adicoesLALUR: '0', exclusoesLALUR: '0' },
      },
    } as any
    await fiscalJob(job)
    expect(mockIrpjCsllLR.apurar).toHaveBeenCalledOnce()
  })

  it('CREDITOS_PIS_COFINS_LR → chama CreditosPisCofinsLRService.apurar', async () => {
    mockCreditosLR.apurar.mockResolvedValue({ totalCreditoPIS: '1650', totalCreditoCOFINS: '7600' })
    await fiscalJob(makeJob('CREDITOS_PIS_COFINS_LR'))
    expect(mockCreditosLR.apurar).toHaveBeenCalledOnce()
    expect(mockCreditosLR.apurar).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
  })

  it('SPED_FISCAL → chama SpedFiscalService.gerar com competencia', async () => {
    mockSpedFiscal.gerar.mockResolvedValue({ totalDocumentos: 0, totalICMS: '0' })
    await fiscalJob(makeJob('SPED_FISCAL'))
    expect(mockSpedFiscal.gerar).toHaveBeenCalledOnce()
    expect(mockSpedFiscal.gerar).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
  })

  it('ECF → chama ECFService.gerar com ano numérico', async () => {
    mockECF.gerar.mockResolvedValue({ ano: 2025, totalDevidoAnual: '0' })
    const job = {
      data: {
        tenantId: 't-1',
        empresaId: 'emp-1',
        cnpj: '11111111000111',
        competencia: '2025',
        operacao: 'ECF',
      },
    } as any
    await fiscalJob(job)
    expect(mockECF.gerar).toHaveBeenCalledOnce()
    expect(mockECF.gerar).toHaveBeenCalledWith('t-1', 'emp-1', 2025)
  })

  it('TODOS → mantém ordem: PGDAS antes de DIFAL antes de EFD-Reinf', async () => {
    const order: string[] = []
    mockPGDAS.apurar.mockImplementation(() => {
      order.push('PGDAS')
      return Promise.resolve()
    })
    mockDifal.calcular.mockImplementation(() => {
      order.push('DIFAL')
      return Promise.resolve()
    })
    mockGNRE.gerar.mockImplementation(() => {
      order.push('GNRE')
      return Promise.resolve()
    })
    mockDeSTDA.gerar.mockImplementation(() => {
      order.push('DESTDA')
      return Promise.resolve()
    })
    mockEFDReinf.processar.mockImplementation(() => {
      order.push('EFDREINF')
      return Promise.resolve()
    })

    await fiscalJob(makeJob('TODOS'))
    expect(order.indexOf('PGDAS')).toBeLessThan(order.indexOf('DIFAL'))
    expect(order.indexOf('DIFAL')).toBeLessThan(order.indexOf('EFDREINF'))
  })

  it('PGDAS → não chama serviços não relacionados', async () => {
    await fiscalJob(makeJob('PGDAS'))
    expect(mockDifal.calcular).not.toHaveBeenCalled()
    expect(mockGNRE.gerar).not.toHaveBeenCalled()
  })
})
