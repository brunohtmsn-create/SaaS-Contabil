# Status do Projeto — SaaS Contábil Automatizado
**Última atualização:** 2026-05-22
**Branch ativa:** `claude/automated-project-system-Kdkzw`
**Commits locais:** 2 (não publicados no GitHub ainda — problema de permissão)

---

## Em qual etapa estamos?

**FASE 1 — MVP Fiscal + Captura — ESTRUTURA BASE COMPLETA (código implementado, não testado em produção)**

O projeto foi especificado para ser construído em 3 fases:
- ✅ **Fase 1:** Fiscal + Captura (MVP) — **código implementado**
- ⏳ **Fase 2:** Contábil completo + e-Social + FGTS Digital — parcialmente estruturado
- ⏳ **Fase 3:** Lucro Presumido e Real — não iniciado

---

## O que já foi implementado

### Infraestrutura Base
- ✅ Monorepo pnpm com 11 pacotes + 3 aplicações
- ✅ `docker-compose.yml` — PostgreSQL 16 + Redis 7 + MinIO
- ✅ `.env.example` com todas as variáveis obrigatórias
- ✅ TypeScript strict em todo o projeto (Node.js 22)

### packages/shared — Fundação Compartilhada
- ✅ Tipos TypeScript globais (Tenant, EmpresaCliente, DocumentoFiscal com todos os campos fiscais)
- ✅ `Decimal.js` configurado com precisão 20 e arredondamento HALF_UP
- ✅ `nowBR()`, `parsePeriodo()`, `formatCompetencia()`, `competencias12Meses()` com timezone America/Sao_Paulo
- ✅ `sha256()`, `encrypt()` AES-256-GCM, `decrypt()`, `deriveKey()` por tenant
- ✅ `validarCNPJ()`, `formatarCNPJ()`, `limparCNPJ()`
- ✅ Constantes fiscais: TABELA_SIMPLES_NACIONAL (Anexos I/III/V, 6 faixas cada), FUNDO_POBREZA por UF, CFOPS_DIFAL, MAPA_CFOP_CONTA

### packages/database — Banco de Dados
- ✅ Schema Prisma completo: 16 modelos, 30+ enums
- ✅ Modelos: Tenant, Usuario, EmpresaCliente, Credencial, DocumentoFiscal (com campos DIFAL, ICMS-ST, retenções), Conciliacao, ApuracaoFiscal, LancamentoContabil, TransacaoBancaria, Obrigacao, Alerta, BemAtivo (CIAP), AuditEvent (BigInt sequencia + hash chain), PortalJob, ArquivoS3
- ✅ PrismaClient singleton com log configurável
- ✅ Seed do escritório piloto (Bruno Conde)

### packages/credentials — Cofre de Credenciais
- ✅ `store()` — criptografa AES-256-GCM com chave derivada por tenant
- ✅ `retrieve()` — descriptografa, atualiza ultimoUso
- ✅ `revoke()`, `checkExpiring()`, `updateExpiredStatuses()`
- ✅ `extractPFX()`, `withCertificate()` — zera buffer após uso
- ✅ **Regra de segurança respeitada:** credenciais NUNCA em texto plano

### packages/audit — Trilha de Auditoria
- ✅ `registrar()` — append-only com encadeamento SHA-256 (seed GENESIS no primeiro evento)
- ✅ `buscarEventos()`, `buscarPendentesRevisao()`, `aprovar()`
- ✅ `AuditChainVerifier.verificar()` — percorre todos os eventos e detecta quebra de cadeia
- ✅ **Regra respeitada:** audit_events é somente INSERT — sem UPDATE/DELETE

### packages/storage — Armazenamento S3
- ✅ `StorageService.upload()` com SSE-S3 (AES256)
- ✅ `StorageService.download()`, `getSignedUrl()`, `exists()`, `delete()`
- ✅ `S3KeyBuilder` — chaves organizadas por CNPJ/competência/categoria:
  - `{cnpj}/{competencia}/notas-emitidas/nfe/{chave}.xml`
  - `{cnpj}/{competencia}/guias/`, `relatorios/`, `encerramento/`
  - `{cnpj}/erros/screenshot-{job}.png`
- ✅ `verificarIntegridade()` — sha256 sobre bytes raw (corrigido na revisão)

