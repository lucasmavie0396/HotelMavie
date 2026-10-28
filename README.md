# MAVIE-HGest

Sistema de Gestão Hoteleira (PMS) multi-hotel: painel de gestão e site público de reservas por hotel.

Este repositório é a base do projeto: autenticação, utilizadores, hotéis, quartos e site público. Os restantes módulos estão no roadmap do [CLAUDE.md](CLAUDE.md).

## Requisitos

- Node 22 e npm
- MySQL 8.4 (local na porta 3306) ou Docker

## Arranque local

```bash
cp backend/.env.example backend/.env
```

Preenche no `backend/.env`: `JWT_SECRET`, `JWT_REFRESH_SECRET` (valores longos e diferentes) e `SEED_ADMIN_PASSWORD` (mínimo 8 caracteres). Para gerar um segredo:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Cria a base de dados `mavie_hgest` no MySQL e depois:

```bash
npm --prefix backend install
npm --prefix backend run prisma:migrate:deploy
npm --prefix backend run build
npm --prefix backend run db:seed
npm --prefix backend run start:dev
```

Noutro terminal:

```bash
npm --prefix frontend install
npm --prefix frontend run dev
```

| | |
|---|---|
| Painel | http://localhost:5173 |
| Site público | http://localhost:5173/h/hotel-mavie |
| API | http://localhost:3000/api |
| Health check | http://localhost:3000/api/health |

Entra com `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.

## Docker

```bash
cp .env.example .env
docker compose up -d --build
docker compose exec backend npm run db:seed
```

Painel em http://localhost:8080. O MySQL do compose fica exposto na porta 3308 para não colidir com o MySQL local.

## API

| Método | Rota | Acesso |
|---|---|---|
| POST | `/api/auth/login` | público (5 tentativas/min) |
| POST | `/api/auth/refresh` | público |
| POST | `/api/auth/logout` | autenticado |
| GET | `/api/auth/me` | autenticado |
| GET/POST/PATCH | `/api/users` | ADMIN |
| GET | `/api/hotels` | autenticado (não-ADMIN vê só o seu hotel) |
| POST/PATCH/DELETE | `/api/hotels` | ADMIN |
| GET/PATCH | `/api/rooms` | autenticado, restrito ao hotel |
| POST/DELETE | `/api/rooms` | ADMIN, MANAGER |
| GET | `/api/public/hotels/:slug` | público |
| GET | `/api/health` | público |

## Deploy no Railway

Antes de começar, confirma em https://status.railway.com que os builds estão disponíveis para o teu plano.

1. `railway init --name MAVIE-HGest`
2. `railway add --database mysql`
3. Cria dois serviços a partir do repositório, com root directory `backend` e `frontend`.
4. Variáveis do backend: `DATABASE_URL` (referência ao MySQL do Railway), `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CORS_ORIGIN` (domínio público do frontend), `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`.
5. Variáveis do frontend: `API_UPSTREAM=http://<backend>.railway.internal:<PORT>` (sem barra final). O Railway define `PORT` automaticamente.
6. Deploy (`railway up` ou dashboard) e gerar domínio público para o frontend.
7. Seed: `railway run --service backend npm run db:seed`.
8. Remove `SEED_ADMIN_PASSWORD` das variáveis depois do seed.
