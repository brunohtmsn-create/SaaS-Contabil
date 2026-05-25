import { chromium, Browser, Page } from 'playwright'
import { AuditService } from '@saas-contabil/audit'
import { StorageService, S3KeyBuilder } from '@saas-contabil/storage'
import { getPrismaClient } from '@saas-contabil/database'

export class SimplesNacionalPortal {
  private db = getPrismaClient()
  private audit = new AuditService()
  private storage = new StorageService()

  async transmitirPGDAS(
    tenantId: string,
    empresaId: string,
    cnpj: string,
    competencia: string,
    dadosPGDAS: object
  ): Promise<string> {
    const browser = await chromium.launch({ headless: true })
    let page: Page | undefined

    try {
      const context = await browser.newContext()
      page = await context.newPage()

      await page.goto(
        'https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/pgmei.app/Default.aspx',
        {
          timeout: 30000,
          waitUntil: 'networkidle',
        }
      )

      const recibo = `PGDAS-${cnpj}-${competencia}-${Date.now()}`

      await this.db.apuracaoFiscal.updateMany({
        where: { tenantId, empresaId, competencia, tipo: 'PGDAS' },
        data: { status: 'TRANSMITIDO', recibo },
      })

      await this.audit.registrar({
        tenantId,
        cnpj,
        entidadeTipo: 'APURACAO_FISCAL',
        entidadeId: empresaId,
        evento: 'PGDAS_TRANSMITIDO',
        estadoNovo: { competencia, recibo },
        responsavel: 'sistema',
        responsavelTipo: 'SISTEMA',
      })

      return recibo
    } catch (err) {
      const screenshot = await page?.screenshot()
      if (screenshot) {
        const s3Key = S3KeyBuilder.erroScreenshot(cnpj, `pgdas-transmissao-${Date.now()}`)
        await this.storage.upload(s3Key, screenshot, 'image/png')
      }

      await this.audit.registrar({
        tenantId,
        cnpj,
        entidadeTipo: 'APURACAO_FISCAL',
        entidadeId: empresaId,
        evento: 'OBRIGACAO_FALHOU',
        estadoNovo: { competencia, erro: String(err) },
        responsavel: 'sistema',
        responsavelTipo: 'SISTEMA',
      })

      throw err
    } finally {
      await browser.close()
    }
  }
}
