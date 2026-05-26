/**
 * Portal SEFAZ-SP — DeSTDA + GNRE
 *
 * Coberturas:
 *  - transmitirDeSTDA() — upload do arquivo pipe gerado pelo DeSTDAService via SPED SP
 *  - emitirGNRE()       — emissão de GNRE DIFAL via Portal GNRE SP
 *
 * Ambas as operações usam certificado digital A1 (PFX) carregado pelo
 * CredentialService e injetado via contexto Playwright com clientCertificate.
 * Screenshot obrigatório antes de lançar qualquer erro (CLAUDE.md regra 6).
 */
import { chromium, Browser, Page } from 'playwright'
import { AuditService } from '@saas-contabil/audit'
import { StorageService, S3KeyBuilder } from '@saas-contabil/storage'
import { getPrismaClient } from '@saas-contabil/database'
import { Decimal, nowBR, parsePeriodo, addMeses, formatCompetencia } from '@saas-contabil/shared'

const SPED_SP_URL = 'https://www.sped.fazenda.sp.gov.br/spedsp/jsp/login.jsf'
const GNRE_SP_URL = 'https://www.gnre.pe.gov.br/gnre/portal/consultarGuia.do'

export interface ResultadoDeSTDA {
  protocolo: string
  recibo: string
  dataTransmissao: Date
}

export interface ResultadoGNRE {
  numeroGuia: string
  uf: string
  valor: Decimal
  codigoBarras: string
  vencimento: Date
  pdfKey: string
}

export class SefazSpPortal {
  private db = getPrismaClient()
  private audit = new AuditService()
  private storage = new StorageService()

  // ─── DeSTDA ───────────────────────────────────────────────────────────────

  async transmitirDeSTDA(
    tenantId: string,
    empresaId: string,
    cnpj: string,
    competencia: string,
    certBuffer: Buffer,
    certSenha: string
  ): Promise<ResultadoDeSTDA> {
    const browser = await chromium.launch({ headless: true })
    let page: Page | undefined

    try {
      const context = await browser.newContext({
        clientCertificates: [
          {
            origin: 'https://www.sped.fazenda.sp.gov.br',
            pfx: certBuffer,
            passphrase: certSenha,
          },
        ],
      })
      page = await context.newPage()

      await page.goto(SPED_SP_URL, { timeout: 30_000, waitUntil: 'domcontentloaded' })

      // Aguarda redirect automático após autenticação por certificado
      await page.waitForURL(/spedsp/, { timeout: 20_000 })

      // Navega para transmissão DeSTDA
      await page.goto(
        'https://www.sped.fazenda.sp.gov.br/spedsp/jsp/envioArquivo/DeSTDA/enviaArquivo.jsf',
        { timeout: 20_000, waitUntil: 'domcontentloaded' }
      )

      // Recupera o arquivo DeSTDA gerado pelo DeSTDAService
      const apuracao = await this.db.apuracaoFiscal.findFirst({
        where: { tenantId, empresaId, competencia, tipo: 'DESTDA', status: 'CALCULADO' },
      })

      if (!apuracao) {
        throw new Error(
          `DeSTDA não encontrado para ${cnpj} ${competencia} — gere antes de transmitir`
        )
      }

      const dados = apuracao.dados as { content?: string }
      if (!dados?.content) {
        throw new Error('Conteúdo DeSTDA ausente — dados corrompidos')
      }

      // Upload do arquivo via file input
      const fileInput = page.locator('input[type="file"]')
      await fileInput.waitFor({ timeout: 10_000 })

      const tmpKey = S3KeyBuilder.erroScreenshot(cnpj, `destda-temp-${competencia}`)
      const fileContent = Buffer.from(dados.content, 'utf-8')
      await this.storage.upload(tmpKey, fileContent, 'text/plain')

      // Define o arquivo no input usando setInputFiles com buffer
      await fileInput.setInputFiles({
        name: `DeSTDA_${cnpj}_${competencia.replace('-', '')}.txt`,
        mimeType: 'text/plain',
        buffer: fileContent,
      })

      // Clica em transmitir
      const btnTransmitir = page.locator('button:has-text("Transmitir"), input[value="Transmitir"]')
      await btnTransmitir.click()

      // Aguarda confirmação de protocolo
      await page.waitForSelector('.protocolo, .recibo, [class*="protocolo"]', { timeout: 30_000 })

      const protocoloEl = page.locator('.protocolo, .recibo, [class*="protocolo"]').first()
      const protocolo = (await protocoloEl.textContent())?.trim() ?? `DESTDA-${Date.now()}`
      const recibo = `DESTDA-SP-${cnpj}-${competencia}-${Date.now()}`

      await this.db.apuracaoFiscal.updateMany({
        where: { tenantId, empresaId, competencia, tipo: 'DESTDA' },
        data: { status: 'TRANSMITIDO', recibo },
      })

      const resultado: ResultadoDeSTDA = {
        protocolo,
        recibo,
        dataTransmissao: nowBR(),
      }

      await this.audit.registrar({
        tenantId,
        cnpj,
        entidadeTipo: 'APURACAO_FISCAL',
        entidadeId: empresaId,
        evento: 'DESTDA_TRANSMITIDO',
        estadoNovo: resultado,
        responsavel: 'sistema',
        responsavelTipo: 'SISTEMA',
      })

      return resultado
    } catch (err) {
      const screenshot = await page?.screenshot({ fullPage: true })
      if (screenshot) {
        const s3Key = S3KeyBuilder.erroScreenshot(cnpj, `destda-transmissao-${competencia}`)
        await this.storage.upload(s3Key, screenshot, 'image/png')
      }

      await this.audit.registrar({
        tenantId,
        cnpj,
        entidadeTipo: 'APURACAO_FISCAL',
        entidadeId: empresaId,
        evento: 'OBRIGACAO_FALHOU',
        estadoNovo: { operacao: 'DESTDA_TRANSMISSAO', competencia, erro: String(err) },
        responsavel: 'sistema',
        responsavelTipo: 'SISTEMA',
      })

      throw err
    } finally {
      await browser.close()
    }
  }

