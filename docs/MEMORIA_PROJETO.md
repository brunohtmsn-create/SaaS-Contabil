# Memória do Projeto — SaaS Contábil Automatizado

> Atualizado em: 2026-06-01

---

## Visão Geral

Sistema SaaS B2B para escritórios de contabilidade que substitui ferramentas como Domínio Web, SIEG, UNECONT, SPED Automation, Zenga e Robo Contábil.

- **Piloto:** Escritório Bruno Conde (~500 empresas Simples Nacional)
- **Repositório:** `brunohtmsn-create/SaaS-Contabil`
- **Branch de desenvolvimento ativo:** `claude/automated-project-system-Kdkzw`
- **PR ativo:** #86 (draft)

---

## Stack Técnica

| Camada             | Tecnologia                                           |
| ------------------ | ---------------------------------------------------- |
| Runtime            | Node.js 22 + TypeScript strict                       |
| API                | Fastify v5.8.5 + Zod                                 |
| ORM                | Prisma + PostgreSQL 16 (RLS por tenant)              |
| Filas              | BullMQ + Redis 7                                     |
| Scraping           | Playwright (NUNCA Puppeteer)                         |
| Storage            | AWS S3 (dev: MinIO)                                  |
| Auth               | JWT + refresh token rotativo                         |
| Criptografia       | AES-256-GCM para credenciais                         |
| Valores monetários | `decimal.js` — NUNCA `number`/`float`                |
| Frontend           | Next.js 14, Zustand, React Query, Recharts, Tailwind |
| Testes             | Vitest                                               |

---

## Estrutura do Monorepo

```
packages/
  shared/         Types, utils (Decimal, date-fns-tz), constantes fiscais
  database/       Prisma schema + PrismaClient singleton
  credentials/    Cofre AES-256-GCM de certificados e procurações
  audit/          Auditoria imutável com encadeamento SHA-256
  storage/        AWS S3 / MinIO — S3KeyBuilder + StorageService
  scraper/        Playwright adapters: NF-e, NFC-e, NFSe, Portal Nacional
  normalizer/     Deduplicação e normalização para schema unificado
  conciliation/   Conciliação NFSe tomadas/emitidas, NFC-e
  fiscal/         PGDAS, DIFAL, GNRE, DeSTDA, EFD-Reinf, FatorR, DASN
  contabil/       Lançamentos, depreciação, ECD, conciliação bancária
  portals/        e-CAC, Simples Nacional, SEFAZ — Playwright
apps/
  api/            Fastify REST + JWT multi-tenant
  dashboard/      Next.js 14 App Router (shadcn/ui + Tailwind)
  worker/         BullMQ jobs: fechamento, scraper, fiscal, portal
infra/
  docker-compose.yml  Postgres 16, Redis 7, MinIO
```

---

## O Que Foi Implementado e Validado

### Segurança e Infraestrutura

- [x] **Fastify v4 → v5** — migração completa, tipos TypeScript corrigidos
- [x] **@fastify/jwt v8 → v9** — CVEs corrigidos
- [x] **@fastify/multipart v8 → v9** — CVEs corrigidos
- [x] **Next.js 14.2.5 → 14.2.35** — patches de segurança
- [x] **nodemailer v6 → v7** — CVEs corrigidos
- [x] **Rate limiting global** — 300 req/min + login 10 req/min (`@fastify/rate-limit`)
- [x] **pnpm overrides** para forçar `fast-jwt>=6.2.4`, `glob>=10.5.0`, `minimatch>=9.0.6`
- [x] **CI security workflow** — `pnpm audit --audit-level=high --ignore-unfixable`
- [x] **`.gitignore`** — `*.tsbuildinfo` excluído do tracking

### Módulo Fiscal (packages/fiscal)

