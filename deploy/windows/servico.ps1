[CmdletBinding()]
param(
  [ValidateSet('estado', 'iniciar', 'parar', 'reiniciar', 'logs', 'backup', 'remover')]
  [string]$Acao = 'estado',
  [int]$Linhas = 60
)

. (Join-Path $PSScriptRoot 'comum.ps1')

$envValues = Read-EnvFile
$Port = 3000
if ($envValues['PORT']) { $Port = [int]$envValues['PORT'] }
$logFile = $null
$task = Get-ApiTask
if ($task) {
  $argument = $task.Actions[0].Arguments
  if ($argument -match '"[^"]*executar\.cmd"\s+"([^"]+)"') { $logFile = Join-Path $Matches[1] 'api.log' }
}
if (-not $logFile) { $logFile = Join-Path $Raiz 'dados\logs\api.log' }

function Assert-Admin {
  if (-not (Test-Administrator)) { throw 'Abre o PowerShell como Administrador.' }
}

switch ($Acao) {
  'estado' {
    if ($task) { Write-Host "Tarefa ${NomeTarefa}: $($task.State)" } else { Write-Host "Tarefa ${NomeTarefa}: nao instalada" }
    $processes = @(Get-ApiProcess)
    Write-Host "Processos node da API: $($processes.Count)"
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 5
      Write-Host "Saude: $($health | ConvertTo-Json -Compress)" -ForegroundColor Green
    } catch {
      Write-Host "Saude: sem resposta em http://127.0.0.1:$Port/api/health" -ForegroundColor Red
    }
    Write-Host "Registo: $logFile"
  }
  'iniciar' {
    Assert-Admin
    Start-Api
    if (Wait-Health $Port) { Write-Ok 'A correr' } else { Write-Note "Sem resposta: ve $logFile" }
  }
  'parar' {
    Assert-Admin
    Stop-Api
    Write-Ok 'Parado'
  }
  'reiniciar' {
    Assert-Admin
    Stop-Api
    Start-Api
    if (Wait-Health $Port) { Write-Ok 'A correr' } else { Write-Note "Sem resposta: ve $logFile" }
  }
  'logs' {
    if (Test-Path $logFile) { Get-Content $logFile -Tail $Linhas } else { Write-Note "Ainda nao ha registo em $logFile" }
  }
  'backup' {
    Backup-Database $envValues 'manual' | Out-Null
  }
  'remover' {
    Assert-Admin
    Stop-Api
    if ($task) { Unregister-ScheduledTask -TaskName $NomeTarefa -Confirm:$false }
    Get-NetFirewallRule -DisplayName $NomeTarefa -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Write-Ok 'Arranque automatico e regra de firewall removidos. O codigo, o .env e a pasta de dados ficam intactos.'
  }
}
