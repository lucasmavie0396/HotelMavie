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
- Vários hotéis de donos diferentes: `deploy/windows/hoteis.ps1`, uma instância por hotel com base de dados e utilizador MySQL próprios (`mavie_<codigo>`), `dados/hoteis/<codigo>/hotel.env` passado com `node --env-file` (o ambiente ganha ao `backend/.env`), porta a partir de 3101 e tarefa `MAVIE-HGest-<codigo>`. O código e a chave AT são partilhados; `atualizar` compila uma vez e migra cada base. O seed aceita `SEED_HOTEL_NAME`, `SEED_HOTEL_SLUG` e `SEED_DEMO_ROOMS=0`. `dados/` está no `.gitignore`. Assistente gráfico: `Novo hotel.cmd` → `novo-hotel.ps1` (WinForms, pede elevação, corre `hoteis.ps1 -Acao novo` com as passwords em `MAVIE_ADMIN_PASSWORD`/`MAVIE_DB_ADMIN_PASSWORD`); os textos com acentos usam `\uXXXX` + `U` (`[regex]::Unescape`, em `comum.ps1`) para o ficheiro continuar ASCII; nunca aplicar `U` a texto com caminhos (`\x...`). Requisitos: `requisitos.ps1` (Windows 10/11/Server 2016+ 64 bits, sem suspensão na corrente, Node 22, MySQL/MariaDB, mysql/mysqldump, gestor da BD (HeidiSQL/phpMyAdmin/Workbench/DBeaver), login admin, compilação e, com domínio, IIS + URL Rewrite + ARR + proxy); cliente e HeidiSQL vêm do MSI do MariaDB com `ADDLOCAL=Client,HeidiSQL` (sem servidor); IIS em Windows cliente via `Enable-WindowsOptionalFeature`; instala de nodejs.org/mariadb.org com SHA-256 e os MSI da Microsoft com assinatura verificada; `hoteis.ps1 -Acao novo` e o assistente exigem tudo OK. O `novo` cria `MAVIE-HGest - <nome>.url` no ambiente de trabalho público (aponta para `CORS_ORIGIN`); `-Acao atalho` recria, `remover` apaga. Em PS 5.1, `Invoke-RestMethod` passa um array JSON como um só objeto: guardar numa variável antes de filtrar.
- **SQL Server (alternativa ao MySQL, mesmo código):** a `DATABASE_URL` decide (`sqlserver://host:porta;database=...` com `user=/password=` ou `integratedSecurity=true`; o Prisma não aceita `host\instancia`, só porta). `prisma/schema.prisma` (MySQL) é a fonte. `npm run db:sqlserver:migracao -- <nome>` gera `prisma/sqlserver/schema.prisma` (enums e Json passam a `NVarChar`, `onUpdate: NoAction` e cascatas com caminhos múltiplos passam a `NoAction`) e a migração em `prisma/sqlserver/migrations`, com os únicos de colunas opcionais como índices filtrados `WHERE col IS NOT NULL`. `base.prisma` guarda o último schema migrado. O teste `src/prisma/sqlserver-schema.spec.ts` falha se faltar este passo. `npm run prisma:generate` gera os dois clientes; o do SQL Server vai para `node_modules/.prisma/client-sqlserver` e é corrigido (`gerar-cliente.mjs`) para usar o runtime de `@prisma/client`, para os `instanceof` e o `Prisma.sql` funcionarem. `src/prisma/database.ts`: `prismaClientClass`/`createPrismaClient` escolhem o cliente; SQL próprio usa `${lockHint()}` depois da tabela e `${forUpdate()}` no fim (nunca `FOR UPDATE` direto). Não usar `INSERT IGNORE`, `NOW()`, `LIMIT`, `x IS NULL` no `ORDER BY`, `skipDuplicates` nem `Promise.all` em transações. Os campos Json escrevem-se com `jsonValue()` e leem-se com `jsonRead()`. Colunas sem alias em `$queryRawUnsafe` colidem (usar `AS nome`). Backups em SQL Server: `BACKUP DATABASE` para `.bak` (painel e `hoteis.ps1`). Deploy: `hoteis.ps1`/`requisitos.ps1 -BaseDados SQLServer -SqlInstancia X`, comandos de administração via `prisma/sqlserver/executar-sql.mjs` (sem sqlcmd). Testes e2e em SQL Server com `TEST_DATABASE_URL=sqlserver://...` (base `_test`).
- **Perfis de acesso:** `AccessProfile` por hotel com `AccessProfilePermission` (área + `NONE`/`VIEW`/`MANAGE`); `User.profileId` opcional. Sem perfil, tudo funciona como antes (`@Roles`, `@SalesAccess`). Com perfil, o `RolesGuard` usa `src/access/areas.ts`: rota → área pelo caminho, GET precisa de `VIEW` e o resto de `MANAGE`; rotas só `@Roles(ADMIN)` nunca são delegáveis e rotas sem área seguem o papel-base (`User.role = profile.baseRole`, que não muda depois de criar o perfil). Cada rota nova tem de entrar em `ROUTE_AREAS`, ou fica só com a regra do papel-base. No painel, `utils/access.ts` filtra o menu e as rotas; os botões de escrita não são escondidos para quem só pode Ver (a API devolve 403). Moeda: `Hotel.currency`, em Configuração → Dados fiscais. Atalhos do painel são `.lnk` para `abrir-painel.ps1` (Chrome, depois Edge, em `--app --start-fullscreen`). Modo Atualização do instalador: `atualizar-base.ps1` só lista bases com `hotels`, `reservations` e `_prisma_migrations`; ao abrir procura sozinha com a conta do Windows nas instâncias a correr com TCP e, se o login falhar, pede a password do `sa`. Só altera a configuração do SQL Server depois de confirmação. Os `.cmd` do assistente usam `Sysnative`, porque o Inno os lança a 32 bits e o PowerShell de 32 bits não vê a chave das instâncias no registo.
- **Instalador de um só ficheiro:** `deploy/windows/instalador/gerar-instalador.ps1` (precisa do Inno Setup 6) compila para `instalador/obj` (nunca para `backend/dist`), faz `npm ci --omit=dev`, `prisma:generate`, junta os MSI do Node e do MariaDB com `.sha256` em `instaladores/` e corre `MAVIE-HGest.iss`, com o `.exe` em `instalador/saida` (as duas pastas estão no `.gitignore`). `requisitos.ps1` (`Resolve-Installer`) usa primeiro os MSI de `<raiz>\instaladores` e só transfere se faltarem. O `.iss` para os hoteis antes de copiar (`hoteis.ps1 -Acao parar`), corre `-Acao atualizar -SemCompilar` se houver hoteis, e desinstala com `desinstalar.ps1` (so tarefas e processos desta pasta; `dados` fica). O `.iss` fica em UTF-8 com BOM, para os acentos saírem bem. O setup exige um código (`Password=` + `Encryption=yes` do Inno; sem perguntas: `/PASSWORD=`), lido por `gerar-instalador.ps1` de `instalador/codigo-instalador.txt` (fora do Git) ou de `MAVIE_INSTALLER_CODE`; nunca o escrever no repositório nem no chat. Ao testar o `.exe` sem perguntas, passar `/PASSWORD=`. No modo Servidor, o instalador corre `preparar-sqlserver.ps1` antes do Novo hotel (reinicia o serviço se faltar TCP fixo ou autenticação SQL). `/SEMSQLCONFIG=1` salta este passo: usar SEMPRE ao testar o `.exe` neste servidor, para não reiniciar a instância SYSON, que é de outras aplicações. O ícone do setup, dos atalhos e da janela do assistente é `deploy/windows/lam-company.ico`. O assistente pré-seleciona SQL Server, a instância (`Find-PreferredSqlServerInstance`, a primeira a correr) e `sa` se houver SQL Server local; senão MySQL/MariaDB. O instalador tem dois tipos: `servidor` (tudo) e `posto` (só `deploy`, `print-agent` e o MSI do Node): o `posto.ps1 -Servidor ip -Porta n` cria o atalho `.url` no ambiente de trabalho público e a tarefa `MAVIE-HGest agente de impressao` (ao iniciar sessão, grupo Utilizadores, nunca SYSTEM, para ver as impressoras do utilizador); as origens autorizadas ficam em `posto-origens.txt` e entram no comando da tarefa. A mesma tarefa (`Install-PrintAgent`, em `comum.ps1`) é criada no servidor pelo `novo` e pelo `atualizar` de `hoteis.ps1` (`-Acao agente` reinstala); o agente aceita sempre o próprio computador (`localhost`, nome e IPs, em qualquer porta). Instalação sem perguntas com `/TYPE=posto /COMPONENTS=posto /SERVIDOR= /PORTA=` (várias portas separadas por vírgulas). A página do posto abre `escolher-servidor.ps1` (extraído para `{tmp}`, sem dependências de `comum.ps1` nem Node; usa `System.Data.SqlClient`): procura instâncias por SSRP (UDP 1434) e TCP 1433 na /24 local, lista as bases com as tabelas do sistema e lê a porta de cada hotel da propriedade estendida `MAVIE_PORT` da base. Esta propriedade é escrita por `hoteis.ps1` (`novo`, `atualizar`, `-Acao firewall`), que também abre a porta do hotel, a do SQL Server, a UDP 1434 e liga o SQL Server Browser; só em redes de domínio e privadas.
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
| Conta do hóspede | `billing/folio.service.ts` (alojamento lançado no check-in com o IVA do quarto, `Room.taxRateId`, ou, sem ele, o do hotel, `Hotel.accommodationTaxRateId`; check-out bloqueado com saldo) | Detalhe da reserva |
| Quartos | `rooms/` (o gestor edita número, tipo, capacidade, piso, preço e IVA; a receção só muda o estado; o preço novo vale para reservas novas, porque a reserva guarda o seu `pricePerNight`) | Quartos |
| Faturação | `billing/invoices.service.ts` (séries FT/FR/NC por ano, numeração sem falhas, hash encadeado, nota de crédito), PDF com pdfkit | Faturação |
| Caixa | `billing/cash.service.ts` (sessões, movimentos, fecho com diferença); documento de fecho = relatório oculto `cash-close` (`sessionId`), com o que o operador da sessão registou entre a abertura e o fecho; `billing/cash-guard.ts` impede pagamentos, faturas e fecho de pedidos POS sem um caixa aberto pelo próprio operador (numerário sem `cashSessionId` vai para esse caixa; nos testes `createUser`/`createHotel` abrem caixas, `{ cash: false }` desliga) | Caixa |
| IVA | `tax-rates/` (por hotel; 0% exige motivo de isenção) | Configuração |
| Restaurante/bar | `pos/` (pedidos, pagar com fatura-recibo ou lançar no quarto); ecrã cozinha/bar (`/kds`) com opção por computador de imprimir os pedidos novos e anulações pelo agente local desse PC — enquanto o ecrã está registado (`printing=true`, 30 s, em memória), o POS consulta `/kds/printing` e não imprime esses talões; `POST /orders/:id/charge-to-room` passa só as linhas escolhidas de uma mesa para a conta de um hóspede em casa (divide e fecha em modo ROOM) | Restaurante / Bar, Ecrã cozinha/bar |
| Pedidos do quarto (tablet) | `room-service/`: `RoomDevice` por quarto, associado com um código de 6 dígitos válido 10 min (`POST /room-devices`, `/:id/code`); o tablet abre `/quarto` (sem login), troca o código por um token guardado no `localStorage` (`mavie.tablet-quarto`, só o hash SHA-256 fica na BD) e usa `/api/room-device/*` com o cabeçalho `X-Room-Device`. Só pede com hóspede em casa no quarto, produtos com `Product.roomService`, dentro do horário (`Hotel.roomServiceRestaurantHours`/`BarHours`, `HH:MM-HH:MM`, pode passar a meia-noite, hora de `AT_TIMEZONE`), sem `Reservation.roomServiceBlocked` e dentro de `roomServiceLimit`. O pedido é um `Order` com `roomServiceStatus` PENDING → ACCEPTED (envia para preparação, ou logo se `roomServiceAutoAccept`) → ON_THE_WAY → DELIVERED (fecha em modo ROOM para a conta do hóspede) ou REJECTED com motivo. Fila no POS em `/room-orders` (separador Pedidos dos quartos, com aviso sonoro a cada 15 s); estes pedidos não aparecem na lista de contas sem mesa. Relatório `room-service` (vendas por origem). Em SQL Server, `orders.tableId`/`roomId` ficam sem cascata: apagar mesa ou quarto solta primeiro os pedidos | Configuração → Tablets dos quartos, Restaurante / Bar, Reserva |
| App Android | `android/` (Kotlin, WebView, `com.mavie.hgest`): liga-se ao servidor por QR `mavie://ligar?servidor=http://IP:porta&modo=painel|quarto` (ou endereço escrito), testa `/api/health` e abre `/` (painel/POS) ou `/quarto` (ecrã inteiro e ecrã sempre ligado). Compilada pelo GitHub Actions (`.github/workflows/android.yml`, ao mudar `android/**`) e publicada na release `app-android` como `MAVIE-HGest.apk`. O servidor serve-a sem sessão em `/api/app/MAVIE-HGest.apk` (ficheiro `<raiz>/android/MAVIE-HGest.apk` ou `APP_APK_FILE`; `*.apk` fora do Git) e `/api/app/info` dá os QR por IP da rede local. `gerar-instalador.ps1` descarrega a APK da release (ou usa a cópia local), confirma que é uma APK e mete-a em `{app}\android` | Configuração → App Android |
| Catálogo e stocks | `catalog/`, `stock/` (custo médio, inventário, quebras, transferências; a venda abate no armazém da categoria do produto vendido, `ProductCategory.warehouseId`, incluindo os ingredientes de um prato, e sem armazém na categoria abate no armazém principal; `StockService.move` recusa deixar o saldo negativo, salvo `Product.allowNegativeStock` ou `Hotel.allowNegativeStock` (os hotéis anteriores à migração `stock_compras_lamgest` ficaram com `true`); ajuste manual com quantidade com sinal e motivo obrigatório; inventário em `POST /stock-documents/inventory`, com todos os produtos ativos e o saldo em `previousQuantity`, só um rascunho por armazém, e `zero: true` para o inventário a zero, que no ecrã exige escrever ZERAR) | Produtos, Stocks |
| Compras | `purchases/` (fornecedores com NUIT único por hotel, sem desativar com compras por receber; linhas com custo sem IVA, desconto e IVA %, totais `subtotal`/`discount`/`taxTotal`/`total`; o custo médio usa o valor líquido de desconto; a receção exige o n.º do documento do fornecedor, único por fornecedor, data do documento não futura e vencimento opcional; um gestor anula compras recebidas com motivo, com movimentos `PURCHASE_VOID`, e a anulação é recusada se parte do stock já saiu) | Compras |
| Relatórios e alertas | `reports/` (ocupação, ADR, RevPAR, receita, top produtos; alertas operacionais) | Relatórios, botão Alertas |
| Utilizadores | `users/` (papéis ADMIN/MANAGER/RECEPTION/CASHIER, sessões por dispositivo em `user_sessions`); CASHIER só acede a rotas marcadas com `@SalesAccess()` (`RolesGuard`) — POS, caixa, impressão de talões e fecho — e no frontend só vê Restaurante/Bar e Caixa | Utilizadores |
| Backups | `backups/` (mysqldump para `BACKUP_DIR`) | Utilizadores |
| Contas correntes | `billing/receipts.service.ts` (FT em aberto, recibos RG) | Contas correntes |
| Recursos humanos | `hr/` (fichas, escalas, ponto, mapa mensal, processamento salarial) | Recursos humanos |
| Site público e sinal | `uploads/` (imagens em `UPLOAD_DIR`, servidas em `/api/public/files`), `reservations/deposit.service.ts` (sinal, comprovativo A4) | `/h/:slug`, Configuração → Site e reservas, Quartos |
| Relatórios | `reports/report-builder.service.ts` (27 relatórios num modelo comum: secções com indicadores e tabelas já formatadas; `params` `period`, `future` (previsão: de hoje a +29 dias por omissão), `date`, `stock`, `session` ou `none`), incluindo previsão de ocupação, saldos dos hóspedes em casa, cancelamentos e no-shows (o motivo do cancelamento não é guardado) e vendas por empregado e por hora (a conta conta para quem a abriu), compras e fornecedores (IVA das compras por taxa, vencimentos, encomendas por receber), desempenho por quarto e tipo, custo e margem das vendas (custo médio atual ou ficha técnica), movimentos de stock, estatística de hóspedes e recursos humanos (salários dos meses do período e horas do ponto), `report-render.service.ts` (A4 com logotipo e paginação; 58/80 mm via `Ticket`) | Relatórios (pré-visualização, A4, 80 mm, PDF, CSV) |
| Impressão local | `print-agent/` (Node sem dependências, escuta em 127.0.0.1:9123, imprime ESC/POS RAW no Windows; aceita o nome sem o sufixo `(redirecionado N)` das impressoras redirecionadas por RDP, que é como a configuração o guarda) | Configuração → Impressoras |

