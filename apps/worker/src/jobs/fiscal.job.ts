import { Job } from 'bullmq'
import {
  PGDASService,
  DifalService,
  GNREService,
  DeSTDAService,
  EFDReinfService,
  ESocialService,
  DCTFWebService,
} from '@saas-contabil/fiscal'

type FiscalJobData = {
  tenantId: string
  empresaId: string
  cnpj: string
  competencia: string
  operacao: 'PGDAS' | 'DIFAL' | 'GNRE' | 'DESTDA' | 'EFDREINF' | 'ESOCIAL' | 'DCTFWEB' | 'TODOS'
}

export async function fiscalJob(job: Job<FiscalJobData>): Promise<void> {
  const { tenantId, empresaId, competencia, operacao } = job.data

  switch (operacao) {
    case 'PGDAS': {
      const pgdas = new PGDASService()
      await pgdas.apurar(tenantId, empresaId, competencia)
      break
    }
    case 'DIFAL': {
      const difal = new DifalService()
      await difal.calcular(tenantId, empresaId, competencia)
      break
    }
    case 'GNRE': {
      const gnre = new GNREService()
      await gnre.gerar(tenantId, empresaId, competencia)
      break
    }
    case 'DESTDA': {
      const destda = new DeSTDAService()
      await destda.gerar(tenantId, empresaId, competencia)
      break
    }
    case 'EFDREINF': {
      const reinf = new EFDReinfService()
      await reinf.processar(tenantId, empresaId, competencia)
      break
    }
    case 'ESOCIAL': {
      const eSocial = new ESocialService()
      await eSocial.processar(tenantId, empresaId, competencia)
      break
    }
    case 'DCTFWEB': {
      const dctf = new DCTFWebService()
      await dctf.gerar(tenantId, empresaId, competencia)
      break
    }
    case 'TODOS': {
      const pgdas = new PGDASService()
      const difal = new DifalService()
      const gnre = new GNREService()
      const destda = new DeSTDAService()
      const reinf = new EFDReinfService()
      const eSocial = new ESocialService()
      const dctf = new DCTFWebService()
      await pgdas.apurar(tenantId, empresaId, competencia)
      await difal.calcular(tenantId, empresaId, competencia)
      await gnre.gerar(tenantId, empresaId, competencia)
      await destda.gerar(tenantId, empresaId, competencia)
      await reinf.processar(tenantId, empresaId, competencia)
      try {
        await eSocial.processar(tenantId, empresaId, competencia)
      } catch {
        // empresa sem empregados — ignora
      }
      try {
        await dctf.gerar(tenantId, empresaId, competencia)
      } catch {
        // requer EFD-Reinf fechado — ignora se pré-requisito falhar
      }
      break
    }
  }
}
