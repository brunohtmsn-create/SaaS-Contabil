/**
 * Adapter — Prefeitura de Várzea Grande (IBGE 5108402)
 * Portal: NFS-e Várzea Grande — https://nfse.varzea-grande.mt.gov.br
 */

import { Page, Locator } from 'playwright'
import { BasePLaywrightAdapter } from './base-playwright.adapter.js'
import {
  PrefeituraAdapter,
  Session,
  Credential,
  DocumentoRaw,
  Periodo,
} from '../interfaces/base.js'
import { Decimal, formatDate, nowBR } from '@saas-contabil/shared'
import { S3KeyBuilder } from '@saas-contabil/storage'

const BASE_URL = 'https://nfse.varzea-grande.mt.gov.br'
const TAG = 'prefeitura_varzea_grande'

const SEL = {
  LOGIN_INPUT:
    '#txtLogin, input[name="login"], input[id*="Login"], input[name*="usuario"], input[id*="usuario"]',
  SENHA_INPUT: 'input[type="password"]',
  BTN_ENTRAR: 'button[type="submit"], input[type="submit"], #btnEntrar, #btnAcessar',
  MSG_ERRO_LOGIN: '.mensagemErro, .alert-danger, #lblMensagem, .erro, .ui-messages-error',
  CNPJ_INPUT: '#txtCNPJ, input[id*="Cnpj"], input[name*="cnpj"], input[id*="cnpj"]',
  DATA_INICIO:
    'input[id*="DataInicio"], input[name*="dataInicio"], input[id*="dtInicio"], input[id*="Inicio"]',
  DATA_FIM: 'input[id*="DataFim"], input[name*="dataFim"], input[id*="dtFim"], input[id*="Fim"]',
  BTN_CONSULTAR:
    '#btnConsultar, button[id*="Consultar"], input[value="Consultar"], input[value="Pesquisar"]',
  GRID_ROWS: 'table tbody tr, .gridRow, tr[class*="row"], table.rich-table tbody tr',
  BTN_XML: 'a[href*="xml"], a[title*="XML"], a[onclick*="xml"]',
  BTN_PDF: 'a[href*="pdf"], a[title*="PDF"], a[title*="Imprimir"], a[href*="danfse"]',
  BTN_PROXIMA: 'a[title="Próxima"], a[title="Próxima página"], .btnProxima, a[title="next"]',
  CAPTCHA_FRAME: 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
} as const

export class Prefeitura5108402Adapter extends BasePLaywrightAdapter implements PrefeituraAdapter {
  tipo = 'NFSE_EMITIDA'
  fonte = 'PREFEITURA_VARZEA_GRANDE'
  municipio = 'Várzea Grande'
  ibge = '5108402'

  protected session: Session | null = null

  async authenticate(cred: Credential): Promise<Session> {
    const credData = JSON.parse(cred.data.toString('utf8')) as { login: string; senha: string }

    return this.withRetry(async () => {
      const session = await this.withPage(async (page) => {
        await page.goto(`${BASE_URL}/nfse/login.jsf`, { waitUntil: 'networkidle', timeout: 60_000 })

        const hasCaptcha = await page.isVisible(SEL.CAPTCHA_FRAME)
        if (hasCaptcha) {
          const token = await this.solveCaptcha(page)
          await this.preencherCaptcha(page, token)
        }

        try {
          await page.waitForSelector(SEL.LOGIN_INPUT, { timeout: 15_000 })
        } catch {
          return this.captureAndThrow(
            page,
            credData.login,
            `${TAG}-login-form`,
            `Prefeitura Várzea Grande: formulário de login não encontrado`
          )
        }

        await page.fill(SEL.LOGIN_INPUT, credData.login)
        await page.fill(SEL.SENHA_INPUT, credData.senha)
        await page.click(SEL.BTN_ENTRAR)
        await page.waitForLoadState('networkidle', { timeout: 30_000 })

        if (await page.isVisible(SEL.MSG_ERRO_LOGIN)) {
          const msg = await page.textContent(SEL.MSG_ERRO_LOGIN)
          return this.captureAndThrow(
            page,
            credData.login,
            `${TAG}-login-erro`,
            `Prefeitura Várzea Grande: falha de autenticação — ${msg?.trim() ?? 'erro desconhecido'}`
          )
        }

        if (page.url().toLowerCase().includes('login')) {
          return this.captureAndThrow(
            page,
            credData.login,
            `${TAG}-login-redirect`,
            `Prefeitura Várzea Grande: ainda na tela de login após submit`
          )
        }

        const cookies = await page.context().cookies()
        return {
          cookies: cookies.map((c) => `${c.name}=${c.value}`).join('; '),
          expiresAt: new Date(nowBR().getTime() + 4 * 60 * 60 * 1000),
        } satisfies Session
      })
      this.session = session
      return session
    })
  }

