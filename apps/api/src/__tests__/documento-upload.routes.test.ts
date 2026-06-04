/**
 * Testes de integração — POST /documentos/upload
 *
 * Cobre:
 *  - NF-e XML válido → parses, normalizes e retorna 201
 *  - NFS-e XML válido → detectado por InfNfse, normalizado, retorna 201
 *  - empresaId ausente → 400
 *  - xml ausente → 400
 *  - empresaId não-UUID → 400
 *  - empresa não encontrada → 404
 *  - XML malformado (sem infNFe) → 422
 *  - documento duplicado (normalizar retorna null) → 409
 *  - S3 upload falha → ainda normaliza e retorna 201 (graceful degradation)
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import { ZodError } from 'zod'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('bullmq', () => ({
  Queue: vi.fn(() => ({ add: vi.fn().mockResolvedValue({ id: 'job-1' }) })),
}))

vi.mock('ioredis', () => ({
  Redis: vi.fn(() => ({})),
}))

const mockNormalizer = { normalizar: vi.fn() }
vi.mock('@saas-contabil/normalizer', () => ({
  NormalizerService: vi.fn(() => mockNormalizer),
}))

const mockStorage = { upload: vi.fn(), exists: vi.fn(), getSignedUrl: vi.fn() }
vi.mock('@saas-contabil/storage', () => ({
  StorageService: vi.fn(() => mockStorage),
  S3KeyBuilder: {
    xmlNFeEmitida: vi.fn(() => 's3/nfe/key'),
    xmlNFCeEmitida: vi.fn(() => 's3/nfce/key'),
    xmlNFSe: vi.fn(() => 's3/nfse/key'),
  },
}))

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    empresaCliente: { findFirst: vi.fn() },
    credencial: { findFirst: vi.fn() },
    documentoFiscal: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}))

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@saas-contabil/shared')>()
  return {
    ...actual,
    parsePeriodo: vi.fn(() => ({ inicio: new Date('2025-05-01'), fim: new Date('2025-05-31') })),
    limparCNPJ: (v: string) => v.replace(/\D/g, ''),
    formatCompetencia: vi.fn(() => '2025-05'),
  }
})

import { documentoRoutes } from '../routes/documento.routes.js'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-upload'
const USER_ID = 'user-upload'
const EMPRESA_ID = '550e8400-e29b-41d4-a716-446655440009'

const EMPRESA_MOCK = {
  id: EMPRESA_ID,
  tenantId: TENANT_ID,
  cnpj: '11111111000191',
  razaoSocial: 'Empresa Upload Ltda',
  regime: 'SIMPLES_NACIONAL',
}

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify({ logger: false })
  await app.register(jwt, { secret: 'test-secret-key-32-chars-minimum!!' })
  await app.register(multipart)

  app.addHook('onRequest', async (request) => {
    if (request.headers['x-test-skip-auth'] === '1') {
      ;(request as any).user = { sub: USER_ID, tenantId: TENANT_ID, perfil: 'CONTADOR' }
    }
  })

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'Dados inválidos', detalhes: error.errors })
    }
    const statusCode = error.statusCode ?? 500
    return reply.code(statusCode).send({ error: error.message ?? 'Erro interno' })
  })

  await app.register(documentoRoutes, { prefix: '/documentos' })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  vi.clearAllMocks()
  mockStorage.upload.mockResolvedValue(undefined)
})

// ---------------------------------------------------------------------------
// Helper: build multipart body
// ---------------------------------------------------------------------------

const BOUNDARY = '----TestBoundary7788'

function buildMultipart(
  fields: Record<string, string>,
  file?: { name: string; filename: string; content: string; contentType?: string }
): { body: string; contentType: string } {
  let body = ''

  for (const [key, value] of Object.entries(fields)) {
    body += `--${BOUNDARY}\r\n`
    body += `Content-Disposition: form-data; name="${key}"\r\n\r\n`
    body += `${value}\r\n`
  }

  if (file) {
    body += `--${BOUNDARY}\r\n`
    body += `Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n`
    body += `Content-Type: ${file.contentType ?? 'application/xml'}\r\n\r\n`
    body += `${file.content}\r\n`
  }

  body += `--${BOUNDARY}--\r\n`
  return { body, contentType: `multipart/form-data; boundary=${BOUNDARY}` }
}

function uploadReq(fields: Record<string, string>, file?: Parameters<typeof buildMultipart>[1]) {
  const { body, contentType } = buildMultipart(fields, file)
  return app.inject({
    method: 'POST',
    url: '/documentos/upload',
    headers: { 'x-test-skip-auth': '1', 'content-type': contentType },
    payload: body,
  })
}

// ---------------------------------------------------------------------------
// NF-e XML fixture
// ---------------------------------------------------------------------------

const NFE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc>
  <NFe>
    <infNFe>
      <ide><mod>55</mod><nNF>123</nNF><serie>1</serie><dhEmi>2025-05-10T10:00:00-03:00</dhEmi></ide>
      <emit>
        <CNPJ>11111111000191</CNPJ>
        <xNome>Empresa Emitente</xNome>
        <enderEmit><UF>SP</UF></enderEmit>
      </emit>
      <dest>
        <CNPJ>22222222000100</CNPJ>
        <enderDest><UF>RJ</UF></enderDest>
      </dest>
      <det><prod><CFOP>5102</CFOP></prod></det>
      <total><ICMSTot>
        <vNF>1000.00</vNF><vProd>900.00</vProd><vICMS>180.00</vICMS>
        <vST>0.00</vST><vIPI>0.00</vIPI><vPIS>6.50</vPIS>
        <vCOFINS>30.00</vCOFINS><vBC>900.00</vBC>
      </ICMSTot></total>
    </infNFe>
  </NFe>
  <protNFe><infProt><chNFe>35250511111111000191550010000001231000000001</chNFe></infProt></protNFe>
</nfeProc>`

const NFSE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<CompNfse>
  <Nfse>
    <InfNfse>
      <Numero>456</Numero>
      <DataEmissao>2025-05-15T14:00:00</DataEmissao>
      <PrestadorServico>
        <RazaoSocial>Prestadora Ltda</RazaoSocial>
        <IdentificacaoPrestador>
          <CpfCnpj><Cnpj>33333333000155</Cnpj></CpfCnpj>
        </IdentificacaoPrestador>
      </PrestadorServico>
      <TomadorServico>
        <IdentificacaoTomador>
          <CpfCnpj><Cnpj>44444444000177</Cnpj></CpfCnpj>
        </IdentificacaoTomador>
      </TomadorServico>
      <Servico>
        <Valores>
          <ValorServicos>500.00</ValorServicos>
          <ValorIss>25.00</ValorIss>
          <Aliquota>5</Aliquota>
        </Valores>
      </Servico>
      <CodigoMunicipio>3550308</CodigoMunicipio>
    </InfNfse>
  </Nfse>
</CompNfse>`

const INVALID_XML = `<?xml version="1.0"?><root><noInfNFe>nothing</noInfNFe></root>`

// ===========================================================================
// POST /documentos/upload
// ===========================================================================

describe('POST /documentos/upload — NF-e válida', () => {
  it('NF-e → normalizer chamado com tenantId e empresaId corretos', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(EMPRESA_MOCK)
    const docNormalizado = { id: 'doc-new-1', tipo: 'NFE' }
    mockNormalizer.normalizar.mockResolvedValueOnce(docNormalizado)

    await uploadReq(
      { empresaId: EMPRESA_ID },
      { name: 'xml', filename: 'nfe.xml', content: NFE_XML }
    )

    expect(mockNormalizer.normalizar).toHaveBeenCalledOnce()
    const [, calledTenantId, calledEmpresaId] = mockNormalizer.normalizar.mock.calls[0]!
    expect(calledTenantId).toBe(TENANT_ID)
    expect(calledEmpresaId).toBe(EMPRESA_ID)
  })

  it('NF-e → retorna 201 com documento normalizado', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(EMPRESA_MOCK)
    const docNormalizado = { id: 'doc-new-2', tipo: 'NFE', status: 'NORMALIZADO' }
    mockNormalizer.normalizar.mockResolvedValueOnce(docNormalizado)

    const res = await uploadReq(
      { empresaId: EMPRESA_ID },
      { name: 'xml', filename: 'nfe.xml', content: NFE_XML }
    )

    expect(res.statusCode).toBe(201)
    expect(res.json().id).toBe('doc-new-2')
  })

  it('NF-e → faz upload do XML para S3 antes de normalizar', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(EMPRESA_MOCK)
    mockNormalizer.normalizar.mockResolvedValueOnce({ id: 'doc-3' })

    await uploadReq(
      { empresaId: EMPRESA_ID },
      { name: 'xml', filename: 'nfe.xml', content: NFE_XML }
    )

    expect(mockStorage.upload).toHaveBeenCalledOnce()
    const [key, buf, mime] = mockStorage.upload.mock.calls[0]!
    expect(typeof key).toBe('string')
    expect(buf).toBeInstanceOf(Buffer)
    expect(mime).toBe('application/xml')
  })
})

describe('POST /documentos/upload — NFS-e válida', () => {
  it('NFS-e (InfNfse) → normalizer chamado com tipo NFSE_EMITIDA', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(EMPRESA_MOCK)
    mockNormalizer.normalizar.mockResolvedValueOnce({ id: 'nfse-1', tipo: 'NFSE_EMITIDA' })

    await uploadReq(
      { empresaId: EMPRESA_ID },
      { name: 'xml', filename: 'nfse.xml', content: NFSE_XML }
    )

    expect(mockNormalizer.normalizar).toHaveBeenCalledOnce()
    const [docRaw] = mockNormalizer.normalizar.mock.calls[0]!
    expect(docRaw.tipo).toBe('NFSE_EMITIDA')
  })

  it('NFS-e → retorna 201', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(EMPRESA_MOCK)
    mockNormalizer.normalizar.mockResolvedValueOnce({ id: 'nfse-2' })

    const res = await uploadReq(
      { empresaId: EMPRESA_ID },
      { name: 'xml', filename: 'nfse.xml', content: NFSE_XML }
    )

    expect(res.statusCode).toBe(201)
  })
})

describe('POST /documentos/upload — validações de entrada', () => {
  it('empresaId ausente → 400', async () => {
    const res = await uploadReq({}, { name: 'xml', filename: 'nfe.xml', content: NFE_XML })

    expect(res.statusCode).toBe(400)
  })

  it('arquivo xml ausente → 400', async () => {
    const res = await uploadReq({ empresaId: EMPRESA_ID })

    expect(res.statusCode).toBe(400)
  })

  it('empresaId não-UUID → 400', async () => {
    const res = await uploadReq(
      { empresaId: 'nao-e-uuid' },
      { name: 'xml', filename: 'nfe.xml', content: NFE_XML }
    )

    expect(res.statusCode).toBe(400)
  })

  it('empresa não encontrada (findFirst retorna null) → 404', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(null)

    const res = await uploadReq(
      { empresaId: EMPRESA_ID },
      { name: 'xml', filename: 'nfe.xml', content: NFE_XML }
    )

    expect(res.statusCode).toBe(404)
  })

  it('XML sem nó infNFe nem InfNfse → 422', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(EMPRESA_MOCK)

    const res = await uploadReq(
      { empresaId: EMPRESA_ID },
      { name: 'xml', filename: 'invalido.xml', content: INVALID_XML }
    )

    expect(res.statusCode).toBe(422)
    expect(res.json().error).toMatch(/XML inválido/i)
  })
})

describe('POST /documentos/upload — casos especiais', () => {
  it('normalizar retorna null (duplicata) → 409', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(EMPRESA_MOCK)
    mockNormalizer.normalizar.mockResolvedValueOnce(null)

    const res = await uploadReq(
      { empresaId: EMPRESA_ID },
      { name: 'xml', filename: 'nfe.xml', content: NFE_XML }
    )

    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/duplicado/i)
  })

  it('S3 upload falha → ainda normaliza e retorna 201', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(EMPRESA_MOCK)
    mockStorage.upload.mockRejectedValueOnce(new Error('S3 offline'))
    mockNormalizer.normalizar.mockResolvedValueOnce({ id: 'doc-sem-s3' })

    const res = await uploadReq(
      { empresaId: EMPRESA_ID },
      { name: 'xml', filename: 'nfe.xml', content: NFE_XML }
    )

    expect(res.statusCode).toBe(201)
    expect(mockNormalizer.normalizar).toHaveBeenCalledOnce()
  })

  it('busca empresa com tenantId do JWT (isolamento multi-tenant)', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(EMPRESA_MOCK)
    mockNormalizer.normalizar.mockResolvedValueOnce({ id: 'doc-tenant' })

    await uploadReq(
      { empresaId: EMPRESA_ID },
      { name: 'xml', filename: 'nfe.xml', content: NFE_XML }
    )

    const { where } = mockDb.empresaCliente.findFirst.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.id).toBe(EMPRESA_ID)
  })
})