- [x] **PGDASService** — apuração e transmissão ao Portal SN
- [x] **DifalService** — cálculo DIFAL por UF (somente NF-e CONCILIADOS)
- [x] **GNREService** — geração de GNRE por UF
- [x] **DeSTDAService** — geração DeSTDA (ICMS-ST/DIFAL estadual)
- [x] **EFDReinfService** — R-2010, R-2020, R-4010, R-4020, R-4080, R-2099, R-4099
- [x] **ESocialService** — S-1200, S-1210, S-1299
- [x] **DCTFWebService** — geração pós EFD-Reinf+eSocial
- [x] **FGTSDigitalService** — apuração FGTS Digital
- [x] **DMSService** — apuração DMS municipal
- [x] **DasnService** — DASN/DEFIS (Declaração Anual SN) ← **adicionado nesta sessão**
  - Valida regime SIMPLES_NACIONAL ou MEI
  - Agrega receita mensal de documentos CONCILIADOS
  - Cria/reutiliza Obrigação com vencimento 31/03 do ano seguinte
  - Registra evento `DASN_GERADA` no audit

### API (apps/api)

- [x] **auth.routes.ts** — login + refresh token com rate limit
- [x] **fiscal.routes.ts** — todos endpoints fiscais incluindo:
  - `POST /fiscal/pgdas/:empresaId/:competencia`
  - `POST /fiscal/difal/:empresaId/:competencia`
  - `POST /fiscal/gnre/:empresaId/:competencia`
  - `POST /fiscal/destda/:empresaId/:competencia`
  - `POST /fiscal/efdreinf/:empresaId/:competencia`
  - `POST /fiscal/esocial/:empresaId/:competencia`
  - `POST /fiscal/dctfweb/:empresaId/:competencia`
  - `POST /fiscal/fgts/:empresaId/:competencia`
  - `POST /fiscal/dms/:empresaId/:competencia`
  - `POST /fiscal/dasn/:empresaId/:ano` ← **adicionado nesta sessão**
  - `GET  /fiscal/dasn/:empresaId/:ano` ← **adicionado nesta sessão**

### Worker (apps/worker)

- [x] **fiscal.job.ts** — roteamento de operações fiscais incluindo DASN ← **atualizado nesta sessão**
- [x] **fechamento.job.ts** — fechamento mensal completo (15 etapas)
- [x] **scraper.job.ts** — captura NF-e, NFC-e, NFSe
- [x] **bancario.job.ts** — conciliação bancária
- [x] **portal.job.ts** — transmissão portais (e-CAC, SN, SEFAZ)
- [x] **monitoramento.job.ts** — monitoramento de obrigações
- [x] **relatorio.job.ts** — geração de relatórios

### Dashboard (apps/dashboard)

- [x] **Página DASN** (`/fiscal/dasn`) ← **adicionado nesta sessão**
  - Seletor de empresa (filtrado SN/MEI)
  - Seletor de ano-base
  - Botão gerar/regenerar DASN
  - Badge completo/incompleto
  - Cards de resumo
  - Tabela mensal com flags PGDAS

### Banco de Dados (packages/database)

- [x] **Schema Prisma** completo com RLS por tenantId
- [x] **Enum TipoObrigacao** inclui `DASN` ← **adicionado nesta sessão**
- [x] **Enum TipoEventoAudit** inclui `DASN_GERADA` ← **adicionado nesta sessão**

### Testes

| Pacote          | Testes                    | Status      |
| --------------- | ------------------------- | ----------- |
| packages/fiscal | 11 testes DasnService     | ✅ passando |
| apps/api        | 332 testes (incl. 8 DASN) | ✅ passando |
| apps/worker     | 85 testes (incl. 1 DASN)  | ✅ passando |

---

## O Que Falta Implementar

### Fase 1 — Fiscal + Captura (MVP) — Em Andamento