  async fetch(cnpj: string, periodo: Periodo): Promise<DocumentoRaw[]> {
    const [emitidas, tomadas] = await Promise.allSettled([
      this.fetchEmitidas(cnpj, periodo),
      this.fetchTomadas(cnpj, periodo),
    ])
    return [
      ...(emitidas.status === 'fulfilled' ? emitidas.value : []),
      ...(tomadas.status === 'fulfilled' ? tomadas.value : []),
    ]
  }

  async fetchEmitidas(cnpj: string, periodo: Periodo): Promise<DocumentoRaw[]> {
    return this.withRetry(() =>
      this.withPage(async (page) => {
        await this.garantirSessao(page, cnpj, 'emitidas')
        await page.goto(`${BASE_URL}/nfse/prestador/consultarNfse.jsf`, {
          waitUntil: 'networkidle',
          timeout: 60_000,
        })
        await this.preencherFiltro(page, cnpj, periodo, `${TAG}-emitidas`)
        return this.coletarPaginas(page, 'NFSE_EMITIDA', cnpj, `${TAG}-emitidas`)
      })
    )
  }

  async fetchTomadas(cnpj: string, periodo: Periodo): Promise<DocumentoRaw[]> {
    return this.withRetry(() =>
      this.withPage(async (page) => {
        await this.garantirSessao(page, cnpj, 'tomadas')
        await page.goto(`${BASE_URL}/nfse/tomador/consultarNfse.jsf`, {
          waitUntil: 'networkidle',
          timeout: 60_000,
        })
        await this.preencherFiltro(page, cnpj, periodo, `${TAG}-tomadas`)
        return this.coletarPaginas(page, 'NFSE_TOMADA', cnpj, `${TAG}-tomadas`)
      })
    )
  }

