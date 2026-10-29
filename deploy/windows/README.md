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

## 11. Resolução de problemas

| Sintoma | Verificar |
|---|---|
| Não abre noutro computador | `servico.ps1 -Acao estado` no servidor; firewall (`-AbrirFirewall`); usar o nome ou o IP do servidor |
| `EADDRINUSE` no registo | Outra aplicação usa a porta: muda `PORT` no `.env` e reinicia |
| `Can't reach database server` | MySQL/MariaDB parado ou credenciais erradas em `DATABASE_URL` |
| `Em producao define AT_PRIVATE_KEY...` | O ficheiro de `AT_PRIVATE_KEY_PATH` não existe |
| Painel em branco | `FRONTEND_DIR` aponta para `frontend\dist`? Corre `atualizar.ps1` |
| Talões não saem nos postos | Agente de impressão parado ou `PRINT_AGENT_ORIGINS` sem o endereço do sistema |
