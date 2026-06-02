import { Job } from 'bullmq'
import {
  PGDASService,
  DifalService,
  GNREService,
  DeSTDAService,
  EFDReinfService,
  ESocialService,
  DCTFWebService,
  FGTSDigitalService,
  DMSService,
  DasnService,
  MonitoramentoSNService,
  CalendarioLPLRService,
  IrpjCsllLPService,
  PisCofinsLPService,
  ECFService,
  DCTFMensalService,
  SpedFiscalService,
  SpedContribuicoesService,
} from '@saas-contabil/fiscal'

type FiscalJobData = {
  tenantId: string
  empresaId: string
  cnpj: string
  competencia: string
  operacao:
    | 'PGDAS'
    | 'DIFAL'
    | 'GNRE'
    | 'DESTDA'
    | 'EFDREINF'
    | 'ESOCIAL'
    | 'DCTFWEB'
    | 'FGTS'
    | 'DMS'
    | 'DASN'
    | 'CALENDARIO_SN'
    | 'CALENDARIO_LPLR'
    | 'IRPJ_CSLL_LP'
    | 'PIS_COFINS_LP'
    | 'ECF'
    | 'DCTF_MENSAL'
    | 'SPED_FISCAL'
    | 'SPED_CONTRIBUICOES'
    | 'TODOS'
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
    case 'FGTS': {
      const fgts = new FGTSDigitalService()
      await fgts.apurar(tenantId, empresaId, competencia)
      break
    }
    case 'DMS': {
      const dms = new DMSService()
      await dms.apurar(tenantId, empresaId, competencia)
      break
    }
    case 'DASN': {
      // competencia contém apenas o ano, ex: "2024"
      const dasn = new DasnService()
      await dasn.gerar(tenantId, empresaId, Number(competencia))
      break
    }
    case 'CALENDARIO_SN': {
      // competencia contém apenas o ano, ex: "2025"
      const sn = new MonitoramentoSNService()
      await sn.gerarCalendarioAnual(tenantId, empresaId, Number(competencia))
      break
    }
    case 'CALENDARIO_LPLR': {
      // competencia contém apenas o ano, ex: "2025"
      const lplr = new CalendarioLPLRService()
      await lplr.gerarCalendarioAnual(tenantId, empresaId, Number(competencia))
      break
    }
    case 'IRPJ_CSLL_LP': {
      const irpj = new IrpjCsllLPService()
      await irpj.apurar(tenantId, empresaId, competencia)
      break
    }
    case 'PIS_COFINS_LP': {
      const pisCofins = new PisCofinsLPService()
      await pisCofins.apurar(tenantId, empresaId, competencia)
      break
    }
    case 'ECF': {
      // competencia contém apenas o ano, ex: "2025"
      const ecf = new ECFService()
      await ecf.gerar(tenantId, empresaId, Number(competencia))
      break
    }
    case 'DCTF_MENSAL': {
      const dctf = new DCTFMensalService()
      await dctf.gerar(tenantId, empresaId, competencia)
      break
    }
    case 'SPED_FISCAL': {
      const spedFiscal = new SpedFiscalService()
      await spedFiscal.gerar(tenantId, empresaId, competencia)
      break
    }
    case 'SPED_CONTRIBUICOES': {
      const spedContrib = new SpedContribuicoesService()
      await spedContrib.gerar(tenantId, empresaId, competencia)
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
      const fgts = new FGTSDigitalService()
      const dms = new DMSService()
      await pgdas.apurar(tenantId, empresaId, competencia)
      await difal.calcular(tenantId, empresaId, competencia)
      await gnre.gerar(tenantId, empresaId, competencia)
      await destda.gerar(tenantId, empresaId, competencia)
      await reinf.processar(tenantId, empresaId, competencia)
      try {
        await dms.apurar(tenantId, empresaId, competencia)
      } catch {
        // empresa sem NFSe no período — ignora
      }
      try {
        await eSocial.processar(tenantId, empresaId, competencia)
      } catch {
        // empresa sem empregados — ignora
      }
      try {
        await fgts.apurar(tenantId, empresaId, competencia)
      } catch {
        // empresa sem folha de pagamento — ignora
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
