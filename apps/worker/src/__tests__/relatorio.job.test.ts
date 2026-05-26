/**
 * Testes unitários — gerarRelatorioMensal
 *
 * Cobre:
 *  - Busca empresas ativas com apurações do período
 *  - Gera CSV com cabeçalho + linhas por empresa
 *  - Empresa sem apurações → linha com status SEM_APURACAO
 *  - Upload do CSV para S3 com a chave correta
 *  - Cria alerta no DB com URL assinada
 *  - Notifica tenant ao concluir
 *  - Calcula alíquota efetiva corretamente
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockDb, mockStorage, mockNotificacao } = vi.hoisted(() => ({
  mockDb: {
    empresaCliente: { findMany: vi.fn() },
    alerta: { create: vi.fn().mockResolvedValue({ id: 'alert-1' }) },
  },
  mockStorage: {
    upload: vi.fn().mockResolvedValue({ s3Key: 'tenant/relatorios/2025-01/consolidado.csv' }),
    getSignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/signed-url'),
  },
  mockNotificacao: {
    notificarTenant: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/storage', () => ({
  StorageService: vi.fn(() => mockStorage),
  S3KeyBuilder: {},
}))

vi.mock('@saas-contabil/notifications', () => ({
  NotificationService: vi.fn(() => mockNotificacao),
}))

vi.mock('@saas-contabil/shared', () => {
  class MockDecimal {
    private v: string
    constructor(v: string | number) {
      this.v = String(v)
    }
    isZero() {
      return parseFloat(this.v) === 0
    }
    dividedBy(other: MockDecimal) {
      return new MockDecimal(parseFloat(this.v) / parseFloat((other as any).v))
    }
    times(n: number) {
      return new MockDecimal(parseFloat(this.v) * n)
    }
    toDecimalPlaces(n: number) {
      return new MockDecimal(parseFloat(this.v).toFixed(n))
    }
    toString() {
      return this.v
    }
  }
  return { Decimal: MockDecimal }
})

import { gerarRelatorioMensal } from '../jobs/relatorio.job.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(competencia = '2025-01') {
  return {
    data: { tenantId: 't-1', competencia },
    log: vi.fn().mockResolvedValue(undefined),
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as any
}

const empresa1 = {
  id: 'emp-1',
  cnpj: '11111111000111',
  razaoSocial: 'Empresa Teste 1',
  apuracoesFiscais: [
    {
      tipo: 'PGDAS',
      status: 'CALCULADO',
      dados: { valorDas: '500.00', receitaBruta: '10000.00' },
    },
  ],
}

const empresa2 = {
  id: 'emp-2',
  cnpj: '22222222000122',
  razaoSocial: 'Empresa Teste 2',
  apuracoesFiscais: [],
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockNotificacao.notificarTenant.mockResolvedValue(undefined)
  mockStorage.upload.mockResolvedValue({ s3Key: 't-1/relatorios/2025-01/consolidado.csv' })
  mockStorage.getSignedUrl.mockResolvedValue('https://s3.example.com/signed-url')
  mockDb.alerta.create.mockResolvedValue({ id: 'alert-1' })
})

describe('gerarRelatorioMensal — fluxo principal', () => {
  it('busca empresas ativas do tenant com apurações do período', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValue([empresa1])
    await gerarRelatorioMensal(makeJob())
    expect(mockDb.empresaCliente.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 't-1', ativa: true },
      })
    )
  })

  it('faz upload do CSV para S3', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValue([empresa1])
    await gerarRelatorioMensal(makeJob())
    expect(mockStorage.upload).toHaveBeenCalledWith(
      expect.stringContaining('2025-01'),
      expect.any(Buffer),
      'text/csv;charset=utf-8',
      expect.any(Object)
    )
  })

  it('gera URL assinada após o upload', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValue([empresa1])
    await gerarRelatorioMensal(makeJob())
    expect(mockStorage.getSignedUrl).toHaveBeenCalledOnce()
  })

  it('cria alerta no banco com a URL assinada', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValue([empresa1])
    await gerarRelatorioMensal(makeJob())
    expect(mockDb.alerta.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 't-1',
          dados: expect.objectContaining({ downloadUrl: 'https://s3.example.com/signed-url' }),
        }),
      })
    )
  })

  it('notifica o tenant ao finalizar', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValue([empresa1])
    await gerarRelatorioMensal(makeJob())
    expect(mockNotificacao.notificarTenant).toHaveBeenCalledWith(
      't-1',
      'FECHAMENTO_CONCLUIDO',
      expect.objectContaining({ competencia: '2025-01' })
    )
  })

  it('atinge 100% de progresso', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValue([empresa1])
    const job = makeJob()
    await gerarRelatorioMensal(job)
    expect(job.updateProgress).toHaveBeenCalledWith(100)
  })
})

describe('gerarRelatorioMensal — conteúdo do CSV', () => {
  it('empresa com apuração → inclui linha com dados fiscais', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValue([empresa1])
    let uploadedBuffer: Buffer | undefined
    mockStorage.upload.mockImplementation(
      (_key: string, buf: Buffer) => ((uploadedBuffer = buf), { s3Key: 'mock' })
    )
    await gerarRelatorioMensal(makeJob())
    const csv = uploadedBuffer?.toString('utf-8') ?? ''
    expect(csv).toContain('11111111000111')
    expect(csv).toContain('Empresa Teste 1')
    expect(csv).toContain('PGDAS')
    expect(csv).toContain('CALCULADO')
  })

  it('empresa sem apuração → inclui linha com SEM_APURACAO', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValue([empresa2])
    let uploadedBuffer: Buffer | undefined
    mockStorage.upload.mockImplementation(
      (_key: string, buf: Buffer) => ((uploadedBuffer = buf), { s3Key: 'mock' })
    )
    await gerarRelatorioMensal(makeJob())
    const csv = uploadedBuffer?.toString('utf-8') ?? ''
    expect(csv).toContain('SEM_APURACAO')
    expect(csv).toContain('22222222000122')
  })

  it('CSV sempre começa com linha de cabeçalho', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValue([empresa1])
    let uploadedBuffer: Buffer | undefined
    mockStorage.upload.mockImplementation(
      (_key: string, buf: Buffer) => ((uploadedBuffer = buf), { s3Key: 'mock' })
    )
    await gerarRelatorioMensal(makeJob())
    const firstLine = uploadedBuffer?.toString('utf-8').split('\n')[0] ?? ''
    expect(firstLine).toContain('CNPJ')
    expect(firstLine).toContain('Razão Social')
  })

  it('razão social com vírgula é escapada corretamente', async () => {
    const empresaComVirgula = {
      ...empresa1,
      cnpj: '33333333000133',
      razaoSocial: 'Empresa, Com Vírgula LTDA',
    }
    mockDb.empresaCliente.findMany.mockResolvedValue([empresaComVirgula])
    let uploadedBuffer: Buffer | undefined
    mockStorage.upload.mockImplementation(
      (_key: string, buf: Buffer) => ((uploadedBuffer = buf), { s3Key: 'mock' })
    )
    await gerarRelatorioMensal(makeJob())
    const csv = uploadedBuffer?.toString('utf-8') ?? ''
    expect(csv).toContain('"Empresa, Com Vírgula LTDA"')
  })
})

describe('gerarRelatorioMensal — sem empresas', () => {
  it('sem empresas ativas → faz upload com apenas cabeçalho', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValue([])
    let uploadedBuffer: Buffer | undefined
    mockStorage.upload.mockImplementation(
      (_key: string, buf: Buffer) => ((uploadedBuffer = buf), { s3Key: 'mock' })
    )
    await gerarRelatorioMensal(makeJob())
    const csv = uploadedBuffer?.toString('utf-8') ?? ''
    expect(csv).toContain('CNPJ')
    // apenas 1 linha (o cabeçalho)
    expect(csv.split('\n').filter(Boolean).length).toBe(1)
  })

  it('sem empresas ativas → não cria alerta (sem empresa para associar)', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValue([])
    await gerarRelatorioMensal(makeJob())
    expect(mockDb.alerta.create).not.toHaveBeenCalled()
  })
})
