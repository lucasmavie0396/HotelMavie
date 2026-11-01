[CmdletBinding()]
param(
  [switch]$Instalar,
  [switch]$ComDominio,
  [string]$DbHost = 'localhost',
  [int]$DbPort = 3306,
  [string]$DbAdminUser = 'root',
  [string]$DbAdminPassword = ''
)

. (Join-Path $PSScriptRoot 'comum.ps1')

if (-not $DbAdminPassword -and $env:MAVIE_DB_ADMIN_PASSWORD) { $DbAdminPassword = $env:MAVIE_DB_ADMIN_PASSWORD }

$NodeMajor = 22
$WindowsBuildMinimo = 14393
$MariaDbSerie = '11.4'
$Instaladores = Join-Path $env:TEMP 'mavie-instaladores'
$UrlRewriteMsi = 'https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi'
$ArrMsi = 'https://download.microsoft.com/download/E/9/8/E9849D6A-020E-47E4-9FD0-A023E99B54EB/requestRouter_amd64.msi'
$AppCmd = Join-Path $env:windir 'system32\inetsrv\appcmd.exe'

function Update-PathFromRegistry {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = (@($machine, $user) | Where-Object { $_ }) -join ';'
}

function Find-Node {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $default = Join-Path $env:ProgramFiles 'nodejs\node.exe'
  if (Test-Path $default) { return $default }
  return $null
}

