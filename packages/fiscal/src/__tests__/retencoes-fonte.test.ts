/**
 * Testes unitários — RetencoesNaFonteService
 *
 * Cobre:
 *  - empresa não encontrada → lança erro
 *  - regime SN/MEI → lança erro (exclusivo LP/LR)
 *  - regime LP → aceito
 *  - regime LR → aceito
 *  - sem documentos → totais zerados
 *  - IRRF: 1,5% sobre qualquer pagamento
 *  - CSRF: aplicado somente quando total ao prestador > R$5.000
 *  - CSRF: não aplicado quando total <= R$5.000
 *  - múltiplos prestadores → calculados individualmente
 *  - documentos do mesmo prestador → agrupados
 *  - totalRetencoes = IRRF + PIS + COFINS + CSLL
 *  - prazoRecolhimento = dia 20 do mês seguinte
 *  - persiste com tipo DCTFWEB
 *  - registra evento DCTFWEB_TRANSMITIDA no audit
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAudit = { registrar: vi.fn() }

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  documentoFiscal: { findMany: vi.fn() },
  apuracaoFiscal: { upsert: vi.fn() },
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => mockAudit),
}))

import { RetencoesNaFonteService } from '../retencoes-fonte.service.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-ret'
const EMPRESA_ID = 'emp-ret'

const EMPRESA_LP = {
  id: EMPRESA_ID,
  cnpj: '12345678000195',
  razaoSocial: 'Empresa LP Retenções Ltda',
  regime: 'LUCRO_PRESUMIDO',
  cnae: '6201500',
  uf: 'SP',
}

const EMPRESA_LR = { ...EMPRESA_LP, regime: 'LUCRO_REAL' }

function makeNfse(opts: { valorTotal: number; cnpjEmitente?: string; direcao?: string }) {
  return {
    id: `doc-${Math.random()}`,
    numero: '000001',
    serie: '001',
    dataEmissao: new Date('2025-05-10'),
    dataCompetencia: new Date('2025-05-10'),
    tipo: 'NFSE_TOMADA',
    direcao: opts.direcao ?? 'TOMADO',
    status: 'CONCILIADO',
    valorTotal: { toString: () => opts.valorTotal.toString() },
    cnpjEmitente: opts.cnpjEmitente ?? '98765432000100',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_LP)
  mockDb.documentoFiscal.findMany.mockResolvedValue([])
  mockDb.apuracaoFiscal.upsert.mockResolvedValue({ id: 'ret-1' })
})

// ===========================================================================

describe('RetencoesNaFonteService — validações', () => {
  it('lança erro quando empresa não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new RetencoesNaFonteService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')).rejects.toThrow(
      'Empresa não encontrada'
    )
  })

  it('lança erro para regime SIMPLES_NACIONAL', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      ...EMPRESA_LP,
      regime: 'SIMPLES_NACIONAL',
    })
    const service = new RetencoesNaFonteService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')).rejects.toThrow(
      'Lucro Presumido ou Lucro Real'
    )
  })

  it('lança erro para regime MEI', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ ...EMPRESA_LP, regime: 'MEI' })
    const service = new RetencoesNaFonteService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')).rejects.toThrow(
      'Lucro Presumido ou Lucro Real'
    )
  })

  it('aceita regime LUCRO_PRESUMIDO', async () => {
    const service = new RetencoesNaFonteService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')).resolves.toBeDefined()
  })

  it('aceita regime LUCRO_REAL', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(EMPRESA_LR)
    const service = new RetencoesNaFonteService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')).resolves.toBeDefined()
  })
})

// ===========================================================================

describe('RetencoesNaFonteService — sem documentos', () => {
  it('retorna totais zerados quando não há documentos', async () => {
    const service = new RetencoesNaFonteService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(r.totalPago)).toBe(0)
    expect(Number(r.totalIRRF)).toBe(0)
    expect(Number(r.totalPIS)).toBe(0)
    expect(Number(r.totalCOFINS)).toBe(0)
    expect(Number(r.totalCSLL)).toBe(0)
    expect(Number(r.totalRetencoes)).toBe(0)
    expect(r.totalPrestadores).toBe(0)
    expect(r.retencoesPorPrestador).toHaveLength(0)
  })
})

// ===========================================================================

describe('RetencoesNaFonteService — IRRF', () => {
  it('retém IRRF = 1,5% sobre pagamento ao prestador', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeNfse({ valorTotal: 10000, cnpjEmitente: '11111111000100' }),
    ])

    const service = new RetencoesNaFonteService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(r.totalIRRF)).toBe(150) // 10.000 × 1,5%
  })

  it('IRRF é calculado mesmo quando total <= R$5.000 (sem limite para IRRF)', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeNfse({ valorTotal: 3000, cnpjEmitente: '22222222000100' }),
    ])

    const service = new RetencoesNaFonteService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(r.totalIRRF)).toBe(45) // 3.000 × 1,5%
    expect(Number(r.totalPIS)).toBe(0) // total <= 5.000
    expect(Number(r.totalCOFINS)).toBe(0)
    expect(Number(r.totalCSLL)).toBe(0)
  })
})

// ===========================================================================

describe('RetencoesNaFonteService — CSRF (PIS + COFINS + CSLL)', () => {
  it('não retém CSRF quando total ao prestador <= R$5.000', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeNfse({ valorTotal: 5000, cnpjEmitente: '33333333000100' }),
    ])

    const service = new RetencoesNaFonteService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(r.totalPIS)).toBe(0)
    expect(Number(r.totalCOFINS)).toBe(0)
    expect(Number(r.totalCSLL)).toBe(0)
  })

  it('retém CSRF quando total ao prestador > R$5.000', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeNfse({ valorTotal: 6000, cnpjEmitente: '44444444000100' }),
    ])

    const service = new RetencoesNaFonteService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    // PIS: 6.000 × 0,65% = 39
    expect(Number(r.totalPIS)).toBe(39)
    // COFINS: 6.000 × 3% = 180
    expect(Number(r.totalCOFINS)).toBe(180)
    // CSLL: 6.000 × 1% = 60
    expect(Number(r.totalCSLL)).toBe(60)
  })

  it('CSRF total = PIS + COFINS + CSLL quando > R$5.000', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeNfse({ valorTotal: 10000, cnpjEmitente: '55555555000100' }),
    ])

    const service = new RetencoesNaFonteService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    // PIS: 65 + COFINS: 300 + CSLL: 100 = 465 (4,65%)
    const csrfTotal = Number(r.totalPIS) + Number(r.totalCOFINS) + Number(r.totalCSLL)
    expect(csrfTotal).toBe(465)
  })
})

// ===========================================================================

describe('RetencoesNaFonteService — totalRetencoes', () => {
  it('totalRetencoes = IRRF + PIS + COFINS + CSLL', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeNfse({ valorTotal: 10000, cnpjEmitente: '66666666000100' }),
    ])

    const service = new RetencoesNaFonteService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    const esperado =
      Number(r.totalIRRF) + Number(r.totalPIS) + Number(r.totalCOFINS) + Number(r.totalCSLL)
    expect(Number(r.totalRetencoes)).toBe(esperado)
    // IRRF: 150 + PIS: 65 + COFINS: 300 + CSLL: 100 = 615
    expect(Number(r.totalRetencoes)).toBe(615)
  })
})

// ===========================================================================

describe('RetencoesNaFonteService — agrupamento por prestador', () => {
  it('documentos do mesmo prestador são agrupados', async () => {
    const CNPJ = '77777777000100'
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeNfse({ valorTotal: 3000, cnpjEmitente: CNPJ }),
      makeNfse({ valorTotal: 3000, cnpjEmitente: CNPJ }),
    ])

    const service = new RetencoesNaFonteService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(r.totalPrestadores).toBe(1)
    const prestador = r.retencoesPorPrestador[0]!
    expect(Number(prestador.totalPago)).toBe(6000)
    // CSRF aplicado porque 6000 > 5000
    expect(Number(prestador.pisRetido)).toBeGreaterThan(0)
    expect(prestador.documentos).toHaveLength(2)
  })

  it('prestadores distintos são calculados separadamente', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeNfse({ valorTotal: 3000, cnpjEmitente: '11111111000100' }),
      makeNfse({ valorTotal: 8000, cnpjEmitente: '22222222000100' }),
    ])

    const service = new RetencoesNaFonteService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(r.totalPrestadores).toBe(2)
    // Prestador 1: 3000 → sem CSRF
    const p1 = r.retencoesPorPrestador.find((p) => Number(p.totalPago) === 3000)!
    expect(Number(p1.pisRetido)).toBe(0)

    // Prestador 2: 8000 → com CSRF
    const p2 = r.retencoesPorPrestador.find((p) => Number(p.totalPago) === 8000)!
    expect(Number(p2.pisRetido)).toBeGreaterThan(0)
  })

  it('totalPago é a soma de todos os prestadores', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeNfse({ valorTotal: 3000, cnpjEmitente: '11111111000100' }),
      makeNfse({ valorTotal: 7000, cnpjEmitente: '22222222000100' }),
    ])

    const service = new RetencoesNaFonteService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(r.totalPago)).toBe(10000)
  })
})

// ===========================================================================

describe('RetencoesNaFonteService — prazo de recolhimento', () => {
  it('prazo é dia 20 do mês seguinte — competência 2025-05', async () => {
    const service = new RetencoesNaFonteService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')
    expect(r.prazoRecolhimento).toBe('2025-06-20')
  })

  it('prazo é dia 20 do mês seguinte — competência 2025-12 (virada de ano)', async () => {
    const service = new RetencoesNaFonteService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-12')
    expect(r.prazoRecolhimento).toBe('2026-01-20')
  })
})

// ===========================================================================

describe('RetencoesNaFonteService — resultado por prestador', () => {
  it('retencoesPorPrestador contém irrfRetido, pisRetido, cofinsRetido, csllRetido', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeNfse({ valorTotal: 10000, cnpjEmitente: '88888888000100' }),
    ])

    const service = new RetencoesNaFonteService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    const p = r.retencoesPorPrestador[0]!
    expect(Number(p.irrfRetido)).toBe(150)
    expect(Number(p.pisRetido)).toBe(65)
    expect(Number(p.cofinsRetido)).toBe(300)
    expect(Number(p.csllRetido)).toBe(100)
    expect(Number(p.totalRetencoes)).toBe(615)
  })

  it('documentos contém os IDs dos documentos do prestador', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeNfse({ valorTotal: 10000, cnpjEmitente: '99999999000100' }),
    ])

    const service = new RetencoesNaFonteService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(r.retencoesPorPrestador[0]!.documentos).toHaveLength(1)
  })
})

// ===========================================================================

describe('RetencoesNaFonteService — persistência e auditoria', () => {
  it('persiste com tipo DCTFWEB', async () => {
    const service = new RetencoesNaFonteService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    const call = mockDb.apuracaoFiscal.upsert.mock.calls[0]
    expect(call[0].where.tenantId_empresaId_competencia_tipo.tipo).toBe('DCTFWEB')
  })

  it('registra evento DCTFWEB_TRANSMITIDA no audit', async () => {
    const service = new RetencoesNaFonteService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(mockAudit.registrar).toHaveBeenCalledOnce()
    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.evento).toBe('DCTFWEB_TRANSMITIDA')
  })

  it('audit estadoNovo contém competencia e prazoRecolhimento', async () => {
    const service = new RetencoesNaFonteService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.estadoNovo.competencia).toBe('2025-05')
    expect(auditCall.estadoNovo.prazoRecolhimento).toBe('2025-06-20')
  })

  it('audit estadoNovo contém totalIRRF e totalRetencoes', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeNfse({ valorTotal: 10000, cnpjEmitente: '12312312300100' }),
    ])

    const service = new RetencoesNaFonteService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(Number(auditCall.estadoNovo.totalIRRF)).toBe(150)
    expect(Number(auditCall.estadoNovo.totalRetencoes)).toBe(615)
  })

  it('audit tenantId correto', async () => {
    const service = new RetencoesNaFonteService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.tenantId).toBe(TENANT_ID)
  })
})

// ===========================================================================
// Fallback de CNPJ do prestador
// ===========================================================================

describe('RetencoesNaFonteService — fallback de cnpjPrestador', () => {
  it('sem cnpjEmitente mas com cnpjDestinatario → usa cnpjDestinatario', async () => {
    const docSemEmitente = {
      id: 'doc-fallback-1',
      numero: '001',
      serie: '001',
      dataEmissao: new Date('2025-05-10'),
      dataCompetencia: new Date('2025-05-10'),
      tipo: 'NFSE_TOMADA',
      direcao: 'TOMADO',
      status: 'CONCILIADO',
      valorTotal: { toString: () => '10000' },
      cnpjEmitente: undefined,
      cnpjDestinatario: '77777777000177',
    }
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([docSemEmitente])

    const service = new RetencoesNaFonteService()
    const resultado = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    // Deve agregar e reter IRRF (10.000 > 3.000 limite)
    expect(resultado.retencoesPorPrestador.length).toBe(1)
    expect(resultado.retencoesPorPrestador[0]!.cnpjPrestador).toBe('77777777000177')
  })

  it('sem cnpjEmitente nem cnpjDestinatario → usa "SEM_CNPJ"', async () => {
    const docSemCnpj = {
      id: 'doc-fallback-2',
      numero: '001',
      serie: '001',
      dataEmissao: new Date('2025-05-10'),
      dataCompetencia: new Date('2025-05-10'),
      tipo: 'NFSE_TOMADA',
      direcao: 'TOMADO',
      status: 'CONCILIADO',
      valorTotal: { toString: () => '10000' },
      cnpjEmitente: undefined,
      cnpjDestinatario: undefined,
    }
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([docSemCnpj])

    const service = new RetencoesNaFonteService()
    const resultado = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(resultado.retencoesPorPrestador.length).toBe(1)
    expect(resultado.retencoesPorPrestador[0]!.cnpjPrestador).toBe('SEM_CNPJ')
  })
})
