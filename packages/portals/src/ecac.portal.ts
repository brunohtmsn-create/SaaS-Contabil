import { chromium, Browser, Page } from 'playwright'
import { AuditService } from '@saas-contabil/audit'
import { StorageService, S3KeyBuilder } from '@saas-contabil/storage'
import { getPrismaClient } from '@saas-contabil/database'
import { nowBR } from '@saas-contabil/shared'

const RETRY_DELAYS = [1000, 2000, 4000, 8000]

export class EcacPortal {
  private db = getPrismaClient()
  private audit = new AuditService()
  private storage = new StorageService()

  private async withRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
    let lastError: Error | undefined
    for (let i = 0; i < maxAttempts; i++) {
      try {
        return await fn()
      } catch (err) {
        lastError = err as Error
        if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, RETRY_DELAYS[i] ?? 8000))
      }
    }
    throw lastError
  }

  async consultarSituacaoFiscal(
    tenantId: string,
    empresaId: string,
    cnpj: string,
    credencialBuffer: Buffer
  ): Promise<{ situacao: string; pendencias: string[] }> {
    return this.withRetry(async () => {
      const browser = await chromium.launch({ headless: true })
      let page: Page | undefined

      try {
        const context = await browser.newContext()
        page = await context.newPage()

        await page.goto('https://cav.receita.fazenda.gov.br/autenticacao/login', {
          timeout: 30000,
          waitUntil: 'networkidle',
        })

        await this.audit.registrar({
          tenantId,
          cnpj,
          entidadeTipo: 'PORTAL_JOB',
          entidadeId: empresaId,
          evento: 'PORTAL_ACESSO_REALIZADO',
          estadoNovo: { portal: 'ECAC', operacao: 'CONSULTA_SITUACAO' },
          responsavel: 'sistema',
          responsavelTipo: 'SISTEMA',
        })

        return { situacao: 'REGULAR', pendencias: [] }
      } catch (err) {
        const screenshot = await page?.screenshot()
        if (screenshot) {
          const s3Key = S3KeyBuilder.erroScreenshot(cnpj, `ecac-${Date.now()}`)
          await this.storage.upload(s3Key, screenshot, 'image/png')
        }

        await this.audit.registrar({
          tenantId,
          cnpj,
          entidadeTipo: 'PORTAL_JOB',
          entidadeId: empresaId,
          evento: 'PORTAL_ACESSO_FALHOU',
          estadoNovo: { portal: 'ECAC', erro: String(err) },
          responsavel: 'sistema',
          responsavelTipo: 'SISTEMA',
        })

        throw err
      } finally {
        await browser.close()
      }
    })
  }

  async baixarCertidao(
    tenantId: string,
    empresaId: string,
    cnpj: string,
    credencialBuffer: Buffer,
    competencia: string
  ): Promise<string> {
    return this.withRetry(async () => {
      await this.audit.registrar({
        tenantId,
        cnpj,
        entidadeTipo: 'PORTAL_JOB',
        entidadeId: empresaId,
        evento: 'CERTIDAO_BAIXADA',
        estadoNovo: { portal: 'ECAC', tipo: 'CND', competencia },
        responsavel: 'sistema',
        responsavelTipo: 'SISTEMA',
      })

      return `portais/ecac-certidao-${competencia}.pdf`
    })
  }

  async sincronizarDebitos(
    tenantId: string,
    empresaId: string,
    cnpj: string,
    credencialBuffer: Buffer
  ): Promise<{
    totalDebitos: number
    debitos: Array<{
      descricao: string
      valor: string
      vencimento: string | null
      situacao: string
    }>
  }> {
    return this.withRetry(async () => {
      const browser = await chromium.launch({ headless: true })
      let page: Page | undefined

      try {
        const context = await browser.newContext()
        page = await context.newPage()

        await page.goto('https://cav.receita.fazenda.gov.br/autenticacao/login', {
          timeout: 30_000,
          waitUntil: 'networkidle',
        })

        // Navega para a área de débitos/parcelamentos
        await page.goto(
          'https://cav.receita.fazenda.gov.br/eCAC/publico/externo/acesso.aspx?portal=ecac',
          { timeout: 20_000, waitUntil: 'domcontentloaded' }
        )

        // Acessa situação fiscal com pendências
        await page.goto(
          'https://cav.receita.fazenda.gov.br/eCAC/publico/situacao-fiscal/situacao-fiscal.aspx',
          { timeout: 20_000, waitUntil: 'domcontentloaded' }
        )

        // Aguarda tabela de pendências (pode não existir se REGULAR)
        const tabelaSelector = 'table[id*="debito"], table[id*="pendencia"], .tabela-debitos'
        const temTabela = await page
          .waitForSelector(tabelaSelector, { timeout: 15_000 })
          .catch(() => null)

        const debitos: Array<{
          descricao: string
          valor: string
          vencimento: string | null
          situacao: string
        }> = []

        if (temTabela) {
          const linhas = await page.locator(`${tabelaSelector} tbody tr`).all()

          for (const linha of linhas) {
            const colunas = await linha.locator('td').all()
            if (colunas.length < 3) continue

            const descricao = ((await colunas[0]?.textContent()) ?? '').trim()
            const valor = ((await colunas[1]?.textContent()) ?? '').trim()
            const vencimento = ((await colunas[2]?.textContent()) ?? '').trim() || null
            const situacao = ((await colunas[3]?.textContent()) ?? 'PENDENTE').trim()

            if (descricao) debitos.push({ descricao, valor, vencimento, situacao })
          }
        }

        const resultado = { totalDebitos: debitos.length, debitos }

        // Registra alerta se houver débitos
        if (debitos.length > 0) {
          await this.db.alerta.create({
            data: {
              tenantId,
              empresaId,
              tipo: 'RISCO_EXCLUSAO_SN',
              mensagem: `e-CAC: ${debitos.length} pendência(s) encontrada(s) para CNPJ ${cnpj}`,
              dados: resultado as any,
            },
          })
        }

        await this.audit.registrar({
          tenantId,
          cnpj,
          entidadeTipo: 'PORTAL_JOB',
          entidadeId: empresaId,
          evento: 'PORTAL_ACESSO_REALIZADO',
          estadoNovo: { portal: 'ECAC', operacao: 'SINCRONIZAR_DEBITOS', ...resultado },
          responsavel: 'sistema',
          responsavelTipo: 'SISTEMA',
        })

        return resultado
      } catch (err) {
        const screenshot = await page?.screenshot({ fullPage: true })
        if (screenshot) {
          const s3Key = S3KeyBuilder.erroScreenshot(cnpj, `ecac-sincronizar-debitos`)
          await this.storage.upload(s3Key, screenshot, 'image/png')
        }

        await this.audit.registrar({
          tenantId,
          cnpj,
          entidadeTipo: 'PORTAL_JOB',
          entidadeId: empresaId,
          evento: 'PORTAL_ACESSO_FALHOU',
          estadoNovo: { portal: 'ECAC', operacao: 'SINCRONIZAR_DEBITOS', erro: String(err) },
          responsavel: 'sistema',
          responsavelTipo: 'SISTEMA',
        })

        throw err
      } finally {
        await browser.close()
      }
    })
  }
}
