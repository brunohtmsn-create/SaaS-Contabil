import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { formatDate } from '@saas-contabil/shared'
import { WhatsAppService } from './whatsapp.service.js'
import { EmailService } from './email.service.js'
import type { Notificacao, NotificacaoTipo, DestinatarioNotificacao } from './types.js'

/**
 * Serviço central de notificações.
 * Orquestra envio via WhatsApp e e-mail para todos os destinatários,
 * e registra cada notificação despachada no audit trail.
 */
export class NotificationService {
  private readonly whatsapp = new WhatsAppService()
  private readonly email = new EmailService()
  private readonly audit = new AuditService()
  private readonly db = getPrismaClient()

  /**
   * Envia a notificação para todos os destinatários via WhatsApp e e-mail
   * (quando os canais estiverem configurados no destinatário) e registra
   * o evento no audit trail imutável.
   */
  async notificar(notificacao: Notificacao): Promise<void> {
    const { tipo, titulo, mensagem, destinatarios, tenantId, empresaId, dados } = notificacao

    await Promise.allSettled(
      destinatarios.map((dest) =>
        this.despacharParaDestinatario(dest, tipo, titulo, mensagem, dados)
      )
    )

    await this.audit.registrar({
      tenantId,
      entidadeTipo: 'OBRIGACAO',
      entidadeId: empresaId ?? tenantId,
      evento: 'REVISAO_SOLICITADA',
      estadoNovo: {
        tipo,
        titulo,
        destinatarios: destinatarios.map((d) => ({
          nome: d.nome,
          email: d.email,
          whatsapp: d.whatsapp,
        })),
        dados,
      },
      responsavel: 'SISTEMA',
      responsavelTipo: 'SISTEMA',
      observacao: `Notificação [${tipo}] enviada: ${titulo}`,
    })
  }

  /**
   * Busca os usuários ativos do tenant no banco de dados e envia uma
   * notificação genérica para cada um deles com base no tipo informado.
   * Apenas e-mail é utilizado neste fluxo, pois o número de WhatsApp
   * não é armazenado no modelo de usuário.
   */
  async notificarTenant(
    tenantId: string,
    tipo: NotificacaoTipo,
    dados: Record<string, unknown>
  ): Promise<void> {
    const usuarios = await this.db.usuario.findMany({
      where: { tenantId, ativo: true },
      select: { nome: true, email: true, telefone: true },
    })

    if (usuarios.length === 0) {
      console.warn(`[Notifications] Nenhum usuário ativo encontrado para o tenant ${tenantId}`)
      return
    }

    const destinatarios: DestinatarioNotificacao[] = usuarios.map(
      (u: { nome: string; email: string; telefone: string | null }) => ({
        nome: u.nome,
        email: u.email,
        ...(u.telefone ? { whatsapp: u.telefone } : {}),
      })
    )

    const { titulo, mensagem } = this.montarMensagem(tipo, dados)

    await this.notificar({ tipo, titulo, mensagem, dados, destinatarios, tenantId })
  }

  // ─── Despacho por canal ──────────────────────────────────────────────────

  private async despacharParaDestinatario(
    dest: DestinatarioNotificacao,
    tipo: NotificacaoTipo,
    titulo: string,
    mensagem: string,
    dados?: Record<string, unknown>
  ): Promise<void> {
    await Promise.allSettled([
      this.despacharEmail(dest, tipo, titulo, mensagem, dados),
      this.despacharWhatsApp(dest, tipo, mensagem, dados),
    ])
  }

  private async despacharEmail(
    dest: DestinatarioNotificacao,
    tipo: NotificacaoTipo,
    titulo: string,
    mensagem: string,
    dados?: Record<string, unknown>
  ): Promise<void> {
    if (!dest.email) return

    try {
      switch (tipo) {
        case 'VENCIMENTO_PROXIMO': {
          const obrigacao = {
            tipo: String(dados?.['obrigacao'] ?? titulo),
            vencimento:
              dados?.['vencimento'] instanceof Date
                ? dados['vencimento']
                : new Date(String(dados?.['vencimento'] ?? Date.now())),
            empresa: String(dados?.['empresa'] ?? ''),
          }
          await this.email.enviarVencimento(dest, obrigacao)
          break
        }

        case 'FECHAMENTO_CONCLUIDO':
          await this.email.enviarFechamentoConcluido(
            dest,
            String(dados?.['empresa'] ?? ''),
            String(dados?.['competencia'] ?? '')
          )
          break

        case 'DIVERGENCIA':
          await this.email.enviarDivergencia(
            dest,
            String(dados?.['empresa'] ?? ''),
            mensagem,
            typeof dados?.['score'] === 'number' ? dados['score'] : 0
          )
          break

        case 'ALERTA_EXCLUSAO_SN':
          await this.email.enviarAlertaExclusaoSN(dest, String(dados?.['empresa'] ?? ''), mensagem)
          break

        case 'CAPTCHA_FALHOU':
        case 'SCRAPER_ERRO':
          await this.email.enviarAlerta(dest, { tipo: titulo, mensagem })
          break

        default:
          await this.email.enviar(dest.email, titulo, this.htmlSimples(titulo, mensagem))
      }
    } catch (err) {
      console.error(`[Notifications] Erro ao enviar e-mail para ${dest.email}:`, err)
    }
  }