function Test-TcpPort([string]$TargetHost, [int]$TargetPort) {
  $client = New-Object Net.Sockets.TcpClient
  try {
    $task = $client.ConnectAsync($TargetHost, $TargetPort)
    return ($task.Wait(2000) -and $client.Connected)
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Test-LocalDbHost {
  return $DbHost -in @('localhost', '127.0.0.1', '::1', $env:COMPUTERNAME)
}

function Get-StoppedDbService {
  Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'mysql|mariadb' -and $_.Status -ne 'Running' } | Select-Object -First 1
}

function Get-WindowsInfo {
  $os = Get-CimInstance Win32_OperatingSystem
  $build = [int]$os.BuildNumber
  return [pscustomobject]@{
    Nome = $os.Caption -replace '^Microsoft\s+', ''
    Build = $build
    Cliente = ($os.ProductType -eq 1)
    Ok = ([Environment]::Is64BitOperatingSystem -and $build -ge $WindowsBuildMinimo)
  }
}

function Get-SleepTimeouts {
  $result = @{}
  foreach ($setting in @('STANDBYIDLE', 'HIBERNATEIDLE')) {
    $output = & powercfg.exe /query SCHEME_CURRENT SUB_SLEEP $setting 2>$null
    if ($LASTEXITCODE -ne 0) { continue }
    $values = @($output | Where-Object { $_ -match ':\s*0x[0-9a-fA-F]+\s*$' } | ForEach-Object { [Convert]::ToInt32(($_ -replace '^.*0x', ''), 16) })
    if ($values.Count -ge 2) { $result[$setting] = $values[$values.Count - 2] }
  }
  return $result
}

function Find-DbManager {
  $candidates = @(
    (Join-Path $env:CommonProgramFiles 'MariaDBShared\HeidiSQL\heidisql.exe'),
    (Join-Path $env:ProgramFiles 'HeidiSQL\heidisql.exe'),
    'C:\xampp\phpMyAdmin\index.php'
  )
  if (${env:ProgramFiles(x86)}) { $candidates += Join-Path ${env:ProgramFiles(x86)} 'HeidiSQL\heidisql.exe' }
  $candidates += Get-ChildItem -Path (Join-Path $env:ProgramFiles 'MySQL\MySQL Workbench*\MySQLWorkbench.exe'), (Join-Path $env:ProgramFiles 'DBeaver\dbeaver.exe') -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  return $null
}

function Test-DbLogin([string]$Password = $DbAdminPassword) {
  $mysql = Find-MysqlTool 'mysql.exe'
  if (-not $mysql) { return $false }
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $env:MYSQL_PWD = $Password
  try {
    & $mysql -h $DbHost -P "$DbPort" -u $DbAdminUser -N -B -e 'SELECT 1' 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
  } finally {
    Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue
    $ErrorActionPreference = $previous
  }
}

function Test-IisInstalled {
  return (Test-Path (Join-Path $env:windir 'system32\inetsrv\w3wp.exe')) -and (Test-Path $AppCmd)
}

function Test-IisProxy {
  if (-not (Test-Path $AppCmd)) { return $false }
  $proxy = (& $AppCmd list config -section:system.webServer/proxy) -join ' '
  $variables = (& $AppCmd list config -section:system.webServer/rewrite/allowedServerVariables) -join ' '
  return ($proxy -match 'enabled="true"') -and ($variables -match 'HTTP_X_FORWARDED_PROTO')
}

function New-Requirement([string]$Id, [string]$Nome, [bool]$Ok, [string]$Detalhe, [bool]$Instalavel) {
  return [pscustomobject]@{ Id = $Id; Nome = $Nome; Ok = $Ok; Detalhe = $Detalhe; Instalavel = $Instalavel }
}

function Get-InstalledText([bool]$Ok) {
  if ($Ok) { return 'Instalado' }
  return U 'N\u00e3o instalado'
}

function Get-Requirements([switch]$Dominio) {
  $list = @()

  $windows = Get-WindowsInfo
  $detail = "$($windows.Nome) (build $($windows.Build))"
  if (-not $windows.Ok) { $detail += U ': precisa do Windows 10, 11 ou Server 2016 ou superior, de 64 bits' }
  $list += New-Requirement 'sistema' 'Windows 10, 11 ou Server (64 bits)' $windows.Ok $detail $false

  $timeouts = Get-SleepTimeouts
  $sleepOk = -not (@($timeouts.Values | Where-Object { $_ -gt 0 }).Count)
  $detail = U 'Nunca suspende quando ligado \u00e0 corrente'
  if (-not $sleepOk) { $detail = U 'Entra em suspens\u00e3o: os postos perdem o acesso ao sistema' }
  $list += New-Requirement 'energia' (U 'Computador sem suspens\u00e3o autom\u00e1tica') $sleepOk $detail $true

  $node = Find-Node
  $version = $null
  if ($node) { $version = (& $node -v).Trim() }
  $nodeOk = [bool]($version -and ([int]$version.TrimStart('v').Split('.')[0] -ge $NodeMajor))
  $detail = U 'N\u00e3o instalado'
  if ($version) { $detail = $version + (U " (precisa da vers\u00e3o $NodeMajor ou superior)") }
  if ($nodeOk) { $detail = $version }
  $list += New-Requirement 'node' "Node.js $NodeMajor ou superior" $nodeOk $detail $true

  $serverOk = Test-TcpPort $DbHost $DbPort
  $detail = "A responder em ${DbHost}:$DbPort"
  if (-not $serverOk) {
    $stopped = Get-StoppedDbService
    if ($stopped) { $detail = (U 'Servi\u00e7o ') + "$($stopped.Name) parado" }
    elseif (Test-LocalDbHost) { $detail = "Nada a responder em ${DbHost}:$DbPort" }
    else { $detail = "Sem resposta de ${DbHost}:$DbPort (servidor remoto)" }
  }
  $list += New-Requirement 'db-servidor' 'Servidor MySQL / MariaDB' $serverOk $detail (Test-LocalDbHost)

  $mysql = Find-MysqlTool 'mysql.exe'
  $dump = Find-Mysqldump
  $clientOk = [bool]($mysql -and $dump)
  $detail = U 'mysql.exe ou mysqldump.exe n\u00e3o encontrados'
  if ($clientOk) { $detail = Split-Path $mysql }
  $list += New-Requirement 'db-cliente' 'Ferramentas mysql e mysqldump' $clientOk $detail $true

  $manager = Find-DbManager
  $detail = U 'N\u00e3o instalado (instala o HeidiSQL)'
  if ($manager) { $detail = $manager }
  $list += New-Requirement 'db-gestor' 'Gestor da base de dados' ([bool]$manager) $detail $true

  $loginOk = [bool]($serverOk -and $clientOk -and (Test-DbLogin))
  $detail = "Conta $DbAdminUser aceite"
  if (-not $loginOk) {
    $detail = (U 'N\u00e3o foi poss\u00edvel entrar como ') + "$DbAdminUser (verifique a password)"
    if ($serverOk -and $clientOk -and $DbAdminPassword -and (Test-DbLogin '')) { $detail = "A conta $DbAdminUser" + (U ' deste servidor n\u00e3o tem password: deixe o campo Password vazio') }
  }
  if (-not ($serverOk -and $clientOk)) { $detail = 'Depende do servidor e das ferramentas acima' }
  $list += New-Requirement 'db-login' (U 'Acesso de administrador \u00e0 base de dados') $loginOk $detail $false

  $buildOk = (Test-Path $MainJs) -and (Test-Path (Join-Path $Frontend 'dist\index.html')) -and (Test-Path (Join-Path $Backend 'node_modules\.prisma\client'))
  $detail = 'Pronto'
  if (-not $buildOk) { $detail = U 'Falta instalar as depend\u00eancias e compilar' }
  $list += New-Requirement 'compilacao' 'MAVIE-HGest compilado' $buildOk $detail $true

  if ($Dominio) {
    $iisOk = Test-IisInstalled
    $list += New-Requirement 'iis' 'IIS (servidor web)' $iisOk (Get-InstalledText $iisOk) $true
    $rewriteOk = Test-Path (Join-Path $env:windir 'system32\inetsrv\rewrite.dll')
    $list += New-Requirement 'iis-rewrite' 'IIS URL Rewrite' $rewriteOk (Get-InstalledText $rewriteOk) $true
    $arrOk = Test-Path (Join-Path $env:ProgramFiles 'IIS\Application Request Routing\requestRouter.dll')
    $list += New-Requirement 'iis-arr' 'IIS Application Request Routing' $arrOk (Get-InstalledText $arrOk) $true
    $proxyOk = [bool]($iisOk -and $rewriteOk -and $arrOk -and (Test-IisProxy))
    $detail = 'Por ativar'
    if ($proxyOk) { $detail = 'Ativo' }
    $list += New-Requirement 'iis-proxy' 'IIS configurado como proxy' $proxyOk $detail $true
  }
  return $list
}

function Save-Installer([string]$Url, [string]$FileName) {
  New-Item -ItemType Directory -Force $Instaladores | Out-Null
  $path = Join-Path $Instaladores $FileName
  Write-Ok "A transferir $Url"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $previous = $ProgressPreference
  $ProgressPreference = 'SilentlyContinue'
  try {
    Invoke-WebRequest -Uri $Url -OutFile $path -UseBasicParsing
  } finally {
    $ProgressPreference = $previous
  }
  return $path
}

function Assert-Sha256([string]$Path, [string]$Expected) {
  $actual = (Get-FileHash -Path $Path -Algorithm SHA256).Hash
  if ($actual -ne $Expected.ToUpperInvariant()) {
    Remove-Item $Path -Force
    throw "O ficheiro transferido nao corresponde ao publicado (SHA-256): $Path. Instalacao cancelada."
  }
  Write-Ok 'Ficheiro verificado (SHA-256)'
}

function Assert-MicrosoftSignature([string]$Path) {
  $signature = Get-AuthenticodeSignature -FilePath $Path
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
    Remove-Item $Path -Force
    throw "O instalador nao tem uma assinatura valida da Microsoft: $Path. Instalacao cancelada."
  }
  Write-Ok 'Assinatura da Microsoft verificada'
}

