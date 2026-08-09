/**
 * BaseBethaAdapter — Classe base para portais Betha Sistemas / ISS.NET
 *
 * Usado por ~60% dos municípios do interior de SP e demais estados.
 * Formulário JSF com padrão de URL /nfse/pages/nf/listagem/listagemNf.xhtml
 *
 * Subclasses devem apenas chamar super({ baseUrl, municipio, ibge, fonte })
 * no constructor — toda a lógica de scraping fica aqui.
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
import { StorageService, S3KeyBuilder } from '@saas-contabil/storage'

// ─── Seletores do sistema Betha / ISS.NET ────────────────────────────────────

const SEL = {
  // Login — formulário JSF
  CNPJ_INPUT: '#j_id_form\\:cnpj, input[name*="cnpj"], input[id*="cnpj"]',
  SENHA_INPUT: 'input[type="password"]',
  BTN_SUBMIT: 'input[type="submit"], button[type="submit"]',
  MSG_ERRO_LOGIN: '.ui-messages-error, .mensagemErro, .rich-message-error, [id*="msgErro"]',

  // Filtros de consulta
  DATA_INICIO:
    'input[id*="dataInicio"], input[name*="dataInicio"], input[id*="dtInicio"], input[name*="dtInicio"]',
  DATA_FIM:
    'input[id*="dataFim"], input[name*="dataFim"], input[id*="dtFim"], input[name*="dtFim"]',
  BTN_CONSULTAR:
    'input[value="Pesquisar"], input[value="Consultar"], button[id*="pesquisar"], button[id*="consultar"], input[id*="pesquisar"]',

  // Tabela de resultados
  GRID_ROWS: 'table.rich-table tbody tr, table[class*="dataTable"] tbody tr, table tbody tr',

  // Links de download
  BTN_XML: 'a[href*="xml"], a[title*="XML"], a[onclick*="xml"]',
  BTN_PDF: 'a[href*="pdf"], a[title*="PDF"], a[href*="danfse"], a[title*="Imprimir"]',

  // Paginação
  BTN_PROXIMA:
    'a[title="Próxima página"], a[title="Próxima"], a[title="next"], span.rich-datascr-button:last-child a',

  // CAPTCHA
  CAPTCHA_FRAME: 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
} as const

// ─── Configuração do construtor ───────────────────────────────────────────────

export interface BethaAdapterConfig {
  baseUrl: string
  municipio: string
  ibge: string
  fonte: string
}

// ─── Classe base ──────────────────────────────────────────────────────────────

export abstract class BaseBethaAdapter extends BasePLaywrightAdapter implements PrefeituraAdapter {
  tipo = 'NFSE_EMITIDA'
  readonly fonte: string
  readonly municipio: string
  readonly ibge: string

  protected readonly baseUrl: string
  protected session: Session | null = null

  protected constructor(config: BethaAdapterConfig) {
    super()
    this.baseUrl = config.baseUrl
    this.municipio = config.municipio
    this.ibge = config.ibge
    this.fonte = config.fonte
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Autenticação
  // ─────────────────────────────────────────────────────────────────────────

  async authenticate(cred: Credential): Promise<Session> {
    const credData = JSON.parse(cred.data.toString('utf8')) as {
      cnpj: string
      senha: string
    }

    return this.withRetry(async () => {
      const session = await this.withPage(async (page) => {
        // Betha pode usar /nfse/ ou / como raiz de login
        const loginUrl = `${this.baseUrl}/nfse/`
        await page.goto(loginUrl, { waitUntil: 'networkidle', timeout: 60_000 })

        // Verifica CAPTCHA antes de interagir com o formulário
        const hasCaptcha = await page.isVisible(SEL.CAPTCHA_FRAME)
        if (hasCaptcha) {
          const token = await this.solveCaptcha(page)
          await this.preencherCaptcha(page, token)
        }

        // Preencher CNPJ / login
        try {
          await page.waitForSelector(SEL.CNPJ_INPUT, { timeout: 15_000 })
        } catch {
          return this.captureAndThrow(
            page,
            credData.cnpj,
            `${this.ibge}-login-form`,
            `Betha ${this.municipio}: formulário de login não encontrado em ${loginUrl}`
          )
        }

        await page.fill(SEL.CNPJ_INPUT, credData.cnpj.replace(/\D/g, ''))
        await page.fill(SEL.SENHA_INPUT, credData.senha)
        await page.click(SEL.BTN_SUBMIT)
        await page.waitForLoadState('networkidle', { timeout: 30_000 })

        // Verificar erro de autenticação
        const loginError = await page.isVisible(SEL.MSG_ERRO_LOGIN)
        if (loginError) {
          const msg = await page.textContent(SEL.MSG_ERRO_LOGIN)
          return this.captureAndThrow(
            page,
            credData.cnpj,
            `${this.ibge}-login-erro`,
            `Betha ${this.municipio}: falha de autenticação — ${msg?.trim() ?? 'erro desconhecido'}`
          )
        }

        // Portal ainda na tela de login = falha silenciosa
        const stillOnLogin = page.url().includes('login') || page.url().includes('Login')
        if (stillOnLogin) {
          return this.captureAndThrow(
            page,
            credData.cnpj,
            `${this.ibge}-login-redirect`,
            `Betha ${this.municipio}: redirecionamento para login após submit — credenciais inválidas?`
          )
        }

        const cookies = await page.context().cookies()
        const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ')

        return {
          cookies: cookieStr,
          expiresAt: new Date(nowBR().getTime() + 4 * 60 * 60 * 1000), // 4 h
        } satisfies Session
      })

      this.session = session
      return session
    })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // fetch() unificado (emitidas + tomadas)
  // ─────────────────────────────────────────────────────────────────────────

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

  // ─────────────────────────────────────────────────────────────────────────
  // Notas emitidas (prestador)
  // ─────────────────────────────────────────────────────────────────────────

  async fetchEmitidas(cnpj: string, periodo: Periodo): Promise<DocumentoRaw[]> {
    return this.withRetry(() =>
      this.withPage(async (page) => {
        await this.garantirSessao(page, cnpj, 'emitidas')

        const url = `${this.baseUrl}/nfse/pages/nf/listagem/listagemNf.xhtml`
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 })

        await this.preencherFiltroConsulta(page, cnpj, periodo, `${this.ibge}-emitidas`)

        return this.coletarPaginas(page, 'NFSE_EMITIDA', cnpj, `${this.ibge}-emitidas`)
      })
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Notas tomadas (tomador)
  // ─────────────────────────────────────────────────────────────────────────

  async fetchTomadas(cnpj: string, periodo: Periodo): Promise<DocumentoRaw[]> {
    return this.withRetry(() =>
      this.withPage(async (page) => {
        await this.garantirSessao(page, cnpj, 'tomadas')

        const url = `${this.baseUrl}/nfse/pages/nf/listagem/listagemNfTomadas.xhtml`
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 })

        await this.preencherFiltroConsulta(page, cnpj, periodo, `${this.ibge}-tomadas`)

        return this.coletarPaginas(page, 'NFSE_TOMADA', cnpj, `${this.ibge}-tomadas`)
      })
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Download XML
  // ─────────────────────────────────────────────────────────────────────────

  async downloadXML(doc: DocumentoRaw): Promise<string> {
    if (doc.xmlContent) return doc.xmlContent

    return this.withRetry(() =>
      this.withPage(async (page) => {
        await this.garantirSessao(page, doc.cnpjEmitente, `xml-${doc.numero}`)

        const url =
          `${this.baseUrl}/nfse/pages/nf/nf.xhtml` +
          `?numero=${encodeURIComponent(doc.numero)}&cnpj=${doc.cnpjEmitente}`

        try {
          const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 60_000 }),
            page.goto(url, { waitUntil: 'commit', timeout: 30_000 }),
          ])

          const stream = await download.createReadStream()
          const chunks: Buffer[] = []
          for await (const chunk of stream) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          }

          return Buffer.concat(chunks).toString('utf8')
        } catch (err) {
          return this.captureAndThrow(
            page,
            doc.cnpjEmitente,
            `${this.ibge}-xml-${doc.numero}`,
            `Betha ${this.municipio}: falha download XML nota ${doc.numero} — ${(err as Error).message}`
          )
        }
      })
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Download PDF
  // ─────────────────────────────────────────────────────────────────────────

  async downloadPDF(doc: DocumentoRaw): Promise<Buffer> {
    if (doc.pdfBuffer) return doc.pdfBuffer

    return this.withRetry(() =>
      this.withPage(async (page) => {
        await this.garantirSessao(page, doc.cnpjEmitente, `pdf-${doc.numero}`)

        const url =
          `${this.baseUrl}/nfse/pages/nf/imprimirNf.xhtml` +
          `?numero=${encodeURIComponent(doc.numero)}&cnpj=${doc.cnpjEmitente}`

        try {
          const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 60_000 }),
            page.goto(url, { waitUntil: 'commit', timeout: 30_000 }),
          ])

          const stream = await download.createReadStream()
          const chunks: Buffer[] = []
          for await (const chunk of stream) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          }

          return Buffer.concat(chunks)
        } catch (err) {
          return this.captureAndThrow(
            page,
            doc.cnpjEmitente,
            `${this.ibge}-pdf-${doc.numero}`,
            `Betha ${this.municipio}: falha download PDF nota ${doc.numero} — ${(err as Error).message}`
          )
        }
      })
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Health check
  // ─────────────────────────────────────────────────────────────────────────

  override async healthCheck(): Promise<boolean> {
    try {
      return await this.withPage(async (page) => {
        const res = await page.goto(`${this.baseUrl}/nfse/`, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        })
        return (res?.status() ?? 500) < 500
      })
    } catch {
      return false
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers privados
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Valida que a sessão existe e não está expirada.
   * Lança erro com screenshot se não houver sessão válida.
   */
  private async garantirSessao(page: Page, cnpj: string, contexto: string): Promise<void> {
    if (!this.session) {
      return this.captureAndThrow(
        page,
        cnpj,
        `${this.ibge}-sem-sessao-${contexto}`,
        `Betha ${this.municipio}: sessão não inicializada — chame authenticate() primeiro`
      )
    }
    if (this.session!.expiresAt < nowBR()) {
      return this.captureAndThrow(
        page,
        cnpj,
        `${this.ibge}-sessao-expirada-${contexto}`,
        `Betha ${this.municipio}: sessão expirada — reautentique`
      )
    }
  }

  /**
   * Preenche os campos de data inicial/final e dispara a consulta.
   * Faz screenshot e lança erro se o formulário não for localizado.
   */
  private async preencherFiltroConsulta(
    page: Page,
    cnpj: string,
    periodo: Periodo,
    contexto: string
  ): Promise<void> {
    try {
      await page.waitForSelector(SEL.DATA_INICIO, { timeout: 15_000 })
    } catch {
      return this.captureAndThrow(
        page,
        cnpj,
        `${this.ibge}-filtro-${contexto}`,
        `Betha ${this.municipio}: formulário de consulta não encontrado (${contexto})`
      )
    }

    await page.fill(SEL.DATA_INICIO, formatDate(periodo.inicio, 'dd/MM/yyyy'))
    await page.fill(SEL.DATA_FIM, formatDate(periodo.fim, 'dd/MM/yyyy'))
    await page.click(SEL.BTN_CONSULTAR)
    await page.waitForLoadState('networkidle', { timeout: 60_000 })
  }

  /**
   * Percorre todas as páginas de resultado e coleta os documentos.
   * Limite de 100 páginas por segurança (empresas com grande volume).
   */
  private async coletarPaginas(
    page: Page,
    tipo: string,
    cnpj: string,
    contexto: string
  ): Promise<DocumentoRaw[]> {
    const docs: DocumentoRaw[] = []
    let paginaAtual = 1

    do {
      const rows = await page.locator(SEL.GRID_ROWS).all()

      for (const row of rows) {
        try {
          const doc = await this.parseRow(row, tipo, cnpj)
          if (doc) docs.push(doc)
        } catch {
          // linha de cabeçalho ou inválida — ignorar
        }
      }

      const temProxima = await page.isVisible(SEL.BTN_PROXIMA)
      if (!temProxima) break

      try {
        await page.click(SEL.BTN_PROXIMA)
        await page.waitForLoadState('networkidle', { timeout: 30_000 })
      } catch (err) {
        // Falha ao avançar página — screenshot e interrompe iteração
        try {
          const screenshot = await page.screenshot({ fullPage: true })
          const s3Key = S3KeyBuilder.erroScreenshot(cnpj, `${this.ibge}-paginacao-${contexto}`)
          await this.storage.upload(s3Key, screenshot, 'image/png')
        } catch {
          // não mascarar o erro original
        }
        break
      }

      paginaAtual++
    } while (paginaAtual <= 100)

    return docs
  }

  /**
   * Extrai os dados de uma linha da grade de resultados Betha.
   * Layout esperado (colunas):
   *   0: Número NFS-e
   *   1: Data de emissão (dd/MM/yyyy)
   *   2: Nome do prestador/tomador
   *   3: CNPJ do prestador
   *   4: CNPJ do tomador
   *   5: Valor total
   */
  private async parseRow(
    row: Locator,
    tipo: string,
    cnpjPrincipal: string
  ): Promise<DocumentoRaw | null> {
    const cells = await row.locator('td').all()
    if (cells.length < 6) return null

    const numero = (await cells[0]!.textContent())?.trim() ?? ''
    const dataEmissaoStr = (await cells[1]!.textContent())?.trim() ?? ''
    const nomeEmitente = (await cells[2]!.textContent())?.trim() ?? ''
    const cnpjEmitente = (await cells[3]!.textContent())?.trim().replace(/\D/g, '') ?? ''
    const cnpjTomador = (await cells[4]!.textContent())?.trim().replace(/\D/g, '') ?? ''
    const valorStr = (await cells[5]!.textContent())?.trim() ?? '0'

    if (!numero || !/^\d+$/.test(numero)) return null

    // Converter data dd/MM/yyyy
    const [dia, mes, ano] = dataEmissaoStr.split('/')
    const dataEmissao = new Date(Number(ano), Number(mes) - 1, Number(dia))

    if (isNaN(dataEmissao.getTime())) return null

    // Normalizar valor monetário: "1.234,56" → "1234.56"
    const valorNormalizado = valorStr
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
      valorTotal: new Decimal(valorNormalizado || '0'),
      municipioIBGE: this.ibge,
      fonte: this.fonte,
    }
  }
}
