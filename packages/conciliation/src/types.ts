import { Decimal } from 'decimal.js'

export type ScoreConciliacao = {
  cnpjPrestador: number
  valorServico: number
  competencia: number
  numero: number
  total: number
}

export type ResultadoConciliacao = {
  documentoId: string
  score: number
  status: 'CONCILIADA' | 'PENDENTE_REVISAO' | 'DIVERGENTE'
  detalhes: ScoreConciliacao
  mensagem: string
}
