/**
 * Testes unitários — MonitoramentoSNService
 *
 * Cobre:
 *  - gerarCalendarioAnual(): empresa não encontrada → lança erro
 *  - gerarCalendarioAnual(): cria 3 obrigações mensais × 12 meses + 1 DASN anual
 *  - Obrigações existentes não são duplicadas (findFirst retorna existente → skip)
 *  - Tipos mensais: DAS (dia 20), EFD_REINF (dia 15), DESTDA (dia 28)
 *  - DASN criado com competência {ano}-12 (representa ano-base)
 *  - Retorna obrigações do ano após criação (findMany final)
 *
 * PrismaClient e AuditService são mockados.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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
  AuditService: vi.fn().mockImplementation(() => ({
    registrar: vi.fn(),
  })),
}))

import { MonitoramentoSNService } from '../monitoramento-sn.service.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-monit'
const EMPRESA_ID = 'emp-monit'
const ANO = 2025
const EMPRESA = { id: EMPRESA_ID, cnpj: '11222333000181', razaoSocial: 'Empresa Monit Ltda' }

let createCallCount = 0

beforeEach(() => {
  vi.clearAllMocks()
  createCallCount = 0
  mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA)
  mockDb.obrigacao.findFirst.mockResolvedValue(null) // nada existente por padrão
  mockDb.obrigacao.create.mockImplementation(() => {
    createCallCount++
    return Promise.resolve({ id: `obr-${createCallCount}` })
  })
  mockDb.obrigacao.findMany.mockResolvedValue([])
})

// ===========================================================================

describe('MonitoramentoSNService.gerarCalendarioAnual() — empresa não encontrada', () => {
  it('lança erro quando empresa não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new MonitoramentoSNService()
    await expect(service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)).rejects.toThrow(
      'Empresa não encontrada'
    )
  })
})

describe('MonitoramentoSNService.gerarCalendarioAnual() — criação de obrigações', () => {
  it('cria 3 obrigações mensais × 12 meses + 1 DASN = 37 creates no total', async () => {
    const service = new MonitoramentoSNService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    // 3 tipos mensais × 12 meses + 1 DASN anual = 37
    expect(mockDb.obrigacao.create).toHaveBeenCalledTimes(37)
  })

  it('cria obrigações com tenantId e empresaId corretos', async () => {
    const service = new MonitoramentoSNService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    const firstCreate = mockDb.obrigacao.create.mock.calls[0][0]
    expect(firstCreate.data.tenantId).toBe(TENANT_ID)
    expect(firstCreate.data.empresaId).toBe(EMPRESA_ID)
  })

  it('todas as obrigações criadas com status PENDENTE', async () => {
    const service = new MonitoramentoSNService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    for (const call of mockDb.obrigacao.create.mock.calls) {
      expect(call[0].data.status).toBe('PENDENTE')
    }
  })

  it('tipos mensais incluem DAS, EFD_REINF e DESTDA', async () => {
    const service = new MonitoramentoSNService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    const tipos = mockDb.obrigacao.create.mock.calls.map((c: any) => c[0].data.tipo)
    expect(tipos).toContain('DAS')
    expect(tipos).toContain('EFD_REINF')
    expect(tipos).toContain('DESTDA')
  })

  it('cria DASN com competência {ano}-12', async () => {
    const service = new MonitoramentoSNService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    const dasnCreate = mockDb.obrigacao.create.mock.calls.find(
      (c: any) => c[0].data.tipo === 'DASN'
    )
    expect(dasnCreate).toBeDefined()
    expect(dasnCreate![0].data.competencia).toBe(`${ANO}-12`)
  })

  it('DASN tem vencimento em março do ano seguinte (31/03)', async () => {
    const service = new MonitoramentoSNService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    const dasnCreate = mockDb.obrigacao.create.mock.calls.find(
      (c: any) => c[0].data.tipo === 'DASN'
    )!
    const vencimento: Date = dasnCreate[0].data.vencimento
    expect(vencimento.getFullYear()).toBe(ANO + 1)
    expect(vencimento.getMonth()).toBe(2) // março = índice 2
  })

  it('DAS tem dia nominal 20', async () => {
    const service = new MonitoramentoSNService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    const dasCalls = mockDb.obrigacao.create.mock.calls.filter((c: any) => c[0].data.tipo === 'DAS')
    // 12 meses × 1 DAS = 12 creates
    expect(dasCalls).toHaveLength(12)
    // Todos têm data com dia >= 20 (pode ser 20, 21 ou 22 se cair em fds)
    for (const call of dasCalls) {
      const venc: Date = call[0].data.vencimento
      expect(venc.getDate()).toBeGreaterThanOrEqual(20)
    }
  })

  it('EFD_REINF tem dia nominal 15', async () => {
    const service = new MonitoramentoSNService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    const reinfCalls = mockDb.obrigacao.create.mock.calls.filter(
      (c: any) => c[0].data.tipo === 'EFD_REINF'
    )
    expect(reinfCalls).toHaveLength(12)
    for (const call of reinfCalls) {
      const venc: Date = call[0].data.vencimento
      expect(venc.getDate()).toBeGreaterThanOrEqual(15)
    }
  })
})

describe('MonitoramentoSNService.gerarCalendarioAnual() — deduplicação', () => {
  it('obrigação já existente é ignorada (não cria duplicata)', async () => {
    // Simula que DAS de jan/2025 já existe
    let callCount = 0
    mockDb.obrigacao.findFirst.mockImplementation(({ where }: any) => {
      callCount++
      if (where.tipo === 'DAS' && where.competencia === '2025-01') {
        return Promise.resolve({ id: 'existing-das-jan' })
      }
      return Promise.resolve(null)
    })

    const service = new MonitoramentoSNService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    // Deve criar 36 (37 - 1 DAS existente)
    expect(mockDb.obrigacao.create).toHaveBeenCalledTimes(36)
  })

  it('quando todas as obrigações já existem, não cria nenhuma', async () => {
    mockDb.obrigacao.findFirst.mockResolvedValue({ id: 'existing' })

    const service = new MonitoramentoSNService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    expect(mockDb.obrigacao.create).not.toHaveBeenCalled()
  })
})

describe('MonitoramentoSNService.gerarCalendarioAnual() — retorno', () => {
  it('retorna obrigações do ano via findMany final', async () => {
    const obrigacoesMock = [
      { id: 'obr-1', tipo: 'DAS', competencia: '2025-01' },
      { id: 'obr-2', tipo: 'EFD_REINF', competencia: '2025-01' },
    ]
    mockDb.obrigacao.findMany.mockResolvedValueOnce(obrigacoesMock)

    const service = new MonitoramentoSNService()
    const result = await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    expect(result).toEqual(obrigacoesMock)
  })

  it('findMany filtra por tenantId e ano', async () => {
    mockDb.obrigacao.findMany.mockResolvedValueOnce([])

    const service = new MonitoramentoSNService()
    await service.gerarCalendarioAnual(TENANT_ID, EMPRESA_ID, ANO)

    const finalQuery = mockDb.obrigacao.findMany.mock.calls[0][0]
    expect(finalQuery.where.tenantId).toBe(TENANT_ID)
    expect(finalQuery.where.competencia.startsWith).toBe(`${ANO}-`)
  })
})
