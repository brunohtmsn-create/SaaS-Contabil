import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Decimal } from 'decimal.js'

// ---------------------------------------------------------------------------
// Mock do DB
// ---------------------------------------------------------------------------

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  documentoFiscal: { findMany: vi.fn() },
  apuracaoFiscal: { upsert: vi.fn() },
}

const mockAudit = { registrar: vi.fn() }

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => mockAudit),
}))

vi.mock('@saas-contabil/shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('@saas-contabil/shared')>()
  return {
    ...original,
    parsePeriodo: vi.fn(() => ({
      inicio: new Date('2025-01-01'),
      fim: new Date('2025-01-31'),
    })),
  }
})

import { LivroFiscalService } from '../livro-fiscal.service.js'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-livro'
const EMPRESA_ID = 'emp-livro'
const COMPETENCIA = '2025-01'

const empresa = {
  id: EMPRESA_ID,
  cnpj: '12345678000190',
  regime: 'SIMPLES_NACIONAL',
}

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    tipo: 'NFE',
    direcao: 'ENTRADA',
    numero: '001',
    cfop: '1.101',
    dataEmissao: new Date('2025-01-15'),
    cnpjEmitente: '99999999000199',
    nomeEmitente: 'Fornecedor Ltda',
    cnpjDestinatario: empresa.cnpj,
    valorTotal: 1000,
    valorIcms: 120,
    valorIss: 0,
    valorPis: 16.5,
    valorCofins: 76,
    valorIrrf: 0,
    status: 'CONCILIADO',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('LivroFiscalService', () => {
  let service: LivroFiscalService

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.empresaCliente.findUnique.mockResolvedValue(empresa)
    mockDb.documentoFiscal.findMany.mockResolvedValue([])
    mockDb.apuracaoFiscal.upsert.mockResolvedValue({})
    service = new LivroFiscalService()
  })

  it('lança erro quando empresa não encontrada', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(null)
    await expect(service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)).rejects.toThrow(
      'Empresa não encontrada'
    )
  })

  it('retorna livro vazio quando não há documentos', async () => {
    const livro = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(livro.entradas).toHaveLength(0)
    expect(livro.saidas).toHaveLength(0)
    expect(livro.servicos).toHaveLength(0)
    expect(livro.servicosTomados).toHaveLength(0)
    expect(livro.totaisEntradas.valorTotal).toBe('0.00')
    expect(livro.totaisSaidas.valorTotal).toBe('0.00')
    expect(livro.totalServicosEmitidos).toBe('0.00')
    expect(livro.totalServicosTomados).toBe('0.00')
  })

  it('classifica NFE ENTRADA corretamente', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValue([makeDoc({ direcao: 'ENTRADA' })])
    const livro = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(livro.entradas).toHaveLength(1)
    expect(livro.saidas).toHaveLength(0)
    expect(livro.entradas[0]!.valorTotal).toBe('1000.00')
    expect(livro.entradas[0]!.valorIcms).toBe('120.00')
    expect(livro.totaisEntradas.valorTotal).toBe('1000.00')
    expect(livro.totaisEntradas.valorIcms).toBe('120.00')
  })

  it('classifica NFE SAIDA corretamente', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValue([
      makeDoc({ direcao: 'SAIDA', cnpjDestinatario: '88888888000188' }),
    ])
    const livro = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(livro.saidas).toHaveLength(1)
    expect(livro.entradas).toHaveLength(0)
    expect(livro.totaisSaidas.valorTotal).toBe('1000.00')
  })

  it('classifica NFSE_EMITIDA em servicos', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValue([
      makeDoc({
        tipo: 'NFSE_EMITIDA',
        direcao: 'PRESTACAO',
        valorIss: 50,
        cnpjDestinatario: '77777777000177',
      }),
    ])
    const livro = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(livro.servicos).toHaveLength(1)
    expect(livro.totalServicosEmitidos).toBe('1000.00')
    expect(livro.servicosTomados).toHaveLength(0)
  })

  it('classifica NFSE_TOMADA em servicosTomados', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValue([
      makeDoc({
        tipo: 'NFSE_TOMADA',
        direcao: 'ENTRADA',
        cnpjEmitente: '55555555000155',
        nomeEmitente: 'Prestador Serviços Ltda',
        valorIss: 30,
      }),
    ])
    const livro = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(livro.servicosTomados).toHaveLength(1)
    expect(livro.totalServicosTomados).toBe('1000.00')
    expect(livro.servicos).toHaveLength(0)
    expect(livro.servicosTomados[0]!.nomeContraparte).toBe('Prestador Serviços Ltda')
  })

  it('acumula totais de múltiplas entradas corretamente', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValue([
      makeDoc({ valorTotal: 500, valorIcms: 60, valorPis: 8.25, valorCofins: 38 }),
      makeDoc({ valorTotal: 1500, valorIcms: 180, valorPis: 24.75, valorCofins: 114 }),
    ])
    const livro = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(livro.entradas).toHaveLength(2)
    expect(livro.totaisEntradas.valorTotal).toBe('2000.00')
    expect(livro.totaisEntradas.valorIcms).toBe('240.00')
    expect(livro.totaisEntradas.valorPis).toBe('33.00')
    expect(livro.totaisEntradas.valorCofins).toBe('152.00')
  })

  it('retorna cnpj da empresa no livro', async () => {
    const livro = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(livro.cnpj).toBe(empresa.cnpj)
    expect(livro.competencia).toBe(COMPETENCIA)
  })

  it('busca documentos com tenantId correto', async () => {
    await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(mockDb.documentoFiscal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT_ID, empresaId: EMPRESA_ID }),
      })
    )
  })

  it('salva ApuracaoFiscal tipo ISS com tenantId', async () => {
    await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(mockDb.apuracaoFiscal.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId_empresaId_competencia_tipo: expect.objectContaining({
            tenantId: TENANT_ID,
            tipo: 'ISS',
          }),
        }),
      })
    )
  })

  it('registra evento de auditoria LANCAMENTO_GERADO', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValue([makeDoc()])
    await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(mockAudit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        cnpj: empresa.cnpj,
        evento: 'LANCAMENTO_GERADO',
      })
    )
  })

  it('dataEmissao como Date é convertida para ISO string na linha', async () => {
    const data = new Date('2025-01-20T00:00:00.000Z')
    mockDb.documentoFiscal.findMany.mockResolvedValue([makeDoc({ dataEmissao: data })])
    const livro = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(livro.entradas[0]!.data).toBe(data.toISOString())
  })

  it('campos nulos são tratados como zero', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValue([
      makeDoc({ valorIcms: null, valorIss: null, valorPis: null, valorCofins: null }),
    ])
    const livro = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(livro.totaisEntradas.valorIcms).toBe('0.00')
    expect(livro.totaisEntradas.valorIss).toBe('0.00')
    expect(livro.totaisEntradas.valorPis).toBe('0.00')
    expect(livro.totaisEntradas.valorCofins).toBe('0.00')
  })

  it('mistura de tipos gera totais independentes corretamente', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValue([
      makeDoc({ tipo: 'NFE', direcao: 'ENTRADA', valorTotal: 800 }),
      makeDoc({
        tipo: 'NFE',
        direcao: 'SAIDA',
        valorTotal: 1200,
        cnpjDestinatario: '11111111000111',
      }),
      makeDoc({
        tipo: 'NFSE_EMITIDA',
        direcao: 'PRESTACAO',
        valorTotal: 500,
        cnpjDestinatario: '22222222000122',
      }),
      makeDoc({
        tipo: 'NFSE_TOMADA',
        direcao: 'ENTRADA',
        valorTotal: 300,
        cnpjEmitente: '33333333000133',
        nomeEmitente: 'Prestador',
      }),
    ])
    const livro = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(livro.entradas).toHaveLength(1)
    expect(livro.saidas).toHaveLength(1)
    expect(livro.servicos).toHaveLength(1)
    expect(livro.servicosTomados).toHaveLength(1)
    expect(livro.totaisEntradas.valorTotal).toBe('800.00')
    expect(livro.totaisSaidas.valorTotal).toBe('1200.00')
    expect(livro.totalServicosEmitidos).toBe('500.00')
    expect(livro.totalServicosTomados).toBe('300.00')
  })

  it('valorIrrf é mapeado na linha do livro', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValue([
      makeDoc({
        tipo: 'NFSE_TOMADA',
        direcao: 'ENTRADA',
        valorIrrf: 15,
        cnpjEmitente: '44444444000144',
        nomeEmitente: 'Prest',
      }),
    ])
    const livro = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(livro.servicosTomados[0]!.valorIrrf).toBe('15.00')
  })

  it('cfop nulo é mapeado como string vazia', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValue([makeDoc({ cfop: null })])
    const livro = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(livro.entradas[0]!.cfop).toBe('')
  })
})
