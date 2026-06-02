# Memória do Projeto — SaaS Contábil Automatizado

> Atualizado em: 2026-06-02

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

### Módulo Fiscal — Fase 3 LP/LR (packages/fiscal)

- [x] **IrpjCsllLPService** — apuração trimestral IRPJ + CSLL para Lucro Presumido
  - IRPJ 15% + adicional 10% sobre base > R$60.000/trimestre
  - CSLL 9% sobre base de presunção
  - Percentuais LP: comércio/indústria IRPJ 8%/CSLL 12%; serviços 32%/32%
  - Upsert IRPJ_LP e CSLL_LP; registra `IRPJ_CSLL_LP_APURADO` no audit
- [x] **PisCofinsLPService** — apuração mensal PIS (0,65%) e COFINS (3%) para LP/LR
  - Regime cumulativo sem aproveitamento de créditos
  - Upsert PIS e COFINS; registra `PIS_COFINS_LP_APURADO` no audit
- [x] **ECFService** — Escrituração Contábil Fiscal anual para LP/LR
  - Consolida 4 trimestres de IRPJ/CSLL; prazo 31/07 do ano seguinte
  - Upsert ECF; registra `ECF_GERADO` no audit
- [x] **DCTFMensalService** — DCTF Mensal para LP/LR
  - Agrega PIS e COFINS apurados; códigos diferentes LP (6912/2172) vs LR (5856/5960)
  - Prazo: dia 15 do M+2; registra `DCTFWEB_TRANSMITIDA` no audit

### Módulo Fiscal — Fase 1 (packages/fiscal)

- [x] **PGDASService** — apuração e transmissão ao Portal SN
- [x] **DifalService** — cálculo DIFAL por UF (somente NF-e CONCILIADOS)
- [x] **GNREService** — geração de GNRE por UF
- [x] **DeSTDAService** — geração DeSTDA (ICMS-ST/DIFAL estadual)
- [x] **EFDReinfService** — R-2010, R-2020, R-4010, R-4020, R-4080, R-2099, R-4099
- [x] **ESocialService** — S-1200, S-1210, S-1299
- [x] **DCTFWebService** — geração pós EFD-Reinf+eSocial
- [x] **FGTSDigitalService** — apuração FGTS Digital
- [x] **DMSService** — apuração DMS municipal
- [x] **DasnService** — DASN/DEFIS (Declaração Anual SN)
  - Valida regime SIMPLES_NACIONAL ou MEI
  - Agrega receita mensal de documentos CONCILIADOS
  - Cria/reutiliza Obrigação com vencimento 31/03 do ano seguinte
  - Registra evento `DASN_GERADA` no audit
- [x] **MonitoramentoSNService** — verificação de vencimentos, risco exclusão SN, gerarCalendarioAnual
- [x] **AlertasVencimentosService** — cria alertas para obrigações próximas do vencimento
- [x] **FatorRService** — cálculo do Fator R para determinar Anexo III/V
- [x] **CalendarioLPLRService** — 82 obrigações anuais LP/LR: 6 mensais × 12, IRPJ+CSLL trimestrais (T1-T4), ECD 30/06, ECF 31/07

### API (apps/api) — Endpoints Implementados

- [x] **auth.routes.ts** — `POST /login`, `POST /refresh` com rate limit 10 req/min
- [x] **empresa.routes.ts** — CRUD completo + auto-geração de calendário ao cadastrar SN/MEI
- [x] **documento.routes.ts** — CRUD de documentos fiscais com status tracking
- [x] **conciliacao.routes.ts** — conciliação com aprovação manual para score < 80
- [x] **credencial.routes.ts** — cofre AES-256-GCM de certificados
- [x] **fechamento.routes.ts** — `POST /fechamento/run/:empresaId/:competencia`, batch
- [x] **portal.routes.ts** — transmissão para e-CAC, SN, SEFAZ
- [x] **dashboard.routes.ts** — resumo, timeline, volume, alertas
- [x] **relatorio.routes.ts** — CSV consolidado mensal via S3
- [x] **audit.routes.ts** — consulta eventos com aprovação humana
- [x] **fiscal.routes.ts** — todos endpoints fiscais:
  - PGDAS: `POST/GET /fiscal/pgdas/:empresaId/:competencia`
  - PGDAS transmissão: `POST /fiscal/pgdas/transmitir/:empresaId/:competencia`
  - DIFAL: `POST/GET /fiscal/difal/:empresaId/:competencia`
  - GNRE: `POST/GET /fiscal/gnre/:empresaId/:competencia`
  - DeSTDA: `POST/GET /fiscal/destda/:empresaId/:competencia`
  - EFD-Reinf: `GET /fiscal/efdreinf/:empresaId/:competencia`
  - DMS: `GET /fiscal/dms/:empresaId/:competencia`
  - Fator R: `GET /fiscal/fator-r/:empresaId/:competencia`
  - eSocial: `POST /fiscal/esocial/:empresaId/:competencia`
  - DCTFWeb: `POST /fiscal/dctfweb/:empresaId/:competencia`
  - FGTS: `POST /fiscal/fgts/:empresaId/:competencia`
  - DASN: `POST/GET /fiscal/dasn/:empresaId/:ano`
  - Obrigações: `GET/PATCH /fiscal/obrigacoes`
  - Calendário: `POST /fiscal/obrigacoes/calendario/:empresaId/:ano`
  - **Calendário Batch SN/MEI**: `POST /fiscal/obrigacoes/calendario/batch/:ano`
  - **Calendário Batch LP/LR**: `POST /fiscal/obrigacoes/calendario/batch-lplr/:ano`
  - Calendário individual (auto-detecta regime): `POST /fiscal/obrigacoes/calendario/:empresaId/:ano`
  - Monitoramento: `GET /fiscal/monitoramento/vencimentos`
  - **Compliance**: `GET /fiscal/compliance/resumo?competencia=YYYY-MM`
  - Batch fiscal: `POST /fiscal/batch/:competencia`
  - **IRPJ+CSLL LP**: `POST/GET /fiscal/irpj-csll-lp/:empresaId/:competencia`
  - **PIS+COFINS LP**: `POST/GET /fiscal/pis-cofins-lp/:empresaId/:competencia`
  - **ECF**: `POST/GET /fiscal/ecf/:empresaId/:ano`
  - **DCTF Mensal**: `POST/GET /fiscal/dctf-mensal/:empresaId/:competencia`

