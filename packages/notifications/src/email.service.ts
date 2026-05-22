import nodemailer, { Transporter } from 'nodemailer'
import { formatDate } from '@saas-contabil/shared'
import type { DestinatarioNotificacao } from './types.js'

const SMTP_HOST = process.env['SMTP_HOST'] ?? 'localhost'
const SMTP_PORT = parseInt(process.env['SMTP_PORT'] ?? '587', 10)
const SMTP_USER = process.env['SMTP_USER'] ?? ''
const SMTP_PASS = process.env['SMTP_PASS'] ?? ''
const SMTP_FROM = process.env['SMTP_FROM'] ?? 'noreply@saascontabil.com.br'

const BRAND_COLOR = '#1a56db'
const DANGER_COLOR = '#e02424'
const SUCCESS_COLOR = '#057a55'
const WARNING_COLOR = '#c27803'

/** Retorna um transporter Nodemailer configurado via variáveis de ambiente. */
function criarTransporter(): Transporter {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  })
}

/** Envolve o conteúdo de e-mail no layout padrão da plataforma. */
function layout(titulo: string, corTitulo: string, corpo: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${titulo}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.12);">
          <!-- Header -->
          <tr>
            <td style="background-color:${BRAND_COLOR};padding:24px 32px;">
              <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:.5px;">
                SaaS Contábil
              </p>
            </td>
          </tr>
          <!-- Título -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              <p style="margin:0;font-size:22px;font-weight:700;color:${corTitulo};">${titulo}</p>
            </td>
          </tr>
          <!-- Corpo -->
          <tr>
            <td style="padding:16px 32px 32px 32px;font-size:15px;color:#374151;line-height:1.6;">
              ${corpo}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;font-size:12px;color:#9ca3af;text-align:center;">
              SaaS Contábil &mdash; Sistema de Gestão Fiscal e Contábil<br />
              Esta é uma mensagem automática. Por favor não responda este e-mail.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/** Renderiza um bloco de informação com rótulo e valor. */
function infoRow(rotulo: string, valor: string): string {
  return `<tr>
    <td style="padding:4px 0;font-weight:600;color:#6b7280;width:160px;vertical-align:top;">${rotulo}</td>
    <td style="padding:4px 0;color:#111827;">${valor}</td>
  </tr>`
}

/** Renderiza uma tabela de detalhes. */
function tabelaDetalhes(linhas: Array<[string, string]>): string {
  return `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:16px 0;">
    <tbody>
      ${linhas.map(([r, v]) => infoRow(r, v)).join('\n      ')}
    </tbody>
  </table>`
}

/** Renderiza um botão de ação. */
function botaoAcao(texto: string, url: string, cor = BRAND_COLOR): string {
  return `<p style="margin:24px 0 0 0;">
    <a href="${url}" style="display:inline-block;background-color:${cor};color:#ffffff;font-size:14px;font-weight:600;padding:12px 24px;border-radius:6px;text-decoration:none;">${texto}</a>
  </p>`
}

/**
 * Serviço de envio de e-mails transacionais.
 * Configurar via variáveis SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.
 */
export class EmailService {
  private readonly transporter = criarTransporter()

  /**
   * Envia um e-mail HTML genérico.
   * @param para Endereço do destinatário
   * @param assunto Assunto do e-mail
   * @param html Corpo HTML completo
   */
  async enviar(para: string, assunto: string, html: string): Promise<void> {
    if (!SMTP_HOST || SMTP_HOST === 'localhost') {
      console.warn(`[Email] SMTP não configurado — e-mail para ${para} descartado`)
      return
    }

    await this.transporter.sendMail({
      from: SMTP_FROM,
      to: para,
      subject: assunto,
      html,
    })
  }

  /**
   * Envia notificação de vencimento próximo.
   */
  async enviarVencimento(
    destinatario: DestinatarioNotificacao,
    obrigacao: { tipo: string; vencimento: Date; empresa: string },
  ): Promise<void> {
    if (!destinatario.email) return

    const dataFormatada = formatDate(obrigacao.vencimento, 'dd/MM/yyyy')
    const titulo = `Vencimento Próximo: ${obrigacao.tipo}`

    const corpo = `
      <p>Olá, <strong>${destinatario.nome}</strong>.</p>
      <p>Existe uma obrigação com vencimento se aproximando que requer sua atenção:</p>
      ${tabelaDetalhes([
        ['Empresa:', obrigacao.empresa],
        ['Obrigação:', obrigacao.tipo],
        ['Vencimento:', `<strong style="color:${WARNING_COLOR};">${dataFormatada}</strong>`],
      ])}
      <p>Acesse o sistema para verificar o status e tomar as providências necessárias.</p>
      ${botaoAcao('Acessar o Sistema', process.env['NEXT_PUBLIC_API_URL'] ?? '#', WARNING_COLOR)}
    `

    await this.enviar(destinatario.email, titulo, layout(titulo, WARNING_COLOR, corpo))
  }