### packages/scraper — Captura de Documentos
- ✅ `BasePLaywrightAdapter` — Chromium headless, retry exponencial (1s/2s/4s/8s, 4 tentativas)
- ✅ `NFeSefazAdapter` — SOAP NfeDistribuicaoDFe (SEFAZ federal)
- ✅ `NFCeSefazAdapter` — captura NFC-e
- ✅ `NFSePortalNacionalAdapter` — REST emitidas/tomadas
- ✅ `ScraperOrchestrator.capturarTodos()` — paralelo via Promise.allSettled
- ✅ **Regra respeitada:** screenshot obrigatório no S3 antes de lançar erro

### packages/normalizer — Deduplicação
- ✅ `NormalizerService.normalizar()` — chaveUnica SHA-256 por tipo:
  - NFe/NFCe: chaveAcesso
  - NFSe: cnpj+destinatario+numero+competencia+ibge+valor
- ✅ Upsert inteligente — ignora duplicatas silenciosamente
- ✅ `DeduplicatorService.isDuplicate()`, `findDuplicates()`

### packages/conciliation — Conciliação Score-Based
- ✅ Score: cnpjPrestador(30) + valorServico(35) + competencia(20) + numero(15) = 100
- ✅ ≥95 = CONCILIADA automático | 80-94 = PENDENTE_REVISAO | <80 = DIVERGENTE
- ✅ Auditoria registrada para TODOS os resultados (emitidas e tomadas)
- ✅ Alertas criados em lote (createMany) para divergências
- ✅ `conciliarNFCe()` — NFC-e sempre score 100 (PDV)
- ✅ **Regra respeitada:** score < 80 → BLOQUEAR, nunca prosseguir

### packages/fiscal — Apuração Fiscal
- ✅ **PGDAS:** segregação de receitas por anexo, cálculo RB 12 meses, Fator R, alíquota efetiva, valorDAS
- ✅ **DIFAL:** calcula apenas documentos CONCILIADOS + interestaduais, alíquota interna por UF, Fundo de Pobreza
- ✅ **GNRE:** agrupa DIFAL por UF destino, código 10008-0
- ✅ **DeSTDA:** gera arquivo SPED flat-file (|0000|...|9999|)
- ✅ **EFD-Reinf:** R-2010 (NFSe tomada com INSS), R-4020 (NFSe tomada com IRRF), R-4080 (NFSe emitida com crédito IRRF)
- ✅ **Fator R:** folha12m/rb12m×100 → ≥28% Anexo III, <28% Anexo V
- ✅ **Regras respeitadas:** DIFAL e PGDAS somente após conciliação completa

### packages/contabil — Contabilidade
- ✅ `LancamentoService` — débito/crédito por tipo de documento (NFe entrada/saída, NFC-e, NFSe tomada/emitida) usando MAPA_CFOP_CONTA
- ✅ `lancarImpostos()` — lançamento do DAS Simples Nacional
- ✅ `DepreciacaoService` — linear: (valorAquisicao-valorResidual)/(vidaUtil×12)
- ✅ `ConciliacaoBancariaService` — match por valor ±R$0,02 E data ±2 dias (diferença em dias com timezone)
- ✅ `ECDService` — gera SPED ECD (Blocos 0/I/9), faz upload ao S3

### packages/portals — Portais Governamentais
- ✅ `EcacPortal` — consultarSituacaoFiscal(), baixarCertidao(), screenshot em erro
- ✅ `SimplesNacionalPortal` — transmitirPGDAS() com Playwright + trilha de auditoria
- ✅ `PortalOrchestrator` — cria registro PortalJob no DB, despacha por tipo

### apps/api — API REST
- ✅ Fastify 4 + CORS + JWT (acesso por tenantId do token, nunca do body)
- ✅ 11 routers: auth, empresas, documentos, fechamento, fiscal, conciliação, contábil, auditoria, dashboard, credenciais, portais
- ✅ Rotas públicas: `/auth/login`, `/auth/refresh`, `/health`
- ✅ `POST /fechamento/run/:empresaId/:competencia` — despacha para BullMQ
- ✅ `POST /fechamento/batch/:competencia` — despacha para todas as empresas do tenant com delay aleatório

### apps/worker — Workers Assíncronos
- ✅ 4 workers BullMQ:
  - `fechamento` (concorrência 3) — 9 fases com progresso 5%→100%
  - `scraper` (concorrência 5) — captura + normalização
  - `fiscal` (concorrência 5) — PGDAS | DIFAL | GNRE | DeSTDA | EFD-Reinf
  - `portal` (concorrência 2) — e-CAC + Simples Nacional
- ✅ Graceful shutdown em SIGTERM
- ✅ Serviços instanciados no nível de módulo (não por execução de job)

