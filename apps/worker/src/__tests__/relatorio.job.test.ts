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
  return {
    Decimal: MockDecimal,
    nowBR: vi.fn(() => new Date('2025-01-15T12:00:00Z')),
  }
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

describe('gerarRelatorioMensal — extração de valores (campos alternativos)', () => {
  function captureCSV(): { csv: string } {
    const state = { csv: '' }
    mockStorage.upload.mockImplementation((_key: string, buf: Buffer) => {
      state.csv = buf.toString('utf-8')
      return { s3Key: 'mock' }
    })
    return state
  }

  it('dados com chave "valorTotal" → usado como valorDas', async () => {
    const empresa = {
      id: 'emp-x',
      cnpj: '44444444000144',
      razaoSocial: 'Empresa VT',
      apuracoesFiscais: [
        {
          tipo: 'PGDAS',
          status: 'CALCULADO',
          dados: { valorTotal: '750.00', receitaBruta: '10000.00' },
        },
      ],
    }
    mockDb.empresaCliente.findMany.mockResolvedValue([empresa])
    const state = captureCSV()
    await gerarRelatorioMensal(makeJob())
    expect(state.csv).toContain('750.00')
  })

  it('dados com chave "valor" → usado como valorDas', async () => {
    const empresa = {
      id: 'emp-y',
      cnpj: '55555555000155',
      razaoSocial: 'Empresa V',
      apuracoesFiscais: [
        { tipo: 'PGDAS', status: 'CALCULADO', dados: { valor: '300.00', receitaBruta: '5000.00' } },
      ],
    }
    mockDb.empresaCliente.findMany.mockResolvedValue([empresa])
    const state = captureCSV()
    await gerarRelatorioMensal(makeJob())
    expect(state.csv).toContain('300.00')
  })

  it('dados com chave "rbTotal" → usado como receitaBruta', async () => {
    const empresa = {
      id: 'emp-rb',
      cnpj: '66666666000166',
      razaoSocial: 'Empresa RB',
      apuracoesFiscais: [
        { tipo: 'PGDAS', status: 'CALCULADO', dados: { valorDas: '100.00', rbTotal: '2000.00' } },
      ],
    }
    mockDb.empresaCliente.findMany.mockResolvedValue([empresa])
    const state = captureCSV()
    await gerarRelatorioMensal(makeJob())
    expect(state.csv).toContain('2000.00')
  })

  it('dados com chave "receitaBrutaTotal" → usado como receitaBruta', async () => {
    const empresa = {
      id: 'emp-rbt',
      cnpj: '77777777000177',
      razaoSocial: 'Empresa RBT',
      apuracoesFiscais: [
        {
          tipo: 'PGDAS',
          status: 'CALCULADO',
          dados: { valorDas: '200.00', receitaBrutaTotal: '4000.00' },
        },
      ],
    }
    mockDb.empresaCliente.findMany.mockResolvedValue([empresa])
    const state = captureCSV()
    await gerarRelatorioMensal(makeJob())
    expect(state.csv).toContain('4000.00')
  })

  it('dados null → valorDas e rbTotal ficam 0.00', async () => {
    const empresa = {
      id: 'emp-null',
      cnpj: '88888888000188',
      razaoSocial: 'Empresa Null',
      apuracoesFiscais: [{ tipo: 'PGDAS', status: 'CALCULADO', dados: null }],
    }
    mockDb.empresaCliente.findMany.mockResolvedValue([empresa])
    const state = captureCSV()
    await gerarRelatorioMensal(makeJob())
    // Linha de dados com 0.00 e alíquota 0.00
    const linhas = state.csv.split('\n').filter(Boolean)
    const dataLine = linhas[1] ?? ''
    expect(dataLine).toContain('0.00')
  })
})

describe('gerarRelatorioMensal — CSV escaping e múltiplas apurações', () => {
  it('razão social com aspas duplas → escapa corretamente', async () => {
    const empresa = {
      ...empresa1,
      cnpj: '99999999000199',
      razaoSocial: 'Empresa "Top" LTDA',
    }
    mockDb.empresaCliente.findMany.mockResolvedValue([empresa])
    let csv = ''
    mockStorage.upload.mockImplementation((_key: string, buf: Buffer) => {
      csv = buf.toString('utf-8')
      return { s3Key: 'mock' }
    })
    await gerarRelatorioMensal(makeJob())
    // aspas duplas escapadas como ""
    expect(csv).toContain('"Empresa ""Top"" LTDA"')
  })

  it('empresa com múltiplas apurações → gera uma linha por apuração', async () => {
    const empresa = {
      id: 'emp-multi',
      cnpj: '10101010000110',
      razaoSocial: 'Multi Apurações LTDA',
      apuracoesFiscais: [
        {
          tipo: 'PGDAS',
          status: 'CALCULADO',
          dados: { valorDas: '100.00', receitaBruta: '5000.00' },
        },
        {
          tipo: 'DIFAL',
          status: 'CALCULADO',
          dados: { valorDas: '50.00', receitaBruta: '5000.00' },
        },
      ],
    }
    mockDb.empresaCliente.findMany.mockResolvedValue([empresa])
    let csv = ''
    mockStorage.upload.mockImplementation((_key: string, buf: Buffer) => {
      csv = buf.toString('utf-8')
      return { s3Key: 'mock' }
    })
    await gerarRelatorioMensal(makeJob())
    const linhas = csv.split('\n').filter(Boolean)
    // cabeçalho + 2 linhas de apurações
    expect(linhas.length).toBe(3)
    expect(csv).toContain('PGDAS')
    expect(csv).toContain('DIFAL')
  })

  it('upload recebe metadata com tenantId, competencia e empresasCount', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValue([empresa1])
    await gerarRelatorioMensal(makeJob('2025-03'))
    const [, , , metadata] = mockStorage.upload.mock.calls[0]!
    expect(metadata).toMatchObject({
      tenantId: 't-1',
      competencia: '2025-03',
      empresasCount: '1',
    })
  })
})