  /**
   * Envia confirmação de fechamento de competência concluído.
   */
  async enviarFechamentoConcluido(
    destinatario: DestinatarioNotificacao,
    empresa: string,
    competencia: string,
  ): Promise<void> {
    if (!destinatario.email) return

    const titulo = `Fechamento Concluído — ${empresa} (${competencia})`

    const corpo = `
      <p>Olá, <strong>${destinatario.nome}</strong>.</p>
      <p>O fechamento da competência foi processado com sucesso:</p>
      ${tabelaDetalhes([
        ['Empresa:', empresa],
        ['Competência:', competencia],
        ['Status:', `<span style="color:${SUCCESS_COLOR};font-weight:600;">✔ Concluído</span>`],
      ])}
      <p>Todos os documentos foram capturados, conciliados e os lançamentos contábeis gerados.</p>
      ${botaoAcao('Ver Relatório', process.env['NEXT_PUBLIC_API_URL'] ?? '#', SUCCESS_COLOR)}
    `

    await this.enviar(destinatario.email, titulo, layout('Fechamento Concluído', SUCCESS_COLOR, corpo))
  }

  /**
   * Envia e-mail de alerta genérico (divergências, erros, exclusão SN etc.).
   */
  async enviarAlerta(
    destinatario: DestinatarioNotificacao,
    alerta: { tipo: string; mensagem: string },
  ): Promise<void> {
    if (!destinatario.email) return

    const titulo = `Alerta: ${alerta.tipo}`

    const corpo = `
      <p>Olá, <strong>${destinatario.nome}</strong>.</p>
      <p>O sistema identificou uma situação que requer sua atenção imediata:</p>
      <div style="background-color:#fef2f2;border-left:4px solid ${DANGER_COLOR};padding:12px 16px;border-radius:0 6px 6px 0;margin:16px 0;">
        <p style="margin:0;font-weight:600;color:${DANGER_COLOR};">${alerta.tipo}</p>
        <p style="margin:8px 0 0 0;color:#374151;">${alerta.mensagem}</p>
      </div>
      <p>Acesse o sistema para verificar os detalhes e tomar as providências necessárias.</p>
      ${botaoAcao('Ver Detalhes', process.env['NEXT_PUBLIC_API_URL'] ?? '#', DANGER_COLOR)}
    `

    await this.enviar(destinatario.email, titulo, layout(titulo, DANGER_COLOR, corpo))
  }

  /**
   * Envia e-mail de notificação de divergência com score abaixo do mínimo.
   */
  async enviarDivergencia(
    destinatario: DestinatarioNotificacao,
    empresa: string,
    descricao: string,
    score: number,
  ): Promise<void> {
    if (!destinatario.email) return

    const titulo = `Divergência Detectada — ${empresa}`

    const corpo = `
      <p>Olá, <strong>${destinatario.nome}</strong>.</p>
      <p>Uma divergência foi detectada durante o processo de conciliação e requer revisão humana:</p>
      ${tabelaDetalhes([
        ['Empresa:', empresa],
        ['Descrição:', descricao],
        ['Score:', `<strong style="color:${DANGER_COLOR};">${score} (mínimo: 80)</strong>`],
        ['Ação:', 'Revisão humana obrigatória'],
      ])}
      <div style="background-color:#fffbeb;border-left:4px solid ${WARNING_COLOR};padding:12px 16px;border-radius:0 6px 6px 0;margin:16px 0;">
        <p style="margin:0;color:#92400e;">
          O processamento foi bloqueado automaticamente. Acesse <strong>/auditoria</strong> para aprovar ou rejeitar o item pendente.
        </p>
      </div>
      ${botaoAcao('Revisar Divergência', `${process.env['NEXT_PUBLIC_API_URL'] ?? '#'}/auditoria`, DANGER_COLOR)}
    `

    await this.enviar(destinatario.email, titulo, layout(titulo, DANGER_COLOR, corpo))
  }

  /**
   * Envia alerta de risco de exclusão do Simples Nacional.
   */
  async enviarAlertaExclusaoSN(
    destinatario: DestinatarioNotificacao,
    empresa: string,
    motivo: string,
  ): Promise<void> {
    if (!destinatario.email) return

    const titulo = `URGENTE: Risco de Exclusão do Simples Nacional — ${empresa}`

    const corpo = `
      <p>Olá, <strong>${destinatario.nome}</strong>.</p>
      <div style="background-color:#fef2f2;border:2px solid ${DANGER_COLOR};border-radius:6px;padding:16px;margin:16px 0;">
        <p style="margin:0 0 8px 0;font-size:16px;font-weight:700;color:${DANGER_COLOR};">⚠️ AÇÃO URGENTE NECESSÁRIA</p>
        <p style="margin:0;color:#374151;">A empresa abaixo corre risco de exclusão do Simples Nacional.</p>
      </div>
      ${tabelaDetalhes([
        ['Empresa:', `<strong>${empresa}</strong>`],
        ['Motivo:', `<span style="color:${DANGER_COLOR};">${motivo}</span>`],
      ])}
      <p>Tome as providências imediatamente para evitar a exclusão do regime tributário especial.</p>
      ${botaoAcao('Ver Detalhes', process.env['NEXT_PUBLIC_API_URL'] ?? '#', DANGER_COLOR)}
    `

    await this.enviar(destinatario.email, titulo, layout(titulo, DANGER_COLOR, corpo))
  }
}