### apps/dashboard — Interface Web
- ✅ Next.js 14 App Router + Tailwind + shadcn/ui
- ✅ Autenticação com Zustand + localStorage (refresh token rotativo)
- ✅ Página de empresas com filtro e status
- ✅ Página da empresa: tabs (documentos / fiscal / fechamento / auditoria)
- ✅ `FechamentoPanel` — tracker de progresso em 8 fases com polling a cada 5s
- ✅ `ApuracoesPanel` — botões PGDAS/DIFAL, cards com valorDAS
- ✅ Página de auditoria — fila de aprovações pendentes, tabela de eventos, verificação de integridade da cadeia
- ✅ Dashboard com KPIs (total empresas, documentos, alertas, obrigações vencendo)

---

## Problema atual: Push para o GitHub bloqueado

**Situação:** Todo o código está pronto localmente em 2 commits. O push falha com `403 Resource not accessible by integration`.

**Causa:** O GitHub App do Claude Code não tem permissão de escrita neste repositório específico.

**O que você precisa fazer:**
1. Acesse `https://github.com/settings/installations`
2. Clique em **Configure** no app do Claude Code / Anthropic
3. Em **Repository access**, adicione o repositório `SaaS-Contabil`
4. Salve e me avise — faço o push imediatamente

---

## Próximos passos (em ordem de prioridade)

### Imediato
1. **Resolver o push do GitHub** (ação necessária do usuário — ver acima)
2. **Instalar dependências e validar o build:**
   ```bash
   pnpm install
   pnpm db:generate
   ```
3. **Subir infraestrutura local:**
   ```bash
   docker compose -f infra/docker-compose.yml up -d
   pnpm db:migrate
   pnpm db:seed
   pnpm dev
   ```

### Fase 1 — Completar MVP (o que ainda falta)
4. **Adapters de prefeituras** — o orquestrador do scraper suporta prefeituras por IBGE, mas ainda não há adapters concretos. Implementar para as principais cidades das empresas do escritório piloto.
5. **Testes automatizados** — nenhum teste foi escrito ainda. Prioridade: testes unitários dos cálculos fiscais (PGDAS, DIFAL, Fator R).
6. **Autenticação com certificado A1** — o `withCertificate()` existe, mas a integração com os portais do governo via certificado ainda precisa ser testada e ajustada para cada portal.
7. **2Captcha / AntiCaptcha** — os adapters Playwright não implementam a resolução de CAPTCHA ainda. Necessário para portais que exigem.
8. **Monitoramento Simples Nacional** — verificação automática de irregularidades, alertas de exclusão.

### Fase 2 — Contabilidade Completa
9. **e-Social** — S-1200, S-1210, S-1299 (para empresas com empregados)
10. **FGTS Digital** — integração com o portal do FGTS Digital
11. **DCTFWeb** — geração após EFD-Reinf + eSocial fechados
12. **Conciliação bancária via Open Finance** — integrar com APIs bancárias reais
13. **Plano de contas completo** — o MAPA_CFOP_CONTA está básico, precisar de um plano de contas completo
14. **Relatórios contábeis** — balanço patrimonial, DRE, razão contábil

### Fase 3 — Lucro Presumido e Real
15. **Novos regimes tributários** — adaptar os cálculos para LP e LR
16. **IRPJ e CSLL** — apuração trimestral/anual
17. **SPED Fiscal (EFD-ICMS/IPI)** — geração do arquivo

### Infraestrutura e Operações
18. **CI/CD** — pipeline GitHub Actions para build, testes e deploy
19. **Variáveis de ambiente de produção** — AWS Secrets Manager
20. **Migrations com rollback** — scripts de down migration para cada migration
21. **Monitoramento** — Sentry (erros) + Grafana (métricas BullMQ)
22. **Notificações** — WhatsApp + email para contadores (vencimentos, alertas, conclusão de fechamento)
23. **Multi-tenant isolado** — validar RLS do PostgreSQL em produção

---

## Regras absolutas (nunca violar)

1. `Decimal` para todo valor monetário — sem `number`/`float`
2. `audit_events` é somente INSERT — sem UPDATE/DELETE
3. Encerramento de NFSe SOMENTE quando `status = CONCILIADO`
4. Score < 80 → BLOQUEAR — nunca prosseguir automaticamente
5. Certificados → nunca logar, serializar ou transmitir sem criptografia
6. Falha de scraper → screenshot obrigatório no S3 antes de lançar erro
7. `tenantId` em toda query do banco — sem exceção
8. Datas → `date-fns` com `America/Sao_Paulo` — nunca `new Date()` puro
9. DIFAL → calcular SOMENTE de NF-e com `status = CONCILIADO`
10. PGDAS → transmitir SOMENTE após conciliação completa do período
