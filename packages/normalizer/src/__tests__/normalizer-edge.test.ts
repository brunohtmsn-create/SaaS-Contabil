/**
 * Testes unitários — NormalizerService (casos de borda)
 *
 * Cobre:
 *  - NFC-e: tipo NFCE → direção inferida como SAIDA
 *  - CTE: tipo CTE → chaveUnica usa chaveAcesso (mesmo tratamento de NFE)
 *  - NFE com direcao explícita → usa a direção fornecida
 *  - NFE sem direcao explícita → padrão ENTRADA
 *  - operacaoInterestadual: ufEmitente != ufDestinatario → true
 *  - operacaoInterestadual: mesma UF → false
 *  - xmlContent ausente → usa JSON.stringify como fallback para hash
 *  - CNPJ com formatação (pontos/barras) → limpo para 14 dígitos
 *  - valorProdutos/valorServicos ausentes → padrão Decimal(0)
 *  - dataCompetencia calculada a partir de dataEmissao
 *  - auditoria registrada após create com tenantId correto
 *  - chaveUnica NFSe inclui municipioIBGE na composição
 *  - chaveUnica NFSe usa valorServicos quando disponível
 *  - chaveUnica NFE com chaveAcesso de 44 dígitos
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Decimal } from 'decimal.js'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDocumentoFiscal = {
  findFirst: vi.fn().mockResolvedValue(null),
  findMany: vi.fn().mockResolvedValue([]),
  create: vi.fn(),
}

const mockAuditRegistrar = vi.fn().mockResolvedValue(undefined)

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => ({
    documentoFiscal: mockDocumentoFiscal,
  })),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => ({
    registrar: mockAuditRegistrar,
  })),
}))

import { NormalizerService } from '../normalizer.service.js'
import type { DocumentoRaw } from '../types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRaw(overrides: Partial<DocumentoRaw> = {}): DocumentoRaw {
  return {
    tipo: 'NFE',
    chaveAcesso: '35250111111111000191550010000001231000000001',
    numero: '00000123',
    serie: '001',
    dataEmissao: new Date('2025-03-15'),
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

function makeCreatedDoc(raw: DocumentoRaw) {
  return {
    id: 'doc-' + Math.random().toString(36).slice(2, 8),
    tenantId: 'tenant-test',
    empresaId: 'empresa-test',
    tipo: raw.tipo,
    status: 'NORMALIZADO',
    cnpjEmitente: '11111111000191',
    cnpjDestinatario: '22222222000100',
    valorTotal: raw.valorTotal,
    chaveUnica: 'hash-chave',
    hashIntegridade: 'a'.repeat(64),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDocumentoFiscal.findFirst.mockResolvedValue(null)
  mockDocumentoFiscal.create.mockImplementation((args) =>
    Promise.resolve(makeCreatedDoc(args.data))
  )
})

// ===========================================================================
// Direção inferida por tipo
// ===========================================================================

describe('NormalizerService — direção inferida por tipo', () => {
  it('NFC-e → direcao SAIDA', async () => {
    const raw = makeRaw({
      tipo: 'NFCE',
      chaveAcesso: '35250111111111000191650010000001231000000001',
    })

    const svc = new NormalizerService()
    await svc.normalizar(raw, 'tenant-test', 'empresa-test')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    expect(createArgs[0].data.direcao).toBe('SAIDA')
  })

  it('NFE com direcao explícita SAIDA → usa SAIDA', async () => {
    const raw = makeRaw({ tipo: 'NFE', direcao: 'SAIDA' })

    const svc = new NormalizerService()
    await svc.normalizar(raw, 'tenant-test', 'empresa-test')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    expect(createArgs[0].data.direcao).toBe('SAIDA')
  })

  it('NFE sem direcao explícita → padrão ENTRADA', async () => {
    const raw = makeRaw({ tipo: 'NFE', direcao: undefined })

    const svc = new NormalizerService()
    await svc.normalizar(raw, 'tenant-test', 'empresa-test')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    expect(createArgs[0].data.direcao).toBe('ENTRADA')
  })
})

// ===========================================================================
// operacaoInterestadual
// ===========================================================================

describe('NormalizerService — operacaoInterestadual', () => {
  it('ufEmitente SP e ufDestinatario RJ → operacaoInterestadual = true', async () => {
    const raw = makeRaw({ ufEmitente: 'SP', ufDestinatario: 'RJ' })

    const svc = new NormalizerService()
    await svc.normalizar(raw, 'tenant-test', 'empresa-test')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    expect(createArgs[0].data.operacaoInterestadual).toBe(true)
  })

  it('ufEmitente SP e ufDestinatario SP → operacaoInterestadual = false', async () => {
    const raw = makeRaw({ ufEmitente: 'SP', ufDestinatario: 'SP' })

    const svc = new NormalizerService()
    await svc.normalizar(raw, 'tenant-test', 'empresa-test')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    expect(createArgs[0].data.operacaoInterestadual).toBe(false)
  })

  it('ufEmitente MG e ufDestinatario PR → operacaoInterestadual = true', async () => {
    const raw = makeRaw({ ufEmitente: 'MG', ufDestinatario: 'PR' })

    const svc = new NormalizerService()
    await svc.normalizar(raw, 'tenant-test', 'empresa-test')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    expect(createArgs[0].data.operacaoInterestadual).toBe(true)
  })

  it('ufEmitente e ufDestinatario ambos nulos → ambos viram "" → operacaoInterestadual = false', async () => {
    const raw = makeRaw({ ufEmitente: undefined, ufDestinatario: undefined })

    const svc = new NormalizerService()
    await svc.normalizar(raw as any, 'tenant-test', 'empresa-test')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    expect(createArgs[0].data.operacaoInterestadual).toBe(false)
  })
})

// ===========================================================================
// CNPJ cleaning
// ===========================================================================

describe('NormalizerService — limpeza de CNPJ', () => {
  it('CNPJ com pontos e barras → limpo para 14 dígitos no payload', async () => {
    const raw = makeRaw({ cnpjEmitente: '11.111.111/0001-91' })

    const svc = new NormalizerService()
    await svc.normalizar(raw, 'tenant-test', 'empresa-test')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    expect(createArgs[0].data.cnpjEmitente).toMatch(/^\d{14}$/)
    expect(createArgs[0].data.cnpjEmitente).toBe('11111111000191')
  })

  it('CNPJ destinatário com formatação → limpo para 14 dígitos', async () => {
    const raw = makeRaw({ cnpjDestinatario: '22.222.222/0001-00' })

    const svc = new NormalizerService()
    await svc.normalizar(raw, 'tenant-test', 'empresa-test')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    expect(createArgs[0].data.cnpjDestinatario).toMatch(/^\d{14}$/)
    expect(createArgs[0].data.cnpjDestinatario).toBe('22222222000100')
  })
})

// ===========================================================================
// Valores opcionais com padrão Decimal(0)
// ===========================================================================

describe('NormalizerService — valores opcionais com padrão zero', () => {
  it('valorProdutos ausente → gravado como Decimal(0)', async () => {
    const raw = makeRaw({ valorProdutos: undefined })

    const svc = new NormalizerService()
    await svc.normalizar(raw, 'tenant-test', 'empresa-test')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    expect(createArgs[0].data.valorProdutos.toFixed(2)).toBe('0.00')
  })

  it('valorIcms ausente → gravado como Decimal(0)', async () => {
    const raw = makeRaw({ valorIcms: undefined })

    const svc = new NormalizerService()
    await svc.normalizar(raw, 'tenant-test', 'empresa-test')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    expect(createArgs[0].data.valorIcms.toFixed(2)).toBe('0.00')
  })

  it('valorIss ausente → gravado como Decimal(0)', async () => {
    const raw = makeRaw({ valorIss: undefined })

    const svc = new NormalizerService()
    await svc.normalizar(raw, 'tenant-test', 'empresa-test')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    expect(createArgs[0].data.valorIss.toFixed(2)).toBe('0.00')
  })

  it('valorPis e valorCofins ausentes → ambos Decimal(0)', async () => {
    const raw = makeRaw({ valorPis: undefined, valorCofins: undefined })

    const svc = new NormalizerService()
    await svc.normalizar(raw, 'tenant-test', 'empresa-test')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    expect(createArgs[0].data.valorPis.toFixed(2)).toBe('0.00')
    expect(createArgs[0].data.valorCofins.toFixed(2)).toBe('0.00')
  })
})

// ===========================================================================
// Hash com fallback para JSON.stringify
// ===========================================================================

describe('NormalizerService — hash com xmlContent ausente', () => {
  it('xmlContent ausente → hash ainda gerado (usando JSON.stringify)', async () => {
    const raw = makeRaw({ xmlContent: undefined })

    const svc = new NormalizerService()
    await svc.normalizar(raw, 'tenant-test', 'empresa-test')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    const hash: string = createArgs[0].data.hashIntegridade
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('xmlContent vazio e xmlContent ausente → hashes distintos (fallback vs string vazia)', async () => {
    const svc = new NormalizerService()

    const raw1 = makeRaw({
      chaveAcesso: '35250111111111000191550010000001111000000001',
      xmlContent: undefined,
    })
    await svc.normalizar(raw1, 'tenant-test', 'empresa-test')
    const hash1: string = mockDocumentoFiscal.create.mock.calls[0]![0].data.hashIntegridade

    vi.clearAllMocks()
    mockDocumentoFiscal.findFirst.mockResolvedValue(null)
    mockDocumentoFiscal.create.mockImplementation((args) =>
      Promise.resolve(makeCreatedDoc(args.data))
    )

    const raw2 = makeRaw({
      chaveAcesso: '35250122222222000191550010000002222000000002',
      xmlContent: '',
    })
    await svc.normalizar(raw2, 'tenant-test', 'empresa-test')
    const hash2: string = mockDocumentoFiscal.create.mock.calls[0]![0].data.hashIntegridade

    expect(hash1).not.toBe(hash2)
  })
})

// ===========================================================================
// Auditoria após create
// ===========================================================================

describe('NormalizerService — auditoria após normalizar', () => {
  it('registra auditoria com evento DOCUMENTO_NORMALIZADO', async () => {
    const raw = makeRaw()

    const svc = new NormalizerService()
    await svc.normalizar(raw, 'tenant-test', 'empresa-test')

    expect(mockAuditRegistrar).toHaveBeenCalledOnce()
    const [auditArgs] = mockAuditRegistrar.mock.calls
    expect(auditArgs[0].evento).toBe('DOCUMENTO_NORMALIZADO')
  })

  it('auditoria contém tenantId correto', async () => {
    const raw = makeRaw()

    const svc = new NormalizerService()
    await svc.normalizar(raw, 'tenant-auditoria', 'empresa-test')

    const [auditArgs] = mockAuditRegistrar.mock.calls
    expect(auditArgs[0].tenantId).toBe('tenant-auditoria')
  })

  it('documento duplicado → sem auditoria (retorna existente sem criar)', async () => {
    mockDocumentoFiscal.findFirst.mockResolvedValue({ id: 'doc-existente' })

    const raw = makeRaw()
    const svc = new NormalizerService()
    await svc.normalizar(raw, 'tenant-test', 'empresa-test')

    expect(mockAuditRegistrar).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// chaveUnica — NFSe usa municipioIBGE e valorServicos
// ===========================================================================

describe('NormalizerService — chaveUnica NFSe', () => {
  it('dois docs NFSe com mesmo municipioIBGE → mesma chaveUnica (deduplicado)', async () => {
    const base = {
      tipo: 'NFSE_EMITIDA',
      chaveAcesso: undefined,
      numero: '001',
      dataEmissao: new Date('2025-02-10'),
      cnpjEmitente: '11111111000191',
      nomeEmitente: 'Prestadora',
      cnpjDestinatario: '22222222000100',
      valorTotal: new Decimal('500.00'),
      valorServicos: new Decimal('500.00'),
      municipioIBGE: '3550308',
      fonte: 'NFSE_PORTAL',
    } as DocumentoRaw

    const svc = new NormalizerService()

    mockDocumentoFiscal.create.mockResolvedValueOnce(makeCreatedDoc(base))
    await svc.normalizar(base, 'tenant-test', 'empresa-test')
    const chave1 = mockDocumentoFiscal.findFirst.mock.calls[0]![0].where.chaveUnica

    vi.clearAllMocks()
    mockDocumentoFiscal.findFirst.mockResolvedValue(null)
    mockDocumentoFiscal.create.mockResolvedValueOnce(makeCreatedDoc(base))

    await svc.normalizar({ ...base }, 'tenant-test', 'empresa-test')
    const chave2 = mockDocumentoFiscal.findFirst.mock.calls[0]![0].where.chaveUnica

    expect(chave1).toBe(chave2)
  })

  it('dois docs NFSe com municipioIBGE diferentes → chaves distintas', async () => {
    const base = {
      tipo: 'NFSE_EMITIDA',
      chaveAcesso: undefined,
      numero: '001',
      dataEmissao: new Date('2025-02-10'),
      cnpjEmitente: '11111111000191',
      nomeEmitente: 'Prestadora',
      cnpjDestinatario: '22222222000100',
      valorTotal: new Decimal('500.00'),
      valorServicos: new Decimal('500.00'),
      fonte: 'NFSE_PORTAL',
    } as DocumentoRaw

    const svc = new NormalizerService()

    mockDocumentoFiscal.create.mockResolvedValueOnce(makeCreatedDoc(base))
    await svc.normalizar({ ...base, municipioIBGE: '3550308' }, 'tenant-test', 'empresa-test')
    const chave1 = mockDocumentoFiscal.findFirst.mock.calls[0]![0].where.chaveUnica

    vi.clearAllMocks()
    mockDocumentoFiscal.findFirst.mockResolvedValue(null)
    mockDocumentoFiscal.create.mockResolvedValueOnce(makeCreatedDoc(base))

    await svc.normalizar({ ...base, municipioIBGE: '3300456' }, 'tenant-test', 'empresa-test')
    const chave2 = mockDocumentoFiscal.findFirst.mock.calls[0]![0].where.chaveUnica

    expect(chave1).not.toBe(chave2)
  })
})

// ===========================================================================
// dataCompetencia
// ===========================================================================

describe('NormalizerService — dataCompetencia calculada de dataEmissao', () => {
  it('dataEmissao em março → dataCompetencia é início de março', async () => {
    const raw = makeRaw({ dataEmissao: new Date('2025-03-15') })

    const svc = new NormalizerService()
    await svc.normalizar(raw, 'tenant-test', 'empresa-test')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    const dc: Date = createArgs[0].data.dataCompetencia
    expect(dc.getMonth()).toBe(2) // março = índice 2
    expect(dc.getDate()).toBe(1)
  })

  it('dataEmissao em novembro → dataCompetencia é início de novembro', async () => {
    const raw = makeRaw({ dataEmissao: new Date('2025-11-20') })

    const svc = new NormalizerService()
    await svc.normalizar(raw, 'tenant-test', 'empresa-test')

    const [createArgs] = mockDocumentoFiscal.create.mock.calls
    const dc: Date = createArgs[0].data.dataCompetencia
    expect(dc.getMonth()).toBe(10) // novembro = índice 10
    expect(dc.getDate()).toBe(1)
  })
})

// ===========================================================================
// chaveUnica — fallbacks para campos nulos (operador ??)
// ===========================================================================

describe('NormalizerService — chaveUnica NFSe com campos nulos', () => {
  const baseNFSe = {
    tipo: 'NFSE_EMITIDA',
    chaveAcesso: undefined,
    numero: '001',
    dataEmissao: new Date('2025-03-10'),
    cnpjEmitente: '11111111000191',
    nomeEmitente: 'Prestadora',
    cnpjDestinatario: '22222222000100',
    valorTotal: new Decimal('800.00'),
    fonte: 'NFSE_PORTAL',
  } as DocumentoRaw

  it('municipioIBGE nulo → chaveUnica usa string vazia como fallback (operador ??)', async () => {
    const rawSemIbge = { ...baseNFSe, municipioIBGE: null, valorServicos: new Decimal('800.00') }
    const rawComIbge = {
      ...baseNFSe,
      municipioIBGE: '3550308',
      valorServicos: new Decimal('800.00'),
    }

    const svc = new NormalizerService()

    // doc sem IBGE
    await svc.normalizar(rawSemIbge as any, 'tenant-test', 'empresa-test')
    const chaveSemIbge = mockDocumentoFiscal.findFirst.mock.calls[0]![0].where.chaveUnica

    vi.clearAllMocks()
    mockDocumentoFiscal.findFirst.mockResolvedValue(null)

    // doc com IBGE diferente → chave diferente (prova que '' e '3550308' geram hashes distintos)
    await svc.normalizar(rawComIbge, 'tenant-test', 'empresa-test')
    const chaveComIbge = mockDocumentoFiscal.findFirst.mock.calls[0]![0].where.chaveUnica

    expect(typeof chaveSemIbge).toBe('string')
    expect(chaveSemIbge).toHaveLength(64) // SHA-256 hex
    expect(chaveSemIbge).not.toBe(chaveComIbge)
  })

  it('NFE sem chaveAcesso → chaveUnica gerada via fallback cnpj-numero-serie', async () => {
    const rawSemChave = makeRaw({
      tipo: 'NFE',
      chaveAcesso: undefined,
      numero: '0000777',
      serie: '002',
    })

    const svc = new NormalizerService()
    await svc.normalizar(rawSemChave as any, 'tenant-test', 'empresa-test')

    const chaveUsada = mockDocumentoFiscal.findFirst.mock.calls[0]![0].where.chaveUnica
    expect(typeof chaveUsada).toBe('string')
    expect(chaveUsada).toHaveLength(64) // SHA-256 hex
  })

  it('valorServicos nulo → chaveUnica usa valorTotal como fallback (operador ??)', async () => {
    const rawSemServicos = { ...baseNFSe, municipioIBGE: '3550308', valorServicos: null }
    const rawComServicos = {
      ...baseNFSe,
      municipioIBGE: '3550308',
      valorServicos: new Decimal('400.00'), // valor diferente
    }

    const svc = new NormalizerService()

    // doc sem valorServicos → usa valorTotal = 800.00
    await svc.normalizar(rawSemServicos as any, 'tenant-test', 'empresa-test')
    const chaveSemServicos = mockDocumentoFiscal.findFirst.mock.calls[0]![0].where.chaveUnica

    vi.clearAllMocks()
    mockDocumentoFiscal.findFirst.mockResolvedValue(null)

    // doc com valorServicos = 400.00 → chave diferente (400 != 800)
    await svc.normalizar(rawComServicos, 'tenant-test', 'empresa-test')
    const chaveComServicos = mockDocumentoFiscal.findFirst.mock.calls[0]![0].where.chaveUnica

    expect(typeof chaveSemServicos).toBe('string')
    expect(chaveSemServicos).not.toBe(chaveComServicos)
  })
})
