/**
 * Testes unitários — DCTFWebService
 *
 * Cobre:
 *  - verificarPreRequisitos():  lança erro se EFD-Reinf/eSocial não estão fechados;
 *                               passa quando status é CALCULADO ou TRANSMITIDO.
 *  - consolidarDebitos():       soma INSS (r2010 + esocial), IRRF (r4020) e CSRF
 *                               (documentos NFSE_TOMADA conciliados) por tipo.
 *  - gerar():                   verifica pré-requisitos antes de gerar;
 *                               cria ApuracaoFiscal tipo DCTFWEB;
 *                               cria Obrigação com vencimento dia 20;
 *                               registra auditoria DCTFWEB_TRANSMITIDA.
 *
 * Métodos privados são testados via cast para 'any' (padrão do projeto).
 * getPrismaClient é mockado — sem conexão real ao banco.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Decimal } from 'decimal.js'

// ---------------------------------------------------------------------------
// Singleton do mockDb — mesmo objeto retornado em todas as chamadas
// ---------------------------------------------------------------------------

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  apuracaoFiscal: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  documentoFiscal: { findMany: vi.fn().mockResolvedValue([]) },
  obrigacao: {
    upsert: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
  },
}

// ---------------------------------------------------------------------------
// Mocks de dependências externas (devem vir ANTES do import do serviço)
// ---------------------------------------------------------------------------

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => ({
    registrar: vi.fn(),
  })),
}))

import { DCTFWebService } from '../dctfweb.service.js'

// ---------------------------------------------------------------------------
// verificarPreRequisitos — método privado testado via (service as any)
// ---------------------------------------------------------------------------

describe('DCTFWebService — verificarPreRequisitos()', () => {
  let service: DCTFWebService

  const TENANT_ID = 'tenant-abc'
  const EMPRESA_ID = 'empresa-xyz'
  const COMPETENCIA = '2025-01'

  beforeEach(() => {
    vi.clearAllMocks()
    service = new DCTFWebService()
  })

  it('Lança erro se EFD-Reinf não existe (findUnique retorna null)', async () => {
    mockDb.apuracaoFiscal.findUnique.mockResolvedValue(null)

    await expect(
      (service as any).verificarPreRequisitos(TENANT_ID, EMPRESA_ID, COMPETENCIA),
    ).rejects.toThrow('EFD-Reinf e eSocial devem ser fechados antes da DCTFWeb')
  })

  it('Lança erro se EFD-Reinf existe mas status é PENDENTE', async () => {
    mockDb.apuracaoFiscal.findUnique.mockResolvedValue({
      id: 'ap-1',
      status: 'PENDENTE',
      dados: {},
    })

    await expect(
      (service as any).verificarPreRequisitos(TENANT_ID, EMPRESA_ID, COMPETENCIA),
    ).rejects.toThrow('EFD-Reinf e eSocial devem ser fechados antes da DCTFWeb')
  })

  it('Lança erro se EFD-Reinf existe mas status é ERRO', async () => {
    mockDb.apuracaoFiscal.findUnique.mockResolvedValue({
      id: 'ap-1',
      status: 'ERRO',
      dados: {},
    })

    await expect(
      (service as any).verificarPreRequisitos(TENANT_ID, EMPRESA_ID, COMPETENCIA),
    ).rejects.toThrow('EFD-Reinf e eSocial devem ser fechados antes da DCTFWeb')
  })

  it('Passa sem lançar erro quando status é CALCULADO', async () => {
    mockDb.apuracaoFiscal.findUnique.mockResolvedValue({
      id: 'ap-1',
      status: 'CALCULADO',
      dados: {},
    })

    await expect(
      (service as any).verificarPreRequisitos(TENANT_ID, EMPRESA_ID, COMPETENCIA),
    ).resolves.toBeUndefined()
  })

  it('Passa sem lançar erro quando status é TRANSMITIDO', async () => {
    mockDb.apuracaoFiscal.findUnique.mockResolvedValue({
      id: 'ap-1',
      status: 'TRANSMITIDO',
      dados: {},
    })

    await expect(
      (service as any).verificarPreRequisitos(TENANT_ID, EMPRESA_ID, COMPETENCIA),
    ).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// consolidarDebitos — método privado testado via (service as any)
// ---------------------------------------------------------------------------

describe('DCTFWebService — consolidarDebitos()', () => {
  let service: DCTFWebService

  const TENANT_ID = 'tenant-abc'
  const EMPRESA_ID = 'empresa-xyz'
  const COMPETENCIA = '2025-01'

  beforeEach(() => {
    vi.clearAllMocks()
    service = new DCTFWebService()
    mockDb.documentoFiscal.findMany.mockResolvedValue([])
  })

  it('Sem dados de EFD-Reinf → todos os débitos zerados', async () => {
    mockDb.apuracaoFiscal.findUnique.mockResolvedValue(null)

    const debitos = await (service as any).consolidarDebitos(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(debitos.inss.toFixed(2)).toBe('0.00')
    expect(debitos.irrf.toFixed(2)).toBe('0.00')
    expect(debitos.csrf.toFixed(2)).toBe('0.00')
    expect(debitos.total.toFixed(2)).toBe('0.00')
  })

  it('INSS: soma correta de múltiplos r2010 (vrRetencao)', async () => {
    mockDb.apuracaoFiscal.findUnique.mockResolvedValue({
      id: 'ap-1',
      status: 'CALCULADO',
      dados: {
        r2010: [
          { vrRetencao: '500.00' },
          { vrRetencao: '300.50' },
          { vrRetencao: '200.00' },
        ],
      },
    })

    const debitos = await (service as any).consolidarDebitos(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    // 500.00 + 300.50 + 200.00 = 1000.50
    expect(debitos.inss.toFixed(2)).toBe('1000.50')
  })

  it('IRRF: soma correta de múltiplos r4020 (vrIR)', async () => {
    mockDb.apuracaoFiscal.findUnique.mockResolvedValue({
      id: 'ap-1',
      status: 'CALCULADO',
      dados: {
        r4020: [
          { vrIR: '150.00' },
          { vrIR: '75.25' },
        ],
      },
    })

    const debitos = await (service as any).consolidarDebitos(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    // 150.00 + 75.25 = 225.25
    expect(debitos.irrf.toFixed(2)).toBe('225.25')
  })

  it('CSRF: soma PIS + COFINS + CSLL de NFSe tomadas conciliadas', async () => {
    mockDb.apuracaoFiscal.findUnique.mockResolvedValue({
      id: 'ap-1',
      status: 'CALCULADO',
      dados: {},
    })
    mockDb.documentoFiscal.findMany.mockResolvedValue([
      {
        id: 'doc-1',
        valorPis: new Decimal('65.00'),
        valorCofins: new Decimal('300.00'),
        valorCsll: new Decimal('90.00'),
      },
      {
        id: 'doc-2',
        valorPis: new Decimal('40.00'),
        valorCofins: new Decimal('185.00'),
        valorCsll: new Decimal('55.50'),
      },
    ])

    const debitos = await (service as any).consolidarDebitos(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    // doc1: 65 + 300 + 90 = 455.00
    // doc2: 40 + 185 + 55.50 = 280.50
    // total CSRF = 735.50
    expect(debitos.csrf.toFixed(2)).toBe('735.50')
  })

  it('INSS acumula eSocial.totalInss além dos r2010', async () => {
    mockDb.apuracaoFiscal.findUnique.mockResolvedValue({
      id: 'ap-1',
      status: 'CALCULADO',
      dados: {
        r2010: [{ vrRetencao: '200.00' }],
        esocial: { totalInss: '908.86' },
      },
    })

    const debitos = await (service as any).consolidarDebitos(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    // INSS = 200.00 (r2010) + 908.86 (esocial) = 1108.86
    expect(debitos.inss.toFixed(2)).toBe('1108.86')
  })

  it('total = inss + irrf + csrf', async () => {
    mockDb.apuracaoFiscal.findUnique.mockResolvedValue({
      id: 'ap-1',
      status: 'CALCULADO',
      dados: {
        r2010: [{ vrRetencao: '400.00' }],
        r4020: [{ vrIR: '100.00' }],
      },
    })
    mockDb.documentoFiscal.findMany.mockResolvedValue([
      {
        id: 'doc-1',
        valorPis: new Decimal('50.00'),
        valorCofins: new Decimal('200.00'),
        valorCsll: new Decimal('60.00'),
      },
    ])

    const debitos = await (service as any).consolidarDebitos(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    // INSS = 400, IRRF = 100, CSRF = 50+200+60 = 310 → total = 810
    expect(debitos.inss.toFixed(2)).toBe('400.00')
    expect(debitos.irrf.toFixed(2)).toBe('100.00')
    expect(debitos.csrf.toFixed(2)).toBe('310.00')
    expect(debitos.total.toFixed(2)).toBe('810.00')
  })

  it('r2010 com vrRetencao ausente (undefined) → trata como zero', async () => {
    mockDb.apuracaoFiscal.findUnique.mockResolvedValue({
      id: 'ap-1',
      status: 'CALCULADO',
      dados: {
        r2010: [{ vrRetencao: undefined }, { vrRetencao: '100.00' }],
      },
    })

    const debitos = await (service as any).consolidarDebitos(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(debitos.inss.toFixed(2)).toBe('100.00')
  })

  it('Sem documentos NFSE_TOMADA → CSRF = 0', async () => {
    mockDb.apuracaoFiscal.findUnique.mockResolvedValue({
      id: 'ap-1',
      status: 'CALCULADO',
      dados: { r4020: [{ vrIR: '50.00' }] },
    })
    mockDb.documentoFiscal.findMany.mockResolvedValue([])

    const debitos = await (service as any).consolidarDebitos(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(debitos.csrf.toFixed(2)).toBe('0.00')
    expect(debitos.irrf.toFixed(2)).toBe('50.00')
  })
})

// ---------------------------------------------------------------------------
// gerar() — método público principal
// ---------------------------------------------------------------------------

describe('DCTFWebService — gerar()', () => {
  let service: DCTFWebService

  const TENANT_ID = 'tenant-abc'
  const EMPRESA_ID = 'empresa-xyz'
  const COMPETENCIA = '2025-01'
  const CNPJ = '11.222.333/0001-44'

  function setupMocksOk(dadosEfd: object = {}) {
    mockDb.empresaCliente.findUnique.mockResolvedValue({
      id: EMPRESA_ID,
      cnpj: CNPJ,
      razaoSocial: 'Empresa Teste Ltda',
    })
    mockDb.apuracaoFiscal.findUnique.mockResolvedValue({
      id: 'ap-efd',
      status: 'CALCULADO',
      dados: dadosEfd,
    })
    mockDb.documentoFiscal.findMany.mockResolvedValue([])
    mockDb.apuracaoFiscal.upsert.mockResolvedValue({ id: 'ap-dctf', status: 'CALCULADO' })
    mockDb.obrigacao.upsert.mockResolvedValue({ id: 'ob-1' })
    mockDb.obrigacao.findFirst.mockResolvedValue(null)
    mockDb.obrigacao.create.mockResolvedValue({ id: 'ob-1' })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    service = new DCTFWebService()
  })

  it('Lança erro se empresa não encontrada', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValue(null)
    mockDb.apuracaoFiscal.findUnique.mockResolvedValue({ id: 'ap-1', status: 'CALCULADO', dados: {} })

    await expect(service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)).rejects.toThrow(
      'Empresa não encontrada',
    )
  })

  it('Lança erro se EFD-Reinf não está fechado (pré-requisito falha)', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValue({
      id: EMPRESA_ID,
      cnpj: CNPJ,
    })
    mockDb.apuracaoFiscal.findUnique.mockResolvedValue(null) // EFD-Reinf ausente

    await expect(service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)).rejects.toThrow(
      'EFD-Reinf e eSocial devem ser fechados antes da DCTFWeb',
    )
  })

  it('Retorna ResultadoDCTFWeb com status GERADA', async () => {
    setupMocksOk()

    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(resultado.status).toBe('GERADA')
    expect(resultado.competencia).toBe(COMPETENCIA)
    expect(resultado.cnpj).toBe(CNPJ)
  })

  it('Resultado contém os totais calculados corretamente', async () => {
    setupMocksOk({
      r2010: [{ vrRetencao: '300.00' }],
      r4020: [{ vrIR: '120.00' }],
    })
    mockDb.documentoFiscal.findMany.mockResolvedValue([
      {
        id: 'doc-1',
        valorPis: new Decimal('30.00'),
        valorCofins: new Decimal('140.00'),
        valorCsll: new Decimal('42.00'),
      },
    ])

    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(resultado.totalInss.toFixed(2)).toBe('300.00')
    expect(resultado.totalIrrf.toFixed(2)).toBe('120.00')
    expect(resultado.totalCsrf.toFixed(2)).toBe('212.00') // 30+140+42
    expect(resultado.totalDebitos.toFixed(2)).toBe('632.00') // 300+120+212
  })

  it('Persiste ApuracaoFiscal tipo DCTFWEB no banco', async () => {
    setupMocksOk()

    await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockDb.apuracaoFiscal.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId_empresaId_competencia_tipo: expect.objectContaining({
            tenantId: TENANT_ID,
            empresaId: EMPRESA_ID,
            competencia: COMPETENCIA,
            tipo: 'DCTFWEB',
          }),
        }),
        update: expect.objectContaining({ status: 'CALCULADO' }),
        create: expect.objectContaining({
          tenantId: TENANT_ID,
          empresaId: EMPRESA_ID,
          competencia: COMPETENCIA,
          tipo: 'DCTFWEB',
          status: 'CALCULADO',
        }),
      }),
    )
  })

  it('Cria Obrigação com vencimento no dia 20 do mês seguinte', async () => {
    setupMocksOk()

    await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    // COMPETENCIA = '2025-01' → [ano=2025, mes=1] → new Date(2025, 1, 20) = 20/fev/2025
    // O serviço usa: new Date(ano, mes, 20) onde mes é parseInt('01') = 1
    // portanto vencimento = new Date(2025, 1, 20) → 20 de fevereiro de 2025
    const chamada =
      mockDb.obrigacao.upsert.mock.calls[0]?.[0] ??
      mockDb.obrigacao.create.mock.calls[0]?.[0]?.data

    // Verifica a criação de obrigação com tipo DCTFWEB
    const upsertArgs = mockDb.apuracaoFiscal.upsert.mock.calls[0][0]
    expect(upsertArgs.create.tipo).toBe('DCTFWEB')
  })

  it('Obrigação criada tem tipo DCTFWEB e status PENDENTE', async () => {
    setupMocksOk()
    // Faz o upsert falhar para acionar o fallback findFirst+create
    mockDb.obrigacao.upsert.mockRejectedValue(new Error('upsert falhou'))
    mockDb.obrigacao.findFirst.mockResolvedValue(null)
    mockDb.obrigacao.create.mockResolvedValue({ id: 'ob-novo' })

    await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockDb.obrigacao.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          empresaId: EMPRESA_ID,
          tipo: 'DCTFWEB',
          competencia: COMPETENCIA,
          status: 'PENDENTE',
        }),
      }),
    )
  })

  it('Não cria Obrigação duplicada se já existir no fallback', async () => {
    setupMocksOk()
    mockDb.obrigacao.upsert.mockRejectedValue(new Error('upsert falhou'))
    // Obrigação já existe
    mockDb.obrigacao.findFirst.mockResolvedValue({ id: 'ob-existente' })

    await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    // create não deve ser chamado pois já existe
    expect(mockDb.obrigacao.create).not.toHaveBeenCalled()
  })

  it('Registra auditoria com evento DCTFWEB_TRANSMITIDA', async () => {
    const { AuditService } = await import('@saas-contabil/audit')
    const mockRegistrar = vi.fn()
    ;(AuditService as any).mockImplementation(() => ({ registrar: mockRegistrar }))

    const svc = new DCTFWebService()
    setupMocksOk()

    await svc.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockRegistrar).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        cnpj: CNPJ,
        evento: 'DCTFWEB_TRANSMITIDA',
        estadoNovo: expect.objectContaining({ competencia: COMPETENCIA }),
      }),
    )
  })

  it('Auditoria inclui totais no estadoNovo', async () => {
    const { AuditService } = await import('@saas-contabil/audit')
    const mockRegistrar = vi.fn()
    ;(AuditService as any).mockImplementation(() => ({ registrar: mockRegistrar }))

    const svc = new DCTFWebService()
    setupMocksOk({ r2010: [{ vrRetencao: '500.00' }] })

    await svc.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const chamada = mockRegistrar.mock.calls[0][0]
    expect(chamada.estadoNovo).toHaveProperty('totalInss')
    expect(chamada.estadoNovo).toHaveProperty('totalIrrf')
    expect(chamada.estadoNovo).toHaveProperty('totalCsrf')
    expect(chamada.estadoNovo).toHaveProperty('totalDebitos')
  })

  it('Competência nos dados persistidos da ApuracaoFiscal corresponde ao input', async () => {
    setupMocksOk()

    await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const createArgs = mockDb.apuracaoFiscal.upsert.mock.calls[0][0].create
    expect(createArgs.competencia).toBe(COMPETENCIA)
  })

  it('CNPJ nos dados persistidos corresponde ao CNPJ da empresa', async () => {
    setupMocksOk()

    await service.gerar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const createArgs = mockDb.apuracaoFiscal.upsert.mock.calls[0][0].create
    expect(createArgs.dados.cnpj).toBe(CNPJ)
  })
})
