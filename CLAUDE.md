# MAVIE-HGest

Responde sempre em português (PT-PT). Contexto local (credenciais de teste, alterações por commitar, objetivo da sessão) fica em `CLAUDE.local.md`, que não é versionado.

## O projeto

PMS hoteleiro multi-hotel: painel de gestão (receção/administração) e site público por hotel (`/h/:publicSlug`).

| Camada | Tecnologia |
|---|---|
| Backend | NestJS 11, Prisma 6, MySQL 8.4, JWT (access + refresh), class-validator, @nestjs/throttler |
| Frontend | Vue 3 (`<script setup>`) + TypeScript, Vite, Vue Router, Pinia, Tailwind CSS 4, Axios |
| DevOps | Docker multi-stage, Nginx (SPA + proxy `/api`), Railway (planeado) |
| Runtime | Node 22 |

## Estrutura

```
backend/
  prisma/schema.prisma        modelos e enums
  prisma/migrations/          migrations versionadas
  src/main.ts                 prefixo /api, ValidationPipe, CORS, filtro Prisma
  src/auth/                   login, refresh, logout, me, guards globais
  src/common/                 decorators (@Public, @Roles, @CurrentUser), hotel-scope, filtros
  src/<dominio>/              controller + service + dto/
  src/database/seed.ts        seed idempotente (compilado para dist/database/seed.js)
frontend/
  src/services/api.ts         axios com token e refresh automatico
  src/stores/auth.ts          sessao (Pinia)
  src/router/index.ts         rotas e guards (requiresAuth, guestOnly, roles)
  src/layouts/ src/views/     paginas
  nginx.conf.template         usa ${PORT} e ${API_UPSTREAM}
```

## Padrões a seguir

- **Novo módulo backend:** copiar a forma de `src/rooms/` (controller → service → DTOs com class-validator; `UpdateDto` via `PartialType`). Registar em `app.module.ts`.
- **Autenticação:** todas as rotas exigem JWT por defeito. Usar `@Public()` só para rotas públicas e `@Roles(...)` para restringir por papel.
- **Multi-hotel:** utilizadores não-ADMIN só veem dados do seu hotel. Usar `resolveHotelScope` / `canAccessHotel` de `src/common/hotel-scope.ts` em qualquer módulo com `hotelId`.
- **Erros Prisma:** P2002/P2003/P2025 já são convertidos em 409/404 pelo filtro global; não duplicar essa lógica nos services.
- **Respostas de utilizador:** nunca devolver `passwordHash` nem `refreshTokenHash`; usar `publicUserSelect`.
- **Frontend:** chamadas HTTP sempre via `api` de `@/services/api`; mensagens de erro via `errorMessage()`. Tipos partilhados em `src/types.ts`.

## Comandos

```bash
npm --prefix backend install
npm --prefix backend run prisma:generate
npm --prefix backend run prisma:migrate:deploy
npm --prefix backend run build
npm --prefix backend run db:seed
npm --prefix backend run start:dev
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix backend run test:e2e

npm --prefix frontend install
npm --prefix frontend run dev
npm --prefix frontend run build
npm --prefix frontend run test:ui

docker compose up -d --build
docker compose exec backend npm run db:seed
```

## Regras

### Código
- Não adicionar comentários ao código.
- Seguir o estilo e os padrões do módulo em que se está a trabalhar.
- Não inventar funcionalidades, campos ou endpoints que não foram pedidos.
- Não adicionar dependências sem perguntar.

### Base de dados
- Alterar o schema: editar `schema.prisma` e correr `npx prisma migrate dev --name <nome>` (só em dev).
- Produção/Docker: só `prisma migrate deploy`.
- Nunca editar migrations já aplicadas. Nunca correr `prisma migrate reset` nem `db push --force-reset` sem perguntar.
- MySQL 8.4 (produção) ou MariaDB 10.4+ (dev); confirmar a porta local em `CLAUDE.local.md`. O MySQL do docker-compose está na 3308.
- Se `migrate dev` recusar por perda de dados, gerar o SQL com `prisma migrate diff --from-schema-datasource ... --to-schema-datamodel ... --script` para uma nova pasta em `prisma/migrations/` e aplicar com `migrate deploy`.

