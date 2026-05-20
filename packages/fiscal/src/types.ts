import { Decimal } from 'decimal.js'

export type ReceitaSegregada = {
  cnpj: string
  competencia: string
  anexoI: Decimal
  anexoII: Decimal
  anexoIII: Decimal
  anexoIV: Decimal
  anexoV: Decimal
  exportacao: Decimal
  substituicaoTributaria: Decimal
  imunes: Decimal
  isentas: Decimal
  total: Decimal
}

export type ResultadoPGDAS = {
  cnpj: string
  competencia: string
  receitaBrutaTotal: Decimal
  receitaBruta12Meses: Decimal
  faixaAnexo: string
  aliquotaNominal: Decimal
  deducao: Decimal
  aliquotaEfetiva: Decimal
  valorDAS: Decimal
  receitas: ReceitaSegregada
  fatorR: Decimal | null
}

export type ResultadoDifal = {
  valorDifal: Decimal
  valorFundoPobreza: Decimal
  valorTotal: Decimal
  aliquotaInterna: Decimal
  aliquotaInterestadual: Decimal
  ufDestino: string
  competencia: string
}

export type ResultadoGNRE = {
  tipo: 'DIFAL' | 'ICMS_ST'
  ufDestino: string
  codReceita: string
  valor: Decimal
  competencia: string
  cnpjEmitente: string
}

export type R2010 = {
  cnpjPrestador: string
  classificacaoServ: string
  indObra: '0' | '1'
  vrBcCpContrib: Decimal
  aliqRet: Decimal
  vrRetencao: Decimal
  documentoIds: string[]
}

export type R4010 = {
  cpfBenef: string
  nmBenef: string
  natRend: string
  dtFG: Date
  vrBruto: Decimal
  vrBaseIR: Decimal
  aliqIR: Decimal
  vrIR: Decimal
}

export type R4020 = {
  cnpjBenef: string
  natRend: string
  dtFG: Date
  vrBruto: Decimal
  vrBaseIR: Decimal
  aliqIR: Decimal
  vrIR: Decimal
  vrBaseCSLL: Decimal
  aliqCSLL: Decimal
  vrCSLL: Decimal
}

export type R4080 = {
  cnpjRetenteFonte: string
  natRend: string
  dtFG: Date
  vrBruto: Decimal
  vrIR: Decimal
  vrCSLL: Decimal
  vrPIS: Decimal
  vrCOFINS: Decimal
  nfseNumero: string
}