  async downloadXML(doc: DocumentoRaw): Promise<string> {
    if (doc.xmlContent) return doc.xmlContent
    return this.withRetry(() =>
      this.withPage(async (page) => {
        await this.garantirSessao(page, doc.cnpjEmitente, `xml-${doc.numero}`)
        const url = `${BASE_URL}/nfse/prestador/downloadXml.jsf?numero=${encodeURIComponent(doc.numero)}&cnpj=${doc.cnpjEmitente}`
        try {
          const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 60_000 }),
            page.goto(url, { waitUntil: 'commit', timeout: 30_000 }),
          ])
          const stream = await download.createReadStream()
          const chunks: Buffer[] = []
          for await (const chunk of stream)
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          return Buffer.concat(chunks).toString('utf8')
        } catch (err) {
          return this.captureAndThrow(
            page,
            doc.cnpjEmitente,
            `${TAG}-xml-${doc.numero}`,
            `Prefeitura Várzea Grande: falha download XML nota ${doc.numero} — ${(err as Error).message}`
          )
        }
      })
    )
  }

  async downloadPDF(doc: DocumentoRaw): Promise<Buffer> {
    if (doc.pdfBuffer) return doc.pdfBuffer
    return this.withRetry(() =>
      this.withPage(async (page) => {
        await this.garantirSessao(page, doc.cnpjEmitente, `pdf-${doc.numero}`)
        const url = `${BASE_URL}/nfse/prestador/imprimirDanfse.jsf?numero=${encodeURIComponent(doc.numero)}&cnpj=${doc.cnpjEmitente}`
        try {
          const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 60_000 }),
            page.goto(url, { waitUntil: 'commit', timeout: 30_000 }),
          ])
          const stream = await download.createReadStream()
          const chunks: Buffer[] = []
          for await (const chunk of stream)
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          return Buffer.concat(chunks)
        } catch (err) {
          return this.captureAndThrow(
            page,
            doc.cnpjEmitente,
            `${TAG}-pdf-${doc.numero}`,
            `Prefeitura Várzea Grande: falha download PDF nota ${doc.numero} — ${(err as Error).message}`
          )
        }
      })
    )
  }

  override async healthCheck(): Promise<boolean> {
    try {
      return await this.withPage(async (page) => {
        const res = await page.goto(`${BASE_URL}/nfse/login.jsf`, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        })
        return (res?.status() ?? 500) < 500
      })
    } catch {
      return false
    }
  }

  private async garantirSessao(page: Page, cnpj: string, ctx: string): Promise<void> {
    if (!this.session)
      return this.captureAndThrow(
        page,
        cnpj,
        `${TAG}-sem-sessao-${ctx}`,
        `Prefeitura Várzea Grande: sessão não inicializada — chame authenticate() primeiro`
      )
    if (this.session!.expiresAt < nowBR())
      return this.captureAndThrow(
        page,
        cnpj,
        `${TAG}-sessao-expirada-${ctx}`,
        `Prefeitura Várzea Grande: sessão expirada — reautentique`
      )
  }

  private async preencherFiltro(
    page: Page,
    cnpj: string,
    periodo: Periodo,
    ctx: string
  ): Promise<void> {
    try {
      await page.waitForSelector(SEL.DATA_INICIO, { timeout: 15_000 })
    } catch {
      return this.captureAndThrow(
        page,
        cnpj,
        `${TAG}-filtro-${ctx}`,
        `Prefeitura Várzea Grande: formulário de consulta não encontrado (${ctx})`
      )
    }
    const cnpjInput = page.locator(SEL.CNPJ_INPUT)
    if (await cnpjInput.isVisible().catch(() => false))
      await cnpjInput.fill(cnpj.replace(/\D/g, ''))
    await page.fill(SEL.DATA_INICIO, formatDate(periodo.inicio, 'dd/MM/yyyy'))
    await page.fill(SEL.DATA_FIM, formatDate(periodo.fim, 'dd/MM/yyyy'))
    await page.click(SEL.BTN_CONSULTAR)
    await page.waitForLoadState('networkidle', { timeout: 60_000 })
  }

  private async coletarPaginas(
    page: Page,
    tipo: string,
    cnpj: string,
    ctx: string
  ): Promise<DocumentoRaw[]> {
    const docs: DocumentoRaw[] = []
    let pg = 1
    do {
      for (const row of await page.locator(SEL.GRID_ROWS).all()) {
        try {
          const d = await this.parseRow(row, tipo, cnpj)
          if (d) docs.push(d)
        } catch {
          /* header */
        }
      }
      if (!(await page.isVisible(SEL.BTN_PROXIMA))) break
      try {
        await page.click(SEL.BTN_PROXIMA)
        await page.waitForLoadState('networkidle', { timeout: 30_000 })
      } catch {
        try {
          const ss = await page.screenshot({ fullPage: true })
          await this.storage.upload(
            S3KeyBuilder.erroScreenshot(cnpj, `${TAG}-paginacao-${ctx}`),
            ss,
            'image/png'
          )
        } catch {
          /* não mascarar erro */
        }
        break
      }
      pg++
    } while (pg <= 100)
    return docs
  }

  private async parseRow(
    row: Locator,
    tipo: string,
    cnpjPrincipal: string
  ): Promise<DocumentoRaw | null> {
    const cells = await row.locator('td').all()
    if (cells.length < 6) return null
    const numero = (await cells[0]!.textContent())?.trim() ?? ''
    const dataStr = (await cells[1]!.textContent())?.trim() ?? ''
    const nomeEmitente = (await cells[2]!.textContent())?.trim() ?? ''
    const cnpjEmitente = (await cells[3]!.textContent())?.trim().replace(/\D/g, '') ?? ''
    const cnpjTomador = (await cells[4]!.textContent())?.trim().replace(/\D/g, '') ?? ''
    const valorStr = (await cells[5]!.textContent())?.trim() ?? '0'
    if (!numero || !/^\d+$/.test(numero)) return null
    const [dia, mes, ano] = dataStr.split('/')
    const dataEmissao = new Date(Number(ano), Number(mes) - 1, Number(dia))
    if (isNaN(dataEmissao.getTime())) return null
    const valorNorm = valorStr
      .replace(/\./g, '')
      .replace(',', '.')
      .replace(/[^0-9.]/g, '')
    return {
      tipo,
      numero,
      dataEmissao,
      cnpjEmitente: tipo === 'NFSE_EMITIDA' ? cnpjPrincipal : cnpjEmitente,
      nomeEmitente,
      cnpjDestinatario: tipo === 'NFSE_TOMADA' ? cnpjPrincipal : cnpjTomador,
      valorTotal: new Decimal(valorNorm || '0'),
      municipioIBGE: this.ibge,
      fonte: this.fonte,
    }
  }
}
