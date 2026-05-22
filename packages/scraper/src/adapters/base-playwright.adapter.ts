import { chromium, Browser, BrowserContext, Page } from 'playwright'
import axios from 'axios'
import { Session, Credential, DocumentoRaw, Periodo, DocumentAdapter } from '../interfaces/base.js'
import { StorageService } from '@saas-contabil/storage'
import { S3KeyBuilder } from '@saas-contabil/storage'

const RETRY_DELAYS = [1000, 2000, 4000, 8000]

/** Intervalo de polling para 2Captcha/AntiCaptcha (ms) */
const CAPTCHA_POLL_INTERVAL_MS = 5_000
/** Timeout total para resolução de CAPTCHA (ms) */
const CAPTCHA_TIMEOUT_MS = 120_000

type CaptchaType = 'RECAPTCHA_V2' | 'HCAPTCHA' | 'IMAGE'

export abstract class BasePLaywrightAdapter implements DocumentAdapter {
  abstract tipo: string
  abstract fonte: string

  protected browser: Browser | null = null
  protected context: BrowserContext | null = null

  private storage = new StorageService()

  protected async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: process.env['PLAYWRIGHT_HEADLESS'] !== 'false',
      })
    }
    return this.browser
  }

  protected async getContext(): Promise<BrowserContext> {
    if (!this.context) {
      const browser = await this.getBrowser()
      this.context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      })
    }
    return this.context
  }

  protected async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const context = await this.getContext()
    const page = await context.newPage()
    try {
      return await fn(page)
    } finally {
      await page.close()
    }
  }

  protected async withRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
    let lastError: Error | undefined

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await fn()
      } catch (err) {
        lastError = err as Error
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt] ?? 8000))
        }
      }
    }

    throw lastError
  }

  // ─── CAPTCHA ──────────────────────────────────────────────────────────────

  /**
   * Detecta o tipo de CAPTCHA presente na página e retorna a solução como token.
   * Tenta primeiro 2Captcha, depois AntiCaptcha como fallback.
   * Se ambos falharem, faz screenshot obrigatório no S3 e lança erro.
   */
  protected async solveCaptcha(page: Page): Promise<string> {
    const captchaType = await this.detectCaptchaType(page)

    // Obtém o sitekey e pageUrl conforme o tipo detectado
    const pageUrl = page.url()
    const sitekey = await this.extractSitekey(page, captchaType)

    // Tenta 2Captcha
    const twoCaptchaKey = process.env['TWO_CAPTCHA_API_KEY']
    if (twoCaptchaKey) {
      try {
        const token = await this.solveWith2Captcha(twoCaptchaKey, captchaType, sitekey, pageUrl)
        if (token) return token
      } catch (err) {
        // Falha no 2Captcha — tenta AntiCaptcha
        console.warn(`[CAPTCHA] 2Captcha falhou: ${(err as Error).message}. Tentando AntiCaptcha...`)
      }
    }

    // Tenta AntiCaptcha como fallback
    const antiCaptchaKey = process.env['ANTI_CAPTCHA_API_KEY']
    if (antiCaptchaKey) {
      try {
        const token = await this.solveWithAntiCaptcha(antiCaptchaKey, captchaType, sitekey, pageUrl)
        if (token) return token
      } catch (err) {
        console.warn(`[CAPTCHA] AntiCaptcha falhou: ${(err as Error).message}.`)
      }
    }

    // Ambos falharam: screenshot obrigatório + throw
    await this.screenshotOnFailure(page, 'captcha-falha')
    throw new Error(
      `[CAPTCHA] Falha ao resolver CAPTCHA do tipo ${captchaType} na URL ${pageUrl}. ` +
        'Ambos 2Captcha e AntiCaptcha falharam. Screenshot salvo no S3.'
    )
  }

  /**
   * Insere o token resolvido do reCAPTCHA/hCaptcha na página via JavaScript.
   */
  protected async preencherCaptcha(page: Page, token: string): Promise<void> {
    await page.evaluate((tkn: string) => {
      // Injeta o token no textarea oculto do reCAPTCHA / hCaptcha
      const textareas = document.querySelectorAll<HTMLTextAreaElement>(
        'textarea[name="g-recaptcha-response"], textarea[name="h-captcha-response"]'
      )
      for (const ta of textareas) {
        ta.style.display = 'block'
        ta.value = tkn
        ta.dispatchEvent(new Event('change', { bubbles: true }))
      }

      // Aciona callbacks registrados (reCAPTCHA v2)
      const win = window as any
      if (win.___grecaptcha_cfg) {
        const clients = win.___grecaptcha_cfg.clients
        for (const key of Object.keys(clients ?? {})) {
          const client = clients[key]
          if (client?.callback) {
            try {
              client.callback(tkn)
            } catch (_) {
              // ignora
            }
          }
        }
      }
    }, token)
  }

  // ─── Helpers privados de CAPTCHA ──────────────────────────────────────────

  private async detectCaptchaType(page: Page): Promise<CaptchaType> {
    const hasRecaptcha = await page.$('iframe[src*="recaptcha"]')
    if (hasRecaptcha) return 'RECAPTCHA_V2'

    const hasHCaptcha = await page.$('iframe[src*="hcaptcha"]')
    if (hasHCaptcha) return 'HCAPTCHA'

    return 'IMAGE'
  }

  private async extractSitekey(page: Page, type: CaptchaType): Promise<string> {
    if (type === 'RECAPTCHA_V2') {
      const sitekey = await page.evaluate(() => {
        const el =
          document.querySelector('[data-sitekey]') ??
          document.querySelector('.g-recaptcha[data-sitekey]')
        return el?.getAttribute('data-sitekey') ?? ''
      })
      if (!sitekey) throw new Error('[CAPTCHA] sitekey do reCAPTCHA não encontrado na página')
      return sitekey
    }

    if (type === 'HCAPTCHA') {
      const sitekey = await page.evaluate(() => {
        const el =
          document.querySelector('[data-hcaptcha-sitekey]') ??
          document.querySelector('.h-captcha[data-sitekey]')
        return (
          el?.getAttribute('data-hcaptcha-sitekey') ?? el?.getAttribute('data-sitekey') ?? ''
        )
      })
      if (!sitekey) throw new Error('[CAPTCHA] sitekey do hCaptcha não encontrado na página')
      return sitekey
    }

    // IMAGE — sitekey não se aplica; retorna string vazia
    return ''
  }

  private async solveWith2Captcha(
    apiKey: string,
    type: CaptchaType,
    sitekey: string,
    pageUrl: string
  ): Promise<string> {
    // Envia a tarefa
    const params: Record<string, string> = {
      key: apiKey,
      method: type === 'HCAPTCHA' ? 'hcaptcha' : 'userrecaptcha',
      googlekey: sitekey,
      pageurl: pageUrl,
      json: '1',
    }

    const submitResp = await axios.post<{ status: number; request: string }>(
      'http://2captcha.com/in.php',
      null,
      { params, timeout: 15_000 }
    )

    if (submitResp.data.status !== 1) {
      throw new Error(`2Captcha recusou a tarefa: ${submitResp.data.request}`)
    }

    const captchaId = submitResp.data.request

    // Polling a cada 5s, até CAPTCHA_TIMEOUT_MS
    const deadline = Date.now() + CAPTCHA_TIMEOUT_MS
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, CAPTCHA_POLL_INTERVAL_MS))

      const pollResp = await axios.get<{ status: number; request: string }>(
        'http://2captcha.com/res.php',
        {
          params: { key: apiKey, action: 'get', id: captchaId, json: '1' },
          timeout: 10_000,
        }
      )

      if (pollResp.data.status === 1) {
        return pollResp.data.request // token resolvido
      }

      if (pollResp.data.request !== 'CAPCHA_NOT_READY') {
        throw new Error(`2Captcha retornou erro: ${pollResp.data.request}`)
      }
    }

    throw new Error('[CAPTCHA] 2Captcha: timeout de 120s atingido sem resposta')
  }

  private async solveWithAntiCaptcha(
    apiKey: string,
    type: CaptchaType,
    sitekey: string,
    pageUrl: string
  ): Promise<string> {
    // Cria tarefa
    const taskType =
      type === 'HCAPTCHA' ? 'HCaptchaTaskProxyless' : 'NoCaptchaTaskProxyless'

    const createResp = await axios.post<{ errorId: number; taskId?: number; errorDescription?: string }>(
      'https://api.anti-captcha.com/createTask',
      {
        clientKey: apiKey,
        task: { type: taskType, websiteURL: pageUrl, websiteKey: sitekey },
      },
      { timeout: 15_000 }
    )

    if (createResp.data.errorId !== 0) {
      throw new Error(
        `AntiCaptcha createTask falhou: ${createResp.data.errorDescription ?? 'erro desconhecido'}`
      )
    }

    const taskId = createResp.data.taskId!

    // Polling a cada 5s, até CAPTCHA_TIMEOUT_MS
    const deadline = Date.now() + CAPTCHA_TIMEOUT_MS
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, CAPTCHA_POLL_INTERVAL_MS))

      const resultResp = await axios.post<{
        errorId: number
        status: string
        solution?: { gRecaptchaResponse: string }
        errorDescription?: string
      }>(
        'https://api.anti-captcha.com/getTaskResult',
        { clientKey: apiKey, taskId },
        { timeout: 10_000 }
      )

      if (resultResp.data.errorId !== 0) {
        throw new Error(
          `AntiCaptcha getTaskResult falhou: ${resultResp.data.errorDescription ?? 'erro desconhecido'}`
        )
      }

      if (resultResp.data.status === 'ready') {
        const token = resultResp.data.solution?.gRecaptchaResponse
        if (!token) throw new Error('AntiCaptcha: resposta sem token')
        return token
      }
      // status === 'processing' → continuar polling
    }

    throw new Error('[CAPTCHA] AntiCaptcha: timeout de 120s atingido sem resposta')
  }

  /**
   * Captura screenshot e faz upload no S3 antes de lançar erros críticos.
   * O jobId é derivado do nome da classe + timestamp para rastreabilidade.
   */
  protected async screenshotOnFailure(page: Page, contexto: string): Promise<void> {
    try {
      const screenshot = await page.screenshot({ fullPage: true })
      const cnpj = 'unknown' // subclasses podem sobrescrever passando cnpj explicitamente
      const jobId = `${this.fonte}-${contexto}`
      const s3Key = S3KeyBuilder.erroScreenshot(cnpj, jobId)
      await this.storage.upload(s3Key, screenshot, 'image/png')
    } catch (uploadErr) {
      // Nunca ocultar o erro original — apenas logar a falha do upload
      console.error('[CAPTCHA] Falha ao fazer upload do screenshot:', uploadErr)
    }
  }

  // ─── Ciclo de vida ────────────────────────────────────────────────────────

  async close(): Promise<void> {
    await this.context?.close()
    await this.browser?.close()
    this.context = null
    this.browser = null
  }

  abstract authenticate(cred: Credential): Promise<Session>
  abstract fetch(cnpj: string, periodo: Periodo): Promise<DocumentoRaw[]>
  abstract downloadXML(doc: DocumentoRaw): Promise<string>
  abstract downloadPDF(doc: DocumentoRaw): Promise<Buffer>

  async healthCheck(): Promise<boolean> {
    try {
      return await this.withPage(async (page) => {
        await page.goto('about:blank')
        return true
      })
    } catch {
      return false
    }
  }
}
