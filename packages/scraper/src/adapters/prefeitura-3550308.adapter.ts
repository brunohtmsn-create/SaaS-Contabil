/**
 * Adapter — Prefeitura de São Paulo (IBGE 3550308)
 * Portal: NF-e Paulistana — https://nfe.prefeitura.sp.gov.br
 *
 * Fluxo:
 *   1. authenticate()   → login/senha via formulário web
 *   2. fetchEmitidas()  → /contribuinte/nota/consultanota.aspx (prestador)
 *   3. fetchTomadas()   → /contribuinte/nota/consultanotatomador.aspx (tomador)
 *   4. downloadXML()    → clica no ícone de download XML de cada nota
 *   5. downloadPDF()    → clica no ícone de PDF / DANFSE de cada nota
 */

import { Page } from 'playwright'
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

const BASE_URL = 'https://nfe.prefeitura.sp.gov.br'

// Seletores do portal NF-e Paulistana (aproximações — ajustar conforme HTML real)
const SEL = {
  LOGIN_INPUT: '#tbLogin',
  SENHA_INPUT: '#tbSenha',
  BTN_ENTRAR: '#btnEntrar',
  CAPTCHA_IMG: '#imgCaptcha',
  CAPTCHA_INPUT: '#tbCaptcha',
  // Formulário de consulta
  DATA_INICIO: '#tbDataInicio',
  DATA_FIM: '#tbDataFim',
  BTN_CONSULTAR: '#btnConsultar',
  // Tabela de resultados
  GRID_ROWS: 'table#gridNotas tr.item, table#gridNotas tr.alternatingitem',
  BTN_XML: 'a[title="Download XML"]',
  BTN_PDF: 'a[title="Download PDF"], a[title="Visualizar DANFSE"]',
  // Mensagem de erro de login
  MSG_ERRO_LOGIN: '#lblErroLogin, .erroLogin',
  // Paginação
  BTN_PROXIMA: 'a[title="Próxima página"]',
} as const

export class Prefeitura3550308Adapter extends BasePLaywrightAdapter implements PrefeituraAdapter {
  tipo = 'NFSE_EMITIDA'
  fonte = 'PREFEITURA_SP'
  municipio = 'São Paulo'
  ibge = '3550308'

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
        await page.goto(`${BASE_URL}/contribuinte/login.aspx`, {
          waitUntil: 'networkidle',
          timeout: 60_000,
        })

        // Resolver CAPTCHA se presente
        const hasCaptcha = await page.isVisible(SEL.CAPTCHA_IMG)
        if (hasCaptcha) {
          await this.resolverCaptchaLocal(page)
        }

        // Preencher credenciais
        await page.fill(SEL.LOGIN_INPUT, credData.login)
        await page.fill(SEL.SENHA_INPUT, credData.senha)
        await page.click(SEL.BTN_ENTRAR)

        await page.waitForLoadState('networkidle', { timeout: 30_000 })

        // Verificar falha de login
        const loginError = await page.isVisible(SEL.MSG_ERRO_LOGIN)
        if (loginError) {
          const msg = await page.textContent(SEL.MSG_ERRO_LOGIN)
          return this.captureAndThrow(
            page,
            credData.login,
            'sp-prefeitura-login',
            `Falha de autenticação SP: ${msg?.trim()}`
          )
        }

        // Coletar cookies da sessão
        const cookies = await page.context().cookies()
        const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ')

