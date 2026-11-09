[CmdletBinding()]
param(
  [string]$Servidor = '',
  [int]$Porta = 3101,
  [switch]$SemImpressao
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'requisitos.ps1')

$Registo = Join-Path $Raiz 'posto.log'
$ListaAtalhos = Join-Path $Raiz 'posto-atalhos.txt'
$ListaOrigens = Join-Path $Raiz 'posto-origens.txt'
$TarefaAgente = 'MAVIE-HGest agente de impressao'

function Add-LineOnce([string]$Path, [string]$Line) {
  $lines = @()
  if (Test-Path $Path) { $lines = @([IO.File]::ReadAllLines($Path) | Where-Object { $_ }) }
  if ($lines -notcontains $Line) { $lines += $Line }
  [IO.File]::WriteAllLines($Path, [string[]]$lines)
  return $lines
}

function Get-AgentNode {
  $node = Find-Node
  $major = 0
  if ($node) { $major = [int]((& $node -v).Trim().TrimStart('v').Split('.')[0]) }
  if ($major -lt 18) {
    Install-NodeJs
    $node = Find-Node
  }
  if (-not $node) { throw 'Node.js nao ficou instalado.' }
  return $node
}

function Install-PrintAgent([string]$Origin) {
  Write-Step 'Agente de impressao'
  $node = Get-AgentNode
  $agent = Join-Path $Raiz 'print-agent\agent.mjs'
  foreach ($existing in @([string[]](([Environment]::GetEnvironmentVariable('PRINT_AGENT_ORIGINS', 'Machine') -split ',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }))) {
    Add-LineOnce $ListaOrigens $existing | Out-Null
  }
  $origins = (Add-LineOnce $ListaOrigens $Origin) -join ','
  Stop-ScheduledTask -TaskName $TarefaAgente -ErrorAction SilentlyContinue
  foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($agent.ToLowerInvariant()) })) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-NetTCPConnection -State Listen -LocalPort 9123 -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
  $safeNode = $node.Replace("'", "''")
  $safeAgent = $agent.Replace("'", "''")
  $command = "`$env:PRINT_AGENT_ORIGINS='$origins'; & '$safeNode' '$safeAgent'"
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command `"$command`"" -WorkingDirectory (Split-Path $agent)
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $principal = New-ScheduledTaskPrincipal -GroupId 'S-1-5-32-545' -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $TarefaAgente -Description 'MAVIE-HGest: agente de impressao deste posto' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  try {
    Start-ScheduledTask -TaskName $TarefaAgente
  } catch {
    Write-Note 'O agente de impressao arranca quando um utilizador entrar no Windows.'
  }
  Write-Ok "Agente autorizado para: $origins"
}

try {
  $target = ($Servidor.Trim() -replace '^https?://', '').TrimEnd('/')
  if ($target -match '^(.+):(\d+)$') {
    $target = $Matches[1]
    $Porta = [int]$Matches[2]
  }
  if ($target -notmatch '^[A-Za-z0-9._-]+$') { throw "Indica o IP ou o nome do servidor (recebido: '$Servidor')." }
  if ($Porta -lt 1 -or $Porta -gt 65535) { throw "Porta invalida: $Porta" }
  if (-not (Test-Administrator)) { throw 'Abre o PowerShell como Administrador.' }

  $url = "http://${target}:$Porta"
  Write-Host "MAVIE-HGest - posto ligado a $url" -ForegroundColor White
  try {
    Invoke-WebRequest -Uri "$url/api/health" -UseBasicParsing -TimeoutSec 5 | Out-Null
    Write-Ok 'Servidor a responder'
  } catch {
    Write-Note "O servidor nao respondeu em $url. O posto fica configurado e funciona quando o servidor estiver acessivel."
  }

  $shortcut = New-PanelShortcut "$target ($Porta)" $url
  Add-LineOnce $ListaAtalhos $shortcut | Out-Null
  Write-Ok "Atalho do painel: $shortcut"

  if (-not $SemImpressao) { Install-PrintAgent $url }
  Remove-Item -LiteralPath $Registo -Force -ErrorAction SilentlyContinue
  Write-Step 'Posto pronto'
  exit 0
} catch {
  [IO.File]::WriteAllText($Registo, "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $($_.Exception.Message)`r`n")
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}
