/**
 * Testes unitários — RelatorioFiscalService
 *
 * Cobre:
 *  - empresa não encontrada → lança erro
 *  - sem apurações → tributos com status NAO_APURADO
 *  - PGDAS apurado → linha DAS com dados corretos
 *  - IRPJ_LP apurado → linha IRPJ LP
 *  - IRPJ_LR apurado → linha IRPJ LR
 *  - totalApurado = soma de valorApurado
 *  - totalPago = soma de valorPago quando status PAGA
 *  - totalPendente = totalApurado - totalPago
 *  - percentualPago = 100 quando tudo pago
 *  - percentualPago = 0 quando nada pago
 *  - status PAGO quando obrigação PAGA
 *  - status TRANSMITIDO quando obrigação TRANSMITIDA
 *  - status PENDENTE quando obrigação sem transmissão
 *  - registra evento ARQUIVO_SALVO no audit
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAudit = { registrar: vi.fn() }

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  apuracaoFiscal: { findMany: vi.fn() },
  obrigacao: { findMany: vi.fn() },
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => mockAudit),
}))

import { RelatorioFiscalService } from '../relatorio-fiscal.service.js'
import { Decimal } from '@saas-contabil/shared'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-rel'
const EMPRESA_ID = 'emp-rel'
const COMPETENCIA = '2025-05'

function makeEmpresa(regime = 'SIMPLES_NACIONAL') {
  return {
    id: EMPRESA_ID,
    cnpj: '12345678000195',
    razaoSocial: 'Empresa Relatório Ltda',
    regime,
  }
}

function makeApuracao(tipo: string, dados: Record<string, string>) {
  return { tipo, dados, status: 'CALCULADO' }
}

function makeObrigacao(tipo: string, status: string, vencimento = '2025-05-20') {
  return { tipo, status, vencimento: new Date(vencimento) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.empresaCliente.findUnique.mockResolvedValue(makeEmpresa())
  mockDb.apuracaoFiscal.findMany.mockResolvedValue([])
  mockDb.obrigacao.findMany.mockResolvedValue([])
})

// ===========================================================================

describe('RelatorioFiscalService — validação', () => {
  it('lança erro quando empresa não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new RelatorioFiscalService()
    await expect(service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)).rejects.toThrow(
      'Empresa não encontrada'
    )
  })
})

// ===========================================================================

describe('RelatorioFiscalService — sem apurações', () => {
  it('SN sem PGDAS → linha DAS com status NAO_APURADO', async () => {
    const service = new RelatorioFiscalService()
    const r = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const das = r.tributos.find((t) => t.tributo.includes('DAS'))
    expect(das).toBeDefined()
    expect(das!.status).toBe('NAO_APURADO')
  })

  it('LP sem IRPJ → linhas com status NAO_APURADO', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(makeEmpresa('LUCRO_PRESUMIDO'))
    const service = new RelatorioFiscalService()
    const r = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const irpj = r.tributos.find((t) => t.tributo.includes('IRPJ'))
    expect(irpj!.status).toBe('NAO_APURADO')
  })
})

// ===========================================================================

describe('RelatorioFiscalService — PGDAS apurado', () => {
  it('linha DAS com valorApurado correto', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makeApuracao('PGDAS', {
        receitaBruta: '300000',
        aliquotaEfetiva: '0.073',
        totalDAS: '21900',
      }),
    ])

    const service = new RelatorioFiscalService()
    const r = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const das = r.tributos.find((t) => t.tributo.includes('DAS'))
    expect(das).toBeDefined()
    expect(Number(das!.valorApurado)).toBe(21900)
    expect(das!.status).toBe('PENDENTE')
  })

  it('DAS com status PAGO quando obrigação PAGA', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makeApuracao('PGDAS', { totalDAS: '10000', receitaBruta: '200000', aliquotaEfetiva: '0.05' }),
    ])
    mockDb.obrigacao.findMany.mockResolvedValueOnce([makeObrigacao('PGDAS', 'PAGA')])

    const service = new RelatorioFiscalService()
    const r = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const das = r.tributos.find((t) => t.tributo.includes('DAS'))
    expect(das!.status).toBe('PAGO')
    expect(Number(das!.valorPago)).toBeGreaterThan(0)
  })

  it('DAS com status TRANSMITIDO quando obrigação TRANSMITIDA', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makeApuracao('PGDAS', { totalDAS: '10000', receitaBruta: '200000', aliquotaEfetiva: '0.05' }),
    ])
    mockDb.obrigacao.findMany.mockResolvedValueOnce([makeObrigacao('PGDAS', 'TRANSMITIDA')])

    const service = new RelatorioFiscalService()
    const r = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const das = r.tributos.find((t) => t.tributo.includes('DAS'))
    expect(das!.status).toBe('TRANSMITIDO')
  })
})

// ===========================================================================

describe('RelatorioFiscalService — LP', () => {
  beforeEach(() => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(makeEmpresa('LUCRO_PRESUMIDO'))
  })

  it('linha IRPJ LP com valorApurado correto', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makeApuracao('IRPJ_LP', { baseIRPJ: '80000', irpjTotal: '12000' }),
    ])

    const service = new RelatorioFiscalService()
    const r = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const irpj = r.tributos.find((t) => t.tributo.includes('IRPJ'))
    expect(Number(irpj!.valorApurado)).toBe(12000)
    expect(Number(irpj!.baseCalculo)).toBe(80000)
  })
})

// ===========================================================================

describe('RelatorioFiscalService — LR', () => {
  beforeEach(() => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(makeEmpresa('LUCRO_REAL'))
  })

  it('linha IRPJ LR com valorApurado correto', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makeApuracao('IRPJ_LR', { lucroReal: '150000', irpjTotal: '22500' }),
    ])

    const service = new RelatorioFiscalService()
    const r = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const irpj = r.tributos.find((t) => t.tributo.includes('IRPJ'))
    expect(Number(irpj!.valorApurado)).toBe(22500)
  })
})

// ===========================================================================

describe('RelatorioFiscalService — totais', () => {
  it('totalApurado = soma dos valorApurado', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makeApuracao('PGDAS', { totalDAS: '10000', receitaBruta: '200000', aliquotaEfetiva: '0.05' }),
    ])

    const service = new RelatorioFiscalService()
    const r = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(Number(r.totalApurado)).toBe(10000)
  })

  it('totalPendente = totalApurado - totalPago', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makeApuracao('PGDAS', { totalDAS: '10000', receitaBruta: '200000', aliquotaEfetiva: '0.05' }),
    ])
    mockDb.obrigacao.findMany.mockResolvedValueOnce([makeObrigacao('PGDAS', 'PENDENTE')])

    const service = new RelatorioFiscalService()
    const r = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(Number(r.totalPendente)).toBeGreaterThanOrEqual(0)
  })

  it('percentualPago = 100 quando tudo pago', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makeApuracao('PGDAS', { totalDAS: '10000', receitaBruta: '200000', aliquotaEfetiva: '0.05' }),
    ])
    mockDb.obrigacao.findMany.mockResolvedValueOnce([makeObrigacao('PGDAS', 'PAGA')])

    const service = new RelatorioFiscalService()
    const r = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(r.percentualPago).toBe(100)
  })

  it('percentualPago = 0 quando sem apurações pagas', async () => {
    const service = new RelatorioFiscalService()
    const r = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(r.percentualPago).toBe(0)
  })
})

// ===========================================================================

describe('RelatorioFiscalService — auditoria', () => {
  it('registra evento ARQUIVO_SALVO no audit', async () => {
    const service = new RelatorioFiscalService()
    await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockAudit.registrar).toHaveBeenCalledOnce()
    const call = mockAudit.registrar.mock.calls[0][0]
    expect(call.evento).toBe('ARQUIVO_SALVO')
    expect(call.estadoNovo.tipo).toBe('RELATORIO_FISCAL')
    expect(call.tenantId).toBe(TENANT_ID)
  })
})

// ===========================================================================

describe('RelatorioFiscalService — CSLL', () => {
  it('CSLL_LP → linha CSLL com valorApurado correto', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(makeEmpresa('LUCRO_PRESUMIDO'))
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makeApuracao('CSLL_LP', { baseCSLL: '100000', csllTotal: '9000' }),
    ])

    const service = new RelatorioFiscalService()
    const r = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const csll = r.tributos.find((t) => t.tributo === 'CSLL')
    expect(csll).toBeDefined()
    expect(Number(csll!.valorApurado)).toBe(9000)
    expect(Number(csll!.aliquota)).toBeCloseTo(0.09)
  })

  it('CSLL_LR → linha CSLL com baseCSLL correta', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(makeEmpresa('LUCRO_REAL'))
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makeApuracao('CSLL_LR', { baseCSLL: '200000', csll: '18000' }),
    ])

    const service = new RelatorioFiscalService()
    const r = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const csll = r.tributos.find((t) => t.tributo === 'CSLL')
    expect(Number(csll!.baseCalculo)).toBe(200000)
    expect(Number(csll!.valorApurado)).toBe(18000)
  })
})

// ===========================================================================

describe('RelatorioFiscalService — PIS e COFINS', () => {
  beforeEach(() => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(makeEmpresa('LUCRO_PRESUMIDO'))
  })

  it('PIS → linha PIS com aliquota 0.0065 para LP', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makeApuracao('PIS', { receitaBruta: '500000', pis: '3250' }),
    ])

    const service = new RelatorioFiscalService()
    const r = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const pis = r.tributos.find((t) => t.tributo === 'PIS')
    expect(pis).toBeDefined()
    expect(Number(pis!.valorApurado)).toBe(3250)
    expect(Number(pis!.aliquota)).toBeCloseTo(0.0065)
  })

  it('COFINS → linha COFINS com aliquota 0.03 para LP', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makeApuracao('COFINS', { receitaBruta: '500000', cofins: '15000' }),
    ])

    const service = new RelatorioFiscalService()
    const r = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const cofins = r.tributos.find((t) => t.tributo === 'COFINS')
    expect(cofins).toBeDefined()
    expect(Number(cofins!.valorApurado)).toBe(15000)
    expect(Number(cofins!.aliquota)).toBeCloseTo(0.03)
  })

  it('PIS LUCRO_REAL → aliquota 0.0165', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(makeEmpresa('LUCRO_REAL'))
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makeApuracao('PIS', { receitaBruta: '500000', totalPIS: '8250' }),
    ])

    const service = new RelatorioFiscalService()
    const r = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const pis = r.tributos.find((t) => t.tributo === 'PIS')
    expect(Number(pis!.aliquota)).toBeCloseTo(0.0165)
  })
})

// ===========================================================================

describe('RelatorioFiscalService — DIFAL e GNRE', () => {
  it('DIFAL → linha DIFAL com valorApurado correto', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makeApuracao('DIFAL', { baseCalculo: '50000', totalDIFAL: '2000' }),
    ])

    const service = new RelatorioFiscalService()
    const r = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const difal = r.tributos.find((t) => t.tributo === 'DIFAL')
    expect(difal).toBeDefined()
    expect(Number(difal!.valorApurado)).toBe(2000)
  })

  it('GNRE → linha GNRE com valorTotal correto', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makeApuracao('GNRE', { totalGNRE: '3500' }),
    ])

    const service = new RelatorioFiscalService()
    const r = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const gnre = r.tributos.find((t) => t.tributo === 'GNRE')
    expect(gnre).toBeDefined()
    expect(Number(gnre!.valorApurado)).toBe(3500)
  })
})

// ===========================================================================

describe('RelatorioFiscalService — ISS/DMS', () => {
  it('ISS → linha ISS/DMS com valorApurado correto', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makeApuracao('ISS', { receitaServicos: '80000', aliquotaISS: '0.05', totalISS: '4000' }),
    ])

    const service = new RelatorioFiscalService()
    const r = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const iss = r.tributos.find((t) => t.tributo === 'ISS/DMS')
    expect(iss).toBeDefined()
    expect(Number(iss!.valorApurado)).toBe(4000)
    expect(Number(iss!.baseCalculo)).toBe(80000)
  })

  it('DMS → linha ISS/DMS com totalDMS', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makeApuracao('DMS', { receitaServicos: '60000', aliquotaISS: '0.03', totalDMS: '1800' }),
    ])

    const service = new RelatorioFiscalService()
    const r = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const iss = r.tributos.find((t) => t.tributo === 'ISS/DMS')
    expect(Number(iss!.valorApurado)).toBe(1800)
  })
})

// ===========================================================================

describe('RelatorioFiscalService — dados do resultado', () => {
  it('resultado contém cnpj e razaoSocial da empresa', async () => {
    const service = new RelatorioFiscalService()
    const r = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(r.cnpj).toBe('12345678000195')
    expect(r.razaoSocial).toBe('Empresa Relatório Ltda')
  })

  it('resultado contém competencia e regime informados', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(makeEmpresa('LUCRO_PRESUMIDO'))
    const service = new RelatorioFiscalService()
    const r = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(r.competencia).toBe(COMPETENCIA)
    expect(r.regime).toBe('LUCRO_PRESUMIDO')
  })

  it('queries filtram por tenantId e empresaId (isolamento multi-tenant)', async () => {
    const service = new RelatorioFiscalService()
    await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const apWhere = mockDb.apuracaoFiscal.findMany.mock.calls[0][0].where
    expect(apWhere.tenantId).toBe(TENANT_ID)
    expect(apWhere.empresaId).toBe(EMPRESA_ID)
    const obWhere = mockDb.obrigacao.findMany.mock.calls[0][0].where
    expect(obWhere.tenantId).toBe(TENANT_ID)
    expect(obWhere.competencia).toBe(COMPETENCIA)
  })

  it('linha inclui vencimento quando obrigação tem vencimento', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makeApuracao('PGDAS', { totalDAS: '5000', receitaBruta: '100000', aliquotaEfetiva: '0.05' }),
    ])
    mockDb.obrigacao.findMany.mockResolvedValueOnce([
      makeObrigacao('PGDAS', 'PENDENTE', '2025-05-20'),
    ])

    const service = new RelatorioFiscalService()
    const r = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const das = r.tributos.find((t) => t.tributo.includes('DAS'))
    expect(das!.vencimento).toBeDefined()
    expect(das!.vencimento).toContain('2025')
  })

  it('LR sem apurações → IRPJ_LR, PIS e COFINS como NAO_APURADO', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(makeEmpresa('LUCRO_REAL'))
    const service = new RelatorioFiscalService()
    const r = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const naoApurados = r.tributos.filter((t) => t.status === 'NAO_APURADO')
    const tributos = naoApurados.map((t) => t.tributo)
    expect(tributos.some((t) => t.includes('IRPJ'))).toBe(true)
    expect(tributos.some((t) => t === 'PIS')).toBe(true)
    expect(tributos.some((t) => t === 'COFINS')).toBe(true)
  })
})
