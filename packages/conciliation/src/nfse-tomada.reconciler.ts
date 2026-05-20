import { DocumentoFiscal } from '@saas-contabil/database'
import { Decimal } from 'decimal.js'
import type { ResultadoConciliacao, ScoreConciliacao } from './types.js'

const PESOS = {
  cnpjPrestador: 30,
  valorServico: 35,
  competencia: 20,
  numero: 15,
}

const TOLERANCIA_VALOR = new Decimal('0.02')

export class NFSeTomadaReconciler {
  async reconciliar(doc: DocumentoFiscal, tenantId: string): Promise<ResultadoConciliacao> {
    const score = this.calcularScore(doc)

    let status: 'CONCILIADA' | 'PENDENTE_REVISAO' | 'DIVERGENTE'
    let mensagem: string

    if (score.total >= 95) {
      status = 'CONCILIADA'
      mensagem = 'Conciliação automática aprovada'
    } else if (score.total >= 80) {
      status = 'PENDENTE_REVISAO'
      mensagem = 'Score abaixo de 95 — aguardando revisão humana'
    } else {
      status = 'DIVERGENTE'
      mensagem = `Score ${score.total} — divergência grave, correção obrigatória`
    }

    return { documentoId: doc.id, score: score.total, status, detalhes: score, mensagem }
  }

  private calcularScore(doc: DocumentoFiscal): ScoreConciliacao {
    let cnpjPrestador = PESOS.cnpjPrestador
    let valorServico = PESOS.valorServico
    let competencia = PESOS.competencia
    let numero = PESOS.numero

    if (!doc.cnpjEmitente || doc.cnpjEmitente.length !== 14) {
      cnpjPrestador = 0
    }

    const valTotal = new Decimal(doc.valorTotal.toString())
    if (valTotal.lte(0)) {
      valorServico = 0
    }

    const total = cnpjPrestador + valorServico + competencia + numero

    return { cnpjPrestador, valorServico, competencia, numero, total }
  }
}
