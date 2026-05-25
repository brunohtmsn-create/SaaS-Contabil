/**
 * Adapter — Prefeitura de Belo Horizonte (IBGE 3106200)
 * Portal: BHISS Digital — https://bhiss.pbh.gov.br
 *
 * Fluxo:
 *   1. authenticate()   → login/senha via formulário web
 *   2. fetchEmitidas()  → consulta NFS-e emitidas pelo prestador
 *   3. fetchTomadas()   → consulta NFS-e recebidas pelo tomador
 *   4. downloadXML()    → download do XML da nota selecionada
 *   5. downloadPDF()    → download do DANFSE da nota selecionada
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

const BASE_URL = 'https://bhiss.pbh.gov.br'

// Seletores do portal BHISS Digital (aproximações — ajustar conforme HTML real)
const SEL = {
  // Login
  LOGIN_INPUT: '#username, #txtCpfCnpj, input[name="username"], input[id*="Login"]',
  SENHA_INPUT: '#password, #txtSenha, input[type="password"]',
  BTN_ENTRAR: '#btnLogin, button[type="submit"], input[type="submit"], button[id*="Entrar"]',
  MSG_ERRO_LOGIN: '.error-message, .alert-danger, #mensagemErro, span[class*="error"]',

  // Formulário de consulta
  DATA_INICIO:
    '#dtInicial, input[id*="DtInicial"], input[name*="dtInicial"], input[id*="DataInicio"]',
  DATA_FIM: '#dtFinal, input[id*="DtFinal"], input[name*="dtFinal"], input[id*="DataFim"]',
  CNPJ_INPUT: '#cnpj, input[id*="Cnpj"], input[name*="cnpj"]',
  COMPETENCIA_INPUT: '#competencia, input[id*="Competencia"], select[id*="Competencia"]',
  BTN_PESQUISAR:
    '#btnPesquisar, button[id*="Pesquisar"], input[value="Pesquisar"], button[id*="Buscar"]',

  // Tabela de resultados
  GRID_ROWS:
    'table.tabelaNfse tbody tr, table[id*="grid"] tbody tr, table[id*="Grid"] tbody tr, .gridContainer tbody tr',
  BTN_XML: 'a[title*="XML"], a[href*="xml"], img[alt*="XML"]',
  BTN_PDF: 'a[title*="PDF"], a[href*="pdf"], a[title*="Imprimir"], img[alt*="PDF"]',
  LINK_DETALHE: 'a[id*="lnkNota"], a[id*="lnkDetalhe"], a[href*="detalhe"]',

  // Paginação
  BTN_PROXIMA: 'a[title="Próxima página"], a[title="Próxima"], a[id*="Proxima"], .paginacaoProxima',

  // CAPTCHA
  CAPTCHA_FRAME: 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
  CAPTCHA_IMAGE: '#imgCaptcha, img[id*="captcha"], img[id*="Captcha"]',
  CAPTCHA_INPUT: '#txtCaptcha, input[id*="captcha"], input[id*="Captcha"]',
} as const

export class Prefeitura3106200Adapter extends BasePLaywrightAdapter implements PrefeituraAdapter {
  tipo = 'NFSE_EMITIDA'
  fonte = 'PREFEITURA_BH'
  municipio = 'Belo Horizonte'
  ibge = '3106200'

  private session: Session | null = null

  // ─────────────────────────────────────────────────────────────────────────
  // Autenticação
  // ─────────────────────────────────────────────────────────────────────────

  async authenticate(cred: Credential): Promise<Session> {
    const credData = JSON.parse(cred.data.toString('utf8')) as {
      login: string
      senha: string
    }

    return this.withRetry(async () => {
      const session = await this.withPage(async (page) => {
        await page.goto(`${BASE_URL}/bhissweb/login`, {
          waitUntil: 'networkidle',
          timeout: 60_000,
        })

        // Resolver CAPTCHA reCAPTCHA/hCaptcha, se presente
        const hasCaptchaFrame = await page.isVisible(SEL.CAPTCHA_FRAME)
        if (hasCaptchaFrame) {
          const token = await this.solveCaptcha(page)
          await this.preencherCaptcha(page, token)
        }

        // Resolver CAPTCHA de imagem, se presente (fluxo alternativo BH)
        const hasCaptchaImg = await page.isVisible(SEL.CAPTCHA_IMAGE)
        if (hasCaptchaImg) {
          // CAPTCHA de imagem: delegar ao método solveCaptcha da base
          // (tipo IMAGE) — resolver via 2Captcha/AntiCaptcha
          await this.solveCaptcha(page)
        }

        // Preencher credenciais
        await page.fill(SEL.LOGIN_INPUT, credData.login)
        await page.fill(SEL.SENHA_INPUT, credData.senha)
        await page.click(SEL.BTN_ENTRAR)

        await page.waitForLoadState('networkidle', { timeout: 30_000 })

        // Verificar mensagem de erro de login
        const loginError = await page.isVisible(SEL.MSG_ERRO_LOGIN)
        if (loginError) {
          const msg = await page.textContent(SEL.MSG_ERRO_LOGIN)
          return this.captureAndThrow(
            page,
            credData.login,
            'bh-prefeitura-login',
            `Falha de autenticação BH: ${msg?.trim() ?? 'erro desconhecido'}`
          )
        }

        // Verificar redirecionamento correto (portal autentica e redireciona ao menu)
        const currentUrl = page.url()
        if (currentUrl.includes('login') || currentUrl.includes('Login')) {
          return this.captureAndThrow(
            page,
            credData.login,
            'bh-prefeitura-login-redirect',
            'Falha de autenticação BH: permaneceu na página de login após submit'
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

        // Navega à tela de consulta de NFS-e emitidas
        await page.goto(`${BASE_URL}/bhissweb/nfse/consultarNfse`, {
          waitUntil: 'networkidle',
          timeout: 60_000,
        })

        await this.preencherFiltroConsulta(page, cnpj, periodo, 'bh-emitidas')

        return this.coletarPaginas(page, 'NFSE_EMITIDA', cnpj, 'bh-emitidas')
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

        // Navega à tela de consulta de NFS-e recebidas (tomador)
        await page.goto(`${BASE_URL}/bhissweb/nfse/consultarNfseTomada`, {
          waitUntil: 'networkidle',
          timeout: 60_000,
        })

        await this.preencherFiltroConsulta(page, cnpj, periodo, 'bh-tomadas')

        return this.coletarPaginas(page, 'NFSE_TOMADA', cnpj, 'bh-tomadas')
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

        // URL canônica para download do XML no BHISS Digital
        const url =
          `${BASE_URL}/bhissweb/nfse/downloadXml` +
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
            `bh-xml-${doc.numero}`,
            `Falha download XML BH nota ${doc.numero}: ${(err as Error).message}`
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

        // URL canônica para o DANFSE no BHISS Digital
        const url =
          `${BASE_URL}/bhissweb/nfse/imprimirDanfse` +
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
            `bh-pdf-${doc.numero}`,
            `Falha download PDF BH nota ${doc.numero}: ${(err as Error).message}`
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
        const res = await page.goto(`${BASE_URL}/bhissweb/login`, {
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
   * Valida que a sessão existe e não expirou.
   * Lança erro com screenshot obrigatório se inválida.
   */
  private async garantirSessao(page: Page, cnpj: string, contexto: string): Promise<void> {
    if (!this.session) {
      return this.captureAndThrow(
        page,
        cnpj,
        `bh-sem-sessao-${contexto}`,
        'Prefeitura BH: sessão não inicializada — chame authenticate() primeiro'
      )
    }
    if (this.session!.expiresAt < nowBR()) {
      return this.captureAndThrow(
        page,
        cnpj,
        `bh-sessao-expirada-${contexto}`,
        'Prefeitura BH: sessão expirada — reautentique'
      )
    }
  }

  /**
   * Preenche os filtros de data (e CNPJ quando exposto) e dispara a pesquisa.
   * Tira screenshot e lança erro se o formulário não for encontrado.
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
        `bh-filtro-${contexto}`,
        `Prefeitura BH: formulário de consulta não encontrado (${contexto})`
      )
    }

    // CNPJ pode estar vinculado ao login — preenche apenas se visível
    const cnpjInput = page.locator(SEL.CNPJ_INPUT)
    const hasCnpjInput = await cnpjInput.isVisible().catch(() => false)
    if (hasCnpjInput) {
      await cnpjInput.fill(cnpj.replace(/\D/g, ''))
    }

    // BHISS pode usar campo de competência (MM/AAAA) em vez de faixa de datas
    const competenciaInput = page.locator(SEL.COMPETENCIA_INPUT)
    const hasCompetencia = await competenciaInput.isVisible().catch(() => false)

    if (hasCompetencia) {
      // Formato MM/AAAA
      const competenciaStr = formatDate(periodo.inicio, 'MM/yyyy')
      await competenciaInput.fill(competenciaStr)
    } else {
      // Formato dd/MM/yyyy para data inicial e final
      await page.fill(SEL.DATA_INICIO, formatDate(periodo.inicio, 'dd/MM/yyyy'))
      await page.fill(SEL.DATA_FIM, formatDate(periodo.fim, 'dd/MM/yyyy'))
    }

    await page.click(SEL.BTN_PESQUISAR)
    await page.waitForLoadState('networkidle', { timeout: 60_000 })
  }

  /**
   * Percorre todas as páginas da grade e retorna os documentos encontrados.
   * Limite de 100 páginas por segurança.
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
          // linha de cabeçalho, totalizador ou inválida — ignorar
        }
      }

      const temProxima = await page.isVisible(SEL.BTN_PROXIMA)
      if (!temProxima) break

      try {
        await page.click(SEL.BTN_PROXIMA)
        await page.waitForLoadState('networkidle', { timeout: 30_000 })
      } catch (err) {
        // Falha ao avançar página — screenshot + interrompe paginação
        try {
          const screenshot = await page.screenshot({ fullPage: true })
          const s3Key = S3KeyBuilder.erroScreenshot(cnpj, `bh-paginacao-${contexto}`)
          await this.storage.upload(s3Key, screenshot, 'image/png')
        } catch {
          // não mascarar o erro de paginação
        }
        break
      }

      paginaAtual++
    } while (paginaAtual <= 100)

    return docs
  }

  /**
   * Extrai os dados de uma linha da grade de resultados.
   * Layout esperado (colunas):
   *   0: Número NFS-e
   *   1: Data de emissão (dd/MM/yyyy)
   *   2: Nome prestador/tomador
   *   3: CNPJ prestador
   *   4: CNPJ tomador
   *   5: Valor total (formato BR: 1.234,56)
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

    // Normalizar valor monetário BR → decimal: "1.234,56" → "1234.56"
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
   * Regra: screenshot obrigatório antes de qualquer throw.
   */
}
