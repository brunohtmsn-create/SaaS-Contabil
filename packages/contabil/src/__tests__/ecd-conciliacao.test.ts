/**
 * Testes unitários — ECDService + ConciliacaoBancariaService
 *
 * ECDService.gerar():
 *  - empresa não encontrada → lança erro
 *  - sem lançamentos → arquivo ECD contém blocos 0000 e 9999
 *  - com lançamentos → arquivo contém bloco I250 por lançamento
 *  - arquivo ECD contém CNPJ e razão social da empresa
 *  - faz upload para S3 com S3KeyBuilder.ecdArquivo()
 *  - faz upsert em apuracaoFiscal com tipo ECD e status CALCULADO
 *  - registra evento no audit trail
 *
 * ConciliacaoBancariaService.conciliar():
 *  - empresa não encontrada → lança erro
 *  - transação sem match → não atualiza status
 *  - transação com mesmo valor e data próxima (≤2 dias) → match e atualiza status
 *  - diferença de valor > R$0,02 → não faz match
 *  - diferença de dias > 2 → não faz match
 *  - match encontrado → registra audit trail
 *
 * PrismaClient, AuditService e StorageService são mockados.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Decimal } from 'decimal.js'

// ---------------------------------------------------------------------------
// Mock compartilhado
// ---------------------------------------------------------------------------

const mockS3Upload = vi.fn().mockResolvedValue({ s3Key: 'mock-key', url: 's3://mock' })
const mockS3Exists = vi.fn().mockResolvedValue(false)
const mockS3GetSignedUrl = vi.fn().mockResolvedValue('https://mock.url')

vi.mock('@saas-contabil/storage', () => ({
  StorageService: vi.fn().mockImplementation(() => ({
    upload: mockS3Upload,
    exists: mockS3Exists,
    getSignedUrl: mockS3GetSignedUrl,
  })),
  S3KeyBuilder: {
    ecdArquivo: vi.fn((cnpj: string, ano: string) => `${cnpj}/${ano}/contabil/ecd-${ano}.txt`),
  },
}))

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  lancamentoContabil: { findMany: vi.fn() },
  apuracaoFiscal: { upsert: vi.fn() },
  transacaoBancaria: { findMany: vi.fn(), update: vi.fn() },
  documentoFiscal: { findMany: vi.fn() },
}

const mockAudit = { registrar: vi.fn().mockResolvedValue(undefined) }

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => mockAudit),
}))

import { ECDService } from '../ecd.service.js'
import { ConciliacaoBancariaService } from '../conciliacao-bancaria.service.js'

// ---------------------------------------------------------------------------
// Reset entre testes
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.apuracaoFiscal.upsert.mockResolvedValue({})
  mockDb.lancamentoContabil.findMany.mockResolvedValue([])
  mockDb.transacaoBancaria.findMany.mockResolvedValue([])
  mockDb.documentoFiscal.findMany.mockResolvedValue([])
  mockDb.transacaoBancaria.update.mockResolvedValue({})
  mockS3Upload.mockResolvedValue({ s3Key: 'mock-key', url: 's3://mock' })
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const empresa = {
  id: 'emp-1',
  cnpj: '11111111000111',
  razaoSocial: 'Acme LTDA',
  uf: 'SP',
  regime: 'LUCRO_PRESUMIDO',
}

function makeLancamento(id: string, conta: string, valor: string, tipo: 'DEBITO' | 'CREDITO') {
  return {
    id,
    data: new Date('2025-01-15'),
    historico: `Lançamento ${id}`,
    competencia: '2025-01',
    partidas: [{ conta, valor, tipo }],
  }
}

function makeTx(id: string, valor: string, data: Date): any {
  return {
    id,
    valor: new Decimal(valor),
    data,
    status: 'NAO_CONCILIADA',
  }
}

function makeDoc(id: string, valor: string, data: Date): any {
  return {
    id,
    valorTotal: new Decimal(valor),
    dataEmissao: data,
    status: 'CONCILIADO',
  }
}

// ===========================================================================
// ECDService
// ===========================================================================

describe('ECDService — gerar()', () => {
  it('empresa não encontrada → lança erro', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new ECDService()
    await expect(service.gerar('t-1', 'emp-x', 2025)).rejects.toThrow('Empresa não encontrada')
  })

  it('regime SIMPLES_NACIONAL → lança erro', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      ...empresa,
      regime: 'SIMPLES_NACIONAL',
    })
    const service = new ECDService()
    await expect(service.gerar('t-1', 'emp-1', 2025)).rejects.toThrow('Lucro Presumido')
  })

  it('regime MEI → lança erro', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ ...empresa, regime: 'MEI' })
    const service = new ECDService()
    await expect(service.gerar('t-1', 'emp-1', 2025)).rejects.toThrow('Lucro Presumido')
  })

  it('regime LUCRO_REAL → aceito', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ ...empresa, regime: 'LUCRO_REAL' })
    const service = new ECDService()
    await expect(service.gerar('t-1', 'emp-1', 2025)).resolves.not.toThrow()
  })

  it('arquivo ECD contém bloco 0000 com CNPJ', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    const service = new ECDService()
    const result = await service.gerar('t-1', 'emp-1', 2025)
    expect(result.conteudo).toContain('|0000|')
    expect(result.conteudo).toContain(empresa.cnpj)
  })

  it('arquivo ECD contém bloco de encerramento 9999', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    const service = new ECDService()
    const result = await service.gerar('t-1', 'emp-1', 2025)
    expect(result.conteudo).toContain('|9999|')
  })

  it('com lançamentos → arquivo contém bloco I250', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    mockDb.lancamentoContabil.findMany.mockResolvedValueOnce([
      makeLancamento('lanc-1', '3.1.1.01', '5000', 'CREDITO'),
    ])
    const service = new ECDService()
    const result = await service.gerar('t-1', 'emp-1', 2025)
    expect(result.conteudo).toContain('|I250|')
  })

  it('com 3 lançamentos → número de linhas I250 >= 3', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    mockDb.lancamentoContabil.findMany.mockResolvedValueOnce([
      makeLancamento('l-1', '1.1.1.01', '1000', 'DEBITO'),
      makeLancamento('l-2', '2.1.1.01', '2000', 'CREDITO'),
      makeLancamento('l-3', '6.1.1.01', '500', 'DEBITO'),
    ])
    const service = new ECDService()
    const result = await service.gerar('t-1', 'emp-1', 2025)
    const linhasI250 = result.conteudo.split('\r\n').filter((l: string) => l.startsWith('|I250|'))
    expect(linhasI250.length).toBeGreaterThanOrEqual(3)
  })

  it('faz upload para S3 com extensão .txt', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    const service = new ECDService()
    await service.gerar('t-1', 'emp-1', 2025)
    expect(mockS3Upload).toHaveBeenCalledTimes(1)
    const s3Key = mockS3Upload.mock.calls[0][0]
    expect(s3Key).toContain('ecd-2025.txt')
  })

  it('faz upsert com tipo ECD e status CALCULADO', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    const service = new ECDService()
    await service.gerar('t-1', 'emp-1', 2025)
    expect(mockDb.apuracaoFiscal.upsert).toHaveBeenCalledTimes(1)
    const call = mockDb.apuracaoFiscal.upsert.mock.calls[0][0]
    expect(call.create.tipo).toBe('ECD')
    expect(call.create.status).toBe('CALCULADO')
  })

  it('registra evento ECD_GERADA no audit trail', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    const service = new ECDService()
    await service.gerar('t-1', 'emp-1', 2025)
    expect(mockAudit.registrar).toHaveBeenCalledTimes(1)
    const audit = mockAudit.registrar.mock.calls[0][0]
    expect(audit.evento).toBe('ECD_GERADA')
  })

  it('resultado inclui totalLancamentos e conteudo', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    const service = new ECDService()
    const result = await service.gerar('t-1', 'emp-1', 2025)
    expect(result.totalLancamentos).toBeDefined()
    expect(typeof result.conteudo).toBe('string')
  })
})

// ===========================================================================
// ConciliacaoBancariaService
// ===========================================================================

describe('ConciliacaoBancariaService — conciliar()', () => {
  it('empresa não encontrada → lança erro', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new ConciliacaoBancariaService()
    await expect(service.conciliar('t-1', 'emp-x', '2025-01')).rejects.toThrow(
      'Empresa não encontrada'
    )
  })

  it('sem transações → não atualiza nenhum status', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    mockDb.transacaoBancaria.findMany.mockResolvedValueOnce([])
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([])

    const service = new ConciliacaoBancariaService()
    await service.conciliar('t-1', 'emp-1', '2025-01')

    expect(mockDb.transacaoBancaria.update).not.toHaveBeenCalled()
  })

  it('transação com mesmo valor e data ≤ 2 dias → match e atualiza status', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    const data = new Date('2025-01-15')
    mockDb.transacaoBancaria.findMany.mockResolvedValueOnce([makeTx('tx-1', '1500.00', data)])
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDoc('doc-1', '1500.00', data)])

    const service = new ConciliacaoBancariaService()
    await service.conciliar('t-1', 'emp-1', '2025-01')

    expect(mockDb.transacaoBancaria.update).toHaveBeenCalledWith({
      where: { id: 'tx-1' },
      data: { status: 'CONCILIADA', documentoId: 'doc-1' },
    })
  })

  it('diferença de valor > R$0,02 → não faz match', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    const data = new Date('2025-01-15')
    mockDb.transacaoBancaria.findMany.mockResolvedValueOnce([makeTx('tx-1', '1500.00', data)])
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDoc('doc-1', '1501.00', data)])

    const service = new ConciliacaoBancariaService()
    await service.conciliar('t-1', 'emp-1', '2025-01')

    expect(mockDb.transacaoBancaria.update).not.toHaveBeenCalled()
  })

  it('diferença de dias > 2 → não faz match', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    const txDate = new Date('2025-01-15')
    const docDate = new Date('2025-01-19') // 4 dias de diferença
    mockDb.transacaoBancaria.findMany.mockResolvedValueOnce([makeTx('tx-1', '1500.00', txDate)])
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDoc('doc-1', '1500.00', docDate)])

    const service = new ConciliacaoBancariaService()
    await service.conciliar('t-1', 'emp-1', '2025-01')

    expect(mockDb.transacaoBancaria.update).not.toHaveBeenCalled()
  })

  it('tolerância de R$0,01 → faz match', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    const data = new Date('2025-01-15')
    mockDb.transacaoBancaria.findMany.mockResolvedValueOnce([makeTx('tx-1', '1500.01', data)])
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDoc('doc-1', '1500.00', data)])

    const service = new ConciliacaoBancariaService()
    await service.conciliar('t-1', 'emp-1', '2025-01')

    expect(mockDb.transacaoBancaria.update).toHaveBeenCalledTimes(1)
  })

  it('match encontrado → registra evento CONCILIACAO_BANCARIA no audit trail', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    const data = new Date('2025-01-15')
    mockDb.transacaoBancaria.findMany.mockResolvedValueOnce([makeTx('tx-1', '2000.00', data)])
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDoc('doc-1', '2000.00', data)])

    const service = new ConciliacaoBancariaService()
    await service.conciliar('t-1', 'emp-1', '2025-01')

    expect(mockAudit.registrar).toHaveBeenCalledTimes(1)
    expect(mockAudit.registrar.mock.calls[0][0].evento).toBe('CONCILIACAO_BANCARIA')
  })

  it('sem match (diferença R$1,00) → sem audit trail registrado', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    const data = new Date('2025-01-15')
    // diferença de R$1,00 > R$0,02 → sem match
    mockDb.transacaoBancaria.findMany.mockResolvedValueOnce([makeTx('tx-1', '999.00', data)])
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDoc('doc-1', '1000.00', data)])

    const service = new ConciliacaoBancariaService()
    await service.conciliar('t-1', 'emp-1', '2025-01')

    expect(mockAudit.registrar).not.toHaveBeenCalled()
  })

  it('busca transações com tenantId e empresaId corretos', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(empresa)
    const service = new ConciliacaoBancariaService()
    await service.conciliar('t-abc', 'emp-xyz', '2025-01')

    const txQuery = mockDb.transacaoBancaria.findMany.mock.calls[0][0].where
    expect(txQuery.tenantId).toBe('t-abc')
    expect(txQuery.empresaId).toBe('emp-xyz')
  })
})
