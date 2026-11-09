[CmdletBinding()]
param(
  [string]$Servidor = '',
  [string]$Porta = '3101',
  [switch]$SemImpressao
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'requisitos.ps1')

$Registo = Join-Path $Raiz 'posto.log'
$ListaAtalhos = Join-Path $Raiz 'posto-atalhos.txt'

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

try {
  $target = ($Servidor.Trim() -replace '^https?://', '').TrimEnd('/')
  $ports = @($Porta -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if ($target -match '^(.+):(\d+)$') {
    $target = $Matches[1]
    $ports = @($Matches[2])
  }
  if ($target -notmatch '^[A-Za-z0-9._-]+$') { throw "Indica o IP ou o nome do servidor (recebido: '$Servidor')." }
  if (-not $ports.Count) { throw 'Indica a porta do hotel.' }
  foreach ($port in $ports) {
    if ($port -notmatch '^\d+$' -or [int]$port -lt 1 -or [int]$port -gt 65535) { throw "Porta invalida: $port" }
  }
  if (-not (Test-Administrator)) { throw 'Abre o PowerShell como Administrador.' }

  $urls = @()
  foreach ($port in $ports) {
    $url = "http://${target}:$port"
    $urls += $url
    Write-Host "MAVIE-HGest - posto ligado a $url" -ForegroundColor White
    try {
      Invoke-WebRequest -Uri "$url/api/health" -UseBasicParsing -TimeoutSec 5 | Out-Null
      Write-Ok 'Servidor a responder'
    } catch {
      Write-Note "O servidor nao respondeu em $url. O posto fica configurado e funciona quando o servidor estiver acessivel."
    }
    $shortcut = New-PanelShortcut "$target ($port)" $url
    Add-LineOnce $ListaAtalhos $shortcut | Out-Null
    Write-Ok "Atalho do painel: $shortcut"
  }

  if (-not $SemImpressao) { Install-PrintAgent (Get-AgentNode) $urls }
  Remove-Item -LiteralPath $Registo -Force -ErrorAction SilentlyContinue
  Write-Step 'Posto pronto'
  exit 0
} catch {
  [IO.File]::WriteAllText($Registo, "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $($_.Exception.Message)`r`n")
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}
