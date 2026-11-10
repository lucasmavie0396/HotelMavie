[CmdletBinding()]
param(
  [switch]$SemInstaladores
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\requisitos.ps1')

function Find-Iscc {
  $candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
    (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe')
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  throw 'Inno Setup 6 nao encontrado. Instala-o de https://jrsoftware.org/isdl.php e volta a correr.'
}

function Get-InstallerCode {
  if ($env:MAVIE_INSTALLER_CODE) { return $env:MAVIE_INSTALLER_CODE.Trim() }
  $file = Join-Path $PSScriptRoot 'codigo-instalador.txt'
  if (Test-Path $file) {
    $code = (Get-Content -LiteralPath $file -Raw).Trim()
    if ($code) { return $code }
  }
  throw 'Falta o codigo do instalador: cria instalador\codigo-instalador.txt (fica fora do Git) ou define MAVIE_INSTALLER_CODE.'
}

function Copy-Folder([string]$From, [string]$To, [string[]]$Skip = @()) {
  New-Item -ItemType Directory -Force $To | Out-Null
  foreach ($item in Get-ChildItem -LiteralPath $From -Force) {
    if ($Skip -contains $item.Name) { continue }
    Copy-Item -LiteralPath $item.FullName -Destination $To -Recurse -Force
  }
}

Write-Host 'MAVIE-HGest - gerar o instalador' -ForegroundColor White
$iscc = Find-Iscc
$installerCode = Get-InstallerCode
$node = Assert-Node
$npm = Get-Npm $node
$obj = Join-Path $PSScriptRoot 'obj'
$stage = Join-Path $obj 'MAVIE-HGest'
$saida = Join-Path $PSScriptRoot 'saida'
if (Test-Path $obj) { Remove-Item -LiteralPath $obj -Recurse -Force }
New-Item -ItemType Directory -Force $stage, $saida | Out-Null

Write-Step 'Verificar os tipos (backend e painel)'
Invoke-Native $npm @('run', 'typecheck') $Backend
Invoke-Native $npm @('run', 'typecheck') $Frontend

Write-Step 'Compilar o backend'
Invoke-Native $npm @('exec', '--', 'tsc', '-p', 'tsconfig.build.json', '--outDir', (Join-Path $stage 'backend\dist')) $Backend
foreach ($file in @('package.json', 'package-lock.json', '.env.example')) {
  Copy-Item -LiteralPath (Join-Path $Backend $file) -Destination (Join-Path $stage 'backend')
}
Copy-Folder (Join-Path $Backend 'prisma') (Join-Path $stage 'backend\prisma')
New-Item -ItemType Directory -Force (Join-Path $stage 'backend\scripts') | Out-Null
Copy-Item -LiteralPath (Join-Path $Backend 'scripts\generate-at-key.mjs') -Destination (Join-Path $stage 'backend\scripts')

Write-Step 'Compilar o painel'
Invoke-Native $npm @('exec', '--', 'vite', 'build', '--outDir', (Join-Path $stage 'frontend\dist'), '--emptyOutDir') $Frontend

Write-Step 'Dependencias de producao do backend'
Invoke-Native $npm @('ci', '--omit=dev', '--no-audit', '--no-fund') (Join-Path $stage 'backend')
Invoke-Native $npm @('run', 'prisma:generate') (Join-Path $stage 'backend')
foreach ($link in @(Get-ChildItem (Join-Path $stage 'backend\node_modules') -Force -Directory | Where-Object { $_.Attributes -match 'ReparsePoint' })) {
  [IO.Directory]::Delete($link.FullName)
}

Write-Step 'Scripts de instalacao, agente de impressao e manual'
Copy-Folder (Split-Path $PSScriptRoot) (Join-Path $stage 'deploy\windows') @('instalador')
Copy-Folder (Join-Path $Raiz 'print-agent') (Join-Path $stage 'print-agent') @('node_modules')
Copy-Item -LiteralPath (Join-Path $Raiz 'README.md') -Destination $stage

if (-not $SemInstaladores) {
  Write-Step 'Instaladores incluidos (Node.js e MariaDB, verificados por SHA-256)'
  $bundle = Join-Path $stage 'instaladores'
  New-Item -ItemType Directory -Force $bundle | Out-Null
  foreach ($installer in @((Get-NodeInstaller), (Get-MariaDbInstaller))) {
    $path = Save-Installer $installer.Url $installer.File
    Assert-Sha256 $path $installer.Sha256
    Copy-Item -LiteralPath $path -Destination $bundle
    [IO.File]::WriteAllText((Join-Path $bundle "$($installer.File).sha256"), "$($installer.Sha256)  $($installer.File)`n")
    Write-Ok $installer.File
  }
}

Write-Step 'Gerar o ficheiro unico (Inno Setup)'
$version = (Get-Content (Join-Path $Backend 'package.json') -Raw | ConvertFrom-Json).version
$stamp = Get-Date -Format 'yyyyMMdd'
Invoke-Native $iscc @('/Q', "/DStage=$stage", "/DOutput=$saida", "/DAppVersion=$version", "/DBuildStamp=$stamp", "/DInstallerCode=$installerCode", (Join-Path $PSScriptRoot 'MAVIE-HGest.iss')) $PSScriptRoot
$exe = Get-ChildItem $saida -Filter "MAVIE-HGest-Setup-$version-$stamp.exe" | Select-Object -First 1
Write-Ok "Instalador: $($exe.FullName) ($([math]::Round($exe.Length / 1MB)) MB)"
