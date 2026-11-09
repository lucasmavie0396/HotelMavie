$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'requisitos.ps1')
$Hoteis = Join-Path $PSScriptRoot 'hoteis.ps1'
$Requisitos = Join-Path $PSScriptRoot 'requisitos.ps1'

function Get-HotelCode([string]$Name) {
  $plain = -join ($Name.Normalize([Text.NormalizationForm]::FormD).ToCharArray() | Where-Object { [Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne 'NonSpacingMark' })
  $code = ($plain.ToLowerInvariant() -replace '[^a-z0-9]', '')
  if ($code.Length -gt 20) { $code = $code.Substring(0, 20) }
  return $code
}

function Test-HotelInput([hashtable]$Data) {
  $errors = @()
  if (-not $Data.Nome.Trim()) { $errors += U 'Indique o nome do hotel.' }
  if ($Data.Nome.Contains('"')) { $errors += U 'O nome n\u00e3o pode ter aspas (").' }
  if ($Data.Codigo -notmatch '^[a-z0-9]{2,20}$') { $errors += U 'O c\u00f3digo s\u00f3 pode ter letras min\u00fasculas e n\u00fameros (2 a 20).' }
  elseif (@(Get-HotelInstances | Where-Object { $_.Codigo -eq $Data.Codigo }).Count) { $errors += (U 'J\u00e1 existe um hotel com o c\u00f3digo ') + "'$($Data.Codigo)'." }
  if ($Data.Email -notmatch '^[^@\s"]+@[^@\s"]+\.[^@\s"]+$') { $errors += U 'Indique um email v\u00e1lido para o administrador.' }
  if ($Data.Password.Length -lt 8) { $errors += U 'A password do administrador tem de ter pelo menos 8 caracteres.' }
  elseif ($Data.Password -ne $Data.Confirmar) { $errors += U 'As passwords n\u00e3o coincidem.' }
  if ($Data.Dominio -and $Data.Dominio -notmatch '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$') { $errors += U 'O dom\u00ednio n\u00e3o \u00e9 v\u00e1lido (exemplo: reservas.hotelmar.pt, sem https://).' }
  if ($Data.BaseDados -ne 'SQLServer' -and -not $Data.DbUser.Trim()) { $errors += U 'Indique o utilizador administrador do MySQL.' }
  if ($Data.SqlInstancia -match '["\s]') { $errors += U 'O nome da inst\u00e2ncia n\u00e3o pode ter espa\u00e7os nem aspas.' }
  return $errors
}

function New-HotelArguments([hashtable]$Data) {
  $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$Hoteis`" -Acao novo -Codigo $($Data.Codigo) -Nome `"$($Data.Nome.Trim())`" -AdminEmail `"$($Data.Email.Trim())`" -BaseDados $($Data.BaseDados) -DbAdminUser `"$($Data.DbUser.Trim())`""
  if ($Data.SqlInstancia) { $arguments += " -SqlInstancia $($Data.SqlInstancia)" }
  if ($Data.Dominio) { $arguments += " -Dominio $($Data.Dominio)" }
  if ($Data.Firewall -and -not $Data.Dominio) { $arguments += ' -AbrirFirewall' }
  return $arguments
}

function New-RequirementsArguments([string]$User, [bool]$WithDomain, [string]$Kind = 'MySQL', [string]$Instance = '') {
  $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$Requisitos`" -Instalar -BaseDados $Kind -DbAdminUser `"$($User.Trim())`""
  if ($Instance) { $arguments += " -SqlInstancia $Instance" }
  if ($WithDomain) { $arguments += ' -ComDominio' }
  return $arguments
}

function Start-Child([string]$Arguments, [hashtable]$Secrets, [string]$LogFile, [string]$ErrFile) {
  $names = @($Secrets.Keys) + @('PRISMA_HIDE_UPDATE_MESSAGE')
  foreach ($key in $Secrets.Keys) { Set-Item "Env:\$key" $Secrets[$key] }
  $env:PRISMA_HIDE_UPDATE_MESSAGE = '1'
  try {
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $Arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput $LogFile -RedirectStandardError $ErrFile
    $null = $process.Handle
    return $process
  } finally {
    foreach ($key in $names) { Remove-Item "Env:\$key" -ErrorAction SilentlyContinue }
  }
}

function Start-HotelCreation([hashtable]$Data, [string]$LogFile, [string]$ErrFile) {
  return Start-Child (New-HotelArguments $Data) @{ MAVIE_ADMIN_PASSWORD = $Data.Password; MAVIE_DB_ADMIN_PASSWORD = $Data.DbPassword } $LogFile $ErrFile
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

if (-not (Test-Administrator)) {
  Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File `"$PSCommandPath`""
  return
}

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()

$font = New-Object Drawing.Font('Segoe UI', 10)
$form = New-Object Windows.Forms.Form
$form.Text = 'MAVIE-HGest - Novo hotel'
$form.ClientSize = New-Object Drawing.Size(1120, 668)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.Font = $font
$tips = New-Object Windows.Forms.ToolTip
$formIcon = Join-Path $PSScriptRoot 'lam-company.ico'
if (Test-Path $formIcon) { $form.Icon = New-Object Drawing.Icon($formIcon) }

function Add-Control($Control, [int]$X, [int]$Y, [int]$W, [int]$H, $Parent = $form) {
  $Control.Location = New-Object Drawing.Point($X, $Y)
  $Control.Size = New-Object Drawing.Size($W, $H)
  $Parent.Controls.Add($Control)
  return $Control
}

function Add-Label([string]$Text, [int]$X, [int]$Y, [int]$W = 200, [string]$Color = '', $Parent = $form) {
  $label = New-Object Windows.Forms.Label
  $label.Text = U $Text
  if ($Color) { $label.ForeColor = [Drawing.Color]::FromName($Color) }
  return Add-Control $label $X $Y $W 22 $Parent
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
$group.Text = U 'Base de dados (conta de administrador)'
Add-Control $group 20 374 650 160 | Out-Null
Add-Label 'Tipo' 14 32 80 '' $group | Out-Null
$dbKind = New-Object Windows.Forms.ComboBox
$dbKind.DropDownStyle = 'DropDownList'
[void]$dbKind.Items.Add('MySQL / MariaDB')
[void]$dbKind.Items.Add('SQL Server')
$dbKind.SelectedIndex = 0
Add-Control $dbKind 96 29 180 26 $group | Out-Null
$instanceLabel = Add-Label 'Inst\u00e2ncia' 300 32 76 '' $group
$sqlInstance = New-Object Windows.Forms.TextBox
Add-Control $sqlInstance 380 29 250 26 $group | Out-Null
Add-Label 'Utilizador' 14 66 80 '' $group | Out-Null
$dbUser = New-Object Windows.Forms.TextBox
$dbUser.Text = 'root'
Add-Control $dbUser 96 63 180 26 $group | Out-Null
Add-Label 'Password' 300 66 76 '' $group | Out-Null
$dbPass = New-Object Windows.Forms.TextBox
$dbPass.UseSystemPasswordChar = $true
Add-Control $dbPass 380 63 250 26 $group | Out-Null
$dbHint = Add-Label '' 14 96 630 'DimGray' $group
$testDb = New-Object Windows.Forms.Button
$testDb.Text = U 'Testar liga\u00e7\u00e3o'
Add-Control $testDb 14 122 130 30 $group | Out-Null
$showExample = New-Object Windows.Forms.Button
$showExample.Text = 'Ver exemplo'
Add-Control $showExample 152 122 110 30 $group | Out-Null
$testResult = Add-Label '' 272 127 370 '' $group
$testResult.AutoEllipsis = $true

function Test-SqlServerChoice { return $dbKind.SelectedIndex -eq 1 }

function Show-TestResult([bool]$Ok, [string]$Text) {
  $testResult.ForeColor = if ($Ok) { [Drawing.Color]::DarkGreen } else { [Drawing.Color]::Firebrick }
  $testResult.Text = $Text
  $tips.SetToolTip($testResult, $Text)
}

function Get-SqlServerProblem($Target) {
  if (-not $Target.Instance -and (Test-LocalDbHost)) { return U 'Inst\u00e2ncia n\u00e3o encontrada neste computador.' }
  if ($Target.Instance -and -not $Target.Instance.Running) { return (U 'O servi\u00e7o ') + $Target.Instance.Service + (U ' est\u00e1 parado.') }
  if (-not $Target.Port) { return U 'A inst\u00e2ncia n\u00e3o tem o TCP ligado. Use Instalar o que falta.' }
  if (-not (Test-TcpPort $DbHost $Target.Port)) { return (U 'O SQL Server n\u00e3o responde na porta ') + "$($Target.Port)." }
  if ($dbUser.Text.Trim() -and -not $dbPass.Text) { return "Escreva a password de $($dbUser.Text.Trim())." }
  return ''
}

function Test-SqlServerConnection {
  $form.Cursor = 'WaitCursor'
  try {
    $script:DbAdminUser = $dbUser.Text.Trim()
    $script:DbAdminPassword = $dbPass.Text
    $script:BaseDados = 'SQLServer'
    $script:SqlInstancia = $sqlInstance.Text.Trim()
    $script:DbPort = 0
    $target = Get-SqlServerTarget
    $problem = Get-SqlServerProblem $target
    if ($problem) {
      Show-TestResult $false $problem
      return
    }
    $result = Test-SqlServerAdmin $target.Port
    if ($result.Ok) {
      Show-TestResult $true ((U 'Liga\u00e7\u00e3o OK: ') + $result.Detail)
    } elseif ($result.Detail -match 'Authentication failed|credentials') {
      Show-TestResult $false (U 'Utilizador ou password errados.')
    } else {
      Show-TestResult $false $result.Detail
    }
  } finally {
    $form.Cursor = 'Default'
  }
}

function Update-DatabaseChoice {
  $sql = Test-SqlServerChoice
  $instanceLabel.Enabled = $sql
  $sqlInstance.Enabled = $sql
  $testDb.Visible = $sql
  $showExample.Visible = $sql
  $testResult.Text = ''
  if ($sql) {
    if ($dbUser.Text.Trim() -in @('', 'root')) { $dbUser.Text = 'sa' }
    $found = Find-PreferredSqlServerInstance
    if ($found -and -not $sqlInstance.Text.Trim()) { $sqlInstance.Text = $found.Name }
    if ($found) {
      $dbHint.Text = U 'Escreva a password do sa. Para usar a conta do Windows, deixe o utilizador vazio.'
    } else {
      $dbHint.Text = U 'Sem SQL Server neste PC: a password escrita fica a ser a do sa (8+ caracteres, mai\u00fasculas, min\u00fasculas e n\u00fameros).'
    }
  } else {
    if ($dbUser.Text.Trim() -in @('', 'sa')) { $dbUser.Text = 'root' }
    $dbHint.Text = U 'Vazio se o root n\u00e3o tiver password (ex.: XAMPP). Se o MariaDB for instalado, fica a ser a do root.'
  }
}
if (Find-PreferredSqlServerInstance) { $dbKind.SelectedIndex = 1 }
Update-DatabaseChoice

$reqGroup = New-Object Windows.Forms.GroupBox
$reqGroup.Text = U 'Requisitos do computador (obrigat\u00f3rios)'
Add-Control $reqGroup 690 16 410 384 | Out-Null
$reqList = New-Object Windows.Forms.ListView
$reqList.View = 'Details'
$reqList.FullRowSelect = $true
$reqList.HeaderStyle = 'Nonclickable'
[void]$reqList.Columns.Add('Requisito', 200)
[void]$reqList.Columns.Add('Estado', 64)
[void]$reqList.Columns.Add('Detalhe', 300)
$reqList.ShowItemToolTips = $true
Add-Control $reqList 12 24 386 278 $reqGroup | Out-Null
$check = New-Object Windows.Forms.Button
$check.Text = 'Verificar de novo'
Add-Control $check 12 310 150 32 $reqGroup | Out-Null
$install = New-Object Windows.Forms.Button
$install.Text = U 'Instalar o que falta'
$install.Enabled = $false
Add-Control $install 172 310 170 32 $reqGroup | Out-Null
$reqStatus = Add-Label '' 12 350 386 '' $reqGroup

$create = New-Object Windows.Forms.Button
$create.Text = 'Criar hotel'
$create.Font = New-Object Drawing.Font('Segoe UI', 10, [Drawing.FontStyle]::Bold)
$create.Enabled = $false
Add-Control $create 20 548 160 36 | Out-Null
$open = New-Object Windows.Forms.Button
$open.Text = 'Abrir o painel'
$open.Enabled = $false
Add-Control $open 192 548 160 36 | Out-Null
$status = Add-Label '' 20 594 650

$log = New-Object Windows.Forms.TextBox
$log.Multiline = $true
$log.ReadOnly = $true
$log.ScrollBars = 'Vertical'
$log.BackColor = [Drawing.Color]::FromArgb(1, 36, 86)
$log.ForeColor = [Drawing.Color]::WhiteSmoke
$log.Font = New-Object Drawing.Font('Consolas', 9)
Add-Control $log 690 412 410 240 | Out-Null

function Update-Installed {
  $items = @(Get-HotelInstances)
  if ($items.Count) {
    $installed.Text = (U 'Hot\u00e9is instalados: ') + (($items | ForEach-Object { "$($_.Codigo) ($($_.Port))" }) -join ', ')
  } else {
    $installed.Text = U 'Ainda n\u00e3o h\u00e1 hot\u00e9is instalados neste computador.'
  }
}

$script:reqOk = $false
$script:busy = $false

function Update-Requirements {
  $form.Cursor = 'WaitCursor'
  try {
    $script:DbAdminUser = $dbUser.Text.Trim()
    $script:DbAdminPassword = $dbPass.Text
    if (Test-SqlServerChoice) {
      $script:BaseDados = 'SQLServer'
      $script:SqlInstancia = $sqlInstance.Text.Trim()
      $script:DbPort = 0
    } else {
      $script:BaseDados = 'MySQL'
      $script:SqlInstancia = ''
      $script:DbPort = 3306
    }
    $script:reqItems = @(Get-Requirements -Dominio:([bool]$domain.Text.Trim()))
  } finally {
    $form.Cursor = 'Default'
  }
  $reqList.Items.Clear()
  foreach ($item in $script:reqItems) {
    $row = New-Object Windows.Forms.ListViewItem($item.Nome)
    if ($item.Ok) {
      [void]$row.SubItems.Add('OK')
      $row.ForeColor = [Drawing.Color]::DarkGreen
    } else {
      [void]$row.SubItems.Add('Em falta')
      $row.ForeColor = [Drawing.Color]::Firebrick
    }
    [void]$row.SubItems.Add($item.Detalhe)
    $row.ToolTipText = "$($item.Nome): $($item.Detalhe)"
    [void]$reqList.Items.Add($row)
  }
  $missing = @($script:reqItems | Where-Object { -not $_.Ok })
  $script:reqOk = $missing.Count -eq 0
  $install.Enabled = -not $script:busy -and @($missing | Where-Object { $_.Instalavel }).Count -gt 0
  $create.Enabled = -not $script:busy -and $script:reqOk
  if ($script:reqOk) {
    $reqStatus.ForeColor = [Drawing.Color]::DarkGreen
    $reqStatus.Text = 'Tudo pronto.'
  } elseif (@($missing | Where-Object { $_.Id -eq 'sistema' }).Count) {
    $reqStatus.ForeColor = [Drawing.Color]::Firebrick
    $reqStatus.Text = U 'Esta vers\u00e3o do Windows n\u00e3o \u00e9 suportada.'
  } elseif (@($missing | Where-Object { -not $_.Instalavel }).Count) {
    $reqStatus.ForeColor = [Drawing.Color]::Firebrick
    $reqStatus.Text = U 'Corrija os dados da base de dados e verifique de novo.'
  } else {
    $reqStatus.ForeColor = [Drawing.Color]::Firebrick
    $reqStatus.Text = U 'Instale o que falta para continuar.'
  }
}

$script:codeEdited = $false
$name.Add_TextChanged({ if (-not $script:codeEdited) { $code.Text = Get-HotelCode $name.Text } })
$code.Add_KeyPress({ $script:codeEdited = $true })
$domain.Add_TextChanged({ $firewall.Enabled = -not $domain.Text.Trim() })
$domain.Add_Leave({ if (-not $script:busy) { Update-Requirements } })
$dbUser.Add_Leave({ if (-not $script:busy) { Update-Requirements } })
$dbPass.Add_Leave({ if (-not $script:busy) { Update-Requirements } })
$sqlInstance.Add_Leave({ if (-not $script:busy) { Update-Requirements } })
$dbKind.Add_SelectedIndexChanged({
  $dbPass.Text = ''
  Update-DatabaseChoice
  if (-not $script:busy) { Update-Requirements }
})
$check.Add_Click({ Update-Requirements })
$testDb.Add_Click({
  Test-SqlServerConnection
  if (-not $script:busy) { Update-Requirements }
})
$showExample.Add_Click({
  $example = Join-Path $PSScriptRoot 'exemplo-novo-hotel-sqlserver.png'
  if (Test-Path $example) { Start-Process $example }
})

$script:process = $null
$script:mode = ''
$script:logPos = 0
$script:logFile = Join-Path $env:TEMP 'mavie-novo-hotel.log'
$script:errFile = Join-Path $env:TEMP 'mavie-novo-hotel.err'
$script:panelUrl = $null

function Add-Log([string]$Text) {
  if (-not $Text) { return }
  $log.AppendText(($Text -replace "`r?`n", "`r`n"))
}

function Set-Busy([bool]$Busy, [string]$Text) {
  $script:busy = $Busy
  foreach ($control in @($create, $install, $check, $open, $testDb)) { $control.Enabled = -not $Busy }
  $status.ForeColor = [Drawing.Color]::Black
  $status.Text = $Text
}

function Start-Work([string]$Mode, [string]$Arguments, [hashtable]$Secrets, [string]$Text) {
  Set-Busy $true $Text
  $log.Clear()
  Remove-Item $script:logFile, $script:errFile -ErrorAction SilentlyContinue
  $script:logPos = 0
  $script:mode = $Mode
  $script:process = Start-Child $Arguments $Secrets $script:logFile $script:errFile
  $timer.Start()
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
  $err = 0
  $errors = Read-NewText $script:errFile ([ref]$err)
  $ok = $script:process.ExitCode -eq 0
  Set-Busy $false ''
  $open.Enabled = [bool]$script:panelUrl
  if ($script:mode -eq 'create') {
    $created = Get-HotelInstances | Where-Object { $_.Codigo -eq $script:creating }
    $ok = $ok -and $created
    if ($ok) {
      $script:panelUrl = "http://127.0.0.1:$($created.Port)"
      $open.Enabled = $true
      foreach ($box in @($name, $email, $password, $confirm, $domain)) { $box.Text = '' }
      $script:codeEdited = $false
    }
  }
  if (-not $ok) { Add-Log "`r`n$errors" }
  if ($ok) {
    $status.ForeColor = [Drawing.Color]::DarkGreen
    if ($script:mode -eq 'create') { $status.Text = U 'Hotel criado e a funcionar. Atalho do painel no ambiente de trabalho.' } else { $status.Text = U 'Requisitos instalados.' }
  } else {
    $status.ForeColor = [Drawing.Color]::Firebrick
    $status.Text = U 'Falhou. Veja as mensagens abaixo.'
  }
  Update-Installed
  Update-Requirements
})

$install.Add_Click({
  Update-Requirements
  $missing = @($script:reqItems | Where-Object { -not $_.Ok -and $_.Instalavel })
  if (-not $missing.Count) { return }
  $server = $missing | Where-Object { $_.Id -eq 'db-servidor' }
  if (-not (Test-SqlServerChoice) -and $server -and -not (Get-StoppedDbService) -and $dbPass.Text.Length -lt 8) {
    [Windows.Forms.MessageBox]::Show((U 'Vai ser instalado o MariaDB. Escreva primeiro, no campo Password do MySQL, a password que o utilizador root vai ter (m\u00ednimo 8 caracteres) e guarde-a num local seguro.'), 'MAVIE-HGest', 'OK', 'Warning') | Out-Null
    return
  }
  $newSqlServer = (Test-SqlServerChoice) -and @($missing | Where-Object { $_.Id -eq 'sql-instancia' }).Count -and -not (Get-SqlServerInstance $sqlInstance.Text.Trim())
  if ($newSqlServer -and $dbUser.Text.Trim() -and $dbPass.Text -cnotmatch '^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$') {
    [Windows.Forms.MessageBox]::Show((U 'Vai ser instalado o SQL Server. Escreva primeiro, no campo Password, a password que o sa vai ter (m\u00ednimo 8 caracteres, com mai\u00fasculas, min\u00fasculas e n\u00fameros) e guarde-a num local seguro.'), 'MAVIE-HGest', 'OK', 'Warning') | Out-Null
    return
  }
  $question = (U 'Vai ser transferido e instalado:') + "`r`n`r`n- " + (($missing | ForEach-Object { $_.Nome }) -join "`r`n- ") + "`r`n`r`n" + (U 'Continuar?')
  if ([Windows.Forms.MessageBox]::Show($question, 'MAVIE-HGest', 'YesNo', 'Question') -ne 'Yes') { return }
  Start-Work 'install' (New-RequirementsArguments $dbUser.Text ([bool]$domain.Text.Trim()) $script:BaseDados $sqlInstance.Text.Trim()) @{ MAVIE_DB_ADMIN_PASSWORD = $dbPass.Text } (U 'A instalar... pode demorar v\u00e1rios minutos.')
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
    BaseDados = $(if (Test-SqlServerChoice) { 'SQLServer' } else { 'MySQL' })
    SqlInstancia = $(if (Test-SqlServerChoice) { $sqlInstance.Text.Trim() } else { '' })
  }
  $errors = @(Test-HotelInput $data)
  if ($errors.Count) {
    [Windows.Forms.MessageBox]::Show(($errors -join "`r`n"), (U 'Verifique os dados'), 'OK', 'Warning') | Out-Null
    return
  }
  Update-Requirements
  if (-not $script:reqOk) {
    [Windows.Forms.MessageBox]::Show((U 'H\u00e1 requisitos em falta. Instale-os primeiro com o bot\u00e3o "Instalar o que falta".'), 'MAVIE-HGest', 'OK', 'Warning') | Out-Null
    return
  }
  $question = "Criar o hotel '$($data.Nome.Trim())' com o " + (U 'c\u00f3digo') + " '$($data.Codigo)'?"
  if ([Windows.Forms.MessageBox]::Show($question, 'MAVIE-HGest', 'YesNo', 'Question') -ne 'Yes') { return }
  $script:creating = $data.Codigo
  $script:panelUrl = $null
  Start-Work 'create' (New-HotelArguments $data) @{ MAVIE_ADMIN_PASSWORD = $data.Password; MAVIE_DB_ADMIN_PASSWORD = $data.DbPassword } (U 'A criar... pode demorar alguns minutos.')
})

$open.Add_Click({
  if ($script:panelUrl) {
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'abrir-painel.ps1')`" -Url `"$($script:panelUrl)`""
  }
})

$form.Add_Shown({
  Update-Installed
  Update-Requirements
})

$form.Add_FormClosing({
  param($sender, $e)
  if ($script:process -and -not $script:process.HasExited) {
    [Windows.Forms.MessageBox]::Show((U 'Aguarde que a opera\u00e7\u00e3o em curso termine.'), 'MAVIE-HGest', 'OK', 'Information') | Out-Null
    $e.Cancel = $true
  }
})

[void]$form.ShowDialog()
