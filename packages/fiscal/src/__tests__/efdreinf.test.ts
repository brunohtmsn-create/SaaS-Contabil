/**
 * Testes unitários — EFDReinfService + DeSTDAService + GNREService
 *
 * Cobre:
 *  EFDReinfService.processar():
 *   - empresa não encontrada → lança erro
 *   - NFSE_TOMADA com INSS > 0 → gera R-2010
 *   - NFSE_TOMADA com IRRF > 0 → gera R-4020
 *   - NFSE_EMITIDA com IRRF > 0 → gera R-4080
 *   - documetos sem retenção → sem eventos gerados
 *   - apenas docs CONCILIADOS são processados (filtro de status)
 *   - faz upsert em apuracaoFiscal com tipo EFD_REINF
 *   - registra audit trail após processamento
 *
 *  DeSTDAService.gerar():
 *   - empresa não encontrada → lança erro
 *   - arquivo gerado contém linha 0000 com CNPJ e competência
 *   - arquivo gerado termina com bloco 9999
 *   - faz upsert em apuracaoFiscal com tipo DESTDA
 *
 *  GNREService.gerar():
 *   - empresa não encontrada → lança erro
 *   - sem documentos com DIFAL → retorna array vazio
 *   - 2 NF-e com DIFAL para SP → 1 GNRE aggregada para SP
 *   - NF-e de UFs distintas → GNREs separadas por UF
 *   - DIFAL zero → não gera GNRE (ignora)
 *
 * PrismaClient e AuditService são mockados.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Decimal } from 'decimal.js'

// ---------------------------------------------------------------------------
// Mock compartilhado
// ---------------------------------------------------------------------------

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  documentoFiscal: { findMany: vi.fn() },
  apuracaoFiscal: { findFirst: vi.fn(), upsert: vi.fn() },
}

const mockAudit = { registrar: vi.fn().mockResolvedValue(undefined) }

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => mockAudit),
}))

import { EFDReinfService } from '../efdreinf.service.js'
import { DeSTDAService } from '../destda.service.js'
import { GNREService } from '../gnre.service.js'

// ---------------------------------------------------------------------------
// Reset entre testes
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.apuracaoFiscal.upsert.mockResolvedValue({})
  mockDb.apuracaoFiscal.findFirst.mockResolvedValue(null)
  mockDb.documentoFiscal.findMany.mockResolvedValue([])
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const empresa = {
  id: 'emp-1',
  cnpj: '11111111000111',
  razaoSocial: 'Acme LTDA',
  uf: 'SP',
}

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    tipo: 'NFSE_TOMADA',
    cnpjEmitente: '22222222000122',
    cnpjDestinatario: '11111111000111',
    dataEmissao: new Date('2025-01-15'),
    numero: '1',
    valorTotal: new Decimal('1000'),
    valorServicos: new Decimal('1000'),
    valorInss: new Decimal('0'),
    valorIrrf: new Decimal('0'),
    valorCsll: new Decimal('0'),
    valorIssRetido: new Decimal('0'),
    valorPis: new Decimal('0'),
    valorCofins: new Decimal('0'),
    valorDifal: new Decimal('0'),
    valorFundoPobreza: new Decimal('0'),
    ufDestino: null,
    status: 'CONCILIADO',
    ...overrides,
  }
}

// ===========================================================================
// EFDReinfService
// ===========================================================================

describe('EFDReinfService — processar()', () => {
  it('empresa não encontrada → lança erro', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new EFDReinfService()
    await expect(service.processar('t-1', 'emp-x', '2025-01')).rejects.toThrow(
      'Empresa não encontrada'
    )
  })

  it('NFSE_TOMADA com INSS > 0 → gera R-2010 no resultado', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc({ tipo: 'NFSE_TOMADA', valorInss: new Decimal('110') }),
    ])

    const service = new EFDReinfService()
    await service.processar('t-1', 'emp-1', '2025-01')

    const upsertCall = mockDb.apuracaoFiscal.upsert.mock.calls[0][0]
    const dados = upsertCall.update.dados
    expect(dados.r2010).toHaveLength(1)
    expect(dados.r2010[0].vrRetencao.toString()).toBe('110')
  })

  it('NFSE_TOMADA com IRRF > 0 → gera R-4020', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc({ tipo: 'NFSE_TOMADA', valorIrrf: new Decimal('15') }),
    ])

    const service = new EFDReinfService()
    await service.processar('t-1', 'emp-1', '2025-01')

    const upsertCall = mockDb.apuracaoFiscal.upsert.mock.calls[0][0]
    const dados = upsertCall.update.dados
    expect(dados.r4020).toHaveLength(1)
    expect(dados.r4020[0].vrIR.toString()).toBe('15')
  })

  it('NFSE_EMITIDA com IRRF > 0 → gera R-4080', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc({
        tipo: 'NFSE_EMITIDA',
        valorIrrf: new Decimal('20'),
        cnpjDestinatario: '33333333000133',
      }),
    ])

    const service = new EFDReinfService()
    await service.processar('t-1', 'emp-1', '2025-01')

    const upsertCall = mockDb.apuracaoFiscal.upsert.mock.calls[0][0]
    const dados = upsertCall.update.dados
    expect(dados.r4080).toHaveLength(1)
    expect(dados.r4080[0].vrIR.toString()).toBe('20')
  })

  it('documento sem retenção alguma → r2010/r4020/r4080 vazios', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc({ valorInss: new Decimal('0'), valorIrrf: new Decimal('0') }),
    ])

    const service = new EFDReinfService()
    await service.processar('t-1', 'emp-1', '2025-01')

    const upsertCall = mockDb.apuracaoFiscal.upsert.mock.calls[0][0]
    const dados = upsertCall.update.dados
    expect(dados.r2010).toHaveLength(0)
    expect(dados.r4020).toHaveLength(0)
    expect(dados.r4080).toHaveLength(0)
  })

  it('faz upsert com tipo EFD_REINF e status CALCULADO', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([])

    const service = new EFDReinfService()
    await service.processar('t-1', 'emp-1', '2025-01')

    expect(mockDb.apuracaoFiscal.upsert).toHaveBeenCalledTimes(1)
    const call = mockDb.apuracaoFiscal.upsert.mock.calls[0][0]
    expect(call.create.tipo).toBe('EFD_REINF')
    expect(call.create.status).toBe('CALCULADO')
  })

  it('registra audit trail após processamento', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([])

    const service = new EFDReinfService()
    await service.processar('t-1', 'emp-1', '2025-01')

    expect(mockAudit.registrar).toHaveBeenCalledTimes(1)
    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.evento).toBe('EFDREINF_TRANSMITIDA')
    expect(auditCall.tenantId).toBe('t-1')
  })

  it('busca documentos somente com status CONCILIADO (via query filter)', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([])

    const service = new EFDReinfService()
    await service.processar('t-1', 'emp-1', '2025-01')

    const queryWhere = mockDb.documentoFiscal.findMany.mock.calls[0][0].where
    expect(queryWhere.status).toBe('CONCILIADO')
  })

  it('inclui tenantId e empresaId na query de documentos', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([])

    const service = new EFDReinfService()
    await service.processar('t-abc', 'emp-xyz', '2025-01')

    const queryWhere = mockDb.documentoFiscal.findMany.mock.calls[0][0].where
    expect(queryWhere.tenantId).toBe('t-abc')
    expect(queryWhere.empresaId).toBe('emp-xyz')
  })
})

// ===========================================================================
// DeSTDAService
// ===========================================================================

describe('DeSTDAService — gerar()', () => {
  it('empresa não encontrada → lança erro', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new DeSTDAService()
    await expect(service.gerar('t-1', 'emp-x', '2025-01')).rejects.toThrow(
      'Empresa não encontrada'
    )
  })

  it('arquivo gerado contém linha 0000 com CNPJ da empresa', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    const service = new DeSTDAService()
    const content = await service.gerar('t-1', 'emp-1', '2025-01')
    expect(content).toContain('|0000|')
    expect(content).toContain(empresa.cnpj)
  })

  it('arquivo gerado termina com bloco 9999', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    const service = new DeSTDAService()
    const content = await service.gerar('t-1', 'emp-1', '2025-01')
    expect(content).toContain('|9999|')
  })

  it('faz upsert com tipo DESTDA e status CALCULADO', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    const service = new DeSTDAService()
    await service.gerar('t-1', 'emp-1', '2025-01')

    expect(mockDb.apuracaoFiscal.upsert).toHaveBeenCalledTimes(1)
    const call = mockDb.apuracaoFiscal.upsert.mock.calls[0][0]
    expect(call.create.tipo).toBe('DESTDA')
    expect(call.create.status).toBe('CALCULADO')
  })

  it('registra audit trail com evento DESTDA_GERADO', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    const service = new DeSTDAService()
    await service.gerar('t-1', 'emp-1', '2025-01')

    expect(mockAudit.registrar).toHaveBeenCalledTimes(1)
    expect(mockAudit.registrar.mock.calls[0][0].evento).toBe('DESTDA_GERADO')
  })

  it('competência sem hífen no arquivo (formato AAAAMM)', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    const service = new DeSTDAService()
    const content = await service.gerar('t-1', 'emp-1', '2025-01')
    expect(content).toContain('202501')
    expect(content).not.toContain('2025-01|')
  })
})

// ===========================================================================
// GNREService
// ===========================================================================

describe('GNREService — gerar()', () => {
  it('empresa não encontrada → lança erro', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new GNREService()
    await expect(service.gerar('t-1', 'emp-x', '2025-01')).rejects.toThrow(
      'Empresa não encontrada'
    )
  })

  it('sem documentos com DIFAL → retorna array vazio e não faz upsert', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([])

    const service = new GNREService()
    const result = await service.gerar('t-1', 'emp-1', '2025-01')
    expect(result).toHaveLength(0)
    expect(mockDb.apuracaoFiscal.upsert).not.toHaveBeenCalled()
  })

  it('1 NF-e com DIFAL para SP → 1 GNRE para SP com valor correto', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc({ tipo: 'NFE', valorDifal: new Decimal('150'), ufDestino: 'SP' }),
    ])

    const service = new GNREService()
    const result = await service.gerar('t-1', 'emp-1', '2025-01')
    expect(result).toHaveLength(1)
    expect(result[0].ufDestino).toBe('SP')
    expect(result[0].valor.toString()).toBe('150')
  })

  it('2 NF-e para SP → valores aggregados em 1 GNRE', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc({ id: 'd-1', tipo: 'NFE', valorDifal: new Decimal('100'), ufDestino: 'SP' }),
      makeDoc({ id: 'd-2', tipo: 'NFE', valorDifal: new Decimal('200'), ufDestino: 'SP' }),
    ])

    const service = new GNREService()
    const result = await service.gerar('t-1', 'emp-1', '2025-01')
    expect(result).toHaveLength(1)
    expect(result[0].valor.toString()).toBe('300')
  })

  it('NF-e para SP e MG → 2 GNREs distintas por UF', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc({ id: 'd-1', tipo: 'NFE', valorDifal: new Decimal('100'), ufDestino: 'SP' }),
      makeDoc({ id: 'd-2', tipo: 'NFE', valorDifal: new Decimal('80'), ufDestino: 'MG' }),
    ])

    const service = new GNREService()
    const result = await service.gerar('t-1', 'emp-1', '2025-01')
    expect(result).toHaveLength(2)
    const ufs = result.map((r) => r.ufDestino).sort()
    expect(ufs).toEqual(['MG', 'SP'])
  })

  it('DIFAL zero → não inclui na lista de resultados', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc({ tipo: 'NFE', valorDifal: new Decimal('0'), ufDestino: 'SP' }),
    ])

    const service = new GNREService()
    const result = await service.gerar('t-1', 'emp-1', '2025-01')
    expect(result).toHaveLength(0)
  })

  it('GNRE gerada tem código de receita DIFAL correto (10008-0)', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc({ tipo: 'NFE', valorDifal: new Decimal('50'), ufDestino: 'RJ' }),
    ])

    const service = new GNREService()
    const result = await service.gerar('t-1', 'emp-1', '2025-01')
    expect(result[0].codReceita).toBe('10008-0')
    expect(result[0].tipo).toBe('DIFAL')
  })

  it('inclui tenantId e empresaId no query de documentos', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([])

    const service = new GNREService()
    await service.gerar('t-abc', 'emp-xyz', '2025-01')

    const queryWhere = mockDb.documentoFiscal.findMany.mock.calls[0][0].where
    expect(queryWhere.tenantId).toBe('t-abc')
    expect(queryWhere.empresaId).toBe('emp-xyz')
  })
})
