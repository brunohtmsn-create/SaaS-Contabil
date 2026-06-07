/**
 * Testes unitários — MonitoramentoSNService (métodos adicionais)
 *
 * Cobre:
 *  - verificarVencimentos(): empresa não encontrada → lança erro
 *  - verificarVencimentos(): cria 4 obrigações mensais (DAS, EFD_REINF, DCTFWEB, DESTDA)
 *  - verificarVencimentos(): não duplica obrigações já existentes
 *  - verificarVencimentos(): retorna obrigações do período
 *  - verificarVencimentos(): obrigações criadas com status PENDENTE e dias nominais corretos
 *  - verificarRiscoExclusao(): empresa não encontrada → lança erro
 *  - verificarRiscoExclusao(): rb12 < alertaPreventivo → nenhum alerta criado
 *  - verificarRiscoExclusao(): rb12 ≥ alertaPreventivo → cria alerta SUBLIMITE_ESTADUAL
 *  - verificarRiscoExclusao(): rb12 ≥ limiteExclusao → cria alerta RISCO_EXCLUSAO_SN
 *  - verificarRiscoExclusao(): alerta já existente → não duplica
 *  - verificarRiscoExclusao(): registra auditoria RISCO_EXCLUSAO_SN_DETECTADO ao criar alerta
 *  - verificarRiscoExclusao(): filtra docs CONCILIADO/NFE/NFCE/NFSE_EMITIDA/SAIDA/PRESTACAO
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockDb, mockAudit } = vi.hoisted(() => ({
  mockDb: {
    empresaCliente: { findUnique: vi.fn() },
    obrigacao: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    documentoFiscal: {
      aggregate: vi.fn(),
    },
    alerta: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
  mockAudit: {
    registrar: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn(() => mockAudit),
}))

vi.mock('@saas-contabil/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@saas-contabil/shared')>()
  return {
    ...actual,
    parsePeriodo: vi.fn(() => ({
      inicio: new Date('2025-05-01'),
      fim: new Date('2025-05-31'),
    })),
    competencias12Meses: vi.fn(() => [
      '2024-06',
      '2024-07',
      '2024-08',
      '2024-09',
      '2024-10',
      '2024-11',
      '2024-12',
      '2025-01',
      '2025-02',
      '2025-03',
      '2025-04',
      '2025-05',
    ]),
  }
})

import { MonitoramentoSNService } from '../monitoramento-sn.service.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-monit-extra'
const EMPRESA_ID = 'emp-monit-extra'
const COMPETENCIA = '2025-05'
const CNPJ = '11222333000181'

const EMPRESA = { id: EMPRESA_ID, cnpj: CNPJ, razaoSocial: 'Empresa Monit Extra Ltda' }

const ALERTA_PREVENTIVO = 4_200_000
const LIMITE_EXCLUSAO = 4_800_000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA)
  mockDb.obrigacao.findFirst.mockResolvedValue(null)
  mockDb.obrigacao.create.mockImplementation(({ data }: any) =>
    Promise.resolve({ id: `obr-${data.tipo}`, ...data })
  )
  mockDb.obrigacao.findMany.mockResolvedValue([])
  mockDb.documentoFiscal.aggregate.mockResolvedValue({ _sum: { valorTotal: null } })
  mockDb.alerta.findFirst.mockResolvedValue(null)
  mockDb.alerta.create.mockResolvedValue({ id: 'alerta-new' })
})

// ===========================================================================
// verificarVencimentos
// ===========================================================================

describe('MonitoramentoSNService.verificarVencimentos() — validações', () => {
  it('empresa não encontrada → lança erro', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const svc = new MonitoramentoSNService()
    await expect(svc.verificarVencimentos(TENANT_ID, EMPRESA_ID, COMPETENCIA)).rejects.toThrow(
      'Empresa não encontrada'
    )
  })
})

describe('MonitoramentoSNService.verificarVencimentos() — criação de obrigações', () => {
  it('cria 4 obrigações mensais: DAS, EFD_REINF, DCTFWEB e DESTDA', async () => {
    const svc = new MonitoramentoSNService()
    await svc.verificarVencimentos(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockDb.obrigacao.create).toHaveBeenCalledTimes(4)
    const tipos = mockDb.obrigacao.create.mock.calls.map((c: any) => c[0].data.tipo)
    expect(tipos).toContain('DAS')
    expect(tipos).toContain('EFD_REINF')
    expect(tipos).toContain('DCTFWEB')
    expect(tipos).toContain('DESTDA')
  })

  it('todas as obrigações criadas com status PENDENTE', async () => {
    const svc = new MonitoramentoSNService()
    await svc.verificarVencimentos(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    for (const call of mockDb.obrigacao.create.mock.calls) {
      expect(call[0].data.status).toBe('PENDENTE')
    }
  })

  it('obrigações criadas com tenantId, empresaId e competencia corretos', async () => {
    const svc = new MonitoramentoSNService()
    await svc.verificarVencimentos(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    for (const call of mockDb.obrigacao.create.mock.calls) {
      expect(call[0].data.tenantId).toBe(TENANT_ID)
      expect(call[0].data.empresaId).toBe(EMPRESA_ID)
      expect(call[0].data.competencia).toBe(COMPETENCIA)
    }
  })

  it('DAS tem vencimento com dia >= 20 (dia nominal 20)', async () => {
    const svc = new MonitoramentoSNService()
    await svc.verificarVencimentos(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const dasCall = mockDb.obrigacao.create.mock.calls.find((c: any) => c[0].data.tipo === 'DAS')
    expect(dasCall).toBeDefined()
    expect(dasCall![0].data.vencimento.getDate()).toBeGreaterThanOrEqual(20)
  })

  it('EFD_REINF tem vencimento com dia >= 15 (dia nominal 15)', async () => {
    const svc = new MonitoramentoSNService()
    await svc.verificarVencimentos(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const call = mockDb.obrigacao.create.mock.calls.find((c: any) => c[0].data.tipo === 'EFD_REINF')
    expect(call![0].data.vencimento.getDate()).toBeGreaterThanOrEqual(15)
  })

  it('DESTDA tem vencimento com dia >= 28 (dia nominal 28)', async () => {
    const svc = new MonitoramentoSNService()
    await svc.verificarVencimentos(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const call = mockDb.obrigacao.create.mock.calls.find((c: any) => c[0].data.tipo === 'DESTDA')
    expect(call![0].data.vencimento.getDate()).toBeGreaterThanOrEqual(28)
  })
})

describe('MonitoramentoSNService.verificarVencimentos() — deduplicação', () => {
  it('obrigação já existente (findFirst retorna objeto) → não cria', async () => {
    mockDb.obrigacao.findFirst.mockImplementation(({ where }: any) => {
      if (where.tipo === 'DAS') return Promise.resolve({ id: 'das-existente' })
      return Promise.resolve(null)
    })

    const svc = new MonitoramentoSNService()
    await svc.verificarVencimentos(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    // 4 tipos - 1 DAS existente = 3 creates
    expect(mockDb.obrigacao.create).toHaveBeenCalledTimes(3)
    const tipos = mockDb.obrigacao.create.mock.calls.map((c: any) => c[0].data.tipo)
    expect(tipos).not.toContain('DAS')
  })

  it('todas as 4 obrigações já existem → nenhum create', async () => {
    mockDb.obrigacao.findFirst.mockResolvedValue({ id: 'existente' })

    const svc = new MonitoramentoSNService()
    await svc.verificarVencimentos(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockDb.obrigacao.create).not.toHaveBeenCalled()
  })
})

describe('MonitoramentoSNService.verificarVencimentos() — retorno', () => {
  it('retorna obrigações do período via findMany', async () => {
    const obrigacoes = [
      { id: 'o1', tipo: 'DAS', competencia: COMPETENCIA },
      { id: 'o2', tipo: 'EFD_REINF', competencia: COMPETENCIA },
    ]
    mockDb.obrigacao.findMany.mockResolvedValueOnce(obrigacoes)

    const svc = new MonitoramentoSNService()
    const result = await svc.verificarVencimentos(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(result).toEqual(obrigacoes)
  })

  it('findMany filtra por tenantId, empresaId e competencia', async () => {
    const svc = new MonitoramentoSNService()
    await svc.verificarVencimentos(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const { where } = mockDb.obrigacao.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.empresaId).toBe(EMPRESA_ID)
    expect(where.competencia).toBe(COMPETENCIA)
  })
})

// ===========================================================================
// verificarRiscoExclusao
// ===========================================================================

describe('MonitoramentoSNService.verificarRiscoExclusao() — validações', () => {
  it('empresa não encontrada → lança erro', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const svc = new MonitoramentoSNService()
    await expect(svc.verificarRiscoExclusao(TENANT_ID, EMPRESA_ID, COMPETENCIA)).rejects.toThrow(
      'Empresa não encontrada'
    )
  })
})

describe('MonitoramentoSNService.verificarRiscoExclusao() — limites', () => {
  it('rb12 < alertaPreventivo → nenhum alerta criado', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValueOnce({
      _sum: { valorTotal: (ALERTA_PREVENTIVO - 1).toString() },
    })

    const svc = new MonitoramentoSNService()
    await svc.verificarRiscoExclusao(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockDb.alerta.create).not.toHaveBeenCalled()
    expect(mockAudit.registrar).not.toHaveBeenCalled()
  })

  it('rb12 = alertaPreventivo → cria alerta SUBLIMITE_ESTADUAL', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValueOnce({
      _sum: { valorTotal: ALERTA_PREVENTIVO.toString() },
    })

    const svc = new MonitoramentoSNService()
    await svc.verificarRiscoExclusao(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockDb.alerta.create).toHaveBeenCalledOnce()
    const [alertaArgs] = mockDb.alerta.create.mock.calls
    expect(alertaArgs[0].data.tipo).toBe('SUBLIMITE_ESTADUAL')
  })

  it('rb12 entre alertaPreventivo e limiteExclusao → cria SUBLIMITE_ESTADUAL', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValueOnce({
      _sum: { valorTotal: (ALERTA_PREVENTIVO + 100_000).toString() },
    })

    const svc = new MonitoramentoSNService()
    await svc.verificarRiscoExclusao(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const [alertaArgs] = mockDb.alerta.create.mock.calls
    expect(alertaArgs[0].data.tipo).toBe('SUBLIMITE_ESTADUAL')
  })

  it('rb12 = limiteExclusao → cria alerta RISCO_EXCLUSAO_SN', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValueOnce({
      _sum: { valorTotal: LIMITE_EXCLUSAO.toString() },
    })

    const svc = new MonitoramentoSNService()
    await svc.verificarRiscoExclusao(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockDb.alerta.create).toHaveBeenCalledOnce()
    const [alertaArgs] = mockDb.alerta.create.mock.calls
    expect(alertaArgs[0].data.tipo).toBe('RISCO_EXCLUSAO_SN')
  })

  it('rb12 acima de limiteExclusao → cria alerta RISCO_EXCLUSAO_SN', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValueOnce({
      _sum: { valorTotal: (LIMITE_EXCLUSAO + 500_000).toString() },
    })

    const svc = new MonitoramentoSNService()
    await svc.verificarRiscoExclusao(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const [alertaArgs] = mockDb.alerta.create.mock.calls
    expect(alertaArgs[0].data.tipo).toBe('RISCO_EXCLUSAO_SN')
  })
})

describe('MonitoramentoSNService.verificarRiscoExclusao() — deduplicação de alertas', () => {
  it('alerta já existente para o período → não cria novo', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValueOnce({
      _sum: { valorTotal: ALERTA_PREVENTIVO.toString() },
    })
    mockDb.alerta.findFirst.mockResolvedValueOnce({ id: 'alerta-existente' })

    const svc = new MonitoramentoSNService()
    await svc.verificarRiscoExclusao(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockDb.alerta.create).not.toHaveBeenCalled()
  })
})

describe('MonitoramentoSNService.verificarRiscoExclusao() — dados do alerta', () => {
  it('alerta inclui tenantId, empresaId, cnpj e rb12', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValueOnce({
      _sum: { valorTotal: ALERTA_PREVENTIVO.toString() },
    })

    const svc = new MonitoramentoSNService()
    await svc.verificarRiscoExclusao(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const [alertaArgs] = mockDb.alerta.create.mock.calls
    expect(alertaArgs[0].data.tenantId).toBe(TENANT_ID)
    expect(alertaArgs[0].data.empresaId).toBe(EMPRESA_ID)
    expect(alertaArgs[0].data.dados.cnpj).toBe(CNPJ)
    expect(alertaArgs[0].data.dados.rb12).toBeDefined()
  })

  it('registra auditoria RISCO_EXCLUSAO_SN_DETECTADO ao criar alerta', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValueOnce({
      _sum: { valorTotal: ALERTA_PREVENTIVO.toString() },
    })

    const svc = new MonitoramentoSNService()
    await svc.verificarRiscoExclusao(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockAudit.registrar).toHaveBeenCalledOnce()
    const [auditArgs] = mockAudit.registrar.mock.calls
    expect(auditArgs[0].evento).toBe('RISCO_EXCLUSAO_SN_DETECTADO')
    expect(auditArgs[0].tenantId).toBe(TENANT_ID)
    expect(auditArgs[0].cnpj).toBe(CNPJ)
  })
})

describe('MonitoramentoSNService.verificarRiscoExclusao() — filtros de agregação', () => {
  it('agrega documentos com status CONCILIADO', async () => {
    const svc = new MonitoramentoSNService()
    await svc.verificarRiscoExclusao(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const { where } = mockDb.documentoFiscal.aggregate.mock.calls[0][0]
    expect(where.status).toBe('CONCILIADO')
  })

  it('agrega apenas NFE, NFCE e NFSE_EMITIDA', async () => {
    const svc = new MonitoramentoSNService()
    await svc.verificarRiscoExclusao(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const { where } = mockDb.documentoFiscal.aggregate.mock.calls[0][0]
    expect(where.tipo.in).toContain('NFE')
    expect(where.tipo.in).toContain('NFCE')
    expect(where.tipo.in).toContain('NFSE_EMITIDA')
  })

  it('filtra apenas direção SAIDA e PRESTACAO', async () => {
    const svc = new MonitoramentoSNService()
    await svc.verificarRiscoExclusao(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const { where } = mockDb.documentoFiscal.aggregate.mock.calls[0][0]
    expect(where.direcao.in).toContain('SAIDA')
    expect(where.direcao.in).toContain('PRESTACAO')
  })

  it('agrega com tenantId e empresaId corretos', async () => {
    const svc = new MonitoramentoSNService()
    await svc.verificarRiscoExclusao(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const { where } = mockDb.documentoFiscal.aggregate.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.empresaId).toBe(EMPRESA_ID)
  })

  it('rb12 nulo (sem docs) → nenhum alerta criado', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValueOnce({ _sum: { valorTotal: null } })

    const svc = new MonitoramentoSNService()
    await svc.verificarRiscoExclusao(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockDb.alerta.create).not.toHaveBeenCalled()
  })
})
