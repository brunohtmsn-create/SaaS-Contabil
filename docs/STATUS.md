# Status do Projeto — SaaS Contábil Automatizado

**Última atualização:** 2026-07-22
**Branch ativa:** `claude/automated-project-system-Kdkzw` → main (PR #86)
**Repositório:** https://github.com/brunohtmsn-create/SaaS-Contabil

---

## Em qual etapa estamos?

**FASE 3 — Lucro Presumido e Real — IMPLEMENTADA (código completo)**

- ✅ **Fase 1:** Fiscal + Captura (MVP) — código completo
- ✅ **Fase 2:** Contábil completo + e-Social + FGTS Digital — código completo
- ✅ **Fase 3:** Lucro Presumido e Real — código completo
- ⏳ **Próxima etapa:** homologação com dados reais do escritório piloto

O gap atual não é código: é **operação real** — validar scrapers e portais
governamentais com certificados de verdade, rodar um fechamento de ponta a
ponta e fazer o onboarding das ~500 empresas do piloto.

---

## O que foi implementado

### Infraestrutura Base

- ✅ Monorepo pnpm — 12 pacotes + 3 apps
- ✅ `docker-compose.yml` — PostgreSQL 16 + Redis 7 + MinIO
- ✅ `.env.example` com todas as variáveis obrigatórias
- ✅ TypeScript strict em todo o projeto (Node.js 22)
- ✅ GitHub Actions CI: testes por pacote + typecheck + prettier + pnpm audit + secret scan

### packages/shared

- ✅ `Decimal.js` para todos os valores monetários (nunca number/float)
- ✅ `nowBR()`, `parsePeriodo()`, `formatCompetencia()` com America/Sao_Paulo
- ✅ `sha256()` — aceita string e Buffer
- ✅ `encrypt()`/`decrypt()` AES-256-GCM | `deriveKey()` por tenant
- ✅ `validarCNPJ()`, TABELA_SIMPLES_NACIONAL, FUNDO_POBREZA, MAPA_CFOP_CONTA

### packages/database

- ✅ Schema Prisma: 16+ modelos, 30+ enums
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

- ✅ `BasePlaywrightAdapter` — Chromium headless, retry exponencial
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

### packages/fiscal — 37 serviços

**Simples Nacional:**

- ✅ **PGDASService** — segregação por anexo, Fator R, DAS, Obrigação dia 20
- ✅ **FatorRService** — folha 12m / RB 12m via LancamentoContabil
- ✅ **DASNService** — declaração anual (DASN/DEFIS)
- ✅ **MonitoramentoSNService** — calendário anual, vencimentos, risco exclusão RB>4,2M
- ✅ **EncerramentoSNService** — encerramento/exclusão do regime
- ✅ **DeSTDAService** — vencimento dia 28

**Federais (todos os regimes):**

- ✅ **EFDReinfService** — R-2010/R-2020/R-4010/R-4020/R-4080/R-2099/R-4099
- ✅ **ESocialService** — S-1200/S-1210/S-1299, INSS progressivo
- ✅ **DCTFWebService** — pré-requisitos EFD-Reinf+eSocial, DAS+INSS+IRRF+CSRF
- ✅ **FGTSDigitalService** — 8% + GRRF 40%, vencimento dia 20
- ✅ **RetencoesFonteService**, **INSSPatronalService**, **DCTFMensalService**
- ✅ **SPEDFiscalService**, **SPEDContribuicoesService**, **LivroFiscalService**

**Lucro Presumido / Real (Fase 3):**

- ✅ **IRPJCSLLLPService** — presunção por atividade, adicional 10%
- ✅ **IRPJCSLLLRService** + **estimativa mensal** — lucro real anual/trimestral
- ✅ **LALURService** — Parte A/B, adições e exclusões
- ✅ **PrejuizosFiscaisLRService** — trava de 30%
- ✅ **CreditosPisCofinsLRService** — regime não cumulativo
- ✅ **PisCofinsLPService** — regime cumulativo
- ✅ **ECFService**, **AjusteAnualLRService**, **DepreciacaoLRService**
- ✅ **CalendarioLPLRService** — calendário de obrigações LP/LR

**Estaduais/municipais:**

- ✅ **DifalService** — NF-e CONCILIADAS, alíquotas por UF, fundo pobreza
- ✅ **GNREService** — GNRE por UF
- ✅ **ICMSSTService**, **DMSService**

**Inteligência:**

- ✅ **SimuladorTributarioService** — comparação SN × LP × LR
- ✅ **PlanejamentoTributarioService**, **DiagnosticoFiscalService**
- ✅ **AlertasVencimentosService** — alertas automáticos deduplicados
- ✅ **RelatorioFiscalService**

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

- ✅ `PortalOrchestrator`, `EcacPortal` (situação fiscal, certidões, sincronização
  de débitos), `SimplesNacionalPortal`

---

## apps/api — Rotas implementadas (16 grupos)

| Prefixo        | Endpoints                                                                     |
| -------------- | ----------------------------------------------------------------------------- |
| /auth          | POST login, POST refresh                                                      |
| /empresas      | GET, POST, GET/:id, PATCH/:id, DELETE/:id, GET/:id/alertas                    |
| /empresas      | **POST /importar** (lote até 1000), **GET /consultar-cnpj/:cnpj** (BrasilAPI) |
| /documentos    | GET (paginado), GET/:id, POST /capturar/:id/:comp, upload em lote             |
| /fiscal        | PGDAS, DIFAL, GNRE, DeSTDA, EFD-Reinf, eSocial, DCTFWeb, LP/LR                |
| /conciliacao   | GET /status, POST /run, POST /nfse-tomadas, /nfse-emitidas, /nfce             |
| /contabil      | lancamentos, depreciacao, ecd, open-finance, transacoes, bens                 |
| /portais       | POST /executar, GET /jobs/:id, GET /status/:id, POST /ecac/sincronizar        |
| /auditoria     | GET /eventos, GET /pendentes, POST /aprovar, GET /verificar-cadeia            |
| /fechamento    | POST /run/:id/:comp, POST /batch/:comp, GET /status/:id/:comp                 |
| /credenciais   | GET (listagem), GET /:id, DELETE /:id                                         |
| /dashboard     | GET /overview                                                                 |
| /relatorios    | POST /consolidado/:comp                                                       |
| /configuracoes | configurações ISS por município                                               |
| /filas         | GET (status), GET /:nome/falhas, POST retry                                   |
| /alertas       | GET, POST, PATCH /ler-todos, PATCH /:id/ler, DELETE /:id, GET /resumo         |
| /ws            | WebSocket para atualização em tempo real                                      |

---

## apps/worker — BullMQ Jobs (7 filas)

| Fila          | Job                  | Fases                                 |
| ------------- | -------------------- | ------------------------------------- |
| fechamento    | fechamentoCompleto   | Fluxo mensal completo                 |
| scraper       | scraperJob           | NFE/NFCE/NFSE/TODOS + normalização    |
| fiscal        | fiscalJob            | PGDAS/DIFAL/GNRE/DeSTDA isolados      |
| portal        | portalJob            | e-CAC/SEFAZ/SN via Playwright         |
| monitoramento | monitoramentoDiario  | Cron 07h BRT                          |
| bancario      | bancarioJob          | Conciliação bancária Open Finance     |
| relatorio     | gerarRelatorioMensal | CSV → S3 → URL assinada → notificação |

---

## apps/dashboard — Páginas implementadas (17 telas)

| Rota               | Descrição                                                    |
| ------------------ | ------------------------------------------------------------ |
| /dashboard         | KPIs + alertas + vencimentos + timeline                      |
| /empresas          | Lista com busca, filtros por regime, stats                   |
| /empresas/nova     | Cadastro com **busca automática na Receita (BrasilAPI)**     |
| /empresas/importar | **Importação em lote via CSV** com preview e relatório       |
| /empresas/[id]     | Tabs: documentos, fiscal, fechamento, credenciais, auditoria |
| /documentos        | NF-e/NFC-e/NFS-e com filtros tipo/status/busca               |
| /fiscal            | Apurações, obrigações e fechamento em lote                   |
| /obrigacoes        | Calendário mensal                                            |
| /conciliacao       | Status por empresa + barra de progresso                      |
| /contabil          | Lançamentos + bens do ativo imobilizado                      |
| /portais           | Status operacional + ações (capturar, e-CAC, transmitir)     |
| /auditoria         | Trilha + aprovação humana                                    |
| /relatorios        | PGDAS consolidado + KPIs + exportar CSV                      |
| /credenciais       | Certificados digitais + alerta vencimento 30d                |
| /compliance        | Visão de conformidade                                        |
| /fgts              | FGTS Digital                                                 |
| /notificacoes      | Central de notificações                                      |
| /configuracoes     | Configurações do escritório                                  |
| /admin/filas       | Monitoramento de filas BullMQ + retry de jobs falhos         |

---

## Testes

**94 arquivos de teste · ~2.300 casos** distribuídos por todos os pacotes:

| Área              | Arquivos |
| ----------------- | -------- |
| packages/fiscal   | 38       |
| apps/api          | 18       |
| apps/worker       | 7        |
| packages/portals  | 5        |
| packages/scraper  | 5        |
| packages/contabil | 5        |
| demais pacotes    | 16       |

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

### Homologação (prioridade)

- [ ] Deploy de ambiente de homologação (Postgres + Redis + MinIO/S3)
- [ ] Validar scrapers contra portais reais com certificado A1 de teste
- [ ] Onboarding piloto: importar subconjunto das ~500 empresas via CSV
- [ ] Rodar fechamento de competência de ponta a ponta com dados reais
- [ ] Homologar e-CAC/SEFAZ (procurações eletrônicas)

### Melhorias técnicas

- [ ] Prisma migrations com down scripts
- [ ] Rate limiting por tenant na API (hoje é global por IP)
- [ ] Integração real 2Captcha/AntiCaptcha
- [ ] Cache da consulta CNPJ (BrasilAPI) para evitar rate limit
- [ ] Novos adaptadores de prefeitura conforme demanda do piloto
