import { Decimal } from 'decimal.js'

export type Session = {
  cookies?: string
  token?: string
  expiresAt: Date
}

export type DocumentoRaw = {
  tipo: string
  chaveAcesso?: string
  numero: string
  serie?: string
  dataEmissao: Date
  cnpjEmitente: string
  nomeEmitente: string
  cnpjDestinatario: string
  valorTotal: Decimal
  xmlContent?: string
  pdfBuffer?: Buffer
  municipioIBGE?: string
  fonte: string
}

export type Periodo = {
  inicio: Date
  fim: Date
  competencia: string
}

export type Credential = {
  id: string
  data: Buffer
  tipo: string
}

export interface DocumentAdapter {
  tipo: string
  fonte: string
  authenticate(cred: Credential): Promise<Session>
  fetch(cnpj: string, periodo: Periodo): Promise<DocumentoRaw[]>
  downloadXML(doc: DocumentoRaw): Promise<string>
  downloadPDF(doc: DocumentoRaw): Promise<Buffer>
  healthCheck(): Promise<boolean>
}

export interface PrefeituraAdapter extends DocumentAdapter {
  municipio: string
  ibge: string
  fetchEmitidas(cnpj: string, periodo: Periodo): Promise<DocumentoRaw[]>
  fetchTomadas(cnpj: string, periodo: Periodo): Promise<DocumentoRaw[]>
}
