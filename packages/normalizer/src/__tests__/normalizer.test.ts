/**
 * Testes unitários — NormalizerService + DeduplicatorService
 *
 * Cobre:
 *  - normalizar(): mapeamento de tipo (NFE, NFSE_EMITIDA, NFSE_TOMADA)
 *  - normalizar(): campos obrigatórios presentes no documento criado
 *  - normalizar(): hash de integridade gerado e incluído
 *  - normalizar(): deduplicação — segunda chamada com mesma chaveUnica não cria novo doc
 *  - DeduplicatorService.isDuplicate(): retorna true/false conforme DB
 *  - DeduplicatorService.findDuplicates(): agrupa documentos com mesma chaveUnica
 *
 * O PrismaClient e o AuditService são mockados com vi.mock para que
 * nenhuma conexão real seja feita.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Decimal } from 'decimal.js'

// ---------------------------------------------------------------------------
// Mocks — devem vir ANTES de importar os módulos que os utilizam
// ---------------------------------------------------------------------------

const mockDocumentoFiscal = {
  findFirst: vi.fn().mockResolvedValue(null),
  findMany: vi.fn().mockResolvedValue([]),
  create: vi.fn(),
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => ({
    documentoFiscal: mockDocumentoFiscal,
  })),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => ({
    registrar: vi.fn().mockResolvedValue(undefined),
  })),
}))

import { NormalizerService } from '../normalizer.service.js'
import { DeduplicatorService } from '../deduplicator.service.js'
import type { DocumentoRaw } from '../types.js'

// ---------------------------------------------------------------------------
// Helper: cria DocumentoRaw base válido
// ---------------------------------------------------------------------------

function makeRaw(overrides: Partial<DocumentoRaw> = {}): DocumentoRaw {
  return {
    tipo: 'NFE',
    chaveAcesso: '35250111111111000191550010000001231000000001',
    numero: '00000123',
    serie: '001',
    dataEmissao: new Date('2025-01-15'),
    cfop: '5102',
    cnpjEmitente: '11.111.111/0001-91',
    nomeEmitente: 'Empresa Teste Ltda',
    ufEmitente: 'SP',
    municipioEmitente: 'São Paulo',
    cnpjDestinatario: '22.222.222/0001-00',
    ufDestinatario: 'SP',
    valorTotal: new Decimal('1500.00'),
    fonte: 'SEFAZ',
    xmlContent: '<nfeProc>dados de teste</nfeProc>',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Helper: cria o objeto de retorno que o DB devolve após create()
// ---------------------------------------------------------------------------

function makeCreatedDoc(raw: DocumentoRaw, extras: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'doc-generated-001',
    tenantId: 'tenant-test',
    empresaId: 'empresa-test',
    tipo: raw.tipo,
    status: 'NORMALIZADO',
    cnpjEmitente: raw.cnpjEmitente.replace(/\D/g, ''),
    cnpjDestinatario: raw.cnpjDestinatario.replace(/\D/g, ''),
    valorTotal: raw.valorTotal,
    chaveUnica: 'hash-chave-unica',
    hashIntegridade: 'hash-integridade-sha256',
    ...extras,
  }
}

// ---------------------------------------------------------------------------
// NormalizerService — mapeamento de tipo
// ---------------------------------------------------------------------------

describe('NormalizerService — normalizar() mapeamento de tipo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDocumentoFiscal.findFirst.mockResolvedValue(null)
  })

  it('NF-e com CFOP 5102 → tipo persiste como NFE', async () => {
    const raw = makeRaw({ tipo: 'NFE', cfop: '5102' })
    mockDocumentoFiscal.create.mockResolvedValue(makeCreatedDoc(raw, { tipo: 'NFE' }))

    const service = new NormalizerService()
    const doc = await service.normalizar(raw, 'tenant-test', 'empresa-test')

    expect(mockDocumentoFiscal.create).toHaveBeenCalledOnce()
    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    expect(createArgs[0].data.tipo).toBe('NFE')
  })

  it('NF-e com CFOP 5102 → status gravado como NORMALIZADO', async () => {
    const raw = makeRaw({ tipo: 'NFE', cfop: '5102' })
    mockDocumentoFiscal.create.mockResolvedValue(makeCreatedDoc(raw))

    const service = new NormalizerService()
    await service.normalizar(raw, 'tenant-test', 'empresa-test')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    expect(createArgs[0].data.status).toBe('NORMALIZADO')
  })

  it('NFSe emitida → tipo persiste como NFSE_EMITIDA', async () => {
    const raw = makeRaw({
      tipo: 'NFSE_EMITIDA',
      chaveAcesso: undefined,
      valorServicos: new Decimal('2000.00'),
      valorTotal: new Decimal('2000.00'),
      municipioIBGE: '3550308',
    })
    mockDocumentoFiscal.create.mockResolvedValue(makeCreatedDoc(raw, { tipo: 'NFSE_EMITIDA' }))

    const service = new NormalizerService()
    await service.normalizar(raw, 'tenant-test', 'empresa-test')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    expect(createArgs[0].data.tipo).toBe('NFSE_EMITIDA')
  })

  it('NFSe emitida → direção inferida como PRESTACAO', async () => {
    const raw = makeRaw({
      tipo: 'NFSE_EMITIDA',
      chaveAcesso: undefined,
      valorServicos: new Decimal('2000.00'),
      valorTotal: new Decimal('2000.00'),
      municipioIBGE: '3550308',
    })
    mockDocumentoFiscal.create.mockResolvedValue(makeCreatedDoc(raw))

    const service = new NormalizerService()
    await service.normalizar(raw, 'tenant-test', 'empresa-test')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    expect(createArgs[0].data.direcao).toBe('PRESTACAO')
  })

  it('NFSe tomada → tipo persiste como NFSE_TOMADA', async () => {
    const raw = makeRaw({
      tipo: 'NFSE_TOMADA',
      chaveAcesso: undefined,
      valorServicos: new Decimal('800.00'),
      valorTotal: new Decimal('800.00'),
      municipioIBGE: '3550308',
    })
    mockDocumentoFiscal.create.mockResolvedValue(makeCreatedDoc(raw, { tipo: 'NFSE_TOMADA' }))

    const service = new NormalizerService()
    await service.normalizar(raw, 'tenant-test', 'empresa-test')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    expect(createArgs[0].data.tipo).toBe('NFSE_TOMADA')
  })

  it('NFSe tomada → direção inferida como ENTRADA', async () => {
    const raw = makeRaw({
      tipo: 'NFSE_TOMADA',
      chaveAcesso: undefined,
      valorServicos: new Decimal('800.00'),
      valorTotal: new Decimal('800.00'),
      municipioIBGE: '3550308',
    })
    mockDocumentoFiscal.create.mockResolvedValue(makeCreatedDoc(raw))

    const service = new NormalizerService()
    await service.normalizar(raw, 'tenant-test', 'empresa-test')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    expect(createArgs[0].data.direcao).toBe('ENTRADA')
  })
})

// ---------------------------------------------------------------------------
// NormalizerService — campos obrigatórios
// ---------------------------------------------------------------------------

describe('NormalizerService — normalizar() campos obrigatórios', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDocumentoFiscal.findFirst.mockResolvedValue(null)
  })

  it('tenantId, empresaId, cnpjEmitente e valorTotal presentes no payload de criação', async () => {
    const raw = makeRaw()
    mockDocumentoFiscal.create.mockResolvedValue(makeCreatedDoc(raw))

    const service = new NormalizerService()
    await service.normalizar(raw, 'tenant-obrigatorio', 'empresa-obrigatorio')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    const data = createArgs[0].data

    // tenantId e empresaId
    expect(data.tenantId).toBe('tenant-obrigatorio')
    expect(data.empresaId).toBe('empresa-obrigatorio')

    // cnpjEmitente (limpo — somente dígitos)
    expect(data.cnpjEmitente).toMatch(/^\d{14}$/)

    // valorTotal (Decimal)
    expect(data.valorTotal).toBeInstanceOf(Decimal)
    expect(data.valorTotal.toFixed(2)).toBe('1500.00')
  })

  it('chaveUnica é gerada e enviada ao banco', async () => {
    const raw = makeRaw()
    mockDocumentoFiscal.create.mockResolvedValue(makeCreatedDoc(raw))

    const service = new NormalizerService()
    await service.normalizar(raw, 'tenant-test', 'empresa-test')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    expect(createArgs[0].data.chaveUnica).toBeDefined()
    expect(typeof createArgs[0].data.chaveUnica).toBe('string')
    expect(createArgs[0].data.chaveUnica.length).toBeGreaterThan(0)
  })

  it('status é sempre NORMALIZADO ao criar', async () => {
    const raw = makeRaw()
    mockDocumentoFiscal.create.mockResolvedValue(makeCreatedDoc(raw))

    const service = new NormalizerService()
    await service.normalizar(raw, 'tenant-test', 'empresa-test')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    expect(createArgs[0].data.status).toBe('NORMALIZADO')
  })
})

// ---------------------------------------------------------------------------
// NormalizerService — hash de integridade
// ---------------------------------------------------------------------------

describe('NormalizerService — normalizar() hash de integridade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDocumentoFiscal.findFirst.mockResolvedValue(null)
  })

  it('hashIntegridade é gerado e enviado ao banco', async () => {
    const raw = makeRaw()
    mockDocumentoFiscal.create.mockResolvedValue(makeCreatedDoc(raw))

    const service = new NormalizerService()
    await service.normalizar(raw, 'tenant-test', 'empresa-test')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    expect(createArgs[0].data.hashIntegridade).toBeDefined()
    expect(typeof createArgs[0].data.hashIntegridade).toBe('string')
    // SHA-256 produz 64 caracteres hexadecimais
    expect(createArgs[0].data.hashIntegridade).toHaveLength(64)
  })

  it('hashIntegridade é SHA-256 em hex (apenas caracteres hexadecimais)', async () => {
    const raw = makeRaw()
    mockDocumentoFiscal.create.mockResolvedValue(makeCreatedDoc(raw))

    const service = new NormalizerService()
    await service.normalizar(raw, 'tenant-test', 'empresa-test')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    const hash: string = createArgs[0].data.hashIntegridade
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('Dois documentos com conteúdo XML diferente → hashes diferentes', async () => {
    mockDocumentoFiscal.create.mockResolvedValue(makeCreatedDoc(makeRaw()))

    const service = new NormalizerService()

    const raw1 = makeRaw({ xmlContent: '<nfe>conteudo-A</nfe>' })
    await service.normalizar(raw1, 'tenant-test', 'empresa-test')
    const hash1: string = mockDocumentoFiscal.create.mock.calls[0]![0].data.hashIntegridade

    vi.clearAllMocks()
    mockDocumentoFiscal.findFirst.mockResolvedValue(null)
    mockDocumentoFiscal.create.mockResolvedValue(makeCreatedDoc(makeRaw()))

    const raw2 = makeRaw({
      chaveAcesso: '35250222222222000191550010000009999000000099',
      xmlContent: '<nfe>conteudo-B</nfe>',
    })
    await service.normalizar(raw2, 'tenant-test', 'empresa-test')
    const hash2: string = mockDocumentoFiscal.create.mock.calls[0]![0].data.hashIntegridade

    expect(hash1).not.toBe(hash2)
  })
})

// ---------------------------------------------------------------------------
// NormalizerService — deduplicação (upsert não cria duplicata)
// ---------------------------------------------------------------------------

describe('NormalizerService — normalizar() deduplicação', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Primeiro documento → chama db.documentoFiscal.create', async () => {
    mockDocumentoFiscal.findFirst.mockResolvedValue(null)
    const raw = makeRaw()
    mockDocumentoFiscal.create.mockResolvedValue(makeCreatedDoc(raw))

    const service = new NormalizerService()
    await service.normalizar(raw, 'tenant-test', 'empresa-test')

    expect(mockDocumentoFiscal.create).toHaveBeenCalledOnce()
  })

  it('Documento já existente (mesma chaveUnica) → retorna existente sem chamar create', async () => {
    const existente = makeCreatedDoc(makeRaw(), { id: 'doc-existente' })
    mockDocumentoFiscal.findFirst.mockResolvedValue(existente)

    const raw = makeRaw()
    const service = new NormalizerService()
    const resultado = await service.normalizar(raw, 'tenant-test', 'empresa-test')

    // Não deve criar novo documento
    expect(mockDocumentoFiscal.create).not.toHaveBeenCalled()
    // Deve retornar o documento existente
    expect(resultado).toEqual(existente)
    expect((resultado as typeof existente).id).toBe('doc-existente')
  })

  it('findFirst é chamado com tenantId e chaveUnica corretos', async () => {
    mockDocumentoFiscal.findFirst.mockResolvedValue(null)
    const raw = makeRaw()
    mockDocumentoFiscal.create.mockResolvedValue(makeCreatedDoc(raw))

    const service = new NormalizerService()
    await service.normalizar(raw, 'tenant-dedup', 'empresa-test')

    expect(mockDocumentoFiscal.findFirst).toHaveBeenCalledOnce()
    const [findArgs] = mockDocumentoFiscal.findFirst.mock.calls
    expect(findArgs[0].where.tenantId).toBe('tenant-dedup')
    expect(findArgs[0].where.chaveUnica).toBeDefined()
  })

  it('Dois documentos diferentes (chaves distintas) → cada um é criado separadamente', async () => {
    mockDocumentoFiscal.findFirst.mockResolvedValue(null)

    const service = new NormalizerService()

    const raw1 = makeRaw({ chaveAcesso: '35250111111111000191550010000001111000000001' })
    mockDocumentoFiscal.create.mockResolvedValue(makeCreatedDoc(raw1, { id: 'doc-A' }))
    await service.normalizar(raw1, 'tenant-test', 'empresa-test')

    const raw2 = makeRaw({ chaveAcesso: '35250122222222000191550010000002222000000002' })
    mockDocumentoFiscal.create.mockResolvedValue(makeCreatedDoc(raw2, { id: 'doc-B' }))
    await service.normalizar(raw2, 'tenant-test', 'empresa-test')

    expect(mockDocumentoFiscal.create).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// DeduplicatorService — isDuplicate()
// ---------------------------------------------------------------------------

describe('DeduplicatorService — isDuplicate()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Documento não existente → retorna false', async () => {
    mockDocumentoFiscal.findFirst.mockResolvedValue(null)

    const service = new DeduplicatorService()
    const resultado = await service.isDuplicate('tenant-test', 'hash-inexistente')

    expect(resultado).toBe(false)
  })

  it('Documento existente com mesma chaveUnica → retorna true', async () => {
    mockDocumentoFiscal.findFirst.mockResolvedValue({ id: 'doc-existente' })

    const service = new DeduplicatorService()
    const resultado = await service.isDuplicate('tenant-test', 'hash-existente')

    expect(resultado).toBe(true)
  })

  it('Passa tenantId e chaveUnica corretos para findFirst', async () => {
    mockDocumentoFiscal.findFirst.mockResolvedValue(null)

    const service = new DeduplicatorService()
    await service.isDuplicate('tenant-abc', 'minha-chave-unica')

    expect(mockDocumentoFiscal.findFirst).toHaveBeenCalledOnce()
    const [findArgs] = mockDocumentoFiscal.findFirst.mock.calls
    expect(findArgs[0].where.tenantId).toBe('tenant-abc')
    expect(findArgs[0].where.chaveUnica).toBe('minha-chave-unica')
  })
})

// ---------------------------------------------------------------------------
// DeduplicatorService — findDuplicates()
// ---------------------------------------------------------------------------

describe('DeduplicatorService — findDuplicates()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Sem documentos → retorna array vazio', async () => {
    mockDocumentoFiscal.findMany.mockResolvedValue([])

    const service = new DeduplicatorService()
    const duplicatas = await service.findDuplicates('tenant-test', 'empresa-test')

    expect(duplicatas).toHaveLength(0)
  })

  it('Documentos com chaves únicas distintas → nenhuma duplicata', async () => {
    mockDocumentoFiscal.findMany.mockResolvedValue([
      { id: 'doc-1', chaveUnica: 'hash-aaa' },
      { id: 'doc-2', chaveUnica: 'hash-bbb' },
      { id: 'doc-3', chaveUnica: 'hash-ccc' },
    ])

    const service = new DeduplicatorService()
    const duplicatas = await service.findDuplicates('tenant-test', 'empresa-test')

    expect(duplicatas).toHaveLength(0)
  })

  it('Dois docs com mesma chaveUnica → retorna um grupo com os dois IDs', async () => {
    mockDocumentoFiscal.findMany.mockResolvedValue([
      { id: 'doc-1', chaveUnica: 'hash-dup' },
      { id: 'doc-2', chaveUnica: 'hash-dup' },
      { id: 'doc-3', chaveUnica: 'hash-outro' },
    ])

    const service = new DeduplicatorService()
    const duplicatas = await service.findDuplicates('tenant-test', 'empresa-test')

    expect(duplicatas).toHaveLength(1)
    const grupo = duplicatas[0]!
    expect(grupo).toHaveLength(2)
    expect(grupo).toContain('doc-1')
    expect(grupo).toContain('doc-2')
  })

  it('Três docs com mesma chaveUnica → grupo com três IDs', async () => {
    mockDocumentoFiscal.findMany.mockResolvedValue([
      { id: 'doc-A', chaveUnica: 'hash-trip' },
      { id: 'doc-B', chaveUnica: 'hash-trip' },
      { id: 'doc-C', chaveUnica: 'hash-trip' },
    ])

    const service = new DeduplicatorService()
    const duplicatas = await service.findDuplicates('tenant-test', 'empresa-test')

    expect(duplicatas).toHaveLength(1)
    expect(duplicatas[0]).toHaveLength(3)
  })

  it('Múltiplos grupos de duplicatas → retorna todos os grupos', async () => {
    mockDocumentoFiscal.findMany.mockResolvedValue([
      { id: 'doc-1', chaveUnica: 'hash-grupo-1' },
      { id: 'doc-2', chaveUnica: 'hash-grupo-1' },
      { id: 'doc-3', chaveUnica: 'hash-grupo-2' },
      { id: 'doc-4', chaveUnica: 'hash-grupo-2' },
      { id: 'doc-5', chaveUnica: 'hash-unico' },
    ])

    const service = new DeduplicatorService()
    const duplicatas = await service.findDuplicates('tenant-test', 'empresa-test')

    expect(duplicatas).toHaveLength(2)
    const todosIds = duplicatas.flat()
    expect(todosIds).toContain('doc-1')
    expect(todosIds).toContain('doc-2')
    expect(todosIds).toContain('doc-3')
    expect(todosIds).toContain('doc-4')
    // O único não deve aparecer
    expect(todosIds).not.toContain('doc-5')
  })
})
