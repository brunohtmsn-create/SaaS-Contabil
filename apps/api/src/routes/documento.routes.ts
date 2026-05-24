import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getPrismaClient } from '@saas-contabil/database'
import { parsePeriodo, limparCNPJ, formatCompetencia } from '@saas-contabil/shared'
import { NormalizerService } from '@saas-contabil/normalizer'
import { StorageService, S3KeyBuilder } from '@saas-contabil/storage'
import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { XMLParser } from 'fast-xml-parser'
import { Decimal } from 'decimal.js'

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

function parseNFeXML(xml: string, cnpjEmpresa: string) {
  const parsed = xmlParser.parse(xml)
  const nfeProc = parsed.nfeProc ?? parsed
  const nfe = nfeProc.NFe?.infNFe ?? nfeProc.infNFe
  if (!nfe) throw new Error('XML não contém nó infNFe — verifique se é uma NF-e válida')

  const ide = nfe.ide
  const emit = nfe.emit
  const dest = nfe.dest
  const total = nfe.total?.ICMSTot ?? {}
  const det = Array.isArray(nfe.det) ? nfe.det[0] : nfe.det

  const cnpjEmitente = limparCNPJ(String(emit?.CNPJ ?? ''))
  const cnpjDestinatario = limparCNPJ(String(dest?.CNPJ ?? dest?.CPF ?? ''))
  const cnpjEmp = limparCNPJ(cnpjEmpresa)

  const tipo = ide?.mod === 65 ? 'NFCE' : 'NFE'
  const chaveAcesso = nfeProc.protNFe?.infProt?.chNFe ?? nfe['@_Id']?.replace('NFe', '')

  return {
    tipo,
    chaveAcesso,
    numero: String(ide?.nNF ?? ''),
    serie: String(ide?.serie ?? ''),
    dataEmissao: new Date(String(ide?.dhEmi ?? ide?.dEmi ?? '')),
    cnpjEmitente,
    nomeEmitente: String(emit?.xNome ?? ''),
    ufEmitente: String(emit?.enderEmit?.UF ?? ''),
    cnpjDestinatario,
    ufDestinatario: String(dest?.enderDest?.UF ?? ''),
    cfop: String(det?.prod?.CFOP ?? ''),
    valorTotal: new Decimal(String(total?.vNF ?? nfe.total?.vNF ?? '0')),
    valorProdutos: new Decimal(String(total?.vProd ?? '0')),
    valorIcms: new Decimal(String(total?.vICMS ?? '0')),
    valorIcmsSt: new Decimal(String(total?.vST ?? '0')),
    valorIpi: new Decimal(String(total?.vIPI ?? '0')),
    valorPis: new Decimal(String(total?.vPIS ?? '0')),
    valorCofins: new Decimal(String(total?.vCOFINS ?? '0')),
    baseCalcIcms: new Decimal(String(total?.vBC ?? '0')),
    fonte: 'UPLOAD_MANUAL',
    xmlContent: xml,
    direcao: cnpjEmitente === cnpjEmp ? 'SAIDA' : 'ENTRADA',
  }
}

function parseNFSeXML(xml: string) {
  const parsed = xmlParser.parse(xml)
  const comp = parsed.CompNfse?.Nfse?.InfNfse ?? parsed.Nfse?.InfNfse ?? parsed.InfNfse
  if (!comp) throw new Error('XML não contém nó InfNfse — verifique se é uma NFS-e válida')

  const serv = comp.Servico ?? {}
  const prest = comp.PrestadorServico ?? comp.Prestador ?? {}
  const tom = comp.TomadorServico ?? comp.Tomador ?? {}

  return {
    tipo: 'NFSE_EMITIDA' as const,
    numero: String(comp.Numero ?? comp.NumeroNfse ?? ''),
    dataEmissao: new Date(String(comp.DataEmissao ?? '')),
    cnpjEmitente: limparCNPJ(String(prest?.IdentificacaoPrestador?.CpfCnpj?.Cnpj ?? prest?.Cnpj ?? '')),
    nomeEmitente: String(prest?.RazaoSocial ?? ''),
    cnpjDestinatario: limparCNPJ(String(tom?.IdentificacaoTomador?.CpfCnpj?.Cnpj ?? tom?.Cnpj ?? '')),
    municipioIBGE: String(comp.CodigoMunicipio ?? prest?.IdentificacaoPrestador?.CpfCnpj?.CodigoMunicipio ?? ''),
    valorTotal: new Decimal(String(serv?.Valores?.ValorServicos ?? comp.ValorServicos ?? '0')),
    valorServicos: new Decimal(String(serv?.Valores?.ValorServicos ?? '0')),
    valorIss: new Decimal(String(serv?.Valores?.ValorIss ?? '0')),
    valorIssRetido: new Decimal(String(serv?.Valores?.ValorIssRetido ?? serv?.Valores?.IssRetido === '1' ? serv?.Valores?.ValorIss : '0')),
    valorIrrf: new Decimal(String(serv?.Valores?.ValorIr ?? '0')),
    valorInss: new Decimal(String(serv?.Valores?.ValorInss ?? '0')),
    aliquotaIss: serv?.Valores?.Aliquota ? new Decimal(String(serv.Valores.Aliquota)) : undefined,
    fonte: 'UPLOAD_MANUAL',
    xmlContent: xml,
  }
}

