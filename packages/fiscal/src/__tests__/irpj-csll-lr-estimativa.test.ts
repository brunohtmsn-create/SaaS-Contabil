/**
 * Testes unitários — IrpjCsllLREstimativaService
 *
 * Cobre:
 *  - empresa não encontrada → lança erro
 *  - regime LP/SN/MEI → lança erro (exclusivo LR)
 *  - sem documentos → bases zeradas e impostos zerados
 *  - receita bruta: soma dos documentos de saída conciliados
 *  - base IRPJ = receita × percentual presunção (8% comércio / 32% serviços)
 *  - base CSLL = receita × percentual presunção (12% comércio / 32% serviços)
 *  - IRPJ normal = base × 15%
 *  - IRPJ adicional = 10% sobre base > R$20.000/mês
 *  - IRPJ adicional = 0 quando base <= R$20.000
 *  - CSLL = base × 9%
 *  - totalDevido = IRPJ + CSLL
 *  - prazo = dia 31 do mês seguinte
 *  - código DARF 2362 (IRPJ) e 2484 (CSLL)
 *  - persiste com tipo IRPJ_LR e modalidade ESTIMATIVA
 *  - registra IRPJ_CSLL_LR_APURADO no audit
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAudit = { registrar: vi.fn() }

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  documentoFiscal: { findMany: vi.fn() },
  apuracaoFiscal: { upsert: vi.fn() },
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => mockAudit),
}))

import { IrpjCsllLREstimativaService } from '../irpj-csll-lr-estimativa.service.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-est'
const EMPRESA_ID = 'emp-est'

const EMPRESA_LR = {
  id: EMPRESA_ID,
  cnpj: '12345678000195',
  razaoSocial: 'Empresa LR Estimativa Ltda',
  regime: 'LUCRO_REAL',
  cnae: '4711301',
  uf: 'SP',
}

function makeDocSaida(valorTotal: number, tipo = 'NFE') {
  return {
    id: `doc-${Math.random()}`,
    numero: '000001',
    serie: '001',
    dataEmissao: new Date('2025-05-10'),
    dataCompetencia: new Date('2025-05-10'),
    tipo,
    direcao: 'SAIDA',
    status: 'CONCILIADO',
    valorTotal: { toString: () => valorTotal.toString() },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_LR)
  mockDb.documentoFiscal.findMany.mockResolvedValue([])
  mockDb.apuracaoFiscal.upsert.mockResolvedValue({ id: 'est-1' })
})

// ===========================================================================

describe('IrpjCsllLREstimativaService — validações', () => {
  it('lança erro quando empresa não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new IrpjCsllLREstimativaService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')).rejects.toThrow(
      'Empresa não encontrada'
    )
  })

  it('lança erro para regime LUCRO_PRESUMIDO', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      ...EMPRESA_LR,
      regime: 'LUCRO_PRESUMIDO',
    })
    const service = new IrpjCsllLREstimativaService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')).rejects.toThrow('Lucro Real')
  })

  it('lança erro para regime SIMPLES_NACIONAL', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      ...EMPRESA_LR,
      regime: 'SIMPLES_NACIONAL',
    })
    const service = new IrpjCsllLREstimativaService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')).rejects.toThrow('Lucro Real')
  })
})

// ===========================================================================

describe('IrpjCsllLREstimativaService — sem receita', () => {
  it('bases e impostos zerados quando não há documentos', async () => {
    const service = new IrpjCsllLREstimativaService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(r.receitaBruta)).toBe(0)
    expect(Number(r.baseIRPJ)).toBe(0)
    expect(Number(r.baseCSLL)).toBe(0)
    expect(Number(r.irpjNormal)).toBe(0)
    expect(Number(r.irpjAdicional)).toBe(0)
    expect(Number(r.irpjTotal)).toBe(0)
    expect(Number(r.csllDevida)).toBe(0)
    expect(Number(r.totalDevido)).toBe(0)
  })
})

// ===========================================================================

describe('IrpjCsllLREstimativaService — receita bruta', () => {
  it('soma documentos de saída conciliados', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDocSaida(50000),
      makeDocSaida(30000),
    ])

    const service = new IrpjCsllLREstimativaService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(r.receitaBruta)).toBe(80000)
  })
})

// ===========================================================================

describe('IrpjCsllLREstimativaService — comércio (8% / 12%)', () => {
  it('base IRPJ = receita × 8% para comércio', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDocSaida(100000)])

    const service = new IrpjCsllLREstimativaService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05', 'comercio')

    expect(Number(r.baseIRPJ)).toBe(8000)
  })

  it('base CSLL = receita × 12% para comércio', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDocSaida(100000)])

    const service = new IrpjCsllLREstimativaService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05', 'comercio')

    expect(Number(r.baseCSLL)).toBe(12000)
  })

  it('IRPJ normal = base × 15%', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDocSaida(100000)])

    const service = new IrpjCsllLREstimativaService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05', 'comercio')

    // base = 8.000; IRPJ = 8.000 × 15% = 1.200
    expect(Number(r.irpjNormal)).toBe(1200)
  })

  it('IRPJ adicional = 0 quando base <= R$20.000', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDocSaida(100000)])

    const service = new IrpjCsllLREstimativaService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05', 'comercio')

    // base = 8.000 < 20.000 → sem adicional
    expect(Number(r.irpjAdicional)).toBe(0)
  })

  it('CSLL = base CSLL × 9%', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDocSaida(100000)])

    const service = new IrpjCsllLREstimativaService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05', 'comercio')

    // base = 12.000; CSLL = 12.000 × 9% = 1.080
    expect(Number(r.csllDevida)).toBe(1080)
  })
})

// ===========================================================================

describe('IrpjCsllLREstimativaService — serviços (32% / 32%)', () => {
  it('base IRPJ = receita × 32% para serviços', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDocSaida(100000)])

    const service = new IrpjCsllLREstimativaService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05', 'servicos_gerais')

    expect(Number(r.baseIRPJ)).toBe(32000)
  })

  it('base CSLL = receita × 32% para serviços', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDocSaida(100000)])

    const service = new IrpjCsllLREstimativaService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05', 'servicos_gerais')

    expect(Number(r.baseCSLL)).toBe(32000)
  })

  it('IRPJ adicional = 10% sobre base que exceder R$20.000', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDocSaida(100000)])

    const service = new IrpjCsllLREstimativaService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05', 'servicos_gerais')

    // base = 32.000; excedente = 32.000 - 20.000 = 12.000; adicional = 12.000 × 10% = 1.200
    expect(Number(r.irpjAdicional)).toBe(1200)
  })

  it('IRPJ total = normal + adicional', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDocSaida(100000)])

    const service = new IrpjCsllLREstimativaService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05', 'servicos_gerais')

    // normal: 32.000 × 15% = 4.800; adicional: 1.200; total = 6.000
    expect(Number(r.irpjTotal)).toBe(6000)
  })
})

// ===========================================================================

describe('IrpjCsllLREstimativaService — totalDevido e prazo', () => {
  it('totalDevido = IRPJ + CSLL', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDocSaida(100000)])

    const service = new IrpjCsllLREstimativaService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05', 'servicos_gerais')

    const esperado = Number(r.irpjTotal) + Number(r.csllDevida)
    expect(Number(r.totalDevido)).toBe(esperado)
  })

  it('prazo = dia 31 do mês seguinte — competência 2025-05', async () => {
    const service = new IrpjCsllLREstimativaService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')
    expect(r.prazoRecolhimento).toBe('2025-06-31')
  })

  it('prazo = dia 31 do mês seguinte — competência 2025-12 (virada de ano)', async () => {
    const service = new IrpjCsllLREstimativaService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-12')
    expect(r.prazoRecolhimento).toBe('2026-01-31')
  })

  it('código DARF IRPJ = 2362', async () => {
    const service = new IrpjCsllLREstimativaService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')
    expect(r.codigoDarfIRPJ).toBe('2362')
  })

  it('código DARF CSLL = 2484', async () => {
    const service = new IrpjCsllLREstimativaService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')
    expect(r.codigoDarfCSLL).toBe('2484')
  })
})

// ===========================================================================

describe('IrpjCsllLREstimativaService — atividade padrão', () => {
  it('atividade "outros" usa presunção IRPJ 8%', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDocSaida(100000)])

    const service = new IrpjCsllLREstimativaService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    // "outros" → 8% (padrão)
    expect(Number(r.baseIRPJ)).toBe(8000)
  })
})

// ===========================================================================

describe('IrpjCsllLREstimativaService — persistência e auditoria', () => {
  it('persiste com tipo IRPJ_LR', async () => {
    const service = new IrpjCsllLREstimativaService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    const call = mockDb.apuracaoFiscal.upsert.mock.calls[0]
    expect(call[0].where.tenantId_empresaId_competencia_tipo.tipo).toBe('IRPJ_LR')
  })

  it('dados persistidos contêm modalidade ESTIMATIVA', async () => {
    const service = new IrpjCsllLREstimativaService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    const call = mockDb.apuracaoFiscal.upsert.mock.calls[0]
    expect(call[0].create.dados.modalidade).toBe('ESTIMATIVA')
  })

  it('registra evento IRPJ_CSLL_LR_APURADO no audit', async () => {
    const service = new IrpjCsllLREstimativaService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(mockAudit.registrar).toHaveBeenCalledOnce()
    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.evento).toBe('IRPJ_CSLL_LR_APURADO')
  })

  it('audit estadoNovo contém modalidade ESTIMATIVA', async () => {
    const service = new IrpjCsllLREstimativaService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.estadoNovo.modalidade).toBe('ESTIMATIVA')
  })

  it('audit estadoNovo contém totalDevido e prazoRecolhimento', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDocSaida(100000)])

    const service = new IrpjCsllLREstimativaService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05', 'servicos_gerais')

    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.estadoNovo.prazoRecolhimento).toBe('2025-06-31')
    expect(Number(auditCall.estadoNovo.totalDevido)).toBeGreaterThan(0)
  })

  it('audit tenantId correto', async () => {
    const service = new IrpjCsllLREstimativaService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.tenantId).toBe(TENANT_ID)
  })
})
