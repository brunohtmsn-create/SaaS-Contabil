import { Job } from 'bullmq'
import { ScraperOrchestrator } from '@saas-contabil/scraper'
import { NormalizerService } from '@saas-contabil/normalizer'
import { CredentialService } from '@saas-contabil/credentials'

type ScraperJobData = {
  tenantId: string
  empresaId: string
  cnpj: string
  competencia: string
  credencialId: string
  tipo: 'NFE' | 'NFCE' | 'NFSE' | 'TODOS'
}

export async function scraperJob(job: Job<ScraperJobData>): Promise<void> {
  const { tenantId, empresaId, cnpj, competencia, credencialId, tipo } = job.data

  const credService = new CredentialService()
  const normalizer = new NormalizerService()
  const orchestrator = new ScraperOrchestrator()

  const credencial = await credService.retrieve(credencialId, tenantId)

  await job.log(`Capturando ${tipo} para ${cnpj} — ${competencia}`)

  let documentos: any[] = []

  switch (tipo) {
    case 'NFE':
      documentos = await orchestrator.capturarNFe(cnpj, competencia, credencial)
      break
    case 'NFCE':
      documentos = await orchestrator.capturarNFCe(cnpj, competencia, credencial)
      break
    case 'NFSE': {
      const { emitidas, tomadas } = await orchestrator.capturarNFSe(cnpj, competencia, credencial)
      documentos = [...emitidas, ...tomadas]
      break
    }
    case 'TODOS': {
      const todos = await orchestrator.capturarTodos(cnpj, competencia, credencial)
      documentos = [...todos.nfe, ...todos.nfce, ...todos.nfseEmitidas, ...todos.nfseTomadas]
      break
    }
  }

  await job.log(`Capturados ${documentos.length} documentos`)

  let normalizados = 0
  for (const doc of documentos) {
    const result = await normalizer.normalizar(doc as any, tenantId, empresaId)
    if (result) normalizados++
  }

  await job.log(
    `Normalizados ${normalizados} documentos (${documentos.length - normalizados} duplicatas ignoradas)`
  )
}
