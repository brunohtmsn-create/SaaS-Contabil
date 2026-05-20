import { chromium, Browser, BrowserContext, Page } from 'playwright'
import { Session, Credential, DocumentoRaw, Periodo, DocumentAdapter } from '../interfaces/base.js'

const RETRY_DELAYS = [1000, 2000, 4000, 8000]

export abstract class BasePLaywrightAdapter implements DocumentAdapter {
  abstract tipo: string
  abstract fonte: string

  protected browser: Browser | null = null
  protected context: BrowserContext | null = null

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
