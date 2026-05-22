import { Job } from 'bullmq'
import { getPrismaClient } from '@saas-contabil/database'
import { StorageService } from '@saas-contabil/storage'
import { S3KeyBuilder } from '@saas-contabil/storage'
import { NotificationService } from '@saas-contabil/notifications'
import { Decimal } from '@saas-contabil/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

type RelatorioJobData = {
  tenantId: string
  competencia: string  // formato 'YYYY-MM'
}

type LinhaRelatorio = {
  cnpj: string
  razaoSocial: string
  competencia: string
  tipo: string
  status: string
  valorDas: string
  rbTotal: string
  aliquotaEfetiva: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const db = getPrismaClient()
const storage = new StorageService()
const notificacao = new NotificationService()

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function linhaParaCSV(linha: LinhaRelatorio): string {
  return [
    linha.cnpj,
    escapeCSV(linha.razaoSocial),
    linha.competencia,
    linha.tipo,
    linha.status,
    linha.valorDas,
    linha.rbTotal,
    linha.aliquotaEfetiva,
  ].join(',')
}

function extrairValorDAS(dados: unknown): Decimal {
  if (!dados || typeof dados !== 'object') return new Decimal(0)
  const d = dados as Record<string, unknown>
  const valor = d['valorDas'] ?? d['valorTotal'] ?? d['valor'] ?? 0
  try {
    return new Decimal(String(valor))
  } catch {
    return new Decimal(0)
  }
}

function extrairRBTotal(dados: unknown): Decimal {
  if (!dados || typeof dados !== 'object') return new Decimal(0)
  const d = dados as Record<string, unknown>
  const rb = d['receitaBruta'] ?? d['rbTotal'] ?? d['receitaBrutaTotal'] ?? 0
  try {
    return new Decimal(String(rb))
  } catch {
    return new Decimal(0)
  }
}

function calcularAliquotaEfetiva(valorDas: Decimal, rbTotal: Decimal): string {
  if (rbTotal.isZero()) return '0.00'
  return valorDas.dividedBy(rbTotal).times(100).toDecimalPlaces(2).toString()
}

// ─── Job processor ────────────────────────────────────────────────────────────

export async function gerarRelatorioMensal(job: Job<RelatorioJobData>): Promise<void> {
  const { tenantId, competencia } = job.data

  await job.log(`[RelatorioJob] Iniciando relatório consolidado — tenant=${tenantId} competencia=${competencia}`)
  await job.updateProgress(5)

  // 1. Busca todas as empresas ativas do tenant
  const empresas = await db.empresaCliente.findMany({
    where: { tenantId, ativa: true },
    select: {
      id: true,
      cnpj: true,
      razaoSocial: true,
      apuracoesFiscais: {
        where: { tenantId, competencia },
        select: {
          tipo: true,
          status: true,
          dados: true,
        },
      },
    },
  })

  await job.log(`[RelatorioJob] ${empresas.length} empresas ativas encontradas`)
  await job.updateProgress(20)

  // 2. Para cada empresa, extrai apurações do período e monta linhas do CSV
  const linhas: LinhaRelatorio[] = []

  const CABECALHO: LinhaRelatorio = {
    cnpj: 'CNPJ',
    razaoSocial: 'Razão Social',
    competencia: 'Competência',
    tipo: 'Tipo',
    status: 'Status',
    valorDas: 'Valor DAS',
    rbTotal: 'RB Total',
    aliquotaEfetiva: 'Alíquota Efetiva (%)',
  }
  linhas.push(CABECALHO)

  for (const empresa of empresas) {
    if (empresa.apuracoesFiscais.length === 0) {
      // Empresa sem apurações no período — inclui linha em branco
      linhas.push({
        cnpj: empresa.cnpj,
        razaoSocial: empresa.razaoSocial,
        competencia,
        tipo: '-',
        status: 'SEM_APURACAO',
        valorDas: '0.00',
        rbTotal: '0.00',
        aliquotaEfetiva: '0.00',
      })
      continue
    }

    for (const apuracao of empresa.apuracoesFiscais) {
      const valorDas = extrairValorDAS(apuracao.dados)
      const rbTotal = extrairRBTotal(apuracao.dados)

      linhas.push({
        cnpj: empresa.cnpj,
        razaoSocial: empresa.razaoSocial,
        competencia,
        tipo: apuracao.tipo,
        status: apuracao.status,
        valorDas: valorDas.toDecimalPlaces(2).toString(),
        rbTotal: rbTotal.toDecimalPlaces(2).toString(),
        aliquotaEfetiva: calcularAliquotaEfetiva(valorDas, rbTotal),
      })
    }
  }

  await job.updateProgress(50)

  // 3. Gera CSV
  const csvContent = linhas.map(linhaParaCSV).join('\n')
  const csvBuffer = Buffer.from(csvContent, 'utf-8')

  await job.log(`[RelatorioJob] CSV gerado — ${linhas.length - 1} linhas de dados`)

  // 4. Faz upload para S3
  const s3Key = `${tenantId}/relatorios/${competencia}/consolidado.csv`
  const uploadResult = await storage.upload(s3Key, csvBuffer, 'text/csv;charset=utf-8', {
    tenantId,
    competencia,
    empresasCount: String(empresas.length),
  })

  await job.log(`[RelatorioJob] CSV enviado para S3 — key=${s3Key}`)
  await job.updateProgress(70)

  // 5. Gera URL assinada com validade de 7 dias
  const SETE_DIAS_EM_SEGUNDOS = 7 * 24 * 60 * 60
  const signedUrl = await storage.getSignedUrl(uploadResult.s3Key, SETE_DIAS_EM_SEGUNDOS)

  await job.log(`[RelatorioJob] URL assinada gerada (válida por 7 dias)`)
  await job.updateProgress(80)

  // 6. Cria alerta no DB com o link para download
  // Busca a primeira empresa para associar o alerta (alerta de tenant — usamos primeira empresa ativa)
  const primeiraEmpresa = empresas[0]
  if (primeiraEmpresa) {
    await db.alerta.create({
      data: {
        tenantId,
        empresaId: primeiraEmpresa.id,
        tipo: 'PGDAS_PENDENTE',   // tipo genérico de notificação disponível no enum
        mensagem: `Relatório consolidado de ${competencia} disponível para download.`,
        dados: {
          competencia,
          s3Key,
          downloadUrl: signedUrl,
          empresasCount: empresas.length,
          geradoEm: new Date().toISOString(),
        },
        lido: false,
      },
    })

    await job.log(`[RelatorioJob] Alerta criado no banco de dados`)
  }

  await job.updateProgress(90)

  // 7. Notifica via NotificationService
  await notificacao.notificarTenant(tenantId, 'FECHAMENTO_CONCLUIDO', {
    empresa: `Consolidado (${empresas.length} empresas)`,
    competencia,
    downloadUrl: signedUrl,
    tipo: 'RELATORIO_CONSOLIDADO',
  })

  await job.updateProgress(100)
  await job.log(
    `[RelatorioJob] Concluído — tenant=${tenantId} competencia=${competencia} ` +
      `empresas=${empresas.length} s3Key=${s3Key}`,
  )
}
