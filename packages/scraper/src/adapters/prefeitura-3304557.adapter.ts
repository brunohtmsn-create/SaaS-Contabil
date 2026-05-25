/**
 * Adapter — Prefeitura do Rio de Janeiro (IBGE 3304557)
 * Portal: NFS-e Rio / Nota Carioca — https://notacarioca.rio.gov.br
 *
 * Fluxo:
 *   1. authenticate()   → login/senha via formulário web (ou certificado A1/A3)
 *   2. fetchEmitidas()  → /nfse/emitidas — consulta por competência (prestador)
 *   3. fetchTomadas()   → /nfse/tomadas  — consulta por competência (tomador)
 *   4. downloadXML()    → link de download XML individual por número
 *   5. downloadPDF()    → link de download DANFSE individual por número
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

const BASE_URL = 'https://notacarioca.rio.gov.br'

// Seletores do portal Nota Carioca (aproximações — ajustar conforme HTML real)
const SEL = {
  // Login
  LOGIN_INPUT: '#txtLogin, input[name="login"], input[id*="Login"]',
  SENHA_INPUT: '#txtSenha, input[type="password"], input[id*="Senha"]',
  BTN_ENTRAR: '#btnEntrar, button[type="submit"], input[type="submit"]',
  MSG_ERRO_LOGIN: '.mensagemErro, #lblMensagem, .alert-danger, #spanErro',

  // Formulário de consulta — emitidas e tomadas compartilham o mesmo layout
  DATA_INICIO: '#txtDataInicio, input[id*="DataInicio"], input[name*="dataInicio"]',
  DATA_FIM: '#txtDataFim, input[id*="DataFim"], input[name*="dataFim"]',
  CNPJ_INPUT: '#txtCNPJ, input[id*="Cnpj"], input[name*="cnpj"]',
  BTN_CONSULTAR: '#btnConsultar, button[id*="Consultar"], input[value="Consultar"]',

  // Tabela de resultados
  GRID_ROWS:
    'table.gridNFSe tbody tr, table[id*="gridNotas"] tr.gridRow, table[id*="Grid"] tbody tr',
  BTN_XML: 'a[title*="XML"], a[href*="xml"], a[onclick*="xml"]',
  BTN_PDF: 'a[title*="PDF"], a[href*="pdf"], a[href*="danfse"], a[title*="Imprimir"]',

  // Paginação
  BTN_PROXIMA: 'a[title="Próxima página"], a[title="Próxima"], a.paginacaoProxima',

  // CAPTCHA
  CAPTCHA_FRAME: 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
} as const

export class Prefeitura3304557Adapter extends BasePLaywrightAdapter implements PrefeituraAdapter {
  tipo = 'NFSE_EMITIDA'
  fonte = 'PREFEITURA_RJ'
  municipio = 'Rio de Janeiro'
  ibge = '3304557'

  private session: Session | null = null
  private storage = new StorageService()

  // ─────────────────────────────────────────────────────────────────────────
  // Autenticação
  // ─────────────────────────────────────────────────────────────────────────

  async authenticate(cred: Credential): Promise<Session> {
    const credData = JSON.parse(cred.data.toString('utf8')) as {
      login: string
      senha: string
      /** Certificado A1 em base64 (opcional) */
      certificadoBase64?: string
      certificadoSenha?: string
    }

    return this.withRetry(async () => {
      const session = await this.withPage(async (page) => {
        await page.goto(`${BASE_URL}/cgife/usuario/login.aspx`, {
          waitUntil: 'networkidle',
          timeout: 60_000,
        })

        // Verificar CAPTCHA antes de interagir com o formulário
        const hasCaptcha = await page.isVisible(SEL.CAPTCHA_FRAME)
        if (hasCaptcha) {
          const token = await this.solveCaptcha(page)
          await this.preencherCaptcha(page, token)
        }

        // Preencher credenciais
        await page.fill(SEL.LOGIN_INPUT, credData.login)
        await page.fill(SEL.SENHA_INPUT, credData.senha)
        await page.click(SEL.BTN_ENTRAR)

        await page.waitForLoadState('networkidle', { timeout: 30_000 })

        // Verificar erro de autenticação
        const loginError = await page.isVisible(SEL.MSG_ERRO_LOGIN)
        if (loginError) {
          const msg = await page.textContent(SEL.MSG_ERRO_LOGIN)
          await this.captureAndThrow(
            page,
            credData.login,
            'rj-prefeitura-login',
            `Falha de autenticação RJ: ${msg?.trim() ?? 'erro desconhecido'}`
          )
        }

        // Verificar se ainda está na página de login (outra forma de detectar falha)
        const stillOnLogin = page.url().includes('login')
        if (stillOnLogin) {
          await this.captureAndThrow(
            page,
            credData.login,
            'rj-prefeitura-login-redirect',
            'Falha de autenticação RJ: redirecionamento para login após submit'
          )
        }

        // Coletar cookies da sessão
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

        await page.goto(`${BASE_URL}/cgife/nfse/prestador/consultarnfse.aspx`, {
          waitUntil: 'networkidle',
          timeout: 60_000,
        })

        await this.preencherFiltroConsulta(page, cnpj, periodo, 'rj-emitidas')

        return this.coletarPaginas(page, 'NFSE_EMITIDA', cnpj, 'rj-emitidas')
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

        await page.goto(`${BASE_URL}/cgife/nfse/tomador/consultarnfse.aspx`, {
          waitUntil: 'networkidle',
          timeout: 60_000,
        })

        await this.preencherFiltroConsulta(page, cnpj, periodo, 'rj-tomadas')

        return this.coletarPaginas(page, 'NFSE_TOMADA', cnpj, 'rj-tomadas')
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

        // URL de download direto do XML no portal Nota Carioca
        const url =
          `${BASE_URL}/cgife/nfse/prestador/downloadxml.aspx` +
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
          await this.captureAndThrow(
            page,
            doc.cnpjEmitente,
            `rj-xml-${doc.numero}`,
            `Falha download XML RJ nota ${doc.numero}: ${(err as Error).message}`
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
          `${BASE_URL}/cgife/nfse/prestador/danfse.aspx` +
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
          await this.captureAndThrow(
            page,
            doc.cnpjEmitente,
            `rj-pdf-${doc.numero}`,
            `Falha download PDF RJ nota ${doc.numero}: ${(err as Error).message}`
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
        const res = await page.goto(`${BASE_URL}/cgife/usuario/login.aspx`, {
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
      await this.captureAndThrow(
        page,
        cnpj,
        `rj-sem-sessao-${contexto}`,
        'Prefeitura RJ: sessão não inicializada — chame authenticate() primeiro'
      )
    }
    if (this.session!.expiresAt < nowBR()) {
      await this.captureAndThrow(
        page,
        cnpj,
        `rj-sessao-expirada-${contexto}`,
        'Prefeitura RJ: sessão expirada — reautentique'
      )
    }
  }

  /**
   * Preenche os campos de CNPJ, data inicial/final e dispara a consulta.
   * Tira screenshot e lança erro se o formulário não for localizado.
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
      await this.captureAndThrow(
        page,
        cnpj,
        `rj-filtro-${contexto}`,
        `Prefeitura RJ: formulário de consulta não encontrado (${contexto})`
      )
    }

    // CNPJ pode já estar preenchido se o portal vincula ao login
    const cnpjInput = page.locator(SEL.CNPJ_INPUT)
    const hasCnpjInput = await cnpjInput.isVisible().catch(() => false)
    if (hasCnpjInput) {
      await cnpjInput.fill(cnpj.replace(/\D/g, ''))
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
          const s3Key = S3KeyBuilder.erroScreenshot(cnpj, `rj-paginacao-${contexto}`)
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
   * Extrai os dados de uma linha da grade de resultados.
   * O layout esperado (colunas):
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

  /**
   * Tira screenshot, faz upload ao S3 e lança erro.
   * Garante regra: screenshot obrigatório antes de throw.
   */
  private async captureAndThrow(
    page: Page,
    cnpj: string,
    jobId: string,
    mensagem: string
  ): Promise<never> {
    try {
      const screenshot = await page.screenshot({ fullPage: true })
      const s3Key = S3KeyBuilder.erroScreenshot(cnpj, jobId)
      await this.storage.upload(s3Key, screenshot, 'image/png')
    } catch {
      // não mascarar o erro original
    }
    throw new Error(mensagem)
  }
}
