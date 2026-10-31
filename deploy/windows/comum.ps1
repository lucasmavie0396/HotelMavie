$ErrorActionPreference = 'Stop'
if ([Console]::IsOutputRedirected) { [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false }

$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Backend = Join-Path $Raiz 'backend'
$Frontend = Join-Path $Raiz 'frontend'
$EnvFile = Join-Path $Backend '.env'
$MainJs = Join-Path $Backend 'dist\main.js'
$NomeTarefa = 'MAVIE-HGest'
$DadosHoteis = Join-Path $Raiz 'dados\hoteis'
$ChaveAtPartilhada = Join-Path $Raiz 'dados\keys\at-private.pem'

function U([string]$Text) {
  return [regex]::Unescape($Text)
}

function Write-Step([string]$Text) {
  Write-Host ''
  Write-Host "==> $Text" -ForegroundColor Cyan
}

function Write-Ok([string]$Text) {
  Write-Host "    $Text" -ForegroundColor Green
}

function Write-Note([string]$Text) {
  Write-Host "    $Text" -ForegroundColor Yellow
}

function Write-Utf8File([string]$Path, [string]$Content) {
  [IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding $false))
}

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal $identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-NodePath {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $default = Join-Path $env:ProgramFiles 'nodejs\node.exe'
  if (Test-Path $default) { return $default }
  throw 'Node.js nao encontrado. Instala o Node 22 LTS (https://nodejs.org) e volta a correr o script.'
}

function Assert-Node {
  $node = Get-NodePath
  $version = (& $node -v).Trim()
  $major = [int]($version.TrimStart('v').Split('.')[0])
  if ($major -lt 22) { throw "O MAVIE-HGest precisa do Node 22 ou superior (encontrado $version em $node)." }
  $nodeDir = Split-Path $node
  if (($env:Path -split ';') -notcontains $nodeDir) { $env:Path = "$nodeDir;$env:Path" }
  Write-Ok "Node $version ($node)"
  return $node
}

function Invoke-Native([string]$Exe, [string[]]$Arguments, [string]$WorkDir) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  Push-Location $WorkDir
  try {
    & $Exe @Arguments
    $code = $LASTEXITCODE
  } finally {
    Pop-Location
    $ErrorActionPreference = $previous
  }
  if ($code -ne 0) { throw "Falhou: $Exe $($Arguments -join ' ') (codigo $code)" }
}

function Read-EnvFile([string]$Path = $EnvFile) {
  $values = @{}
  if (-not (Test-Path $Path)) { return $values }
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
      $value = $Matches[2].Trim()
      if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      $values[$Matches[1]] = $value
    }
  }
  return $values
}

function ConvertFrom-DatabaseUrl([string]$Url) {
  $uri = [Uri]$Url
  $user = ''
  $password = ''
  if ($uri.UserInfo) {
    $parts = $uri.UserInfo.Split(':', 2)
    $user = [Uri]::UnescapeDataString($parts[0])
    if ($parts.Length -gt 1) { $password = [Uri]::UnescapeDataString($parts[1]) }
  }
  $port = 3306
  if ($uri.Port -gt 0) { $port = $uri.Port }
  return @{ Host = $uri.Host; Port = $port; User = $user; Password = $password; Database = $uri.AbsolutePath.Trim('/') }
}

function Find-MysqlTool([string]$Exe) {
  $command = Get-Command $Exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $candidates = @("C:\xampp\mysql\bin\$Exe")
  foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if ($base) {
      $candidates += Get-ChildItem -Path (Join-Path $base "MySQL\*\bin\$Exe"), (Join-Path $base "MariaDB*\bin\$Exe") -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
    }
  }
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  return $null
}

function Find-Mysqldump {
  return Find-MysqlTool 'mysqldump.exe'
}

function New-Secret([string]$Node, [int]$Bytes = 48) {
  return (& $Node -e "process.stdout.write(require('crypto').randomBytes($Bytes).toString('hex'))")
}

