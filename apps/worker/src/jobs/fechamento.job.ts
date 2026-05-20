import { Job } from 'bullmq'
import { ScraperOrchestrator } from '@saas-contabil/scraper'
import { NormalizerService } from '@saas-contabil/normalizer'
import { ConciliationService } from '@saas-contabil/conciliation'
import { PGDASService, DifalService, GNREService, DeSTDAService, EFDReinfService } from '@saas-contabil/fiscal'
import { LancamentoService, DepreciacaoService, ConciliacaoBancariaService } from '@saas-contabil/contabil'
import { AuditService } from '@saas-contabil/audit'
import { getPrismaClient } from '@saas-contabil/database'

type FechamentoJobData = {
  tenantId: string
  empresaId: string
  cnpj: string
  competencia: string
  credencialId?: string
}

export async function fechamentoCompleto(job: Job<FechamentoJobData>): Promise<void> {
  const { tenantId, empresaId, cnpj, competencia } = job.data
  const db = getPrismaClient()
  const audit = new AuditService()

  await audit.registrar({
    tenantId, cnpj,
    entidadeTipo: 'APURACAO_FISCAL', entidadeId: empresaId,
    evento: 'FECHAMENTO_INICIADO',
    estadoNovo: { competencia, jobId: job.id },
    responsavel: 'sistema', responsavelTipo: 'SISTEMA',
    jobId: job.id,
  })

  try {
    await job.updateProgress(5)

    // FASE 2: Normalização
    await job.log('FASE 2: Normalizando documentos...')
    await job.updateProgress(20)

    // FASE 3: Conciliação
    await job.log('FASE 3: Conciliando documentos...')
    const conciliation = new ConciliationService()
    await conciliation.conciliarNFSeTomadas(tenantId, empresaId, competencia)
    await conciliation.conciliarNFSeEmitidas(tenantId, empresaId, competencia)
    await conciliation.conciliarNFCe(tenantId, empresaId, competencia)
    await job.updateProgress(40)

    // Verificar se há divergências pendentes
    const pendentes = await db.documentoFiscal.count({
      where: { tenantId, empresaId, dataCompetencia: { gte: new Date(`${competencia}-01`) }, status: 'PENDENTE_REVISAO' },
    })

    if (pendentes > 0) {
      await job.log(`ATENÇÃO: ${pendentes} documentos aguardando revisão humana`)
    }

    // FASE 4: Cálculo fiscal
    await job.log('FASE 4: Apurando PGDAS...')
    const pgdas = new PGDASService()
    await pgdas.apurar(tenantId, empresaId, competencia)
    await job.updateProgress(55)

    // FASE 5: DIFAL e GNRE
    await job.log('FASE 5: Calculando DIFAL e GNRE...')
    const difal = new DifalService()
    await difal.calcular(tenantId, empresaId, competencia)
    const gnre = new GNREService()
    await gnre.gerar(tenantId, empresaId, competencia)
    await job.updateProgress(65)

    // FASE 6: DeSTDA
    await job.log('FASE 6: Gerando DeSTDA...')
    const destda = new DeSTDAService()
    await destda.gerar(tenantId, empresaId, competencia)
    await job.updateProgress(70)

    // FASE 7: EFD-Reinf
    await job.log('FASE 7: Processando EFD-Reinf...')
    const reinf = new EFDReinfService()
    await reinf.processar(tenantId, empresaId, competencia)
    await job.updateProgress(80)

    // FASE 8: Contábil
    await job.log('FASE 8: Gerando lançamentos contábeis...')
    const lancamento = new LancamentoService()
    await lancamento.gerarLancamentos(tenantId, empresaId, competencia)
    await lancamento.lancarImpostos(tenantId, empresaId, competencia)

    const depreciacao = new DepreciacaoService()
    await depreciacao.calcular(tenantId, empresaId, competencia)
    await job.updateProgress(90)

    // FASE 9: Conciliação bancária
    await job.log('FASE 9: Conciliação bancária...')
    const bancaria = new ConciliacaoBancariaService()
    await bancaria.conciliar(tenantId, empresaId, competencia)
    await job.updateProgress(95)

    await audit.registrar({
      tenantId, cnpj,
      entidadeTipo: 'APURACAO_FISCAL', entidadeId: empresaId,
      evento: 'FECHAMENTO_CONCLUIDO',
      estadoNovo: { competencia, jobId: job.id },
      responsavel: 'sistema', responsavelTipo: 'SISTEMA',
      jobId: job.id,
    })

    await job.updateProgress(100)
    await job.log('Fechamento concluído com sucesso!')
  } catch (err) {
    await audit.registrar({
      tenantId, cnpj,
      entidadeTipo: 'APURACAO_FISCAL', entidadeId: empresaId,
      evento: 'OBRIGACAO_FALHOU',
      estadoNovo: { competencia, erro: String(err) },
      responsavel: 'sistema', responsavelTipo: 'SISTEMA',
      jobId: job.id,
    })
    throw err
  }
}
