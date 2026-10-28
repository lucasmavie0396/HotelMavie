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
| Caixa | `billing/cash.service.ts` (sessões, movimentos, fecho com diferença) | Caixa |
| IVA | `tax-rates/` (por hotel; 0% exige motivo de isenção) | Configuração |
| Restaurante/bar | `pos/` (pedidos, pagar com fatura-recibo ou lançar no quarto) | Restaurante / Bar |
| Catálogo e stocks | `catalog/`, `stock/` (armazém principal usado nas vendas, custo médio, inventário, quebras, transferências) | Produtos, Stocks |
| Compras | `purchases/` (fornecedores, rascunho → receção dá entrada em stock) | Compras |
| Relatórios e alertas | `reports/` (ocupação, ADR, RevPAR, receita, top produtos; alertas operacionais) | Relatórios, botão Alertas |
| Funcionários | `users/` (papéis ADMIN/MANAGER/RECEPTION, sessões por dispositivo em `user_sessions`) | Funcionários |
| Backups | `backups/` (mysqldump para `BACKUP_DIR`) | Funcionários |

## Testes

- Unitários em `src/**/*.spec.ts`; e2e em `backend/test/*.e2e-spec.ts` contra a app real e uma base de dados própria (`<DATABASE_URL>_test` ou `TEST_DATABASE_URL`), apagada e recriada com `migrate deploy` em cada execução. O setup recusa qualquer base cujo nome não termine em `_test`.
- Cada teste cria o seu próprio hotel (`test/helpers.ts`), por isso os testes não dependem uns dos outros.
- Qualquer alteração a reservas, faturação, caixa, POS ou stocks tem de manter `npm --prefix backend run test:e2e` verde; acrescentar um teste para cada regra nova.
- Concorrência: usar `SELECT ... FOR UPDATE` e ler os valores bloqueados na própria consulta (em REPEATABLE READ uma leitura normal depois do lock pode devolver dados antigos). Nunca usar `this.prisma` dentro de um `$transaction` (esgota o pool de ligações); preparar o que for preciso antes da transação.

Regras de negócio a manter: preços são sempre com IVA incluído (base calculada na fatura); documentos emitidos nunca se alteram nem apagam (corrige-se com nota de crédito); valores monetários usam `Prisma.Decimal` via `common/money.ts`.

## Pendente

- **Certificação AT:** o software não está certificado. Falta assinatura RSA dos documentos, QR code, ATCUD e exportação SAF-T (PT). Até lá os PDFs indicam "sem validade fiscal".
- Envio de emails (confirmação de reserva online, envio de faturas).
- Fichas de RH (horários, salários) — hoje "funcionários" são as contas de utilizador.
- Fichas técnicas/receitas (descontar ingredientes ao vender um prato).
- Deploy no Railway (ver README).
