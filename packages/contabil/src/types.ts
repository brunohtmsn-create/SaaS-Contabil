import { Decimal } from 'decimal.js'

export type Partida = {
  conta: string
  descricao: string
  valor: Decimal
  tipo: 'DEBITO' | 'CREDITO'
}

export type Lancamento = {
  id?: string
  data: Date
  historico: string
  documentoId?: string
  partidas: Partida[]
}

export type ResultadoECD = {
  cnpj: string
  ano: number
  totalLancamentos: number
  blocos: string[]
  conteudo: string
}

export type ContaContabil = {
  debito: string
  credito: string
}
