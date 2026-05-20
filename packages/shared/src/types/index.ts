import { Decimal } from 'decimal.js'

export type UUID = string

export type CredentialType =
  | 'CERTIFICADO_A1_ECPF'
  | 'CERTIFICADO_A1_ECNPJ'
  | 'PROCURACAO_SEFAZ'
  | 'PROCURACAO_ECAC'
  | 'LOGIN_SIMPLES_NACIONAL'
  | 'LOGIN_PREFEITURA'
  | 'LOGIN_FGTS_DIGITAL'
  | 'LOGIN_ESOCIAL'
  | 'LOGIN_SEFAZ_ESTADUAL'
  | 'TOKEN_API'

export type Credential = {
  id: UUID
  tenantId: UUID
  cnpj: string
  tipo: CredentialType
  encryptedData: Buffer
  iv: Buffer
  validade: Date | null
  status: 'ATIVO' | 'VENCIDO' | 'REVOGADO' | 'ERRO'
  escopos: string[]
  criadoPor: string
  ultimoUso: Date | null
  ultimoResultado: 'SUCESSO' | 'FALHA' | null
}

export type DocumentType = 'NFE' | 'NFCE' | 'NFSE_EMITIDA' | 'NFSE_TOMADA' | 'CTE' | 'MDFE'

export type FonteType =
  | 'SEFAZ_FEDERAL'
  | 'SEFAZ_ESTADUAL'
  | 'PORTAL_NACIONAL_NFSE'
  | 'PREFEITURA'
  | 'EMAIL'
  | 'UPLOAD_MANUAL'
  | 'ERP'

export type DocumentoStatus =
  | 'CAPTURADO'
  | 'NORMALIZADO'
  | 'VALIDADO'
  | 'EM_CONCILIACAO'
  | 'CONCILIADO'
  | 'DIVERGENTE'
  | 'NAO_ENCONTRADO'
  | 'PENDENTE_REVISAO'
  | 'ENCERRADO'
  | 'AUDITADO'
  | 'ARQUIVADO'

export type DocumentoFiscal = {
  id: UUID
  tenantId: UUID
  chaveUnica: string
  tipo: DocumentType
  direcao: 'ENTRADA' | 'SAIDA' | 'PRESTACAO'
  chaveAcesso: string | null
  numero: string
  serie: string | null
  dataEmissao: Date
  dataCompetencia: Date
  cfop: string | null
  cst: string | null
  cstPis: string | null
  cstCofins: string | null
  cnpjEmitente: string
  nomeEmitente: string
  ufEmitente: string
  municipioEmitente: string | null
  ibgeEmitente: string | null
  cnpjDestinatario: string
  cpfDestinatario: string | null
  ufDestinatario: string
  valorTotal: Decimal
  valorProdutos: Decimal
  valorServicos: Decimal
  valorIcms: Decimal
  valorIcmsSt: Decimal
  valorIpi: Decimal
  valorPis: Decimal
  valorCofins: Decimal
  valorIss: Decimal
  valorIssRetido: Decimal
  valorIrrf: Decimal
  valorInss: Decimal
  valorCsll: Decimal
  aliquotaIss: Decimal | null
  aliquotaIcms: Decimal | null
  baseCalcIcms: Decimal
  baseCalcIss: Decimal
  operacaoInterestadual: boolean
  ufOrigem: string | null
  ufDestino: string | null
  aliquotaInterna: Decimal | null
  aliquotaInterestadual: Decimal | null
  valorDifal: Decimal | null
  valorFundoPobreza: Decimal | null
  fonte: FonteType
  municipioIBGE: string | null
  urlOrigem: string | null
  xmlS3Key: string | null
  pdfS3Key: string | null
  hashIntegridade: string
  status: DocumentoStatus
  capturedAt: Date
  processedAt: Date | null
}

