import axios from 'axios'

const WHATSAPP_API_URL = process.env['WHATSAPP_API_URL'] ?? ''
const WHATSAPP_API_TOKEN = process.env['WHATSAPP_API_TOKEN'] ?? ''

/**
 * Serviço de envio de mensagens WhatsApp.
 * Compatível com Z-API, WPPConnect e Baileys (HTTP wrapper).
 * Configurar via variáveis WHATSAPP_API_URL e WHATSAPP_API_TOKEN.
 */
export class WhatsAppService {
  private readonly http = axios.create({
    baseURL: WHATSAPP_API_URL,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${WHATSAPP_API_TOKEN}`,
    },
    timeout: 15_000,
  })

  /**
   * Envia mensagem de texto simples para o número informado.
   * @param para Número no formato internacional sem '+': ex. 5511999999999
   * @param mensagem Texto da mensagem (suporte a emojis)
   */
  async enviar(para: string, mensagem: string): Promise<void> {
    if (!WHATSAPP_API_URL || !WHATSAPP_API_TOKEN) {
      console.warn(
        '[WhatsApp] WHATSAPP_API_URL ou WHATSAPP_API_TOKEN não configurados — mensagem descartada'
      )
      return
    }

    await this.http.post('/message/text', {
      phone: para,
      message: mensagem,
    })
  }

  /**
   * Envia mensagem usando template pré-aprovado (HSM).
   * @param para Número no formato internacional sem '+': ex. 5511999999999
   * @param template Nome do template cadastrado no provedor
   * @param variaveis Lista de variáveis na ordem definida no template
   */
  async enviarTemplate(para: string, template: string, variaveis: string[]): Promise<void> {
    if (!WHATSAPP_API_URL || !WHATSAPP_API_TOKEN) {
      console.warn(
        '[WhatsApp] WHATSAPP_API_URL ou WHATSAPP_API_TOKEN não configurados — template descartado'
      )
      return
    }

    await this.http.post('/message/template', {
      phone: para,
      template,
      variables: variaveis,
    })
  }

  /** Formata uma mensagem de vencimento próximo. */
  static mensagemVencimento(empresa: string, obrigacao: string, vencimento: string): string {
    return (
      `⚠️ *Vencimento Próximo*\n\n` +
      `🏢 Empresa: ${empresa}\n` +
      `📋 Obrigação: ${obrigacao}\n` +
      `📅 Vencimento: ${vencimento}\n\n` +
      `Acesse o sistema para verificar o status.`
    )
  }

  /** Formata uma mensagem de fechamento concluído. */
  static mensagemFechamentoConcluido(empresa: string, competencia: string): string {
    return (
      `✅ *Fechamento Concluído*\n\n` +
      `🏢 Empresa: ${empresa}\n` +
      `📅 Competência: ${competencia}\n\n` +
      `Todos os lançamentos foram processados e conciliados com sucesso.`
    )
  }

  /** Formata uma mensagem de divergência encontrada. */
  static mensagemDivergencia(empresa: string, descricao: string): string {
    return (
      `🚨 *Divergência Detectada*\n\n` +
      `🏢 Empresa: ${empresa}\n` +
      `❌ Problema: ${descricao}\n\n` +
      `Revisão humana necessária. Acesse /auditoria para aprovar ou rejeitar.`
    )
  }

  /** Formata uma mensagem de alerta de exclusão do Simples Nacional. */
  static mensagemAlertaExclusaoSN(empresa: string, motivo: string): string {
    return (
      `🚨 *ALERTA — Risco de Exclusão do Simples Nacional*\n\n` +
      `🏢 Empresa: ${empresa}\n` +
      `⚠️ Motivo: ${motivo}\n\n` +
      `Tome as providências imediatamente para evitar a exclusão do regime.`
    )
  }

  /** Formata uma mensagem de erro de scraper. */
  static mensagemScraperErro(empresa: string, portal: string, detalhe: string): string {
    return (
      `🤖 *Erro de Captura Automática*\n\n` +
      `🏢 Empresa: ${empresa}\n` +
      `🌐 Portal: ${portal}\n` +
      `❌ Erro: ${detalhe}\n\n` +
      `Screenshot salvo no S3. Verifique os logs do sistema.`
    )
  }

  /** Formata uma mensagem de falha de CAPTCHA. */
  static mensagemCaptchaFalhou(empresa: string, portal: string): string {
    return (
      `🤖 *Falha na Resolução de CAPTCHA*\n\n` +
      `🏢 Empresa: ${empresa}\n` +
      `🌐 Portal: ${portal}\n\n` +
      `O serviço de CAPTCHA (2Captcha/AntiCaptcha) não conseguiu resolver o desafio. ` +
      `A captura foi interrompida e precisará ser reprocessada.`
    )
  }
}
