$ErrorActionPreference = 'Stop'
$Hoteis = Join-Path $PSScriptRoot 'hoteis.ps1'
$DadosHoteis = (Join-Path $PSScriptRoot '..\..\dados\hoteis')

function U([string]$Text) {
  return [regex]::Unescape($Text)
}

function Get-HotelCode([string]$Name) {
  $plain = -join ($Name.Normalize([Text.NormalizationForm]::FormD).ToCharArray() | Where-Object { [Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne 'NonSpacingMark' })
  $code = ($plain.ToLowerInvariant() -replace '[^a-z0-9]', '')
  if ($code.Length -gt 20) { $code = $code.Substring(0, 20) }
  return $code
}

function Get-InstalledHotels {
  if (-not (Test-Path $DadosHoteis)) { return @() }
  $result = @()
  foreach ($dir in Get-ChildItem -Path $DadosHoteis -Directory | Sort-Object Name) {
    $envPath = Join-Path $dir.FullName 'hotel.env'
    if (-not (Test-Path $envPath)) { continue }
    $port = ''
    $url = ''
    foreach ($line in [IO.File]::ReadAllLines($envPath)) {
      if ($line -match '^PORT=(.*)$') { $port = $Matches[1].Trim() }
      if ($line -match '^CORS_ORIGIN=(.*)$') { $url = $Matches[1].Trim() }
    }
    $result += [pscustomobject]@{ Codigo = $dir.Name; Port = $port; Url = $url }
  }
  return $result
}

function Test-HotelInput([hashtable]$Data) {
  $errors = @()
  if (-not $Data.Nome.Trim()) { $errors += U 'Indique o nome do hotel.' }
  if ($Data.Nome.Contains('"')) { $errors += U 'O nome n\u00e3o pode ter aspas (").' }
  if ($Data.Codigo -notmatch '^[a-z0-9]{2,20}$') { $errors += U 'O c\u00f3digo s\u00f3 pode ter letras min\u00fasculas e n\u00fameros (2 a 20).' }
  elseif (@(Get-InstalledHotels | Where-Object { $_.Codigo -eq $Data.Codigo }).Count) { $errors += (U 'J\u00e1 existe um hotel com o c\u00f3digo ') + "'$($Data.Codigo)'." }
  if ($Data.Email -notmatch '^[^@\s"]+@[^@\s"]+\.[^@\s"]+$') { $errors += U 'Indique um email v\u00e1lido para o administrador.' }
  if ($Data.Password.Length -lt 8) { $errors += U 'A password do administrador tem de ter pelo menos 8 caracteres.' }
  elseif ($Data.Password -ne $Data.Confirmar) { $errors += U 'As passwords n\u00e3o coincidem.' }
  if ($Data.Dominio -and $Data.Dominio -notmatch '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$') { $errors += U 'O dom\u00ednio n\u00e3o \u00e9 v\u00e1lido (exemplo: reservas.hotelmar.pt, sem https://).' }
  if (-not $Data.DbUser.Trim()) { $errors += U 'Indique o utilizador administrador do MySQL.' }
  return $errors
}

function New-HotelArguments([hashtable]$Data) {
  $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$Hoteis`" -Acao novo -Codigo $($Data.Codigo) -Nome `"$($Data.Nome.Trim())`" -AdminEmail `"$($Data.Email.Trim())`" -DbAdminUser `"$($Data.DbUser.Trim())`""
  if ($Data.Dominio) { $arguments += " -Dominio $($Data.Dominio)" }
  if ($Data.Firewall -and -not $Data.Dominio) { $arguments += ' -AbrirFirewall' }
  return $arguments
}

function Start-HotelCreation([hashtable]$Data, [string]$LogFile, [string]$ErrFile) {
  $env:MAVIE_ADMIN_PASSWORD = $Data.Password
  $env:MAVIE_DB_ADMIN_PASSWORD = $Data.DbPassword
  $env:PRISMA_HIDE_UPDATE_MESSAGE = '1'
  try {
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList (New-HotelArguments $Data) -WindowStyle Hidden -PassThru -RedirectStandardOutput $LogFile -RedirectStandardError $ErrFile
    $null = $process.Handle
    return $process
  } finally {
    Remove-Item Env:\MAVIE_ADMIN_PASSWORD, Env:\MAVIE_DB_ADMIN_PASSWORD, Env:\PRISMA_HIDE_UPDATE_MESSAGE -ErrorAction SilentlyContinue
  }
}

function Read-NewText([string]$Path, [ref]$Position) {
  if (-not (Test-Path $Path)) { return '' }
  $stream = [IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
  try {
    if ($stream.Length -le $Position.Value) { return '' }
    [void]$stream.Seek($Position.Value, 'Begin')
    $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8)
    $text = $reader.ReadToEnd()
    $Position.Value = $stream.Length
    return $text
  } finally {
    $stream.Dispose()
  }
}

if ($MyInvocation.InvocationName -eq '.') { return }

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal $identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File `"$PSCommandPath`""
  return
}

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()

$font = New-Object Drawing.Font('Segoe UI', 10)
$form = New-Object Windows.Forms.Form
$form.Text = U 'MAVIE-HGest - Novo hotel'
$form.ClientSize = New-Object Drawing.Size(700, 760)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.Font = $font

function Add-Control($Control, [int]$X, [int]$Y, [int]$W, [int]$H) {
  $Control.Location = New-Object Drawing.Point($X, $Y)
  $Control.Size = New-Object Drawing.Size($W, $H)
  $form.Controls.Add($Control)
  return $Control
}

function Add-Label([string]$Text, [int]$X, [int]$Y, [int]$W = 200, [string]$Color = '') {
  $label = New-Object Windows.Forms.Label
  $label.Text = U $Text
  if ($Color) { $label.ForeColor = [Drawing.Color]::FromName($Color) }
  return Add-Control $label $X $Y $W 22
}

function Add-TextBox([int]$Y, [switch]$Password) {
  $box = New-Object Windows.Forms.TextBox
  if ($Password) { $box.UseSystemPasswordChar = $true }
  return Add-Control $box 230 $Y 440 26
}

$title = Add-Label 'Criar um hotel novo com a sua pr\u00f3pria base de dados' 20 16 660
$title.Font = New-Object Drawing.Font('Segoe UI', 13, [Drawing.FontStyle]::Bold)
$title.Height = 30
$installed = Add-Label '' 20 50 660 'DimGray'

Add-Label 'Nome do hotel' 20 88 | Out-Null
$name = Add-TextBox 85
Add-Label 'C\u00f3digo' 20 124 | Out-Null
$code = Add-TextBox 121
Add-Label 'Letras min\u00fasculas e n\u00fameros. D\u00e1 nome \u00e0 base de dados e \u00e0 pasta.' 230 149 440 'DimGray' | Out-Null
Add-Label 'Email do administrador' 20 180 | Out-Null
$email = Add-TextBox 177
Add-Label 'Password do administrador' 20 216 | Out-Null
$password = Add-TextBox 213 -Password
Add-Label 'Confirmar password' 20 252 | Out-Null
$confirm = Add-TextBox 249 -Password
Add-Label 'Dom\u00ednio (opcional)' 20 288 | Out-Null
$domain = Add-TextBox 285
Add-Label 'Ex.: reservas.hotelmar.pt. Vazio = s\u00f3 na rede local.' 230 313 440 'DimGray' | Out-Null
$firewall = New-Object Windows.Forms.CheckBox
$firewall.Text = U 'Abrir a porta na firewall para os postos da rede local'
$firewall.Checked = $true
Add-Control $firewall 230 340 440 24 | Out-Null

$group = New-Object Windows.Forms.GroupBox
$group.Text = U 'Servidor MySQL / MariaDB (conta usada s\u00f3 para criar a base de dados)'
Add-Control $group 20 374 650 70 | Out-Null
$dbUserLabel = New-Object Windows.Forms.Label
$dbUserLabel.Text = 'Utilizador'
$dbUserLabel.Location = New-Object Drawing.Point(14, 32)
$dbUserLabel.Size = New-Object Drawing.Size(80, 22)
$dbUser = New-Object Windows.Forms.TextBox
$dbUser.Text = 'root'
$dbUser.Location = New-Object Drawing.Point(96, 29)
$dbUser.Size = New-Object Drawing.Size(180, 26)
$dbPassLabel = New-Object Windows.Forms.Label
$dbPassLabel.Text = 'Password'
$dbPassLabel.Location = New-Object Drawing.Point(300, 32)
$dbPassLabel.Size = New-Object Drawing.Size(76, 22)
$dbPass = New-Object Windows.Forms.TextBox
$dbPass.UseSystemPasswordChar = $true
$dbPass.Location = New-Object Drawing.Point(380, 29)
$dbPass.Size = New-Object Drawing.Size(250, 26)
$group.Controls.AddRange(@($dbUserLabel, $dbUser, $dbPassLabel, $dbPass))

$create = New-Object Windows.Forms.Button
$create.Text = 'Criar hotel'
$create.Font = New-Object Drawing.Font('Segoe UI', 10, [Drawing.FontStyle]::Bold)
Add-Control $create 20 456 160 36 | Out-Null
$open = New-Object Windows.Forms.Button
$open.Text = 'Abrir o painel'
$open.Enabled = $false
Add-Control $open 192 456 160 36 | Out-Null
$status = Add-Label '' 366 463 304

$log = New-Object Windows.Forms.TextBox
$log.Multiline = $true
$log.ReadOnly = $true
$log.ScrollBars = 'Vertical'
$log.BackColor = [Drawing.Color]::FromArgb(1, 36, 86)
$log.ForeColor = [Drawing.Color]::WhiteSmoke
$log.Font = New-Object Drawing.Font('Consolas', 9)
Add-Control $log 20 504 650 236 | Out-Null

function Update-Installed {
  $items = @(Get-InstalledHotels)
  if ($items.Count) {
    $installed.Text = (U 'Hot\u00e9is instalados: ') + (($items | ForEach-Object { "$($_.Codigo) ($($_.Port))" }) -join ', ')
  } else {
    $installed.Text = U 'Ainda n\u00e3o h\u00e1 hot\u00e9is instalados neste servidor.'
  }
}
Update-Installed

$script:codeEdited = $false
$name.Add_TextChanged({ if (-not $script:codeEdited) { $code.Text = Get-HotelCode $name.Text } })
$code.Add_KeyPress({ $script:codeEdited = $true })
$domain.Add_TextChanged({ $firewall.Enabled = -not $domain.Text.Trim() })

$script:process = $null
$script:logPos = 0
$script:errPos = 0
$script:logFile = Join-Path $env:TEMP 'mavie-novo-hotel.log'
$script:errFile = Join-Path $env:TEMP 'mavie-novo-hotel.err'
$script:panelUrl = $null

function Add-Log([string]$Text) {
  if (-not $Text) { return }
  $log.AppendText(($Text -replace "`r?`n", "`r`n"))
}

$timer = New-Object Windows.Forms.Timer
$timer.Interval = 500
$timer.Add_Tick({
  $pos = $script:logPos
  Add-Log (Read-NewText $script:logFile ([ref]$pos))
  $script:logPos = $pos
  if (-not $script:process.HasExited) { return }
  $timer.Stop()
  $pos = $script:logPos
  Add-Log (Read-NewText $script:logFile ([ref]$pos))
  $err = $script:errPos
  $errors = Read-NewText $script:errFile ([ref]$err)
  $created = Get-InstalledHotels | Where-Object { $_.Codigo -eq $script:creating }
  if ($script:process.ExitCode -eq 0 -and $created) {
    $status.ForeColor = [Drawing.Color]::DarkGreen
    $status.Text = U 'Hotel criado e a funcionar.'
    $script:panelUrl = "http://127.0.0.1:$($created.Port)"
    $open.Enabled = $true
    $name.Text = ''
    $email.Text = ''
    $password.Text = ''
    $confirm.Text = ''
    $domain.Text = ''
    $script:codeEdited = $false
  } else {
    Add-Log "`r`n$errors"
    $status.ForeColor = [Drawing.Color]::Firebrick
    $status.Text = U 'Falhou. Veja as mensagens abaixo.'
  }
  Update-Installed
  $create.Enabled = $true
})

$create.Add_Click({
  $data = @{
    Nome = $name.Text
    Codigo = $code.Text.Trim()
    Email = $email.Text
    Password = $password.Text
    Confirmar = $confirm.Text
    Dominio = $domain.Text.Trim().ToLowerInvariant()
    Firewall = $firewall.Checked
    DbUser = $dbUser.Text
    DbPassword = $dbPass.Text
  }
  $errors = @(Test-HotelInput $data)
  if ($errors.Count) {
    [Windows.Forms.MessageBox]::Show(($errors -join "`r`n"), (U 'Verifique os dados'), 'OK', 'Warning') | Out-Null
    return
  }
  $question = "Criar o hotel '$($data.Nome.Trim())' com o " + (U 'c\u00f3digo') + " '$($data.Codigo)'?"
  if ([Windows.Forms.MessageBox]::Show($question, 'MAVIE-HGest', 'YesNo', 'Question') -ne 'Yes') { return }
  $create.Enabled = $false
  $open.Enabled = $false
  $status.ForeColor = [Drawing.Color]::Black
  $status.Text = U 'A criar... pode demorar alguns minutos.'
  $log.Clear()
  Remove-Item $script:logFile, $script:errFile -ErrorAction SilentlyContinue
  $script:logPos = 0
  $script:errPos = 0
  $script:creating = $data.Codigo
  $script:process = Start-HotelCreation $data $script:logFile $script:errFile
  $timer.Start()
})

$open.Add_Click({ if ($script:panelUrl) { Start-Process $script:panelUrl } })

$form.Add_FormClosing({
  param($sender, $e)
  if ($script:process -and -not $script:process.HasExited) {
    [Windows.Forms.MessageBox]::Show((U 'Aguarde que a cria\u00e7\u00e3o do hotel termine.'), 'MAVIE-HGest', 'OK', 'Information') | Out-Null
    $e.Cancel = $true
  }
})

[void]$form.ShowDialog()
