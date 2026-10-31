# Instalar o MAVIE-HGest num Windows Server

Um só processo Node serve a API, o painel e o site público. No servidor só é preciso Node e MySQL/MariaDB; o IIS é opcional, para HTTPS com domínio próprio.

```
Postos da receção / bar / cozinha ──► http://servidor:8080 ──► Node (MAVIE-HGest) ──► MySQL / MariaDB
                                       (ou https://dominio via IIS)
```

## 1. Requisitos

| | |
|---|---|
| Sistema | Windows Server 2016, 2019, 2022 ou 2025 (também funciona em Windows 10/11) |
| Node.js | 22 LTS, instalador MSI de https://nodejs.org (marcar "Add to PATH") |
| Base de dados | MySQL 8.4 ou MariaDB 10.4+ (pode ser o do XAMPP), no próprio servidor ou noutro |
| Hardware | 2 CPU, 4 GB RAM, 20 GB de disco livres (indicativo, para 1 a 3 hotéis) |
| Git | opcional, só para atualizar com `-GitPull` |

## 2. Copiar o sistema

Coloca o projeto numa pasta fora do perfil de utilizador, por exemplo `C:\MAVIE-HGest`:

```powershell
git clone <endereco-do-repositorio> C:\MAVIE-HGest
```

Ou copia a pasta do projeto (sem `node_modules`, `dist` e `backend\.env`).

## 3. Preparar a base de dados

O instalador cria a base de dados se não existir. Recomenda-se um utilizador próprio em vez de `root`:

```sql
CREATE DATABASE mavie_hgest CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'mavie'@'localhost' IDENTIFIED BY 'uma-password-forte';
GRANT ALL PRIVILEGES ON mavie_hgest.* TO 'mavie'@'localhost';
```

## 4. Instalar

Abre o **PowerShell como Administrador**:

```powershell
cd C:\MAVIE-HGest\deploy\windows
Set-ExecutionPolicy -Scope Process Bypass
.\instalar.ps1 -Port 8080 -DbUser mavie -DbPassword 'uma-password-forte' -AbrirFirewall
```

O script pede a password do administrador do sistema e no fim mostra o endereço do painel, por exemplo `http://servidor-hotel:8080`.

| Parâmetro | Predefinição | Para quê |
|---|---|---|
| `-PublicUrl` | `http://<nome-do-servidor>:<porta>` | Endereço que os utilizadores escrevem no navegador |
| `-Port` | `8080` | Porta do MAVIE-HGest |
| `-DbHost`, `-DbPort`, `-DbName`, `-DbUser`, `-DbPassword` | `localhost`, `3306`, `mavie_hgest`, `root`, vazio | Ligação ao MySQL/MariaDB |
| `-AdminEmail` | `admin@maviehgest.com` | Primeiro administrador |
| `-DataDir` | `C:\MAVIE-HGest\dados` | Imagens, backups, chave AT e registos |
| `-TimeZone` | `Europe/Lisbon` | Fuso horário dos documentos (ex.: `Africa/Maputo`) |
| `-AtrasDoIIS` | | Só aceita ligações do IIS local (ver secção 6) |
| `-AbrirFirewall` | | Abre a porta na firewall do Windows (redes privadas e de domínio) |
| `-SemServico` | | Não cria o arranque automático |

O que o instalador faz:

1. Verifica o Node.
2. Cria `backend\.env` com segredos aleatórios. Se o ficheiro já existir, não lhe mexe.
3. Gera a chave de assinatura AT. Uma chave que já exista nunca é substituída.
4. Instala as dependências e aplica as migrações.
5. Compila o backend e o painel.
6. Cria o administrador. A password não fica guardada no `.env`.
7. Regista a tarefa agendada **MAVIE-HGest**: corre como SYSTEM, arranca com o Windows (mesmo sem ninguém ter sessão iniciada) e reinicia sozinha se o processo parar.

