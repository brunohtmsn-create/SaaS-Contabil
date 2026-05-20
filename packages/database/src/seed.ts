import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

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

  console.log('Tenant created:', tenant.id)

  await prisma.usuario.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@brunoconde.com.br' } },
    update: {},
    create: {
      tenantId: tenant.id,
      nome: 'Administrador',
      email: 'admin@brunoconde.com.br',
      senhaHash: '$2b$10$placeholder',
      perfil: 'ADMIN',
    },
  })

  console.log('Seed completed!')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