function New-EnvContent([hashtable]$Values) {
  $lines = @(
    'NODE_ENV=production',
    "DATABASE_URL=`"$($Values.DatabaseUrl)`"",
    "PORT=$($Values.Port)",
    "HOST=$($Values.Host)",
    "TRUST_PROXY=$($Values.Trust)",
    "CORS_ORIGIN=$($Values.PublicUrl)",
    "FRONTEND_DIR=$(Join-Path $Frontend 'dist')",
    'SITE_DNS_TARGET=',
    '',
    "JWT_SECRET=$($Values.Jwt)",
    'JWT_EXPIRES_IN_SECONDS=900',
    "JWT_REFRESH_SECRET=$($Values.Refresh)",
    'JWT_REFRESH_EXPIRES_IN_SECONDS=604800',
    '',
    "SEED_ADMIN_EMAIL=$($Values.AdminEmail)",
    '',
    "MYSQLDUMP_PATH=$($Values.Dump)",
    "BACKUP_DIR=$($Values.Backups)",
    "UPLOAD_DIR=$($Values.Uploads)",
    '',
    'SMTP_HOST=',
    'SMTP_PORT=587',
    'SMTP_SECURE=false',
    'SMTP_USER=',
    'SMTP_PASS=',
    'MAIL_FROM=',
    '',
    'GOOGLE_SEARCH_API_KEY=',
    'GOOGLE_SEARCH_CX=',
    '',
    "AT_PRIVATE_KEY_PATH=$($Values.KeyPath)",
    'AT_KEY_VERSION=1',
    'AT_CERTIFICATE_NUMBER=0',
    'AT_PRODUCER_TAX_ID=',
    "AT_TIMEZONE=$($Values.TimeZone)"
  )
  if ($Values.HotelName) { $lines += @('', "MAVIE_HOTEL_NAME=$($Values.HotelName)") }
  return ($lines -join "`r`n") + "`r`n"
}

function Initialize-AtKey([string]$Node, [string]$KeyPath) {
  if ($KeyPath -and -not (Test-Path $KeyPath)) {
    New-Item -ItemType Directory -Force (Split-Path $KeyPath) | Out-Null
    Invoke-Native $Node @((Join-Path $Backend 'scripts\generate-at-key.mjs'), $KeyPath) $Backend
    Write-Note 'Guarda uma copia da chave privada num local seguro: se se perder, os documentos ja emitidos deixam de poder ser verificados.'
  } elseif ($KeyPath) {
    Write-Ok "Chave existente mantida: $KeyPath"
  } else {
    Write-Note 'AT_PRIVATE_KEY_PATH nao definido no .env: garante que AT_PRIVATE_KEY esta preenchido.'
  }
}

function Backup-Database([hashtable]$Env, [string]$Prefix) {
  $dump = $Env['MYSQLDUMP_PATH']
  if (-not $dump -or -not (Test-Path $dump)) { $dump = Find-Mysqldump }
  if (-not $dump) { throw 'mysqldump nao encontrado: define MYSQLDUMP_PATH no backend\.env ou usa -SemBackup.' }
  $db = ConvertFrom-DatabaseUrl $Env['DATABASE_URL']
  $dir = $Env['BACKUP_DIR']
  if (-not $dir) { $dir = Join-Path $Backend 'backups' }
  if (-not [IO.Path]::IsPathRooted($dir)) { $dir = Join-Path $Backend $dir }
  New-Item -ItemType Directory -Force $dir | Out-Null
  $file = Join-Path $dir ('{0}-{1}.sql' -f $Prefix, (Get-Date -Format 'yyyyMMdd-HHmmss'))
  $env:MYSQL_PWD = $db.Password
  try {
    Invoke-Native $dump @('-h', $db.Host, '-P', "$($db.Port)", '-u', $db.User, '--single-transaction', '--routines', "--result-file=$file", $db.Database) $Backend
  } finally {
    Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue
  }
  Write-Ok "Backup: $file ($([math]::Round((Get-Item $file).Length / 1KB)) KB)"
  return $file
}

function Get-ApiProcess([string]$EnvPath) {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
    if (-not $_.CommandLine) { return $false }
    $line = $_.CommandLine.ToLowerInvariant()
    if (-not $line.Contains($MainJs.ToLowerInvariant())) { return $false }
    if ($EnvPath) { return $line.Contains($EnvPath.ToLowerInvariant()) }
    return -not $line.Contains('--env-file')
  }
}

function Get-ApiTask([string]$TaskName = $NomeTarefa) {
  Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

function Stop-Api([string]$TaskName = $NomeTarefa, [string]$EnvPath) {
  $task = Get-ApiTask $TaskName
  if ($task -and $task.State -eq 'Running') { Stop-ScheduledTask -TaskName $TaskName }
  foreach ($process in @(Get-ApiProcess $EnvPath)) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 1
}

function Start-Api([string]$TaskName = $NomeTarefa) {
  if (-not (Get-ApiTask $TaskName)) { throw "A tarefa $TaskName nao existe. Corre o instalador primeiro." }
  Start-ScheduledTask -TaskName $TaskName
}

function Wait-Health([int]$Port, [int]$Seconds = 90) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -eq 200) { return $true }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  return $false
}

function Get-Npm([string]$Node) {
  $npm = Join-Path (Split-Path $Node) 'npm.cmd'
  if (-not (Test-Path $npm)) { $npm = 'npm.cmd' }
  return $npm
}

function Invoke-Migrate([string]$Node, [string]$DatabaseUrl) {
  $previous = $env:DATABASE_URL
  $env:DATABASE_URL = $DatabaseUrl
  try {
    Invoke-Native (Get-Npm $Node) @('exec', '--', 'prisma', 'migrate', 'deploy') $Backend
  } finally {
    if ($null -eq $previous) { Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue } else { $env:DATABASE_URL = $previous }
  }
}

function Invoke-Build([string]$Node, [switch]$SemMigrar) {
  $npm = Get-Npm $Node
  Write-Step 'Dependencias do backend'
  Invoke-Native $npm @('ci', '--no-audit', '--no-fund') $Backend
  Write-Step 'Prisma generate'
  Invoke-Native $npm @('exec', '--', 'prisma', 'generate') $Backend
  if (-not $SemMigrar) {
    Write-Step 'Base de dados (migrate deploy)'
    Invoke-Native $npm @('exec', '--', 'prisma', 'migrate', 'deploy') $Backend
  }
  Write-Step 'Compilar o backend'
  Invoke-Native $npm @('run', 'build') $Backend
  Write-Step 'Dependencias e compilacao do painel'
  Invoke-Native $npm @('ci', '--no-audit', '--no-fund') $Frontend
  Invoke-Native $npm @('run', 'build') $Frontend
  Write-Ok 'Compilacao concluida'
}

function Register-ApiTask([string]$Node, [string]$LogDir, [string]$TaskName = $NomeTarefa, [string]$EnvPath = '', [string]$Description = 'MAVIE-HGest: API, painel e site publico') {
  $runner = Join-Path $PSScriptRoot 'executar.cmd'
  $arguments = "`"$runner`" `"$LogDir`" `"$Node`""
  if ($EnvPath) { $arguments += " `"$EnvPath`"" }
  $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$arguments`"" -WorkingDirectory $Backend
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $TaskName -Description $Description -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
}

function Get-PanelShortcutPath([string]$HotelName) {
  $safe = ($HotelName -replace '[\\/:*?"<>|]', '').Trim()
  return Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) "MAVIE-HGest - $safe.url"
}

function New-PanelShortcut([string]$HotelName, [string]$Url) {
  $path = Get-PanelShortcutPath $HotelName
  Write-Utf8File $path ("[InternetShortcut]`r`nURL=$Url`r`n")
  return $path
}

function Remove-PanelShortcut([string]$HotelName) {
  $path = Get-PanelShortcutPath $HotelName
  if (Test-Path $path) { Remove-Item $path -Force }
}

function Get-HotelInstances {
  if (-not (Test-Path $DadosHoteis)) { return @() }
  $result = @()
  foreach ($dir in Get-ChildItem -Path $DadosHoteis -Directory | Sort-Object Name) {
    $envPath = Join-Path $dir.FullName 'hotel.env'
    if (-not (Test-Path $envPath)) { continue }
    $values = Read-EnvFile $envPath
    $result += [pscustomobject]@{
      Codigo = $dir.Name
      Nome = $values['MAVIE_HOTEL_NAME']
      Dir = $dir.FullName
      EnvPath = $envPath
      Env = $values
      Port = [int]$values['PORT']
      Url = $values['CORS_ORIGIN']
      TaskName = "$NomeTarefa-$($dir.Name)"
      LogFile = Join-Path $dir.FullName 'logs\api.log'
    }
  }
  return $result
}
