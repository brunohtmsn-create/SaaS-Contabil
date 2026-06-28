import { Job } from 'bullmq'
import { AlertasVencimentosService } from '@saas-contabil/fiscal'
import { NotificationService } from '@saas-contabil/notifications'
import { CredentialService } from '@saas-contabil/credentials'
import { getPrismaClient } from '@saas-contabil/database'
import { nowBR, addDays } from '@saas-contabil/shared'

const alertasService = new AlertasVencimentosService()
const notificacao = new NotificationService()
const credService = new CredentialService()
const db = getPrismaClient()

export async function monitoramentoDiario(job: Job): Promise<void> {
  const tenants = await db.tenant.findMany({ where: { ativo: true } })

  await job.log(`Iniciando monitoramento diário para ${tenants.length} tenant(s)`)

  for (const tenant of tenants) {
    await job.log(`--- Processando tenant: ${tenant.subdominio} ---`)

    // 1. Verificar vencimentos de obrigações (próximos 7 dias)
    const alertasVenc = await alertasService.verificarProximosVencimentos(tenant.id, 7)
    for (const alerta of alertasVenc) {
      await notificacao.notificarTenant(tenant.id, 'VENCIMENTO_PROXIMO', {
        alertaId: alerta.id,
        mensagem: alerta.mensagem,
      })
    }
    await job.log(`  Vencimentos: ${alertasVenc.length} alerta(s) criado(s)`)

    // 2. Atualizar status de credenciais vencidas
    const totalVencidas = await credService.updateExpiredStatuses(tenant.id)
    if (totalVencidas > 0) {
      await job.log(`  Credenciais vencidas atualizadas: ${totalVencidas}`)
    }

    // 3. Verificar credenciais vencendo (próximos 30 dias) e criar alertas
    const credVencendo = await credService.checkExpiring(tenant.id, 30)
    let alertasCredCriados = 0

    for (const cred of credVencendo) {
      const jaExisteAlerta = await db.alerta.findFirst({
        where: {
          tenantId: tenant.id,
          empresaId: cred.empresaId,
          tipo: 'CREDENCIAL_VENCENDO',
          dados: { path: ['credencialId'], equals: cred.id },
          lido: false,
        },
      })

      if (!jaExisteAlerta) {
        const diasRestantes = cred.validade
          ? Math.ceil((cred.validade.getTime() - nowBR().getTime()) / (1000 * 60 * 60 * 24))
          : null

        await db.alerta.create({
          data: {
            tenantId: tenant.id,
            empresaId: cred.empresaId,
            tipo: 'CREDENCIAL_VENCENDO',
            mensagem:
              diasRestantes !== null
                ? `Credencial ${cred.tipo} para CNPJ ${cred.cnpj} vence em ${diasRestantes} dia(s)`
                : `Credencial ${cred.tipo} para CNPJ ${cred.cnpj} está próxima do vencimento`,
            dados: {
              credencialId: cred.id,
              tipo: cred.tipo,
              cnpj: cred.cnpj,
              validade: cred.validade?.toISOString() ?? null,
              diasRestantes,
            },
          },
        })
        alertasCredCriados++
      }
    }

    if (alertasCredCriados > 0) {
      await job.log(`  Credenciais vencendo: ${alertasCredCriados} alerta(s) criado(s)`)
      await notificacao.notificarTenant(tenant.id, 'CAPTCHA_FALHOU', {
        tipo: 'credencial_vencendo',
        quantidade: alertasCredCriados,
      })
    }

    // 4. Verificar documentos com PENDENTE_REVISAO há mais de 48h sem ação
    const limite48h = addDays(nowBR(), -2)
    const docsPendentes = await db.documentoFiscal.count({
      where: {
        tenantId: tenant.id,
        status: 'PENDENTE_REVISAO',
        atualizadoEm: { lte: limite48h },
      },
    })

    if (docsPendentes > 0) {
      const jaExisteAlertaPendente = await db.alerta.findFirst({
        where: {
          tenantId: tenant.id,
          tipo: 'DIVERGENCIA_CONCILIACAO',
          dados: { path: ['tipo'], equals: 'DOCUMENTOS_PENDENTES_48H' },
          lido: false,
          criadoEm: { gte: addDays(nowBR(), -1) },
        },
      })

      if (!jaExisteAlertaPendente) {
        await db.alerta.create({
          data: {
            tenantId: tenant.id,
            tipo: 'DIVERGENCIA_CONCILIACAO',
            mensagem: `${docsPendentes} documento(s) aguardando revisão humana há mais de 48 horas`,
            dados: {
              tipo: 'DOCUMENTOS_PENDENTES_48H',
              quantidade: docsPendentes,
              geradoEm: nowBR().toISOString(),
            },
          },
        })
        await job.log(`  Docs pendentes revisão >48h: ${docsPendentes}`)
      }
    }

    // 5. Verificar PGDAS pendente para o mês atual
    const hoje = nowBR()
    const competenciaAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
    const diaAtual = hoje.getDate()

    // Alertar somente entre o dia 15 e o dia 19 (prazo do DAS é dia 20)
    if (diaAtual >= 15 && diaAtual <= 19) {
      const pgdasNaoTransmitidos = await db.apuracaoFiscal.count({
        where: {
          tenantId: tenant.id,
          tipo: 'PGDAS',
          competencia: competenciaAtual,
          status: { notIn: ['TRANSMITIDO', 'PAGO'] },
        },
      })

      if (pgdasNaoTransmitidos > 0) {
        const jaExistePgdas = await db.alerta.findFirst({
          where: {
            tenantId: tenant.id,
            tipo: 'PGDAS_PENDENTE',
            dados: { path: ['competencia'], equals: competenciaAtual },
            lido: false,
          },
        })

        if (!jaExistePgdas) {
          await db.alerta.create({
            data: {
              tenantId: tenant.id,
              tipo: 'PGDAS_PENDENTE',
              mensagem: `${pgdasNaoTransmitidos} PGDAS da competência ${competenciaAtual} ainda não transmitido(s). Prazo: dia 20.`,
              dados: {
                competencia: competenciaAtual,
                quantidade: pgdasNaoTransmitidos,
                prazo: `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-20`,
              },
            },
          })
          await job.log(
            `  PGDAS pendente: ${pgdasNaoTransmitidos} empresa(s) para ${competenciaAtual}`
          )
        }
      }
    }
  }

  await job.log('Monitoramento diário concluído.')
}
