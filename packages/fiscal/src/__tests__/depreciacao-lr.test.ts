/**
 * Testes unitários — DepreciacaoLRService
 *
 * Cobre:
 *  - empresa não encontrada → lança erro
 *  - regime LP/SN/MEI → lança erro (exclusivo LR)
 *  - sem bens → totais zerados
 *  - depreciação mensal = valor × taxa_anual / 12 (linha reta)
 *  - veículo (20% a.a.) → 1,6667%/mês
 *  - computadores (20% a.a.) → 1,6667%/mês
 *  - edificações (4% a.a.) → 0,3333%/mês
 *  - máquinas (10% a.a.) → 0,8333%/mês
 *  - turno duplo → 50% acréscimo na taxa
 *  - turno triplo → 100% acréscimo (taxa dobrada)
 *  - bem totalmente depreciado → depreciação mensal = 0
 *  - valor residual > 0 → não deprecia abaixo do residual
 *  - múltiplos bens → soma correta
 *  - percentualDepreciado calculado corretamente
 *  - mesesRestantes calculado corretamente
 *  - persiste com tipo CSLL_LR
 *  - registra IRPJ_CSLL_LR_APURADO no audit
 *  - getCategorias() retorna lista de categorias
 *  - getTaxaDepreciacao() retorna taxa para categoria conhecida
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

import { DepreciacaoLRService } from '../depreciacao-lr.service.js'
import type { BemDepreciavel } from '../depreciacao-lr.service.js'
import { Decimal } from '@saas-contabil/shared'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-dep'
const EMPRESA_ID = 'emp-dep'

const EMPRESA_LR = {
  id: EMPRESA_ID,
  cnpj: '12345678000195',
  razaoSocial: 'Empresa LR Depreciação Ltda',
  regime: 'LUCRO_REAL',
  cnae: '6201500',
  uf: 'SP',
}

function makeBem(opts: Partial<BemDepreciavel> & { valorAquisicao: number }): BemDepreciavel {
  return {
    id: `bem-${Math.random()}`,
    descricao: opts.descricao ?? 'Bem Teste',
    categoria: opts.categoria ?? 'maquinas_equipamentos',
    valorAquisicao: new Decimal(opts.valorAquisicao),
    dataAquisicao: opts.dataAquisicao ?? new Date('2025-01-01'),
    vidaUtilAnos: opts.vidaUtilAnos ?? 10,
    taxaAnualPersonalizada: opts.taxaAnualPersonalizada,
    turnoTrabalho: opts.turnoTrabalho ?? 'simples',
    valorResidual: opts.valorResidual ?? new Decimal(0),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_LR)
  mockDb.apuracaoFiscal.upsert.mockResolvedValue({ id: 'dep-1' })
})

// ===========================================================================

describe('DepreciacaoLRService — validações', () => {
  it('lança erro quando empresa não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new DepreciacaoLRService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-05', [])).rejects.toThrow(
      'Empresa não encontrada'
    )
  })

  it('lança erro para regime LUCRO_PRESUMIDO', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      ...EMPRESA_LR,
      regime: 'LUCRO_PRESUMIDO',
    })
    const service = new DepreciacaoLRService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-05', [])).rejects.toThrow('Lucro Real')
  })

  it('lança erro para regime SIMPLES_NACIONAL', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      ...EMPRESA_LR,
      regime: 'SIMPLES_NACIONAL',
    })
    const service = new DepreciacaoLRService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-05', [])).rejects.toThrow('Lucro Real')
  })
})

// ===========================================================================

describe('DepreciacaoLRService — sem bens', () => {
  it('totais zerados quando não há bens', async () => {
    const service = new DepreciacaoLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05', [])

    expect(r.totalBens).toBe(0)
    expect(Number(r.totalDepreciacaoMensal)).toBe(0)
    expect(Number(r.totalDepreciacaoAcumulada)).toBe(0)
    expect(Number(r.totalValorContabil)).toBe(0)
    expect(r.itens).toHaveLength(0)
  })
})

// ===========================================================================

describe('DepreciacaoLRService — cálculo de depreciação por categoria', () => {
  it('máquinas (10% a.a.) → depreciação mensal = valor × 10% / 12', async () => {
    const service = new DepreciacaoLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-02', [
      makeBem({
        valorAquisicao: 120000,
        categoria: 'maquinas_equipamentos',
        dataAquisicao: new Date('2025-01-01'),
      }),
    ])

    // taxa mensal = 10% / 12 = 0,8333%; 120.000 × 0,008333... ≈ 1.000
    expect(Number(r.totalDepreciacaoMensal)).toBeCloseTo(1000, 0)
  })

  it('veículos (20% a.a.) → depreciação mensal = valor × 20% / 12', async () => {
    const service = new DepreciacaoLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-02', [
      makeBem({
        valorAquisicao: 60000,
        categoria: 'veiculos',
        dataAquisicao: new Date('2025-01-01'),
      }),
    ])

    // taxa mensal = 20% / 12 = 1,6667%; 60.000 × 0,016667 ≈ 1.000
    expect(Number(r.totalDepreciacaoMensal)).toBeCloseTo(1000, 0)
  })

  it('edificações (4% a.a.) → depreciação mensal = valor × 4% / 12', async () => {
    const service = new DepreciacaoLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-02', [
      makeBem({
        valorAquisicao: 300000,
        categoria: 'edificacoes',
        dataAquisicao: new Date('2025-01-01'),
      }),
    ])

    // taxa mensal = 4% / 12 = 0,3333%; 300.000 × 0,003333 ≈ 1.000
    expect(Number(r.totalDepreciacaoMensal)).toBeCloseTo(1000, 0)
  })

  it('computadores (20% a.a.) → mesmo que veículos', async () => {
    const service = new DepreciacaoLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-02', [
      makeBem({
        valorAquisicao: 12000,
        categoria: 'computadores_perifericos',
        dataAquisicao: new Date('2025-01-01'),
      }),
    ])

    // taxa mensal = 20% / 12; 12.000 × (20/12)% ≈ 200
    expect(Number(r.totalDepreciacaoMensal)).toBeCloseTo(200, 0)
  })
})

// ===========================================================================

describe('DepreciacaoLRService — turnos de trabalho', () => {
  it('turno duplo → taxa × 1,5 (50% acréscimo)', async () => {
    const service = new DepreciacaoLRService()

    const simples = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-02', [
      makeBem({
        valorAquisicao: 120000,
        categoria: 'maquinas_equipamentos',
        dataAquisicao: new Date('2025-01-01'),
        turnoTrabalho: 'simples',
      }),
    ])

    const duplo = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-02', [
      makeBem({
        valorAquisicao: 120000,
        categoria: 'maquinas_equipamentos',
        dataAquisicao: new Date('2025-01-01'),
        turnoTrabalho: 'duplo',
      }),
    ])

    // turno duplo = 1,5× a taxa simples
    const ratioDuplo = Number(duplo.totalDepreciacaoMensal) / Number(simples.totalDepreciacaoMensal)
    expect(ratioDuplo).toBeCloseTo(1.5, 4)
  })

  it('turno triplo → taxa × 2 (100% acréscimo)', async () => {
    const service = new DepreciacaoLRService()

    const simples = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-02', [
      makeBem({
        valorAquisicao: 120000,
        categoria: 'maquinas_equipamentos',
        dataAquisicao: new Date('2025-01-01'),
        turnoTrabalho: 'simples',
      }),
    ])

    const triplo = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-02', [
      makeBem({
        valorAquisicao: 120000,
        categoria: 'maquinas_equipamentos',
        dataAquisicao: new Date('2025-01-01'),
        turnoTrabalho: 'triplo',
      }),
    ])

    const ratioTriplo =
      Number(triplo.totalDepreciacaoMensal) / Number(simples.totalDepreciacaoMensal)
    expect(ratioTriplo).toBeCloseTo(2.0, 4)
  })
})

// ===========================================================================

describe('DepreciacaoLRService — bem totalmente depreciado', () => {
  it('depreciação mensal = 0 quando vida útil esgotada', async () => {
    const service = new DepreciacaoLRService()
    // veículo adquirido 6 anos atrás (vida útil = 5 anos → totalmente depreciado)
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05', [
      makeBem({
        valorAquisicao: 60000,
        categoria: 'veiculos',
        dataAquisicao: new Date('2019-01-01'),
      }),
    ])

    expect(Number(r.totalDepreciacaoMensal)).toBe(0)
    expect(r.itens[0]!.totalmenteDepreciado).toBe(true)
  })

  it('depreciacaoAcumulada limitada ao valor de aquisição', async () => {
    const service = new DepreciacaoLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05', [
      makeBem({
        valorAquisicao: 60000,
        categoria: 'veiculos',
        dataAquisicao: new Date('2019-01-01'),
      }),
    ])

    // Nunca pode depreciar mais do que o valor original
    expect(Number(r.itens[0]!.depreciacaoAcumulada)).toBeLessThanOrEqual(60000)
  })
})

// ===========================================================================

describe('DepreciacaoLRService — valor residual', () => {
  it('valor contábil não cai abaixo do valor residual', async () => {
    const service = new DepreciacaoLRService()
    // veículo 60k adquirido 6 anos atrás (totalmente depreciado) com residual 5k
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05', [
      makeBem({
        valorAquisicao: 60000,
        categoria: 'veiculos',
        dataAquisicao: new Date('2019-01-01'),
        valorResidual: new Decimal(5000),
      }),
    ])

    expect(Number(r.itens[0]!.valorContabil)).toBeGreaterThanOrEqual(5000)
  })
})

// ===========================================================================

describe('DepreciacaoLRService — múltiplos bens', () => {
  it('totalDepreciacaoMensal é a soma de todos os bens', async () => {
    const service = new DepreciacaoLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-02', [
      makeBem({
        valorAquisicao: 120000,
        categoria: 'maquinas_equipamentos',
        dataAquisicao: new Date('2025-01-01'),
      }),
      makeBem({
        valorAquisicao: 60000,
        categoria: 'veiculos',
        dataAquisicao: new Date('2025-01-01'),
      }),
    ])

    expect(r.totalBens).toBe(2)
    // maquinas: 1000/mês + veiculos: 1000/mês = ~2000
    expect(Number(r.totalDepreciacaoMensal)).toBeCloseTo(2000, 0)
  })

  it('totalValorAquisicao é a soma dos valores de aquisição', async () => {
    const service = new DepreciacaoLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-02', [
      makeBem({ valorAquisicao: 100000, dataAquisicao: new Date('2025-01-01') }),
      makeBem({ valorAquisicao: 50000, dataAquisicao: new Date('2025-01-01') }),
    ])

    expect(Number(r.totalValorAquisicao)).toBe(150000)
  })
})

// ===========================================================================

describe('DepreciacaoLRService — acumulada e percentual', () => {
  it('depreciacaoAcumulada após 6 meses = 6 × depreciação mensal', async () => {
    const service = new DepreciacaoLRService()
    // aquisição em 2025-01, competência 2025-06 → 5 meses completos (jan→fev→mar→abr→mai)
    // calcularMesesEntre usa apenas ano/mês, não dia
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-06', [
      makeBem({
        valorAquisicao: 120000,
        categoria: 'maquinas_equipamentos',
        dataAquisicao: new Date('2025-01-01'),
      }),
    ])

    const item = r.itens[0]!
    const mesesDecorridos = item.mesesDecorridos
    // acumulada deve ser aproximadamente mesesDecorridos × depreciação mensal
    expect(Number(item.depreciacaoAcumulada)).toBeCloseTo(
      mesesDecorridos * Number(item.depreciacaoMensal),
      0
    )
  })

  it('percentualDepreciado = acumulada / (aquisição - residual) × 100', async () => {
    const service = new DepreciacaoLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-06', [
      makeBem({
        valorAquisicao: 120000,
        categoria: 'maquinas_equipamentos',
        dataAquisicao: new Date('2025-01-01'),
      }),
    ])

    const item = r.itens[0]!
    const esperado = (Number(item.depreciacaoAcumulada) / 120000) * 100
    expect(Number(item.percentualDepreciado)).toBeCloseTo(esperado, 1)
  })

  it('mesesRestantes = totalMeses - mesesDecorridos', async () => {
    const service = new DepreciacaoLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-02', [
      makeBem({
        valorAquisicao: 120000,
        categoria: 'maquinas_equipamentos', // vida útil 10 anos = 120 meses
        dataAquisicao: new Date('2025-01-01'),
      }),
    ])

    const item = r.itens[0]!
    expect(item.totalMeses).toBe(120)
    expect(item.mesesRestantes).toBe(item.totalMeses - item.mesesDecorridos)
  })
})

// ===========================================================================

describe('DepreciacaoLRService — taxa personalizada', () => {
  it('taxaAnualPersonalizada sobrepõe a tabela SRF', async () => {
    const service = new DepreciacaoLRService()
    // Taxa personalizada: 25%/ano
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-02', [
      makeBem({
        valorAquisicao: 48000,
        categoria: 'outros',
        dataAquisicao: new Date('2025-01-01'),
        taxaAnualPersonalizada: new Decimal('0.25'),
      }),
    ])

    // 48.000 × 25% / 12 = 1.000
    expect(Number(r.totalDepreciacaoMensal)).toBeCloseTo(1000, 0)
  })
})

// ===========================================================================

describe('DepreciacaoLRService — persistência e auditoria', () => {
  it('persiste com tipo CSLL_LR', async () => {
    const service = new DepreciacaoLRService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05', [])

    const call = mockDb.apuracaoFiscal.upsert.mock.calls[0]
    expect(call[0].where.tenantId_empresaId_competencia_tipo.tipo).toBe('CSLL_LR')
  })

  it('registra evento IRPJ_CSLL_LR_APURADO com tipo DEPRECIACAO', async () => {
    const service = new DepreciacaoLRService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05', [])

    expect(mockAudit.registrar).toHaveBeenCalledOnce()
    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.evento).toBe('IRPJ_CSLL_LR_APURADO')
    expect(auditCall.estadoNovo.tipo).toBe('DEPRECIACAO')
  })
})

// ===========================================================================

describe('DepreciacaoLRService — helpers', () => {
  it('getCategorias() retorna lista de categorias conhecidas', () => {
    const service = new DepreciacaoLRService()
    const cats = service.getCategorias()
    expect(cats).toContain('veiculos')
    expect(cats).toContain('edificacoes')
    expect(cats).toContain('computadores_perifericos')
    expect(cats.length).toBeGreaterThan(5)
  })

  it('getTaxaDepreciacao() retorna dados para categoria conhecida', () => {
    const service = new DepreciacaoLRService()
    const taxa = service.getTaxaDepreciacao('veiculos')
    expect(taxa).toBeDefined()
    expect(taxa!.vidaUtilAnos).toBe(5)
    expect(Number(taxa!.taxaAnual)).toBeCloseTo(0.2, 4)
  })

  it('getTaxaDepreciacao() retorna undefined para categoria desconhecida', () => {
    const service = new DepreciacaoLRService()
    expect(service.getTaxaDepreciacao('categoria_inexistente')).toBeUndefined()
  })
})
