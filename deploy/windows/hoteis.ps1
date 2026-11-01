[CmdletBinding()]
param(
  [ValidateSet('estado', 'novo', 'atalho', 'iniciar', 'parar', 'reiniciar', 'logs', 'backup', 'agendar-backups', 'atualizar', 'remover')]
  [string]$Acao = 'estado',
  [string]$Codigo,
  [string]$Nome,
  [string]$AdminEmail,
  [string]$Dominio,
  [int]$Port,
  [string]$DbHost = 'localhost',
  [int]$DbPort = 3306,
  [string]$DbAdminUser = 'root',
  [string]$DbAdminPassword = '',
  [string]$TimeZone = 'Europe/Lisbon',
  [int]$DiasBackup = 30,
  [int]$Linhas = 60,
  [switch]$AbrirFirewall,
  [switch]$SemServico,
  [switch]$GitPull,
  [switch]$SemBackup
)

. (Join-Path $PSScriptRoot 'comum.ps1')

if (-not $DbAdminPassword -and $env:MAVIE_DB_ADMIN_PASSWORD) { $DbAdminPassword = $env:MAVIE_DB_ADMIN_PASSWORD }

function Assert-Admin {
  if (-not (Test-Administrator)) { throw 'Abre o PowerShell como Administrador.' }
}

function Get-Targets {
  $all = @(Get-HotelInstances)
  if (-not $Codigo) { return $all }
  $found = @($all | Where-Object { $_.Codigo -eq $Codigo.ToLowerInvariant() })
  if (-not $found) { throw "Nao existe o hotel '$Codigo'. Ve a lista com: hoteis.ps1 -Acao estado" }
  return $found
}

function Get-Health([int]$HealthPort) {
  try {
    Invoke-RestMethod -Uri "http://127.0.0.1:$HealthPort/api/health" -TimeoutSec 3 | Out-Null
    return 'ok'
  } catch {
    return 'sem resposta'
  }
}

function Get-FreePort {
  $used = @(Get-HotelInstances | ForEach-Object { $_.Port })
  $defaultEnv = Read-EnvFile
  if ($defaultEnv['PORT']) { $used += [int]$defaultEnv['PORT'] }
  for ($candidate = 3101; $candidate -lt 3999; $candidate++) {
    if ($used -contains $candidate) { continue }
    if (Get-NetTCPConnection -State Listen -LocalPort $candidate -ErrorAction SilentlyContinue) { continue }
    return $candidate
  }
  throw 'Nao ha portas livres entre 3101 e 3999.'
}

function Invoke-MysqlAdmin([string]$Mysql, [string]$Sql) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $env:MYSQL_PWD = $DbAdminPassword
  try {
    $output = & $Mysql -h $DbHost -P "$DbPort" -u $DbAdminUser -N -B -e $Sql
    $code = $LASTEXITCODE
  } finally {
    Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue
    $ErrorActionPreference = $previous
  }
  if ($code -ne 0) { throw "Falhou o comando na base de dados como $DbAdminUser (codigo $code)" }
  return $output
}

function Remove-OldBackups([string]$Dir) {
  $limit = (Get-Date).AddDays(-$DiasBackup)
  Get-ChildItem -Path $Dir -Filter 'diario-*.sql' -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt $limit } | Remove-Item -Force
}

