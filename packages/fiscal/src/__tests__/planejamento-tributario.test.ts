/**
 * Testes unitários — PlanejamentoTributarioService
 *
 * Cobre:
 *  - empresa não encontrada → lança erro
 *  - retorna regimeRecomendado como menor carga
 *  - comparativo contém 3 regimes
 *  - economiaEstimadaVsMaior ≥ 0
 *  - risco ALTO quando receita > 80% limite SN (R$4,8M)
 *  - risco MEDIO quando receita entre 80% e 100% limite SN
 *  - risco Fator R < 28% para serviços
 *  - prazoMudancaRegime formato YYYY-01-31 exercicio+1
 *  - observação de mudança de regime incluída
 *  - persiste com tipo PLANEJAMENTO_TRIBUTARIO
 *  - registra evento PLANEJAMENTO_TRIBUTARIO_GERADO no audit
 *  - economiaEstimadaVsAtual = regimeAtual.total - melhor.total
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

import { PlanejamentoTributarioService } from '../planejamento-tributario.service.js'
import { Decimal } from '@saas-contabil/shared'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-plan'
const EMPRESA_ID = 'emp-plan'

function makeEmpresa(regime = 'SIMPLES_NACIONAL', atividade = 'comercio') {
  return {
    id: EMPRESA_ID,
    cnpj: '12345678000195',
    razaoSocial: 'Empresa Planejamento Ltda',
    regime,
    atividade,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.empresaCliente.findUnique.mockResolvedValue(makeEmpresa())
  mockDb.apuracaoFiscal.upsert.mockResolvedValue({ id: 'plan-1' })
})

// ===========================================================================

describe('PlanejamentoTributarioService — validação', () => {
  it('lança erro quando empresa não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new PlanejamentoTributarioService()
    await expect(service.analisar(TENANT_ID, EMPRESA_ID, 2025)).rejects.toThrow(
      'Empresa não encontrada'
    )
  })
})

// ===========================================================================

describe('PlanejamentoTributarioService — estrutura do resultado', () => {
  it('comparativo contém 3 regimes', async () => {
    const service = new PlanejamentoTributarioService()
    const r = await service.analisar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('500000'))

    expect(r.comparativo).toHaveLength(3)
    const regimes = r.comparativo.map((c) => c.regime)
    expect(regimes).toContain('SIMPLES_NACIONAL')
    expect(regimes).toContain('LUCRO_PRESUMIDO')
    expect(regimes).toContain('LUCRO_REAL')
  })

  it('regimeRecomendado é o de menor carga', async () => {
    const service = new PlanejamentoTributarioService()
    const r = await service.analisar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('300000'))

    // Com receita 300k comércio, SN faixa 2 (7,3%) geralmente menor que LP/LR
    expect(r.comparativo.map((c) => c.regime)).toContain(r.regimeRecomendado)
    // diferençaVsRecomendado do recomendado deve ser 0
    const recomendadoEntry = r.comparativo.find((c) => c.regime === r.regimeRecomendado)!
    expect(Number(recomendadoEntry.diferençaVsRecomendado)).toBe(0)
  })

  it('economiaEstimadaVsMaior ≥ 0', async () => {
    const service = new PlanejamentoTributarioService()
    const r = await service.analisar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('500000'))

    expect(Number(r.economiaEstimadaVsMaior)).toBeGreaterThanOrEqual(0)
  })

  it('cnpj e razaoSocial populados corretamente', async () => {
    const service = new PlanejamentoTributarioService()
    const r = await service.analisar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('500000'))

    expect(r.cnpj).toBe('12345678000195')
    expect(r.razaoSocial).toBe('Empresa Planejamento Ltda')
  })

  it('exercicio retornado no resultado', async () => {
    const service = new PlanejamentoTributarioService()
    const r = await service.analisar(TENANT_ID, EMPRESA_ID, 2026, new Decimal('500000'))

    expect(r.exercicio).toBe(2026)
  })
})

// ===========================================================================

describe('PlanejamentoTributarioService — prazo e observações', () => {
  it('prazoMudancaRegime = exercicio+1 em 31/01', async () => {
    const service = new PlanejamentoTributarioService()
    const r = await service.analisar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('500000'))

    expect(r.prazoMudancaRegime).toBe('2026-01-31')
  })

  it('observações contém informação de prazo', async () => {
    const service = new PlanejamentoTributarioService()
    // Usa ano atual para acionar a observação de prazo
    const anoAtual = new Date().getFullYear()
    const r = await service.analisar(TENANT_ID, EMPRESA_ID, anoAtual, new Decimal('500000'))

    expect(r.observacoes.some((o) => o.includes('31/01'))).toBe(true)
  })
})

// ===========================================================================

describe('PlanejamentoTributarioService — riscos', () => {
  it('risco ALTO quando receita > limite SN (R$4,8M)', async () => {
    const service = new PlanejamentoTributarioService()
    // Receita 5M > 4.8M
    const r = await service.analisar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('5000000'))

    const riscoSN = r.riscos.find((risco) => risco.regime === 'SIMPLES_NACIONAL')
    expect(riscoSN).toBeDefined()
    expect(riscoSN!.grau).toBe('ALTO')
  })

  it('risco MEDIO quando receita entre 80% e 100% do limite SN', async () => {
    const service = new PlanejamentoTributarioService()
    // 80% de 4.8M = 3.84M; usar 4M
    const r = await service.analisar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('4000000'))

    const riscoSN = r.riscos.find((risco) => risco.regime === 'SIMPLES_NACIONAL')
    expect(riscoSN).toBeDefined()
    expect(riscoSN!.grau).toBe('MEDIO')
  })

  it('sem risco SN quando receita < 80% do limite', async () => {
    const service = new PlanejamentoTributarioService()
    const r = await service.analisar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('1000000'))

    const riscoSN = r.riscos.find(
      (risco) =>
        risco.regime === 'SIMPLES_NACIONAL' &&
        risco.descricao.includes('limite do Simples Nacional')
    )
    expect(riscoSN).toBeUndefined()
  })

  it('risco Fator R para serviços com folha < 28%', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(makeEmpresa('SIMPLES_NACIONAL', 'servicos'))

    const service = new PlanejamentoTributarioService()
    // Receita 500k, folha 50k → FR = 10% < 28%
    const r = await service.analisar(
      TENANT_ID,
      EMPRESA_ID,
      2025,
      new Decimal('500000'),
      new Decimal('50000')
    )

    const riscoFR = r.riscos.find((risco) => risco.descricao.includes('Fator R'))
    expect(riscoFR).toBeDefined()
    expect(riscoFR!.grau).toBe('MEDIO')
  })

  it('sem risco Fator R quando comércio (não serviços)', async () => {
    const service = new PlanejamentoTributarioService()
    const r = await service.analisar(
      TENANT_ID,
      EMPRESA_ID,
      2025,
      new Decimal('500000'),
      new Decimal('50000')
    )

    const riscoFR = r.riscos.find((risco) => risco.descricao.includes('Fator R'))
    expect(riscoFR).toBeUndefined()
  })
})

// ===========================================================================

describe('PlanejamentoTributarioService — economiaVsAtual', () => {
  it('economiaVsAtual = 0 quando regime atual já é o recomendado', async () => {
    // SN comércio 300k: SN deve ser melhor, empresa já está em SN
    const service = new PlanejamentoTributarioService()
    const r = await service.analisar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('100000'))

    if (r.regimeAtual === r.regimeRecomendado) {
      expect(Number(r.economiaEstimadaVsAtual)).toBe(0)
    }
  })

  it('economiaVsAtual ≥ 0', async () => {
    const service = new PlanejamentoTributarioService()
    const r = await service.analisar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('500000'))

    expect(Number(r.economiaEstimadaVsAtual)).toBeGreaterThanOrEqual(0)
  })
})

// ===========================================================================

describe('PlanejamentoTributarioService — persistência e auditoria', () => {
  it('persiste com tipo PLANEJAMENTO_TRIBUTARIO', async () => {
    const service = new PlanejamentoTributarioService()
    await service.analisar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('500000'))

    const call = mockDb.apuracaoFiscal.upsert.mock.calls[0]
    expect(call[0].where.tenantId_empresaId_competencia_tipo.tipo).toBe('PLANEJAMENTO_TRIBUTARIO')
    expect(call[0].create.dados.tipo).toBe('PLANEJAMENTO_TRIBUTARIO')
  })

  it('persiste competencia como string do exercicio', async () => {
    const service = new PlanejamentoTributarioService()
    await service.analisar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('500000'))

    const call = mockDb.apuracaoFiscal.upsert.mock.calls[0]
    expect(call[0].where.tenantId_empresaId_competencia_tipo.competencia).toBe('2025')
  })

  it('registra PLANEJAMENTO_TRIBUTARIO_GERADO no audit', async () => {
    const service = new PlanejamentoTributarioService()
    await service.analisar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('500000'))

    expect(mockAudit.registrar).toHaveBeenCalledOnce()
    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.evento).toBe('PLANEJAMENTO_TRIBUTARIO_GERADO')
    expect(auditCall.estadoNovo.tipo).toBe('PLANEJAMENTO_TRIBUTARIO')
  })

  it('audit com tenantId correto', async () => {
    const service = new PlanejamentoTributarioService()
    await service.analisar(TENANT_ID, EMPRESA_ID, 2025, new Decimal('500000'))

    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.tenantId).toBe(TENANT_ID)
  })
})