### Backend
- Produção: sempre `node dist/main.js`. Nunca `tsx` (parte o metadata dos decorators do NestJS).
- Produção em Windows: `deploy/windows/` (instalar, atualizar, servico, executar.cmd, IIS opcional). Com `FRONTEND_DIR` a API serve também o `frontend/dist` (fallback SPA fora de `/api`). `TRUST_PROXY` (predefinição 1, como os testes esperam; `0` quando exposto sem proxy, `loopback` atrás do IIS) e `HOST` vêm do `.env`.
- Vários hotéis de donos diferentes: `deploy/windows/hoteis.ps1`, uma instância por hotel com base de dados e utilizador MySQL próprios (`mavie_<codigo>`), `dados/hoteis/<codigo>/hotel.env` passado com `node --env-file` (o ambiente ganha ao `backend/.env`), porta a partir de 3101 e tarefa `MAVIE-HGest-<codigo>`. O código e a chave AT são partilhados; `atualizar` compila uma vez e migra cada base. O seed aceita `SEED_HOTEL_NAME`, `SEED_HOTEL_SLUG` e `SEED_DEMO_ROOMS=0`. `dados/` está no `.gitignore`. Assistente gráfico: `Novo hotel.cmd` → `novo-hotel.ps1` (WinForms, pede elevação, corre `hoteis.ps1 -Acao novo` com as passwords em `MAVIE_ADMIN_PASSWORD`/`MAVIE_DB_ADMIN_PASSWORD`); os textos com acentos usam `\uXXXX` + `U` (`[regex]::Unescape`, em `comum.ps1`) para o ficheiro continuar ASCII; nunca aplicar `U` a texto com caminhos (`\x...`). Requisitos: `requisitos.ps1` (Node 22, MySQL/MariaDB, mysql/mysqldump, login admin, compilação e, com domínio, IIS + URL Rewrite + ARR + proxy); instala de nodejs.org/mariadb.org com SHA-256 e os MSI da Microsoft com assinatura verificada; `hoteis.ps1 -Acao novo` e o assistente exigem tudo OK. O `novo` cria `MAVIE-HGest - <nome>.url` no ambiente de trabalho público (aponta para `CORS_ORIGIN`); `-Acao atalho` recria, `remover` apaga. Em PS 5.1, `Invoke-RestMethod` passa um array JSON como um só objeto: guardar numa variável antes de filtrar.
- Scripts `.ps1` só com ASCII (o PowerShell 5.1 lê ficheiros sem BOM como ANSI).

### Git
- Commits em português, sem acentos, descritivos (ex.: `adiciona modulo de reservas`).
- Nunca versionar `.env` nem segredos. `CLAUDE.local.md` também não.
- Adicionar ficheiros um a um (`git add <ficheiro>`), nunca `git add .`.
- Não fazer `push`, `force-push` nem reescrever histórico sem pedido explícito.

### Perguntar antes de alterar
- `backend/prisma/schema.prisma` e migrations
- `src/auth/`, `src/common/hotel-scope.ts`, e módulos financeiros (payments, invoices, cash-registers)
- `Dockerfile`s, `docker-compose.yml`, `nginx.conf.template`
- Qualquer ficheiro `.env`

## Como trabalhar

1. Ler os ficheiros relevantes antes de alterar; não assumir a estrutura.
2. Em tarefas com mais de um ficheiro, apresentar um plano curto antes de editar.
3. Alterações pequenas e focadas.
4. Verificar: `npm --prefix backend run build` e `npm --prefix frontend run build` têm de passar. Se mexeres na API, testa o endpoint.
5. No fim, resumir o que mudou, o que foi verificado e o que ficou por fazer.
6. Em dúvidas sobre regras de negócio hoteleiras (tarifas, impostos, faturação), perguntar em vez de assumir.

## Módulos implementados

