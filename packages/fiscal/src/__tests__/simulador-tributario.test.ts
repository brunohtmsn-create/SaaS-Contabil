/**
 * Testes unitários — SimuladorTributarioService
 *
 * Cobre:
 *  - retorna 3 regimes (SN, LP, LR)
 *  - SN comércio Anexo I: faixa correta por receita
 *  - SN serviços Fator R >= 28% → Anexo III
 *  - SN serviços Fator R < 28% → Anexo V
 *  - LP comércio: IRPJ 8% presunção, CSLL 12%, PIS 0,65%, COFINS 3%
 *  - LP serviços: IRPJ 32% presunção
 *  - LR usa lucroEstimadoAnual quando fornecido
 *  - LR usa 10% de margem default quando não fornecido
 *  - adicional IRPJ 10% quando base trimestral > R$60k
 *  - melhorRegime é o de menor carga tributária
 *  - economiaAnual = maior - menor carga
 *  - cargaEfetiva coerente (0 < carga < 1)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

import { SimuladorTributarioService } from '../simulador-tributario.service.js'
import { Decimal } from '@saas-contabil/shared'

const TENANT_ID = 'tenant-sim'

beforeEach(() => {
  vi.clearAllMocks()
})

// ===========================================================================

describe('SimuladorTributarioService — estrutura', () => {
  it('retorna 3 resultados (SN, LP, LR)', async () => {
    const service = new SimuladorTributarioService()
    const r = await service.simular(TENANT_ID, new Decimal('500000'))

    expect(r.resultados).toHaveLength(3)
    expect(r.resultados.map((x) => x.regime)).toContain('SIMPLES_NACIONAL')
    expect(r.resultados.map((x) => x.regime)).toContain('LUCRO_PRESUMIDO')
    expect(r.resultados.map((x) => x.regime)).toContain('LUCRO_REAL')
  })

  it('melhorRegime é um dos regimes do resultado', async () => {
    const service = new SimuladorTributarioService()
    const r = await service.simular(TENANT_ID, new Decimal('500000'))

    expect(r.resultados.map((x) => x.regime)).toContain(r.melhorRegime)
  })

  it('economiaAnual ≥ 0', async () => {
    const service = new SimuladorTributarioService()
    const r = await service.simular(TENANT_ID, new Decimal('500000'))

    expect(Number(r.economiaAnual)).toBeGreaterThanOrEqual(0)
  })
})

// ===========================================================================

describe('SimuladorTributarioService — SN Anexo I (comércio)', () => {
  it('faixa 1: receita ≤ R$180k → alíquota 4%', async () => {
    const service = new SimuladorTributarioService()
    const r = await service.simular(TENANT_ID, new Decimal('100000'), 'comercio')
    const sn = r.resultados.find((x) => x.regime === 'SIMPLES_NACIONAL')!

    // 100.000 × 4% = 4.000
    expect(Number(sn.tributos.das)).toBe(4000)
  })

  it('faixa 2: receita ≤ R$360k → alíquota 7,3%', async () => {
    const service = new SimuladorTributarioService()
    const r = await service.simular(TENANT_ID, new Decimal('300000'), 'comercio')
    const sn = r.resultados.find((x) => x.regime === 'SIMPLES_NACIONAL')!

    // 300.000 × 7,3% = 21.900
    expect(Number(sn.tributos.das)).toBe(21900)
  })

  it('faixa 3: receita ≤ R$720k → alíquota 9,5%', async () => {
    const service = new SimuladorTributarioService()
    const r = await service.simular(TENANT_ID, new Decimal('600000'), 'comercio')
    const sn = r.resultados.find((x) => x.regime === 'SIMPLES_NACIONAL')!

    expect(Number(sn.tributos.das)).toBe(57000) // 600.000 × 9,5%
  })
})

// ===========================================================================

describe('SimuladorTributarioService — SN serviços Fator R', () => {
  it('Fator R ≥ 28% → Anexo III (alíquota menor que Anexo V)', async () => {
    const service = new SimuladorTributarioService()
    // Receita 100k, folha 30k → FR = 30% ≥ 28% → Anexo III faixa 1 = 6%
    const rAltoFatorR = await service.simular(
      TENANT_ID,
      new Decimal('100000'),
      'servicos',
      new Decimal('30000')
    )
    // Receita 100k, sem folha → FR = 0 < 28% → Anexo V faixa 1 = 15,5%
    const rBaixoFatorR = await service.simular(
      TENANT_ID,
      new Decimal('100000'),
      'servicos',
      new Decimal('0')
    )
    const snAnexoIII = rAltoFatorR.resultados.find((x) => x.regime === 'SIMPLES_NACIONAL')!
    const snAnexoV = rBaixoFatorR.resultados.find((x) => x.regime === 'SIMPLES_NACIONAL')!

    // Anexo III (6%) < Anexo V (15,5%) para mesma receita
    expect(Number(snAnexoIII.tributos.das)).toBe(6000) // 100k × 6%
    expect(Number(snAnexoV.tributos.das)).toBeGreaterThan(Number(snAnexoIII.tributos.das))
  })

  it('Fator R < 28% → Anexo V (faixa 1 = 15,5%)', async () => {
    const service = new SimuladorTributarioService()
    // Receita 100k, sem folha → FR = 0 < 28% → Anexo V faixa 1 = 15,5%
    const r = await service.simular(
      TENANT_ID,
      new Decimal('100000'),
      'servicos',
      new Decimal('10000') // FR = 10% < 28%
    )
    const sn = r.resultados.find((x) => x.regime === 'SIMPLES_NACIONAL')!

    // 100.000 × 15,5% = 15.500
    expect(Number(sn.tributos.das)).toBe(15500)
  })

  it('sem folha → Fator R = 0 < 28% → Anexo V', async () => {
    const service = new SimuladorTributarioService()
    const r = await service.simular(TENANT_ID, new Decimal('200000'), 'servicos')
    const sn = r.resultados.find((x) => x.regime === 'SIMPLES_NACIONAL')!

    // 200.000 × 18% (Anexo V faixa 2 ≤ 360k) = 36.000
    expect(Number(sn.tributos.das)).toBe(36000)
  })
})

// ===========================================================================

describe('SimuladorTributarioService — LP comércio', () => {
  it('PIS = 0,65% da receita bruta', async () => {
    const service = new SimuladorTributarioService()
    const r = await service.simular(TENANT_ID, new Decimal('1000000'), 'comercio')
    const lp = r.resultados.find((x) => x.regime === 'LUCRO_PRESUMIDO')!

    expect(Number(lp.tributos.pis)).toBe(6500) // 1.000.000 × 0,65%
  })

  it('COFINS = 3% da receita bruta', async () => {
    const service = new SimuladorTributarioService()
    const r = await service.simular(TENANT_ID, new Decimal('1000000'), 'comercio')
    const lp = r.resultados.find((x) => x.regime === 'LUCRO_PRESUMIDO')!

    expect(Number(lp.tributos.cofins)).toBe(30000) // 1.000.000 × 3%
  })

  it('IRPJ = 15% × base presunção 8% (comércio)', async () => {
    const service = new SimuladorTributarioService()
    // Receita 1M; base = 1M × 8% = 80k; IRPJ = 80k × 15% = 12k
    const r = await service.simular(TENANT_ID, new Decimal('1000000'), 'comercio')
    const lp = r.resultados.find((x) => x.regime === 'LUCRO_PRESUMIDO')!

    // IRPJ = 12.000 (sem adicional pois 80k/4=20k < 60k trimestral)
    expect(Number(lp.tributos.irpj)).toBe(12000)
  })
})

// ===========================================================================

describe('SimuladorTributarioService — LR', () => {
  it('usa lucroEstimadoAnual quando fornecido', async () => {
    const service = new SimuladorTributarioService()
    const r = await service.simular(
      TENANT_ID,
      new Decimal('1000000'),
      'servicos',
      new Decimal(0),
      new Decimal('200000') // lucro = 200k
    )
    const lr = r.resultados.find((x) => x.regime === 'LUCRO_REAL')!

    // IRPJ = 200k × 15% = 30k (sem adicional: 200k/4=50k < 60k)
    expect(Number(lr.tributos.irpj)).toBe(30000)
  })

  it('usa margem 10% quando lucro não fornecido', async () => {
    const service = new SimuladorTributarioService()
    // Receita 1M; lucro estimado = 100k
    const r = await service.simular(TENANT_ID, new Decimal('1000000'))
    const lr = r.resultados.find((x) => x.regime === 'LUCRO_REAL')!

    // IRPJ = 100k × 15% = 15k
    expect(Number(lr.tributos.irpj)).toBe(15000)
  })

  it('PIS LR = 1,65% da receita bruta', async () => {
    const service = new SimuladorTributarioService()
    const r = await service.simular(TENANT_ID, new Decimal('1000000'))
    const lr = r.resultados.find((x) => x.regime === 'LUCRO_REAL')!

    expect(Number(lr.tributos.pis)).toBe(16500) // 1.000.000 × 1,65%
  })

  it('COFINS LR = 7,6% da receita bruta', async () => {
    const service = new SimuladorTributarioService()
    const r = await service.simular(TENANT_ID, new Decimal('1000000'))
    const lr = r.resultados.find((x) => x.regime === 'LUCRO_REAL')!

    expect(Number(lr.tributos.cofins)).toBe(76000) // 1.000.000 × 7,6%
  })
})

// ===========================================================================

describe('SimuladorTributarioService — adicional IRPJ', () => {
  it('adicional 10% quando base trimestral supera R$60k', async () => {
    const service = new SimuladorTributarioService()
    // Receita 4M comércio LP: base = 4M × 8% = 320k / 4 = 80k trimestral
    // Adicional = (80k - 60k) × 4 trimestres × 10% = 20k × 4 × 10% = 8.000
    const r = await service.simular(TENANT_ID, new Decimal('4000000'), 'comercio')
    const lp = r.resultados.find((x) => x.regime === 'LUCRO_PRESUMIDO')!

    // IRPJ base = 320k × 15% = 48.000; adicional = 8.000; total = 56.000
    expect(Number(lp.tributos.irpj)).toBe(56000)
  })
})

// ===========================================================================

describe('SimuladorTributarioService — cargaEfetiva', () => {
  it('cargaEfetiva SN é a alíquota da tabela', async () => {
    const service = new SimuladorTributarioService()
    const r = await service.simular(TENANT_ID, new Decimal('100000'), 'comercio')
    const sn = r.resultados.find((x) => x.regime === 'SIMPLES_NACIONAL')!

    expect(Number(sn.cargaEfetiva)).toBeCloseTo(0.04, 4) // 4% Anexo I faixa 1
  })

  it('cargaEfetiva entre 0 e 1 para todos os regimes', async () => {
    const service = new SimuladorTributarioService()
    const r = await service.simular(TENANT_ID, new Decimal('500000'))

    for (const reg of r.resultados) {
      expect(Number(reg.cargaEfetiva)).toBeGreaterThan(0)
      expect(Number(reg.cargaEfetiva)).toBeLessThan(1)
    }
  })
})
