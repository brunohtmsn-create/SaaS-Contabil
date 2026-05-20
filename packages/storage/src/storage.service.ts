import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getPrismaClient } from '@saas-contabil/database'
import { sha256 } from '@saas-contabil/shared'
import { AuditService } from '@saas-contabil/audit'
import type { UploadResult, DownloadResult } from './types.js'

export class StorageService {
  private s3: S3Client
  private bucket: string
  private db = getPrismaClient()
  private audit = new AuditService()

  constructor() {
    this.bucket = process.env['AWS_S3_BUCKET'] ?? 'saas-contabil-dev'
    this.s3 = new S3Client({
      region: process.env['AWS_REGION'] ?? 'sa-east-1',
      endpoint: process.env['AWS_S3_ENDPOINT'],
      credentials: {
        accessKeyId: process.env['AWS_ACCESS_KEY_ID'] ?? '',
        secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] ?? '',
      },
      forcePathStyle: !!process.env['AWS_S3_ENDPOINT'],
    })
  }

  async upload(
    s3Key: string,
    data: Buffer,
    contentType: string,
    metadata?: Record<string, string>
  ): Promise<UploadResult> {
    const hash = sha256(data.toString('base64'))

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
        Body: data,
        ContentType: contentType,
        Metadata: { hash, ...metadata },
        ServerSideEncryption: 'AES256',
      })
    )

    return {
      s3Key,
      bucket: this.bucket,
      url: `s3://${this.bucket}/${s3Key}`,
      size: data.length,
      hash,
    }
  }

  async download(s3Key: string): Promise<DownloadResult> {
    const result = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: s3Key })
    )

    const chunks: Uint8Array[] = []
    for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk)
    }

    const data = Buffer.concat(chunks)

    return {
      data,
      contentType: result.ContentType ?? 'application/octet-stream',
      size: data.length,
    }
  }

  async getSignedUrl(s3Key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: s3Key })
    return getSignedUrl(this.s3, command, { expiresIn })
  }

  async exists(s3Key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: s3Key }))
      return true
    } catch {
      return false
    }
  }

  async delete(s3Key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: s3Key }))
  }

  async registrarArquivo(
    tenantId: string,
    empresaId: string,
    cnpj: string,
    competencia: string,
    categoria: string,
    s3Key: string,
    nome: string,
    tamanho: number,
    hash: string
  ): Promise<void> {
    await this.db.arquivoS3.create({
      data: {
        tenantId,
        empresaId,
        cnpj,
        competencia,
        categoria: categoria as any,
        s3Key,
        nome,
        tamanho,
        hash,
      },
    })

    await this.audit.registrar({
      tenantId,
      cnpj,
      entidadeTipo: 'ARQUIVO_S3',
      entidadeId: s3Key,
      evento: 'ARQUIVO_SALVO',
      estadoNovo: { s3Key, nome, tamanho, hash },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })
  }

  async verificarIntegridade(s3Key: string, hashEsperado: string): Promise<boolean> {
    try {
      const { data } = await this.download(s3Key)
      const hashAtual = sha256(data.toString('base64'))
      return hashAtual === hashEsperado
    } catch {
      return false
    }
  }
}
