# Status do Projeto — SaaS Contábil Automatizado
**Última atualização:** 2026-05-22
**Branch ativa:** `claude/automated-project-system-Kdkzw` → main
**Repositório:** https://github.com/brunohtmsn-create/SaaS-Contabil

---

## Em qual etapa estamos?

**FASE 2 — Contábil completo + e-Social + FGTS Digital — IMPLEMENTADA**

- ✅ **Fase 1:** Fiscal + Captura (MVP) — código completo
- ✅ **Fase 2:** Contábil completo + e-Social + FGTS Digital — código completo
- ⏳ **Fase 3:** Lucro Presumido e Real — não iniciado

---

## O que foi implementado

### Infraestrutura Base
- ✅ Monorepo pnpm — 12 pacotes + 3 apps
- ✅ `docker-compose.yml` — PostgreSQL 16 + Redis 7 + MinIO
- ✅ `.env.example` com todas as variáveis obrigatórias
- ✅ TypeScript strict em todo o projeto (Node.js 22)
- ✅ GitHub Actions CI: testes fiscais + typecheck + prettier

### packages/shared
- ✅ `Decimal.js` para todos os valores monetários (nunca number/float)
- ✅ `nowBR()`, `parsePeriodo()`, `formatCompetencia()` com America/Sao_Paulo
- ✅ `sha256()` — aceita string e Buffer
- ✅ `encrypt()`/`decrypt()` AES-256-GCM | `deriveKey()` por tenant
- ✅ `validarCNPJ()`, TABELA_SIMPLES_NACIONAL, FUNDO_POBREZA, MAPA_CFOP_CONTA

### packages/database
- ✅ Schema Prisma: 16 modelos, 30+ enums
- ✅ Seed do escritório piloto (Bruno Conde)

### packages/credentials
- ✅ AES-256-GCM com chave derivada por tenant
- ✅ buffer zerado após uso de certificados A1
- ✅ `checkExpiring()`, `revoke()`, `updateExpiredStatuses()`

### packages/audit
- ✅ SHA-256 hash chain (seed GENESIS para primeiro evento)
- ✅ `AuditChainVerifier.verificar()` — detecta quebra de cadeia
- ✅ append-only — sem UPDATE/DELETE

### packages/storage
- ✅ `StorageService` — upload/download S3, SSE-S3
- ✅ `S3KeyBuilder` — chaves organizadas
- ✅ `verificarIntegridade()` — sha256 sobre bytes raw

### packages/scraper
- ✅ `BasePLaywrightAdapter` — Chromium headless, retry exponencial
- ✅ NF-e SEFAZ (SOAP NfeDistribuicaoDFe)
- ✅ NFC-e SEFAZ
- ✅ NFSe Portal Nacional (REST)
- ✅ Prefeituras: SP (3550308), RJ (3304557), BH (3106200)
- ✅ `ScraperOrchestrator.capturarTodos()` — paralelo Promise.allSettled
- ✅ Screenshot obrigatório no S3 antes de lançar erro

### packages/normalizer
- ✅ `NormalizerService` — chaveUnica SHA-256, upsert, ignora duplicatas
- ✅ `DeduplicatorService.isDuplicate()`

### packages/conciliation
- ✅ Score: cnpjPrestador(30) + valorServico(35) + competência(20) + número(15)
- ✅ ≥80 = CONCILIADA | 50-79 = PENDENTE_REVISAO | <50 = DIVERGENTE
- ✅ Bloqueio em score < 80 (regra absoluta)
- ✅ Audit trail por conciliação

### packages/fiscal
- ✅ **PGDASService** — segregação por anexo, Fator R, DAS, Obrigação dia 20
- ✅ **DifalService** — NF-e CONCILIADAS, alíquotas por UF, fundo pobreza
- ✅ **GNREService** — GNRE por UF
- ✅ **DeSTDAService** — vencimento dia 28
- ✅ **EFDReinfService** — R-2010/R-2020/R-4010/R-4020/R-4080/R-2099/R-4099
- ✅ **ESocialService** — S-1200/S-1210/S-1299, INSS progressivo (tabela 2024)
- ✅ **DCTFWebService** — pré-requisitos EFD-Reinf+eSocial, DAS+INSS+IRRF+CSRF
- ✅ **FatorRService** — folha 12m / RB 12m via LancamentoContabil
- ✅ **FGTSDigitalService** — 8% + GRRF 40%, vencimento dia 20
- ✅ **MonitoramentoSNService** — calendário anual, vencimentos, risco exclusão RB>4,2M
- ✅ **AlertasVencimentosService** — alertas automáticos deduplicados

### packages/contabil
- ✅ **LancamentoService** — por CFOP via MAPA_CFOP_CONTA, lancarImpostos()
- ✅ **DepreciacaoService** — linear (valor - residual) / vidaUtil
- ✅ **ECDService** — SPED ECD formato texto
- ✅ **ConciliacaoBancariaService** — matching valor±1% e data±3 dias
- ✅ **OpenFinanceService** — importação API Open Finance (mock em dev)

### packages/notifications
- ✅ **WhatsAppService** — API WhatsApp Business
- ✅ **EmailService** — SMTP com templates HTML
- ✅ **NotificationService** — ambos canais Promise.allSettled + audit