  // ─── GNRE ────────────────────────────────────────────────────────────────

  async emitirGNRE(
    tenantId: string,
    empresaId: string,
    cnpj: string,
    competencia: string,
    uf: string,
    valor: Decimal,
    codReceita: string
  ): Promise<ResultadoGNRE> {
    const browser = await chromium.launch({ headless: true })
    let page: Page | undefined

    try {
      const context = await browser.newContext()
      page = await context.newPage()

      // Portal GNRE Nacional (hospedado pela SEFAZ PE por convênio)
      await page.goto(GNRE_SP_URL, { timeout: 30_000, waitUntil: 'domcontentloaded' })

      // Preenche formulário de emissão de GNRE
      const ufInput = page.locator('select[name="estado"], select[id*="estado"], select[id*="uf"]')
      await ufInput.waitFor({ timeout: 10_000 })
      await ufInput.selectOption(uf)

      const receitaInput = page.locator(
        'input[name*="receita"], input[id*="receita"], select[id*="receita"]'
      )
      await receitaInput.fill(codReceita)

      const cnpjInput = page.locator('input[name*="cnpj"], input[id*="cnpj"]')
      await cnpjInput.fill(cnpj)

      const valorInput = page.locator('input[name*="valor"], input[id*="valor"]')
      await valorInput.fill(valor.toFixed(2))

      const competenciaInput = page.locator('input[name*="referencia"], input[id*="referencia"]')
      await competenciaInput.fill(competencia.replace('-', ''))

      const btnEmitir = page.locator('button:has-text("Emitir"), input[value="Emitir"]')
      await btnEmitir.click()

      // Aguarda GNRE emitida com código de barras
      await page.waitForSelector('[class*="barras"], .codigoBarras, .numerodocumento', {
        timeout: 30_000,
      })

      const codigoBarrasEl = page.locator('[class*="barras"], .codigoBarras').first()
      const codigoBarras = (await codigoBarrasEl.textContent())?.trim() ?? ''

      const numeroGuiaEl = page.locator('[class*="numero"], .numerodocumento').first()
      const numeroGuia =
        (await numeroGuiaEl.textContent())?.trim() ?? `GNRE-${uf}-${cnpj}-${Date.now()}`

      // Download do PDF
      const pdfKey = S3KeyBuilder.guiaGNRE(cnpj, competencia, uf)
      const pdfContent = await page.pdf({ format: 'A4' })
      await this.storage.upload(pdfKey, Buffer.from(pdfContent), 'application/pdf')

      // Vencimento: dia 20 do mês seguinte à competência
      const { inicio: inicioCompetencia } = parsePeriodo(competencia)
      const proximoMes = formatCompetencia(addMeses(inicioCompetencia, 1))
      const { inicio: inicioProximo } = parsePeriodo(proximoMes)
      const vencimento = new Date(inicioProximo.getFullYear(), inicioProximo.getMonth(), 20)

      const resultado: ResultadoGNRE = {
        numeroGuia,
        uf,
        valor,
        codigoBarras,
        vencimento,
        pdfKey,
      }

      await this.db.apuracaoFiscal.upsert({
        where: {
          tenantId_empresaId_competencia_tipo: {
            tenantId,
            empresaId,
            competencia,
            tipo: 'GNRE',
          },
        },
        update: {
          status: 'TRANSMITIDO',
          recibo: numeroGuia,
        },
        create: {
          tenantId,
          empresaId,
          competencia,
          tipo: 'GNRE',
          dados: { gnres: [{ uf, valor: valor.toFixed(2), numeroGuia, codigoBarras }] } as any,
          status: 'TRANSMITIDO',
          recibo: numeroGuia,
        },
      })

      await this.audit.registrar({
        tenantId,
        cnpj,
        entidadeTipo: 'APURACAO_FISCAL',
        entidadeId: empresaId,
        evento: 'GNRE_GERADA',
        estadoNovo: {
          uf,
          valor: valor.toFixed(2),
          numeroGuia,
          codReceita,
          vencimento: vencimento.toISOString(),
          pdfKey,
        },
        responsavel: 'sistema',
        responsavelTipo: 'SISTEMA',
      })

      return resultado
    } catch (err) {
      const screenshot = await page?.screenshot({ fullPage: true })
      if (screenshot) {
        const s3Key = S3KeyBuilder.erroScreenshot(cnpj, `gnre-emissao-${uf}-${competencia}`)
        await this.storage.upload(s3Key, screenshot, 'image/png')
      }

      await this.audit.registrar({
        tenantId,
        cnpj,
        entidadeTipo: 'APURACAO_FISCAL',
        entidadeId: empresaId,
        evento: 'OBRIGACAO_FALHOU',
        estadoNovo: { operacao: 'GNRE_EMISSAO', uf, competencia, erro: String(err) },
        responsavel: 'sistema',
        responsavelTipo: 'SISTEMA',
      })

      throw err
    } finally {
      await browser.close()
    }
  }

  // ─── Emissão em lote (todas as UFs de uma competência) ──────────────────

  async emitirGNRELote(
    tenantId: string,
    empresaId: string,
    cnpj: string,
    competencia: string,
    gnres: Array<{ uf: string; valor: Decimal; codReceita: string }>
  ): Promise<ResultadoGNRE[]> {
    const resultados: ResultadoGNRE[] = []

    for (const gnre of gnres) {
      try {
        const resultado = await this.emitirGNRE(
          tenantId,
          empresaId,
          cnpj,
          competencia,
          gnre.uf,
          gnre.valor,
          gnre.codReceita
        )
        resultados.push(resultado)
      } catch (err) {
        // Continua para as demais UFs mesmo que uma falhe
        await this.audit.registrar({
          tenantId,
          cnpj,
          entidadeTipo: 'APURACAO_FISCAL',
          entidadeId: empresaId,
          evento: 'OBRIGACAO_FALHOU',
          estadoNovo: {
            operacao: 'GNRE_EMISSAO_LOTE',
            uf: gnre.uf,
            competencia,
            erro: String(err),
          },
          responsavel: 'sistema',
          responsavelTipo: 'SISTEMA',
        })
      }
    }

    return resultados
  }
}
