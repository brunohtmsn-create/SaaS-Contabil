export type NotificacaoTipo =
  | 'VENCIMENTO_PROXIMO'
  | 'FECHAMENTO_CONCLUIDO'
  | 'DIVERGENCIA'
  | 'ALERTA_EXCLUSAO_SN'
  | 'CAPTCHA_FALHOU'
  | 'SCRAPER_ERRO'

export type DestinatarioNotificacao = {
  nome: string
  email?: string
  whatsapp?: string // formato: 5511999999999
}

export type Notificacao = {
  tipo: NotificacaoTipo
  titulo: string
  mensagem: string
  dados?: Record<string, unknown>
  destinatarios: DestinatarioNotificacao[]
  tenantId: string
  empresaId?: string
}
