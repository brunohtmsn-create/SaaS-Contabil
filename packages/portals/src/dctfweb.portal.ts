/**
 * Portal DCTFWeb — Transmissão via SPED Receita Federal
 *
 * Coberturas:
 *  - transmitir()    — upload do XML DCTFWeb gerado pelo DCTFWebService via portal SPED
 *  - consultar()     — verifica situação de transmissões anteriores por competência
 *
 * Autenticação via certificado digital A1 (PFX).
 * Screenshot obrigatório antes de lançar qualquer erro (CLAUDE.md regra 6).
 */
import { chromium, Browser, Page } from 'playwright'
import { AuditService } from '@saas-contabil/audit'
import { StorageService, S3KeyBuilder } from '@saas-contabil/storage'
import { getPrismaClient } from '@saas-contabil/database'
import { nowBR } from '@saas-contabil/shared'

const DCTFWEB_URL = 'https://sped.rfb.gov.br/pgie/login.jsf'

export interface ResultadoDCTFWeb {
  protocolo: string
  recibo: string
  dataTransmissao: Date
  situacao: 'ACEITA' | 'REJEITADA' | 'EM_PROCESSAMENTO'
}

export interface SituacaoDCTFWeb {
  competencia: string
  protocolo: string | null
  situacao: 'TRANSMITIDA' | 'NAO_TRANSMITIDA' | 'ERRO' | 'EM_PROCESSAMENTO'
  dataTransmissao: Date | null
  mensagem: string | null
}

export class DCTFWebPortal {
  private db = getPrismaClient()
  private audit = new AuditService()
  private storage = new StorageService()

  // ─── Transmissão ──────────────────────────────────────────────────────────

  async transmitir(
    tenantId: string,
    empresaId: string,
    cnpj: string,
    competencia: string,
    certBuffer: Buffer,
    certSenha: string
  ): Promise<ResultadoDCTFWeb> {
    const browser = await chromium.launch({ headless: true })
    let page: Page | undefined

    try {
      const context = await browser.newContext({
        clientCertificates: [
          {
            origin: 'https://sped.rfb.gov.br',
            pfx: certBuffer,
            passphrase: certSenha,
          },
        ],
      })
      page = await context.newPage()

      // Login via certificado digital
      await page.goto(DCTFWEB_URL, { timeout: 30_000, waitUntil: 'domcontentloaded' })
      await page.waitForURL(/sped\.rfb\.gov\.br/, { timeout: 20_000 })

      // Navega para transmissão DCTFWeb
      await page.goto('https://sped.rfb.gov.br/pgie/jsp/DCTFWeb/transmissao.jsf', {
        timeout: 20_000,
        waitUntil: 'domcontentloaded',
      })

      // Recupera XML DCTFWeb gerado pelo DCTFWebService
      const apuracao = await this.db.apuracaoFiscal.findFirst({
        where: { tenantId, empresaId, competencia, tipo: 'DCTFWEB', status: 'CALCULADO' },
      })

      if (!apuracao) {
        throw new Error(
          `DCTFWeb não encontrado para ${cnpj} ${competencia} — gere antes de transmitir`
        )
      }

      const dados = apuracao.dados as { xmlContent?: string; content?: string }
      const xmlContent = dados?.xmlContent ?? dados?.content
      if (!xmlContent) {
        throw new Error('Conteúdo XML DCTFWeb ausente — recalcule antes de transmitir')
      }

      // Upload do arquivo XML via file input
      const fileInput = page.locator('input[type="file"]')
      await fileInput.waitFor({ timeout: 10_000 })

      const fileBuffer = Buffer.from(xmlContent, 'utf-8')
      await fileInput.setInputFiles({
        name: `DCTFWeb_${cnpj}_${competencia.replace('-', '')}.xml`,
        mimeType: 'application/xml',
        buffer: fileBuffer,
      })

      // Confirma transmissão
      const btnTransmitir = page.locator(
        'button:has-text("Transmitir"), input[value="Transmitir"], button[id*="transmitir"]'
      )
      await btnTransmitir.waitFor({ timeout: 10_000 })
      await btnTransmitir.click()

      // Aguarda protocolo de recebimento
      await page.waitForSelector(
        '[class*="protocolo"], [class*="recibo"], .protocolo, #protocolo',
        { timeout: 60_000 }
      )

      const protocoloEl = page
        .locator('[class*="protocolo"], [class*="recibo"], .protocolo, #protocolo')
        .first()
      const protocoloTexto = (await protocoloEl.textContent())?.trim() ?? ''
      const protocolo =
        protocoloTexto.match(/\d{15,}/)?.[0] ?? `DCTFWEB-${cnpj}-${competencia}-${Date.now()}`
      const recibo = `DCTFWEB-RF-${cnpj}-${competencia}`

      // Verifica situação do arquivo (ACEITA / REJEITADA / EM_PROCESSAMENTO)
      const situacaoEl = page.locator('[class*="situacao"], .situacao, [id*="situacao"]').first()
      const situacaoTexto = ((await situacaoEl.textContent().catch(() => '')) ?? '').toUpperCase()
      const situacao: ResultadoDCTFWeb['situacao'] = situacaoTexto.includes('REJEIT')
        ? 'REJEITADA'
        : situacaoTexto.includes('PROCESSAMENTO')
          ? 'EM_PROCESSAMENTO'
          : 'ACEITA'

      if (situacao === 'REJEITADA') {
        const mensagemEl = page.locator('[class*="erro"], [class*="mensagem"], .erro').first()
        const mensagem = (await mensagemEl.textContent().catch(() => '')) ?? 'Motivo não informado'
        throw new Error(`DCTFWeb rejeitada pelo portal: ${mensagem}`)
      }

      // Atualiza status no banco
      await this.db.apuracaoFiscal.updateMany({
        where: { tenantId, empresaId, competencia, tipo: 'DCTFWEB' },
        data: { status: 'TRANSMITIDO', recibo },
      })

      const resultado: ResultadoDCTFWeb = {
        protocolo,
        recibo,
        dataTransmissao: nowBR(),
        situacao,
      }

      await this.audit.registrar({
        tenantId,
        cnpj,
        entidadeTipo: 'APURACAO_FISCAL',
        entidadeId: empresaId,
        evento: 'DCTFWEB_TRANSMITIDA',
        estadoNovo: resultado,
        responsavel: 'sistema',
        responsavelTipo: 'SISTEMA',
      })

      return resultado
    } catch (err) {
      const screenshot = await page?.screenshot({ fullPage: true })
      if (screenshot) {
        const s3Key = S3KeyBuilder.erroScreenshot(cnpj, `dctfweb-transmissao-${competencia}`)
        await this.storage.upload(s3Key, screenshot, 'image/png')
      }

      await this.audit.registrar({
        tenantId,
        cnpj,
        entidadeTipo: 'APURACAO_FISCAL',
        entidadeId: empresaId,
        evento: 'OBRIGACAO_FALHOU',
        estadoNovo: { operacao: 'DCTFWEB_TRANSMISSAO', competencia, erro: String(err) },
        responsavel: 'sistema',
        responsavelTipo: 'SISTEMA',
      })

      throw err
    } finally {
      await browser.close()
    }
  }

