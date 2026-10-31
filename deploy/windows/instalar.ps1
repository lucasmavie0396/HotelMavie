[CmdletBinding()]
param(
  [string]$PublicUrl,
  [int]$Port = 8080,
  [string]$DbHost = 'localhost',
  [int]$DbPort = 3306,
  [string]$DbName = 'mavie_hgest',
  [string]$DbUser = 'root',
  [string]$DbPassword = '',
  [string]$AdminEmail = 'admin@maviehgest.com',
  [string]$DataDir,
  [string]$TimeZone = 'Europe/Lisbon',
  [switch]$AtrasDoIIS,
  [switch]$AbrirFirewall,
  [switch]$SemServico,
  [switch]$SemSeed
)

. (Join-Path $PSScriptRoot 'comum.ps1')

if ((-not $SemServico -or $AbrirFirewall) -and -not (Test-Administrator)) {
  throw 'Abre o PowerShell como Administrador (necessario para criar o arranque automatico e a regra de firewall), ou usa -SemServico.'
}
if (-not $DataDir) { $DataDir = Join-Path $Raiz 'dados' }
$DataDir = [IO.Path]::GetFullPath($DataDir)
if (-not $PublicUrl) {
  $PublicUrl = "http://$($env:COMPUTERNAME.ToLowerInvariant()):$Port"
}
$PublicUrl = $PublicUrl.TrimEnd('/')

Write-Host "MAVIE-HGest - instalacao em $Raiz" -ForegroundColor White
Write-Step 'Verificar requisitos'
$node = Assert-Node
if (Get-ApiTask) {
  Write-Note 'Ja existe uma instalacao: a parar o servico antes de continuar'
  Stop-Api
}

$paths = @{
  Uploads = Join-Path $DataDir 'uploads'
  Backups = Join-Path $DataDir 'backups'
  Keys = Join-Path $DataDir 'keys'
  Logs = Join-Path $DataDir 'logs'
}
foreach ($path in $paths.Values) { New-Item -ItemType Directory -Force $path | Out-Null }
Write-Ok "Dados em $DataDir"

$firstInstall = -not (Test-Path $EnvFile)
Write-Step 'Configuracao (backend\.env)'
if ($firstInstall) {
  $credentials = [Uri]::EscapeDataString($DbUser)
  if ($DbPassword) { $credentials += ':' + [Uri]::EscapeDataString($DbPassword) }
  $dump = Find-Mysqldump
  if (-not $dump) {
    $dump = ''
    Write-Note 'mysqldump nao encontrado: os backups pelo painel ficam indisponiveis ate definires MYSQLDUMP_PATH.'
  }
  $hostLine = ''
  $trust = '0'
  if ($AtrasDoIIS) {
    $hostLine = '127.0.0.1'
    $trust = 'loopback'
  }
  $content = New-EnvContent @{
    DatabaseUrl = "mysql://$credentials@${DbHost}:$DbPort/$DbName"
    Port = $Port
    Host = $hostLine
    Trust = $trust
    PublicUrl = $PublicUrl
    Jwt = New-Secret $node
    Refresh = New-Secret $node
    AdminEmail = $AdminEmail
    Dump = $dump
    Backups = $paths.Backups
    Uploads = $paths.Uploads
    KeyPath = Join-Path $paths.Keys 'at-private.pem'
    TimeZone = $TimeZone
  }
  Write-Utf8File $EnvFile $content
  Write-Ok "Criado $EnvFile (segredos JWT gerados)"
} else {
  Write-Note "Ja existe $EnvFile e nao foi alterado. Edita-o a mao se quiseres mudar porta, URL ou base de dados."
}
$envValues = Read-EnvFile
$Port = [int]$envValues['PORT']

Write-Step 'Chave de assinatura AT'
Initialize-AtKey $node $envValues['AT_PRIVATE_KEY_PATH']

Invoke-Build $node

if ($firstInstall -and -not $SemSeed) {
  Write-Step 'Administrador inicial'
  $password = $env:MAVIE_ADMIN_PASSWORD
  if (-not $password) {
    $secure = Read-Host "Password para $AdminEmail (minimo 8 caracteres)" -AsSecureString
    $password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  }
  $env:SEED_ADMIN_PASSWORD = $password
  try {
    Invoke-Native $node @('dist\database\seed.js') $Backend
  } finally {
    Remove-Item Env:\SEED_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  }
  Write-Ok "Administrador: $AdminEmail (a password nao fica guardada no .env)"
}

if ($AbrirFirewall) {
  Write-Step "Firewall: abrir a porta $Port"
  if (-not (Get-NetFirewallRule -DisplayName $NomeTarefa -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $NomeTarefa -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Domain, Private | Out-Null
    Write-Ok 'Regra criada (redes de dominio e privadas)'
  } else {
    Write-Ok 'Regra ja existia'
  }
}

if ($SemServico) {
  Write-Step 'Concluido (sem arranque automatico)'
  Write-Host "    Para arrancar: deploy\windows\executar.cmd `"$($paths.Logs)`" `"$node`""
  return
}

Write-Step 'Arranque automatico com o Windows'
Register-ApiTask $node $paths.Logs
Start-Api
if (Wait-Health $Port) {
  Write-Ok "A correr: tarefa '$NomeTarefa' (conta SYSTEM, arranca com o Windows e reinicia sozinha)"
} else {
  Write-Note "A API nao respondeu em 90 s. Ve o registo: $(Join-Path $paths.Logs 'api.log')"
  exit 1
}

Write-Step 'Pronto'
Write-Host "    Painel:        $PublicUrl"
Write-Host "    Site publico:  $PublicUrl/h/<endereco-do-hotel>"
Write-Host "    Registos:      $(Join-Path $paths.Logs 'api.log')"
Write-Host "    Gerir:         deploy\windows\servico.ps1 -Acao estado|parar|iniciar|reiniciar|logs"
Write-Host "    Atualizar:     deploy\windows\atualizar.ps1"
Write-Host "    Impressao:     nos postos com impressoras locais, PRINT_AGENT_ORIGINS=$PublicUrl (ver print-agent\README.md)"
