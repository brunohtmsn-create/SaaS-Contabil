# CLAUDE.md — SaaS Contábil Automatizado

## Guia de desenvolvimento para o Claude Code

---

## Visão Geral do Projeto

Sistema SaaS B2B para escritórios de contabilidade, substituindo ferramentas como Domínio Web, SIEG, UNECONT, SPED Automation, Zenga e Robo Contábil.

**Piloto:** Escritório Bruno Conde (~500 empresas Simples Nacional)
**Fase 1:** Fiscal + Captura (MVP)
**Fase 2:** Contábil completo + e-Social + FGTS Digital
**Fase 3:** Lucro Presumido e Real

---

## Estrutura do Monorepo

```
packages/
  shared/         # Types, utils (Decimal, date-fns-tz), constants fiscais
  database/       # Prisma schema + PrismaClient singleton
  credentials/    # Cofre AES-256-GCM de certificados e procurações
  audit/          # Auditoria imutável com encadeamento SHA-256
  storage/        # AWS S3 / MinIO — S3KeyBuilder + StorageService
  scraper/        # Playwright adapters: NF-e, NFC-e, NFSe, Portal Nacional
  normalizer/     # Deduplicação e normalização para schema unificado
  conciliation/   # Conciliação NFSe tomadas/emitidas, NFC-e
  fiscal/         # PGDAS, DIFAL, GNRE, DeSTDA, EFD-Reinf, FatorR
  contabil/       # Lançamentos, depreciação, ECD, conciliação bancária
  portals/        # e-CAC, Simples Nacional, SEFAZ — Playwright
apps/
  api/            # Fastify REST + JWT multi-tenant
  dashboard/      # Next.js 14 App Router (shadcn/ui + Tailwind)
  worker/         # BullMQ jobs: fechamento, scraper, fiscal, portal
infra/
  docker-compose.yml  # Postgres 16, Redis 7, MinIO
```

---

## Stack Obrigatória

- **Runtime:** Node.js 22 + TypeScript strict
- **API:** Fastify + Zod (validação)
- **ORM:** Prisma + PostgreSQL 16 (RLS por tenant)
- **Filas:** BullMQ + Redis 7
- **Scraping:** Playwright (NUNCA Puppeteer)
- **Storage:** AWS S3 (dev: MinIO)
- **Auth:** JWT + refresh token rotativo
- **Criptografia:** AES-256-GCM para credenciais
- **Valores monetários:** `decimal.js` — NUNCA `number`/`float`
- **Frontend:** Next.js 14, Zustand, React Query, Recharts, Tailwind

---

## Comandos de Desenvolvimento

```bash
# Instalar dependências
pnpm install

# Iniciar infra local
docker compose -f infra/docker-compose.yml up -d

# Configurar banco
cp .env.example .env
pnpm db:generate
pnpm db:migrate
pnpm db:seed

# Desenvolvimento (todos os serviços)
pnpm dev

# Build completo
pnpm build

# Scraper
pnpm --filter @saas-contabil/worker tsx src/jobs/scraper.job.ts

# Fechamento completo de competência
# POST /fechamento/run/:empresaId/:competencia

# Batch (todas as empresas do tenant)
# POST /fechamento/batch/:competencia
```

---

## Regras Absolutas (NUNCA violar)

1. **`Decimal`** para todo valor monetário — sem `number`/`float`
2. **`audit_events`** é somente INSERT — sem UPDATE/DELETE
3. **Encerramento de NFSe** SOMENTE quando `status = CONCILIADO`
4. **Score < 80** → BLOQUEAR — nunca prosseguir automaticamente
5. **Certificados** → nunca logar, serializar ou transmitir sem criptografia
6. **Falha de scraper** → screenshot obrigatório no S3 antes de lançar erro
7. **CAPTCHA** → 2Captcha → AntiCaptcha — nunca falhar silenciosamente
8. **`tenantId`** em toda query do banco — sem exceção
9. **Datas** → `date-fns` com `America/Sao_Paulo` — nunca `new Date()` puro
10. **DIFAL** → calcular SOMENTE de NF-e com `status = CONCILIADO`
11. **PGDAS** → transmitir SOMENTE após conciliação completa do período
12. **ECD** → gerar SOMENTE após todos os lançamentos conciliados com bancário
13. **Migrations** → sempre com rollback planejado (`prisma migrate` + down script)
14. **Secrets** → nunca em código — `.env` + AWS Secrets Manager em produção

---

## Fluxo de Fechamento Mensal

