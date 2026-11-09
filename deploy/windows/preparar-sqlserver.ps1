[CmdletBinding()]
param(
  [switch]$SoVerificar
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'requisitos.ps1')

$Registo = Join-Path $Raiz 'sqlserver-config.log'

try {
  $instance = Find-PreferredSqlServerInstance
  if (-not $instance) {
    Write-Ok 'Sem SQL Server neste computador: nada a preparar.'
    exit 0
  }
  $SqlInstancia = $instance.Name
  $ready = [bool]($instance.TcpEnabled -and $instance.StaticPort -and $instance.Port -and $instance.MixedMode)
  $changes = @()
  if (-not $instance.Running) { $changes += 'arrancar o servico' }
  if (-not $instance.TcpEnabled) { $changes += 'ligar o TCP' }
  if (-not ($instance.StaticPort -and $instance.Port)) { $changes += 'fixar a porta TCP' }
  if (-not $instance.MixedMode) { $changes += 'ativar a autenticacao SQL' }
  if (-not $changes.Count) {
    Write-Ok "Instancia $($instance.Name) ja preparada (porta fixa $($instance.Port), autenticacao SQL)."
    exit 0
  }
  Write-Host "Instancia $($instance.Name): $($changes -join ', ')"
  if ($SoVerificar) { exit 0 }
  if (-not $instance.Running) { Start-SqlServerOrInstall }
  if (-not $ready) { Set-SqlServerConfig }
  Remove-Item -LiteralPath $Registo -Force -ErrorAction SilentlyContinue
  exit 0
} catch {
  [IO.File]::WriteAllText($Registo, "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $($_.Exception.Message)`r`n")
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}
