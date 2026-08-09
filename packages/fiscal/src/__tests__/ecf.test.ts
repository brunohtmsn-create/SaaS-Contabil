/**
 * Testes unitários — ECFService
 *
 * Cobre:
 *  - empresa não encontrada → lança erro
 *  - regime SN/MEI → lança erro
 *  - LP → gera ECF com 4 trimestres
 *  - LR → também gera ECF
 *  - trimestres sem apuração → zero
 *  - 4 trimestres apurados → consolida anual
 *  - receita anual = soma dos trimestres
 *  - totalDevidoAnual = irpj + csll
 *  - dataEntrega = 31/07 do ano seguinte
 *  - persiste no banco com tipo ECF
 *  - registra ECF_GERADO no audit
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAudit = { registrar: vi.fn() }

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  apuracaoFiscal: { findMany: vi.fn(), upsert: vi.fn() },
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => mockAudit),
}))

import { ECFService } from '../ecf.service.js'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-ecf'
const EMPRESA_ID = 'emp-ecf'

const EMPRESA_LP = {
  id: EMPRESA_ID,
  cnpj: '12345678000195',
  razaoSocial: 'Empresa ECF Ltda',
  regime: 'LUCRO_PRESUMIDO',
  cnae: '4711301',
}

function makeTrimestre(label: string, receita: number, irpj: number, csll: number) {
  return {
    id: `ap-${label}`,
    competencia: label,
    tipo: 'IRPJ_LP',
    dados: {
      receitaBrutaTrimestral: receita.toString(),
      baseCalculoIRPJ: (receita * 0.08).toString(),
      baseCalculoCSLL: (receita * 0.12).toString(),
      irpjNormal: irpj.toString(),
      irpjAdicional: '0',
      irpjTotal: irpj.toString(),
      csllTotal: csll.toString(),
      totalDevido: (irpj + csll).toString(),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_LP)
  mockDb.apuracaoFiscal.findMany.mockResolvedValue([])
  mockDb.apuracaoFiscal.upsert.mockResolvedValue({ id: 'ecf-1' })
})

// ===========================================================================

describe('ECFService — validações', () => {
  it('lança erro quando empresa não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new ECFService()
    await expect(service.gerar(TENANT_ID, EMPRESA_ID, 2025)).rejects.toThrow(
      'Empresa não encontrada'
    )
  })

  it('lança erro para regime SIMPLES_NACIONAL', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      ...EMPRESA_LP,
      regime: 'SIMPLES_NACIONAL',
    })
    const service = new ECFService()
    await expect(service.gerar(TENANT_ID, EMPRESA_ID, 2025)).rejects.toThrow('Lucro Presumido')
  })

  it('lança erro para regime MEI', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ ...EMPRESA_LP, regime: 'MEI' })
    const service = new ECFService()
    await expect(service.gerar(TENANT_ID, EMPRESA_ID, 2025)).rejects.toThrow('Lucro Presumido')
  })

  it('aceita regime LUCRO_REAL', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ ...EMPRESA_LP, regime: 'LUCRO_REAL' })
    const service = new ECFService()
    await expect(service.gerar(TENANT_ID, EMPRESA_ID, 2025)).resolves.not.toThrow()
  })
})

// ===========================================================================

describe('ECFService — estrutura do resultado', () => {
  it('retorna 4 trimestres', async () => {
    const service = new ECFService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, 2025)
    expect(resultado.trimestres).toHaveLength(4)
  })

  it('trimestres têm labels corretos', async () => {
    const service = new ECFService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, 2025)
    const labels = resultado.trimestres.map((t) => t.trimestre)
    expect(labels).toEqual(['2025-T1', '2025-T2', '2025-T3', '2025-T4'])
  })

  it('dataEntrega = 31/07 do ano seguinte', async () => {
    const service = new ECFService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, 2025)
    expect(resultado.dataEntrega).toBe('2026-07-31')
  })

  it('dataEntrega para 2024 = 2025-07-31', async () => {
    const service = new ECFService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, 2024)
    expect(resultado.dataEntrega).toBe('2025-07-31')
  })

  it('situacao = GERADO', async () => {
    const service = new ECFService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, 2025)
    expect(resultado.situacao).toBe('GERADO')
  })

  it('cnpj e ano estão no resultado', async () => {
    const service = new ECFService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, 2025)
    expect(resultado.cnpj).toBe(EMPRESA_LP.cnpj)
    expect(resultado.ano).toBe(2025)
  })
})

// ===========================================================================

describe('ECFService — cálculo com trimestres sem apuração', () => {
  it('todos zerados quando não há apurações', async () => {
    const service = new ECFService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, 2025)

    expect(Number(resultado.receitaBrutaAnual)).toBe(0)
    expect(Number(resultado.irpjAnual)).toBe(0)
    expect(Number(resultado.csllAnual)).toBe(0)
    expect(Number(resultado.totalDevidoAnual)).toBe(0)
  })

  it('trimestres sem apuração têm valores zerados', async () => {
    const service = new ECFService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, 2025)

    for (const t of resultado.trimestres) {
      expect(Number(t.receita)).toBe(0)
      expect(Number(t.irpjTotal)).toBe(0)
      expect(Number(t.csllTotal)).toBe(0)
    }
  })
})

// ===========================================================================

describe('ECFService — consolidação anual', () => {
  it('receita anual = soma dos 4 trimestres', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makeTrimestre('2025-T1', 100000, 1200, 1440),
      makeTrimestre('2025-T2', 150000, 1800, 2160),
      makeTrimestre('2025-T3', 120000, 1440, 1728),
      makeTrimestre('2025-T4', 130000, 1560, 1872),
    ])

    const service = new ECFService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, 2025)

    expect(Number(resultado.receitaBrutaAnual)).toBe(500000)
  })

  it('totalDevidoAnual = irpjAnual + csllAnual', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makeTrimestre('2025-T1', 100000, 1200, 1440),
      makeTrimestre('2025-T2', 150000, 1800, 2160),
    ])

    const service = new ECFService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, 2025)

    const esperado = Number(resultado.irpjAnual) + Number(resultado.csllAnual)
    expect(Number(resultado.totalDevidoAnual)).toBe(esperado)
  })

  it('apenas trimestres presentes contribuem — parcial 2 trimestres', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makeTrimestre('2025-T1', 100000, 1200, 1440),
      makeTrimestre('2025-T2', 200000, 2400, 2880),
    ])

    const service = new ECFService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, 2025)

    expect(Number(resultado.receitaBrutaAnual)).toBe(300000)
    expect(Number(resultado.irpjAnual)).toBe(3600)
    expect(Number(resultado.csllAnual)).toBe(4320)
  })

  it('trimestre presente tem valores corretos', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makeTrimestre('2025-T3', 80000, 960, 1152),
    ])

    const service = new ECFService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, 2025)

    const t3 = resultado.trimestres.find((t) => t.trimestre === '2025-T3')!
    expect(Number(t3.receita)).toBe(80000)
    expect(Number(t3.irpjTotal)).toBe(960)
    expect(Number(t3.csllTotal)).toBe(1152)
  })
})

// ===========================================================================

describe('ECFService — persistência', () => {
  it('persiste com tipo ECF', async () => {
    const service = new ECFService()
    await service.gerar(TENANT_ID, EMPRESA_ID, 2025)

    const upsertCall = mockDb.apuracaoFiscal.upsert.mock.calls[0]
    expect(upsertCall[0].where.tenantId_empresaId_competencia_tipo.tipo).toBe('ECF')
  })

  it('competência persistida = ano como string', async () => {
    const service = new ECFService()
    await service.gerar(TENANT_ID, EMPRESA_ID, 2025)

    const upsertCall = mockDb.apuracaoFiscal.upsert.mock.calls[0]
    expect(upsertCall[0].where.tenantId_empresaId_competencia_tipo.competencia).toBe('2025')
  })

  it('status = CALCULADO', async () => {
    const service = new ECFService()
    await service.gerar(TENANT_ID, EMPRESA_ID, 2025)

    const upsertCall = mockDb.apuracaoFiscal.upsert.mock.calls[0]
    expect(upsertCall[0].create.status).toBe('CALCULADO')
  })

  it('busca apurações IRPJ_LP dos 4 trimestres do ano (LP)', async () => {
    const service = new ECFService()
    await service.gerar(TENANT_ID, EMPRESA_ID, 2025)

    const findCall = mockDb.apuracaoFiscal.findMany.mock.calls[0][0]
    expect(findCall.where.tipo).toBe('IRPJ_LP')
    expect(findCall.where.competencia.in).toEqual(['2025-T1', '2025-T2', '2025-T3', '2025-T4'])
    expect(findCall.where.tenantId).toBe(TENANT_ID)
    expect(findCall.where.empresaId).toBe(EMPRESA_ID)
  })

  it('busca apurações IRPJ_LR quando empresa é Lucro Real', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      ...EMPRESA_LP,
      regime: 'LUCRO_REAL',
    })

    const service = new ECFService()
    await service.gerar(TENANT_ID, EMPRESA_ID, 2025)

    const findCall = mockDb.apuracaoFiscal.findMany.mock.calls[0][0]
    expect(findCall.where.tipo).toBe('IRPJ_LR')
  })
})

// ===========================================================================

describe('ECFService — auditoria', () => {
  it('registra ECF_GERADO no audit', async () => {
    const service = new ECFService()
    await service.gerar(TENANT_ID, EMPRESA_ID, 2025)

    expect(mockAudit.registrar).toHaveBeenCalledOnce()
    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.evento).toBe('ECF_GERADO')
    expect(auditCall.tenantId).toBe(TENANT_ID)
  })

  it('audit estadoNovo contém ano, receita e dataEntrega', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makeTrimestre('2025-T1', 100000, 1200, 1440),
    ])

    const service = new ECFService()
    await service.gerar(TENANT_ID, EMPRESA_ID, 2025)

    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.estadoNovo.ano).toBe(2025)
    expect(auditCall.estadoNovo.dataEntrega).toBe('2026-07-31')
    expect(Number(auditCall.estadoNovo.receitaBrutaAnual)).toBe(100000)
  })
})