Correr o instalador outra vez é seguro: reaproveita o `.env` e a chave AT e não volta a criar o administrador.

## 5. Gerir o serviço

```powershell
.\servico.ps1 -Acao estado      # tarefa, processo e /api/health
.\servico.ps1 -Acao reiniciar   # depois de alterar o backend\.env
.\servico.ps1 -Acao parar
.\servico.ps1 -Acao iniciar
.\servico.ps1 -Acao logs        # ultimas linhas de dados\logs\api.log
.\servico.ps1 -Acao backup      # mysqldump para dados\backups
.\servico.ps1 -Acao remover     # tira o arranque automatico (mantem dados)
```

**Fotos de produtos pelo Google:** o botão "Procurar na internet" usa o Google Imagens se o `backend\.env` tiver `GOOGLE_SEARCH_API_KEY` e `GOOGLE_SEARCH_CX`. Sem estas chaves usa o Wikimedia Commons. Para as obter:

1. Em https://programmablesearchengine.google.com cria um motor de pesquisa, ativa **Pesquisa de imagens** e **Pesquisar em toda a Web**, e copia o **ID do motor de pesquisa** para `GOOGLE_SEARCH_CX`.
2. Na Google Cloud Console (https://console.cloud.google.com) ativa a **Custom Search API** e cria uma **chave de API**, de preferência restrita a essa API, para `GOOGLE_SEARCH_API_KEY`.
3. Faz `reiniciar`.

O Google cobra a partir de um certo número de pesquisas por dia; confirma os limites e preços na página da Custom Search API antes de ativar. Cada pesquisa no sistema faz 2 pedidos ao Google (20 fotos).

**Email (SMTP):** preenche `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `MAIL_FROM` no `backend\.env` e faz `reiniciar`. Sem SMTP, os emails ficam só registados.

## 6. HTTPS com domínio (IIS, opcional)

Usa esta secção se o sistema for acessível pela internet, por exemplo para o site público de reservas.

1. Instala os módulos do IIS **URL Rewrite** e **Application Request Routing (ARR)**.
2. No Gestor do IIS, abre o servidor → *Application Request Routing Cache* → *Server Proxy Settings* e marca **Enable proxy**.
3. Autoriza a variável usada para indicar HTTPS:

   ```powershell
   & "$env:windir\system32\inetsrv\appcmd.exe" set config -section:system.webServer/rewrite/allowedServerVariables /+"[name='HTTP_X_FORWARDED_PROTO']" /commit:apphost
   ```

4. Cria um site no IIS, por exemplo com a pasta `C:\inetpub\mavie`, com o *binding* do domínio, e copia para lá o [`iis/web.config`](iis/web.config). Se usares outra porta que não a 3000, corrige-a no ficheiro.
5. Certificado gratuito Let's Encrypt: usa o [win-acme](https://www.win-acme.com/), que o associa ao site e o renova sozinho. A regra do `web.config` já deixa passar `/.well-known/`.
6. Instala (ou reconfigura) o MAVIE-HGest atrás do IIS:

   ```powershell
   .\instalar.ps1 -Port 3000 -PublicUrl https://hgest.hotelmavie.co.mz -AtrasDoIIS
   ```

   Numa instalação existente, muda no `backend\.env` as variáveis `HOST=127.0.0.1`, `TRUST_PROXY=loopback`, `CORS_ORIGIN=https://...` e `PORT=3000`, e reinicia.

Com `-AtrasDoIIS` o Node só escuta em 127.0.0.1 e só confia no `X-Forwarded-For` do IIS local. Sem IIS fica `TRUST_PROXY=0`, para que ninguém consiga contornar o limite de tentativas de login falsificando o IP.

### Domínio próprio de cada hotel

Cada hotel pode ter o seu domínio (em **Hotéis → Editar → Domínio próprio**, por exemplo `www.hotelmavie.co.mz`). Quem abrir esse endereço vê diretamente o site desse hotel, servido por este mesmo servidor. O sistema aceita o domínio com e sem `www`.

1. No `backend\.env`, define `SITE_DNS_TARGET` com o IP público deste servidor (ex.: `41.220.10.5`) ou com o nome do sistema (ex.: `hgest.exemplo.co.mz`), e reinicia. Sem este valor, o sistema usa o endereço de `CORS_ORIGIN`.
2. Em **Hotéis**, abre o hotel e carrega em **Verificar DNS**: aparecem os registos a criar no fornecedor do domínio, normalmente `A` para o domínio sem `www` e `A` ou `CNAME` para o `www`. Depois de criados, volta a verificar; a propagação pode levar algumas horas.
3. No IIS, adiciona ao site do MAVIE-HGest os *bindings* do domínio (com e sem `www`) e emite o certificado com o win-acme, como na secção anterior. O mesmo `web.config` serve todos os domínios.

Sem IIS (Node exposto diretamente na porta 8080) os domínios próprios não funcionam bem, porque os visitantes esperam as portas 80/443 e HTTPS.

## 7. Atualizar para uma nova versão

```powershell
.\atualizar.ps1 -GitPull
```

Sem Git, substitui primeiro os ficheiros do projeto mantendo `backend\.env` e a pasta `dados`, e corre `.\atualizar.ps1`.

O atualizador:

1. Faz backup da base de dados (`dados\backups\antes-atualizacao-*.sql`).
2. Para o serviço.
3. Instala as dependências, aplica as migrações e compila.
4. Volta a arrancar o serviço.

Se algum passo falhar, arranca na mesma a versão que estiver compilada e indica como restaurar o backup.

## 8. Cópias de segurança

O que tem de estar sempre salvaguardado, de preferência também fora do servidor:

| O quê | Onde |
|---|---|
| Base de dados | `dados\backups\*.sql` (painel → Utilizadores → Backups, ou `servico.ps1 -Acao backup`) |
| Chave de assinatura AT | `dados\keys\at-private.pem`. **Se se perder, os documentos já emitidos deixam de poder ser verificados.** |
| Logotipos e fotografias | `dados\uploads` |
| Configuração | `backend\.env` |

Backup automático todos os dias às 02:00:

```powershell
$acao = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File C:\MAVIE-HGest\deploy\windows\servico.ps1 -Acao backup'
Register-ScheduledTask -TaskName 'MAVIE-HGest backup' -Action $acao -Trigger (New-ScheduledTaskTrigger -Daily -At 2am) -User SYSTEM -RunLevel Highest
```

## 9. Impressoras nos postos

Em cada computador que imprime talões diretamente, arranca o agente de impressão ([`print-agent`](../../print-agent/README.md)) e autoriza o endereço do sistema:

```bat
setx PRINT_AGENT_ORIGINS "http://servidor-hotel:8080"
```

Se os utilizadores entrarem às vezes pelo IP, acrescenta também esse endereço, separado por vírgula.

## 10. Mudar de servidor

1. No servidor antigo: `servico.ps1 -Acao backup` e copia `backend\.env` e a pasta `dados`.
2. No novo servidor: copia o projeto, repõe `backend\.env` e `dados`, e restaura a base de dados:

   ```powershell
   mysql -u mavie -p mavie_hgest < dados\backups\manual-AAAAMMDD-HHMMSS.sql
   ```

3. Confirma que os caminhos no `.env` existem (`BACKUP_DIR`, `UPLOAD_DIR`, `AT_PRIVATE_KEY_PATH`, `FRONTEND_DIR`) e corre `.\instalar.ps1`.

## 11. Vários hotéis de donos diferentes (uma base de dados por hotel)

Cada hotel corre como uma instância própria do mesmo código: tem a sua base de dados, um utilizador MySQL que só acede a essa base, a sua porta, as suas pastas e o seu serviço. Um hotel não consegue ver os dados de outro, e as cópias e os restauros são feitos hotel a hotel. O código é compilado uma só vez e partilhado por todos.

```
hotelmar.exemplo.pt  ──► IIS ──► Node :3101 ──► mavie_hotelmar
hotelsol.exemplo.pt  ──► IIS ──► Node :3102 ──► mavie_hotelsol
```

Num servidor usa-se um de dois modos: a instalação única (`instalar.ps1`) ou os hotéis em instâncias (`hoteis.ps1`). Não convém misturá-los.

### Criar um hotel com o assistente

Faz duplo clique em **`deploy\windows\Novo hotel.cmd`**. O Windows pede permissão de administrador e abre uma janela onde se preenche:

- o nome do hotel (o código é sugerido a partir do nome);
- o email e a password do administrador do hotel;
- o domínio, se o hotel o tiver;
- a conta do MySQL/MariaDB usada para criar a base de dados (por omissão `root`).

Ao abrir, o assistente verifica os **requisitos do servidor** e só deixa criar o hotel quando estão todos cumpridos. O que faltar instala-se com o botão **Instalar o que falta** (ver "Requisitos" a seguir).

Carrega em **Criar hotel**. O progresso aparece na própria janela e, no fim, o botão **Abrir o painel** abre o hotel novo no navegador. Por baixo, o assistente corre o mesmo comando `hoteis.ps1 -Acao novo` descrito a seguir.

Para ter o assistente à mão, cria um atalho para o `Novo hotel.cmd` no ambiente de trabalho do servidor.

### Requisitos verificados e instalados

| Requisito | Se faltar |
|---|---|
| Node.js 22 ou superior | Transfere o instalador oficial de nodejs.org, confirma o SHA-256 publicado e instala |
| Servidor MySQL / MariaDB a responder | Se houver um serviço MySQL/MariaDB parado, arranca-o. Senão, transfere o MariaDB 11.4 LTS de mariadb.org, confirma o SHA-256 e instala-o como serviço `MariaDB`, com o root a ficar com a password indicada |
| Ferramentas `mysql` e `mysqldump` | Vêm com o MySQL/MariaDB; se o servidor for remoto, é preciso instalar o cliente à mão |
| Acesso de administrador à base de dados | Não se instala: corrige o utilizador ou a password |
| MAVIE-HGest compilado | Instala as dependências e compila (precisa de internet) |
| IIS, URL Rewrite, Application Request Routing e proxy ativo (só com domínio) | Ativa o IIS no Windows, transfere os módulos de download.microsoft.com, confirma a assinatura da Microsoft, instala e ativa o proxy |

Um ficheiro transferido cuja verificação falhe é apagado e a instalação para. Os instaladores ficam em `%TEMP%\mavie-instaladores`.

O mesmo pela linha de comandos:

```powershell
.\requisitos.ps1                         # só verificar
.\requisitos.ps1 -Instalar               # instalar o que falta
.\requisitos.ps1 -Instalar -ComDominio   # inclui o IIS
```

O `hoteis.ps1 -Acao novo` também corre esta verificação e instala o que faltar antes de criar o hotel.

### Criar um hotel pela linha de comandos

PowerShell como Administrador, na pasta `deploy\windows`:

```powershell
.\hoteis.ps1 -Acao novo -Codigo hotelmar -Nome 'Hotel Mar' -AdminEmail dono@hotelmar.pt -Dominio hotelmar.exemplo.pt
```

O script:

1. Escolhe a primeira porta livre a partir da 3101 (ou a que indicares em `-Port`).
2. Cria a base de dados `mavie_<codigo>` e o utilizador MySQL `mavie_<codigo>`, com uma password aleatória.
3. Cria `dados\hoteis\<codigo>\` com `hotel.env`, `uploads`, `backups`, `logs` e `iis\web.config` já apontado para a porta do hotel.
4. Aplica as migrações e cria o hotel e o administrador. Pede a password do administrador, que não fica guardada.
5. Cria no ambiente de trabalho público do servidor (visível para todos os utilizadores) o atalho **MAVIE-HGest - <nome do hotel>**, que abre o painel do hotel.
6. Regista e arranca o serviço `MAVIE-HGest-<codigo>`.

| Parâmetro | Predefinição | Para quê |
|---|---|---|
| `-Codigo` | (obrigatório) | Letras minúsculas e números, 2 a 20. Dá nome à base de dados, ao serviço e à pasta |
| `-Nome`, `-AdminEmail` | (obrigatórios) | Nome do hotel e email do primeiro administrador |
| `-Dominio` | | Domínio do hotel atrás do IIS (HTTPS). Sem domínio fica `http://<servidor>:<porta>` |
| `-Port` | primeira livre a partir de 3101 | Porta interna do hotel |
| `-DbHost`, `-DbPort` | `localhost`, `3306` | Servidor MySQL/MariaDB |
| `-DbAdminUser`, `-DbAdminPassword` | `root`, vazio | Conta usada só para criar a base de dados e o utilizador do hotel |
| `-AbrirFirewall` | | Abre a porta do hotel na rede local (só sem `-Dominio`) |

Com domínio, cria no IIS um site para esse domínio, usa como pasta `dados\hoteis\<codigo>\iis` (que já tem o `web.config`) e emite o certificado com o win-acme, como na secção 6.

A chave de assinatura AT é a do produtor do software e é partilhada por todos os hotéis: `dados\keys\at-private.pem`. Guarda uma cópia fora do servidor.

### Gerir os hotéis

```powershell
.\hoteis.ps1                                   # estado de todos: porta, endereço, serviço e saúde
.\hoteis.ps1 -Acao reiniciar -Codigo hotelmar  # sem -Codigo aplica a todos
.\hoteis.ps1 -Acao parar -Codigo hotelmar
.\hoteis.ps1 -Acao iniciar -Codigo hotelmar
.\hoteis.ps1 -Acao logs -Codigo hotelmar
.\hoteis.ps1 -Acao backup                      # backup de todos para dados\hoteis\<codigo>\backups
.\hoteis.ps1 -Acao agendar-backups             # backup diario as 02:00, guarda 30 dias (-DiasBackup)
.\hoteis.ps1 -Acao atualizar -GitPull          # backup, para todos, compila uma vez, migra cada base e arranca
.\hoteis.ps1 -Acao atalho                      # volta a criar os atalhos do painel no ambiente de trabalho
.\hoteis.ps1 -Acao remover -Codigo hotelmar    # tira o servico e o atalho; base de dados e pasta ficam intactas
```

Para mudar o SMTP ou outra configuração de um hotel, edita `dados\hoteis\<codigo>\hotel.env` e faz `reiniciar` desse hotel.

Para passar um hotel para outro servidor, copia a pasta `dados\hoteis\<codigo>` e a chave AT, restaura o backup na base de dados nova, corrige `DATABASE_URL` no `hotel.env` e arranca-o com `executar.cmd "<pasta logs>" "<node.exe>" "<hotel.env>"`.

## 12. Resolução de problemas

| Sintoma | Verificar |
|---|---|
| Não abre noutro computador | `servico.ps1 -Acao estado` no servidor; firewall (`-AbrirFirewall`); usar o nome ou o IP do servidor |
| `EADDRINUSE` no registo | Outra aplicação usa a porta: muda `PORT` no `.env` e reinicia |
| `Can't reach database server` | MySQL/MariaDB parado ou credenciais erradas em `DATABASE_URL` |
| `Em producao define AT_PRIVATE_KEY...` | O ficheiro de `AT_PRIVATE_KEY_PATH` não existe |
| Painel em branco | `FRONTEND_DIR` aponta para `frontend\dist`? Corre `atualizar.ps1` |
| Talões não saem nos postos | Agente de impressão parado ou `PRINT_AGENT_ORIGINS` sem o endereço do sistema |
