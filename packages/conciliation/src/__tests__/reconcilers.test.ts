/**
 * Testes unitários — NFSeEmitidaReconciler e NFCeReconciler
 *
 * Cobre:
 *  - NFSeEmitidaReconciler: score sempre 100, status sempre CONCILIADA
 *  - NFCeReconciler: score sempre 100, status sempre CONCILIADA
 *  - documentoId propagado corretamente no resultado
 *  - detalhes de score retornados com componentes corretos
 */

import { describe, it, expect } from 'vitest'
import { Decimal } from 'decimal.js'

import { NFSeEmitidaReconciler } from '../nfse-emitida.reconciler.js'
import { NFCeReconciler } from '../nfce.reconciler.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    tenantId: 'tenant-1',
    empresaId: 'emp-1',
    tipo: 'NFSE_EMITIDA',
    numero: '000001',
    chaveAcesso: null,
    cnpjEmitente: '11222333000181',
    cnpjDestinatario: null,
    ufOrigem: 'SP',
    ufDestino: null,
    dataEmissao: new Date('2025-05-10'),
    dataCompetencia: new Date('2025-05-01'),
    valorTotal: new Decimal('1500.00'),
    valorIss: null,
    valorPis: null,
    valorCofins: null,
    valorIr: null,
    valorCsll: null,
    valorInss: null,
    valorDifal: null,
    valorFundoPobreza: null,
    status: 'NORMALIZADO',
    s3Key: null,
    criadoEm: new Date(),
    ...overrides,
  } as any
}

// ===========================================================================
// NFSeEmitidaReconciler
// ===========================================================================

describe('NFSeEmitidaReconciler.reconciliar()', () => {
  it('retorna status CONCILIADA', async () => {
    const reconciler = new NFSeEmitidaReconciler()
    const result = await reconciler.reconciliar(makeDoc(), 'tenant-1')
    expect(result.status).toBe('CONCILIADA')
  })

  it('retorna score = 100', async () => {
    const reconciler = new NFSeEmitidaReconciler()
    const result = await reconciler.reconciliar(makeDoc(), 'tenant-1')
    expect(result.score).toBe(100)
  })

  it('propagates documentoId from doc.id', async () => {
    const reconciler = new NFSeEmitidaReconciler()
    const result = await reconciler.reconciliar(makeDoc({ id: 'doc-emitida-42' }), 'tenant-1')
    expect(result.documentoId).toBe('doc-emitida-42')
  })

  it('detalhes somam 100', async () => {
    const reconciler = new NFSeEmitidaReconciler()
    const result = await reconciler.reconciliar(makeDoc(), 'tenant-1')
    const { cnpjPrestador, valorServico, competencia, numero } = result.detalhes
    expect(cnpjPrestador + valorServico + competencia + numero).toBe(100)
  })

  it('mensagem indica validação', async () => {
    const reconciler = new NFSeEmitidaReconciler()
    const result = await reconciler.reconciliar(makeDoc(), 'tenant-1')
    expect(result.mensagem).toBeTruthy()
  })
})

// ===========================================================================
// NFCeReconciler
// ===========================================================================

describe('NFCeReconciler.reconciliar()', () => {
  it('retorna status CONCILIADA', async () => {
    const reconciler = new NFCeReconciler()
    const result = await reconciler.reconciliar(makeDoc({ tipo: 'NFCE' }))
    expect(result.status).toBe('CONCILIADA')
  })

  it('retorna score = 100', async () => {
    const reconciler = new NFCeReconciler()
    const result = await reconciler.reconciliar(makeDoc())
    expect(result.score).toBe(100)
  })

  it('propagates documentoId from doc.id', async () => {
    const reconciler = new NFCeReconciler()
    const result = await reconciler.reconciliar(makeDoc({ id: 'nfce-doc-7' }))
    expect(result.documentoId).toBe('nfce-doc-7')
  })

  it('detalhes somam 100', async () => {
    const reconciler = new NFCeReconciler()
    const result = await reconciler.reconciliar(makeDoc())
    const { cnpjPrestador, valorServico, competencia, numero } = result.detalhes
    expect(cnpjPrestador + valorServico + competencia + numero).toBe(100)
  })

  it('mensagem indica validação', async () => {
    const reconciler = new NFCeReconciler()
    const result = await reconciler.reconciliar(makeDoc())
    expect(result.mensagem).toBeTruthy()
  })
})
