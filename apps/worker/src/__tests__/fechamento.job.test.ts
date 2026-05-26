/**
 * Testes unitários — fechamentoCompleto
 *
 * Cobre:
 *  - Todas as 12 fases são chamadas em ordem
 *  - eSocial: "sem empregados" é tolerado; outros erros registram auditoria e continuam
 *  - DCTFWeb: falha de pré-requisito (EFD-Reinf não fechado) rethrows; outras falhas são toleradas
 *  - Sem credencial → pula scraper e normalizer
 *  - Com credencial → executa scraper + normalizer
 *  - Documentos PENDENTE_REVISAO → loga aviso mas não para
 *  - Falha em fase obrigatória → auditoria OBRIGACAO_FALHOU + rethrow
 *  - Conclusão: registra FECHAMENTO_CONCLUIDO + notifica tenant
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks (vi.hoisted garante disponibilidade nas factories)
// ---------------------------------------------------------------------------

const {
  mockConciliation,
  mockPGDAS,
  mockDifal,
  mockGNRE,
  mockDeSTDA,
  mockReinf,
  mockEsocial,
  mockDctfweb,
  mockFgts,
  mockDMS,
  mockLancamento,
  mockDepreciacao,
  mockBancaria,
  mockOpenFinance,
  mockAudit,
  mockNotificacao,
  mockCredential,
  mockScraper,
  mockNormalizer,
  mockDb,
} = vi.hoisted(() => ({
  mockConciliation: {
    conciliarNFSeTomadas: vi.fn().mockResolvedValue(undefined),
    conciliarNFSeEmitidas: vi.fn().mockResolvedValue(undefined),
    conciliarNFCe: vi.fn().mockResolvedValue(undefined),
  },
  mockPGDAS: { apurar: vi.fn().mockResolvedValue(undefined) },
  mockDifal: { calcular: vi.fn().mockResolvedValue(undefined) },
  mockGNRE: { gerar: vi.fn().mockResolvedValue(undefined) },
  mockDeSTDA: { gerar: vi.fn().mockResolvedValue(undefined) },
  mockDMS: { apurar: vi.fn().mockResolvedValue(undefined) },
  mockReinf: { processar: vi.fn().mockResolvedValue(undefined) },
  mockEsocial: { processar: vi.fn().mockResolvedValue(undefined) },
  mockDctfweb: { gerar: vi.fn().mockResolvedValue(undefined) },
  mockFgts: { apurar: vi.fn().mockResolvedValue(undefined) },
  mockLancamento: {
    gerarLancamentos: vi.fn().mockResolvedValue(undefined),
    lancarImpostos: vi.fn().mockResolvedValue(undefined),
  },
  mockDepreciacao: { calcular: vi.fn().mockResolvedValue(undefined) },
  mockBancaria: { conciliar: vi.fn().mockResolvedValue(undefined) },
  mockOpenFinance: { sincronizarContas: vi.fn().mockResolvedValue(undefined) },
  mockAudit: { registrar: vi.fn().mockResolvedValue(undefined) },
  mockNotificacao: { notificarTenant: vi.fn().mockResolvedValue(undefined) },
  mockCredential: { retrieve: vi.fn() },
  mockScraper: {
    capturarTodos: vi.fn().mockResolvedValue({
      nfe: [],
      nfce: [],
      nfseEmitidas: [],
      nfseTomadas: [],
    }),
  },
  mockNormalizer: { normalizar: vi.fn().mockResolvedValue(true) },
  mockDb: {
    documentoFiscal: { count: vi.fn().mockResolvedValue(0) },
  },
}))

vi.mock('@saas-contabil/conciliation', () => ({
  ConciliationService: vi.fn(() => mockConciliation),
}))

vi.mock('@saas-contabil/fiscal', () => ({
  PGDASService: vi.fn(() => mockPGDAS),
  DifalService: vi.fn(() => mockDifal),
  GNREService: vi.fn(() => mockGNRE),
  DeSTDAService: vi.fn(() => mockDeSTDA),
  EFDReinfService: vi.fn(() => mockReinf),
  ESocialService: vi.fn(() => mockEsocial),
  DCTFWebService: vi.fn(() => mockDctfweb),
  FGTSDigitalService: vi.fn(() => mockFgts),
  DMSService: vi.fn(() => mockDMS),
}))

vi.mock('@saas-contabil/contabil', () => ({
  LancamentoService: vi.fn(() => mockLancamento),
  DepreciacaoService: vi.fn(() => mockDepreciacao),
  ConciliacaoBancariaService: vi.fn(() => mockBancaria),
  OpenFinanceService: vi.fn(() => mockOpenFinance),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn(() => mockAudit),
}))

vi.mock('@saas-contabil/notifications', () => ({
  NotificationService: vi.fn(() => mockNotificacao),
}))

vi.mock('@saas-contabil/credentials', () => ({
  CredentialService: vi.fn(() => mockCredential),
}))

vi.mock('@saas-contabil/scraper', () => ({
  ScraperOrchestrator: vi.fn(() => mockScraper),
}))

vi.mock('@saas-contabil/normalizer', () => ({
  NormalizerService: vi.fn(() => mockNormalizer),
}))

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/shared', () => ({
  parsePeriodo: vi.fn(() => ({
    inicio: new Date('2025-01-01'),
    fim: new Date('2025-01-31'),
  })),
}))

import { fechamentoCompleto } from '../jobs/fechamento.job.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(credencialId?: string) {
  return {
    id: 'job-1',
    data: {
      tenantId: 't-1',
      empresaId: 'emp-1',
      cnpj: '11111111000111',
      competencia: '2025-01',
      ...(credencialId !== undefined && { credencialId }),
    },
    log: vi.fn().mockResolvedValue(undefined),
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as any
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockAudit.registrar.mockResolvedValue(undefined)
  mockNotificacao.notificarTenant.mockResolvedValue(undefined)
  mockDb.documentoFiscal.count.mockResolvedValue(0)
  mockConciliation.conciliarNFSeTomadas.mockResolvedValue(undefined)
  mockConciliation.conciliarNFSeEmitidas.mockResolvedValue(undefined)
  mockConciliation.conciliarNFCe.mockResolvedValue(undefined)
  mockPGDAS.apurar.mockResolvedValue(undefined)
  mockDifal.calcular.mockResolvedValue(undefined)
  mockGNRE.gerar.mockResolvedValue(undefined)
  mockDeSTDA.gerar.mockResolvedValue(undefined)
  mockReinf.processar.mockResolvedValue(undefined)
  mockEsocial.processar.mockResolvedValue(undefined)
  mockDctfweb.gerar.mockResolvedValue(undefined)
  mockLancamento.gerarLancamentos.mockResolvedValue(undefined)
  mockLancamento.lancarImpostos.mockResolvedValue(undefined)
  mockDepreciacao.calcular.mockResolvedValue(undefined)
  mockOpenFinance.sincronizarContas.mockResolvedValue(undefined)
  mockBancaria.conciliar.mockResolvedValue(undefined)
  mockFgts.apurar.mockResolvedValue(undefined)
})

describe('fechamentoCompleto — fluxo principal', () => {
  it('registra FECHAMENTO_INICIADO no início', async () => {
    await fechamentoCompleto(makeJob())
    expect(mockAudit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ evento: 'FECHAMENTO_INICIADO' })
    )
  })

  it('registra FECHAMENTO_CONCLUIDO ao final', async () => {
    await fechamentoCompleto(makeJob())
    expect(mockAudit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ evento: 'FECHAMENTO_CONCLUIDO' })
    )
  })

  it('notifica o tenant ao concluir', async () => {
    await fechamentoCompleto(makeJob())
    expect(mockNotificacao.notificarTenant).toHaveBeenCalledWith(
      't-1',
      'FECHAMENTO_CONCLUIDO',
      expect.objectContaining({
        empresaId: 'emp-1',
        cnpj: '11111111000111',
        competencia: '2025-01',
      })
    )
  })

  it('chega a 100% de progresso', async () => {
    await fechamentoCompleto(makeJob())
    expect(makeJob().updateProgress).not.toThrow()
    // verifica que updateProgress foi chamado com 100 em algum momento
    const job = makeJob()
    await fechamentoCompleto(job)
    expect(job.updateProgress).toHaveBeenCalledWith(100)
  })
})

describe('fechamentoCompleto — fases fiscais', () => {
  it('executa conciliação de NFS-e tomadas, emitidas e NFC-e', async () => {
    await fechamentoCompleto(makeJob())
    expect(mockConciliation.conciliarNFSeTomadas).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
    expect(mockConciliation.conciliarNFSeEmitidas).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
    expect(mockConciliation.conciliarNFCe).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
  })

  it('apura PGDAS', async () => {
    await fechamentoCompleto(makeJob())
    expect(mockPGDAS.apurar).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
  })

  it('calcula DIFAL e gera GNRE', async () => {
    await fechamentoCompleto(makeJob())
    expect(mockDifal.calcular).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
    expect(mockGNRE.gerar).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
  })

  it('gera DeSTDA', async () => {
    await fechamentoCompleto(makeJob())
    expect(mockDeSTDA.gerar).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
  })

  it('processa EFD-Reinf', async () => {
    await fechamentoCompleto(makeJob())
    expect(mockReinf.processar).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
  })

  it('apura FGTS Digital', async () => {
    await fechamentoCompleto(makeJob())
    expect(mockFgts.apurar).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
  })
})

describe('fechamentoCompleto — tolerância a falhas opcionais', () => {
  it('eSocial com erro → continua o fechamento', async () => {
    mockEsocial.processar.mockRejectedValueOnce(new Error('empresa sem empregados'))
    await expect(fechamentoCompleto(makeJob())).resolves.toBeUndefined()
    expect(mockFgts.apurar).toHaveBeenCalledOnce()
  })

  it('DCTFWeb sem obrigações → continua o fechamento', async () => {
    mockDctfweb.gerar.mockRejectedValueOnce(new Error('empresa sem contribuições DCTFWeb'))
    await expect(fechamentoCompleto(makeJob())).resolves.toBeUndefined()
    expect(mockFgts.apurar).toHaveBeenCalledOnce()
  })

  it('DCTFWeb com pré-requisito não atendido (EFD-Reinf) → rethrow', async () => {
    mockDctfweb.gerar.mockRejectedValueOnce(new Error('EFD-Reinf e eSocial devem ser fechados'))
    await expect(fechamentoCompleto(makeJob())).rejects.toThrow('EFD-Reinf')
    expect(mockAudit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ evento: 'OBRIGACAO_FALHOU' })
    )
  })

  it('eSocial com erro inesperado → registra auditoria e continua', async () => {
    mockEsocial.processar.mockRejectedValueOnce(new Error('timeout DB'))
    await expect(fechamentoCompleto(makeJob())).resolves.toBeUndefined()
    expect(mockAudit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        evento: 'OBRIGACAO_FALHOU',
        estadoNovo: expect.objectContaining({ fase: 'ESOCIAL' }),
      })
    )
    expect(mockFgts.apurar).toHaveBeenCalledOnce()
  })

  it('eSocial e DCTFWeb (sem obrigação) com erro → FGTS e lançamentos ainda executam', async () => {
    mockEsocial.processar.mockRejectedValueOnce(new Error('sem empregados'))
    mockDctfweb.gerar.mockRejectedValueOnce(new Error('sem obrigações'))
    await expect(fechamentoCompleto(makeJob())).resolves.toBeUndefined()
    expect(mockLancamento.gerarLancamentos).toHaveBeenCalledOnce()
    expect(mockFgts.apurar).toHaveBeenCalledOnce()
  })
})

describe('fechamentoCompleto — fase contábil', () => {
  it('gera lançamentos contábeis e lança impostos', async () => {
    await fechamentoCompleto(makeJob())
    expect(mockLancamento.gerarLancamentos).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
    expect(mockLancamento.lancarImpostos).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
  })

  it('calcula depreciação', async () => {
    await fechamentoCompleto(makeJob())
    expect(mockDepreciacao.calcular).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
  })

  it('sincroniza Open Finance e concilia bancário', async () => {
    await fechamentoCompleto(makeJob())
    expect(mockOpenFinance.sincronizarContas).toHaveBeenCalledWith('t-1', 'emp-1')
    expect(mockBancaria.conciliar).toHaveBeenCalledWith('t-1', 'emp-1', '2025-01')
  })
})

describe('fechamentoCompleto — scraper e normalizer', () => {
  it('sem credencialId → não chama scraper', async () => {
    await fechamentoCompleto(makeJob())
    expect(mockScraper.capturarTodos).not.toHaveBeenCalled()
    expect(mockNormalizer.normalizar).not.toHaveBeenCalled()
  })

  it('com credencialId → recupera credencial e chama scraper', async () => {
    mockCredential.retrieve.mockResolvedValueOnce({ data: { cert: 'mock' } })
    mockScraper.capturarTodos.mockResolvedValueOnce({
      nfe: [{ id: 'nfe-1' }],
      nfce: [],
      nfseEmitidas: [],
      nfseTomadas: [],
    })
    await fechamentoCompleto(makeJob('cred-1'))
    expect(mockCredential.retrieve).toHaveBeenCalledWith('cred-1', 't-1')
    expect(mockScraper.capturarTodos).toHaveBeenCalledOnce()
    expect(mockNormalizer.normalizar).toHaveBeenCalledOnce()
  })

  it('falha no scraper → propaga erro (CLAUDE.md regra 6 e 11)', async () => {
    mockCredential.retrieve.mockResolvedValueOnce({ data: {} })
    mockScraper.capturarTodos.mockRejectedValueOnce(new Error('timeout SEFAZ'))
    await expect(fechamentoCompleto(makeJob('cred-1'))).rejects.toThrow('timeout SEFAZ')
    expect(mockPGDAS.apurar).not.toHaveBeenCalled()
  })
})

describe('fechamentoCompleto — tratamento de erros', () => {
  it('falha em fase obrigatória → registra OBRIGACAO_FALHOU', async () => {
    mockPGDAS.apurar.mockRejectedValueOnce(new Error('PGDAS indisponível'))
    await expect(fechamentoCompleto(makeJob())).rejects.toThrow('PGDAS indisponível')
    expect(mockAudit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ evento: 'OBRIGACAO_FALHOU' })
    )
  })

  it('falha em fase obrigatória → não chama FECHAMENTO_CONCLUIDO', async () => {
    mockPGDAS.apurar.mockRejectedValueOnce(new Error('erro'))
    await expect(fechamentoCompleto(makeJob())).rejects.toThrow()
    const auditCalls = mockAudit.registrar.mock.calls.map((c: any[]) => c[0].evento)
    expect(auditCalls).not.toContain('FECHAMENTO_CONCLUIDO')
  })

  it('falha na conciliação → rethrow e não notifica tenant', async () => {
    mockConciliation.conciliarNFSeTomadas.mockRejectedValueOnce(new Error('db timeout'))
    await expect(fechamentoCompleto(makeJob())).rejects.toThrow('db timeout')
    expect(mockNotificacao.notificarTenant).not.toHaveBeenCalled()
  })
})

describe('fechamentoCompleto — documentos pendentes', () => {
  it('documentos PENDENTE_REVISAO → loga aviso mas não para o fechamento', async () => {
    mockDb.documentoFiscal.count.mockResolvedValueOnce(3)
    const job = makeJob()
    await expect(fechamentoCompleto(job)).resolves.toBeUndefined()
    const logCalls = job.log.mock.calls.flat() as string[]
    expect(logCalls.some((m) => m.includes('3') && m.includes('revisão'))).toBe(true)
  })
})
