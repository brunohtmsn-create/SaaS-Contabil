import { Decimal } from 'decimal.js'

export type DocumentoRaw = {
  tipo: string
  chaveAcesso?: string
  numero: string
  serie?: string
  dataEmissao: Date
  cfop?: string
  cnpjEmitente: string
  nomeEmitente: string
  ufEmitente?: string
  municipioEmitente?: string
  ibgeEmitente?: string
  cnpjDestinatario: string
  cpfDestinatario?: string
  ufDestinatario?: string
  valorTotal: Decimal
  valorProdutos?: Decimal
  valorServicos?: Decimal
  valorIcms?: Decimal
  valorIcmsSt?: Decimal
  valorIpi?: Decimal
  valorPis?: Decimal
  valorCofins?: Decimal
  valorIss?: Decimal
  valorIssRetido?: Decimal
  valorIrrf?: Decimal
  valorInss?: Decimal
  valorCsll?: Decimal
  aliquotaIss?: Decimal
  aliquotaIcms?: Decimal
  baseCalcIcms?: Decimal
  baseCalcIss?: Decimal
  fonte: string
  municipioIBGE?: string
  xmlContent?: string
  xmlS3Key?: string
  pdfS3Key?: string
  direcao?: string
}