function New-Hotel {
  Assert-Admin
  if (-not $Codigo -or -not $Nome -or -not $AdminEmail) { throw 'Indica -Codigo, -Nome e -AdminEmail.' }
  $code = $Codigo.ToLowerInvariant()
  if ($code -notmatch '^[a-z0-9]{2,20}$') { throw 'O codigo so pode ter letras minusculas e numeros (2 a 20), por exemplo: hotelmar' }
  $dir = Join-Path $DadosHoteis $code
  if (Test-Path (Join-Path $dir 'hotel.env')) { throw "O hotel '$code' ja existe em $dir" }

  Write-Host "MAVIE-HGest - novo hotel '$Nome' ($code)" -ForegroundColor White
  Write-Step 'Verificar e instalar requisitos'
  . (Join-Path $PSScriptRoot 'requisitos.ps1') -DbHost $DbHost -DbPort $DbPort -DbAdminUser $DbAdminUser -DbAdminPassword $DbAdminPassword
  Install-MissingRequirements -Dominio:([bool]$Dominio)
  $node = Assert-Node
  $mysql = Find-MysqlTool 'mysql.exe'
  $dump = Find-Mysqldump
  $dbName = "mavie_$code"
  $dbUser = "mavie_$code"
  $exists = Invoke-MysqlAdmin $mysql "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = '$dbName'"
  if ("$exists".Trim() -ne '0') { throw "A base de dados $dbName ja existe. Escolhe outro codigo ou remove-a a mao." }
  if (-not $Port) { $Port = Get-FreePort }
  Write-Ok "Base de dados $dbName, porta $Port"

  Write-Step 'Criar a base de dados e o utilizador proprio'
  $dbPassword = New-Secret $node 24
  $userHost = 'localhost'
  if ($DbHost -notin @('localhost', '127.0.0.1')) { $userHost = '%' }
  Invoke-MysqlAdmin $mysql ("CREATE DATABASE ``$dbName`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; " +
    "CREATE USER IF NOT EXISTS '$dbUser'@'$userHost' IDENTIFIED BY '$dbPassword'; " +
    "ALTER USER '$dbUser'@'$userHost' IDENTIFIED BY '$dbPassword'; " +
    "GRANT ALL PRIVILEGES ON ``$dbName``.* TO '$dbUser'@'$userHost'; FLUSH PRIVILEGES;") | Out-Null
  Write-Ok "Utilizador $dbUser so com acesso a $dbName (password gerada, guardada no hotel.env)"

  $paths = @{
    Uploads = Join-Path $dir 'uploads'
    Backups = Join-Path $dir 'backups'
    Logs = Join-Path $dir 'logs'
    Iis = Join-Path $dir 'iis'
  }
  foreach ($path in $paths.Values) { New-Item -ItemType Directory -Force $path | Out-Null }

  Write-Step 'Chave de assinatura AT (partilhada por todos os hoteis)'
  Initialize-AtKey $node $ChaveAtPartilhada

  $hostLine = ''
  $trust = '0'
  $publicUrl = "http://$($env:COMPUTERNAME.ToLowerInvariant()):$Port"
  if ($Dominio) {
    $publicUrl = "https://$($Dominio.Trim().TrimEnd('/'))"
    $hostLine = '127.0.0.1'
    $trust = 'loopback'
  }
  $databaseUrl = "mysql://${dbUser}:$dbPassword@${DbHost}:$DbPort/$dbName"
  $envPath = Join-Path $dir 'hotel.env'
  Write-Utf8File $envPath (New-EnvContent @{
    DatabaseUrl = $databaseUrl
    Port = $Port
    Host = $hostLine
    Trust = $trust
    PublicUrl = $publicUrl
    Jwt = New-Secret $node
    Refresh = New-Secret $node
    AdminEmail = $AdminEmail
    Dump = $dump
    Backups = $paths.Backups
    Uploads = $paths.Uploads
    KeyPath = $ChaveAtPartilhada
    TimeZone = $TimeZone
    HotelName = $Nome
  })
  Write-Ok "Configuracao: $envPath"

  Write-Step 'Tabelas (migrate deploy)'
  Invoke-Migrate $node $databaseUrl

  Write-Step 'Hotel e administrador'
  $password = $env:MAVIE_ADMIN_PASSWORD
  if (-not $password) {
    $secure = Read-Host "Password para $AdminEmail (minimo 8 caracteres)" -AsSecureString
    $password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  }
  $seedEnv = @{ DATABASE_URL = $databaseUrl; SEED_ADMIN_EMAIL = $AdminEmail; SEED_ADMIN_PASSWORD = $password; SEED_HOTEL_NAME = $Nome; SEED_HOTEL_SLUG = $code; SEED_DEMO_ROOMS = '0' }
  foreach ($key in $seedEnv.Keys) { Set-Item "Env:\$key" $seedEnv[$key] }
  try {
    Invoke-Native $node @('dist\database\seed.js') $Backend
  } finally {
    foreach ($key in $seedEnv.Keys) { Remove-Item "Env:\$key" -ErrorAction SilentlyContinue }
  }

  $template = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'iis\web.config'))
  Write-Utf8File (Join-Path $paths.Iis 'web.config') ($template.Replace('127.0.0.1:3000', "127.0.0.1:$Port"))

  $taskName = "$NomeTarefa-$code"
  if ($AbrirFirewall -and -not $Dominio) {
    if (-not (Get-NetFirewallRule -DisplayName $taskName -ErrorAction SilentlyContinue)) {
      New-NetFirewallRule -DisplayName $taskName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Domain, Private | Out-Null
    }
    Write-Ok "Firewall: porta $Port aberta (redes de dominio e privadas)"
    $public = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.NetworkCategory -eq 'Public' })
    if ($public.Count) { Write-Note "A rede '$($public[0].Name)' esta como Publica: os postos so chegam ao sistema depois de a mudar para Privada (Definicoes > Rede e Internet)." }
  }

  $shortcut = New-PanelShortcut $Nome $publicUrl
  Write-Ok "Atalho do painel no ambiente de trabalho: $shortcut"

  if ($SemServico) {
    Write-Step 'Concluido (sem arranque automatico)'
    Write-Host "    Para arrancar: deploy\windows\executar.cmd `"$($paths.Logs)`" `"$node`" `"$envPath`""
    return
  }

  Write-Step 'Arranque automatico com o Windows'
  Register-ApiTask $node $paths.Logs $taskName $envPath "MAVIE-HGest: $Nome"
  Start-Api $taskName
  if (-not (Wait-Health $Port)) {
    Write-Note "A API nao respondeu em 90 s. Ve o registo: $(Join-Path $paths.Logs 'api.log')"
    exit 1
  }
  Write-Ok "A correr: tarefa '$taskName'"

  Write-Step 'Pronto'
  Write-Host "    Painel:        $publicUrl"
  Write-Host "    Site publico:  $publicUrl/h/$code"
  Write-Host "    Administrador: $AdminEmail"
  Write-Host "    Dados:         $dir"
  if ($Dominio) {
    Write-Host "    IIS:           cria um site para $Dominio com o ficheiro $(Join-Path $paths.Iis 'web.config') (README, seccao 11)"
  }
}

