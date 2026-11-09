$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'comum.ps1')

$root = $Raiz.TrimEnd('\').ToLowerInvariant() + '\'
foreach ($item in @(Get-HotelInstances)) {
  Stop-Api $item.TaskName $item.EnvPath
  Get-NetFirewallRule -DisplayName $item.TaskName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  if ($item.Nome) { Remove-PanelShortcut $item.Nome }
  Remove-PanelShortcut $item.Codigo
}
foreach ($task in @(Get-ScheduledTask -ErrorAction SilentlyContinue)) {
  $arguments = (@($task.Actions) | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' '
  if ($arguments.ToLowerInvariant().Contains($root)) {
    Stop-ScheduledTask -InputObject $task -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -InputObject $task -Confirm:$false -ErrorAction SilentlyContinue
  }
}
foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'")) {
  if ($process.CommandLine -and $process.CommandLine.ToLowerInvariant().Contains($root)) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
}
$shortcuts = Join-Path $Raiz 'posto-atalhos.txt'
if (Test-Path $shortcuts) {
  foreach ($path in @([IO.File]::ReadAllLines($shortcuts) | Where-Object { $_ })) {
    Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  }
}
Write-Ok "Servicos do MAVIE-HGest em $Raiz parados e retirados. A pasta dados (bases, backups e chave AT) fica intacta."
