import { Job } from 'bullmq'
import { ConciliationService } from '@saas-contabil/conciliation'
import { PGDASService, DifalService, GNREService, DeSTDAService, EFDReinfService, FGTSDigitalService } from '@saas-contabil/fiscal'
import { LancamentoService, DepreciacaoService, ConciliacaoBancariaService, OpenFinanceService } from '@saas-contabil/contabil'
import { AuditService } from '@saas-contabil/audit'
import { NotificationService } from '@saas-contabil/notifications'
import { CredentialService } from '@saas-contabil/credentials'
import { ScraperOrchestrator } from '@saas-contabil/scraper'
import { NormalizerService } from '@saas-contabil/normalizer'
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
const fgts = new FGTSDigitalService()
const openFinance = new OpenFinanceService()
const audit = new AuditService()
const notificacao = new NotificationService()
const credentialService = new CredentialService()
const scraper = new ScraperOrchestrator()
const normalizer = new NormalizerService()
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

    // FASE 1: Captura de documentos via scrapers SEFAZ + Portal Nacional
    await job.log('FASE 1: Capturando documentos fiscais...')
    let capturadosTotal = 0
    if (job.data.credencialId) {
      try {
        const credencial = await credentialService.retrieve(job.data.credencialId, tenantId)
        const docs = await scraper.capturarTodos(cnpj, competencia, credencial)
        const todosRaw = [...docs.nfe, ...docs.nfce, ...docs.nfseEmitidas, ...docs.nfseTomadas]
        capturadosTotal = todosRaw.length
        await job.log(`FASE 1: ${capturadosTotal} documento(s) capturados (NF-e:${docs.nfe.length} NFC-e:${docs.nfce.length} NFSe:${docs.nfseEmitidas.length + docs.nfseTomadas.length})`)

        // FASE 2: Normalização e deduplicação
        await job.log('FASE 2: Normalizando e deduplicando documentos...')
        let novos = 0
        for (const raw of todosRaw) {
          const salvo = await normalizer.normalizar(raw, tenantId, empresaId)
          if (salvo) novos++
        }
        await job.log(`FASE 2: ${novos} documento(s) novos persistidos (${capturadosTotal - novos} duplicatas ignoradas)`)
      } catch (scraperErr) {
        await job.log(`FASE 1: Falha no scraper — ${String(scraperErr)} — continuando com documentos existentes`)
      }
    } else {
      await job.log('FASE 1: Sem credencial configurada — usando documentos já importados')
    }

    await job.updateProgress(20)

    await job.log('FASE 3: Conciliando documentos...')
    await Promise.all([
      conciliation.conciliarNFSeTomadas(tenantId, empresaId, competencia),
      conciliation.conciliarNFSeEmitidas(tenantId, empresaId, competencia),
      conciliation.conciliarNFCe(tenantId, empresaId, competencia),
    ])
    await job.updateProgress(40)

    const { inicio, fim } = parsePeriodo(competencia)
    const pendentes = await db.documentoFiscal.count({
      where: { tenantId, empresaId, dataCompetencia: { gte: inicio, lte: fim }, status: 'PENDENTE_REVISAO' },
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

    await job.log('FASE 9: Sincronizando Open Finance e conciliação bancária...')
    await openFinance.sincronizarContas(tenantId, empresaId)
    await bancaria.conciliar(tenantId, empresaId, competencia)
    await job.updateProgress(95)

    await job.log('FASE 10: Apurando FGTS Digital...')
    await fgts.apurar(tenantId, empresaId, competencia)

    await auditJob('FECHAMENTO_CONCLUIDO', { competencia, jobId: job.id })

    await notificacao.notificarTenant(tenantId, 'FECHAMENTO_CONCLUIDO', {
      empresaId,
      cnpj,
      competencia,
    })

    await job.updateProgress(100)
    await job.log('Fechamento concluído com sucesso!')
  } catch (err) {
    await auditJob('OBRIGACAO_FALHOU', { competencia, erro: String(err) })
    throw err
  }
}
