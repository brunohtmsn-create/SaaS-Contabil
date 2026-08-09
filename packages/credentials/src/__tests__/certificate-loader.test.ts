/**
 * Testes unitários — CertificateLoader
 *
 * Cobre:
 *  - extractPFX(): decodifica base64 e extrai pfxBuffer e password do JSON
 *  - extractPFX(): pfxBuffer tem o conteúdo correto (base64 → Buffer)
 *  - extractPFX(): password extraída corretamente do JSON
 *  - withCertificate(): chama fn com pfxBuffer e password corretos
 *  - withCertificate(): retorna o valor retornado por fn
 *  - withCertificate(): zera pfxBuffer após fn concluir (segurança)
 *  - withCertificate(): zera pfxBuffer mesmo quando fn lança erro (finally)
 *  - withCertificate(): propaga o erro quando fn lança
 */

import { describe, it, expect, vi } from 'vitest'
import { CertificateLoader } from '../certificate-loader.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCredential(pfxBytes: Buffer, password: string) {
  const json = JSON.stringify({ pfx: pfxBytes.toString('base64'), password })
  return {
    id: 'cred-cert-1',
    tenantId: 'tenant-cert',
    cnpj: '11111111000111',
    tipo: 'CERTIFICADO_A1_ECNPJ' as any,
    data: Buffer.from(json, 'utf8'),
    validade: null,
    escopos: ['SEFAZ'],
  }
}

const FAKE_PFX = Buffer.from([0x30, 0x82, 0x01, 0x02, 0x03])
const SENHA = 'S3cr3t@2025!'

// ---------------------------------------------------------------------------
// extractPFX
// ---------------------------------------------------------------------------

describe('CertificateLoader.extractPFX()', () => {
  it('retorna pfxBuffer decodificado do base64 corretamente', () => {
    const cred = makeCredential(FAKE_PFX, SENHA)
    const { pfxBuffer } = CertificateLoader.extractPFX(cred)
    expect(pfxBuffer).toEqual(FAKE_PFX)
  })

  it('retorna password corretamente do JSON', () => {
    const cred = makeCredential(FAKE_PFX, SENHA)
    const { password } = CertificateLoader.extractPFX(cred)
    expect(password).toBe(SENHA)
  })

  it('pfxBuffer é Buffer (não string)', () => {
    const cred = makeCredential(FAKE_PFX, SENHA)
    const { pfxBuffer } = CertificateLoader.extractPFX(cred)
    expect(Buffer.isBuffer(pfxBuffer)).toBe(true)
  })

  it('pfx com dados maiores (100 bytes) → buffer correto', () => {
    const largePfx = Buffer.alloc(100, 0xab)
    const cred = makeCredential(largePfx, 'outra-senha')
    const { pfxBuffer } = CertificateLoader.extractPFX(cred)
    expect(pfxBuffer).toEqual(largePfx)
  })
})

// ---------------------------------------------------------------------------
// withCertificate
// ---------------------------------------------------------------------------

describe('CertificateLoader.withCertificate()', () => {
  it('chama fn com pfxBuffer e password corretos', async () => {
    const fn = vi.fn().mockResolvedValue('resultado')
    const cred = makeCredential(FAKE_PFX, SENHA)
    await CertificateLoader.withCertificate(cred, fn)
    expect(fn).toHaveBeenCalledOnce()
    const [calledPfx, calledSenha] = fn.mock.calls[0] as [Buffer, string]
    expect(Buffer.isBuffer(calledPfx)).toBe(true)
    expect(calledSenha).toBe(SENHA)
  })

  it('retorna o valor retornado por fn', async () => {
    const cred = makeCredential(FAKE_PFX, SENHA)
    const resultado = await CertificateLoader.withCertificate(cred, async () => 'ok-42')
    expect(resultado).toBe('ok-42')
  })

  it('zera pfxBuffer após fn concluir com sucesso (segurança)', async () => {
    let pfxCapturado: Buffer | null = null
    const cred = makeCredential(FAKE_PFX, SENHA)

    await CertificateLoader.withCertificate(cred, async (pfx) => {
      pfxCapturado = pfx
    })

    // O buffer é zerado in-place via fill(0) no finally
    expect(pfxCapturado!.every((b) => b === 0)).toBe(true)
  })

  it('zera pfxBuffer mesmo quando fn lança erro (finally)', async () => {
    let pfxCapturado: Buffer | null = null
    const cred = makeCredential(FAKE_PFX, SENHA)

    await expect(
      CertificateLoader.withCertificate(cred, async (pfx) => {
        pfxCapturado = pfx
        throw new Error('assinatura falhou')
      })
    ).rejects.toThrow('assinatura falhou')

    expect(pfxCapturado!.every((b) => b === 0)).toBe(true)
  })

  it('propaga o erro original quando fn lança', async () => {
    const cred = makeCredential(FAKE_PFX, SENHA)
    await expect(
      CertificateLoader.withCertificate(cred, async () => {
        throw new Error('certificado inválido')
      })
    ).rejects.toThrow('certificado inválido')
  })
})
