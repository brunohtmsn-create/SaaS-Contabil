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
  IrpjCsllLRService,
  CreditosPisCofinsLRService,
  RetencoesNaFonteService,
  IrpjCsllLREstimativaService,
  PrejuizosFiscaisLRService,
  DepreciacaoLRService,
  INSSPatronalService,
  AjusteAnualLRService,
  LALURService,
  SimuladorTributarioService,
  PlanejamentoTributarioService,
  RelatorioFiscalService,
  IcmsStService,
  EncerramentoSNService,
  LivroFiscalService,
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
    | 'IRPJ_CSLL_LR'
    | 'CREDITOS_PIS_COFINS_LR'
    | 'RETENCOES_FONTE'
    | 'IRPJ_CSLL_LR_ESTIMATIVA'
    | 'PREJUIZOS_FISCAIS_LR'
    | 'DEPRECIACAO_LR'
    | 'INSS_PATRONAL'
    | 'AJUSTE_ANUAL_LR'
    | 'LALUR'
    | 'SIMULADOR_TRIBUTARIO'
    | 'PLANEJAMENTO_TRIBUTARIO'
    | 'RELATORIO_FISCAL'
    | 'ICMS_ST'
    | 'ENCERRAMENTO_SN'
    | 'LIVRO_FISCAL'
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
    case 'IRPJ_CSLL_LR': {
      // lucroContabilTrimestral é passado como metadado adicional do job
      const { Decimal } = await import('@saas-contabil/shared')
      const meta = (job.data as any).meta ?? {}
      const irpjLr = new IrpjCsllLRService()
      await irpjLr.apurar(
        tenantId,
        empresaId,
        competencia,
        new Decimal(meta.lucroContabilTrimestral ?? '0'),
        new Decimal(meta.adicoesLALUR ?? '0'),
        new Decimal(meta.exclusoesLALUR ?? '0')
      )
      break
    }
    case 'CREDITOS_PIS_COFINS_LR': {
      const creditosLr = new CreditosPisCofinsLRService()
      await creditosLr.apurar(tenantId, empresaId, competencia)
      break
    }
    case 'RETENCOES_FONTE': {
      const retencoes = new RetencoesNaFonteService()
      await retencoes.apurar(tenantId, empresaId, competencia)
      break
    }
    case 'IRPJ_CSLL_LR_ESTIMATIVA': {
      const meta = (job.data as any).meta ?? {}
      const estimativa = new IrpjCsllLREstimativaService()
      await estimativa.apurar(tenantId, empresaId, competencia, meta.atividadePrincipal)
      break
    }
    case 'PREJUIZOS_FISCAIS_LR': {
      const { Decimal } = await import('@saas-contabil/shared')
      const meta = (job.data as any).meta ?? {}
      const prejuizos = new PrejuizosFiscaisLRService()
      if (meta.registrar) {
        await prejuizos.registrarPrejuizo(
          tenantId,
          empresaId,
          competencia,
          new Decimal(meta.prejuizoIRPJ ?? '0'),
          new Decimal(meta.prejuizoCSLL ?? '0')
        )
      } else {
        await prejuizos.compensar(
          tenantId,
          empresaId,
          competencia,
          new Decimal(meta.lucroRealDoPeriodo ?? '0'),
          new Decimal(meta.baseCSLLdoPeriodo ?? '0')
        )
      }
      break
    }
    case 'DEPRECIACAO_LR': {
      const meta = (job.data as any).meta ?? {}
      const depreciacao = new DepreciacaoLRService()
      await depreciacao.apurar(tenantId, empresaId, competencia, meta.bens ?? [])
      break
    }
    case 'INSS_PATRONAL': {
      const { Decimal } = await import('@saas-contabil/shared')
      const meta = (job.data as any).meta ?? {}
      const inss = new INSSPatronalService()
      await inss.calcular(
        tenantId,
        empresaId,
        competencia,
        meta.funcionarios ?? [],
        meta.grauRisco,
        meta.fap ? new Decimal(meta.fap) : undefined,
        meta.atividadeTerceiros
      )
      break
    }
    case 'AJUSTE_ANUAL_LR': {
      const { Decimal } = await import('@saas-contabil/shared')
      const meta = (job.data as any).meta ?? {}
      const ajuste = new AjusteAnualLRService()
      await ajuste.apurar(
        tenantId,
        empresaId,
        Number(competencia), // competencia recebe o ano (ex: "2025")
        new Decimal(meta.lucroRealAnual ?? '0'),
        new Decimal(meta.adicoesLALUR ?? '0'),
        new Decimal(meta.exclusoesLALUR ?? '0')
      )
      break
    }
    case 'LALUR': {
      const { Decimal } = await import('@saas-contabil/shared')
      const meta = (job.data as any).meta ?? {}
      const lalur = new LALURService()
      await lalur.apurar(
        tenantId,
        empresaId,
        competencia,
        new Decimal(meta.lucroLiquido ?? '0'),
        (meta.adicoes ?? []).map((a: any) => ({ ...a, valor: new Decimal(a.valor) })),
        (meta.exclusoes ?? []).map((e: any) => ({ ...e, valor: new Decimal(e.valor) }))
      )
      break
    }
    case 'SIMULADOR_TRIBUTARIO': {
      const { Decimal } = await import('@saas-contabil/shared')
      const meta = (job.data as any).meta ?? {}
      const simulador = new SimuladorTributarioService()
      await simulador.simular(
        tenantId,
        new Decimal(meta.receitaBrutaAnual ?? '0'),
        meta.atividade ?? 'servicos',
        new Decimal(meta.folhaPagamentoAnual ?? '0'),
        meta.lucroEstimadoAnual ? new Decimal(meta.lucroEstimadoAnual) : undefined
      )
      break
    }
    case 'PLANEJAMENTO_TRIBUTARIO': {
      const { Decimal } = await import('@saas-contabil/shared')
      const meta = (job.data as any).meta ?? {}
      const planejamento = new PlanejamentoTributarioService()
      await planejamento.analisar(
        tenantId,
        empresaId,
        Number(competencia), // competencia recebe o exercício (ex: "2025")
        meta.receitaProjetadaAnual ? new Decimal(meta.receitaProjetadaAnual) : undefined,
        meta.folhaProjetadaAnual ? new Decimal(meta.folhaProjetadaAnual) : undefined,
        meta.lucroProjetadoAnual ? new Decimal(meta.lucroProjetadoAnual) : undefined
      )
      break
    }
    case 'RELATORIO_FISCAL': {
      const relatorio = new RelatorioFiscalService()
      await relatorio.gerar(tenantId, empresaId, competencia)
      break
    }
    case 'ICMS_ST': {
      const icmsSt = new IcmsStService()
      await icmsSt.calcular(tenantId, empresaId, competencia)
      break
    }
    case 'ENCERRAMENTO_SN': {
      const encerramento = new EncerramentoSNService()
      await encerramento.encerrar(tenantId, empresaId, competencia)
      break
    }
    case 'LIVRO_FISCAL': {
      const livro = new LivroFiscalService()
      await livro.gerar(tenantId, empresaId, competencia)
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
