import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { nowBR, addDays } from '@saas-contabil/shared'
import type { Alerta } from '@prisma/client'

export class AlertasVencimentosService {
  private db = getPrismaClient()
  private audit = new AuditService()

  /**
   * Busca obrigações que vencem nos próximos `diasAntecedencia` dias e ainda não
   * possuem alerta VENCIMENTO_OBRIGACAO criado. Para cada uma, cria o alerta.
   */
  async verificarProximosVencimentos(
    tenantId: string,
    diasAntecedencia: number = 7
  ): Promise<Alerta[]> {
    const hoje = nowBR()
    const limite = addDays(hoje, diasAntecedencia)

    // Busca obrigações pendentes dentro da janela de antecedência
    const obrigacoesPendentes = await this.db.obrigacao.findMany({
      where: {
        tenantId,
        status: { in: ['PENDENTE', 'ATRASADA'] },
        vencimento: {
          gte: hoje,
          lte: limite,
        },
      },
      include: { empresa: true },
    })

    if (obrigacoesPendentes.length === 0) return []

    // Para cada obrigação, verifica se já existe alerta não lido
    const alertasCriados: Alerta[] = []

    for (const obrigacao of obrigacoesPendentes) {
      const alertaExistente = await this.db.alerta.findFirst({
        where: {
          tenantId,
          empresaId: obrigacao.empresaId,
          tipo: 'VENCIMENTO_OBRIGACAO',
          dados: {
            path: ['obrigacaoId'],
            equals: obrigacao.id,
          },
          lido: false,
        },
      })

      if (!alertaExistente) {
        const diasRestantes = Math.ceil(
          (obrigacao.vencimento.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24)
        )

        const alerta = await this.db.alerta.create({
          data: {
            tenantId,
            empresaId: obrigacao.empresaId,
            tipo: 'VENCIMENTO_OBRIGACAO',
            mensagem:
              `Obrigação ${obrigacao.tipo} da competência ${obrigacao.competencia} ` +
              `vence em ${diasRestantes} dia(s) — ${obrigacao.vencimento.toLocaleDateString('pt-BR')}`,
            dados: {
              obrigacaoId: obrigacao.id,
              tipo: obrigacao.tipo,
              competencia: obrigacao.competencia,
              vencimento: obrigacao.vencimento.toISOString(),
              diasRestantes,
              cnpj: obrigacao.empresa.cnpj,
            },
          },
        })

        alertasCriados.push(alerta)
      }
    }

    return alertasCriados
  }

  /**
   * Marca um alerta como enviado/lido após notificação ao contador.
   * Sempre valida `tenantId` para garantir isolamento multi-tenant.
   */
  async marcarComoEnviado(alertaId: string, tenantId: string): Promise<void> {
    const alerta = await this.db.alerta.findFirst({
      where: { id: alertaId, tenantId },
    })

    if (!alerta) {
      throw new Error(`Alerta ${alertaId} não encontrado para o tenant ${tenantId}`)
    }

    await this.db.alerta.update({
      where: { id: alertaId },
      data: { lido: true },
    })

    await this.audit.registrar({
      tenantId,
      cnpj: (alerta.dados as any)?.cnpj ?? 'unknown',
      entidadeTipo: 'ALERTA',
      entidadeId: alertaId,
      evento: 'ALERTA_MARCADO_ENVIADO',
      estadoNovo: { alertaId, tipo: alerta.tipo, lido: true },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })
  }
}
