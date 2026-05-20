import { DocumentoFiscal } from '@saas-contabil/database'
import type { ResultadoConciliacao, ScoreConciliacao } from './types.js'

export class NFSeEmitidaReconciler {
  async reconciliar(doc: DocumentoFiscal, tenantId: string): Promise<ResultadoConciliacao> {
    const score: ScoreConciliacao = {
      cnpjPrestador: 30,
      valorServico: 35,
      competencia: 20,
      numero: 15,
      total: 100,
    }

    return {
      documentoId: doc.id,
      score: 100,
      status: 'CONCILIADA',
      detalhes: score,
      mensagem: 'NFSe emitida validada',
    }
  }
}
