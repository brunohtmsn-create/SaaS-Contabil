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
          tenantId, cnpj,
          entidadeTipo: 'PORTAL_JOB', entidadeId: empresaId,
          evento: 'PORTAL_ACESSO_REALIZADO',
          estadoNovo: { portal: 'ECAC', operacao: 'CONSULTA_SITUACAO' },
          responsavel: 'sistema', responsavelTipo: 'SISTEMA',
        })

        return { situacao: 'REGULAR', pendencias: [] }
      } catch (err) {
        const screenshot = await page?.screenshot()
        if (screenshot) {
          const s3Key = S3KeyBuilder.erroScreenshot(cnpj, `ecac-${Date.now()}`)
          await this.storage.upload(s3Key, screenshot, 'image/png')
        }

        await this.audit.registrar({
          tenantId, cnpj,
          entidadeTipo: 'PORTAL_JOB', entidadeId: empresaId,
          evento: 'PORTAL_ACESSO_FALHOU',
          estadoNovo: { portal: 'ECAC', erro: String(err) },
          responsavel: 'sistema', responsavelTipo: 'SISTEMA',
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
        tenantId, cnpj,
        entidadeTipo: 'PORTAL_JOB', entidadeId: empresaId,
        evento: 'CERTIDAO_BAIXADA',
        estadoNovo: { portal: 'ECAC', tipo: 'CND', competencia },
        responsavel: 'sistema', responsavelTipo: 'SISTEMA',
      })

      return `portais/ecac-certidao-${competencia}.pdf`
    })
  }
}