```
1. CAPTURA         NF-e + NFC-e (SEFAZ federal) + NFSe (Portal Nacional + Prefeituras)
2. NORMALIZAÇÃO    Deduplicação + schema unificado + hash integridade
3. CONCILIAÇÃO     NFSe tomadas, NFSe emitidas, NFC-e → aguardar aprovação se divergência
4. CLASSIFICAÇÃO   Identificar: DIFAL, ICMS-ST, retenções INSS/IRRF/CSLL/PIS/COFINS
5. FATOR R         Calcular mensalmente → determinar Anexo III ou V
6. PGDAS           Apurar + segregar receitas por anexo + gerar DAS
7. EFD-REINF       R-2010, R-2020, R-4010, R-4020, R-4080 → R-2099/R-4099
8. ESOCIAL         S-1200, S-1210, S-1299 (se tiver empregados)
9. DCTFWEB         Gerar APÓS EFD-Reinf + eSocial fechados
10. ESTADUAL       DIFAL + ICMS-ST → DeSTDA → GNRE por UF
11. MUNICIPAL      ISS + DMS (onde exigido)
12. PGDAS TX       Transmitir ao Portal Simples Nacional
13. CONTÁBIL       Lançamentos + impostos + retenções + provisões + depreciação
14. BANCÁRIO       Conciliação bancária (Open Finance)
15. ARQUIVAMENTO   S3 organizado + relatório de auditoria + notificar contador
```

---

## Multi-tenancy

- Cada escritório = 1 `Tenant` com subdomínio próprio
- Cada empresa cliente = 1 `EmpresaCliente` (CNPJ) dentro do tenant
- RLS habilitado via `tenantId` em **TODAS** as tabelas
- JWT carrega `{ sub, tenantId, perfil }` — nunca confiar em body do request para `tenantId`

---

## Módulos e Responsabilidades

| Pacote         | Responsabilidade                                                     |
| -------------- | -------------------------------------------------------------------- |
| `shared`       | Tipos TS, `Decimal`, `date-fns-tz`, constantes fiscais, `sha256`     |
| `database`     | `PrismaClient` singleton, schema completo, seed                      |
| `credentials`  | Store/retrieve AES-256-GCM, detecção de vencimento, revogação        |
| `audit`        | `registrar()` append-only com hash chain, `verificar()` integridade  |
| `storage`      | Upload/download S3, `S3KeyBuilder` para chaves organizadas           |
| `scraper`      | Adapters Playwright + axios para SEFAZ, Portal Nacional, Prefeituras |
| `normalizer`   | `NormalizerService` (upsert com chaveUnica), `DeduplicatorService`   |
| `conciliation` | Score-based matching, bloqueio em score < 80, alertas automáticos    |
| `fiscal`       | PGDAS, DIFAL, GNRE, DeSTDA, EFD-Reinf, FatorR, monitoramento SN      |
| `contabil`     | Lançamentos por CFOP, depreciação linear, ECD SPED, conc. bancária   |
| `portals`      | e-CAC, Simples Nacional, SEFAZ estadual via Playwright               |
| `api`          | Fastify REST, JWT, Zod, BullMQ dispatch, multi-tenant                |
| `worker`       | BullMQ processors: fechamento, scraper, fiscal, portal               |
| `dashboard`    | Next.js 14, React Query, Recharts, Zustand auth store                |

---

## Variáveis de Ambiente Requeridas

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/saas_contabil
REDIS_URL=redis://localhost:6379
AWS_REGION=sa-east-1
AWS_S3_BUCKET=saas-contabil-dev
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
AWS_S3_ENDPOINT=http://localhost:9000   # MinIO local
CREDENTIALS_MASTER_KEY=<64-hex-chars>   # NUNCA commitar
TWO_CAPTCHA_API_KEY=
ANTI_CAPTCHA_API_KEY=
JWT_SECRET=<random-256bits>
JWT_REFRESH_SECRET=<random-256bits>
NODE_ENV=development
PORT=3000
NEXT_PUBLIC_API_URL=http://localhost:3000
```

---

## Adicionando Novo Adaptador de Prefeitura

1. Criar `packages/scraper/src/adapters/prefeitura-{ibge}.adapter.ts`
2. Implementar `PrefeituraAdapter` (interfaces/base.ts)
3. Registrar no `ScraperOrchestrator` pelo código IBGE
4. Adicionar healthCheck + retry + screenshot em falha
5. Testar com `pnpm scraper:health-check --ibge={codigo}`

---

## Calendário de Vencimentos (alertas automáticos)

| Obrigação            | Dia         | Regime   |
| -------------------- | ----------- | -------- |
| DAS Simples Nacional | 20          | SN       |
| DARF DCTFWeb         | 20          | SN/LP/LR |
| FGTS Digital         | 20          | Todos    |
| EFD-Reinf            | 15          | SN/LP/LR |
| DCTFWeb              | 15          | SN/LP/LR |
| DeSTDA               | 28          | SN       |
| DASN/DEFIS           | 31/03 anual | SN       |
| ECD                  | 30/06 anual | LP/LR    |

---

## Padrão de Erro em Jobs BullMQ

```typescript
// SEMPRE fazer screenshot antes de lançar erro de scraper
const screenshot = await page?.screenshot()
if (screenshot) {
  const s3Key = S3KeyBuilder.erroScreenshot(cnpj, `job-${job.id}`)
  await storage.upload(s3Key, screenshot, 'image/png')
}
throw new Error(`Falha no portal XXXX: ${mensagem}`)
```

---

## Aprovação Humana Obrigatória

```typescript
// Score < 80 = BLOQUEAR — registrar e notificar
if (score < 80) {
  await audit.registrar({ evento: 'PENDENTE_REVISAO_HUMANA', score })
  // PARAR AQUI — não continuar sem aprovação em /auditoria/aprovar/:eventId
}
```