| Área | Backend | Painel |
|---|---|---|
| Hóspedes e reservas | `guests/`, `reservations/` (disponibilidade com lock `FOR UPDATE`, check-in/out, no-show) | Calendário, Reservas, Hóspedes |
| Reserva online | `public/` (disponibilidade por tipo, pedido PENDING) | `/h/:slug` |
| Conta do hóspede | `billing/folio.service.ts` (alojamento lançado no check-in, check-out bloqueado com saldo) | Detalhe da reserva |
| Faturação | `billing/invoices.service.ts` (séries FT/FR/NC por ano, numeração sem falhas, hash encadeado, nota de crédito), PDF com pdfkit | Faturação |
| Caixa | `billing/cash.service.ts` (sessões, movimentos, fecho com diferença); documento de fecho = relatório oculto `cash-close` (`sessionId`), com o que o operador da sessão registou entre a abertura e o fecho; `billing/cash-guard.ts` impede pagamentos, faturas e fecho de pedidos POS sem um caixa aberto pelo próprio operador (numerário sem `cashSessionId` vai para esse caixa; nos testes `createUser`/`createHotel` abrem caixas, `{ cash: false }` desliga) | Caixa |
| IVA | `tax-rates/` (por hotel; 0% exige motivo de isenção) | Configuração |
| Restaurante/bar | `pos/` (pedidos, pagar com fatura-recibo ou lançar no quarto); ecrã cozinha/bar (`/kds`) com opção por computador de imprimir os pedidos novos e anulações pelo agente local desse PC — enquanto o ecrã está registado (`printing=true`, 30 s, em memória), o POS consulta `/kds/printing` e não imprime esses talões | Restaurante / Bar, Ecrã cozinha/bar |
| Catálogo e stocks | `catalog/`, `stock/` (armazém principal usado nas vendas, custo médio, inventário, quebras, transferências) | Produtos, Stocks |
| Compras | `purchases/` (fornecedores, rascunho → receção dá entrada em stock) | Compras |
| Relatórios e alertas | `reports/` (ocupação, ADR, RevPAR, receita, top produtos; alertas operacionais) | Relatórios, botão Alertas |
| Utilizadores | `users/` (papéis ADMIN/MANAGER/RECEPTION/CASHIER, sessões por dispositivo em `user_sessions`); CASHIER só acede a rotas marcadas com `@SalesAccess()` (`RolesGuard`) — POS, caixa, impressão de talões e fecho — e no frontend só vê Restaurante/Bar e Caixa | Utilizadores |
| Backups | `backups/` (mysqldump para `BACKUP_DIR`) | Utilizadores |
| Contas correntes | `billing/receipts.service.ts` (FT em aberto, recibos RG) | Contas correntes |
| Recursos humanos | `hr/` (fichas, escalas, ponto, mapa mensal, processamento salarial) | Recursos humanos |
| Site público e sinal | `uploads/` (imagens em `UPLOAD_DIR`, servidas em `/api/public/files`), `reservations/deposit.service.ts` (sinal, comprovativo A4) | `/h/:slug`, Configuração → Site e reservas, Quartos |
| Relatórios | `reports/report-builder.service.ts` (12 relatórios num modelo comum: secções com indicadores e tabelas já formatadas), `report-render.service.ts` (A4 com logotipo e paginação; 58/80 mm via `Ticket`) | Relatórios (pré-visualização, A4, 80 mm, PDF, CSV) |
| Impressão local | `print-agent/` (Node sem dependências, escuta em 127.0.0.1:9123, imprime ESC/POS RAW no Windows; aceita o nome sem o sufixo `(redirecionado N)` das impressoras redirecionadas por RDP, que é como a configuração o guarda) | Configuração → Impressoras |

- **Sinal:** `Hotel.depositPercent` (60 por defeito; 0 desliga). A reserva online guarda o valor e a referência indicada pelo cliente; ao confirmar (`POST /reservations/:id/deposit/confirm`, qualquer papel) cria um `Payment` normal na conta da estadia, aprova a reserva e envia o comprovativo em PDF. O comprovativo é interno (sem valor fiscal): a fatura sai no check-out com tudo e o sinal já descontado no saldo.
- **Imagens da internet:** descarregar sempre com `downloadImage` de `uploads/uploads.ts` (só https, resolve o DNS e recusa endereços privados em cada pedido e redirecionamento, máximo 4 MB). Nunca usar `fetch` com URL vindo do utilizador. A pesquisa de fotos de produtos (`catalog/image-search.ts`) usa o Google Custom Search (imagens) quando há `GOOGLE_SEARCH_API_KEY` e `GOOGLE_SEARCH_CX`, e o Wikimedia Commons quando não há. Nunca fazer scraping do Google.
- **Imagens:** só PNG/JPG/WEBP (logotipo só PNG/JPG, por causa do pdfkit), verificadas pelos bytes iniciais, até 4 MB, nome aleatório. Nunca aceitar SVG.