  private async despacharWhatsApp(
    dest: DestinatarioNotificacao,
    tipo: NotificacaoTipo,
    mensagem: string,
    dados?: Record<string, unknown>
  ): Promise<void> {
    if (!dest.whatsapp) return

    try {
      let texto: string

      switch (tipo) {
        case 'VENCIMENTO_PROXIMO': {
          const vencimento =
            dados?.['vencimento'] instanceof Date
              ? formatDate(dados['vencimento'], 'dd/MM/yyyy')
              : String(dados?.['vencimento'] ?? '')
          texto = WhatsAppService.mensagemVencimento(
            String(dados?.['empresa'] ?? ''),
            String(dados?.['obrigacao'] ?? ''),
            vencimento
          )
          break
        }

        case 'FECHAMENTO_CONCLUIDO':
          texto = WhatsAppService.mensagemFechamentoConcluido(
            String(dados?.['empresa'] ?? ''),
            String(dados?.['competencia'] ?? '')
          )
          break

        case 'DIVERGENCIA':
          texto = WhatsAppService.mensagemDivergencia(String(dados?.['empresa'] ?? ''), mensagem)
          break

        case 'ALERTA_EXCLUSAO_SN':
          texto = WhatsAppService.mensagemAlertaExclusaoSN(
            String(dados?.['empresa'] ?? ''),
            mensagem
          )
          break

        case 'SCRAPER_ERRO':
          texto = WhatsAppService.mensagemScraperErro(
            String(dados?.['empresa'] ?? ''),
            String(dados?.['portal'] ?? ''),
            mensagem
          )
          break

        case 'CAPTCHA_FALHOU':
          texto = WhatsAppService.mensagemCaptchaFalhou(
            String(dados?.['empresa'] ?? ''),
            String(dados?.['portal'] ?? '')
          )
          break

        default:
          texto = mensagem
      }

      await this.whatsapp.enviar(dest.whatsapp, texto)
    } catch (err) {
      console.error(`[Notifications] Erro ao enviar WhatsApp para ${dest.whatsapp}:`, err)
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  /**
   * Gera título e mensagem padrão para notificações disparadas via
   * `notificarTenant`, onde o conteúdo detalhado está nos `dados`.
   */
  private montarMensagem(
    tipo: NotificacaoTipo,
    dados: Record<string, unknown>
  ): { titulo: string; mensagem: string } {
    switch (tipo) {
      case 'VENCIMENTO_PROXIMO': {
        const empresa = String(dados['empresa'] ?? '')
        const obrigacao = String(dados['obrigacao'] ?? '')
        const vencimento =
          dados['vencimento'] instanceof Date
            ? formatDate(dados['vencimento'], 'dd/MM/yyyy')
            : String(dados['vencimento'] ?? '')
        return {
          titulo: `Vencimento Próximo: ${obrigacao}`,
          mensagem: `A obrigação "${obrigacao}" da empresa ${empresa} vence em ${vencimento}.`,
        }
      }

      case 'FECHAMENTO_CONCLUIDO': {
        const empresa = String(dados['empresa'] ?? '')
        const competencia = String(dados['competencia'] ?? '')
        return {
          titulo: `Fechamento Concluído — ${empresa} (${competencia})`,
          mensagem: `O fechamento da competência ${competencia} para ${empresa} foi processado com sucesso.`,
        }
      }

      case 'DIVERGENCIA': {
        const empresa = String(dados['empresa'] ?? '')
        const score = dados['score'] ?? 0
        return {
          titulo: `Divergência Detectada — ${empresa}`,
          mensagem: `Foi detectada uma divergência (score: ${score}) que requer revisão humana.`,
        }
      }

      case 'ALERTA_EXCLUSAO_SN': {
        const empresa = String(dados['empresa'] ?? '')
        const motivo = String(dados['motivo'] ?? '')
        return {
          titulo: `URGENTE: Risco de Exclusão do Simples Nacional — ${empresa}`,
          mensagem: motivo,
        }
      }

      case 'SCRAPER_ERRO': {
        const empresa = String(dados['empresa'] ?? '')
        const portal = String(dados['portal'] ?? '')
        const detalhe = String(dados['detalhe'] ?? '')
        return {
          titulo: `Erro de Captura — ${empresa} (${portal})`,
          mensagem: detalhe,
        }
      }

      case 'CAPTCHA_FALHOU': {
        const empresa = String(dados['empresa'] ?? '')
        const portal = String(dados['portal'] ?? '')
        return {
          titulo: `Falha na Resolução de CAPTCHA — ${empresa} (${portal})`,
          mensagem: `O serviço de CAPTCHA não conseguiu resolver o desafio no portal ${portal}.`,
        }
      }

      default:
        return {
          titulo: tipo,
          mensagem: JSON.stringify(dados),
        }
    }
  }

  /** Gera um HTML simples para notificações sem template dedicado. */
  private htmlSimples(titulo: string, mensagem: string): string {
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>${titulo}</title>
</head>
<body style="margin:0;padding:32px 16px;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.12);">
    <tr>
      <td style="background-color:#1a56db;padding:20px 28px;">
        <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;">SaaS Contábil</p>
      </td>
    </tr>
    <tr>
      <td style="padding:24px 28px;font-size:15px;color:#374151;line-height:1.6;">
        <p style="margin:0 0 12px 0;font-size:18px;font-weight:700;color:#111827;">${titulo}</p>
        <p style="margin:0;">${mensagem}</p>
      </td>
    </tr>
    <tr>
      <td style="background-color:#f9fafb;border-top:1px solid #e5e7eb;padding:14px 28px;font-size:11px;color:#9ca3af;text-align:center;">
        SaaS Contábil &mdash; Esta é uma mensagem automática. Por favor não responda.
      </td>
    </tr>
  </table>
</body>
</html>`
  }
}
