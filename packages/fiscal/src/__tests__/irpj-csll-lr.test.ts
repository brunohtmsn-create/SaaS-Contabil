/**
 * Testes unitários — IrpjCsllLRService (Lucro Real)
 *
 * Cobre:
 *  - empresa não encontrada → lança erro
 *  - regime diferente de LUCRO_REAL → lança erro (SN, MEI, LP)
 *  - lucro zero → contribuições zeradas
 *  - lucro negativo → contribuições zeradas (base não pode ser negativa)
 *  - IRPJ = lucroReal × 15%
 *  - adicional IRPJ = (lucroReal - 60.000) × 10% (somente se > 60.000)
 *  - sem adicional quando lucroReal ≤ 60.000
 *  - CSLL = lucroReal × 9%
 *  - totalDevido = IRPJ + CSLL
 *  - adições ao LALUR aumentam a base
 *  - exclusões do LALUR reduzem a base
 *  - trimestres corretos: T1=jan-mar, T2=abr-jun, T3=jul-set, T4=out-dez
 *  - prazo T1=30/04, T2=31/07, T3=31/10, T4=31/01(+1)
 *  - persiste IRPJ_LR e CSLL_LR no banco
 *  - registra IRPJ_CSLL_LR_APURADO no audit
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Decimal } from '@saas-contabil/shared'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAudit = { registrar: vi.fn() }

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  apuracaoFiscal: { upsert: vi.fn() },
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => mockAudit),
}))

import { IrpjCsllLRService } from '../irpj-csll-lr.service.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-lr'
const EMPRESA_ID = 'emp-lr'

const EMPRESA_LR = {
  id: EMPRESA_ID,
  cnpj: '12345678000195',
  razaoSocial: 'Empresa Lucro Real Ltda',
  regime: 'LUCRO_REAL',
  cnae: '4711301',
  uf: 'SP',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_LR)
  mockDb.apuracaoFiscal.upsert.mockResolvedValue({ id: 'lr-1' })
})

// ===========================================================================

describe('IrpjCsllLRService — validações', () => {
  it('lança erro quando empresa não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new IrpjCsllLRService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-01')).rejects.toThrow(
      'Empresa não encontrada'
    )
  })

  it('lança erro para regime SIMPLES_NACIONAL', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      ...EMPRESA_LR,
      regime: 'SIMPLES_NACIONAL',
    })
    const service = new IrpjCsllLRService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-01')).rejects.toThrow('Lucro Real')
  })

  it('lança erro para regime MEI', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ ...EMPRESA_LR, regime: 'MEI' })
    const service = new IrpjCsllLRService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-01')).rejects.toThrow('Lucro Real')
  })

  it('lança erro para regime LUCRO_PRESUMIDO', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      ...EMPRESA_LR,
      regime: 'LUCRO_PRESUMIDO',
    })
    const service = new IrpjCsllLRService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-01')).rejects.toThrow('Lucro Real')
  })
})

// ===========================================================================

describe('IrpjCsllLRService — cálculo de IRPJ', () => {
  it('lucro zero → IRPJ = 0', async () => {
    const service = new IrpjCsllLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01')
    expect(Number(r.irpjTotal)).toBe(0)
  })

  it('lucro negativo → contribuições zeradas (base não pode ser negativa)', async () => {
    const service = new IrpjCsllLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01', new Decimal(-50000))
    expect(Number(r.irpjTotal)).toBe(0)
    expect(Number(r.csllTotal)).toBe(0)
  })

  it('IRPJ = lucroReal × 15% (sem adicional quando ≤ R$60.000)', async () => {
    const service = new IrpjCsllLRService()
    // Lucro de R$40.000 → IRPJ = 40.000 × 15% = 6.000; sem adicional
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01', new Decimal(40000))
    expect(Number(r.irpjNormal)).toBe(6000)
    expect(Number(r.irpjAdicional)).toBe(0)
    expect(Number(r.irpjTotal)).toBe(6000)
  })

  it('adicional 10% sobre base > R$60.000/trimestre', async () => {
    const service = new IrpjCsllLRService()
    // Lucro de R$100.000 → normal = 15.000; adicional = (100.000-60.000) × 10% = 4.000
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01', new Decimal(100000))
    expect(Number(r.irpjNormal)).toBe(15000)
    expect(Number(r.irpjAdicional)).toBe(4000)
    expect(Number(r.irpjTotal)).toBe(19000)
  })

  it('base exatamente em R$60.000 → sem adicional', async () => {
    const service = new IrpjCsllLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01', new Decimal(60000))
    expect(Number(r.irpjAdicional)).toBe(0)
    expect(Number(r.irpjNormal)).toBe(9000)
  })
})

// ===========================================================================

describe('IrpjCsllLRService — cálculo de CSLL', () => {
  it('CSLL = lucroReal × 9%', async () => {
    const service = new IrpjCsllLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01', new Decimal(100000))
    expect(Number(r.csllTotal)).toBe(9000)
  })

  it('CSLL zero quando lucro ≤ 0', async () => {
    const service = new IrpjCsllLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01', new Decimal(0))
    expect(Number(r.csllTotal)).toBe(0)
  })
})

// ===========================================================================

describe('IrpjCsllLRService — totalDevido', () => {
  it('totalDevido = IRPJ + CSLL', async () => {
    const service = new IrpjCsllLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01', new Decimal(100000))
    expect(Number(r.totalDevido)).toBe(Number(r.irpjTotal) + Number(r.csllTotal))
  })

  it('lucro 100.000 → totalDevido = 19.000 (IRPJ) + 9.000 (CSLL) = 28.000', async () => {
    const service = new IrpjCsllLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01', new Decimal(100000))
    expect(Number(r.totalDevido)).toBe(28000)
  })
})

// ===========================================================================

describe('IrpjCsllLRService — ajustes LALUR', () => {
  it('adições ao LALUR aumentam a base de cálculo', async () => {
    const service = new IrpjCsllLRService()
    // Lucro contábil 50.000 + adições 20.000 = base 70.000
    // Normal: 70.000 × 15% = 10.500; Adicional: 10.000 × 10% = 1.000
    const r = await service.apurar(
      TENANT_ID,
      EMPRESA_ID,
      '2025-01',
      new Decimal(50000),
      new Decimal(20000),
      new Decimal(0)
    )
    expect(Number(r.lucroRealTrimestral)).toBe(70000)
    expect(Number(r.irpjNormal)).toBe(10500)
    expect(Number(r.irpjAdicional)).toBe(1000)
  })

  it('exclusões do LALUR reduzem a base de cálculo', async () => {
    const service = new IrpjCsllLRService()
    // Lucro contábil 100.000 - exclusões 40.000 = base 60.000
    const r = await service.apurar(
      TENANT_ID,
      EMPRESA_ID,
      '2025-01',
      new Decimal(100000),
      new Decimal(0),
      new Decimal(40000)
    )
    expect(Number(r.lucroRealTrimestral)).toBe(60000)
    expect(Number(r.irpjAdicional)).toBe(0)
  })

  it('exclusões que tornam o lucro real negativo → base = 0', async () => {
    const service = new IrpjCsllLRService()
    const r = await service.apurar(
      TENANT_ID,
      EMPRESA_ID,
      '2025-01',
      new Decimal(30000),
      new Decimal(0),
      new Decimal(50000)
    )
    expect(Number(r.lucroRealTrimestral)).toBe(-20000)
    expect(Number(r.irpjTotal)).toBe(0)
    expect(Number(r.csllTotal)).toBe(0)
  })
})

// ===========================================================================

describe('IrpjCsllLRService — trimestres', () => {
  const cases = [
    { comp: '2025-01', label: '2025-T1' },
    { comp: '2025-02', label: '2025-T1' },
    { comp: '2025-03', label: '2025-T1' },
    { comp: '2025-04', label: '2025-T2' },
    { comp: '2025-06', label: '2025-T2' },
    { comp: '2025-07', label: '2025-T3' },
    { comp: '2025-09', label: '2025-T3' },
    { comp: '2025-10', label: '2025-T4' },
    { comp: '2025-12', label: '2025-T4' },
  ]

  for (const { comp, label } of cases) {
    it(`${comp} → trimestre ${label}`, async () => {
      const service = new IrpjCsllLRService()
      const r = await service.apurar(TENANT_ID, EMPRESA_ID, comp)
      expect(r.trimestreLabel).toBe(label)
    })
  }
})

// ===========================================================================

describe('IrpjCsllLRService — prazos', () => {
  it('T1 → prazo 30/04 do mesmo ano', async () => {
    const service = new IrpjCsllLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01')
    expect(r.prazoRecolhimento).toBe('2025-04-30')
  })

  it('T2 → prazo 31/07 do mesmo ano', async () => {
    const service = new IrpjCsllLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')
    expect(r.prazoRecolhimento).toBe('2025-07-31')
  })

  it('T3 → prazo 31/10 do mesmo ano', async () => {
    const service = new IrpjCsllLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-08')
    expect(r.prazoRecolhimento).toBe('2025-10-31')
  })

  it('T4 → prazo 31/01 do ano seguinte', async () => {
    const service = new IrpjCsllLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-11')
    expect(r.prazoRecolhimento).toBe('2026-01-31')
  })
})

// ===========================================================================

describe('IrpjCsllLRService — persistência', () => {
  it('persiste dois registros: IRPJ_LR e CSLL_LR', async () => {
    const service = new IrpjCsllLRService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01', new Decimal(100000))

    expect(mockDb.apuracaoFiscal.upsert).toHaveBeenCalledTimes(2)

    const tipos = mockDb.apuracaoFiscal.upsert.mock.calls.map(
      (c: any) => c[0].where.tenantId_empresaId_competencia_tipo.tipo
    )
    expect(tipos).toContain('IRPJ_LR')
    expect(tipos).toContain('CSLL_LR')
  })

  it('competencia persistida é o trimestreLabel (ex: 2025-T1)', async () => {
    const service = new IrpjCsllLRService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-03')

    const call = mockDb.apuracaoFiscal.upsert.mock.calls[0]
    expect(call[0].where.tenantId_empresaId_competencia_tipo.competencia).toBe('2025-T1')
  })
})

// ===========================================================================

describe('IrpjCsllLRService — auditoria', () => {
  it('registra IRPJ_CSLL_LR_APURADO no audit', async () => {
    const service = new IrpjCsllLRService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01', new Decimal(100000))

    expect(mockAudit.registrar).toHaveBeenCalledOnce()
    const call = mockAudit.registrar.mock.calls[0][0]
    expect(call.evento).toBe('IRPJ_CSLL_LR_APURADO')
    expect(call.tenantId).toBe(TENANT_ID)
  })

  it('audit estadoNovo contém lucroReal, irpjTotal e csllTotal', async () => {
    const service = new IrpjCsllLRService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01', new Decimal(100000))

    const call = mockAudit.registrar.mock.calls[0][0]
    expect(Number(call.estadoNovo.lucroRealTrimestral)).toBe(100000)
    expect(Number(call.estadoNovo.irpjTotal)).toBe(19000)
    expect(Number(call.estadoNovo.csllTotal)).toBe(9000)
  })

  it('audit contém prazoRecolhimento', async () => {
    const service = new IrpjCsllLRService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01')

    const call = mockAudit.registrar.mock.calls[0][0]
    expect(call.estadoNovo.prazoRecolhimento).toBe('2025-04-30')
  })
})
