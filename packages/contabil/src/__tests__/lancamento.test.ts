/**
 * Testes unitários — LancamentoService
 *
 * Cobre:
 *  - docToLancamento(): mapeamento NF-e entrada → débito estoque / crédito fornecedores
 *  - docToLancamento(): mapeamento NF-e saída → débito clientes / crédito receita
 *  - docToLancamento(): NFC-e saída → débito caixa / crédito receita
 *  - docToLancamento(): NFSe tomada → débito despesa / crédito fornecedor serviço
 *  - docToLancamento(): NFSe tomada com ISS retido → inclui partida ISS retido
 *  - docToLancamento(): NFSe emitida → débito clientes / crédito receita serviços
 *  - docToLancamento(): NFSe emitida com ISS → inclui partida ISS a recolher
 *  - docToLancamento(): tipo desconhecido → null (ignorado)
 *  - gerarLancamentos(): filtra apenas documentos com status CONCILIADO
 *  - gerarLancamentos(): empresa não encontrada → lança erro
 *  - lancarImpostos(): PGDAS presente → gera lançamento DAS
 *  - lancarImpostos(): valorDAS = 0 → sem lançamento
 *
 * PrismaClient e AuditService são mockados.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Decimal } from 'decimal.js'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  documentoFiscal: { findMany: vi.fn() },
  lancamentoContabil: { create: vi.fn() },
  apuracaoFiscal: { findFirst: vi.fn() },
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => ({ registrar: vi.fn() })),
}))

import { LancamentoService } from '../lancamento.service.js'

// ---------------------------------------------------------------------------
// Helper: cria documento fiscal fictício com defaults seguros
// ---------------------------------------------------------------------------

function makeDoc(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'doc-1',
    tipo: 'NFE',
    direcao: 'SAIDA',
    numero: '000001',
    nomeEmitente: 'Fornecedor LTDA',
    cfop: '5.102',
    valorTotal: '1000.00',
    valorProdutos: '900.00',
    valorServicos: '0.00',
    valorIcms: '100.00',
    valorIss: '0.00',
    valorIssRetido: '0.00',
    dataEmissao: new Date('2025-01-15'),
    status: 'CONCILIADO',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.lancamentoContabil.create.mockResolvedValue({ id: 'lanc-1' })
  mockDb.documentoFiscal.findMany.mockResolvedValue([])
  mockDb.apuracaoFiscal.findFirst.mockResolvedValue(null)
})

// ---------------------------------------------------------------------------
// Testes — mapeamento de documentos para lançamentos (acesso via any)
// ---------------------------------------------------------------------------

describe('LancamentoService — docToLancamento()', () => {
  const service = new LancamentoService()
  const call = (doc: unknown) => (service as any).docToLancamento(doc)

  it('NF-e ENTRADA → historico contém número e emitente', () => {
    const lanc = call(makeDoc({ direcao: 'ENTRADA', numero: '123456', nomeEmitente: 'Acme Corp' }))
    expect(lanc?.historico).toContain('123456')
    expect(lanc?.historico).toContain('Acme Corp')
  })

  it('NF-e ENTRADA → partida CREDITO em 2.1.1.01 (Fornecedores) com valorTotal', () => {
    const lanc = call(makeDoc({ direcao: 'ENTRADA', valorTotal: '1500.00' }))
    const cred = lanc?.partidas.find((p: any) => p.tipo === 'CREDITO' && p.conta === '2.1.1.01')
    expect(cred).toBeDefined()
    expect(new Decimal(cred.valor).toFixed(2)).toBe('1500.00')
  })

  it('NF-e ENTRADA → partida DEBITO em 1.1.5.01 (ICMS a recuperar) com valorIcms', () => {
    const lanc = call(makeDoc({ direcao: 'ENTRADA', valorIcms: '180.00', valorTotal: '1000.00' }))
    const icmsDebit = lanc?.partidas.find((p: any) => p.conta === '1.1.5.01')
    expect(icmsDebit?.tipo).toBe('DEBITO')
    expect(new Decimal(icmsDebit.valor).toFixed(2)).toBe('180.00')
  })

  it('NF-e SAIDA → partida DEBITO em 1.1.2.01 (Clientes) com valorTotal', () => {
    const lanc = call(makeDoc({ direcao: 'SAIDA', valorTotal: '2000.00' }))
    const deb = lanc?.partidas.find((p: any) => p.conta === '1.1.2.01')
    expect(deb?.tipo).toBe('DEBITO')
    expect(new Decimal(deb.valor).toFixed(2)).toBe('2000.00')
  })

  it('NF-e SAIDA → partida CREDITO em 3.1.1.01 (Receita de vendas) com valorProdutos', () => {
    const lanc = call(makeDoc({ direcao: 'SAIDA', valorProdutos: '1800.00', valorTotal: '2000.00' }))
    const rec = lanc?.partidas.find((p: any) => p.conta === '3.1.1.01')
    expect(rec?.tipo).toBe('CREDITO')
    expect(new Decimal(rec.valor).toFixed(2)).toBe('1800.00')
  })

  it('NF-e SAIDA → partida CREDITO em 2.1.4.01 (ICMS a recolher)', () => {
    const lanc = call(makeDoc({ direcao: 'SAIDA', valorIcms: '200.00' }))
    const icms = lanc?.partidas.find((p: any) => p.conta === '2.1.4.01')
    expect(icms?.tipo).toBe('CREDITO')
    expect(new Decimal(icms.valor).toFixed(2)).toBe('200.00')
  })

  it('NFC-e SAIDA → historico contém "consumidor"', () => {
    const lanc = call(makeDoc({ tipo: 'NFCE', direcao: 'SAIDA' }))
    expect(lanc?.historico.toLowerCase()).toContain('consumidor')
  })

  it('NFC-e SAIDA → partida DEBITO em 1.1.2.01 (Caixa/PDV)', () => {
    const lanc = call(makeDoc({ tipo: 'NFCE', direcao: 'SAIDA', valorTotal: '500.00' }))
    const deb = lanc?.partidas.find((p: any) => p.conta === '1.1.2.01')
    expect(deb?.tipo).toBe('DEBITO')
  })

  it('NFSe TOMADA → partida DEBITO em 4.1.2.01 (Despesa de serviços)', () => {
    const lanc = call(makeDoc({
      tipo: 'NFSE_TOMADA', direcao: 'ENTRADA',
      valorServicos: '3000.00', valorTotal: '3000.00', valorIssRetido: '0.00',
    }))
    const deb = lanc?.partidas.find((p: any) => p.conta === '4.1.2.01')
    expect(deb?.tipo).toBe('DEBITO')
  })

  it('NFSe TOMADA → partida CREDITO em 2.1.1.02 (Fornecedores de serviço)', () => {
    const lanc = call(makeDoc({
      tipo: 'NFSE_TOMADA', direcao: 'ENTRADA',
      valorServicos: '3000.00', valorTotal: '3000.00', valorIssRetido: '0.00',
    }))
    const cred = lanc?.partidas.find((p: any) => p.conta === '2.1.1.02')
    expect(cred?.tipo).toBe('CREDITO')
  })

  it('NFSe TOMADA com ISS retido > 0 → inclui partida CREDITO em 2.1.4.03', () => {
    const lanc = call(makeDoc({
      tipo: 'NFSE_TOMADA', direcao: 'ENTRADA',
      valorServicos: '5000.00', valorTotal: '5000.00', valorIssRetido: '250.00',
    }))
    const iss = lanc?.partidas.find((p: any) => p.conta === '2.1.4.03')
    expect(iss?.tipo).toBe('CREDITO')
    expect(new Decimal(iss.valor).toFixed(2)).toBe('250.00')
  })

  it('NFSe TOMADA sem ISS retido → sem partida 2.1.4.03', () => {
    const lanc = call(makeDoc({
      tipo: 'NFSE_TOMADA', direcao: 'ENTRADA',
      valorServicos: '2000.00', valorTotal: '2000.00', valorIssRetido: '0.00',
    }))
    const iss = lanc?.partidas.find((p: any) => p.conta === '2.1.4.03')
    expect(iss).toBeUndefined()
  })

  it('NFSe EMITIDA → partida DEBITO em 1.1.2.02 (Clientes)', () => {
    const lanc = call(makeDoc({
      tipo: 'NFSE_EMITIDA', direcao: 'PRESTACAO',
      valorServicos: '4000.00', valorTotal: '4000.00', valorIss: '200.00',
    }))
    const deb = lanc?.partidas.find((p: any) => p.conta === '1.1.2.02')
    expect(deb?.tipo).toBe('DEBITO')
  })

  it('NFSe EMITIDA → partida CREDITO em 3.1.2.01 (Receita de serviços)', () => {
    const lanc = call(makeDoc({
      tipo: 'NFSE_EMITIDA', direcao: 'PRESTACAO',
      valorServicos: '4000.00', valorTotal: '4000.00', valorIss: '0.00',
    }))
    const rec = lanc?.partidas.find((p: any) => p.conta === '3.1.2.01')
    expect(rec?.tipo).toBe('CREDITO')
  })

  it('NFSe EMITIDA com ISS > 0 → inclui partida CREDITO em 2.1.4.04', () => {
    const lanc = call(makeDoc({
      tipo: 'NFSE_EMITIDA', direcao: 'PRESTACAO',
      valorServicos: '4000.00', valorTotal: '4000.00', valorIss: '200.00',
    }))
    const iss = lanc?.partidas.find((p: any) => p.conta === '2.1.4.04')
    expect(iss?.tipo).toBe('CREDITO')
    expect(new Decimal(iss.valor).toFixed(2)).toBe('200.00')
  })

  it('tipo desconhecido → retorna null (documento ignorado)', () => {
    const lanc = call(makeDoc({ tipo: 'CTEOS' }))
    expect(lanc).toBeNull()
  })

  it('todas as partidas de NF-e ENTRADA têm valor ≥ 0', () => {
    const lanc = call(makeDoc({ direcao: 'ENTRADA', valorProdutos: '900.00', valorIcms: '100.00', valorTotal: '1000.00' }))
    for (const p of lanc?.partidas ?? []) {
      expect(new Decimal(p.valor).gte(0)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Testes — gerarLancamentos() com mock do DB
// ---------------------------------------------------------------------------

describe('LancamentoService — gerarLancamentos()', () => {
  it('empresa não encontrada → lança erro', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new LancamentoService()
    await expect(service.gerarLancamentos('t-1', 'emp-1', '2025-01')).rejects.toThrow('Empresa não encontrada')
  })

  it('sem documentos CONCILIADOS → retorna array vazio', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ id: 'emp-1', cnpj: '11.111.111/0001-11' })
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([])
    const service = new LancamentoService()
    const result = await service.gerarLancamentos('t-1', 'emp-1', '2025-01')
    expect(result).toHaveLength(0)
  })

  it('filtra apenas documentos com status CONCILIADO', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ id: 'emp-1', cnpj: '11.111.111/0001-11' })
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([])
    const service = new LancamentoService()
    await service.gerarLancamentos('t-1', 'emp-1', '2025-01')
    const whereArgs = mockDb.documentoFiscal.findMany.mock.calls[0][0].where
    expect(whereArgs.status).toBe('CONCILIADO')
    expect(whereArgs.tenantId).toBe('t-1')
    expect(whereArgs.empresaId).toBe('emp-1')
  })

  it('1 NF-e SAIDA → gera 1 lançamento e retorna array com 1 item', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ id: 'emp-1', cnpj: '11.111.111/0001-11' })
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDoc()])
    const service = new LancamentoService()
    const result = await service.gerarLancamentos('t-1', 'emp-1', '2025-01')
    expect(result).toHaveLength(1)
    expect(mockDb.lancamentoContabil.create).toHaveBeenCalledTimes(1)
  })

  it('documento de tipo desconhecido → não cria lançamento', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ id: 'emp-1', cnpj: '11.111.111/0001-11' })
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDoc({ tipo: 'CTEOS' })])
    const service = new LancamentoService()
    const result = await service.gerarLancamentos('t-1', 'emp-1', '2025-01')
    expect(result).toHaveLength(0)
    expect(mockDb.lancamentoContabil.create).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Testes — lancarImpostos()
// ---------------------------------------------------------------------------

describe('LancamentoService — lancarImpostos()', () => {
  it('empresa não encontrada → lança erro', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new LancamentoService()
    await expect(service.lancarImpostos('t-1', 'emp-1', '2025-01')).rejects.toThrow('Empresa não encontrada')
  })

  it('sem apuração PGDAS → nenhum lançamento de DAS', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ id: 'emp-1', cnpj: '11.111.111/0001-11' })
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce(null)
    const service = new LancamentoService()
    await service.lancarImpostos('t-1', 'emp-1', '2025-01')
    expect(mockDb.lancamentoContabil.create).not.toHaveBeenCalled()
  })

  it('valorDAS = 0 → nenhum lançamento de DAS', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ id: 'emp-1', cnpj: '11.111.111/0001-11' })
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce({ dados: { valorDAS: '0' } })
    const service = new LancamentoService()
    await service.lancarImpostos('t-1', 'emp-1', '2025-01')
    expect(mockDb.lancamentoContabil.create).not.toHaveBeenCalled()
  })

  it('valorDAS = R$1.500 → cria lançamento com débito em 6.1.1.01 e crédito em 2.1.4.05', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ id: 'emp-1', cnpj: '11.111.111/0001-11' })
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce({ dados: { valorDAS: '1500.00' } })
    const service = new LancamentoService()
    await service.lancarImpostos('t-1', 'emp-1', '2025-01')
    expect(mockDb.lancamentoContabil.create).toHaveBeenCalledTimes(1)
    const data = mockDb.lancamentoContabil.create.mock.calls[0][0].data
    const partidas: Array<{ conta: string; tipo: string; valor: string }> = data.partidas
    const deb = partidas.find((p) => p.tipo === 'DEBITO')
    const cred = partidas.find((p) => p.tipo === 'CREDITO')
    expect(deb?.conta).toBe('6.1.1.01')
    expect(cred?.conta).toBe('2.1.4.05')
    expect(new Decimal(deb?.valor).toFixed(2)).toBe('1500.00')
    expect(new Decimal(cred?.valor).toFixed(2)).toBe('1500.00')
  })

  it('historico do DAS contém "Simples Nacional" e competência', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ id: 'emp-1', cnpj: '11.111.111/0001-11' })
    mockDb.apuracaoFiscal.findFirst.mockResolvedValueOnce({ dados: { valorDAS: '800.00' } })
    const service = new LancamentoService()
    await service.lancarImpostos('t-1', 'emp-1', '2025-01')
    const historico = mockDb.lancamentoContabil.create.mock.calls[0][0].data.historico as string
    expect(historico).toContain('Simples Nacional')
    expect(historico).toContain('2025-01')
  })
})
