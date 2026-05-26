/**
 * Testes unitários — NFSeEmitidaReconciler, NFCeReconciler e NFSeTomadaReconciler
 *
 * Cobre:
 *  - NFSeEmitidaReconciler: score sempre 100, status sempre CONCILIADA
 *  - NFCeReconciler: score sempre 100, status sempre CONCILIADA
 *  - NFSeTomadaReconciler: score 100 com dados completos → CONCILIADA
 *  - NFSeTomadaReconciler: cnpjEmitente ausente → cnpjPrestador = 0 → score 70
 *  - NFSeTomadaReconciler: valorTotal <= 0 → valorServico = 0 → score 65
 *  - NFSeTomadaReconciler: score >= 95 → CONCILIADA, >= 80 → PENDENTE_REVISAO, < 80 → DIVERGENTE
 *  - documentoId propagado corretamente no resultado
 *  - detalhes de score retornados com componentes corretos
 */

import { describe, it, expect } from 'vitest'
import { Decimal } from 'decimal.js'

import { NFSeEmitidaReconciler } from '../nfse-emitida.reconciler.js'
import { NFCeReconciler } from '../nfce.reconciler.js'
import { NFSeTomadaReconciler } from '../nfse-tomada.reconciler.js'

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

// ===========================================================================
// NFSeTomadaReconciler
// ===========================================================================

describe('NFSeTomadaReconciler.reconciliar()', () => {
  it('retorna score 100 com doc completo → status CONCILIADA', async () => {
    const reconciler = new NFSeTomadaReconciler()
    const result = await reconciler.reconciliar(makeDoc({ tipo: 'NFSE_TOMADA' }), 'tenant-1')

    expect(result.score).toBe(100)
    expect(result.status).toBe('CONCILIADA')
  })

  it('propagates documentoId from doc.id', async () => {
    const reconciler = new NFSeTomadaReconciler()
    const result = await reconciler.reconciliar(
      makeDoc({ id: 'tomada-doc-99', tipo: 'NFSE_TOMADA' }),
      'tenant-1'
    )
    expect(result.documentoId).toBe('tomada-doc-99')
  })

  it('cnpjEmitente ausente → cnpjPrestador = 0, score = 70', async () => {
    const reconciler = new NFSeTomadaReconciler()
    const result = await reconciler.reconciliar(
      makeDoc({ tipo: 'NFSE_TOMADA', cnpjEmitente: null }),
      'tenant-1'
    )

    expect(result.detalhes.cnpjPrestador).toBe(0)
    expect(result.score).toBe(70)
    expect(result.status).toBe('DIVERGENTE')
  })

  it('cnpjEmitente com comprimento != 14 → cnpjPrestador = 0', async () => {
    const reconciler = new NFSeTomadaReconciler()
    const result = await reconciler.reconciliar(
      makeDoc({ tipo: 'NFSE_TOMADA', cnpjEmitente: '1234' }),
      'tenant-1'
    )

    expect(result.detalhes.cnpjPrestador).toBe(0)
  })

  it('valorTotal <= 0 → valorServico = 0, score = 65', async () => {
    const reconciler = new NFSeTomadaReconciler()
    const result = await reconciler.reconciliar(
      makeDoc({ tipo: 'NFSE_TOMADA', valorTotal: new Decimal('0.00') }),
      'tenant-1'
    )

    expect(result.detalhes.valorServico).toBe(0)
    expect(result.score).toBe(65)
    expect(result.status).toBe('DIVERGENTE')
  })

  it('score < 80 → status DIVERGENTE com mensagem de divergência', async () => {
    const reconciler = new NFSeTomadaReconciler()
    const result = await reconciler.reconciliar(
      makeDoc({
        tipo: 'NFSE_TOMADA',
        cnpjEmitente: null,
        valorTotal: new Decimal('0.00'),
      }),
      'tenant-1'
    )

    // cnpjPrestador=0 + valorServico=0 + competencia=20 + numero=15 = 35
    expect(result.score).toBe(35)
    expect(result.status).toBe('DIVERGENTE')
    expect(result.mensagem).toMatch(/divergência/i)
  })

  it('detalhes contém os 4 componentes de score', async () => {
    const reconciler = new NFSeTomadaReconciler()
    const result = await reconciler.reconciliar(makeDoc({ tipo: 'NFSE_TOMADA' }), 'tenant-1')

    expect(result.detalhes).toHaveProperty('cnpjPrestador')
    expect(result.detalhes).toHaveProperty('valorServico')
    expect(result.detalhes).toHaveProperty('competencia')
    expect(result.detalhes).toHaveProperty('numero')
  })
})
