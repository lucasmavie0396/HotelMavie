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

## Testes

```bash
npm --prefix backend test
npm --prefix backend run test:e2e
```

Os testes e2e usam uma base de dados própria (`<DATABASE_URL>_test`), apagada e recriada em cada execução; o SAF-T é validado contra o XSD oficial da AT. O GitHub Actions (`.github/workflows/ci.yml`) corre tudo contra MySQL 8.4 em cada push.

## Chave de assinatura AT

Em desenvolvimento a chave é gerada sozinha em `backend/keys/`. Em produção é obrigatória e tem de ser sempre a mesma (mudá-la parte a cadeia de assinaturas dos documentos):

```bash
node backend/scripts/generate-at-key.mjs backend/keys/at-private.pem
```

O script cria a chave privada e a pública (a pública é a que se entrega à AT na certificação) e mostra a privada numa linha para usar em `AT_PRIVATE_KEY`. Guarda a chave privada num cofre de senhas; nunca a versiones.

## Produção num Windows Server

Guia completo: [deploy/windows/README.md](deploy/windows/README.md). Em resumo, no PowerShell como Administrador:

```powershell
cd C:\MAVIE-HGest\deploy\windows
.\instalar.ps1 -Port 8080 -DbUser mavie -DbPassword '...' -AbrirFirewall
```

Um só processo Node serve a API, o painel e o site público (`FRONTEND_DIR`), arranca com o Windows e reinicia sozinho. Para atualizar usa `.\atualizar.ps1`, que faz backup antes; para gerir, `.\servico.ps1`. O IIS é opcional, para HTTPS com domínio.

## Docker

```bash
cp .env.example .env
node backend/scripts/generate-at-key.mjs backend/keys/at-private.pem
docker compose up -d --build
docker compose exec backend npm run db:seed
```

Painel em http://localhost:8080. O MySQL do compose fica na porta 3308 para não colidir com o MySQL local. Os backups ficam no volume `backend_data` (`/data/backups`).

## Deploy no Railway

Antes de começar, confirma em https://status.railway.com que os builds estão disponíveis para o teu plano. Cada serviço tem `railway.toml` (Dockerfile e healthcheck).

1. `railway init --name MAVIE-HGest` e `railway add --database mysql`.
2. Cria o serviço **backend** a partir do repositório com root directory `backend`, e o serviço **frontend** com root directory `frontend`.
3. Variáveis do backend:

   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | referência à variável `MYSQL_URL` do serviço MySQL |
   | `PORT` | `3000` |
   | `JWT_SECRET`, `JWT_REFRESH_SECRET` | dois valores aleatórios longos e diferentes |
   | `CORS_ORIGIN` | domínio público do frontend (`https://...`) |
   | `AT_PRIVATE_KEY` | chave privada numa linha (ver acima) |
   | `AT_CERTIFICATE_NUMBER` | `0` até haver certificação |
   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | servidor de email |
   | `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | só para o primeiro seed |

4. Adiciona um volume ao backend montado em `/data` (backups).
5. Variáveis do frontend: `API_UPSTREAM=http://backend.railway.internal:3000` (sem barra final; usa o nome do serviço backend).
6. Faz o deploy e gera um domínio público só para o frontend.
7. Seed: `railway run --service backend npm run db:seed`, depois remove `SEED_ADMIN_PASSWORD` e muda a password do admin.
8. Em **Configuração**: dados fiscais, taxas de IVA e séries do ano com o código AT; em **Caixa** e **Stocks** cria as caixas e o armazém principal.
