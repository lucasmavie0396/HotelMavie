[CmdletBinding()]
param(
  [switch]$Instalar,
  [switch]$ComDominio,
  [ValidateSet('MySQL', 'SQLServer')]
  [string]$BaseDados = 'MySQL',
  [string]$SqlInstancia = '',
  [string]$DbHost = 'localhost',
  [int]$DbPort = 3306,
  [string]$DbAdminUser = 'root',
  [string]$DbAdminPassword = ''
)

. (Join-Path $PSScriptRoot 'comum.ps1')

if (-not $DbAdminPassword -and $env:MAVIE_DB_ADMIN_PASSWORD) { $DbAdminPassword = $env:MAVIE_DB_ADMIN_PASSWORD }
if ($BaseDados -eq 'SQLServer') {
  if (-not $PSBoundParameters.ContainsKey('DbAdminUser') -or $DbAdminUser -eq 'root') { $DbAdminUser = '' }
  if (-not $PSBoundParameters.ContainsKey('DbPort') -or $DbPort -eq 3306) { $DbPort = 0 }
}
$SqlExpressUrl = 'https://go.microsoft.com/fwlink/?linkid=2215160'
$SqlInstanciaNova = 'MAVIE'
$SqlServerMajorMinimo = 11

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

function Get-SqlServerTarget {
  $instance = $null
  if (Test-LocalDbHost) { $instance = Get-SqlServerInstance $SqlInstancia }
  $port = $DbPort
  if (-not $port -and $instance) { $port = $instance.Port }
  return [pscustomobject]@{ Instance = $instance; Port = $port }
}

function Resolve-SqlServerPort {
  $target = Get-SqlServerTarget
  if (-not $target.Port) { throw 'Nao foi possivel saber a porta TCP do SQL Server: ativa o TCP na instancia ou indica -DbPort.' }
  return [int]$target.Port
}

function Test-SqlServerAdmin([int]$Port) {
  $node = Find-Node
  if (-not $node) { return [pscustomobject]@{ Ok = $false; Detail = 'Precisa do Node.js' } }
  try {
    $row = @(Invoke-SqlServer $node (New-SqlServerUrl $DbHost $Port 'master' $DbAdminUser $DbAdminPassword) "SELECT IS_SRVROLEMEMBER('sysadmin') AS sysadmin, CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(40)) AS version, CAST(SERVERPROPERTY('Edition') AS NVARCHAR(80)) AS edition" -Consulta)[0]
  } catch {
    return [pscustomobject]@{ Ok = $false; Detail = "$($_.Exception.Message)".Replace('SQL Server: ', '') }
  }
  $parts = "$row".Split("`t")
  $who = 'Windows (' + [Security.Principal.WindowsIdentity]::GetCurrent().Name + ')'
  if ($DbAdminUser) { $who = $DbAdminUser }
  if ([int]$parts[1].Split('.')[0] -lt $SqlServerMajorMinimo) { return [pscustomobject]@{ Ok = $false; Detail = "SQL Server $($parts[1]): precisa da versao 2012 ou superior" } }
  if ($parts[0] -ne '1') { return [pscustomobject]@{ Ok = $false; Detail = "$who entra mas nao e sysadmin" } }
  return [pscustomobject]@{ Ok = $true; Detail = "$who, SQL Server $($parts[1]) $($parts[2])" }
}

function Get-SqlServerRequirements {
  $list = @()
  $target = Get-SqlServerTarget
  $local = Test-LocalDbHost
  $instance = $target.Instance
  if ($local) {
    $ok = [bool]($instance -and $instance.Running)
    $detail = U 'Nenhuma inst\u00e2ncia neste computador (instala o SQL Server 2022 Express)'
    if ($instance -and -not $instance.Running) { $detail = (U 'Inst\u00e2ncia ') + "$($instance.Name)" + (U ': servi\u00e7o parado') }
    if ($ok) { $detail = (U 'Inst\u00e2ncia ') + "$($instance.Name) (" + (U 'servi\u00e7o ') + "$($instance.Service))" }
    $list += New-Requirement 'sql-instancia' 'SQL Server' $ok $detail $true

    $configOk = [bool]($ok -and $instance.TcpEnabled -and $instance.StaticPort -and $instance.Port -and $instance.MixedMode)
    $missing = @()
    if ($instance -and -not $instance.TcpEnabled) { $missing += 'TCP desligado' }
    if ($instance -and $instance.TcpEnabled -and -not $instance.StaticPort) { $missing += 'porta TCP din' + (U '\u00e2') + 'mica' }
    if ($instance -and -not $instance.MixedMode) { $missing += (U 's\u00f3 aceita contas Windows') }
    $detail = "TCP na porta $($target.Port), " + (U 'autentica\u00e7\u00e3o SQL ativa')
    if (-not $configOk) { $detail = 'Por configurar' }
    if ($missing.Count) { $detail = ($missing -join ', ') + (U ' (corrigir reinicia o servi\u00e7o do SQL Server)') }
    $list += New-Requirement 'sql-config' (U 'SQL Server com TCP fixo e autentica\u00e7\u00e3o SQL') $configOk $detail $true
  } else {
    $ok = [bool]($target.Port -and (Test-TcpPort $DbHost $target.Port))
    $detail = "A responder em ${DbHost}:$($target.Port)"
    if (-not $target.Port) { $detail = (U 'Indique a porta do SQL Server remoto') }
    elseif (-not $ok) { $detail = "Sem resposta de ${DbHost}:$($target.Port) (servidor remoto)" }
    $list += New-Requirement 'sql-instancia' 'SQL Server (remoto)' $ok $detail $false
  }
  return $list
}