export type AuditEventType =
  | 'DOCUMENTO_CAPTURADO'
  | 'DOCUMENTO_NORMALIZADO'
  | 'DOCUMENTO_VALIDADO'
  | 'CONCILIACAO_INICIADA'
  | 'CONCILIADA_AUTOMATICO'
  | 'PENDENTE_REVISAO_HUMANA'
  | 'DIVERGENCIA_DETECTADA'
  | 'DIVERGENCIA_CORRIGIDA'
  | 'CONCILIACAO_APROVADA_HUMANO'
  | 'NFSE_ENCERRADA'
  | 'ENCERRAMENTO_FALHOU'
  | 'DIFAL_CALCULADO'
  | 'GNRE_GERADA'
  | 'PGDAS_APURADO'
  | 'DAS_GERADO'
  | 'PGDAS_TRANSMITIDO'
  | 'DESTDA_GERADO'
  | 'DESTDA_TRANSMITIDO'
  | 'LANCAMENTO_GERADO'
  | 'CONCILIACAO_BANCARIA'
  | 'DEPRECIACAO_CALCULADA'
  | 'ECD_GERADA'
  | 'ECD_TRANSMITIDA'
  | 'FECHAMENTO_INICIADO'
  | 'FECHAMENTO_CONCLUIDO'
  | 'PORTAL_ACESSO_REALIZADO'
  | 'PORTAL_ACESSO_FALHOU'
  | 'CERTIDAO_BAIXADA'
  | 'OBRIGACAO_TRANSMITIDA'
  | 'OBRIGACAO_FALHOU'
  | 'CREDENCIAL_USADA'
  | 'CREDENCIAL_VENCIDA'
  | 'CREDENCIAL_RENOVADA'
  | 'ARQUIVO_SALVO'
  | 'ARQUIVO_INTEGRO'
  | 'ARQUIVO_CORROMPIDO'
  | 'APROVACAO_HUMANA'
  | 'CORRECAO_MANUAL'
  | 'REVISAO_SOLICITADA'
  | 'EFDREINF_TRANSMITIDA'
  | 'DCTFWEB_TRANSMITIDA'
  | 'ESOCIAL_TRANSMITIDO'

export type EntidadeAuditavel =
  | 'DOCUMENTO_FISCAL'
  | 'CREDENCIAL'
  | 'CONCILIACAO'
  | 'APURACAO_FISCAL'
  | 'LANCAMENTO_CONTABIL'
  | 'OBRIGACAO'
  | 'PORTAL_JOB'
  | 'ARQUIVO_S3'

export type AuditEvent = {
  id: UUID
  sequencia: bigint
  tenantId: UUID
  cnpj: string | null
  entidadeTipo: EntidadeAuditavel
  entidadeId: UUID
  evento: AuditEventType
  estadoAnterior: unknown
  estadoNovo: unknown
  responsavel: string
  responsavelTipo: 'SISTEMA' | 'USUARIO'
  evidencias: string[]
  score: number | null
  aprovadoPor: string | null
  observacao: string | null
  hashEvento: string
  hashAnterior: string
  timestamp: Date
  ipOrigem: string | null
  jobId: string | null
  duracao: number | null
}

export type Periodo = {
  inicio: Date
  fim: Date
  competencia: string
}

export type PortalType =
  | 'ECAC'
  | 'SIMPLES_NACIONAL'
  | 'SEFAZ_FEDERAL'
  | 'SEFAZ_ESTADUAL'
  | 'PREFEITURA'
  | 'FGTS_DIGITAL'
  | 'ESOCIAL'
  | 'CAGED'
  | 'SINTEGRA'

export type RegimeTributario = 'SIMPLES_NACIONAL' | 'MEI' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL'

export type Tenant = {
  id: UUID
  nome: string
  cnpj: string
  subdominio: string
  ativo: boolean
  plano: 'BASICO' | 'PROFISSIONAL' | 'ENTERPRISE'
  criadoEm: Date
}

export type EmpresaCliente = {
  id: UUID
  tenantId: UUID
  cnpj: string
  razaoSocial: string
  nomeFantasia: string | null
  regime: RegimeTributario
  cnae: string
  uf: string
  municipio: string
  ibge: string
  ativa: boolean
  dataAbertura: Date
  criadoEm: Date
}
