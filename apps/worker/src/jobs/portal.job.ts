import { Job } from 'bullmq'
import { PortalOrchestrator } from '@saas-contabil/portals'
import { CredentialService } from '@saas-contabil/credentials'

type PortalJobData = {
  tenantId: string
  empresaId: string
  cnpj: string
  portal: string
  operacao: string
  credencialId: string
  competencia?: string
  dados?: object
  prioridade: 1 | 2 | 3
}

export async function portalJob(job: Job<PortalJobData>): Promise<void> {
  const { tenantId, empresaId, cnpj, credencialId } = job.data

  const credService = new CredentialService()
  const orchestrator = new PortalOrchestrator()

  const credencial = await credService.retrieve(credencialId, tenantId)

  await orchestrator.executar(
    {
      tenantId,
      empresaId,
      cnpj,
      portal: job.data.portal,
      operacao: job.data.operacao,
      credencialId,
      prioridade: job.data.prioridade,
      competencia: job.data.competencia,
      dados: job.data.dados,
    },
    credencial.data
  )
}
