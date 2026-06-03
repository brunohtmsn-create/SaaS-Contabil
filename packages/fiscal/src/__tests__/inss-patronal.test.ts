/**
 * Testes unitários — INSSPatronalService
 *
 * Cobre:
 *  - empresa não encontrada → lança erro
 *  - sem funcionários → totais zerados
 *  - CPP = 20% da folha
 *  - GILRAT grau leve = 1%, médio = 2%, grave = 3%
 *  - FAP < 1 reduz GILRAT; FAP > 1 aumenta; FAP = 1 mantém
 *  - GILRAT limitado entre 50% e 200% do RAT base pelo FAP
 *  - terceiros por atividade: comércio 5,8%, indústria 5,7%, serviços 5,1%
 *  - totalPatronal = CPP + GILRAT + terceiros
 *  - múltiplos funcionários somados corretamente
 *  - adicional13 e adicionaisVariaveis incluídos na base
 *  - prazo = dia 20 do mês seguinte
 *  - persiste com tipo CSLL_LR
 *  - registra DCTFWEB_TRANSMITIDA no audit
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

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

import { INSSPatronalService } from '../inss-patronal.service.js'
import type { FuncionarioINSS } from '../inss-patronal.service.js'
import { Decimal } from '@saas-contabil/shared'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-inss'
const EMPRESA_ID = 'emp-inss'

const EMPRESA = {
  id: EMPRESA_ID,
  cnpj: '12345678000195',
  razaoSocial: 'Empresa INSS Ltda',
  regime: 'LUCRO_PRESUMIDO',
  cnae: '4711301',
  uf: 'SP',
}

function makeFuncionario(opts: {
  salarioBase: number
  nome?: string
  adicional13?: number
  adicionaisVariaveis?: number
}): FuncionarioINSS {
  return {
    id: `func-${Math.random()}`,
    nome: opts.nome ?? 'Funcionário Teste',
    salarioBase: new Decimal(opts.salarioBase),
    adicional13: opts.adicional13 ? new Decimal(opts.adicional13) : undefined,
    adicionaisVariaveis: opts.adicionaisVariaveis
      ? new Decimal(opts.adicionaisVariaveis)
      : undefined,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA)
  mockDb.apuracaoFiscal.upsert.mockResolvedValue({ id: 'inss-1' })
})

// ===========================================================================

describe('INSSPatronalService — validações', () => {
  it('lança erro quando empresa não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new INSSPatronalService()
    await expect(service.calcular(TENANT_ID, EMPRESA_ID, '2025-05', [])).rejects.toThrow(
      'Empresa não encontrada'
    )
  })
})

// ===========================================================================

describe('INSSPatronalService — sem funcionários', () => {
  it('totais zerados quando não há funcionários', async () => {
    const service = new INSSPatronalService()
    const r = await service.calcular(TENANT_ID, EMPRESA_ID, '2025-05', [])

    expect(r.totalFuncionarios).toBe(0)
    expect(Number(r.totalFolha)).toBe(0)
    expect(Number(r.totalCPP)).toBe(0)
    expect(Number(r.totalGILRAT)).toBe(0)
    expect(Number(r.totalTerceiros)).toBe(0)
    expect(Number(r.totalPatronal)).toBe(0)
  })
})

// ===========================================================================

describe('INSSPatronalService — CPP (20%)', () => {
  it('CPP = 20% da folha', async () => {
    const service = new INSSPatronalService()
    const r = await service.calcular(TENANT_ID, EMPRESA_ID, '2025-05', [
      makeFuncionario({ salarioBase: 10000 }),
    ])

    expect(Number(r.totalCPP)).toBe(2000) // 10.000 × 20%
  })

  it('CPP múltiplos funcionários = 20% da folha total', async () => {
    const service = new INSSPatronalService()
    const r = await service.calcular(TENANT_ID, EMPRESA_ID, '2025-05', [
      makeFuncionario({ salarioBase: 5000 }),
      makeFuncionario({ salarioBase: 5000 }),
    ])

    expect(Number(r.totalCPP)).toBe(2000) // 10.000 × 20%
  })
})

// ===========================================================================

describe('INSSPatronalService — GILRAT', () => {
  it('GILRAT grau leve = 1% (FAP=1)', async () => {
    const service = new INSSPatronalService()
    const r = await service.calcular(
      TENANT_ID,
      EMPRESA_ID,
      '2025-05',
      [makeFuncionario({ salarioBase: 10000 })],
      'leve'
    )

    expect(Number(r.totalGILRAT)).toBe(100) // 10.000 × 1%
  })

  it('GILRAT grau médio = 2% (FAP=1)', async () => {
    const service = new INSSPatronalService()
    const r = await service.calcular(
      TENANT_ID,
      EMPRESA_ID,
      '2025-05',
      [makeFuncionario({ salarioBase: 10000 })],
      'medio'
    )

    expect(Number(r.totalGILRAT)).toBe(200) // 10.000 × 2%
  })

  it('GILRAT grau grave = 3% (FAP=1)', async () => {
    const service = new INSSPatronalService()
    const r = await service.calcular(
      TENANT_ID,
      EMPRESA_ID,
      '2025-05',
      [makeFuncionario({ salarioBase: 10000 })],
      'grave'
    )

    expect(Number(r.totalGILRAT)).toBe(300) // 10.000 × 3%
  })

  it('FAP=0,5 reduz GILRAT pela metade (limite mínimo 50%)', async () => {
    const service = new INSSPatronalService()
    const r = await service.calcular(
      TENANT_ID,
      EMPRESA_ID,
      '2025-05',
      [makeFuncionario({ salarioBase: 10000 })],
      'medio',
      new Decimal('0.5')
    )

    // GILRAT base = 2%; FAP=0,5 → 1%; mínimo = 2% × 0,5 = 1% → OK
    expect(Number(r.totalGILRAT)).toBe(100) // 10.000 × 1%
  })

  it('FAP=2,0 dobra GILRAT (limite máximo 200%)', async () => {
    const service = new INSSPatronalService()
    const r = await service.calcular(
      TENANT_ID,
      EMPRESA_ID,
      '2025-05',
      [makeFuncionario({ salarioBase: 10000 })],
      'medio',
      new Decimal('2.0')
    )

    // GILRAT base = 2%; FAP=2,0 → 4%; máximo = 2% × 2 = 4% → OK
    expect(Number(r.totalGILRAT)).toBe(400) // 10.000 × 4%
  })

  it('FAP excessivamente baixo limitado ao mínimo (50% do RAT base)', async () => {
    const service = new INSSPatronalService()
    const r = await service.calcular(
      TENANT_ID,
      EMPRESA_ID,
      '2025-05',
      [makeFuncionario({ salarioBase: 10000 })],
      'medio',
      new Decimal('0.1') // FAP muito baixo
    )

    // mínimo = 2% × 0,5 = 1%; não pode ir abaixo disso
    expect(Number(r.totalGILRAT)).toBeGreaterThanOrEqual(100)
  })
})

// ===========================================================================

describe('INSSPatronalService — terceiros', () => {
  it('terceiros comércio = 5,8%', async () => {
    const service = new INSSPatronalService()
    const r = await service.calcular(
      TENANT_ID,
      EMPRESA_ID,
      '2025-05',
      [makeFuncionario({ salarioBase: 10000 })],
      'medio',
      new Decimal('1.0'),
      'comercio'
    )

    expect(Number(r.totalTerceiros)).toBe(580) // 10.000 × 5,8%
  })

  it('terceiros indústria = 5,7%', async () => {
    const service = new INSSPatronalService()
    const r = await service.calcular(
      TENANT_ID,
      EMPRESA_ID,
      '2025-05',
      [makeFuncionario({ salarioBase: 10000 })],
      'medio',
      new Decimal('1.0'),
      'industria'
    )

    expect(Number(r.totalTerceiros)).toBe(570) // 10.000 × 5,7%
  })

  it('terceiros serviços = 5,1%', async () => {
    const service = new INSSPatronalService()
    const r = await service.calcular(
      TENANT_ID,
      EMPRESA_ID,
      '2025-05',
      [makeFuncionario({ salarioBase: 10000 })],
      'medio',
      new Decimal('1.0'),
      'servicos'
    )

    expect(Number(r.totalTerceiros)).toBe(510) // 10.000 × 5,1%
  })
})

// ===========================================================================

describe('INSSPatronalService — totalPatronal', () => {
  it('totalPatronal = CPP + GILRAT + terceiros', async () => {
    const service = new INSSPatronalService()
    const r = await service.calcular(
      TENANT_ID,
      EMPRESA_ID,
      '2025-05',
      [makeFuncionario({ salarioBase: 10000 })],
      'medio',
      new Decimal('1.0'),
      'comercio'
    )

    const esperado = Number(r.totalCPP) + Number(r.totalGILRAT) + Number(r.totalTerceiros)
    expect(Number(r.totalPatronal)).toBe(esperado)
    // 2.000 + 200 + 580 = 2.780
    expect(Number(r.totalPatronal)).toBe(2780)
  })
})

// ===========================================================================

describe('INSSPatronalService — base de cálculo', () => {
  it('adicional13 incluído na base', async () => {
    const service = new INSSPatronalService()
    const r = await service.calcular(TENANT_ID, EMPRESA_ID, '2025-05', [
      makeFuncionario({ salarioBase: 5000, adicional13: 5000 }),
    ])

    // base = 5.000 + 5.000 = 10.000; CPP = 2.000
    expect(Number(r.totalCPP)).toBe(2000)
    expect(Number(r.totalFolha)).toBe(10000)
  })

  it('adicionaisVariaveis incluídos na base', async () => {
    const service = new INSSPatronalService()
    const r = await service.calcular(TENANT_ID, EMPRESA_ID, '2025-05', [
      makeFuncionario({ salarioBase: 8000, adicionaisVariaveis: 2000 }),
    ])

    expect(Number(r.totalFolha)).toBe(10000)
    expect(Number(r.totalCPP)).toBe(2000)
  })
})

// ===========================================================================

describe('INSSPatronalService — prazo', () => {
  it('prazo = dia 20 do mês seguinte — competência 2025-05', async () => {
    const service = new INSSPatronalService()
    const r = await service.calcular(TENANT_ID, EMPRESA_ID, '2025-05', [])
    expect(r.prazoRecolhimento).toBe('2025-06-20')
  })

  it('prazo vira ano corretamente — competência 2025-12', async () => {
    const service = new INSSPatronalService()
    const r = await service.calcular(TENANT_ID, EMPRESA_ID, '2025-12', [])
    expect(r.prazoRecolhimento).toBe('2026-01-20')
  })
})

// ===========================================================================

describe('INSSPatronalService — persistência e auditoria', () => {
  it('persiste com tipo CSLL_LR', async () => {
    const service = new INSSPatronalService()
    await service.calcular(TENANT_ID, EMPRESA_ID, '2025-05', [])

    const call = mockDb.apuracaoFiscal.upsert.mock.calls[0]
    expect(call[0].where.tenantId_empresaId_competencia_tipo.tipo).toBe('CSLL_LR')
    expect(call[0].create.dados.tipo).toBe('INSS_PATRONAL')
  })

  it('registra evento DCTFWEB_TRANSMITIDA no audit', async () => {
    const service = new INSSPatronalService()
    await service.calcular(TENANT_ID, EMPRESA_ID, '2025-05', [])

    expect(mockAudit.registrar).toHaveBeenCalledOnce()
    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.evento).toBe('DCTFWEB_TRANSMITIDA')
    expect(auditCall.estadoNovo.tipo).toBe('INSS_PATRONAL')
  })

  it('audit tenantId correto', async () => {
    const service = new INSSPatronalService()
    await service.calcular(TENANT_ID, EMPRESA_ID, '2025-05', [])

    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.tenantId).toBe(TENANT_ID)
  })
})
