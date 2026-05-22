/**
 * Testes unitários — AuditService + AuditChainVerifier
 *
 * Cobre:
 *  - registrar(): cria evento com hash SHA-256 do payload + hashAnterior
 *  - Primeiro evento ('GENESIS'): hashAnterior = sha256('GENESIS')
 *  - Hash chain: hashEvento[N] = sha256(payload_N + hash_{N-1})
 *  - buscarEventos(): delega ao banco filtrando por tenantId (e opcionalmente cnpj)
 *  - buscarPendentesRevisao(): filtra apenas eventos PENDENTE_REVISAO_HUMANA
 *  - aprovar(): cria evento APROVACAO_HUMANA referenciando o evento aprovado
 *  - AuditChainVerifier.verificar(): retorna { integro: true } para cadeia válida
 *
 * O PrismaClient é mockado via vi.mock — nenhuma conexão real ao banco.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'crypto'

// ---------------------------------------------------------------------------
// Helpers de hash para montar fixtures nos testes
// ---------------------------------------------------------------------------

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

// ---------------------------------------------------------------------------
// Mock de @saas-contabil/database (deve vir ANTES dos imports dos serviços)
// ---------------------------------------------------------------------------

const mockDb = {
  auditEvent: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
  },
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
  // Re-exporta os enums como constantes simples para satisfazer os tipos
  EntidadeAuditavel: {},
  TipoEventoAudit: {},
  TipoResponsavel: {},
}))

// ---------------------------------------------------------------------------
// Import dos serviços APÓS os mocks
// ---------------------------------------------------------------------------

import { AuditService } from '../audit.service.js'
import { AuditChainVerifier } from '../chain-verifier.js'

// ---------------------------------------------------------------------------
// Factory de AuditEvent fictício para uso nos testes
// ---------------------------------------------------------------------------

function makeAuditEvent(overrides: Partial<{
  id: string
  sequencia: bigint
  tenantId: string
  cnpj: string | null
  entidadeTipo: string
  entidadeId: string
  evento: string
  estadoAnterior: unknown
  estadoNovo: unknown
  responsavel: string
  responsavelTipo: string
  evidencias: string[]
  score: number | null
  aprovadoPor: string | null
  observacao: string | null
  hashEvento: string
  hashAnterior: string
  timestamp: Date
  ipOrigem: string | null
  jobId: string | null
  duracao: number | null
}> = {}) {
  return {
    id: 'evento-id-001',
    sequencia: BigInt(1),
    tenantId: 'tenant-001',
    cnpj: null,
    entidadeTipo: 'DOCUMENTO_FISCAL',
    entidadeId: 'entidade-id-001',
    evento: 'DOCUMENTO_CAPTURADO',
    estadoAnterior: null,
    estadoNovo: null,
    responsavel: 'sistema',
    responsavelTipo: 'SISTEMA',
    evidencias: [],
    score: null,
    aprovadoPor: null,
    observacao: null,
    hashEvento: sha256('payload-ficticio'),
    hashAnterior: sha256('GENESIS'),
    timestamp: new Date('2024-03-15T15:00:00.000Z'),
    ipOrigem: null,
    jobId: null,
    duracao: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// AuditService — registrar()
// ---------------------------------------------------------------------------

describe('AuditService — registrar()', () => {
  let service: AuditService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new AuditService()
  })

  it('primeiro evento: hashAnterior = sha256("GENESIS")', async () => {
    // Sem evento anterior no banco
    mockDb.auditEvent.findFirst.mockResolvedValue(null)

    const eventoRetornado = makeAuditEvent()
    mockDb.auditEvent.create.mockResolvedValue(eventoRetornado)

    await service.registrar({
      tenantId: 'tenant-001',
      entidadeTipo: 'DOCUMENTO_FISCAL',
      entidadeId: 'entidade-001',
      evento: 'DOCUMENTO_CAPTURADO',
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    const { data } = mockDb.auditEvent.create.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(data['hashAnterior']).toBe(sha256('GENESIS'))
  })

  it('evento subsequente usa hashEvento do último evento como hashAnterior', async () => {
    const hashUltimo = sha256('evento-anterior-payload')
    mockDb.auditEvent.findFirst.mockResolvedValue({ hashEvento: hashUltimo })
    mockDb.auditEvent.create.mockResolvedValue(makeAuditEvent({ hashAnterior: hashUltimo }))

    await service.registrar({
      tenantId: 'tenant-001',
      entidadeTipo: 'DOCUMENTO_FISCAL',
      entidadeId: 'entidade-002',
      evento: 'DOCUMENTO_NORMALIZADO',
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    const { data } = mockDb.auditEvent.create.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(data['hashAnterior']).toBe(hashUltimo)
  })

  it('hashEvento = sha256(JSON.stringify({ ...payload, hashAnterior }))', async () => {
    mockDb.auditEvent.findFirst.mockResolvedValue(null)
    mockDb.auditEvent.create.mockResolvedValue(makeAuditEvent())

    await service.registrar({
      tenantId: 'tenant-001',
      entidadeTipo: 'CONCILIACAO',
      entidadeId: 'conciliacao-001',
      evento: 'CONCILIACAO_INICIADA',
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    const { data } = mockDb.auditEvent.create.mock.calls[0]![0] as { data: Record<string, unknown> }
    const hashAnterior = sha256('GENESIS')

    // Reconstrói o payload exatamente como o serviço faz
    const { hashEvento, hashAnterior: _, ...rest } = data as Record<string, unknown>
    const expectedHash = sha256(JSON.stringify({ ...rest, hashAnterior }))

    expect(hashEvento).toBe(expectedHash)
  })

  it('persiste tenantId correto no evento criado', async () => {
    mockDb.auditEvent.findFirst.mockResolvedValue(null)
    mockDb.auditEvent.create.mockResolvedValue(makeAuditEvent({ tenantId: 'tenant-xyz' }))

    await service.registrar({
      tenantId: 'tenant-xyz',
      entidadeTipo: 'DOCUMENTO_FISCAL',
      entidadeId: 'doc-001',
      evento: 'DOCUMENTO_CAPTURADO',
      responsavel: 'job-scraper',
      responsavelTipo: 'SISTEMA',
    })

    const { data } = mockDb.auditEvent.create.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(data['tenantId']).toBe('tenant-xyz')
  })

  it('campos opcionais ausentes são gravados como null ou array vazio', async () => {
    mockDb.auditEvent.findFirst.mockResolvedValue(null)
    mockDb.auditEvent.create.mockResolvedValue(makeAuditEvent())

    await service.registrar({
      tenantId: 'tenant-001',
      entidadeTipo: 'ARQUIVO_S3',
      entidadeId: 'arquivo-001',
      evento: 'ARQUIVO_SALVO',
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
      // cnpj, score, aprovadoPor, observacao, ipOrigem, jobId, duracao — ausentes
    })

    const { data } = mockDb.auditEvent.create.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(data['cnpj']).toBeNull()
    expect(data['score']).toBeNull()
    expect(data['aprovadoPor']).toBeNull()
    expect(data['observacao']).toBeNull()
    expect(data['ipOrigem']).toBeNull()
    expect(data['jobId']).toBeNull()
    expect(data['duracao']).toBeNull()
    expect(data['evidencias']).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// AuditService — buscarEventos()
// ---------------------------------------------------------------------------

describe('AuditService — buscarEventos()', () => {
  let service: AuditService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new AuditService()
  })

  it('retorna eventos do tenant ordenados por sequência decrescente', async () => {
    const eventos = [makeAuditEvent({ sequencia: BigInt(2) }), makeAuditEvent({ sequencia: BigInt(1) })]
    mockDb.auditEvent.findMany.mockResolvedValue(eventos)

    const resultado = await service.buscarEventos('tenant-001')

    expect(mockDb.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-001' },
        orderBy: { sequencia: 'desc' },
      }),
    )
    expect(resultado).toEqual(eventos)
  })

  it('filtra por cnpj quando fornecido', async () => {
    mockDb.auditEvent.findMany.mockResolvedValue([])

    await service.buscarEventos('tenant-001', '11.222.333/0001-81')

    expect(mockDb.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-001', cnpj: '11.222.333/0001-81' },
      }),
    )
  })

  it('respeita o limite padrão de 100 resultados', async () => {
    mockDb.auditEvent.findMany.mockResolvedValue([])

    await service.buscarEventos('tenant-001')

    expect(mockDb.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    )
  })

  it('aceita limite customizado', async () => {
    mockDb.auditEvent.findMany.mockResolvedValue([])

    await service.buscarEventos('tenant-001', undefined, 25)

    expect(mockDb.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 25 }),
    )
  })
})

// ---------------------------------------------------------------------------
// AuditService — buscarPendentesRevisao()
// ---------------------------------------------------------------------------

describe('AuditService — buscarPendentesRevisao()', () => {
  let service: AuditService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new AuditService()
  })

  it('filtra apenas eventos com evento = PENDENTE_REVISAO_HUMANA', async () => {
    const pendentes = [
      makeAuditEvent({ evento: 'PENDENTE_REVISAO_HUMANA', id: 'evt-1' }),
      makeAuditEvent({ evento: 'PENDENTE_REVISAO_HUMANA', id: 'evt-2' }),
    ]
    mockDb.auditEvent.findMany.mockResolvedValue(pendentes)

    const resultado = await service.buscarPendentesRevisao('tenant-001')

    expect(mockDb.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-001', evento: 'PENDENTE_REVISAO_HUMANA' },
      }),
    )
    expect(resultado).toHaveLength(2)
  })

  it('retorna lista vazia quando não há pendentes', async () => {
    mockDb.auditEvent.findMany.mockResolvedValue([])

    const resultado = await service.buscarPendentesRevisao('tenant-abc')

    expect(resultado).toEqual([])
  })

  it('ordena por timestamp crescente (mais antigo primeiro)', async () => {
    mockDb.auditEvent.findMany.mockResolvedValue([])

    await service.buscarPendentesRevisao('tenant-001')

    expect(mockDb.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { timestamp: 'asc' },
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// AuditService — aprovar()
// ---------------------------------------------------------------------------

describe('AuditService — aprovar()', () => {
  let service: AuditService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new AuditService()
  })

  it('cria novo evento APROVACAO_HUMANA com referência ao evento aprovado', async () => {
    const eventoOriginal = makeAuditEvent({
      id: 'evt-pendente-001',
      tenantId: 'tenant-001',
      entidadeTipo: 'CONCILIACAO',
      entidadeId: 'conc-001',
    })

    mockDb.auditEvent.findFirst
      // Primeira chamada: busca o evento a ser aprovado
      .mockResolvedValueOnce(eventoOriginal)
      // Segunda chamada (dentro de registrar()): busca o último evento para hash chain
      .mockResolvedValueOnce({ hashEvento: sha256('hash-anterior') })

    mockDb.auditEvent.create.mockResolvedValue(makeAuditEvent())

    await service.aprovar('evt-pendente-001', 'contador@exemplo.com', 'tenant-001')

    expect(mockDb.auditEvent.create).toHaveBeenCalledOnce()

    const { data } = mockDb.auditEvent.create.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(data['evento']).toBe('APROVACAO_HUMANA')
    expect(data['aprovadoPor']).toBe('contador@exemplo.com')
    expect(data['responsavel']).toBe('contador@exemplo.com')
    expect(data['responsavelTipo']).toBe('USUARIO')
    expect((data['estadoAnterior'] as Record<string, unknown>)['eventoAprovado']).toBe('evt-pendente-001')
  })

  it('lança erro quando evento não é encontrado no banco', async () => {
    mockDb.auditEvent.findFirst.mockResolvedValue(null)

    await expect(
      service.aprovar('evt-inexistente', 'usuario@exemplo.com', 'tenant-001'),
    ).rejects.toThrow('Evento não encontrado')
  })

  it('busca evento combinando id + tenantId (isolamento multi-tenant)', async () => {
    mockDb.auditEvent.findFirst.mockResolvedValue(null)

    await expect(
      service.aprovar('evt-001', 'usuario', 'tenant-isolado'),
    ).rejects.toThrow()

    expect(mockDb.auditEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'evt-001', tenantId: 'tenant-isolado' },
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// AuditChainVerifier — verificar()
// ---------------------------------------------------------------------------

describe('AuditChainVerifier — verificar()', () => {
  let verifier: AuditChainVerifier

  beforeEach(() => {
    vi.clearAllMocks()
    verifier = new AuditChainVerifier()
  })

  /**
   * Constrói uma cadeia de eventos válida com N itens.
   * Cada evento tem hashEvento e hashAnterior corretos segundo o algoritmo
   * implementado em chain-verifier.ts.
   */
  function buildValidChain(n: number) {
    let hashAnterior = sha256('GENESIS')
    const eventos = []

    for (let i = 0; i < n; i++) {
      const rest = {
        id: `evt-${i}`,
        sequencia: BigInt(i + 1),
        tenantId: 'tenant-001',
        cnpj: null,
        entidadeTipo: 'DOCUMENTO_FISCAL',
        entidadeId: `entidade-${i}`,
        evento: 'DOCUMENTO_CAPTURADO',
        estadoAnterior: null,
        estadoNovo: null,
        responsavel: 'sistema',
        responsavelTipo: 'SISTEMA',
        evidencias: [],
        score: null,
        aprovadoPor: null,
        observacao: null,
        timestamp: new Date('2024-03-15T15:00:00.000Z'),
        ipOrigem: null,
        jobId: null,
        duracao: null,
      }
      // Usa o mesmo replacer que chain-verifier.ts para serializar BigInt
      const hashEvento = sha256(
        JSON.stringify(
          { ...rest, hashAnterior },
          (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
        ),
      )
      eventos.push({ ...rest, hashEvento, hashAnterior })
      hashAnterior = hashEvento
    }

    return eventos
  }

  it('retorna { integro: true } para cadeia com 1 evento válido', async () => {
    const chain = buildValidChain(1)
    mockDb.auditEvent.findMany.mockResolvedValue(chain)

    const resultado = await verifier.verificar('tenant-001')

    expect(resultado.integro).toBe(true)
    expect(resultado.totalEventos).toBe(1)
    expect(resultado.eventosVerificados).toBe(1)
    expect(resultado.primeiraFalha).toBeUndefined()
  })

  it('retorna { integro: true } para cadeia com 5 eventos todos válidos', async () => {
    const chain = buildValidChain(5)
    mockDb.auditEvent.findMany.mockResolvedValue(chain)

    const resultado = await verifier.verificar('tenant-001')

    expect(resultado.integro).toBe(true)
    expect(resultado.totalEventos).toBe(5)
    expect(resultado.eventosVerificados).toBe(5)
  })

  it('cadeia vazia → integro: true, totalEventos: 0', async () => {
    mockDb.auditEvent.findMany.mockResolvedValue([])

    const resultado = await verifier.verificar('tenant-001')

    expect(resultado.integro).toBe(true)
    expect(resultado.totalEventos).toBe(0)
    expect(resultado.eventosVerificados).toBe(0)
  })

  it('detecta adulteração: hashEvento errado → integro: false', async () => {
    const chain = buildValidChain(3)
    // Adultera o hashEvento do segundo evento
    chain[1]!.hashEvento = sha256('hash-adulterado')

    mockDb.auditEvent.findMany.mockResolvedValue(chain)

    const resultado = await verifier.verificar('tenant-001')

    expect(resultado.integro).toBe(false)
    expect(resultado.primeiraFalha).toBeDefined()
    expect(resultado.primeiraFalha!.id).toBe('evt-1')
  })

  it('detecta adulteração: hashAnterior errado → integro: false', async () => {
    const chain = buildValidChain(3)
    // Adultera o hashAnterior do terceiro evento (quebra a cadeia)
    chain[2]!.hashAnterior = sha256('hash-anterior-adulterado')

    mockDb.auditEvent.findMany.mockResolvedValue(chain)

    const resultado = await verifier.verificar('tenant-001')

    expect(resultado.integro).toBe(false)
    expect(resultado.primeiraFalha).toBeDefined()
    expect(resultado.primeiraFalha!.id).toBe('evt-2')
  })

  it('consulta apenas os eventos do tenantId correto', async () => {
    mockDb.auditEvent.findMany.mockResolvedValue([])

    await verifier.verificar('tenant-especifico')

    expect(mockDb.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-especifico' },
        orderBy: { sequencia: 'asc' },
      }),
    )
  })

  it('primeiraFalha contém a sequência e o id do evento com problema', async () => {
    const chain = buildValidChain(4)
    // Adultera o terceiro evento (index 2, sequencia BigInt(3))
    chain[2]!.hashEvento = 'hash-invalido'

    mockDb.auditEvent.findMany.mockResolvedValue(chain)

    const resultado = await verifier.verificar('tenant-001')

    expect(resultado.integro).toBe(false)
    expect(resultado.primeiraFalha!.sequencia).toBe(BigInt(3))
    expect(resultado.primeiraFalha!.id).toBe('evt-2')
  })
})
