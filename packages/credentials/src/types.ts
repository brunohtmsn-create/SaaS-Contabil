import { TipoCredencial } from '@saas-contabil/database'

export type CredentialDecrypted = {
  id: string
  tenantId: string
  cnpj: string
  tipo: TipoCredencial
  data: Buffer
  validade: Date | null
  escopos: string[]
}

export type CredentialCreateInput = {
  tenantId: string
  empresaId: string
  cnpj: string
  tipo: TipoCredencial
  rawData: Buffer
  validade?: Date
  escopos: string[]
  criadoPor: string
}
