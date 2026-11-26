[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$raiz = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$projeto = Join-Path $PSScriptRoot 'MAVIE.GeradorLicencas'
$temp = Join-Path $PSScriptRoot 'publicar\_gerador'
$saida = Join-Path $PSScriptRoot 'publicar\MAVIE-Licencas.exe'

if (Test-Path $temp) { Remove-Item -Recurse -Force $temp }
New-Item -ItemType Directory -Force (Split-Path $saida) | Out-Null
dotnet publish $projeto -c Release -r win-x64 --self-contained true -o $temp --nologo `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -p:DebugType=None
if ($LASTEXITCODE -ne 0) { throw "dotnet publish falhou (codigo $LASTEXITCODE)." }
Copy-Item (Join-Path $temp 'MAVIE-Licencas.exe') $saida -Force
Remove-Item -Recurse -Force $temp

$texto = Get-Content (Join-Path $raiz 'backend\src\license\public-key.ts') -Raw
$embutida = ($texto -replace '(?s).*?(-----BEGIN PUBLIC KEY-----.*?-----END PUBLIC KEY-----).*', '$1') -replace '\s', ''
$ficheiro = [IO.Path]::GetTempFileName()
try {
    $p = Start-Process -FilePath $saida -ArgumentList @('--chave-publica', "`"$ficheiro`"") -Wait -PassThru
    if ($p.ExitCode -ne 0) {
        Write-Warning 'Este computador ainda nao tem a chave das licencas: abra o gerador e reponha a copia de seguranca.'
    } elseif (((Get-Content $ficheiro -Raw) -replace '\s', '') -ne $embutida) {
        Write-Warning 'A chave deste computador NAO e a do sistema: as licencas emitidas aqui nao seriam aceites.'
    } else {
        Write-Host 'Chave deste computador = chave publica do sistema.' -ForegroundColor Green
    }
} finally {
    Remove-Item $ficheiro -ErrorAction SilentlyContinue
}
$mb = [math]::Round((Get-Item $saida).Length / 1MB, 1)
Write-Host "Gerador pronto: $saida ($mb MB)" -ForegroundColor Green