- **Sinal:** `Hotel.depositPercent` (60 por defeito; 0 desliga). A reserva online guarda o valor e a referência indicada pelo cliente; ao confirmar (`POST /reservations/:id/deposit/confirm`, qualquer papel) cria um `Payment` normal na conta da estadia, aprova a reserva e envia o comprovativo em PDF. O comprovativo é interno (sem valor fiscal): a fatura sai no check-out com tudo e o sinal já descontado no saldo.
- **Grupos de reservas:** `ReservationGroup` (`kind` INDIVIDUAL ou CORPORATE, dados da empresa) junta várias `Reservation`, uma por quarto, cada uma com hóspede principal, acompanhantes, conta e faturas próprias. Criação atómica em `ReservationsService.bookGroupInTx` (um quarto ocupado anula o grupo todo). Painel: `POST /reservation-groups`, `GET /reservation-groups/:id`, `/confirm`, `/cancel`, `GET /reservation-groups/company?taxId=` (dados da última reserva da empresa). Site: `POST /public/hotels/:slug/reservations` aceita `rooms[]`, `kind` e `company`; um só quarto particular continua sem grupo. Na empresa o contacto não vira hóspede; o funcionário de cada quarto (`occupant`) é procurado pelo n.º do documento. A fatura de um quarto de grupo empresarial vem pré-preenchida com nome, NUIT e morada da empresa (`FolioPanel`, `RoomAccountPanel`).
- **Formato dos documentos (Moçambique):** NUIT em vez de NIF, o tipo FR aparece como "Recibo" (o prefixo `FR` mantém-se), a moeda MZN mostra-se como MT (`formatCurrency`/`currencySymbol`; na base continua o código ISO, que o `Intl` exige), IVA em cada linha com produto e "Processado por Computador" por baixo do rodapé (`drawFooter` no A4, `Ticket.processed` na térmica).
- **Formatos dos documentos:** todos os documentos saem em 80 mm e A4. No painel, `PaperLinks.vue` abre a pré-visualização (por omissão via `/print/pdf`, que no A4 usa o layout completo da fatura e do recibo; `path` para os restantes). O sinal e os salários aceitam `?paper=` (A4 por omissão).
- **Ecrãs tácteis (15" 1024×768, sem teclado):** padrões do LAMGest Restaurante. `utils/screen.ts` guarda por computador (`localStorage`) o modo táctil (`html[data-touch]`, variante Tailwind `touch:`), o tamanho (90–125% no `font-size` do `<html>`), o teclado no ecrã (Automático/Sempre/Nunca) e o menu recolhido (por omissão abaixo de 1280 px); escolhe-se no botão **Ecrã** do topo. `ScreenKeyboard.vue` (montado no `AppLayout`) abre ao tocar num campo e é numérico em `type=number`/`inputmode="decimal"`; `data-no-keyboard` exclui um campo. Nos ecrãs operacionais não usar `window.prompt`/`confirm`: usar `askText`/`askConfirm` de `services/dialog.ts` (`TouchDialog.vue`). Alvos de toque de 44 px (`.btn`, `.input`, `.chip`, `.btn-icon`). O POS soma o mesmo produto na linha por enviar (`PATCH /orders/:id/items/:itemId { quantity }`), pesquisa produtos por nome ou código em todas as categorias (sem acentos; Enter lança o código exato ou o único resultado, o que serve para leitores de código de barras) e o painel do pedido segue o LAMGest (responsável, menu ⋯ com as opções secundárias, ✕ que só fecha no ecrã, impostos incluídos e botão Pagar). Testes de interface a 1024×768 em `frontend/e2e/touch.spec.ts`; `ui-test-server.mjs` aceita `UI_FRONTEND_DIR` e `UI_BACKEND_DIST`, para testar sem compilar para `frontend/dist`/`backend/dist`, que o hotelmavie usa em produção.
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
  - Os documentos não levam QR code nem ATCUD impressos (o ATCUD continua na base de dados e no SAF-T); os 4 caracteres da assinatura só saem com `AT_CERTIFICATE_NUMBER`. Taxas têm `atCategory` (RED/INT/NOR/ISE); 0% exige `exemptionCode` M01–M99. Não se fatura lançamento sem taxa.
  - SAF-T (PT) 1.04_01 em `GET /api/saft` (só faturação e recibos, um ano fiscal). `test/saft-xsd.e2e-spec.ts` valida-o contra o XSD oficial (`test/fixtures/saftpt1.04_01.xsd`, de info.portaldasfinancas.gov.pt/apps/saft-pt04/). O XSD é 1.1 e o libxml2 só lê 1.0: o teste retira os 19 `xs:assert` e reproduz em código os que se aplicam (isenções e tipo de recibo). Qualquer alteração ao SAF-T tem de manter este teste verde.
  - Recibos (`billing/receipts.service.ts`): uma FT emitida sai do saldo da estadia e fica na conta corrente do cliente (`/contas-correntes`); RG liquida uma ou várias FT do mesmo cliente, total ou parcialmente. RG não é assinado (o SAF-T não o pede), tem ATCUD. Anular RG cria um pagamento de estorno. Uma FT com recibos ativos não se credita.

## Pendente

- **Certificação AT:** o código está preparado, mas falta o processo legal: passar o SAF-T no validador oficial da AT (verifica também os asserts XSD 1.1 e regras de negócio), pedir a certificação com a chave pública (`GET /api/at/public-key`) e depois definir `AT_CERTIFICATE_NUMBER`. Comunicar as séries no Portal das Finanças antes de as usar.
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