- [ ] **Transmissão DASN ao Portal SN** — integração Playwright no portals/
- [ ] **DMS automático** por prefeitura — adapters faltando para a maioria das cidades
- [ ] **Monitoramento de débitos** no e-CAC — alertas automáticos
- [ ] **Calendário fiscal automático** — geração de Obrigacao p/ todo o ano na onboarding
- [ ] **Notificações por e-mail** — vencimentos próximos, obrigações em atraso
- [ ] **Dashboard de compliance** — visão geral de todas empresas com pendências

### Fase 2 — e-Social + FGTS Digital

- [ ] **Folha de pagamento** — processamento mensal S-1200, S-1210
- [ ] **eSocial transmissão** — integração com portal eSocial
- [ ] **FGTS Digital transmissão** — GFIP digital
- [ ] **DCTFWeb automático** — após EFD-Reinf + eSocial fechados

### Fase 3 — Lucro Presumido e Real

- [ ] **ECF** — Escrituração Contábil Fiscal (LP/LR)
- [ ] **ECD** — Escrituração Contábil Digital (LP/LR)
- [ ] **IRPJ/CSLL** — apuração trimestral/anual
- [ ] **DCTF mensal** — (LP/LR — diferente de DCTFWeb)
- [ ] **SPED Fiscal** — EFD ICMS/IPI (LP/LR)
- [ ] **SPED Contribuições** — EFD PIS/COFINS (LP/LR)

### Melhorias Técnicas Pendentes

- [ ] **Open Finance** — integração para conciliação bancária automatizada
- [ ] **2Captcha/AntiCaptcha** — implementar fallback automático
- [ ] **Healthcheck de scrapers** — `pnpm scraper:health-check --ibge={codigo}`
- [ ] **Testes E2E** — Playwright para o dashboard
- [ ] **Migrations com rollback** — down scripts para todas as migrations
- [ ] **Onboarding de empresa** — wizard de cadastro + upload certificado digital
- [ ] **Multi-tenant self-service** — cadastro de escritório de contabilidade

---

## Regras Absolutas (Nunca Violar)

1. `Decimal` para todo valor monetário — sem `number`/`float`
2. `audit_events` é somente INSERT — sem UPDATE/DELETE
3. Encerramento de NFSe SOMENTE quando `status = CONCILIADO`
4. Score < 80 → BLOQUEAR — nunca prosseguir automaticamente
5. Certificados → nunca logar, serializar ou transmitir sem criptografia
6. Falha de scraper → screenshot obrigatório no S3 antes de lançar erro
7. CAPTCHA → 2Captcha → AntiCaptcha — nunca falhar silenciosamente
8. `tenantId` em toda query do banco — sem exceção
9. Datas → `date-fns` com `America/Sao_Paulo` — nunca `new Date()` puro
10. DIFAL → calcular SOMENTE de NF-e com `status = CONCILIADO`
11. PGDAS → transmitir SOMENTE após conciliação completa do período
12. ECD → gerar SOMENTE após todos os lançamentos conciliados com bancário
13. Migrations → sempre com rollback planejado
14. Secrets → nunca em código — `.env` + AWS Secrets Manager em produção
15. JWT carrega `{ sub, tenantId, perfil }` — nunca confiar em body do request para `tenantId`

---

## Calendário de Vencimentos

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

## Histórico de Decisões Técnicas

| Data    | Decisão                       | Motivo                                        |
| ------- | ----------------------------- | --------------------------------------------- |
| 2026-06 | Fastify v4 → v5               | CVEs críticos no jwt e multipart              |
| 2026-06 | Next.js 14.2.5 → 14.2.35      | Patches de segurança críticos                 |
| 2026-06 | nodemailer v6 → v7            | CVEs corrigidos                               |
| 2026-06 | Rate limit global 300 req/min | Proteção contra DDoS                          |
| 2026-06 | Rate limit login 10 req/min   | Proteção contra força bruta                   |
| 2026-06 | `--ignore-unfixable` no CI    | CVEs do Next.js 14 sem fix (requer v15)       |
| 2026-06 | `Date.UTC()` para vencimentos | `date-fns-tz` não disponível no pacote fiscal |
