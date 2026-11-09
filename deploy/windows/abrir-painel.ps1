param(
  [Parameter(Mandatory = $true)]
  [string]$Url
)

function Find-Browser([string]$Exe, [string[]]$Folders) {
  foreach ($hive in @('HKLM:', 'HKCU:')) {
    $key = Get-ItemProperty "$hive\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$Exe" -ErrorAction SilentlyContinue
    if ($key -and $key.'(default)' -and (Test-Path $key.'(default)')) { return $key.'(default)' }
  }
  foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
    foreach ($folder in $Folders) {
      if ($base -and (Test-Path (Join-Path $base "$folder\$Exe"))) { return Join-Path $base "$folder\$Exe" }
    }
  }
  return $null
}

$browser = Find-Browser 'chrome.exe' @('Google\Chrome\Application')
if (-not $browser) { $browser = Find-Browser 'msedge.exe' @('Microsoft\Edge\Application') }
if ($browser) {
  $site = ($Url -replace '^https?://', '') -replace '[^A-Za-z0-9.-]', '_'
  $data = Join-Path $env:LOCALAPPDATA "MAVIE-HGest\navegador\$site"
  Start-Process -FilePath $browser -ArgumentList @("--app=$Url", '--start-fullscreen', "--user-data-dir=`"$data`"", '--no-first-run', '--no-default-browser-check')
} else {
  Start-Process $Url
}
