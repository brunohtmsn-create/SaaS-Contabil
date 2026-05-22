import { Job } from 'bullmq'
import { AlertasVencimentosService } from '@saas-contabil/fiscal'
import { NotificationService } from '@saas-contabil/notifications'
import { getPrismaClient } from '@saas-contabil/database'

const alertasService = new AlertasVencimentosService()
const notificacao = new NotificationService()
const db = getPrismaClient()

export async function monitoramentoDiario(job: Job): Promise<void> {
  // Busca todos os tenants ativos
  const tenants = await db.tenant.findMany({ where: { ativo: true } })

  await job.log(`Iniciando monitoramento diário para ${tenants.length} tenant(s)`)

  for (const tenant of tenants) {
    // Verifica vencimentos próximos (7 dias)
    const alertas = await alertasService.verificarProximosVencimentos(tenant.id, 7)

    // Notifica por cada alerta criado
    for (const alerta of alertas) {
      await notificacao.notificarTenant(tenant.id, 'VENCIMENTO_PROXIMO', {
        alertaId: alerta.id,
        mensagem: alerta.mensagem,
      })
    }

    await job.log(`Tenant ${tenant.subdominio}: ${alertas.length} alertas de vencimento`)
  }

  await job.log('Monitoramento diário concluído.')
}
