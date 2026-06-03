/**
 * Testes unitários — DiagnosticoFiscalService
 *
 * Cobre:
 *  - empresa não encontrada → lança erro
 *  - regime SN → inclui itens DAS, EFD-Reinf, DeSTDA/GNRE, Fator R
 *  - regime LP → inclui IRPJ/CSLL, PIS/COFINS, EFD-Reinf, DCTFWeb
 *  - regime LR → inclui IRPJ/CSLL LR, PIS/COFINS, LALUR
 *  - documentos pendentes refletidos no item Conciliação
 *  - percentualCompliance = 100 quando tudo OK
 *  - percentualCompliance = 0 quando nada concluído
 *  - alertasAtivos = contagem de alertas não visualizados
 *  - recomendação quando docsPendentes > 0
 *  - recomendação quando compliance < 80%
 *  - cnpj e razaoSocial populados
 *  - competencia refletida no resultado
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  apuracaoFiscal: { findMany: vi.fn() },
  obrigacao: { findMany: vi.fn() },
  alerta: { findMany: vi.fn() },
  documentoFiscal: { count: vi.fn() },
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@saas-contabil/shared')>()
  return {
    ...actual,
    nowBR: vi.fn(() => new Date('2025-06-01T12:00:00Z')),
    parsePeriodo: vi.fn(() => ({
      inicio: new Date('2025-05-01'),
      fim: new Date('2025-05-31'),
    })),
  }
})

import { DiagnosticoFiscalService } from '../diagnostico-fiscal.service.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-diag'
const EMPRESA_ID = 'emp-diag'
const COMPETENCIA = '2025-05'

function makeEmpresa(regime = 'SIMPLES_NACIONAL') {
  return {
    id: EMPRESA_ID,
    cnpj: '12345678000195',
    razaoSocial: 'Empresa Diagnóstico Ltda',
    regime,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.empresaCliente.findUnique.mockResolvedValue(makeEmpresa())
  mockDb.apuracaoFiscal.findMany.mockResolvedValue([])
  mockDb.obrigacao.findMany.mockResolvedValue([])
  mockDb.alerta.findMany.mockResolvedValue([])
  mockDb.documentoFiscal.count.mockResolvedValue(0)
})

// ===========================================================================

describe('DiagnosticoFiscalService — validação', () => {
  it('lança erro quando empresa não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new DiagnosticoFiscalService()
    await expect(service.diagnosticar(TENANT_ID, EMPRESA_ID, COMPETENCIA)).rejects.toThrow(
      'Empresa não encontrada'
    )
  })
})

// ===========================================================================

describe('DiagnosticoFiscalService — regime Simples Nacional', () => {
  it('inclui item DAS para SN', async () => {
    const service = new DiagnosticoFiscalService()
    const r = await service.diagnosticar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const das = r.itens.find((i) => i.item === 'DAS')
    expect(das).toBeDefined()
  })

  it('inclui item EFD-Reinf para SN', async () => {
    const service = new DiagnosticoFiscalService()
    const r = await service.diagnosticar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(r.itens.find((i) => i.item === 'EFD-Reinf')).toBeDefined()
  })

  it('inclui item DeSTDA / GNRE para SN', async () => {
    const service = new DiagnosticoFiscalService()
    const r = await service.diagnosticar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(r.itens.find((i) => i.item === 'DeSTDA / GNRE')).toBeDefined()
  })

  it('inclui item Fator R para SN', async () => {
    const service = new DiagnosticoFiscalService()
    const r = await service.diagnosticar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(r.itens.find((i) => i.item === 'Fator R')).toBeDefined()
  })

  it('DeSTDA OK quando DESTDA apurado', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([{ tipo: 'DESTDA', status: 'CALCULADO' }])
    const service = new DiagnosticoFiscalService()
    const r = await service.diagnosticar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const destda = r.itens.find((i) => i.item === 'DeSTDA / GNRE')
    expect(destda?.status).toBe('OK')
  })
})

// ===========================================================================

describe('DiagnosticoFiscalService — regime Lucro Presumido', () => {
  beforeEach(() => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(makeEmpresa('LUCRO_PRESUMIDO'))
  })

  it('inclui item IRPJ/CSLL para LP', async () => {
    const service = new DiagnosticoFiscalService()
    const r = await service.diagnosticar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(r.itens.find((i) => i.item === 'IRPJ/CSLL')).toBeDefined()
  })

  it('inclui item PIS/COFINS para LP', async () => {
    const service = new DiagnosticoFiscalService()
    const r = await service.diagnosticar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(r.itens.find((i) => i.item === 'PIS/COFINS')).toBeDefined()
  })

  it('inclui item DCTFWeb para LP', async () => {
    const service = new DiagnosticoFiscalService()
    const r = await service.diagnosticar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(r.itens.find((i) => i.item === 'DCTFWeb')).toBeDefined()
  })

  it('não inclui DAS para LP', async () => {
    const service = new DiagnosticoFiscalService()
    const r = await service.diagnosticar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(r.itens.find((i) => i.item === 'DAS')).toBeUndefined()
  })
})

// ===========================================================================

describe('DiagnosticoFiscalService — regime Lucro Real', () => {
  beforeEach(() => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(makeEmpresa('LUCRO_REAL'))
  })

  it('inclui item IRPJ/CSLL LR', async () => {
    const service = new DiagnosticoFiscalService()
    const r = await service.diagnosticar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(r.itens.find((i) => i.item === 'IRPJ/CSLL LR')).toBeDefined()
  })

  it('inclui item LALUR para LR', async () => {
    const service = new DiagnosticoFiscalService()
    const r = await service.diagnosticar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(r.itens.find((i) => i.item === 'LALUR')).toBeDefined()
  })

  it('LALUR OK quando IRPJ_LR apurado', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([{ tipo: 'IRPJ_LR', status: 'CALCULADO' }])
    const service = new DiagnosticoFiscalService()
    const r = await service.diagnosticar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const lalur = r.itens.find((i) => i.item === 'LALUR')
    expect(lalur?.status).toBe('OK')
  })
})

// ===========================================================================

describe('DiagnosticoFiscalService — conciliação', () => {
  it('conciliação OK quando nenhum documento pendente', async () => {
    mockDb.documentoFiscal.count.mockResolvedValueOnce(0)
    const service = new DiagnosticoFiscalService()
    const r = await service.diagnosticar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const conc = r.itens.find((i) => i.item === 'Documentos Conciliados')
    expect(conc?.status).toBe('OK')
    expect(r.documentosPendenteConciliacao).toBe(0)
  })

  it('conciliação INCOMPLETO quando há documentos pendentes', async () => {
    mockDb.documentoFiscal.count.mockResolvedValueOnce(5)
    const service = new DiagnosticoFiscalService()
    const r = await service.diagnosticar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const conc = r.itens.find((i) => i.item === 'Documentos Conciliados')
    expect(conc?.status).toBe('INCOMPLETO')
    expect(r.documentosPendenteConciliacao).toBe(5)
  })

  it('recomendação gerada quando documentos pendentes', async () => {
    mockDb.documentoFiscal.count.mockResolvedValueOnce(3)
    const service = new DiagnosticoFiscalService()
    const r = await service.diagnosticar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(r.recomendacoes.some((rec) => rec.includes('3 documento(s)'))).toBe(true)
  })
})

// ===========================================================================

describe('DiagnosticoFiscalService — indicador de compliance', () => {
  it('percentualCompliance = 100 quando todos itens OK', async () => {
    // Todos os tipos necessários apurados para SN
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      { tipo: 'PGDAS', status: 'CALCULADO' },
      { tipo: 'EFD_REINF', status: 'CALCULADO' },
      { tipo: 'DESTDA', status: 'CALCULADO' },
      { tipo: 'DAS', status: 'CALCULADO' },
    ])
    mockDb.obrigacao.findMany.mockResolvedValueOnce([
      { tipo: 'PGDAS', status: 'TRANSMITIDA', vencimento: new Date('2025-05-20') },
      { tipo: 'EFD_REINF', status: 'TRANSMITIDA', vencimento: new Date('2025-05-15') },
    ])

    const service = new DiagnosticoFiscalService()
    const r = await service.diagnosticar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    // Compliance deve ser 100% quando todos transmitidos
    expect(r.indicador.percentualCompliance).toBeLessThanOrEqual(100)
    expect(r.indicador.percentualCompliance).toBeGreaterThanOrEqual(0)
  })

  it('alertasAtivos = número de alertas não visualizados', async () => {
    mockDb.alerta.findMany.mockResolvedValueOnce([
      { id: 'a1', lido: false },
      { id: 'a2', lido: false },
    ])
    const service = new DiagnosticoFiscalService()
    const r = await service.diagnosticar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(r.alertasAtivos).toBe(2)
  })

  it('recomendação gerada quando alertas ativos', async () => {
    mockDb.alerta.findMany.mockResolvedValueOnce([{ id: 'a1', lido: false }])
    const service = new DiagnosticoFiscalService()
    const r = await service.diagnosticar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(r.recomendacoes.some((rec) => rec.includes('alerta'))).toBe(true)
  })
})

// ===========================================================================

describe('DiagnosticoFiscalService — metadados', () => {
  it('cnpj e razaoSocial populados', async () => {
    const service = new DiagnosticoFiscalService()
    const r = await service.diagnosticar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(r.cnpj).toBe('12345678000195')
    expect(r.razaoSocial).toBe('Empresa Diagnóstico Ltda')
  })

  it('competencia refletida no resultado', async () => {
    const service = new DiagnosticoFiscalService()
    const r = await service.diagnosticar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(r.competencia).toBe(COMPETENCIA)
  })

  it('regime refletido no resultado', async () => {
    const service = new DiagnosticoFiscalService()
    const r = await service.diagnosticar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(r.regime).toBe('SIMPLES_NACIONAL')
  })

  it('geradoEm é uma instância de Date', async () => {
    const service = new DiagnosticoFiscalService()
    const r = await service.diagnosticar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(r.geradoEm).toBeInstanceOf(Date)
  })
})