### Worker (apps/worker)

- [x] **fiscal.job.ts** — 16 casos (PGDAS, DIFAL, GNRE, DESTDA, EFDREINF, ESOCIAL, DCTFWEB, FGTS, DMS, DASN, CALENDARIO_SN, CALENDARIO_LPLR, IRPJ_CSLL_LP, PIS_COFINS_LP, ECF, DCTF_MENSAL, TODOS)
- [x] **fechamento.job.ts** — fechamento mensal completo (15 etapas)
- [x] **scraper.job.ts** — captura NF-e, NFC-e, NFSe
- [x] **bancario.job.ts** — conciliação bancária
- [x] **portal.job.ts** — transmissão portais (e-CAC, SN, SEFAZ)
- [x] **monitoramento.job.ts** — monitoramento diário (cron 7h BRT)
- [x] **relatorio.job.ts** — geração CSV consolidado mensal
- [x] **Crons:** monitoramento 7h BRT diário, bancário 3h BRT diário

### Dashboard (apps/dashboard)

- [x] `/dashboard` — Painel principal com cards, gráfico de receita, alertas
- [x] `/empresas` — Lista com filtros + detalhe + nova empresa
- [x] `/empresas/nova` — Formulário com validação CNPJ, regime, IBGE
- [x] `/documentos` — Documentos fiscais com filtros
- [x] `/fiscal` — Página central de operações fiscais (PGDAS, DIFAL, etc.)
- [x] `/fiscal/dasn` — DASN/DEFIS: seletor empresa/ano, tabela mensal, badge status
- [x] **`/fiscal/lplr`** — Apuração IRPJ+CSLL (trimestral) e PIS+COFINS (mensal) para LP/LR
- [x] **`/fiscal/ecf`** — ECF anual com detalhamento por trimestre e tabela de resultados
- [x] `/obrigacoes` — Obrigações com filtros, calendário individual + **batch SN/MEI e batch LP/LR**
- [x] `/fgts` — FGTS Digital com apuração mensal
- [x] `/conciliacao` — Conciliação com aprovação/rejeição manual
- [x] `/contabil` — Lançamentos contábeis
- [x] `/portais` — Transmissão para portais governamentais
- [x] `/auditoria` — Eventos de auditoria imutáveis
- [x] `/relatorios` — Geração e download de CSV consolidado
- [x] `/credenciais` — Gerenciamento de certificados
- [x] `/configuracoes` — Configurações do escritório
- [x] **`/compliance`** — **Painel de compliance por empresa** (status ATRASADA/PROXIMA/PENDENTE/EM_DIA)
- [x] **Sidebar** — Menu lateral com todos os módulos incluindo Compliance e DASN

### Banco de Dados (packages/database)

- [x] **Schema Prisma** completo com RLS por tenantId
- [x] **Enums:** TipoObrigacao (inclui DASN, FGTS_DIGITAL, DMS, ECD, ECF), TipoApuracao (inclui IRPJ_LP, CSLL_LP, PIS, COFINS, ECD, ECF), TipoEventoAudit (inclui DASN_GERADA, CALENDARIO_ANUAL_GERADO, DMS_APURADA, IRPJ_CSLL_LP_APURADO, PIS_COFINS_LP_APURADO, ECF_GERADO)
- [x] **Prisma Client** regenerado após cada adição de enum

### Testes (Total: ~1.535 testes passando)

| Pacote                 | Testes | Status |
| ---------------------- | ------ | ------ |
| packages/shared        | 57     | ✅     |
| packages/credentials   | 45     | ✅     |
| packages/audit         | 22     | ✅     |
| packages/normalizer    | 34     | ✅     |
| packages/conciliation  | 42     | ✅     |
| packages/notifications | 56     | ✅     |
| packages/storage       | 59     | ✅     |
| packages/fiscal        | 399    | ✅     |
| packages/portals       | 58     | ✅     |
| packages/contabil      | 97     | ✅     |
| packages/scraper       | 44     | ✅     |
| apps/worker            | 91     | ✅     |
| apps/api               | 373    | ✅     |