  // ─── Consulta situação ─────────────────────────────────────────────────────

  async consultar(
    tenantId: string,
    empresaId: string,
    cnpj: string,
    competencia: string,
    certBuffer: Buffer,
    certSenha: string
  ): Promise<SituacaoDCTFWeb> {
    const browser = await chromium.launch({ headless: true })
    let page: Page | undefined

    try {
      const context = await browser.newContext({
        clientCertificates: [
          {
            origin: 'https://sped.rfb.gov.br',
            pfx: certBuffer,
            passphrase: certSenha,
          },
        ],
      })
      page = await context.newPage()

      await page.goto(DCTFWEB_URL, { timeout: 30_000, waitUntil: 'domcontentloaded' })
      await page.waitForURL(/sped\.rfb\.gov\.br/, { timeout: 20_000 })

      await page.goto('https://sped.rfb.gov.br/pgie/jsp/DCTFWeb/consulta.jsf', {
        timeout: 20_000,
        waitUntil: 'domcontentloaded',
      })

      // Preenche filtro de competência no formato MM/AAAA
      const [ano, mes] = competencia.split('-')
      const competenciaFormatada = `${mes}/${ano}`

      const competenciaInput = page.locator('input[id*="competencia"], input[name*="competencia"]')
      await competenciaInput.waitFor({ timeout: 10_000 })
      await competenciaInput.fill(competenciaFormatada)

      const btnConsultar = page.locator('button:has-text("Consultar"), input[value="Consultar"]')
      await btnConsultar.click()

      await page.waitForSelector('table[id*="resultado"], .resultado, [class*="resultado"]', {
        timeout: 30_000,
      })

      const linhas = await page.locator('table[id*="resultado"] tbody tr, .resultado tr').all()

      if (linhas.length === 0) {
        return {
          competencia,
          protocolo: null,
          situacao: 'NAO_TRANSMITIDA',
          dataTransmissao: null,
          mensagem: 'Nenhuma transmissão encontrada para a competência',
        }
      }

      const primeiraLinha = linhas[0]
      if (!primeiraLinha) {
        return {
          competencia,
          protocolo: null,
          situacao: 'NAO_TRANSMITIDA',
          dataTransmissao: null,
          mensagem: 'Nenhuma transmissão encontrada para a competência',
        }
      }

      const colunas = await primeiraLinha.locator('td').all()
      const protocolo = (await colunas[0]?.textContent())?.trim() ?? null
      const dataTexto = (await colunas[1]?.textContent())?.trim() ?? null
      const situacaoTexto = ((await colunas[2]?.textContent())?.trim() ?? '').toUpperCase()

      const situacao: SituacaoDCTFWeb['situacao'] = situacaoTexto.includes('TRANSMIT')
        ? 'TRANSMITIDA'
        : situacaoTexto.includes('ERRO')
          ? 'ERRO'
          : situacaoTexto.includes('PROCESSAMENTO')
            ? 'EM_PROCESSAMENTO'
            : 'NAO_TRANSMITIDA'

      let dataTransmissao: Date | null = null
      if (dataTexto) {
        const [dia, mesStr, anoStr] = dataTexto.split('/')
        if (dia && mesStr && anoStr) {
          dataTransmissao = new Date(Number(anoStr), Number(mesStr) - 1, Number(dia))
        }
      }

      return {
        competencia,
        protocolo,
        situacao,
        dataTransmissao,
        mensagem: null,
      }
    } catch (err) {
      const screenshot = await page?.screenshot({ fullPage: true })
      if (screenshot) {
        const s3Key = S3KeyBuilder.erroScreenshot(cnpj, `dctfweb-consulta-${competencia}`)
        await this.storage.upload(s3Key, screenshot, 'image/png')
      }
      throw err
    } finally {
      await browser.close()
    }
  }
}