switch ($Acao) {
  'estado' {
    $rows = foreach ($item in Get-Targets) {
      $task = Get-ApiTask $item.TaskName
      $state = 'sem servico'
      if ($task) { $state = "$($task.State)" }
      [pscustomobject]@{ Codigo = $item.Codigo; Hotel = $item.Nome; Porta = $item.Port; Endereco = $item.Url; Servico = $state; Saude = Get-Health $item.Port }
    }
    if ($rows) { $rows | Format-Table -AutoSize } else { Write-Note 'Ainda nao ha hoteis. Cria o primeiro com: hoteis.ps1 -Acao novo -Codigo ... -Nome ... -AdminEmail ...' }
  }
  'novo' { New-Hotel }
  'atalho' {
    Assert-Admin
    foreach ($item in Get-Targets) {
      $label = $item.Nome
      if (-not $label) { $label = $item.Codigo }
      Write-Ok "$($item.Codigo): $(New-PanelShortcut $label $item.Url)"
    }
  }
  'iniciar' {
    Assert-Admin
    foreach ($item in Get-Targets) {
      Start-Api $item.TaskName
      if (Wait-Health $item.Port) { Write-Ok "$($item.Codigo): a correr" } else { Write-Note "$($item.Codigo): sem resposta, ve $($item.LogFile)" }
    }
  }
  'parar' {
    Assert-Admin
    foreach ($item in Get-Targets) {
      Stop-Api $item.TaskName $item.EnvPath
      Write-Ok "$($item.Codigo): parado"
    }
  }
  'reiniciar' {
    Assert-Admin
    foreach ($item in Get-Targets) {
      Stop-Api $item.TaskName $item.EnvPath
      Start-Api $item.TaskName
      if (Wait-Health $item.Port) { Write-Ok "$($item.Codigo): a correr" } else { Write-Note "$($item.Codigo): sem resposta, ve $($item.LogFile)" }
    }
  }
  'logs' {
    if (-not $Codigo) { throw 'Indica -Codigo.' }
    $item = @(Get-Targets)[0]
    if (Test-Path $item.LogFile) { Get-Content $item.LogFile -Tail $Linhas } else { Write-Note "Ainda nao ha registo em $($item.LogFile)" }
  }
  'backup' {
    $failed = 0
    foreach ($item in Get-Targets) {
      try {
        Backup-Database $item.Env 'diario' | Out-Null
        Remove-OldBackups $item.Env['BACKUP_DIR']
      } catch {
        $failed++
        Write-Host "$($item.Codigo): backup falhou: $($_.Exception.Message)" -ForegroundColor Red
      }
    }
    if ($failed) { exit 1 }
  }
  'agendar-backups' {
    Assert-Admin
    $script = Join-Path $PSScriptRoot 'hoteis.ps1'
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -Acao backup -DiasBackup $DiasBackup"
    Register-ScheduledTask -TaskName "$NomeTarefa backups hoteis" -Description 'MAVIE-HGest: backup diario de todos os hoteis' -Action $action -Trigger (New-ScheduledTaskTrigger -Daily -At 2am) -User SYSTEM -RunLevel Highest -Force | Out-Null
    Write-Ok "Backup diario as 02:00 de todos os hoteis, guardados $DiasBackup dias"
  }
  'atualizar' {
    Assert-Admin
    if ($Codigo) { throw 'A atualizacao e feita a todos os hoteis de uma vez, porque partilham o mesmo codigo. Tira o -Codigo.' }
    $items = @(Get-HotelInstances)
    if (-not $items) { throw 'Ainda nao ha hoteis.' }
    Write-Host 'MAVIE-HGest - atualizacao de todos os hoteis' -ForegroundColor White
    Write-Step 'Verificar requisitos'
    $node = Assert-Node
    if ($GitPull) {
      Write-Step 'Obter a nova versao (git pull)'
      Invoke-Native 'git' @('pull', '--ff-only') $Raiz
    }
    if (-not $SemBackup) {
      Write-Step 'Backup de cada hotel antes de atualizar'
      foreach ($item in $items) { Backup-Database $item.Env 'antes-atualizacao' | Out-Null }
    }
    $defaultEnv = Read-EnvFile
    $defaultTask = Get-ApiTask
    Write-Step 'Parar todos os hoteis'
    foreach ($item in $items) { Stop-Api $item.TaskName $item.EnvPath }
    if ($defaultTask) { Stop-Api }
    Write-Ok 'Parados'
    $failed = $null
    try {
      Invoke-Build $node -SemMigrar
      if ($defaultEnv['DATABASE_URL']) {
        Write-Step 'Migracoes: instalacao principal (backend\.env)'
        Invoke-Migrate $node $defaultEnv['DATABASE_URL']
      }
      foreach ($item in $items) {
        Write-Step "Migracoes: $($item.Codigo)"
        Invoke-Migrate $node $item.Env['DATABASE_URL']
      }
    } catch {
      $failed = $_
    }
    Write-Step 'Arrancar os hoteis'
    if ($defaultTask) {
      Start-Api
      if (Wait-Health ([int]$defaultEnv['PORT'])) { Write-Ok 'Instalacao principal: a correr' } else { Write-Note 'Instalacao principal: sem resposta' }
    }
    foreach ($item in $items) {
      if (-not (Get-ApiTask $item.TaskName)) { Write-Note "$($item.Codigo): sem servico"; continue }
      Start-Api $item.TaskName
      if (Wait-Health $item.Port) { Write-Ok "$($item.Codigo): a correr" } else { Write-Note "$($item.Codigo): sem resposta, ve $($item.LogFile)" }
    }
    if ($failed) {
      Write-Host ''
      Write-Host "A atualizacao falhou: $($failed.Exception.Message)" -ForegroundColor Red
      Write-Host 'Cada base de dados so muda no passo de migracoes. Para voltar atras, restaura o backup antes-atualizacao do hotel afetado e repoe a versao anterior do codigo.'
      exit 1
    }
    Write-Step 'Atualizacao concluida'
  }
  'remover' {
    Assert-Admin
    if (-not $Codigo) { throw 'Indica -Codigo.' }
    $item = @(Get-Targets)[0]
    Stop-Api $item.TaskName $item.EnvPath
    if (Get-ApiTask $item.TaskName) { Unregister-ScheduledTask -TaskName $item.TaskName -Confirm:$false }
    Get-NetFirewallRule -DisplayName $item.TaskName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    if ($item.Nome) { Remove-PanelShortcut $item.Nome }
    Remove-PanelShortcut $item.Codigo
    Write-Ok "$($item.Codigo): servico, regra de firewall e atalho removidos."
    Write-Note "A base de dados mavie_$($item.Codigo) e a pasta $($item.Dir) ficam intactas. Apaga-as a mao so depois de guardares um backup."
  }
}
