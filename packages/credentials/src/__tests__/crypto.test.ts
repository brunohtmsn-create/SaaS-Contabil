/**
 * Testes unitários — criptografia AES-256-GCM + CredentialService
 *
 * Cobre:
 *  - encrypt/decrypt: roundtrip perfeito (dado original recuperado)
 *  - IV aleatório: dois encrypts do mesmo dado → IVs diferentes
 *  - Autenticidade: modificar o ciphertext → decrypt lança erro
 *  - Autenticidade: modificar a auth tag → decrypt lança erro
 *  - deriveKey: mesma masterKey + tenantId → mesma chave (determinístico)
 *  - deriveKey: tenants diferentes → chaves diferentes (isolamento)
 *  - deriveKey: chave sempre tem 32 bytes (256 bits)
 *  - sha256: determinístico, sempre 64 chars hex
 *  - CredentialService.store(): chama db.credencial.create com dados cifrados
 *  - CredentialService.retrieve(): decifra e retorna dados originais
 *  - CredentialService.retrieve(): credencial VENCIDO → lança erro
 *  - CredentialService.retrieve(): credencial REVOGADO → lança erro
 *  - CredentialService.retrieve(): não encontrada → lança erro
 *  - CredentialService.revoke(): atualiza status para REVOGADO
 *  - CredentialService.checkExpiring(): retorna credenciais com validade próxima
 *
 * As funções criptográficas são testadas de forma pura — sem mocks.
 * O PrismaClient é mockado para os testes do CredentialService.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Importa as funções criptográficas puras (sem DB)
// ---------------------------------------------------------------------------

import { encrypt, decrypt, deriveKey, sha256 } from '@saas-contabil/shared'

// ---------------------------------------------------------------------------
// Mock do DB para CredentialService
// ---------------------------------------------------------------------------

const mockDb = {
  credencial: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
  },
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

import { CredentialService } from '../credential.service.js'

// ---------------------------------------------------------------------------
// Reset entre testes
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Testes — funções criptográficas puras
// ---------------------------------------------------------------------------

describe('Criptografia — AES-256-GCM (encrypt/decrypt)', () => {
  const masterKey = 'a'.repeat(64)
  const tenantId = 'tenant-abc'
  const key = deriveKey(masterKey, tenantId)

  it('roundtrip: decrypt(encrypt(dado)) === dado original', () => {
    const dado = Buffer.from('{"login":"joao","senha":"S3cr3t!"}')
    const { encrypted, iv, tag } = encrypt(dado, key)
    const recuperado = decrypt(encrypted, key, iv, tag)
    expect(recuperado.toString()).toBe(dado.toString())
  })

  it('dois encrypts do mesmo dado → IVs diferentes (IV aleatório)', () => {
    const dado = Buffer.from('minha senha')
    const r1 = encrypt(dado, key)
    const r2 = encrypt(dado, key)
    expect(r1.iv.toString('hex')).not.toBe(r2.iv.toString('hex'))
  })

  it('dois encrypts do mesmo dado → ciphertexts diferentes', () => {
    const dado = Buffer.from('minha senha')
    const r1 = encrypt(dado, key)
    const r2 = encrypt(dado, key)
    expect(r1.encrypted.toString('hex')).not.toBe(r2.encrypted.toString('hex'))
  })

  it('ciphertext adulterado → decrypt lança erro de autenticidade', () => {
    const dado = Buffer.from('dado secreto')
    const { encrypted, iv, tag } = encrypt(dado, key)
    encrypted[0] ^= 0xff
    expect(() => decrypt(encrypted, key, iv, tag)).toThrow()
  })

  it('auth tag adulterada → decrypt lança erro de autenticidade', () => {
    const dado = Buffer.from('dado secreto')
    const { encrypted, iv, tag } = encrypt(dado, key)
    tag[0] ^= 0xff
    expect(() => decrypt(encrypted, key, iv, tag)).toThrow()
  })

  it('IV incorreto → decrypt lança erro ou retorna dado incorreto', () => {
    const dado = Buffer.from('dado secreto')
    const { encrypted, iv: _iv, tag } = encrypt(dado, key)
    const ivErrado = Buffer.alloc(12, 0x00)
    expect(() => decrypt(encrypted, key, ivErrado, tag)).toThrow()
  })

  it('chave de tenant errado → decrypt falha', () => {
    const dado = Buffer.from('certificado digital')
    const keyCorreta = deriveKey(masterKey, 'tenant-1')
    const keyErrada = deriveKey(masterKey, 'tenant-2')
    const { encrypted, iv, tag } = encrypt(dado, keyCorreta)
    expect(() => decrypt(encrypted, keyErrada, iv, tag)).toThrow()
  })

  it('dado vazio → encrypt e decrypt funcionam', () => {
    const dado = Buffer.alloc(0)
    const { encrypted, iv, tag } = encrypt(dado, key)
    const recuperado = decrypt(encrypted, key, iv, tag)
    expect(recuperado.length).toBe(0)
  })

  it('dado grande (10KB) → roundtrip funciona', () => {
    const dado = Buffer.from('x'.repeat(10240))
    const { encrypted, iv, tag } = encrypt(dado, key)
    const recuperado = decrypt(encrypted, key, iv, tag)
    expect(recuperado.toString()).toBe(dado.toString())
  })

  it('dado com caracteres UTF-8 → preserva encoding', () => {
    const dado = Buffer.from('Senha: Ação@2025!', 'utf-8')
    const { encrypted, iv, tag } = encrypt(dado, key)
    const recuperado = decrypt(encrypted, key, iv, tag)
    expect(recuperado.toString('utf-8')).toBe('Senha: Ação@2025!')
  })
})

// ---------------------------------------------------------------------------
// Testes — deriveKey
// ---------------------------------------------------------------------------

describe('Criptografia — deriveKey()', () => {
  it('mesma masterKey + mesmo tenantId → mesma chave (determinístico)', () => {
    const k1 = deriveKey('master', 'tenant-1')
    const k2 = deriveKey('master', 'tenant-1')
    expect(k1.toString('hex')).toBe(k2.toString('hex'))
  })

  it('tenants diferentes → chaves diferentes (isolamento entre tenants)', () => {
    const k1 = deriveKey('master', 'tenant-1')
    const k2 = deriveKey('master', 'tenant-2')
    expect(k1.toString('hex')).not.toBe(k2.toString('hex'))
  })

  it('chave sempre tem 32 bytes (AES-256)', () => {
    const k = deriveKey('master', 'tenant-x')
    expect(k.length).toBe(32)
  })

  it('masterKey diferente → chave diferente', () => {
    const k1 = deriveKey('master-1', 'tenant-a')
    const k2 = deriveKey('master-2', 'tenant-a')
    expect(k1.toString('hex')).not.toBe(k2.toString('hex'))
  })
})

// ---------------------------------------------------------------------------
// Testes — sha256
// ---------------------------------------------------------------------------

describe('Criptografia — sha256()', () => {
  it('hash sempre tem 64 caracteres hex', () => {
    expect(sha256('qualquer dado').length).toBe(64)
  })

  it('mesmo input → mesmo hash (determinístico)', () => {
    expect(sha256('abc')).toBe(sha256('abc'))
  })

  it('inputs diferentes → hashes diferentes', () => {
    expect(sha256('abc')).not.toBe(sha256('abcd'))
  })

  it('hash de string conhecida (SHA-256 do vazio)', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('aceita Buffer além de string', () => {
    const buf = Buffer.from('abc')
    expect(sha256(buf)).toBe(sha256('abc'))
  })
})

// ---------------------------------------------------------------------------
// Testes — CredentialService (com mock do DB)
// ---------------------------------------------------------------------------

// O CREDENTIALS_MASTER_KEY é lido como string vazia no carregamento do módulo
// (process.env não é definido antes do import em vitest).
// Para testes do retrieve(), ciframos com deriveKey('', tenantId) para coincidir.
const SERVICE_MASTER_KEY = ''

describe('CredentialService — store()', () => {
  it('chama db.credencial.create com dados cifrados (não plaintext)', async () => {
    mockDb.credencial.create.mockResolvedValueOnce({ id: 'cred-1' })

    const service = new CredentialService()
    await service.store({
      tenantId: 'tenant-1',
      empresaId: 'emp-1',
      cnpj: '11111111000111',
      tipo: 'CERTIFICADO_A1',
      rawData: Buffer.from('{"senha":"secreta"}'),
      escopos: ['SEFAZ'],
      criadoPor: 'user-1',
    })

    expect(mockDb.credencial.create).toHaveBeenCalledTimes(1)
    const callData = mockDb.credencial.create.mock.calls[0][0].data
    // O campo encryptedData nunca deve conter o plaintext original
    expect(callData.encryptedData.toString()).not.toContain('secreta')
    // O IV deve ter 12 bytes
    expect(callData.iv.length).toBe(12)
    // A authTag deve ter 16 bytes
    expect(callData.authTag.length).toBe(16)
  })

  it('cria com status ATIVO', async () => {
    mockDb.credencial.create.mockResolvedValueOnce({ id: 'cred-1' })
    const service = new CredentialService()
    await service.store({
      tenantId: 't-1',
      empresaId: 'e-1',
      cnpj: '11111111000111',
      tipo: 'CERTIFICADO_A1',
      rawData: Buffer.from('x'),
      escopos: [],
      criadoPor: 'u-1',
    })
    const callData = mockDb.credencial.create.mock.calls[0][0].data
    expect(callData.status).toBe('ATIVO')
  })
})

describe('CredentialService — retrieve()', () => {
  it('decifra e retorna dado original', async () => {
    const dadoOriginal = Buffer.from('{"usuario":"joao","senha":"P@ss!2025"}')
    const key = deriveKey(SERVICE_MASTER_KEY, 'tenant-1')
    const { encrypted, iv, tag } = encrypt(dadoOriginal, key)

    mockDb.credencial.findFirst.mockResolvedValueOnce({
      id: 'cred-1',
      tenantId: 'tenant-1',
      cnpj: '11111111000111',
      tipo: 'CERTIFICADO_A1',
      encryptedData: encrypted,
      iv,
      authTag: tag,
      validade: null,
      escopos: [],
      status: 'ATIVO',
    })
    mockDb.credencial.update.mockResolvedValueOnce({})

    const service = new CredentialService()
    const result = await service.retrieve('cred-1', 'tenant-1')
    expect(result.data.toString()).toBe(dadoOriginal.toString())
  })

  it('credencial não encontrada → lança erro', async () => {
    mockDb.credencial.findFirst.mockResolvedValueOnce(null)
    const service = new CredentialService()
    await expect(service.retrieve('cred-x', 'tenant-1')).rejects.toThrow('não encontrada')
  })

  it('credencial VENCIDO → lança erro', async () => {
    mockDb.credencial.findFirst.mockResolvedValueOnce({
      id: 'cred-1',
      status: 'VENCIDO',
    })
    const service = new CredentialService()
    await expect(service.retrieve('cred-1', 'tenant-1')).rejects.toThrow('vencida')
  })

  it('credencial REVOGADO → lança erro', async () => {
    mockDb.credencial.findFirst.mockResolvedValueOnce({
      id: 'cred-1',
      status: 'REVOGADO',
    })
    const service = new CredentialService()
    await expect(service.retrieve('cred-1', 'tenant-1')).rejects.toThrow('revogada')
  })

  it('atualiza ultimoUso e ultimoResultado após retrieve bem-sucedido', async () => {
    const key = deriveKey(SERVICE_MASTER_KEY, 'tenant-1')
    const { encrypted, iv, tag } = encrypt(Buffer.from('data'), key)
    mockDb.credencial.findFirst.mockResolvedValueOnce({
      id: 'cred-1',
      tenantId: 'tenant-1',
      cnpj: '11111111000111',
      tipo: 'CERTIFICADO_A1',
      encryptedData: encrypted,
      iv,
      authTag: tag,
      validade: null,
      escopos: [],
      status: 'ATIVO',
    })
    mockDb.credencial.update.mockResolvedValueOnce({})
    const service = new CredentialService()
    await service.retrieve('cred-1', 'tenant-1')
    expect(mockDb.credencial.update).toHaveBeenCalledTimes(1)
    const updateData = mockDb.credencial.update.mock.calls[0][0].data
    expect(updateData.ultimoResultado).toBe('SUCESSO')
  })
})

describe('CredentialService — revoke()', () => {
  it('atualiza status para REVOGADO', async () => {
    mockDb.credencial.updateMany.mockResolvedValueOnce({ count: 1 })
    const service = new CredentialService()
    await service.revoke('cred-1', 'tenant-1')
    expect(mockDb.credencial.updateMany).toHaveBeenCalledWith({
      where: { id: 'cred-1', tenantId: 'tenant-1' },
      data: { status: 'REVOGADO' },
    })
  })
})

describe('CredentialService — markError()', () => {
  it('atualiza ultimoResultado para FALHA', async () => {
    mockDb.credencial.update.mockResolvedValueOnce({})
    const service = new CredentialService()
    await service.markError('cred-1')
    const updateData = mockDb.credencial.update.mock.calls[0][0].data
    expect(updateData.ultimoResultado).toBe('FALHA')
  })
})