## Testes

- Unitários em `src/**/*.spec.ts`; e2e em `backend/test/*.e2e-spec.ts` contra a app real e uma base de dados própria (`<DATABASE_URL>_test` ou `TEST_DATABASE_URL`), apagada e recriada com `migrate deploy` em cada execução. O setup recusa qualquer base cujo nome não termine em `_test`.
- Cada teste cria o seu próprio hotel (`test/helpers.ts`), por isso os testes não dependem uns dos outros.
- Qualquer alteração a reservas, faturação, caixa, POS ou stocks tem de manter `npm --prefix backend run test:e2e` verde; acrescentar um teste para cada regra nova.
- Testes de interface (Playwright) em `frontend/e2e/`: exigem `backend` e `frontend` compilados; `backend/scripts/ui-test-server.mjs` recria a base `<DATABASE_URL>_ui_test` com dados fixos (gestor `gestor-ui@teste.local`, impressoras em modo PDF) e arranca a API na porta 3100 a servir o `frontend/dist`.
- Imagens carregadas passam pelo `sharp` (máximo 1600 px, recomprimidas); os PDFs usam uma versão de 600 px do logotipo (`UploadsService.readForPdf`).
- Concorrência: usar `SELECT ... FOR UPDATE` e ler os valores bloqueados na própria consulta (em REPEATABLE READ uma leitura normal depois do lock pode devolver dados antigos). Nunca usar `this.prisma` dentro de um `$transaction` (esgota o pool de ligações); preparar o que for preciso antes da transação.

Regras de negócio a manter: preços são sempre com IVA incluído (base calculada na fatura); documentos emitidos nunca se alteram nem apagam (corrige-se com nota de crédito); valores monetários usam `Prisma.Decimal` via `common/money.ts`.

## Receitas, emails e AT

- **Receitas** (`catalog/recipes.service.ts`): um prato com receita não controla stock próprio; ao vender descontam-se os ingredientes (um só nível, ingredientes têm de controlar stock). O relatório mostra o food cost.
- **Emails** (`mail/`): `MailService.queue` para envios que não podem bloquear o pedido; `send` quando o utilizador espera o resultado. Todos os envios ficam em `email_logs`. Sem `SMTP_HOST` usa `jsonTransport` (estado LOGGED, nada sai). Os testes forçam `SMTP_HOST=''`. Todo o texto de utilizador nos templates passa por `escapeHtml`.
- **AT** (`at/`):
  - Numeração `FT|FR|NC <ano>/<n>`, série por tipo e ano (`invoice_series`, único em hotel+tipo+código).
  - `hash` é a assinatura RSA-SHA1 (base64) de `data;data-hora;numero;total;hash anterior`, em hora de Lisboa (`at-format.ts`). Chave em `AT_PRIVATE_KEY_PATH`; sem isso gera uma chave de desenvolvimento em `backend/keys/` (não versionada).
  - ATCUD = código de validação da série + número; o código só se regista com `nextNumber = 1`.
  - QR code (Portaria 195/2020) e 4 caracteres da assinatura no PDF. Taxas têm `atCategory` (RED/INT/NOR/ISE); 0% exige `exemptionCode` M01–M99. Não se fatura lançamento sem taxa.
  - SAF-T (PT) 1.04_01 em `GET /api/saft` (só faturação e recibos, um ano fiscal). `test/saft-xsd.e2e-spec.ts` valida-o contra o XSD oficial (`test/fixtures/saftpt1.04_01.xsd`, de info.portaldasfinancas.gov.pt/apps/saft-pt04/). O XSD é 1.1 e o libxml2 só lê 1.0: o teste retira os 19 `xs:assert` e reproduz em código os que se aplicam (isenções e tipo de recibo). Qualquer alteração ao SAF-T tem de manter este teste verde.
  - Recibos (`billing/receipts.service.ts`): uma FT emitida sai do saldo da estadia e fica na conta corrente do cliente (`/contas-correntes`); RG liquida uma ou várias FT do mesmo cliente, total ou parcialmente. RG não é assinado (o SAF-T não o pede), tem ATCUD. Anular RG cria um pagamento de estorno. Uma FT com recibos ativos não se credita.

