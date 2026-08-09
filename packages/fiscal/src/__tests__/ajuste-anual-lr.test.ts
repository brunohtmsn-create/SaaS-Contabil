/**
 * Testes unitários — AjusteAnualLRService
 *
 * Cobre:
 *  - empresa não encontrada → lança erro
 *  - regime LP → lança erro
 *  - lucro zero → tudo zerado, situação QUITADO
 *  - IRPJ 15% sobre lucro real anual
 *  - CSLL 9% sobre lucro real anual
 *  - adicional 10% sobre base > R$240.000/ano
 *  - adições e exclusões LALUR ajustam a base
 *  - base negativa → imposto zero
 *  - sem estimativas → saldo = imposto devido, situação COMPLEMENTAR
 *  - estimativas = imposto → saldo zero, situação QUITADO
 *  - estimativas > imposto → saldo negativo, situação CREDITO
 *  - só contabiliza estimativas (modalidade='ESTIMATIVA')
 *  - prazo complementar = 31/03 do ano seguinte
 *  - persiste com tipo IRPJ_LR e competência YYYY-12
 *  - registra IRPJ_CSLL_LR_APURADO no audit
 *  - estimativas ordenadas por competência
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAudit = { registrar: vi.fn() }

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  apuracaoFiscal: {
    upsert: vi.fn(),
    findMany: vi.fn(),
  },
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => mockAudit),
}))

import { AjusteAnualLRService } from '../ajuste-anual-lr.service.js'
import { Decimal } from '@saas-contabil/shared'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-ajuste'
const EMPRESA_ID = 'emp-ajuste'

const EMPRESA_LR = {
  id: EMPRESA_ID,
  cnpj: '12345678000195',
  razaoSocial: 'Empresa LR Ltda',
  regime: 'LUCRO_REAL',
}

const EMPRESA_LP = {
  id: EMPRESA_ID,
  cnpj: '12345678000195',
  razaoSocial: 'Empresa LP Ltda',
  regime: 'LUCRO_PRESUMIDO',
}

function makeEstimativa(competencia: string, irpjPago: number, csllPago: number) {
  return {
    competencia,
    tipo: 'IRPJ_LR',
    dados: {
      modalidade: 'ESTIMATIVA',
      irpjTotal: String(irpjPago),
      csllDevida: String(csllPago),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_LR)
  mockDb.apuracaoFiscal.upsert.mockResolvedValue({ id: 'ajuste-1' })
  mockDb.apuracaoFiscal.findMany.mockResolvedValue([])
})

// ===========================================================================

describe('AjusteAnualLRService — validações', () => {
  it('lança erro quando empresa não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new AjusteAnualLRService()
    await expect(
      service.apurar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('100000'))
    ).rejects.toThrow('Empresa não encontrada')
  })

  it('lança erro para regime Lucro Presumido', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(EMPRESA_LP)
    const service = new AjusteAnualLRService()
    await expect(
      service.apurar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('100000'))
    ).rejects.toThrow('somente para Lucro Real')
  })
})

// ===========================================================================

describe('AjusteAnualLRService — lucro zero', () => {
  it('tudo zerado e situação QUITADO quando lucro = 0', async () => {
    const service = new AjusteAnualLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, 2025, new Decimal(0))

    expect(Number(r.irpjTotal)).toBe(0)
    expect(Number(r.csllDevida)).toBe(0)
    expect(Number(r.saldoIRPJ)).toBe(0)
    expect(Number(r.saldoCSLL)).toBe(0)
    expect(r.situacaoIRPJ).toBe('QUITADO')
    expect(r.situacaoCSLL).toBe('QUITADO')
  })
})

// ===========================================================================

describe('AjusteAnualLRService — IRPJ 15%', () => {
  it('IRPJ = 15% do lucro real anual sem adicional', async () => {
    const service = new AjusteAnualLRService()
    // R$100.000 × 15% = R$15.000 (sem adicional pois < R$240.000)
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('100000'))

    expect(Number(r.irpjDevido)).toBe(15000)
    expect(Number(r.irpjAdicional)).toBe(0)
    expect(Number(r.irpjTotal)).toBe(15000)
  })
})

// ===========================================================================

describe('AjusteAnualLRService — CSLL 9%', () => {
  it('CSLL = 9% do lucro real anual', async () => {
    const service = new AjusteAnualLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('100000'))

    expect(Number(r.csllDevida)).toBe(9000) // 100.000 × 9%
  })
})

// ===========================================================================

describe('AjusteAnualLRService — adicional 10%', () => {
  it('adicional 10% sobre base que excede R$240.000/ano', async () => {
    const service = new AjusteAnualLRService()
    // Lucro = R$300.000 → excede R$240.000 em R$60.000
    // IRPJ base = 300.000 × 15% = 45.000
    // Adicional = 60.000 × 10% = 6.000
    // Total IRPJ = 51.000
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('300000'))

    expect(Number(r.irpjDevido)).toBe(45000)
    expect(Number(r.irpjAdicional)).toBe(6000)
    expect(Number(r.irpjTotal)).toBe(51000)
  })

  it('sem adicional quando lucro ≤ R$240.000', async () => {
    const service = new AjusteAnualLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('240000'))

    expect(Number(r.irpjAdicional)).toBe(0)
    expect(Number(r.irpjTotal)).toBe(36000) // 240.000 × 15%
  })
})

// ===========================================================================

describe('AjusteAnualLRService — adições e exclusões LALUR', () => {
  it('adições aumentam a base', async () => {
    const service = new AjusteAnualLRService()
    // Lucro = 100.000; adições = 50.000 → base = 150.000
    // IRPJ = 150.000 × 15% = 22.500
    const r = await service.apurar(
      TENANT_ID,
      EMPRESA_ID,
      2025,
      new Decimal('100000'),
      new Decimal('50000')
    )

    expect(Number(r.irpjDevido)).toBe(22500)
    expect(Number(r.baseIRPJ)).toBe(150000)
  })

  it('exclusões reduzem a base', async () => {
    const service = new AjusteAnualLRService()
    // Lucro = 200.000; exclusões = 50.000 → base = 150.000
    const r = await service.apurar(
      TENANT_ID,
      EMPRESA_ID,
      2025,
      new Decimal('200000'),
      new Decimal(0),
      new Decimal('50000')
    )

    expect(Number(r.baseIRPJ)).toBe(150000)
    expect(Number(r.irpjDevido)).toBe(22500)
  })

  it('base negativa resulta em imposto zero', async () => {
    const service = new AjusteAnualLRService()
    // Lucro = 50.000; exclusões = 100.000 → base = −50.000 → clamp a 0
    const r = await service.apurar(
      TENANT_ID,
      EMPRESA_ID,
      2025,
      new Decimal('50000'),
      new Decimal(0),
      new Decimal('100000')
    )

    expect(Number(r.baseIRPJ)).toBe(0)
    expect(Number(r.irpjTotal)).toBe(0)
    expect(Number(r.csllDevida)).toBe(0)
  })
})

// ===========================================================================

describe('AjusteAnualLRService — saldo vs estimativas', () => {
  it('sem estimativas → saldo = imposto, situação COMPLEMENTAR', async () => {
    // mockDb.apuracaoFiscal.findMany já retorna []
    const service = new AjusteAnualLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('100000'))

    expect(r.situacaoIRPJ).toBe('COMPLEMENTAR')
    expect(r.situacaoCSLL).toBe('COMPLEMENTAR')
    expect(Number(r.saldoIRPJ)).toBe(15000) // deve complementar tudo
    expect(Number(r.saldoCSLL)).toBe(9000)
  })

  it('estimativas = imposto → saldo zero, QUITADO', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makeEstimativa('2025-01', 1250, 750),
      makeEstimativa('2025-02', 1250, 750),
      makeEstimativa('2025-03', 1250, 750),
      makeEstimativa('2025-04', 1250, 750),
      makeEstimativa('2025-05', 1250, 750),
      makeEstimativa('2025-06', 1250, 750),
      makeEstimativa('2025-07', 1250, 750),
      makeEstimativa('2025-08', 1250, 750),
      makeEstimativa('2025-09', 1250, 750),
      makeEstimativa('2025-10', 1250, 750),
      makeEstimativa('2025-11', 1250, 750),
      makeEstimativa('2025-12', 1250, 750),
    ])

    const service = new AjusteAnualLRService()
    // Imposto = 100.000 × 15% = 15.000; 12 × 1.250 = 15.000
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('100000'))

    expect(r.situacaoIRPJ).toBe('QUITADO')
    expect(Number(r.saldoIRPJ)).toBe(0)
    expect(r.situacaoCSLL).toBe('QUITADO')
    expect(Number(r.saldoCSLL)).toBe(0)
  })

  it('estimativas > imposto → saldo negativo, CREDITO', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([makeEstimativa('2025-06', 20000, 15000)])

    const service = new AjusteAnualLRService()
    // Imposto IRPJ = 15.000; estimativas = 20.000 → saldo = −5.000
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('100000'))

    expect(r.situacaoIRPJ).toBe('CREDITO')
    expect(Number(r.saldoIRPJ)).toBe(-5000) // 15.000 − 20.000
    expect(r.situacaoCSLL).toBe('CREDITO')
    expect(Number(r.saldoCSLL)).toBe(-6000) // 9.000 − 15.000
  })

  it('apenas estimativas (modalidade=ESTIMATIVA) são contabilizadas', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      // balanço trimestral — NÃO deve ser somado
      {
        competencia: '2025-03',
        tipo: 'IRPJ_LR',
        dados: {
          modalidade: 'TRIMESTRAL',
          irpjTotal: '50000',
          csllDevida: '30000',
        },
      },
      makeEstimativa('2025-06', 5000, 3000),
    ])

    const service = new AjusteAnualLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('100000'))

    expect(Number(r.totalEstimativasIRPJ)).toBe(5000)
    expect(Number(r.totalEstimativasCSLL)).toBe(3000)
    expect(r.estimativasPorMes).toHaveLength(1)
  })
})

// ===========================================================================

describe('AjusteAnualLRService — prazo', () => {
  it('prazo complementar = 31/03 do ano seguinte', async () => {
    const service = new AjusteAnualLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, 2025, new Decimal(0))
    expect(r.prazoComplementar).toBe('2026-03-31')
  })

  it('prazo vira século corretamente para ano 2099', async () => {
    const service = new AjusteAnualLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, 2099, new Decimal(0))
    expect(r.prazoComplementar).toBe('2100-03-31')
  })
})

// ===========================================================================

describe('AjusteAnualLRService — ordenação de estimativas', () => {
  it('estimativas ordenadas por competência', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makeEstimativa('2025-12', 1000, 500),
      makeEstimativa('2025-01', 1000, 500),
      makeEstimativa('2025-06', 1000, 500),
    ])

    const service = new AjusteAnualLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('100000'))

    expect(r.estimativasPorMes[0]!.competencia).toBe('2025-01')
    expect(r.estimativasPorMes[1]!.competencia).toBe('2025-06')
    expect(r.estimativasPorMes[2]!.competencia).toBe('2025-12')
  })
})

// ===========================================================================

describe('AjusteAnualLRService — persistência e auditoria', () => {
  it('persiste com tipo IRPJ_LR e competência YYYY-12', async () => {
    const service = new AjusteAnualLRService()
    await service.apurar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('100000'))

    const call = mockDb.apuracaoFiscal.upsert.mock.calls[0]
    expect(call[0].where.tenantId_empresaId_competencia_tipo.tipo).toBe('IRPJ_LR')
    expect(call[0].where.tenantId_empresaId_competencia_tipo.competencia).toBe('2025-12')
    expect(call[0].create.dados.tipo).toBe('AJUSTE_ANUAL_LR')
  })

  it('registra evento IRPJ_CSLL_LR_APURADO no audit', async () => {
    const service = new AjusteAnualLRService()
    await service.apurar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('100000'))

    expect(mockAudit.registrar).toHaveBeenCalledOnce()
    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.evento).toBe('IRPJ_CSLL_LR_APURADO')
    expect(auditCall.estadoNovo.tipo).toBe('AJUSTE_ANUAL_LR')
  })

  it('audit tenantId correto', async () => {
    const service = new AjusteAnualLRService()
    await service.apurar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('100000'))

    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.tenantId).toBe(TENANT_ID)
  })
})
