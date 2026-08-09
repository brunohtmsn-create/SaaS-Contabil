/**
 * Testes unitários — StorageService
 *
 * Cobre:
 *  - upload(): chama PutObjectCommand com chave e contentType corretos
 *  - upload(): retorna UploadResult com s3Key, bucket, size e hash
 *  - upload(): usa AES256 como ServerSideEncryption
 *  - upload(): calcula sha256 do conteúdo
 *  - download(): lê chunks do stream e retorna Buffer correto
 *  - download(): retorna contentType da resposta S3
 *  - exists(): retorna true quando HeadObjectCommand não lança
 *  - exists(): retorna false quando HeadObjectCommand lança erro
 *  - delete(): envia DeleteObjectCommand com s3Key correto
 *  - getSignedUrl(): chama getSignedUrl com expiresIn correto
 *  - registrarArquivo(): cria registro no db com todos os campos
 *  - registrarArquivo(): registra evento de auditoria ARQUIVO_SALVO
 *  - verificarIntegridade(): retorna true quando hash bate
 *  - verificarIntegridade(): retorna false quando hash difere
 *  - verificarIntegridade(): retorna false quando download falha
 *
 * S3Client, getSignedUrl, PrismaClient e AuditService são mockados.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockS3Send, mockGetSignedUrl, mockDb, mockAudit } = vi.hoisted(() => ({
  mockS3Send: vi.fn(),
  mockGetSignedUrl: vi.fn(),
  mockDb: { arquivoS3: { create: vi.fn() } },
  mockAudit: { registrar: vi.fn() },
}))

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send: mockS3Send })),
  PutObjectCommand: vi.fn((args: Record<string, unknown>) => ({ type: 'PUT', ...args })),
  GetObjectCommand: vi.fn((args: Record<string, unknown>) => ({ type: 'GET', ...args })),
  HeadObjectCommand: vi.fn((args: Record<string, unknown>) => ({ type: 'HEAD', ...args })),
  DeleteObjectCommand: vi.fn((args: Record<string, unknown>) => ({ type: 'DELETE', ...args })),
}))

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}))

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn(() => mockAudit),
}))

import { StorageService } from '../storage.service.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStream(data: Buffer): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield new Uint8Array(data)
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env['AWS_S3_BUCKET']
})

// ===========================================================================
// upload
// ===========================================================================

describe('StorageService.upload()', () => {
  it('envia PutObjectCommand com s3Key e contentType corretos', async () => {
    mockS3Send.mockResolvedValueOnce({})
    const svc = new StorageService()
    const data = Buffer.from('conteudo')

    await svc.upload('tenant/docs/nfe.xml', data, 'application/xml')

    const cmd = mockS3Send.mock.calls[0][0]
    expect(cmd.Key).toBe('tenant/docs/nfe.xml')
    expect(cmd.ContentType).toBe('application/xml')
  })

  it('retorna UploadResult com s3Key, size e hash corretos', async () => {
    mockS3Send.mockResolvedValueOnce({})
    const svc = new StorageService()
    const data = Buffer.from('hello')

    const result = await svc.upload('s3key', data, 'text/plain')

    expect(result.s3Key).toBe('s3key')
    expect(result.size).toBe(5)
    expect(typeof result.hash).toBe('string')
    expect(result.hash).toHaveLength(64) // sha256 hex
  })

  it('usa AES256 como ServerSideEncryption', async () => {
    mockS3Send.mockResolvedValueOnce({})
    const svc = new StorageService()

    await svc.upload('key', Buffer.from('x'), 'text/plain')

    const cmd = mockS3Send.mock.calls[0][0]
    expect(cmd.ServerSideEncryption).toBe('AES256')
  })

  it('inclui metadata adicional quando fornecida', async () => {
    mockS3Send.mockResolvedValueOnce({})
    const svc = new StorageService()

    await svc.upload('key', Buffer.from('x'), 'text/plain', {
      tenantId: 't1',
      competencia: '2025-05',
    })

    const cmd = mockS3Send.mock.calls[0][0]
    expect(cmd.Metadata.tenantId).toBe('t1')
    expect(cmd.Metadata.competencia).toBe('2025-05')
  })

  it('usa bucket do env AWS_S3_BUCKET', async () => {
    process.env['AWS_S3_BUCKET'] = 'meu-bucket-prod'
    mockS3Send.mockResolvedValueOnce({})
    const svc = new StorageService()

    const result = await svc.upload('key', Buffer.from('x'), 'text/plain')

    expect(result.bucket).toBe('meu-bucket-prod')
    delete process.env['AWS_S3_BUCKET']
  })
})

// ===========================================================================
// download
// ===========================================================================

describe('StorageService.download()', () => {
  it('retorna dados como Buffer concatenado', async () => {
    const payload = Buffer.from('arquivo-binario')
    mockS3Send.mockResolvedValueOnce({
      Body: makeStream(payload),
      ContentType: 'application/pdf',
    })

    const svc = new StorageService()
    const result = await svc.download('docs/arquivo.pdf')

    expect(result.data).toEqual(payload)
    expect(result.size).toBe(payload.length)
  })

  it('retorna contentType da resposta S3', async () => {
    mockS3Send.mockResolvedValueOnce({
      Body: makeStream(Buffer.from('ok')),
      ContentType: 'application/xml',
    })

    const svc = new StorageService()
    const result = await svc.download('key')

    expect(result.contentType).toBe('application/xml')
  })

  it('usa application/octet-stream quando ContentType está ausente', async () => {
    mockS3Send.mockResolvedValueOnce({
      Body: makeStream(Buffer.from('ok')),
    })

    const svc = new StorageService()
    const result = await svc.download('key')

    expect(result.contentType).toBe('application/octet-stream')
  })
})

// ===========================================================================
// exists
// ===========================================================================

describe('StorageService.exists()', () => {
  it('retorna true quando HeadObjectCommand não lança erro', async () => {
    mockS3Send.mockResolvedValueOnce({})

    const svc = new StorageService()
    const result = await svc.exists('tenant/relatorios/2025-05/consolidado.csv')

    expect(result).toBe(true)
  })

  it('retorna false quando HeadObjectCommand lança erro', async () => {
    mockS3Send.mockRejectedValueOnce(new Error('Not Found'))

    const svc = new StorageService()
    const result = await svc.exists('chave-inexistente')

    expect(result).toBe(false)
  })
})

// ===========================================================================
// delete
// ===========================================================================

describe('StorageService.delete()', () => {
  it('envia DeleteObjectCommand com s3Key correto', async () => {
    mockS3Send.mockResolvedValueOnce({})

    const svc = new StorageService()
    await svc.delete('tenant/docs/antigo.xml')

    const cmd = mockS3Send.mock.calls[0][0]
    expect(cmd.Key).toBe('tenant/docs/antigo.xml')
    expect(cmd.type).toBe('DELETE')
  })
})

// ===========================================================================
// getSignedUrl
// ===========================================================================

describe('StorageService.getSignedUrl()', () => {
  it('retorna URL assinada com expiresIn padrão (3600)', async () => {
    mockGetSignedUrl.mockResolvedValueOnce('https://signed.url/key?token=abc')

    const svc = new StorageService()
    const url = await svc.getSignedUrl('tenant/docs/nfe.xml')

    expect(url).toBe('https://signed.url/key?token=abc')
    expect(mockGetSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'GET', Key: 'tenant/docs/nfe.xml' }),
      { expiresIn: 3600 }
    )
  })

  it('usa expiresIn customizado', async () => {
    mockGetSignedUrl.mockResolvedValueOnce('https://signed.url/key?x=y')

    const svc = new StorageService()
    await svc.getSignedUrl('key', 7200)

    expect(mockGetSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      expiresIn: 7200,
    })
  })
})

// ===========================================================================
// registrarArquivo
// ===========================================================================

describe('StorageService.registrarArquivo()', () => {
  it('cria registro no db com todos os campos', async () => {
    mockDb.arquivoS3.create.mockResolvedValueOnce({ id: 'arq-1' })
    mockAudit.registrar.mockResolvedValueOnce(undefined)

    const svc = new StorageService()
    await svc.registrarArquivo(
      'tenant-x',
      'emp-y',
      '11222333000181',
      '2025-05',
      'NFE',
      'tenant-x/nfe/2025-05/doc.xml',
      'nfe-001.xml',
      2048,
      'abcdef123'
    )

    const data = mockDb.arquivoS3.create.mock.calls[0][0].data
    expect(data.tenantId).toBe('tenant-x')
    expect(data.empresaId).toBe('emp-y')
    expect(data.cnpj).toBe('11222333000181')
    expect(data.competencia).toBe('2025-05')
    expect(data.s3Key).toBe('tenant-x/nfe/2025-05/doc.xml')
    expect(data.nome).toBe('nfe-001.xml')
    expect(data.tamanho).toBe(2048)
    expect(data.hash).toBe('abcdef123')
  })

  it('registra evento de auditoria ARQUIVO_SALVO', async () => {
    mockDb.arquivoS3.create.mockResolvedValueOnce({ id: 'arq-2' })
    mockAudit.registrar.mockResolvedValueOnce(undefined)

    const svc = new StorageService()
    await svc.registrarArquivo(
      'tenant-z',
      'emp-z',
      '99888777000100',
      '2025-06',
      'DESTDA',
      's3key',
      'destda.txt',
      1024,
      'hash-xyz'
    )

    expect(mockAudit.registrar).toHaveBeenCalledOnce()
    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.evento).toBe('ARQUIVO_SALVO')
    expect(auditCall.tenantId).toBe('tenant-z')
    expect(auditCall.estadoNovo.s3Key).toBe('s3key')
  })
})

// ===========================================================================
// verificarIntegridade
// ===========================================================================

describe('StorageService.verificarIntegridade()', () => {
  it('retorna true quando hash do download bate com esperado', async () => {
    const content = Buffer.from('conteudo-integro')
    mockS3Send.mockResolvedValueOnce({
      Body: makeStream(content),
      ContentType: 'application/xml',
    })

    const svc = new StorageService()
    // Calcula o sha256 real do conteúdo
    const { sha256: computeSha256 } = await import('@saas-contabil/shared')
    const hashReal = computeSha256(content)

    const result = await svc.verificarIntegridade('key', hashReal)
    expect(result).toBe(true)
  })

  it('retorna false quando hash difere', async () => {
    mockS3Send.mockResolvedValueOnce({
      Body: makeStream(Buffer.from('dados-corrompidos')),
      ContentType: 'text/plain',
    })

    const svc = new StorageService()
    const result = await svc.verificarIntegridade('key', 'hash-errado-aqui')

    expect(result).toBe(false)
  })

  it('retorna false quando download lança erro (arquivo não encontrado)', async () => {
    mockS3Send.mockRejectedValueOnce(new Error('NoSuchKey'))

    const svc = new StorageService()
    const result = await svc.verificarIntegridade('chave-inexistente', 'qualquer-hash')

    expect(result).toBe(false)
  })
})

// ===========================================================================
// Configuração S3Client com endpoint (MinIO / S3-compatible)
// ===========================================================================

describe('StorageService — construtor com AWS_S3_ENDPOINT (MinIO)', () => {
  it('passa endpoint e forcePathStyle ao S3Client quando AWS_S3_ENDPOINT definido', async () => {
    const { S3Client } = await import('@aws-sdk/client-s3')
    const mockConstructor = S3Client as unknown as ReturnType<typeof vi.fn>
    mockConstructor.mockClear()

    process.env['AWS_S3_ENDPOINT'] = 'http://localhost:9000'
    process.env['AWS_REGION'] = 'sa-east-1'

    new StorageService()

    const constructorArgs = mockConstructor.mock.calls[0][0]
    expect(constructorArgs.endpoint).toBe('http://localhost:9000')
    expect(constructorArgs.forcePathStyle).toBe(true)

    delete process.env['AWS_S3_ENDPOINT']
  })

  it('S3Client sem endpoint quando AWS_S3_ENDPOINT não definido', async () => {
    const { S3Client } = await import('@aws-sdk/client-s3')
    const mockConstructor = S3Client as unknown as ReturnType<typeof vi.fn>
    mockConstructor.mockClear()

    delete process.env['AWS_S3_ENDPOINT']

    new StorageService()

    const constructorArgs = mockConstructor.mock.calls[0][0]
    expect(constructorArgs.endpoint).toBeUndefined()
    expect(constructorArgs.forcePathStyle).toBeUndefined()
  })
})