---

## O Que Falta Implementar

### Fase 1 — Fiscal + Captura (MVP) — Pendente Complexo

- [ ] **Transmissão DASN ao Portal SN** — integração Playwright (requer credenciais e-CAC reais)
- [ ] **DMS automático** por prefeitura — adapters Playwright city-specific (requer página por prefeitura)
- [ ] **Monitoramento de débitos e-CAC** — scraper Playwright com autenticação por certificado
- [ ] **Adapters de prefeitura** — `prefeitura-{ibge}.adapter.ts` para cada cidade com NFSe

### Fase 2 — e-Social + FGTS Digital

- [ ] **Folha de pagamento** — processamento mensal S-1200, S-1210
- [ ] **eSocial transmissão** — integração com portal eSocial (Playwright)
- [ ] **FGTS Digital transmissão** — GFIP digital via portal
- [ ] **DCTFWeb automático** — transmissão após EFD-Reinf + eSocial fechados

### Fase 3 — Lucro Presumido e Real

- [x] **CalendarioLPLRService** — 82 obrigações anuais (6 mensais × 12 + IRPJ/CSLL trimestrais + ECD/ECF)
- [x] **IrpjCsllLPService** — apuração trimestral IRPJ + CSLL (com adicional 10%)
- [x] **PisCofinsLPService** — PIS 0,65% e COFINS 3% (regime cumulativo)
- [x] **ECFService** — ECF anual consolidando os 4 trimestres; prazo 31/07
- [x] **DCTFMensalService** — DCTF mensal agregando PIS+COFINS com prazo M+2/dia 15
- [x] **ECDService (contabil)** — geração arquivo SPED Contábil; validação regime LP/LR
- [x] **Páginas dashboard:** `/fiscal/lplr` (IRPJ+CSLL, PIS+COFINS), `/fiscal/ecf` (ECF anual)
- [ ] **SPED Fiscal** — EFD ICMS/IPI (para LP/LR com operações tributadas)
- [ ] **SPED Contribuições** — EFD PIS/COFINS (regime não-cumulativo LR)
- [ ] **IRPJ/CSLL Lucro Real** — ajustes de lucro contábil (apuração diferente do LP)

### Melhorias Técnicas Pendentes

- [ ] **Open Finance** — integração real para conciliação bancária automatizada
- [ ] **2Captcha/AntiCaptcha** — fallback automático implementado (serviços definidos, não integrados)
- [ ] **Healthcheck de scrapers** — `pnpm scraper:health-check --ibge={codigo}`
- [ ] **Testes E2E** — Playwright para o dashboard (apenas unit tests atualmente)
- [ ] **Migrations com rollback** — down scripts para todas as migrations existentes
- [ ] **Multi-tenant self-service** — cadastro de escritório (tenant) via interface pública

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

| Data    | Decisão                                          | Motivo                                                                             |
| ------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 2026-06 | Fastify v4 → v5                                  | CVEs críticos no jwt e multipart                                                   |
| 2026-06 | Next.js 14.2.5 → 14.2.35                         | Patches de segurança críticos                                                      |
| 2026-06 | nodemailer v6 → v7                               | CVEs corrigidos                                                                    |
| 2026-06 | Rate limit global 300 req/min                    | Proteção contra DDoS                                                               |
| 2026-06 | Rate limit login 10 req/min                      | Proteção contra força bruta                                                        |
| 2026-06 | `--ignore-unfixable` no CI                       | CVEs do Next.js 14 sem fix (requer v15)                                            |
| 2026-06 | `Date.UTC()` para vencimentos                    | `date-fns-tz` não disponível no pacote fiscal                                      |
| 2026-06 | Auto-calendário no cadastro SN/MEI               | UX: evitar passo manual no onboarding                                              |
| 2026-06 | `Promise.allSettled` no batch                    | Não bloqueia na primeira falha de empresa                                          |
| 2026-06 | `nowBR` mocked para `2025-06-01` nos testes      | Data fixa para comparações de vencimento                                           |
| 2026-06 | Calendário LP/LR auto-detecta regime no endpoint | Endpoint único `/calendario/:id/:ano` chama serviço correto                        |
| 2026-06 | T4 LP pode vencer em fevereiro                   | 31/01 pode cair em fds, deslocando para 02/02 — teste usa `toBeLessThanOrEqual(1)` |
| 2026-06 | ECDService no pacote contabil (não fiscal)       | Arquitetura: ECD é obrigação contábil; fiscal seria duplicação errada              |
| 2026-06 | DCTFMensal usa tipo DCTFWEB no banco             | TipoApuracao não tem DCTF_MENSAL; DCTFWEB é o tipo unificado                       |
| 2026-06 | Código de receita PIS LP=6912, LR=5856           | DCTF Mensal diferencia LP (cumulativo) de LR (não-cumulativo)                      |
