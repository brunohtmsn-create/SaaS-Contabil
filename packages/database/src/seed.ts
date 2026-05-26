import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

// Empresas de demonstração para o piloto
const EMPRESAS_DEMO = [
  {
    cnpj: '11222333000181',
    razaoSocial: 'Tech Solutions ME',
    nomeFantasia: 'TechSol',
    regime: 'SIMPLES_NACIONAL' as const,
    cnae: '6201-5/00',
    uf: 'SP',
    municipio: 'São Paulo',
    ibge: '3550308',
    dataAbertura: new Date('2020-03-15'),
  },
  {
    cnpj: '22333444000155',
    razaoSocial: 'Padaria Pão de Ouro LTDA',
    nomeFantasia: 'Pão de Ouro',
    regime: 'SIMPLES_NACIONAL' as const,
    cnae: '1091-1/01',
    uf: 'SP',
    municipio: 'Guarulhos',
    ibge: '3518800',
    dataAbertura: new Date('2018-07-20'),
  },
  {
    cnpj: '33444555000196',
    razaoSocial: 'Consultoria Alfa ME',
    nomeFantasia: 'Alfa Consultoria',
    regime: 'SIMPLES_NACIONAL' as const,
    cnae: '7020-4/00',
    uf: 'SP',
    municipio: 'São Caetano do Sul',
    ibge: '3548807',
    dataAbertura: new Date('2019-01-10'),
  },
  {
    cnpj: '44555666000133',
    razaoSocial: 'Comércio e Serviços Beta EIRELI',
    nomeFantasia: 'Beta Store',
    regime: 'SIMPLES_NACIONAL' as const,
    cnae: '4771-7/01',
    uf: 'SP',
    municipio: 'Santo André',
    ibge: '3547809',
    dataAbertura: new Date('2021-05-05'),
  },
  {
    cnpj: '55666777000170',
    razaoSocial: 'Transportes Rápidos ME',
    nomeFantasia: 'TransRápidos',
    regime: 'MEI' as const,
    cnae: '4930-2/02',
    uf: 'SP',
    municipio: 'Mogi das Cruzes',
    ibge: '3530607',
    dataAbertura: new Date('2022-11-01'),
  },
]

async function main() {
  console.log('🌱 Iniciando seed do banco de dados...')

  // Senha inicial: lida do ambiente ou usa valor padrão para desenvolvimento
  const senhaInicial = process.env['SEED_ADMIN_PASSWORD'] ?? 'admin@saas2025'
  const senhaHash = await bcrypt.hash(senhaInicial, 10)

  // ─── Tenant do piloto ─────────────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { cnpj: '12345678000190' },
    update: {},
    create: {
      nome: 'Escritório Bruno Conde',
      cnpj: '12345678000190',
      subdominio: 'brunoconde',
      ativo: true,
      plano: 'PROFISSIONAL',
    },
  })
  console.log(`✅ Tenant: ${tenant.nome} (${tenant.id})`)

  // ─── Usuário administrador ───────────────────────────────────────────────
  const admin = await prisma.usuario.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@brunoconde.com.br' } },
    update: { senhaHash },
    create: {
      tenantId: tenant.id,
      nome: 'Bruno Conde',
      email: 'admin@brunoconde.com.br',
      senhaHash,
      perfil: 'ADMIN',
    },
  })
  console.log(`✅ Admin: ${admin.email}`)
  console.log(`   Senha: ${senhaInicial}`)

  // ─── Usuário contador (perfil CONTADOR) ──────────────────────────────────
  const senhaContador = await bcrypt.hash('contador@2025', 10)
  await prisma.usuario.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'contador@brunoconde.com.br' } },
    update: {},
    create: {
      tenantId: tenant.id,
      nome: 'Contador Demo',
      email: 'contador@brunoconde.com.br',
      senhaHash: senhaContador,
      perfil: 'CONTADOR',
    },
  })
  console.log(`✅ Contador: contador@brunoconde.com.br / contador@2025`)

  // ─── Empresas de demonstração ────────────────────────────────────────────
  for (const dados of EMPRESAS_DEMO) {
    const empresa = await prisma.empresaCliente.upsert({
      where: { tenantId_cnpj: { tenantId: tenant.id, cnpj: dados.cnpj } },
      update: {},
      create: {
        tenantId: tenant.id,
        ...dados,
        ativa: true,
      },
    })
    console.log(
      `✅ Empresa: ${empresa.razaoSocial} (${empresa.cnpj}) — ${empresa.municipio}/${empresa.uf}`
    )
  }

  console.log('')
  console.log('═══════════════════════════════════════════════════')
  console.log('  Seed concluído! Acesso ao sistema:')
  console.log('  URL:   http://localhost:3001')
  console.log(`  Email: admin@brunoconde.com.br`)
  console.log(`  Senha: ${senhaInicial}`)
  console.log('═══════════════════════════════════════════════════')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
