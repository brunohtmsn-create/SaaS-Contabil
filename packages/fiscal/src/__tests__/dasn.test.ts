import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DasnService } from '../dasn.service.js'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  apuracaoFiscal: { findMany: vi.fn() },
  documentoFiscal: { aggregate: vi.fn() },
  obrigacao: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
}

const mockAudit = { registrar: vi.fn() }

vi.mock('@saas-contabil/database', () => ({ getPrismaClient: () => mockDb }))
vi.mock('@saas-contabil/audit', () => ({ AuditService: vi.fn(() => mockAudit) }))

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TENANT = 'tenant-1'
const EMPRESA_ID = 'emp-1'
const ANO = 2024

const empresa = {
  id: EMPRESA_ID,
  cnpj: '12345678000195',
  regime: 'SIMPLES_NACIONAL',
}

function mockAggregate(valor: string) {
  mockDb.documentoFiscal.aggregate.mockResolvedValue({ _sum: { valorTotal: valor } })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DasnService.gerar()', () => {
  let service: DasnService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new DasnService()
  })

  it('gera DASN para empresa Simples Nacional com todos meses calculados', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(empresa)

    // Todos 12 meses com PGDAS calculado
    const competencias = Array.from({ length: 12 }, (_, i) => ({
      competencia: `${ANO}-${String(i + 1).padStart(2, '0')}`,
    }))
    mockDb.apuracaoFiscal.findMany.mockResolvedValue(competencias)
    mockAggregate('10000.00')
    mockDb.obrigacao.findFirst.mockResolvedValue(null)
    mockDb.obrigacao.create.mockResolvedValue({ id: 'obrig-1' })

    const resultado = await service.gerar(TENANT, EMPRESA_ID, ANO)

    expect(resultado.cnpj).toBe(empresa.cnpj)
    expect(resultado.ano).toBe(ANO)
    expect(resultado.mesesComPGDAS).toBe(12)
    expect(resultado.mesesCompletos).toBe(true)
    expect(resultado.receitaMensal).toHaveLength(12)
    expect(resultado.obrigacaoId).toBe('obrig-1')
  })

  it('marca mesesCompletos=false quando faltam meses com PGDAS', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(empresa)

    // Apenas 10 meses calculados
    mockDb.apuracaoFiscal.findMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        competencia: `${ANO}-${String(i + 1).padStart(2, '0')}`,
      }))
    )
    mockAggregate('5000.00')
    mockDb.obrigacao.findFirst.mockResolvedValue(null)
    mockDb.obrigacao.create.mockResolvedValue({ id: 'obrig-2' })

    const resultado = await service.gerar(TENANT, EMPRESA_ID, ANO)

    expect(resultado.mesesComPGDAS).toBe(10)
    expect(resultado.mesesCompletos).toBe(false)
  })

  it('calcula receitaAnualTotal somando todos os meses', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(empresa)
    mockDb.apuracaoFiscal.findMany.mockResolvedValue([])
    // R$ 1.000,00 por mês × 12 = R$ 12.000,00
    mockDb.documentoFiscal.aggregate.mockResolvedValue({ _sum: { valorTotal: '1000.00' } })
    mockDb.obrigacao.findFirst.mockResolvedValue(null)
    mockDb.obrigacao.create.mockResolvedValue({ id: 'obrig-3' })

    const resultado = await service.gerar(TENANT, EMPRESA_ID, ANO)

    expect(resultado.receitaAnualTotal).toBe('12000.00')
  })

  it('reutiliza obrigacao existente em vez de criar nova', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(empresa)
    mockDb.apuracaoFiscal.findMany.mockResolvedValue([])
    mockAggregate('0')
    mockDb.obrigacao.findFirst.mockResolvedValue({ id: 'obrig-existente' })

    const resultado = await service.gerar(TENANT, EMPRESA_ID, ANO)

    expect(mockDb.obrigacao.create).not.toHaveBeenCalled()
    expect(resultado.obrigacaoId).toBe('obrig-existente')
  })

  it('lança erro quando empresa não é Simples Nacional', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValue({
      ...empresa,
      regime: 'LUCRO_PRESUMIDO',
    })

    await expect(service.gerar(TENANT, EMPRESA_ID, ANO)).rejects.toThrow('DASN não aplicável')
  })

  it('lança erro quando empresa não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(null)

    await expect(service.gerar(TENANT, EMPRESA_ID, ANO)).rejects.toThrow('Empresa não encontrada')
  })

  it('aceita MEI além de Simples Nacional', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValue({ ...empresa, regime: 'MEI' })
    mockDb.apuracaoFiscal.findMany.mockResolvedValue([])
    mockAggregate('0')
    mockDb.obrigacao.findFirst.mockResolvedValue(null)
    mockDb.obrigacao.create.mockResolvedValue({ id: 'obrig-mei' })

    const resultado = await service.gerar(TENANT, EMPRESA_ID, ANO)

    expect(resultado.obrigacaoId).toBe('obrig-mei')
  })

  it('vencimento é 31 de março do ano seguinte', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(empresa)
    mockDb.apuracaoFiscal.findMany.mockResolvedValue([])
    mockAggregate('0')
    mockDb.obrigacao.findFirst.mockResolvedValue(null)
    mockDb.obrigacao.create.mockResolvedValue({ id: 'obrig-v' })

    const resultado = await service.gerar(TENANT, EMPRESA_ID, 2024)

    const vencimento = new Date(resultado.vencimento)
    expect(vencimento.getUTCFullYear()).toBe(2025)
    expect(vencimento.getUTCMonth()).toBe(2) // março = 2
    expect(vencimento.getUTCDate()).toBe(31)
  })

  it('registra auditoria DASN_GERADA', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(empresa)
    mockDb.apuracaoFiscal.findMany.mockResolvedValue([])
    mockAggregate('0')
    mockDb.obrigacao.findFirst.mockResolvedValue(null)
    mockDb.obrigacao.create.mockResolvedValue({ id: 'obrig-audit' })

    await service.gerar(TENANT, EMPRESA_ID, ANO)

    expect(mockAudit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        cnpj: empresa.cnpj,
        evento: 'DASN_GERADA',
        entidadeTipo: 'OBRIGACAO',
      })
    )
  })

  it('filtra documentos por tenantId e empresaId (isolamento)', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(empresa)
    mockDb.apuracaoFiscal.findMany.mockResolvedValue([])
    mockAggregate('0')
    mockDb.obrigacao.findFirst.mockResolvedValue(null)
    mockDb.obrigacao.create.mockResolvedValue({ id: 'obrig-iso' })

    await service.gerar(TENANT, EMPRESA_ID, ANO)

    const aggCall = mockDb.documentoFiscal.aggregate.mock.calls[0][0]
    expect(aggCall.where.tenantId).toBe(TENANT)
    expect(aggCall.where.empresaId).toBe(EMPRESA_ID)
  })

  it('aggregate retorna valorTotal null → receita tratada como zero (sem crash)', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(empresa)
    mockDb.apuracaoFiscal.findMany.mockResolvedValue([])
    // Prisma retorna null quando não há documentos
    mockDb.documentoFiscal.aggregate.mockResolvedValue({ _sum: { valorTotal: null } })
    mockDb.obrigacao.findFirst.mockResolvedValue(null)
    mockDb.obrigacao.create.mockResolvedValue({ id: 'obrig-null' })

    const resultado = await service.gerar(TENANT, EMPRESA_ID, ANO)

    expect(resultado.receitaAnualTotal).toBe('0.00')
    expect(resultado.receitaMensal.every((m) => m.receita === '0.00')).toBe(true)
  })

  it('aggregate filtra por status CONCILIADO e tipos de documento corretos', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(empresa)
    mockDb.apuracaoFiscal.findMany.mockResolvedValue([])
    mockAggregate('0')
    mockDb.obrigacao.findFirst.mockResolvedValue(null)
    mockDb.obrigacao.create.mockResolvedValue({ id: 'obrig-f' })

    await service.gerar(TENANT, EMPRESA_ID, ANO)

    const aggCall = mockDb.documentoFiscal.aggregate.mock.calls[0][0]
    expect(aggCall.where.status).toBe('CONCILIADO')
    expect(aggCall.where.tipo.in).toContain('NFE')
    expect(aggCall.where.tipo.in).toContain('NFCE')
    expect(aggCall.where.tipo.in).toContain('NFSE_EMITIDA')
    expect(aggCall.where.direcao.in).toContain('SAIDA')
    expect(aggCall.where.direcao.in).toContain('PRESTACAO')
  })

  it('inclui flag pgdasCalculado correto por mês', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(empresa)
    // Apenas janeiro e fevereiro calculados
    mockDb.apuracaoFiscal.findMany.mockResolvedValue([
      { competencia: `${ANO}-01` },
      { competencia: `${ANO}-02` },
    ])
    mockAggregate('0')
    mockDb.obrigacao.findFirst.mockResolvedValue(null)
    mockDb.obrigacao.create.mockResolvedValue({ id: 'obrig-p' })

    const resultado = await service.gerar(TENANT, EMPRESA_ID, ANO)

    const jan = resultado.receitaMensal.find((m) => m.competencia === `${ANO}-01`)
    const mar = resultado.receitaMensal.find((m) => m.competencia === `${ANO}-03`)
    expect(jan?.pgdasCalculado).toBe(true)
    expect(mar?.pgdasCalculado).toBe(false)
  })
})