function Install-Msi([string]$Path, [string[]]$Properties = @()) {
  $log = "$Path.log"
  $arguments = @('/i', "`"$Path`"", '/qn', '/norestart', '/l*v', "`"$log`"") + $Properties
  $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList $arguments -Wait -PassThru
  if ($process.ExitCode -notin @(0, 3010)) { throw "A instalacao de $(Split-Path $Path -Leaf) falhou (codigo $($process.ExitCode)). Registo: $log" }
  if ($process.ExitCode -eq 3010) { Write-Note 'O Windows pede um reinicio para concluir esta instalacao.' }
}

function Get-NodeInstaller {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $releases = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
  $release = $releases | Where-Object { $_.version -like "v$NodeMajor.*" -and $_.lts } | Select-Object -First 1
  if (-not $release) { throw "Nao foi encontrada nenhuma versao LTS do Node $NodeMajor em nodejs.org." }
  $file = "node-$($release.version)-x64.msi"
  $sums = (Invoke-WebRequest -Uri "https://nodejs.org/dist/$($release.version)/SHASUMS256.txt" -UseBasicParsing).Content
  $line = ($sums -split "`n") | Where-Object { $_ -match "\s$([regex]::Escape($file))\s*$" } | Select-Object -First 1
  if (-not $line) { throw "Sem SHA-256 publicado para $file." }
  return [pscustomobject]@{ Version = $release.version; File = $file; Url = "https://nodejs.org/dist/$($release.version)/$file"; Sha256 = $line.Trim().Split(' ')[0] }
}

function Get-MariaDbInstaller {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $info = Invoke-RestMethod -Uri "https://downloads.mariadb.org/rest-api/mariadb/$MariaDbSerie/latest/" -UseBasicParsing
  $release = ($info.releases.PSObject.Properties | Select-Object -First 1).Value
  $msi = $release.files | Where-Object { $_.file_name -like '*-winx64.msi' } | Select-Object -First 1
  if (-not $msi -or -not $msi.checksum.sha256sum) { throw "Nao foi encontrado o instalador do MariaDB $MariaDbSerie para Windows." }
  return [pscustomobject]@{ Version = $release.release_id; File = $msi.file_name; Url = ($msi.file_download_url -replace '^http:', 'https:'); Sha256 = $msi.checksum.sha256sum }
}

function Install-NodeJs {
  Write-Step "Instalar Node.js $NodeMajor LTS"
  $installer = Get-NodeInstaller
  $path = Save-Installer $installer.Url $installer.File
  Assert-Sha256 $path $installer.Sha256
  Install-Msi $path
  Update-PathFromRegistry
  Write-Ok "Node $($installer.Version) instalado"
}

function Install-DbServer {
  $stopped = Get-StoppedDbService
  if ($stopped) {
    Write-Step "Arrancar o servico $($stopped.Name)"
    Set-Service -Name $stopped.Name -StartupType Automatic
    Start-Service -Name $stopped.Name
  } else {
    if (-not (Test-LocalDbHost)) { throw "O servidor de base de dados $DbHost e remoto: tem de ser ligado nesse servidor." }
    if ($DbAdminPassword.Length -lt 8) { throw 'Para instalar o MariaDB indique a password que o utilizador root vai ter (minimo 8 caracteres).' }
    Write-Step "Instalar MariaDB $MariaDbSerie LTS"
    $installer = Get-MariaDbInstaller
    $path = Save-Installer $installer.Url $installer.File
    Assert-Sha256 $path $installer.Sha256
    Install-Msi $path @('SERVICENAME=MariaDB', "PORT=$DbPort", "PASSWORD=`"$DbAdminPassword`"", 'UTF8=1')
    Update-PathFromRegistry
    Write-Ok "MariaDB $($installer.Version) instalado como servico MariaDB (utilizador root com a password indicada)"
  }
  $deadline = (Get-Date).AddSeconds(60)
  while (-not (Test-TcpPort $DbHost $DbPort) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
  if (-not (Test-TcpPort $DbHost $DbPort)) { throw "O servidor de base de dados continua sem responder em ${DbHost}:$DbPort." }
  Write-Ok 'Base de dados a responder'
}

function Install-DbTools([string[]]$Features, [string]$Name) {
  Write-Step "Instalar $Name (MariaDB $MariaDbSerie, sem servidor)"
  $installer = Get-MariaDbInstaller
  $path = Save-Installer $installer.Url $installer.File
  Assert-Sha256 $path $installer.Sha256
  Install-Msi $path @("ADDLOCAL=$($Features -join ',')")
  Update-PathFromRegistry
  Write-Ok "$Name instalado"
}

function Set-NoSleep {
  Write-Step 'Desligar a suspensao automatica (ligado a corrente)'
  & powercfg.exe /change standby-timeout-ac 0 | Out-Null
  & powercfg.exe /change hibernate-timeout-ac 0 | Out-Null
  Write-Ok 'O computador ja nao suspende quando esta ligado a corrente'
}

function Install-Build {
  $node = Assert-Node
  Invoke-Build $node -SemMigrar
}

function Install-Iis {
  Write-Step 'Instalar o IIS'
  if (Get-Command Install-WindowsFeature -ErrorAction SilentlyContinue) {
    Install-WindowsFeature -Name Web-Server, Web-Mgmt-Console | Out-Null
  } else {
    $features = @('IIS-WebServerRole', 'IIS-WebServer', 'IIS-CommonHttpFeatures', 'IIS-StaticContent', 'IIS-DefaultDocument', 'IIS-HttpErrors', 'IIS-HealthAndDiagnostics', 'IIS-HttpLogging', 'IIS-Security', 'IIS-RequestFiltering', 'IIS-Performance', 'IIS-HttpCompressionStatic', 'IIS-WebServerManagementTools', 'IIS-ManagementConsole')
    Enable-WindowsOptionalFeature -Online -FeatureName $features -All -NoRestart | Out-Null
  }
  Write-Ok 'IIS instalado'
}

function Install-IisModule([string]$Url, [string]$FileName, [string]$Name) {
  Write-Step "Instalar $Name"
  $path = Save-Installer $Url $FileName
  Assert-MicrosoftSignature $path
  Install-Msi $path
  Write-Ok "$Name instalado"
}

function Enable-IisProxy {
  Write-Step 'Ativar o proxy no IIS'
  & $AppCmd set config -section:system.webServer/proxy /enabled:"True" /commit:apphost | Out-Null
  $variables = (& $AppCmd list config -section:system.webServer/rewrite/allowedServerVariables) -join ' '
  if ($variables -notmatch 'HTTP_X_FORWARDED_PROTO') {
    & $AppCmd set config -section:system.webServer/rewrite/allowedServerVariables /+"[name='HTTP_X_FORWARDED_PROTO']" /commit:apphost | Out-Null
  }
  Write-Ok 'Proxy ativo'
}

function Install-Requirement([string]$Id) {
  switch ($Id) {
    'node' { Install-NodeJs }
    'energia' { Set-NoSleep }
    'db-servidor' { Install-DbServer }
    'db-cliente' { Install-DbTools @('Client', 'HeidiSQL') 'Ferramentas mysql, mysqldump e HeidiSQL' }
    'db-gestor' { Install-DbTools @('HeidiSQL') 'HeidiSQL' }
    'compilacao' { Install-Build }
    'iis' { Install-Iis }
    'iis-rewrite' { Install-IisModule $UrlRewriteMsi 'rewrite_amd64_en-US.msi' 'IIS URL Rewrite' }
    'iis-arr' { Install-IisModule $ArrMsi 'requestRouter_amd64.msi' 'IIS Application Request Routing' }
    'iis-proxy' { Enable-IisProxy }
  }
}

function Write-Requirements($List) {
  foreach ($item in $List) {
    if ($item.Ok) { Write-Host "    [OK]    $($item.Nome): $($item.Detalhe)" -ForegroundColor Green }
    else { Write-Host "    [FALTA] $($item.Nome): $($item.Detalhe)" -ForegroundColor Yellow }
  }
}

function Install-MissingRequirements([switch]$Dominio) {
  if (-not (Test-Administrator)) { throw 'Abre o PowerShell como Administrador para instalar os requisitos.' }
  foreach ($id in @('energia', 'node', 'db-servidor', 'db-cliente', 'db-gestor', 'compilacao', 'iis', 'iis-rewrite', 'iis-arr', 'iis-proxy')) {
    $item = Get-Requirements -Dominio:$Dominio | Where-Object { $_.Id -eq $id }
    if ($item -and -not $item.Ok -and $item.Instalavel) { Install-Requirement $id }
  }
  $final = @(Get-Requirements -Dominio:$Dominio)
  Write-Step 'Requisitos'
  Write-Requirements $final
  $missing = @($final | Where-Object { -not $_.Ok })
  if ($missing.Count) { throw "Continuam requisitos por cumprir: $(($missing | ForEach-Object { $_.Nome }) -join ', ')" }
}

if ($MyInvocation.InvocationName -eq '.') { return }

Write-Host 'MAVIE-HGest - requisitos de instalacao' -ForegroundColor White
if ($Instalar) {
  Install-MissingRequirements -Dominio:$ComDominio
  Write-Step 'Tudo pronto para criar hoteis'
} else {
  $list = @(Get-Requirements -Dominio:$ComDominio)
  Write-Step 'Requisitos'
  Write-Requirements $list
  if (@($list | Where-Object { -not $_.Ok }).Count) {
    Write-Note 'Para instalar o que falta: requisitos.ps1 -Instalar (com -ComDominio se o hotel tiver dominio)'
    exit 1
  }
}
