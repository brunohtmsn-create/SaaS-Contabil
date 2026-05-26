/**
 * Testes unitários — DMSService
 *
 * Cobre:
 *  apurar():
 *   - empresa não encontrada → lança erro
 *   - sem NFSe CONCILIADAS → retorna resultado vazio sem criar obrigação
 *   - NFSe encontradas → agrega por municipioIBGE e calcula ISS
 *   - alíquota padrão 2% usada quando não há config
 *   - alíquota customizada quando config CONFIGURACAO_ISS existe
 *   - cria obrigação DMS com vencimento no dia 10 do mês seguinte
 *   - não duplica obrigação se já existir
 *   - totalServicos e totalISS somam valores de múltiplas NFSe
 *   - porMunicipio contém lista de municípios com IDs das NFSe
 *   - registra audit trail DMS_APURADA
 *   - filtra por tenantId, empresaId e status=CONCILIADO
 *   - usa datas corretas de inicio/fim do período
 *
 * PrismaClient e AuditService são mockados.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Decimal } from '@saas-contabil/shared'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  documentoFiscal: { findMany: vi.fn() },
  obrigacao: { findFirst: vi.fn(), create: vi.fn() },
  alerta: { findFirst: vi.fn() },
}

const mockAudit = { registrar: vi.fn().mockResolvedValue(undefined) }

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => mockAudit),
}))

vi.mock('@saas-contabil/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@saas-contabil/shared')>()
  return {
    ...actual,
    parsePeriodo: vi.fn((_comp: string) => ({
      inicio: new Date('2025-05-01T00:00:00Z'),
      fim: new Date('2025-05-31T23:59:59Z'),
    })),
  }
})

import { DMSService } from '../dms.service.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-dms'
const EMPRESA_ID = 'empresa-dms'
const CNPJ = '11222333000181'
const COMPETENCIA = '2025-05'

const EMPRESA = { id: EMPRESA_ID, cnpj: CNPJ, razaoSocial: 'Acme Serviços LTDA' }

function makeNFSe(id: string, valor: string, ibge = '3550308') {
  return {
    id,
    tipo: 'NFSE_EMITIDA',
    status: 'CONCILIADO',
    valorTotal: new Decimal(valor),
    dadosAdicionais: { municipioIBGE: ibge },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAudit.registrar.mockResolvedValue(undefined)
  mockDb.obrigacao.findFirst.mockResolvedValue(null)
  mockDb.obrigacao.create.mockResolvedValue({ id: 'obr-dms-1' })
  mockDb.alerta.findFirst.mockResolvedValue(null) // sem alíquota customizada por default
})

// ===========================================================================
// empresa não encontrada
// ===========================================================================

describe('DMSService.apurar() — empresa', () => {
  it('empresa não encontrada → lança erro', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)

    const svc = new DMSService()
    await expect(svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)).rejects.toThrow(
      'Empresa não encontrada'
    )
  })
})

// ===========================================================================
// sem NFSe
// ===========================================================================

describe('DMSService.apurar() — sem NFSe CONCILIADAS', () => {
  it('retorna resultado vazio', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(EMPRESA)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([])

    const svc = new DMSService()
    const resultado = await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(resultado.totalNFSe).toBe(0)
    expect(resultado.totalServicos.equals(0)).toBe(true)
    expect(resultado.totalISS.equals(0)).toBe(true)
    expect(resultado.porMunicipio).toHaveLength(0)
  })

  it('não cria obrigação quando não há NFSe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(EMPRESA)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([])

    const svc = new DMSService()
    await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockDb.obrigacao.create).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// NFSe encontradas — cálculos e agrupamento
// ===========================================================================

describe('DMSService.apurar() — NFSe CONCILIADAS encontradas', () => {
  it('calcula ISS com alíquota padrão 2% quando não há config', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(EMPRESA)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeNFSe('nf-1', '5000.00')])

    const svc = new DMSService()
    const resultado = await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    // ISS = 5000 * 0.02 = 100
    expect(resultado.totalISS.toFixed(2)).toBe('100.00')
    expect(resultado.totalServicos.toFixed(2)).toBe('5000.00')
    expect(resultado.totalNFSe).toBe(1)
  })

  it('usa alíquota customizada quando config CONFIGURACAO_ISS existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(EMPRESA)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeNFSe('nf-1', '10000.00')])
    // Simula config de alíquota 5%
    mockDb.alerta.findFirst.mockResolvedValueOnce({
      dados: { municipioIBGE: '3550308', aliquota: '0.05' },
    })

    const svc = new DMSService()
    const resultado = await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    // ISS = 10000 * 0.05 = 500
    expect(resultado.totalISS.toFixed(2)).toBe('500.00')
  })

  it('agrupa por municipioIBGE e cria entrada por município', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(EMPRESA)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeNFSe('nf-1', '3000.00', '3550308'), // SP
      makeNFSe('nf-2', '2000.00', '3304557'), // RJ
      makeNFSe('nf-3', '1000.00', '3550308'), // SP (mesmo IBGE)
    ])

    const svc = new DMSService()
    const resultado = await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(resultado.porMunicipio).toHaveLength(2)

    const sp = resultado.porMunicipio.find((m) => m.municipioIBGE === '3550308')!
    expect(sp.totalServicos.toFixed(2)).toBe('4000.00')
    expect(sp.nfseIds).toContain('nf-1')
    expect(sp.nfseIds).toContain('nf-3')

    const rj = resultado.porMunicipio.find((m) => m.municipioIBGE === '3304557')!
    expect(rj.totalServicos.toFixed(2)).toBe('2000.00')
  })

  it('totalServicos e totalISS somam todos os municípios', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(EMPRESA)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeNFSe('nf-1', '1000.00', '3550308'),
      makeNFSe('nf-2', '2000.00', '3304557'),
    ])

    const svc = new DMSService()
    const resultado = await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(resultado.totalServicos.toFixed(2)).toBe('3000.00')
    expect(resultado.totalISS.toFixed(2)).toBe('60.00') // 3000 * 0.02
  })

  it('porMunicipio[*].nfseIds contém os IDs das NFSe do município', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(EMPRESA)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeNFSe('nf-10', '500.00', '3550308'),
      makeNFSe('nf-11', '750.00', '3550308'),
    ])

    const svc = new DMSService()
    const resultado = await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const sp = resultado.porMunicipio[0]
    expect(sp.nfseIds).toHaveLength(2)
    expect(sp.nfseIds).toContain('nf-10')
    expect(sp.nfseIds).toContain('nf-11')
  })
})

// ===========================================================================
// Criação de obrigação
// ===========================================================================

describe('DMSService.apurar() — obrigação DMS', () => {
  it('cria obrigação DMS quando não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(EMPRESA)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeNFSe('nf-1', '5000.00')])
    mockDb.obrigacao.findFirst.mockResolvedValueOnce(null)

    const svc = new DMSService()
    await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockDb.obrigacao.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          empresaId: EMPRESA_ID,
          tipo: 'DMS',
          competencia: COMPETENCIA,
          status: 'PENDENTE',
        }),
      })
    )
  })

  it('vencimento é dia 10 do mês seguinte à competência', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(EMPRESA)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeNFSe('nf-1', '1000.00')])
    mockDb.obrigacao.findFirst.mockResolvedValueOnce(null)

    const svc = new DMSService()
    await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA) // 2025-05

    const { data } = mockDb.obrigacao.create.mock.calls[0][0]
    // 2025-05 → vencimento dia 10/06/2025
    expect(data.vencimento.getMonth()).toBe(5) // junho (0-indexed)
    expect(data.vencimento.getDate()).toBe(10)
  })

  it('não cria obrigação se já existir', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(EMPRESA)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeNFSe('nf-1', '5000.00')])
    mockDb.obrigacao.findFirst.mockResolvedValueOnce({ id: 'obr-existente' })

    const svc = new DMSService()
    await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockDb.obrigacao.create).not.toHaveBeenCalled()
  })

  it('obrigação criada contém valor totalISS no campo valor', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(EMPRESA)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeNFSe('nf-1', '5000.00')])
    mockDb.obrigacao.findFirst.mockResolvedValueOnce(null)

    const svc = new DMSService()
    await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const { data } = mockDb.obrigacao.create.mock.calls[0][0]
    // 5000 * 0.02 = 100
    expect(data.valor).toBe('100.00')
  })
})

// ===========================================================================
// Filtros e isolamento
// ===========================================================================

describe('DMSService.apurar() — filtros de consulta', () => {
  it('filtra NFSe por tenantId, empresaId, tipo NFSE_EMITIDA e status CONCILIADO', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(EMPRESA)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([])

    const svc = new DMSService()
    await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const where = mockDb.documentoFiscal.findMany.mock.calls[0][0].where
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.empresaId).toBe(EMPRESA_ID)
    expect(where.tipo).toBe('NFSE_EMITIDA')
    expect(where.status).toBe('CONCILIADO')
  })

  it('usa datas de início e fim do período', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(EMPRESA)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([])

    const svc = new DMSService()
    await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const where = mockDb.documentoFiscal.findMany.mock.calls[0][0].where
    expect(where.dataCompetencia.gte).toEqual(new Date('2025-05-01T00:00:00Z'))
    expect(where.dataCompetencia.lte).toEqual(new Date('2025-05-31T23:59:59Z'))
  })
})

// ===========================================================================
// Audit trail
// ===========================================================================

describe('DMSService.apurar() — audit trail', () => {
  it('registra evento DMS_APURADA com tenantId e cnpj', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(EMPRESA)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeNFSe('nf-1', '5000.00')])

    const svc = new DMSService()
    await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockAudit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        cnpj: CNPJ,
        evento: 'DMS_APURADA',
        estadoNovo: expect.objectContaining({ competencia: COMPETENCIA }),
      })
    )
  })

  it('estadoNovo inclui totalNFSe e totalISS', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(EMPRESA)
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeNFSe('nf-1', '1000.00'),
      makeNFSe('nf-2', '2000.00'),
    ])

    const svc = new DMSService()
    await svc.apurar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const { estadoNovo } = mockAudit.registrar.mock.calls[0][0]
    expect(estadoNovo.totalNFSe).toBe(2)
    expect(estadoNovo.totalISS).toBe('60.00') // (1000+2000) * 0.02
  })
})