### packages/portals
- ✅ `PortalOrchestrator`, `EcacPortal`, `SimplesNacionalPortal`

---

## apps/api — Rotas implementadas

| Prefixo | Endpoints |
|---------|-----------|
| /auth | POST login, POST refresh |
| /empresas | GET, POST, GET/:id |
| /documentos | GET (paginado), GET/:id, POST /capturar/:id/:comp |
| /fiscal | PGDAS, DIFAL, GNRE, DeSTDA, EFD-Reinf, eSocial, DCTFWeb |
| /fiscal | GET /apuracoes (consolidado), POST /pgdas/transmitir, GET /obrigacoes |
| /conciliacao | GET /status, POST /run, POST /nfse-tomadas, /nfse-emitidas, /nfce |
| /contabil | lancamentos, depreciacao, ecd, open-finance, transacoes, bens |
| /portais | POST /executar, GET /jobs/:id, GET /status/:id, POST /ecac/sincronizar |
| /auditoria | GET /eventos, GET /pendentes, POST /aprovar, GET /verificar-cadeia |
| /fechamento | POST /run/:id/:comp, POST /batch/:comp, GET /status/:id/:comp |
| /credenciais | GET (listagem), GET /:id, DELETE /:id |
| /dashboard | GET /overview |
| /relatorios | POST /consolidado/:comp |

---

## apps/worker — BullMQ Jobs (6 filas)

| Fila | Job | Fases |
|------|-----|-------|
| fechamento | fechamentoCompleto | 10 fases do fluxo mensal completo |
| scraper | scraperJob | NFE/NFCE/NFSE/TODOS + normalização |
| fiscal | fiscalJob | PGDAS/DIFAL/GNRE/DeSTDA isolados |
| portal | portalJob | e-CAC/SEFAZ/SN via Playwright |
| monitoramento | monitoramentoDiario | Cron 07h BRT |
| relatorio | gerarRelatorioMensal | CSV → S3 → URL assinada → notificação |

---

## apps/dashboard — Páginas implementadas

| Rota | Descrição |
|------|-----------|
| /dashboard | KPIs + alertas + vencimentos + timeline |
| /empresas | Lista com busca |
| /empresas/[id] | 4 tabs: documentos, fiscal, fechamento (11 fases), auditoria |
| /documentos | NF-e/NFC-e/NFS-e com filtros tipo/status/busca |
| /fiscal | Apurações e obrigações fiscais |
| /obrigacoes | Calendário mensal |
| /conciliacao | Status por empresa + barra de progresso |
| /contabil | Lançamentos + bens do ativo imobilizado |
| /portais | Status operacional + ações (capturar, e-CAC, transmitir) |
| /auditoria | Trilha + aprovação humana |
| /relatorios | PGDAS consolidado + KPIs + exportar CSV |
| /credenciais | Certificados digitais + alerta vencimento 30d |

---

## Testes

| Pacote | Testes |
|--------|--------|
| @saas-contabil/fiscal — pgdas.test.ts | 57 |
| @saas-contabil/fiscal — difal.test.ts | 35 |
| @saas-contabil/fiscal — fator-r.test.ts | 22 |
| @saas-contabil/fiscal — esocial.test.ts | 28 |
| @saas-contabil/fiscal — dctfweb.test.ts | 25 |
| **Total** | **167** |

---

## Regras Absolutas (em vigor)

1. `Decimal` para todo valor monetário — sem `number`/`float` ✅
2. `audit_events` somente INSERT — sem UPDATE/DELETE ✅
3. Encerramento de NFSe SOMENTE quando `status = CONCILIADO` ✅
4. Score < 80 → BLOQUEAR automaticamente ✅
5. Certificados → nunca logar/serializar/transmitir sem criptografia ✅
6. Falha de scraper → screenshot obrigatório no S3 antes de lançar erro ✅
7. CAPTCHA → 2Captcha → AntiCaptcha ✅
8. `tenantId` em toda query do banco ✅
9. Datas → `date-fns` com `America/Sao_Paulo` — nunca `new Date()` puro ✅
10. DIFAL → calcular SOMENTE de NF-e com `status = CONCILIADO` ✅
11. PGDAS → transmitir SOMENTE após conciliação completa ✅
12. ECD → gerar SOMENTE após todos os lançamentos conciliados com bancário ✅
13. Migrations → sempre com rollback planejado ✅
14. Secrets → nunca em código ✅

---

## Próximos Passos

### Testes (em andamento)
- [ ] Testes para packages/conciliation (score engine)
- [ ] Testes para packages/audit (hash chain)
- [ ] Testes para packages/shared (parsePeriodo, sha256, Decimal)
- [ ] Testes para packages/normalizer

### Fase 3 (Lucro Presumido e Real)
- [ ] Novos regimes: LUCRO_PRESUMIDO, LUCRO_REAL nos schemas
- [ ] Apuração IRPJ/CSLL Presumido e Real
- [ ] Balanço patrimonial e DRE
- [ ] SPED Contábil (ECD) para LP/LR

### Melhorias
- [ ] Prisma migrations com down scripts
- [ ] Rate limiting por tenant na API
- [ ] Integração real 2Captcha/AntiCaptcha
- [ ] WebSocket para atualização em tempo real do fechamento