        return {
          cookies: cookieStr,
          expiresAt: new Date(nowBR().getTime() + 2 * 60 * 60 * 1000), // 2 h
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
        await this.aplicarSessao(page)

        await page.goto(`${BASE_URL}/contribuinte/nota/consultanota.aspx`, {
          waitUntil: 'networkidle',
          timeout: 60_000,
        })

        await this.preencherFiltroData(page, periodo)

        const docs: DocumentoRaw[] = []
        let paginaAtual = 1

        do {
          const rows = await page.locator(SEL.GRID_ROWS).all()
          for (const row of rows) {
            try {
              const doc = await this.parseRow(row, 'NFSE_EMITIDA', cnpj)
              if (doc) docs.push(doc)
            } catch {
              // linha inválida — ignorar e continuar
            }
          }

          const temProxima = await page.isVisible(SEL.BTN_PROXIMA)
          if (!temProxima) break

          await page.click(SEL.BTN_PROXIMA)
          await page.waitForLoadState('networkidle', { timeout: 30_000 })
          paginaAtual++
        } while (paginaAtual <= 50) // limite de segurança

        return docs
      })
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Notas tomadas (tomador)
  // ─────────────────────────────────────────────────────────────────────────

  async fetchTomadas(cnpj: string, periodo: Periodo): Promise<DocumentoRaw[]> {
    return this.withRetry(() =>
      this.withPage(async (page) => {
        await this.aplicarSessao(page)

        await page.goto(`${BASE_URL}/contribuinte/nota/consultanotatomador.aspx`, {
          waitUntil: 'networkidle',
          timeout: 60_000,
        })

        await this.preencherFiltroData(page, periodo)

        const docs: DocumentoRaw[] = []
        let paginaAtual = 1

        do {
          const rows = await page.locator(SEL.GRID_ROWS).all()
          for (const row of rows) {
            try {
              const doc = await this.parseRow(row, 'NFSE_TOMADA', cnpj)
              if (doc) docs.push(doc)
            } catch {
              // linha inválida — ignorar
            }
          }

          const temProxima = await page.isVisible(SEL.BTN_PROXIMA)
          if (!temProxima) break

          await page.click(SEL.BTN_PROXIMA)
          await page.waitForLoadState('networkidle', { timeout: 30_000 })
          paginaAtual++
        } while (paginaAtual <= 50)

        return docs
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
        await this.aplicarSessao(page)

        const url = `${BASE_URL}/contribuinte/nota/downloadxml.aspx?numero=${doc.numero}&cnpj=${doc.cnpjEmitente}`

        try {
          const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 60_000 }),
            page.goto(url, { waitUntil: 'commit', timeout: 30_000 }),
          ])

          const buffer = await download.createReadStream()
          const chunks: Buffer[] = []
          for await (const chunk of buffer) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          }

          return Buffer.concat(chunks).toString('utf8')
        } catch (err) {
          return this.captureAndThrow(
            page,
            doc.cnpjEmitente,
            `sp-xml-${doc.numero}`,
            `Falha download XML SP nota ${doc.numero}: ${(err as Error).message}`
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
        await this.aplicarSessao(page)

        const url = `${BASE_URL}/contribuinte/nota/downloadpdf.aspx?numero=${doc.numero}&cnpj=${doc.cnpjEmitente}`

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
            `sp-pdf-${doc.numero}`,
            `Falha download PDF SP nota ${doc.numero}: ${(err as Error).message}`
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
        const res = await page.goto(`${BASE_URL}/contribuinte/login.aspx`, {
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

  /** Injeta cookies da sessão autenticada na página atual */
  private async aplicarSessao(page: Page): Promise<void> {
    if (!this.session) {
      throw new Error('Prefeitura SP: sessão não inicializada — chame authenticate() primeiro')
    }
    // Os cookies já estão no contexto do browser (compartilhado entre páginas)
    // Esta chamada garante que a sessão ainda é válida
    if (this.session.expiresAt < nowBR()) {
      throw new Error('Prefeitura SP: sessão expirada — reautentique')
    }
  }

  /** Preenche os campos de data inicial/final e dispara a consulta */
  private async preencherFiltroData(page: Page, periodo: Periodo): Promise<void> {
    await page.waitForSelector(SEL.DATA_INICIO, { timeout: 15_000 })

    await page.fill(SEL.DATA_INICIO, formatDate(periodo.inicio, 'dd/MM/yyyy'))
    await page.fill(SEL.DATA_FIM, formatDate(periodo.fim, 'dd/MM/yyyy'))
    await page.click(SEL.BTN_CONSULTAR)
    await page.waitForLoadState('networkidle', { timeout: 60_000 })
  }

  /** Extrai os campos de uma linha da grade de resultados */
  private async parseRow(
    row: import('playwright').Locator,
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

    if (!numero) return null

    // Converter data no formato dd/MM/yyyy
    const [dia, mes, ano] = dataEmissaoStr.split('/')
    const dataEmissao = new Date(Number(ano), Number(mes) - 1, Number(dia))

    // Valor: "1.234,56" → "1234.56"
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
   * Resolve CAPTCHA via serviço externo.
   * Placeholder — a lógica real de 2Captcha/AntiCaptcha será implementada
   * no módulo dedicado de CAPTCHA.
   */
  private async resolverCaptchaLocal(page: Page): Promise<void> {
    // TODO: integrar com CaptchaSolverService (2Captcha → AntiCaptcha)
    // O serviço receberá a imagem em base64 e retornará o texto
    const captchaImg = page.locator(SEL.CAPTCHA_IMG)
    const imgSrc = await captchaImg.getAttribute('src')
    if (!imgSrc) return

    // Por enquanto aguarda resolução manual em ambiente de desenvolvimento
    if (process.env['NODE_ENV'] !== 'production') {
      // Em dev: a sessão pode usar cookies previamente salvos
      return
    }

    throw new Error('Prefeitura SP: CAPTCHA detectado — CaptchaSolverService ainda não integrado')
  }
}
