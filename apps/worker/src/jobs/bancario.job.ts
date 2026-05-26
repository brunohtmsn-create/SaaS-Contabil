import { Job } from 'bullmq'
import { getPrismaClient } from '@saas-contabil/database'
import { OpenFinanceService, ConciliacaoBancariaService } from '@saas-contabil/contabil'
import { AuditService } from '@saas-contabil/audit'
import { nowBR, formatCompetencia } from '@saas-contabil/shared'

type BancarioJobData =
  | { modo: 'EMPRESA'; tenantId: string; empresaId: string; competencia: string }
  | { modo: 'BATCH_TENANT'; tenantId: string; competencia: string }
  | { modo: 'BATCH_GLOBAL' }

const db = getPrismaClient()
const audit = new AuditService()

export async function bancarioJob(job: Job<BancarioJobData>): Promise<void> {
  const data = job.data

  switch (data.modo) {
    case 'EMPRESA': {
      await processarEmpresa(job, data.tenantId, data.empresaId, data.competencia)
      break
    }

    case 'BATCH_TENANT': {
      const empresas = await db.empresaCliente.findMany({
        where: { tenantId: data.tenantId, ativa: true },
        select: { id: true, cnpj: true },
      })

      await job.log(
        `[BancarioJob] BATCH_TENANT tenant=${data.tenantId} empresas=${empresas.length} comp=${data.competencia}`
      )

      const resultados = await Promise.allSettled(
        empresas.map((emp) => processarEmpresa(job, data.tenantId, emp.id, data.competencia))
      )

      const ok = resultados.filter((r) => r.status === 'fulfilled').length
      const erros = resultados.filter((r) => r.status === 'rejected').length

      await job.log(`[BancarioJob] BATCH_TENANT concluído: ok=${ok} erros=${erros}`)
      break
    }

    case 'BATCH_GLOBAL': {
      const tenants = await db.tenant.findMany({
        where: { ativo: true },
        select: { id: true, subdominio: true },
      })

      const competencia = formatCompetencia(nowBR())

      await job.log(
        `[BancarioJob] BATCH_GLOBAL tenants=${tenants.length} competencia=${competencia}`
      )

      for (const tenant of tenants) {
        const empresas = await db.empresaCliente.findMany({
          where: { tenantId: tenant.id, ativa: true },
          select: { id: true, cnpj: true },
        })

        const resultados = await Promise.allSettled(
          empresas.map((emp) => processarEmpresa(job, tenant.id, emp.id, competencia))
        )

        const ok = resultados.filter((r) => r.status === 'fulfilled').length
        const erros = resultados.filter((r) => r.status === 'rejected').length

        await job.log(
          `[BancarioJob] Tenant ${tenant.subdominio}: ${empresas.length} empresas, ok=${ok} erros=${erros}`
        )
      }

      await job.log('[BancarioJob] BATCH_GLOBAL concluído')
      break
    }
  }
}

async function processarEmpresa(
  job: Job,
  tenantId: string,
  empresaId: string,
  competencia: string
): Promise<void> {
  const openFinance = new OpenFinanceService()
  const bancaria = new ConciliacaoBancariaService()

  const empresa = await db.empresaCliente.findUnique({
    where: { id: empresaId },
    select: { cnpj: true },
  })
  if (!empresa) return

  await openFinance.sincronizarContas(tenantId, empresaId)
  await bancaria.conciliar(tenantId, empresaId, competencia)

  await audit.registrar({
    tenantId,
    cnpj: empresa.cnpj,
    entidadeTipo: 'LANCAMENTO_CONTABIL',
    entidadeId: empresaId,
    evento: 'CONCILIACAO_BANCARIA',
    estadoNovo: { competencia, jobId: job.id, modo: (job.data as BancarioJobData).modo },
    responsavel: 'sistema',
    responsavelTipo: 'SISTEMA',
  })
}
