/**
 * Testes unitários — EncerramentoSNService
 *
 * Cobre:
 *  - Empresa não SN → lança erro "não é do Simples Nacional"
 *  - Empresa não encontrada → lança erro
 *  - Empresa Comércio (CNAE 4711-3) → executa PGDAS, DIFAL, ICMS-ST
 *  - Empresa Serviços (CNAE 6201-5) → executa PGDAS, DMS; DIFAL como NAO_APLICAVEL
 *  - Empresa Indústria (CNAE 1011-2) → executa PGDAS, DIFAL, ICMS-ST
 *  - Erro no PGDAS → passo.pgdas = 'ERRO', não propaga exceção
 *  - Erro no DIFAL → passo.difal = 'ERRO', continua os outros passos
 *  - Resultado contém empresaId, cnpj, competencia, tipo
 *  - Registra auditoria de encerramento
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Decimal } from 'decimal.js'

// ---------------------------------------------------------------------------
// Mocks dos serviços internos — devem vir ANTES do import do serviço testado
// ---------------------------------------------------------------------------

const mockPGDASApurar = vi.fn()
const mockDifalCalcular = vi.fn()
const mockIcmsStCalcular = vi.fn()
const mockGNREGerar = vi.fn()
const mockDeSTDAGerar = vi.fn()
const mockDMSApurar = vi.fn()
const mockEFDReinfProcessar = vi.fn()

vi.mock('../pgdas.service.js', () => ({
  PGDASService: vi.fn(() => ({ apurar: mockPGDASApurar })),
}))

vi.mock('../difal.service.js', () => ({
  DifalService: vi.fn(() => ({ calcular: mockDifalCalcular })),
}))

vi.mock('../icms-st.service.js', () => ({
  IcmsStService: vi.fn(() => ({ calcular: mockIcmsStCalcular })),
}))

vi.mock('../gnre.service.js', () => ({
  GNREService: vi.fn(() => ({ gerar: mockGNREGerar })),
}))

vi.mock('../destda.service.js', () => ({
  DeSTDAService: vi.fn(() => ({ gerar: mockDeSTDAGerar })),
}))

vi.mock('../dms.service.js', () => ({
  DMSService: vi.fn(() => ({ apurar: mockDMSApurar })),
}))

vi.mock('../efdreinf.service.js', () => ({
  EFDReinfService: vi.fn(() => ({ processar: mockEFDReinfProcessar })),
}))

// ---------------------------------------------------------------------------
// Mock do banco de dados
// ---------------------------------------------------------------------------

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  documentoFiscal: { count: vi.fn() },
  obrigacao: { count: vi.fn() },
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

// ---------------------------------------------------------------------------
// Mock do AuditService
// ---------------------------------------------------------------------------

const mockAuditRegistrar = vi.fn()

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => ({
    registrar: mockAuditRegistrar,
  })),
}))

// ---------------------------------------------------------------------------
// Mock de parsePeriodo (necessário para verificarNFSeTomadaComRetencao)
// ---------------------------------------------------------------------------

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

import { EncerramentoSNService } from '../encerramento-sn.service.js'

// ---------------------------------------------------------------------------
// Constantes de teste
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-1'
const COMPETENCIA = '2025-01'

const EMPRESA_COMERCIO = {
  id: 'emp-1',
  cnpj: '11111111000191',
  regime: 'SIMPLES_NACIONAL',
  cnae: '4711-3/00',
  ativa: true,
}

const EMPRESA_SERVICOS = {
  id: 'emp-2',
  cnpj: '22222222000100',
  regime: 'SIMPLES_NACIONAL',
  cnae: '6201-5/00',
  ativa: true,
}

const EMPRESA_INDUSTRIA = {
  id: 'emp-3',
  cnpj: '33333333000155',
  regime: 'SIMPLES_NACIONAL',
  cnae: '1011-2/00',
  ativa: true,
}

// Resultado padrão do PGDAS
const PGDAS_RESULTADO = { valorDAS: new Decimal('1500.00') }

// Resultado padrão do DIFAL (array de resultados por UF)
const DIFAL_RESULTADO = [{ ufDestino: 'SP', valorTotal: new Decimal('200.00') }]

// Resultado padrão do ICMS-ST
const ICMS_ST_RESULTADO = {
  totalIcmsSt: new Decimal('100.00'),
  itens: [],
}

// Resultado padrão do DMS
const DMS_RESULTADO = { totalISS: new Decimal('300.00') }

// ---------------------------------------------------------------------------
// Reset de mocks entre testes
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()

  // Empresa padrão = comércio SN
  mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_COMERCIO)

  // Sem NFSe tomada com retenção por padrão
  mockDb.documentoFiscal.count.mockResolvedValue(0)

  // 3 obrigações geradas
  mockDb.obrigacao.count.mockResolvedValue(3)

  // Serviços internos resolvem com sucesso
  mockPGDASApurar.mockResolvedValue(PGDAS_RESULTADO)
  mockDifalCalcular.mockResolvedValue(DIFAL_RESULTADO)
  mockIcmsStCalcular.mockResolvedValue(ICMS_ST_RESULTADO)
  mockGNREGerar.mockResolvedValue({})
  mockDeSTDAGerar.mockResolvedValue({})
  mockDMSApurar.mockResolvedValue(DMS_RESULTADO)
  mockEFDReinfProcessar.mockResolvedValue({})
})

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('EncerramentoSNService', () => {
  describe('encerrar() — validações', () => {
    it('lança erro quando empresa não é encontrada', async () => {
      mockDb.empresaCliente.findUnique.mockResolvedValue(null)

      const service = new EncerramentoSNService()
      await expect(service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)).rejects.toThrow(
        'Empresa não encontrada'
      )
    })

    it('lança erro quando empresa não é do Simples Nacional', async () => {
      mockDb.empresaCliente.findUnique.mockResolvedValue({
        ...EMPRESA_COMERCIO,
        regime: 'LUCRO_PRESUMIDO',
      })

      const service = new EncerramentoSNService()
      await expect(service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)).rejects.toThrow(
        'não é do Simples Nacional'
      )
    })
  })

  describe('encerrar() — Empresa Comércio (CNAE 4711-3)', () => {
    beforeEach(() => {
      mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_COMERCIO)
    })

    it('classifica tipo como COMERCIO', async () => {
      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(resultado.tipo).toBe('COMERCIO')
    })

    it('executa PGDAS com sucesso → passo.pgdas = OK', async () => {
      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(mockPGDASApurar).toHaveBeenCalledWith(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)
      expect(resultado.passos.pgdas).toBe('OK')
    })

    it('executa DIFAL com sucesso → passo.difal = OK', async () => {
      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(mockDifalCalcular).toHaveBeenCalledWith(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)
      expect(resultado.passos.difal).toBe('OK')
    })

    it('executa ICMS-ST com sucesso → passo.icmsSt = OK', async () => {
      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(mockIcmsStCalcular).toHaveBeenCalledWith(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)
      expect(resultado.passos.icmsSt).toBe('OK')
    })

    it('executa GNRE quando valorGNRE > 0 → passo.gnre = OK', async () => {
      // DIFAL retorna 200 e ICMS-ST retorna 100 → valorGNRE = 300 > 0
      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(mockGNREGerar).toHaveBeenCalledWith(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)
      expect(resultado.passos.gnre).toBe('OK')
    })

    it('executa DeSTDA quando DIFAL OK e GNRE > 0 → passo.destda = OK', async () => {
      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(mockDeSTDAGerar).toHaveBeenCalledWith(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)
      expect(resultado.passos.destda).toBe('OK')
    })

    it('passo.dms = NAO_APLICAVEL para empresa Comércio', async () => {
      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(resultado.passos.dms).toBe('NAO_APLICAVEL')
      expect(mockDMSApurar).not.toHaveBeenCalled()
    })

    it('retorna valorDAS vindo do PGDAS', async () => {
      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(resultado.valorDAS).toBe('1500.00')
    })

    it('retorna valorGNRE = soma de DIFAL + ICMS-ST', async () => {
      // DIFAL.valorTotal = 200, ICMS-ST.totalIcmsSt = 100 → totalGNRE = 300
      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(resultado.valorGNRE).toBe('300.00')
    })
  })

  describe('encerrar() — Empresa Serviços (CNAE 6201-5)', () => {
    beforeEach(() => {
      mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_SERVICOS)
    })

    it('classifica tipo como SERVICOS', async () => {
      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_SERVICOS.id, COMPETENCIA)

      expect(resultado.tipo).toBe('SERVICOS')
    })

    it('executa PGDAS → passo.pgdas = OK', async () => {
      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_SERVICOS.id, COMPETENCIA)

      expect(resultado.passos.pgdas).toBe('OK')
    })

    it('passo.difal = NAO_APLICAVEL para empresa Serviços', async () => {
      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_SERVICOS.id, COMPETENCIA)

      expect(resultado.passos.difal).toBe('NAO_APLICAVEL')
      expect(mockDifalCalcular).not.toHaveBeenCalled()
    })

    it('passo.icmsSt = NAO_APLICAVEL para empresa Serviços', async () => {
      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_SERVICOS.id, COMPETENCIA)

      expect(resultado.passos.icmsSt).toBe('NAO_APLICAVEL')
      expect(mockIcmsStCalcular).not.toHaveBeenCalled()
    })

    it('executa DMS → passo.dms = OK', async () => {
      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_SERVICOS.id, COMPETENCIA)

      expect(mockDMSApurar).toHaveBeenCalledWith(TENANT_ID, EMPRESA_SERVICOS.id, COMPETENCIA)
      expect(resultado.passos.dms).toBe('OK')
    })

    it('retorna valorISS vindo do DMS', async () => {
      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_SERVICOS.id, COMPETENCIA)

      expect(resultado.valorISS).toBe('300.00')
    })
  })

  describe('encerrar() — Empresa Indústria (CNAE 1011-2)', () => {
    beforeEach(() => {
      mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_INDUSTRIA)
    })

    it('classifica tipo como INDUSTRIA', async () => {
      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_INDUSTRIA.id, COMPETENCIA)

      expect(resultado.tipo).toBe('INDUSTRIA')
    })

    it('executa PGDAS, DIFAL e ICMS-ST para Indústria', async () => {
      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_INDUSTRIA.id, COMPETENCIA)

      expect(resultado.passos.pgdas).toBe('OK')
      expect(resultado.passos.difal).toBe('OK')
      expect(resultado.passos.icmsSt).toBe('OK')
    })

    it('passo.dms = NAO_APLICAVEL para empresa Indústria', async () => {
      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_INDUSTRIA.id, COMPETENCIA)

      expect(resultado.passos.dms).toBe('NAO_APLICAVEL')
    })
  })

  describe('encerrar() — tratamento de erros', () => {
    it('erro no PGDAS → passo.pgdas = ERRO, não propaga exceção', async () => {
      mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_COMERCIO)
      mockPGDASApurar.mockRejectedValue(new Error('falha no PGDAS'))

      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(resultado.passos.pgdas).toBe('ERRO')
      expect(resultado.erros).toContain('PGDAS: falha no PGDAS')
    })

    it('erro no DIFAL → passo.difal = ERRO, execução continua (ICMS-ST ainda é tentado)', async () => {
      mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_COMERCIO)
      mockDifalCalcular.mockRejectedValue(new Error('falha no DIFAL'))

      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(resultado.passos.difal).toBe('ERRO')
      expect(resultado.erros).toContain('DIFAL: falha no DIFAL')
      // ICMS-ST ainda deve ser executado
      expect(mockIcmsStCalcular).toHaveBeenCalled()
      expect(resultado.passos.icmsSt).toBe('OK')
    })

    it('erro no ICMS-ST → passo.icmsSt = ERRO, outros passos continuam', async () => {
      mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_COMERCIO)
      mockIcmsStCalcular.mockRejectedValue(new Error('falha no ST'))

      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(resultado.passos.icmsSt).toBe('ERRO')
      expect(resultado.erros).toContain('ICMS-ST: falha no ST')
    })

    it('erro no DMS → passo.dms = ERRO, não propaga exceção (empresa Serviços)', async () => {
      mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_SERVICOS)
      mockDMSApurar.mockRejectedValue(new Error('falha no DMS'))

      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_SERVICOS.id, COMPETENCIA)

      expect(resultado.passos.dms).toBe('ERRO')
      expect(resultado.erros).toContain('DMS: falha no DMS')
    })

    it('múltiplos erros são acumulados em resultado.erros sem lançar exceção', async () => {
      mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_COMERCIO)
      mockPGDASApurar.mockRejectedValue(new Error('err pgdas'))
      mockDifalCalcular.mockRejectedValue(new Error('err difal'))
      mockIcmsStCalcular.mockRejectedValue(new Error('err st'))

      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(resultado.erros).toHaveLength(3)
      expect(resultado.erros).toContain('PGDAS: err pgdas')
      expect(resultado.erros).toContain('DIFAL: err difal')
      expect(resultado.erros).toContain('ICMS-ST: err st')
    })
  })

  describe('encerrar() — resultado e estrutura', () => {
    beforeEach(() => {
      mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_COMERCIO)
    })

    it('resultado contém empresaId correto', async () => {
      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(resultado.empresaId).toBe(EMPRESA_COMERCIO.id)
    })

    it('resultado contém cnpj correto', async () => {
      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(resultado.cnpj).toBe(EMPRESA_COMERCIO.cnpj)
    })

    it('resultado contém competencia correta', async () => {
      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(resultado.competencia).toBe(COMPETENCIA)
    })

    it('resultado contém tipo classificado corretamente', async () => {
      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(resultado.tipo).toBe('COMERCIO')
    })

    it('resultado contém totalObrigacoes do banco', async () => {
      mockDb.obrigacao.count.mockResolvedValue(5)

      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(resultado.totalObrigacoes).toBe(5)
    })

    it('obrigacao.count é chamado com tenantId e empresaId', async () => {
      const service = new EncerramentoSNService()
      await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(mockDb.obrigacao.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT_ID,
            empresaId: EMPRESA_COMERCIO.id,
            competencia: COMPETENCIA,
          }),
        })
      )
    })
  })

  describe('encerrar() — auditoria', () => {
    it('registra evento FECHAMENTO_CONCLUIDO na auditoria', async () => {
      mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_COMERCIO)

      const service = new EncerramentoSNService()
      await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(mockAuditRegistrar).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          cnpj: EMPRESA_COMERCIO.cnpj,
          evento: 'FECHAMENTO_CONCLUIDO',
          responsavel: 'sistema',
          responsavelTipo: 'SISTEMA',
        })
      )
    })

    it('payload de auditoria contém competencia, tipo, passos e erros', async () => {
      mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_COMERCIO)

      const service = new EncerramentoSNService()
      await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(mockAuditRegistrar).toHaveBeenCalledWith(
        expect.objectContaining({
          estadoNovo: expect.objectContaining({
            competencia: COMPETENCIA,
            tipo: 'COMERCIO',
            passos: expect.any(Object),
            erros: expect.any(Array),
          }),
        })
      )
    })
  })

  describe('encerrar() — EFD-Reinf', () => {
    it('executa EFD-Reinf quando há NFSe tomada com retenção', async () => {
      mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_COMERCIO)
      // Simula 1 NFSe tomada com retenção
      mockDb.documentoFiscal.count.mockResolvedValue(1)

      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(mockEFDReinfProcessar).toHaveBeenCalledWith(
        TENANT_ID,
        EMPRESA_COMERCIO.id,
        COMPETENCIA
      )
      expect(resultado.passos.efdReinf).toBe('OK')
    })

    it('passo.efdReinf = NAO_APLICAVEL quando não há NFSe tomada com retenção', async () => {
      mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_COMERCIO)
      mockDb.documentoFiscal.count.mockResolvedValue(0)

      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(mockEFDReinfProcessar).not.toHaveBeenCalled()
      expect(resultado.passos.efdReinf).toBe('NAO_APLICAVEL')
    })

    it('documentoFiscal.count para verificar NFSe inclui tenantId e empresaId', async () => {
      mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_COMERCIO)

      const service = new EncerramentoSNService()
      await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(mockDb.documentoFiscal.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT_ID,
            empresaId: EMPRESA_COMERCIO.id,
          }),
        })
      )
    })
  })

  describe('encerrar() — GNRE e DeSTDA não executam quando valorGNRE = 0', () => {
    it('não executa GNRE quando DIFAL e ICMS-ST retornam 0', async () => {
      mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_COMERCIO)
      mockDifalCalcular.mockResolvedValue([{ ufDestino: 'SP', valorTotal: new Decimal('0.00') }])
      mockIcmsStCalcular.mockResolvedValue({ totalIcmsSt: new Decimal('0.00'), itens: [] })

      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(mockGNREGerar).not.toHaveBeenCalled()
      expect(resultado.passos.gnre).toBe('NAO_APLICAVEL')
    })

    it('não executa DeSTDA quando valorGNRE = 0', async () => {
      mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_COMERCIO)
      mockDifalCalcular.mockResolvedValue([{ ufDestino: 'SP', valorTotal: new Decimal('0.00') }])
      mockIcmsStCalcular.mockResolvedValue({ totalIcmsSt: new Decimal('0.00'), itens: [] })

      const service = new EncerramentoSNService()
      const resultado = await service.encerrar(TENANT_ID, EMPRESA_COMERCIO.id, COMPETENCIA)

      expect(mockDeSTDAGerar).not.toHaveBeenCalled()
      expect(resultado.passos.destda).toBe('NAO_APLICAVEL')
    })
  })
})
