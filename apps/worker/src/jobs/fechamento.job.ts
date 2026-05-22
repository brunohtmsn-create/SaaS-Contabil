import { Job } from 'bullmq'
import { ConciliationService } from '@saas-contabil/conciliation'
import { PGDASService, DifalService, GNREService, DeSTDAService, EFDReinfService } from '@saas-contabil/fiscal'
import { LancamentoService, DepreciacaoService, ConciliacaoBancariaService } from '@saas-contabil/contabil'
import { AuditService } from '@saas-contabil/audit'
import { getPrismaClient } from '@saas-contabil/database'
import { parsePeriodo } from '@saas-contabil/shared'

const conciliation = new ConciliationService()
const pgdas = new PGDASService()
const difal = new DifalService()
const gnre = new GNREService()
const destda = new DeSTDAService()
const reinf = new EFDReinfService()
const lancamento = new LancamentoService()
const depreciacao = new DepreciacaoService()
const bancaria = new ConciliacaoBancariaService()
const audit = new AuditService()
const db = getPrismaClient()

type FechamentoJobData = {
  tenantId: string
  empresaId: string
  cnpj: string
  competencia: string
  credencialId?: string
}

const AUDIT_SISTEMA = { responsavel: 'sistema', responsavelTipo: 'SISTEMA' } as const

export async function fechamentoCompleto(job: Job<FechamentoJobData>): Promise<void> {
  const { tenantId, empresaId, cnpj, competencia } = job.data

  const auditJob = (evento: Parameters<typeof audit.registrar>[0]['evento'], estadoNovo: unknown) =>
    audit.registrar({ tenantId, cnpj, entidadeTipo: 'APURACAO_FISCAL', entidadeId: empresaId, evento, estadoNovo, ...AUDIT_SISTEMA, jobId: job.id })

  await auditJob('FECHAMENTO_INICIADO', { competencia, jobId: job.id })

  try {
    await job.updateProgress(5)

    await job.log('FASE 2: Normalizando documentos...')
    await job.updateProgress(20)

    await job.log('FASE 3: Conciliando documentos...')
    await Promise.all([
      conciliation.conciliarNFSeTomadas(tenantId, empresaId, competencia),
      conciliation.conciliarNFSeEmitidas(tenantId, empresaId, competencia),
      conciliation.conciliarNFCe(tenantId, empresaId, competencia),
    ])
    await job.updateProgress(40)

    const { inicio } = parsePeriodo(competencia)
    const pendentes = await db.documentoFiscal.count({
      where: { tenantId, empresaId, dataCompetencia: { gte: inicio }, status: 'PENDENTE_REVISAO' },
    })

    if (pendentes > 0) {
      await job.log(`ATENÇÃO: ${pendentes} documentos aguardando revisão humana`)
    }

    await job.log('FASE 4: Apurando PGDAS...')
    await pgdas.apurar(tenantId, empresaId, competencia)
    await job.updateProgress(55)

    await job.log('FASE 5: Calculando DIFAL e GNRE...')
    await difal.calcular(tenantId, empresaId, competencia)
    await gnre.gerar(tenantId, empresaId, competencia)
    await job.updateProgress(65)

    await job.log('FASE 6: Gerando DeSTDA...')
    await destda.gerar(tenantId, empresaId, competencia)
    await job.updateProgress(70)

    await job.log('FASE 7: Processando EFD-Reinf...')
    await reinf.processar(tenantId, empresaId, competencia)
    await job.updateProgress(80)

    await job.log('FASE 8: Gerando lançamentos contábeis...')
    await lancamento.gerarLancamentos(tenantId, empresaId, competencia)
    await lancamento.lancarImpostos(tenantId, empresaId, competencia)
    await depreciacao.calcular(tenantId, empresaId, competencia)
    await job.updateProgress(90)

    await job.log('FASE 9: Conciliação bancária...')
    await bancaria.conciliar(tenantId, empresaId, competencia)
    await job.updateProgress(95)

    await auditJob('FECHAMENTO_CONCLUIDO', { competencia, jobId: job.id })

    await job.updateProgress(100)
    await job.log('Fechamento concluído com sucesso!')
  } catch (err) {
    await auditJob('OBRIGACAO_FALHOU', { competencia, erro: String(err) })
    throw err
  }
}