function Get-SqlServerAdminRequirement {
  $target = Get-SqlServerTarget
  $ready = [bool]($target.Port -and (Test-TcpPort $DbHost $target.Port) -and (Test-Path (Join-Path $Backend 'node_modules\.prisma\client-sqlserver')))
  $result = [pscustomobject]@{ Ok = $false; Detail = 'Depende do SQL Server e da compila' + (U '\u00e7\u00e3o') }
  if ($ready -and $DbAdminUser -and -not $DbAdminPassword) {
    $result = [pscustomobject]@{ Ok = $false; Detail = "Escreva a password de $DbAdminUser" }
  } elseif ($ready) {
    $result = Test-SqlServerAdmin $target.Port
  }
  return New-Requirement 'sql-admin' (U 'Acesso de administrador ao SQL Server') $result.Ok $result.Detail $false
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

  if ($BaseDados -eq 'SQLServer') {
    $list += Get-SqlServerRequirements
  } else {
    $list += Get-MySqlRequirements
  }

  $buildOk = (Test-Path $MainJs) -and (Test-Path (Join-Path $Frontend 'dist\index.html')) -and (Test-Path (Join-Path $Backend 'node_modules\.prisma\client')) -and (Test-Path (Join-Path $Backend 'node_modules\.prisma\client-sqlserver'))
  $detail = 'Pronto'
  if (-not $buildOk) { $detail = U 'Falta instalar as depend\u00eancias e compilar' }
  $list += New-Requirement 'compilacao' 'MAVIE-HGest compilado' $buildOk $detail $true

  if ($BaseDados -eq 'SQLServer') { $list += Get-SqlServerAdminRequirement }

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

function Get-MySqlRequirements {
  $list = @()
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

function Resolve-Installer([string]$Pattern, [scriptblock]$Online) {
  $bundled = Get-ChildItem (Join-Path $Raiz 'instaladores') -Filter $Pattern -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
  if ($bundled -and (Test-Path "$($bundled.FullName).sha256")) {
    $sha = ((Get-Content "$($bundled.FullName).sha256" -Raw).Trim() -split '\s+')[0]
    Write-Ok "Instalador incluido no pacote: $($bundled.Name)"
    $installer = [pscustomobject]@{ Version = [regex]::Match($bundled.Name, '\d+\.\d+\.\d+').Value; Path = $bundled.FullName; Sha256 = $sha }
  } else {
    $online = & $Online
    $installer = [pscustomobject]@{ Version = $online.Version; Path = (Save-Installer $online.Url $online.File); Sha256 = $online.Sha256 }
  }
  Assert-Sha256 $installer.Path $installer.Sha256
  return $installer
}

function Install-NodeJs {
  Write-Step "Instalar Node.js $NodeMajor LTS"
  $installer = Resolve-Installer 'node-v*-x64.msi' { Get-NodeInstaller }
  Install-Msi $installer.Path
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
    $installer = Resolve-Installer 'mariadb-*-winx64.msi' { Get-MariaDbInstaller }
    Install-Msi $installer.Path @('SERVICENAME=MariaDB', "PORT=$DbPort", "PASSWORD=`"$DbAdminPassword`"", 'UTF8=1')
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
  $installer = Resolve-Installer 'mariadb-*-winx64.msi' { Get-MariaDbInstaller }
  Install-Msi $installer.Path @("ADDLOCAL=$($Features -join ',')")
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

function Get-FreeSqlPort {
  foreach ($candidate in @(1433) + (1434..1499)) {
    if (-not (Get-NetTCPConnection -State Listen -LocalPort $candidate -ErrorAction SilentlyContinue)) { return $candidate }
  }
  throw 'Nao ha portas livres entre 1433 e 1499 para o SQL Server.'
}

function Wait-SqlServerPort([int]$Port) {
  $deadline = (Get-Date).AddSeconds(90)
  while (-not (Test-TcpPort $DbHost $Port) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
  if (-not (Test-TcpPort $DbHost $Port)) { throw "O SQL Server continua sem responder na porta $Port." }
}

function Install-SqlServerExpress {
  if (-not (Test-LocalDbHost)) { throw "O SQL Server $DbHost e remoto: tem de ser instalado nesse servidor." }
  $name = $SqlInstancia
  if (-not $name -or $name -match '^(\.|localhost|\(local\))$') { $name = $SqlInstanciaNova }
  if ($name -match '\\(.+)$') { $name = $Matches[1] }
  Write-Step "Instalar SQL Server 2022 Express (instancia $name)"
  $bootstrap = Save-Installer $SqlExpressUrl 'SQL2022-SSEI-Expr.exe'
  Assert-MicrosoftSignature $bootstrap
  $media = Join-Path $Instaladores 'sqlexpress'
  New-Item -ItemType Directory -Force $media | Out-Null
  Write-Ok 'A transferir o pacote do SQL Server (pode demorar)'
  $process = Start-Process -FilePath $bootstrap -ArgumentList @('/ACTION=Download', "/MEDIAPATH=`"$media`"", '/MEDIATYPE=Core', '/QUIET') -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "A transferencia do SQL Server falhou (codigo $($process.ExitCode))." }
  $package = Get-ChildItem $media -Filter 'SQLEXPR*.exe' | Sort-Object Length -Descending | Select-Object -First 1
  if (-not $package) { throw "Pacote do SQL Server nao encontrado em $media." }
  Assert-MicrosoftSignature $package.FullName
  $extracted = Join-Path $media 'setup'
  $process = Start-Process -FilePath $package.FullName -ArgumentList @('/q', "/x:`"$extracted`"") -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Nao foi possivel extrair o SQL Server (codigo $($process.ExitCode))." }
  $setup = Join-Path $extracted 'SETUP.EXE'
  Assert-MicrosoftSignature $setup
  $saPassword = $DbAdminPassword
  if (-not $DbAdminUser -or $saPassword.Length -lt 8) { $saPassword = 'Sa-' + [Guid]::NewGuid().ToString('N') + 'X9' }
  $arguments = @(
    '/Q', '/ACTION=Install', '/FEATURES=SQLENGINE', "/INSTANCENAME=$name",
    "/SQLSVCACCOUNT=`"NT Service\MSSQL`$$name`"", '/SQLSYSADMINACCOUNTS="BUILTIN\Administrators"',
    '/SECURITYMODE=SQL', "/SAPWD=`"$saPassword`"", '/TCPENABLED=1', '/NPENABLED=0',
    '/UPDATEENABLED=0', '/IACCEPTSQLSERVERLICENSETERMS', '/SUPPRESSPRIVACYSTATEMENTNOTICE'
  )
  Write-Ok 'A instalar o SQL Server (pode demorar varios minutos)'
  $process = Start-Process -FilePath $setup -ArgumentList $arguments -Wait -PassThru
  if ($process.ExitCode -notin @(0, 3010)) { throw "A instalacao do SQL Server falhou (codigo $($process.ExitCode)). Registo: $env:ProgramFiles\Microsoft SQL Server\160\Setup Bootstrap\Log" }
  $script:SqlInstancia = $name
  Write-Ok "SQL Server Express instalado (instancia $name; administradores do Windows sao sysadmin)"
  Set-SqlServerConfig
}

function Set-SqlServerConfig {
  $instance = Get-SqlServerInstance $SqlInstancia
  if (-not $instance) { throw 'Instancia do SQL Server nao encontrada.' }
  Write-Step "Configurar a instancia $($instance.Name): TCP, porta fixa e autenticacao SQL"
  $port = $instance.Port
  if (-not $port) { $port = Get-FreeSqlPort }
  Set-ItemProperty "$($instance.Root)\SuperSocketNetLib\Tcp" -Name Enabled -Value 1
  Set-SqlServerStaticPort ([pscustomobject]@{ Root = $instance.Root; Port = $port })
  Set-ItemProperty $instance.Root -Name LoginMode -Value 2
  $dependents = @(Get-Service -Name $instance.Service -DependentServices | Where-Object { $_.Status -eq 'Running' })
  Restart-Service -Name $instance.Service -Force
  foreach ($dependent in $dependents) { Start-Service -Name $dependent.Name -ErrorAction SilentlyContinue }
  Wait-SqlServerPort $port
  Write-Ok "SQL Server a responder na porta fixa $port, com autenticacao SQL"
}

function Start-SqlServerOrInstall {
  $instance = Get-SqlServerInstance $SqlInstancia
  if (-not $instance) { Install-SqlServerExpress; return }
  Write-Step "Arrancar o SQL Server ($($instance.Service))"
  Set-Service -Name $instance.Service -StartupType Automatic
  Start-Service -Name $instance.Service
  Write-Ok 'SQL Server a correr'
}

function Install-Requirement([string]$Id) {
  switch ($Id) {
    'sql-instancia' { Start-SqlServerOrInstall }
    'sql-config' { Set-SqlServerConfig }
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
  foreach ($id in @('energia', 'node', 'db-servidor', 'db-cliente', 'db-gestor', 'sql-instancia', 'sql-config', 'compilacao', 'iis', 'iis-rewrite', 'iis-arr', 'iis-proxy')) {
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
    Write-Note 'Para instalar o que falta: requisitos.ps1 -Instalar (com -ComDominio se o hotel tiver dominio; com -BaseDados SQLServer para SQL Server)'
    exit 1
  }
}