export async function documentoRoutes(app: FastifyInstance) {
  const db = getPrismaClient()
  const normalizer = new NormalizerService()
  const storage = new StorageService()
  const redis = new IORedis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', { maxRetriesPerRequest: null })
  const scraperQueue = new Queue('scraper', { connection: redis })

  // -------------------------------------------------------------------------
  // POST /documentos/upload — importação manual de XML (NF-e / NFC-e / NFS-e)
  // -------------------------------------------------------------------------
  app.post('/upload', async (request, reply) => {
    const { tenantId, sub: usuarioId } = request.user as any

    const parts = request.parts()
    let empresaId = ''
    let xmlBuffer: Buffer | null = null
    let filename = 'documento.xml'

    for await (const part of parts) {
      if (part.type === 'field' && part.fieldname === 'empresaId') {
        empresaId = part.value as string
      } else if (part.type === 'file' && part.fieldname === 'xml') {
        filename = part.filename ?? filename
        const chunks: Buffer[] = []
        for await (const chunk of part.file) {
          chunks.push(chunk as Buffer)
        }
        xmlBuffer = Buffer.concat(chunks)
      }
    }

    if (!empresaId || !xmlBuffer) {
      return reply.code(400).send({ error: 'Campos obrigatórios: empresaId (campo) e xml (arquivo)' })
    }

    const empresa = await db.empresaCliente.findFirst({ where: { id: empresaId, tenantId } })
    if (!empresa) return reply.code(404).send({ error: 'Empresa não encontrada' })

    const xml = xmlBuffer.toString('utf-8')
    let docRaw: ReturnType<typeof parseNFeXML> | ReturnType<typeof parseNFSeXML>

    try {
      if (xml.includes('InfNfse') || xml.includes('CompNfse') || xml.includes('<Nfse')) {
        docRaw = parseNFSeXML(xml)
      } else {
        docRaw = parseNFeXML(xml, empresa.cnpj)
      }
    } catch (err: any) {
      return reply.code(422).send({ error: `XML inválido: ${err.message}` })
    }

    const competencia = formatCompetencia(docRaw.dataEmissao)

    // Upload do XML para S3 antes de normalizar
    let xmlS3Key: string | undefined
    try {
      const tipo = docRaw.tipo
      if (tipo === 'NFE' || tipo === 'NFCE') {
        const raw = docRaw as ReturnType<typeof parseNFeXML>
        if (raw.chaveAcesso) {
          xmlS3Key = tipo === 'NFCE'
            ? S3KeyBuilder.xmlNFCeEmitida(empresa.cnpj, competencia, raw.chaveAcesso)
            : S3KeyBuilder.xmlNFeEmitida(empresa.cnpj, competencia, raw.chaveAcesso)
        }
      } else {
        const raw = docRaw as ReturnType<typeof parseNFSeXML>
        xmlS3Key = S3KeyBuilder.xmlNFSe(empresa.cnpj, competencia, raw.numero, raw.municipioIBGE ?? '0000000')
      }

      if (xmlS3Key) {
        await storage.upload(xmlS3Key, xmlBuffer, 'application/xml', {
          tenantId, empresaId, fonte: 'UPLOAD_MANUAL', usuario: usuarioId,
        })
      }
    } catch {
      // S3 offline em dev não deve bloquear o import
    }

    const docNormalizado = await normalizer.normalizar(
      { ...docRaw, xmlS3Key } as any,
      tenantId,
      empresaId
    )

    if (!docNormalizado) {
      return reply.code(409).send({ error: 'Documento duplicado — já existe com esta chave de acesso' })
    }

    return reply.code(201).send(docNormalizado)
  })

  // -------------------------------------------------------------------------
  // POST /documentos/capturar/:empresaId/:competencia — disparo do scraper
  // -------------------------------------------------------------------------
  app.post('/capturar/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = z.object({
      empresaId: z.string().uuid(),
      competencia: z.string().regex(/^\d{4}-\d{2}$/),
    }).parse(request.params)

    const empresa = await db.empresaCliente.findFirst({ where: { id: empresaId, tenantId } })
    if (!empresa) return reply.code(404).send({ error: 'Empresa não encontrada' })

    const credencial = await db.credencial.findFirst({
      where: { tenantId, empresaId, status: 'ATIVO' },
    })
    if (!credencial) return reply.code(400).send({ error: 'Nenhuma credencial ativa para esta empresa' })

    const job = await scraperQueue.add('scraper-job', {
      tenantId,
      empresaId,
      cnpj: empresa.cnpj,
      competencia,
      credencialId: credencial.id,
      tipo: 'TODOS',
    }, { attempts: 3, backoff: { type: 'exponential', delay: 3000 } })

    return { jobId: job.id, status: 'AGUARDANDO', cnpj: empresa.cnpj, competencia }
  })

  // -------------------------------------------------------------------------
  // GET /documentos — listagem paginada com filtros
  // -------------------------------------------------------------------------
  app.get('/', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia, tipo, status, page = '1', limit = '50' } = request.query as any

    const where: any = { tenantId }
    if (empresaId) where.empresaId = empresaId
    if (competencia) {
      const { inicio, fim } = parsePeriodo(competencia)
      where.dataCompetencia = { gte: inicio, lte: fim }
    }
    if (tipo) where.tipo = tipo
    if (status) where.status = status

    const [docs, total] = await Promise.all([
      db.documentoFiscal.findMany({
        where,
        orderBy: { dataEmissao: 'desc' },
        take: Number(limit),
        skip: (Number(page) - 1) * Number(limit),
      }),
      db.documentoFiscal.count({ where }),
    ])

    return { data: docs, total, page: Number(page), limit: Number(limit) }
  })

  // -------------------------------------------------------------------------
  // GET /documentos/:id
  // -------------------------------------------------------------------------
  app.get('/:id', async (request, reply) => {
    const { tenantId } = request.user as any
    const { id } = request.params as { id: string }
    const doc = await db.documentoFiscal.findFirst({ where: { id, tenantId } })
    if (!doc) return reply.code(404).send({ error: 'Documento não encontrado' })
    return doc
  })

  // -------------------------------------------------------------------------
  // PATCH /documentos/:id/status — aprovar ou rejeitar (conciliação manual)
  // -------------------------------------------------------------------------
  app.patch('/:id/status', async (request, reply) => {
    const { tenantId } = request.user as any
    const { id } = request.params as { id: string }
    const { status, motivo } = z.object({
      status: z.enum(['CONCILIADO', 'REJEITADO', 'PENDENTE']),
      motivo: z.string().optional(),
    }).parse(request.body)

    const doc = await db.documentoFiscal.findFirst({ where: { id, tenantId } })
    if (!doc) return reply.code(404).send({ error: 'Documento não encontrado' })

    const updated = await db.documentoFiscal.update({
      where: { id },
      data: {
        status: status as any,
        observacoes: motivo ?? null,
      },
    })

    return updated
  })

  // -------------------------------------------------------------------------
  // GET /documentos/stats/:empresaId/:competencia
  // -------------------------------------------------------------------------
  app.get('/stats/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = request.params as any

    const { inicio, fim } = parsePeriodo(competencia)

    const [total, porTipo, porStatus] = await Promise.all([
      db.documentoFiscal.count({ where: { tenantId, empresaId, dataCompetencia: { gte: inicio, lte: fim } } }),
      db.documentoFiscal.groupBy({
        by: ['tipo'],
        where: { tenantId, empresaId, dataCompetencia: { gte: inicio, lte: fim } },
        _count: true,
        _sum: { valorTotal: true },
      }),
      db.documentoFiscal.groupBy({
        by: ['status'],
        where: { tenantId, empresaId, dataCompetencia: { gte: inicio, lte: fim } },
        _count: true,
      }),
    ])

    return { total, porTipo, porStatus }
  })
}