## Pendente

- **Certificação AT:** o código está preparado, mas falta o processo legal: passar o SAF-T no validador oficial da AT (verifica também os asserts XSD 1.1 e regras de negócio), pedir a certificação com a chave pública (`GET /api/at/public-key`) e depois definir `AT_CERTIFICATE_NUMBER`. Comunicar as séries no Portal das Finanças antes de as usar. Até lá os PDFs indicam "sem validade fiscal".
- Comunicação de documentos à AT (webservice ou envio mensal do SAF-T).
- Salários: faltam a Declaração Mensal de Remunerações (AT), a declaração à Segurança Social, as tabelas oficiais de retenção de IRS (hoje a taxa é definida à mão por funcionário) e os acertos de fim de contrato.
- Deploy no Railway: tudo preparado (Dockerfiles, `railway.toml`, guia no README); falta correr com a conta. Os Dockerfiles e o CI ainda não foram executados porque a máquina de desenvolvimento não tem Docker.

## Segurança e auditoria

- **2FA** (`auth/totp.ts`, sem dependências): TOTP RFC 6238 opcional por utilizador (A minha conta). Segredo cifrado com AES-256-GCM usando `TOTP_ENCRYPTION_KEY` (ou `JWT_SECRET` se não existir: trocar o `JWT_SECRET` obriga a reativar o 2FA). O login devolve `{ twoFactorRequired, challenge }` (JWT de 5 min com segredo próprio, não serve como access token) e o código vai para `POST /auth/login/2fa`. Códigos não se repetem (`totpLastStep`); 8 códigos de recuperação de uso único (guardados em hash). O ADMIN pode desativar o 2FA de outro utilizador.
- **Recuperar password:** `POST /auth/forgot-password` responde sempre igual; o link (`APP_URL`, ou o primeiro `CORS_ORIGIN`) vale 60 minutos, é de uso único e termina todas as sessões.
- **Auditoria** (`audit/audit.ts`, global): `AuditService.log(entry, tx?)` dentro da transação quando a operação é financeira. Regista preços/custos, anulações de linhas e pedidos, estornos, notas de crédito, anulação de recibos, documentos de stock, alterações de utilizadores, 2FA, reposição de password e logins falhados. Página Auditoria (gestores; cada gestor só vê o seu hotel).
- **Backups automáticos** (`backups/backups.service.ts`): `BACKUP_AUTO_HOUR` (0-23) liga o backup diário, `BACKUP_KEEP_DAYS` (14) apaga os antigos, `BACKUP_COPY_DIR` copia cada backup para uma pasta fora do servidor. Desligado em `NODE_ENV=test`.

## Recursos humanos e produção

- **RH** (`hr/`): fichas de funcionário separadas das contas (IBAN, NISS e salário só para gestores); turnos com deteção de sobreposição incluindo turnos noturnos e o dia seguinte; picagens com lock por funcionário; correções guardam quem e quando; mapa mensal de horas previstas vs trabalhadas.
- **Salários** (`hr/payroll-calc.ts` puro e testado, `hr/payroll.service.ts`): taxas por hotel (`payroll_settings`: TSU 11% / 23,75%, multiplicador de horas extra, subsídios em duodécimos ou no mês escolhido); taxa de IRS por funcionário. Valor hora = (base × 12) / (52 × horas semanais). Faltas e horas extra vêm da escala vs ponto (sem escala não se calculam). Abonos isentos (ex.: refeição) não entram na base de SS/IRS. Rascunho → editar → fechar (imutável, auditado). Recibo e mapa em PDF.
- **Chave AT em produção:** obrigatória (`AT_PRIVATE_KEY` em PEM numa linha, ou `AT_PRIVATE_KEY_PATH`); com `NODE_ENV=production` a API recusa arrancar sem ela. Gerar com `backend/scripts/generate-at-key.mjs`.
- **Ficheiros de texto no Windows:** editar com a ferramenta de edição; o PowerShell 5.1 lê ficheiros UTF-8 sem BOM como ANSI e corrompe os acentos ao regravar.
