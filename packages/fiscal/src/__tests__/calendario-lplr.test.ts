/**
 * Testes unitários — CalendarioLPLRService
 *
 * Cobre:
 *  - empresa não encontrada → lança erro
 *  - regime inválido (SN) → lança erro
 *  - cria 6 obrigações mensais × 12 meses (EFD_REINF, DCTFWEB, DCTF, PIS, COFINS, FGTS_DIGITAL)
 *  - cria IRPJ + CSLL × 4 trimestres com competências ${ano}-T1..T4
 *  - cria ECD com vencimento 30/06 do ano seguinte
 *  - cria ECF com vencimento 31/07 do ano seguinte
 *  - total = 72 mensais + 8 trimestrais + 2 anuais = 82 creates
 *  - obrigações existentes não são duplicadas (findFirst retorna existente → skip)
 *  - registra CALENDARIO_ANUAL_GERADO no audit
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAudit = { registrar: vi.fn() }

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  obrigacao: {
    findFirst: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
  },
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => mockAudit),
}))

import { CalendarioLPLRService } from '../calendario-lplr.service.js'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-lplr'
const EMPRESA_ID = 'emp-lplr'
const ANO = 2025

const EMPRESA_LP = {
  id: EMPRESA_ID,
  cnpj: '99888777000100',
  razaoSocial: 'Empresa LP Ltda',
  regime: 'LUCRO_PRESUMIDO',
}

const EMPRESA_LR = {
  id: EMPRESA_ID,
  cnpj: '99888777000100',
  razaoSocial: 'Empresa LR SA',
  regime: 'LUCRO_REAL',
}

let createCallCount = 0

beforeEach(() => {
  vi.clearAllMocks()
  createCallCount = 0
  mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_LP)
  mockDb.obrigacao.findFirst.mockResolvedValue(null)
  mockDb.obrigacao.create.mockImplementation(() => {
    createCallCount++
    return Promise.resolve({ id: `obr-${createCallCount}` })
  })
  mockDb.obrigacao.findMany.mockResolvedValue([])
})

// ===========================================================================

describe('CalendarioLPLRService — validações iniciais', () => {
  it('lança erro quando empresa não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new CalendarioLPLRService()
    await expect(service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)).rejects.toThrow(
      'Empresa não encontrada'
    )
  })

  it('lança erro quando regime é SIMPLES_NACIONAL', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      ...EMPRESA_LP,
      regime: 'SIMPLES_NACIONAL',
    })
    const service = new CalendarioLPLRService()
    await expect(service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)).rejects.toThrow(
      'não é LP ou LR'
    )
  })

  it('lança erro quando regime é MEI', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ ...EMPRESA_LP, regime: 'MEI' })
    const service = new CalendarioLPLRService()
    await expect(service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)).rejects.toThrow(
      'não é LP ou LR'
    )
  })

  it('aceita regime LUCRO_REAL sem lançar erro', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(EMPRESA_LR)
    const service = new CalendarioLPLRService()
    await expect(service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)).resolves.not.toThrow()
  })
})

// ===========================================================================

describe('CalendarioLPLRService — quantidade de obrigações criadas', () => {
  it('cria 82 obrigações no total (72 mensais + 8 trimestrais + 2 anuais)', async () => {
    const service = new CalendarioLPLRService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    // 6 tipos × 12 meses = 72  +  IRPJ×4 + CSLL×4 = 8  +  ECD + ECF = 2  → total 82
    expect(mockDb.obrigacao.create).toHaveBeenCalledTimes(82)
  })

  it('cria todas as obrigações com tenantId e empresaId corretos', async () => {
    const service = new CalendarioLPLRService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    for (const call of mockDb.obrigacao.create.mock.calls) {
      expect(call[0].data.tenantId).toBe(TENANT_ID)
      expect(call[0].data.empresaId).toBe(EMPRESA_ID)
    }
  })

  it('todas as obrigações criadas com status PENDENTE', async () => {
    const service = new CalendarioLPLRService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    for (const call of mockDb.obrigacao.create.mock.calls) {
      expect(call[0].data.status).toBe('PENDENTE')
    }
  })
})

// ===========================================================================

describe('CalendarioLPLRService — tipos mensais', () => {
  const tiposMensais = ['EFD_REINF', 'DCTFWEB', 'DCTF', 'PIS', 'COFINS', 'FGTS_DIGITAL'] as const

  it.each(tiposMensais)('cria 12 competências mensais para tipo %s', async (tipo) => {
    const service = new CalendarioLPLRService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    const calls = mockDb.obrigacao.create.mock.calls.filter((c: any) => c[0].data.tipo === tipo)
    expect(calls).toHaveLength(12)
  })

  it('EFD_REINF tem vencimento no dia 15 (ou próximo dia útil)', async () => {
    const service = new CalendarioLPLRService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    const calls = mockDb.obrigacao.create.mock.calls.filter(
      (c: any) => c[0].data.tipo === 'EFD_REINF'
    )
    for (const call of calls) {
      const venc: Date = call[0].data.vencimento
      expect(venc.getDate()).toBeGreaterThanOrEqual(15)
      expect(venc.getDate()).toBeLessThanOrEqual(17)
    }
  })

  it('FGTS_DIGITAL tem vencimento no dia 20 (ou próximo dia útil)', async () => {
    const service = new CalendarioLPLRService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    const calls = mockDb.obrigacao.create.mock.calls.filter(
      (c: any) => c[0].data.tipo === 'FGTS_DIGITAL'
    )
    for (const call of calls) {
      const venc: Date = call[0].data.vencimento
      expect(venc.getDate()).toBeGreaterThanOrEqual(20)
      expect(venc.getDate()).toBeLessThanOrEqual(22)
    }
  })

  it('PIS e COFINS têm vencimento no dia 25 (ou próximo dia útil)', async () => {
    const service = new CalendarioLPLRService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    for (const tipo of ['PIS', 'COFINS'] as const) {
      const calls = mockDb.obrigacao.create.mock.calls.filter((c: any) => c[0].data.tipo === tipo)
      for (const call of calls) {
        const venc: Date = call[0].data.vencimento
        expect(venc.getDate()).toBeGreaterThanOrEqual(25)
        expect(venc.getDate()).toBeLessThanOrEqual(27)
      }
    }
  })
})

// ===========================================================================

describe('CalendarioLPLRService — IRPJ e CSLL trimestrais', () => {
  it('cria 4 competências trimestrais para IRPJ', async () => {
    const service = new CalendarioLPLRService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    const calls = mockDb.obrigacao.create.mock.calls.filter((c: any) => c[0].data.tipo === 'IRPJ')
    expect(calls).toHaveLength(4)
  })

  it('cria 4 competências trimestrais para CSLL', async () => {
    const service = new CalendarioLPLRService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    const calls = mockDb.obrigacao.create.mock.calls.filter((c: any) => c[0].data.tipo === 'CSLL')
    expect(calls).toHaveLength(4)
  })

  it('competências trimestrais no formato ${ano}-T1 a ${ano}-T4', async () => {
    const service = new CalendarioLPLRService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    const competencias = mockDb.obrigacao.create.mock.calls
      .filter((c: any) => c[0].data.tipo === 'IRPJ')
      .map((c: any) => c[0].data.competencia)

    expect(competencias).toContain(`${ANO}-T1`)
    expect(competencias).toContain(`${ANO}-T2`)
    expect(competencias).toContain(`${ANO}-T3`)
    expect(competencias).toContain(`${ANO}-T4`)
  })

  it('T1 vence em abril (mês 4)', async () => {
    const service = new CalendarioLPLRService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    const t1Call = mockDb.obrigacao.create.mock.calls.find(
      (c: any) => c[0].data.tipo === 'IRPJ' && c[0].data.competencia === `${ANO}-T1`
    )
    expect(t1Call).toBeDefined()
    const venc: Date = t1Call![0].data.vencimento
    expect(venc.getFullYear()).toBe(ANO)
    expect(venc.getMonth()).toBe(3) // abril = índice 3
  })

  it('T2 vence em julho (mês 7)', async () => {
    const service = new CalendarioLPLRService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    const t2Call = mockDb.obrigacao.create.mock.calls.find(
      (c: any) => c[0].data.tipo === 'IRPJ' && c[0].data.competencia === `${ANO}-T2`
    )
    expect(t2Call).toBeDefined()
    const venc: Date = t2Call![0].data.vencimento
    expect(venc.getFullYear()).toBe(ANO)
    expect(venc.getMonth()).toBe(6) // julho = índice 6
  })

  it('T3 vence em outubro (mês 10)', async () => {
    const service = new CalendarioLPLRService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    const t3Call = mockDb.obrigacao.create.mock.calls.find(
      (c: any) => c[0].data.tipo === 'IRPJ' && c[0].data.competencia === `${ANO}-T3`
    )
    expect(t3Call).toBeDefined()
    const venc: Date = t3Call![0].data.vencimento
    expect(venc.getFullYear()).toBe(ANO)
    expect(venc.getMonth()).toBe(9) // outubro = índice 9
  })

  it('T4 vence em janeiro (ou fevereiro se cair em fds) do ano seguinte', async () => {
    const service = new CalendarioLPLRService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    const t4Call = mockDb.obrigacao.create.mock.calls.find(
      (c: any) => c[0].data.tipo === 'IRPJ' && c[0].data.competencia === `${ANO}-T4`
    )
    expect(t4Call).toBeDefined()
    const venc: Date = t4Call![0].data.vencimento
    expect(venc.getFullYear()).toBe(ANO + 1)
    // 31/01 pode cair em fim de semana e deslocar para fevereiro
    expect(venc.getMonth()).toBeLessThanOrEqual(1) // janeiro (0) ou fevereiro (1)
  })
})

// ===========================================================================

describe('CalendarioLPLRService — ECD e ECF anuais', () => {
  it('cria ECD com competência ${ano}-12', async () => {
    const service = new CalendarioLPLRService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    const ecdCall = mockDb.obrigacao.create.mock.calls.find((c: any) => c[0].data.tipo === 'ECD')
    expect(ecdCall).toBeDefined()
    expect(ecdCall![0].data.competencia).toBe(`${ANO}-12`)
  })

  it('ECD vence em junho do ano seguinte', async () => {
    const service = new CalendarioLPLRService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    const ecdCall = mockDb.obrigacao.create.mock.calls.find((c: any) => c[0].data.tipo === 'ECD')!
    const venc: Date = ecdCall[0].data.vencimento
    expect(venc.getFullYear()).toBe(ANO + 1)
    expect(venc.getMonth()).toBe(5) // junho = índice 5
    expect(venc.getDate()).toBeGreaterThanOrEqual(28) // 30/06 ou próximo útil
  })

  it('cria ECF com competência ${ano}-12', async () => {
    const service = new CalendarioLPLRService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    const ecfCall = mockDb.obrigacao.create.mock.calls.find((c: any) => c[0].data.tipo === 'ECF')
    expect(ecfCall).toBeDefined()
    expect(ecfCall![0].data.competencia).toBe(`${ANO}-12`)
  })

  it('ECF vence em julho do ano seguinte', async () => {
    const service = new CalendarioLPLRService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    const ecfCall = mockDb.obrigacao.create.mock.calls.find((c: any) => c[0].data.tipo === 'ECF')!
    const venc: Date = ecfCall[0].data.vencimento
    expect(venc.getFullYear()).toBe(ANO + 1)
    expect(venc.getMonth()).toBe(6) // julho = índice 6
    expect(venc.getDate()).toBeGreaterThanOrEqual(29) // 31/07 ou próximo útil
  })
})

// ===========================================================================

describe('CalendarioLPLRService — deduplicação', () => {
  it('não cria obrigação já existente (findFirst retorna registro)', async () => {
    mockDb.obrigacao.findFirst.mockResolvedValue({ id: 'existente', tipo: 'DCTFWEB' })
    const service = new CalendarioLPLRService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    // Nenhuma criação deve ocorrer quando todas as findFirst retornam existente
    expect(mockDb.obrigacao.create).not.toHaveBeenCalled()
  })

  it('cria apenas as obrigações ausentes quando algumas já existem', async () => {
    let callCount = 0
    mockDb.obrigacao.findFirst.mockImplementation(() => {
      callCount++
      // Retorna existente para as primeiras 10 chamadas, null para o restante
      return callCount <= 10
        ? Promise.resolve({ id: `existing-${callCount}` })
        : Promise.resolve(null)
    })

    const service = new CalendarioLPLRService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    // Total de queries findFirst = 82; 10 existem → 72 criados
    expect(mockDb.obrigacao.create).toHaveBeenCalledTimes(72)
  })
})

// ===========================================================================

describe('CalendarioLPLRService — audit', () => {
  it('registra evento CALENDARIO_ANUAL_GERADO no audit', async () => {
    const service = new CalendarioLPLRService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    expect(mockAudit.registrar).toHaveBeenCalledOnce()
    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.evento).toBe('CALENDARIO_ANUAL_GERADO')
    expect(auditCall.tenantId).toBe(TENANT_ID)
    expect(auditCall.entidadeId).toBe(EMPRESA_ID)
  })

  it('audit estadoNovo contém ano e regime corretos', async () => {
    const service = new CalendarioLPLRService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.estadoNovo.ano).toBe(ANO)
    expect(auditCall.estadoNovo.regime).toBe('LUCRO_PRESUMIDO')
    expect(auditCall.estadoNovo.totalCriadas).toBe(82)
  })

  it('retorna array de obrigações via findMany final', async () => {
    const obrigacoesMock = [{ id: 'o1', tipo: 'DCTFWEB' }]
    mockDb.obrigacao.findMany.mockResolvedValueOnce(obrigacoesMock)

    const service = new CalendarioLPLRService()
    const result = await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    expect(result).toEqual(obrigacoesMock)
    expect(mockDb.obrigacao.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT_ID,
          empresaId: EMPRESA_ID,
        }),
      })
    )
  })
})
