$ErrorActionPreference = 'Stop'

$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Backend = Join-Path $Raiz 'backend'
$Frontend = Join-Path $Raiz 'frontend'
$EnvFile = Join-Path $Backend '.env'
$MainJs = Join-Path $Backend 'dist\main.js'
$NomeTarefa = 'MAVIE-HGest'

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

function Find-Mysqldump {
  $command = Get-Command mysqldump.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $candidates = @('C:\xampp\mysql\bin\mysqldump.exe')
  foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if ($base) {
      $candidates += Get-ChildItem -Path (Join-Path $base 'MySQL\*\bin\mysqldump.exe'), (Join-Path $base 'MariaDB*\bin\mysqldump.exe') -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
    }
  }
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  return $null
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

function Get-ApiProcess {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($MainJs.ToLowerInvariant()) }
}

function Get-ApiTask {
  Get-ScheduledTask -TaskName $NomeTarefa -ErrorAction SilentlyContinue
}

function Stop-Api {
  $task = Get-ApiTask
  if ($task -and $task.State -eq 'Running') { Stop-ScheduledTask -TaskName $NomeTarefa }
  foreach ($process in @(Get-ApiProcess)) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 1
}

function Start-Api {
  if (-not (Get-ApiTask)) { throw "A tarefa $NomeTarefa nao existe. Corre instalar.ps1 primeiro." }
  Start-ScheduledTask -TaskName $NomeTarefa
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

function Invoke-Build([string]$Node) {
  $npm = Join-Path (Split-Path $Node) 'npm.cmd'
  if (-not (Test-Path $npm)) { $npm = 'npm.cmd' }
  Write-Step 'Dependencias do backend'
  Invoke-Native $npm @('ci', '--no-audit', '--no-fund') $Backend
  Write-Step 'Base de dados (prisma generate + migrate deploy)'
  Invoke-Native $npm @('exec', '--', 'prisma', 'generate') $Backend
  Invoke-Native $npm @('exec', '--', 'prisma', 'migrate', 'deploy') $Backend
  Write-Step 'Compilar o backend'
  Invoke-Native $npm @('run', 'build') $Backend
  Write-Step 'Dependencias e compilacao do painel'
  Invoke-Native $npm @('ci', '--no-audit', '--no-fund') $Frontend
  Invoke-Native $npm @('run', 'build') $Frontend
  Write-Ok 'Compilacao concluida'
}

function Register-ApiTask([string]$Node, [string]$LogDir) {
  $runner = Join-Path $PSScriptRoot 'executar.cmd'
  $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$runner`" `"$LogDir`" `"$Node`"`"" -WorkingDirectory $Backend
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $NomeTarefa -Description 'MAVIE-HGest: API, painel e site publico' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
}
