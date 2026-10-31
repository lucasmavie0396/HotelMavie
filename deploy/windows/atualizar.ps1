[CmdletBinding()]
param(
  [switch]$GitPull,
  [switch]$SemBackup
)

. (Join-Path $PSScriptRoot 'comum.ps1')

if ((Get-ApiTask) -and -not (Test-Administrator)) {
  throw 'Abre o PowerShell como Administrador para parar e arrancar o servico.'
}
if (@(Get-HotelInstances).Count -gt 0) { throw 'Este servidor tem hoteis em instancias separadas: atualiza com hoteis.ps1 -Acao atualizar.' }
if (-not (Test-Path $EnvFile)) { throw "Nao existe $EnvFile. Corre instalar.ps1 primeiro." }

Write-Host "MAVIE-HGest - atualizacao em $Raiz" -ForegroundColor White
Write-Step 'Verificar requisitos'
$node = Assert-Node
$envValues = Read-EnvFile
$Port = [int]$envValues['PORT']

if ($GitPull) {
  Write-Step 'Obter a nova versao (git pull)'
  Invoke-Native 'git' @('pull', '--ff-only') $Raiz
}

if (-not $SemBackup) {
  Write-Step 'Backup da base de dados antes de atualizar'
  Backup-Database $envValues 'antes-atualizacao' | Out-Null
}

Write-Step 'Parar o servico'
Stop-Api
Write-Ok 'Parado'

$failed = $null
try {
  Invoke-Build $node
} catch {
  $failed = $_
}

if (Get-ApiTask) {
  Write-Step 'Arrancar o servico'
  Start-Api
  if (Wait-Health $Port) { Write-Ok 'A correr' } else { Write-Note 'A API nao respondeu em 90 s: ve dados\logs\api.log' }
} else {
  Write-Note 'Sem tarefa de arranque automatico: arranca com deploy\windows\executar.cmd'
}

if ($failed) {
  Write-Host ''
  Write-Host "A atualizacao falhou: $($failed.Exception.Message)" -ForegroundColor Red
  Write-Host 'A base de dados so muda no passo "migrate deploy". Se for preciso voltar atras, restaura o backup acima com mysql < ficheiro.sql e repoe a versao anterior do codigo.'
  exit 1
}
Write-Step 'Atualizacao concluida'
