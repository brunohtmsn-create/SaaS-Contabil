/**
 * Testes unitários — PGDASService.apurar() e verificarSublimites()
 *
 * Cobre:
 *  - apurar(): empresa não encontrada → throws 'Empresa não encontrada'
 *  - apurar(): empresa não-SN → throws 'Empresa não é do Simples Nacional'
 *  - apurar(): SN sem documentos → valorDAS = 0
 *  - apurar(): chama fatorR.calcular com tenantId, empresaId, competencia
 *  - apurar(): chama apuracaoFiscal.upsert com tipo PGDAS e status CALCULADO
 *  - apurar(): registra auditoria PGDAS_APURADO com cnpj da empresa
 *  - apurar(): retorna resultado com cnpj, competencia e campos obrigatórios
 *  - verificarSublimites(): rb12 < alertaPreventivo → nenhum alerta criado
 *  - verificarSublimites(): alertaPreventivo ≤ rb12 < limiteExclusao → SUBLIMITE_ESTADUAL
 *  - verificarSublimites(): rb12 ≥ limiteExclusao → RISCO_EXCLUSAO_SN
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Decimal } from 'decimal.js'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockDb, mockFatorR, mockAudit } = vi.hoisted(() => ({
  mockDb: {
    empresaCliente: { findUnique: vi.fn() },
    documentoFiscal: {
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { valorTotal: null } }),
    },
    apuracaoFiscal: { upsert: vi.fn().mockResolvedValue({}) },
    alerta: { create: vi.fn().mockResolvedValue({ id: 'alerta-1' }) },
  },
  mockFatorR: {
    calcular: vi.fn().mockResolvedValue({ fatorR: '0', anexo: 'V' }),
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

vi.mock('../fator-r.service.js', () => ({
  FatorRService: vi.fn(() => mockFatorR),
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

import { PGDASService } from '../pgdas.service.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-pgdas'
const EMPRESA_ID = 'empresa-pgdas'
const COMPETENCIA = '2025-05'

const EMPRESA_SN = {
  id: EMPRESA_ID,
  cnpj: '11111111000191',
  razaoSocial: 'Empresa Simples Ltda',
  regime: 'SIMPLES_NACIONAL',
  tenantId: TENANT_ID,
}

const EMPRESA_LP = {
  ...EMPRESA_SN,
  regime: 'LUCRO_PRESUMIDO',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_SN)
  mockDb.documentoFiscal.findMany.mockResolvedValue([])
  mockDb.documentoFiscal.aggregate.mockResolvedValue({ _sum: { valorTotal: null } })
  mockDb.apuracaoFiscal.upsert.mockResolvedValue({})
  mockDb.alerta.create.mockResolvedValue({ id: 'alerta-1' })
  mockFatorR.calcular.mockResolvedValue({ fatorR: '0', anexo: 'V' })
})

describe('PGDASService.apurar() — validações de entrada', () => {
  it('empresa não encontrada → lança erro', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(null)
    const svc = new PGDASService()
    await expect(svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)).rejects.toThrow(
      'Empresa não encontrada'
    )
  })

  it('empresa não é Simples Nacional → lança erro', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_LP)
    const svc = new PGDASService()
    await expect(svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)).rejects.toThrow('Simples Nacional')
  })
})

describe('PGDASService.apurar() — fluxo principal', () => {
  it('empresa SN sem documentos → valorDAS = 0', async () => {
    const svc = new PGDASService()
    const resultado = await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(resultado.valorDAS.toNumber()).toBe(0)
  })

  it('retorna cnpj e competencia corretos', async () => {
    const svc = new PGDASService()
    const resultado = await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(resultado.cnpj).toBe(EMPRESA_SN.cnpj)
    expect(resultado.competencia).toBe(COMPETENCIA)
  })

  it('retorna campos obrigatórios do ResultadoPGDAS', async () => {
    const svc = new PGDASService()
    const resultado = await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(resultado).toMatchObject({
      cnpj: expect.any(String),
      competencia: expect.any(String),
      valorDAS: expect.any(Decimal),
      aliquotaEfetiva: expect.any(Decimal),
      aliquotaNominal: expect.any(Decimal),
      receitaBrutaTotal: expect.any(Decimal),
      receitaBruta12Meses: expect.any(Decimal),
    })
  })

  it('chama fatorR.calcular com tenantId, empresaId e competencia', async () => {
    const svc = new PGDASService()
    await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(mockFatorR.calcular).toHaveBeenCalledWith(TENANT_ID, EMPRESA_ID, COMPETENCIA)
  })

  it('persiste apuração via upsert com tipo PGDAS e status CALCULADO', async () => {
    const svc = new PGDASService()
    await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(mockDb.apuracaoFiscal.upsert).toHaveBeenCalledOnce()
    const [args] = mockDb.apuracaoFiscal.upsert.mock.calls
    expect(args[0].where.tenantId_empresaId_competencia_tipo.tipo).toBe('PGDAS')
    expect(args[0].update.status).toBe('CALCULADO')
  })

  it('registra auditoria PGDAS_APURADO com cnpj da empresa', async () => {
    const svc = new PGDASService()
    await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(mockAudit.registrar).toHaveBeenCalledOnce()
    const [auditArgs] = mockAudit.registrar.mock.calls
    expect(auditArgs[0].evento).toBe('PGDAS_APURADO')
    expect(auditArgs[0].cnpj).toBe(EMPRESA_SN.cnpj)
  })

  it('busca documentos com status CONCILIADO e direção SAIDA/PRESTACAO', async () => {
    const svc = new PGDASService()
    await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    const [findArgs] = mockDb.documentoFiscal.findMany.mock.calls
    expect(findArgs[0].where.status).toBe('CONCILIADO')
    expect(findArgs[0].where.direcao.in).toContain('SAIDA')
    expect(findArgs[0].where.direcao.in).toContain('PRESTACAO')
    expect(findArgs[0].where.tenantId).toBe(TENANT_ID)
  })
})

describe('PGDASService — verificarSublimites() (via apurar())', () => {
  const alertaPreventivo = 4_200_000
  const limiteExclusao = 4_800_000

  it('rb12 abaixo do alertaPreventivo → nenhum alerta criado', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValue({
      _sum: { valorTotal: (alertaPreventivo - 1).toString() },
    })
    const svc = new PGDASService()
    await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(mockDb.alerta.create).not.toHaveBeenCalled()
  })

  it('rb12 = alertaPreventivo → cria alerta SUBLIMITE_ESTADUAL', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValue({
      _sum: { valorTotal: alertaPreventivo.toString() },
    })
    const svc = new PGDASService()
    await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(mockDb.alerta.create).toHaveBeenCalledOnce()
    const [alertaArgs] = mockDb.alerta.create.mock.calls
    expect(alertaArgs[0].data.tipo).toBe('SUBLIMITE_ESTADUAL')
    expect(alertaArgs[0].data.tenantId).toBe(TENANT_ID)
    expect(alertaArgs[0].data.empresaId).toBe(EMPRESA_ID)
  })

  it('rb12 entre alertaPreventivo e limiteExclusao → SUBLIMITE_ESTADUAL', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValue({
      _sum: { valorTotal: (alertaPreventivo + 100_000).toString() },
    })
    const svc = new PGDASService()
    await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    const [alertaArgs] = mockDb.alerta.create.mock.calls
    expect(alertaArgs[0].data.tipo).toBe('SUBLIMITE_ESTADUAL')
  })

  it('rb12 = limiteExclusao → cria alerta RISCO_EXCLUSAO_SN', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValue({
      _sum: { valorTotal: limiteExclusao.toString() },
    })
    const svc = new PGDASService()
    await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(mockDb.alerta.create).toHaveBeenCalledOnce()
    const [alertaArgs] = mockDb.alerta.create.mock.calls
    expect(alertaArgs[0].data.tipo).toBe('RISCO_EXCLUSAO_SN')
  })

  it('rb12 acima de limiteExclusao → cria alerta RISCO_EXCLUSAO_SN', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValue({
      _sum: { valorTotal: (limiteExclusao + 500_000).toString() },
    })
    const svc = new PGDASService()
    await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    const [alertaArgs] = mockDb.alerta.create.mock.calls
    expect(alertaArgs[0].data.tipo).toBe('RISCO_EXCLUSAO_SN')
  })

  it('alerta inclui rb12 e cnpj nos dados', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValue({
      _sum: { valorTotal: alertaPreventivo.toString() },
    })
    const svc = new PGDASService()
    await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    const [alertaArgs] = mockDb.alerta.create.mock.calls
    expect(alertaArgs[0].data.dados).toMatchObject({
      cnpj: EMPRESA_SN.cnpj,
    })
    expect(alertaArgs[0].data.dados.rb12).toBeDefined()
  })
})
