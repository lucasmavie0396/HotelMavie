$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'requisitos.ps1')

function Get-SqlInstanceNames {
  $names = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL' -ErrorAction SilentlyContinue
  if (-not $names) { return @() }
  return @($names.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object { $_.Name })
}

function Resolve-UpdateTarget([string]$Text) {
  $value = $Text.Trim()
  if ($value -match '^(.+):(\d+)$') {
    return [pscustomobject]@{ Host = $Matches[1]; Port = [int]$Matches[2]; Instance = $null }
  }
  $instance = Get-SqlServerInstance $value
  if (-not $instance) { throw (U 'Inst\u00e2ncia n\u00e3o encontrada neste computador. Para outro servidor escreva servidor:porta.') }
  if (-not $instance.Running) { throw (U 'O servi\u00e7o ') + $instance.Service + (U ' est\u00e1 parado.') }
  if (-not $instance.Port) { throw (U 'A inst\u00e2ncia n\u00e3o tem o TCP ligado.') }
  return [pscustomobject]@{ Host = 'localhost'; Port = $instance.Port; Instance = $instance }
}

function Get-RunnableNode {
  if (-not (Find-Node)) { Install-NodeJs }
  return Get-NodePath
}

function Get-SystemDatabases($Target, [string]$User, [string]$Password) {
  $node = Get-RunnableNode
  $url = New-SqlServerUrl $Target.Host $Target.Port 'master' $User $Password
  $names = @(Invoke-SqlServer $node $url "SELECT name FROM sys.databases WHERE database_id > 4 AND state = 0 AND HAS_DBACCESS(name) = 1" -Consulta | Where-Object { $_ })
  if (-not $names.Count) { return @() }
  $parts = foreach ($name in $names) {
    $literal = $name.Replace("'", "''")
    $bracket = $name.Replace(']', ']]')
    "SELECT N'$literal' AS name, (SELECT COUNT(*) FROM [$bracket].sys.tables WHERE name IN (N'hotels', N'reservations', N'_prisma_migrations')) AS total"
  }
  $rows = Invoke-SqlServer $node $url ($parts -join ' UNION ALL ') -Consulta
  return @($rows | Where-Object { $_.Split("`t")[1] -eq '3' } | ForEach-Object { $_.Split("`t")[0] })
}

function Get-PendingMigrations($Target, [string]$User, [string]$Password, [string]$Database) {
  $url = New-SqlServerUrl $Target.Host $Target.Port $Database $User $Password
  $applied = @(Invoke-SqlServer (Get-RunnableNode) $url 'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL' -Consulta)
  $available = @(Get-ChildItem (Join-Path $Backend 'prisma\sqlserver\migrations') -Directory | ForEach-Object { $_.Name })
  return @($available | Where-Object { $applied -notcontains $_ })
}

function Update-SystemDatabase($Target, [string]$User, [string]$Password, [string]$Database) {
  if ($Database -notmatch '^[A-Za-z0-9_]+$') { throw "Nome de base de dados invalido: $Database" }
  $node = Get-RunnableNode
  $url = New-SqlServerUrl $Target.Host $Target.Port $Database $User $Password
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  if ($Target.Instance) {
    $dir = Join-Path $Raiz 'dados\backups-atualizacao'
    New-Item -ItemType Directory -Force $dir | Out-Null
    Grant-SqlServerFolder $Target.Instance $dir | Out-Null
  } else {
    $dir = (@(Invoke-SqlServer $node $url "SELECT CAST(SERVERPROPERTY('InstanceDefaultBackupPath') AS NVARCHAR(400)) AS caminho" -Consulta)[0]).TrimEnd('\')
  }
  $file = "$dir\$Database-antes-atualizacao-$stamp.bak"
  Invoke-SqlServer $node $url "BACKUP DATABASE [$Database] TO DISK = N'$($file.Replace("'", "''"))' WITH COPY_ONLY, INIT, CHECKSUM" | Out-Null
  $hotels = @(Get-HotelInstances | Where-Object { (Test-SqlServerUrl $_.Env['DATABASE_URL']) -and (Get-SqlServerDatabase $_.Env['DATABASE_URL']) -eq $Database })
  foreach ($hotel in $hotels) { Stop-Api $hotel.TaskName $hotel.EnvPath }
  try {
    Invoke-Migrate $node $url | Out-Null
  } finally {
    foreach ($hotel in $hotels) { if (Get-ApiTask $hotel.TaskName) { Start-Api $hotel.TaskName } }
  }
  return $file
}

if ($MyInvocation.InvocationName -eq '.') { return }

if (-not (Test-Administrator)) {
  Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File `"$PSCommandPath`""
  return
}

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object Windows.Forms.Form
$form.Text = 'MAVIE-HGest - Atualizar base de dados'
$form.ClientSize = New-Object Drawing.Size(640, 372)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.Font = New-Object Drawing.Font('Segoe UI', 10)
$formIcon = Join-Path $PSScriptRoot 'lam-company.ico'
if (Test-Path $formIcon) { $form.Icon = New-Object Drawing.Icon($formIcon) }

function Add-Field($Control, [int]$X, [int]$Y, [int]$W, [int]$H) {
  $Control.Location = New-Object Drawing.Point($X, $Y)
  $Control.Size = New-Object Drawing.Size($W, $H)
  $form.Controls.Add($Control)
  return $Control
}

function Add-Text([string]$Text, [int]$X, [int]$Y, [int]$W) {
  $label = New-Object Windows.Forms.Label
  $label.Text = U $Text
  return Add-Field $label $X $Y $W 22
}

$title = Add-Text 'Atualizar uma base de dados SQL Server' 20 16 600
$title.Font = New-Object Drawing.Font('Segoe UI', 13, [Drawing.FontStyle]::Bold)
$title.Height = 30
Add-Text 'Inst\u00e2ncia' 20 66 130 | Out-Null
$instance = New-Object Windows.Forms.ComboBox
foreach ($item in Get-SqlInstanceNames) { [void]$instance.Items.Add($item) }
$preferred = Find-PreferredSqlServerInstance
if ($preferred) { $instance.Text = $preferred.Name }
Add-Field $instance 160 63 460 26 | Out-Null
Add-Text 'Utilizador' 20 104 130 | Out-Null
$user = New-Object Windows.Forms.TextBox
$user.Text = 'sa'
Add-Field $user 160 101 200 26 | Out-Null
Add-Text 'Password' 20 142 130 | Out-Null
$password = New-Object Windows.Forms.TextBox
$password.UseSystemPasswordChar = $true
Add-Field $password 160 139 200 26 | Out-Null
$hint = Add-Text 'Utilizador vazio = conta do Windows.' 370 104 250
$hint.ForeColor = [Drawing.Color]::DimGray
$list = New-Object Windows.Forms.Button
$list.Text = 'Listar bases'
Add-Field $list 370 137 130 30 | Out-Null
Add-Text 'Base de dados' 20 184 130 | Out-Null
$database = New-Object Windows.Forms.ComboBox
$database.DropDownStyle = 'DropDownList'
Add-Field $database 160 181 460 26 | Out-Null
$pending = Add-Text '' 160 214 460
$update = New-Object Windows.Forms.Button
$update.Text = 'Atualizar'
$update.Enabled = $false
$update.Font = New-Object Drawing.Font('Segoe UI', 10, [Drawing.FontStyle]::Bold)
Add-Field $update 160 246 140 36 | Out-Null
$status = Add-Text '' 20 296 600
$status.Height = 60

function Show-Status([bool]$Ok, [string]$Text) {
  $status.ForeColor = if ($Ok) { [Drawing.Color]::DarkGreen } else { [Drawing.Color]::Firebrick }
  $status.Text = $Text
}

function Invoke-Safely([scriptblock]$Action) {
  $form.Cursor = 'WaitCursor'
  $list.Enabled = $false
  $update.Enabled = $false
  [Windows.Forms.Application]::DoEvents()
  try {
    & $Action
  } catch {
    $message = "$($_.Exception.Message)".Replace('SQL Server: ', '')
    if ($message -match 'Authentication failed|credentials') { $message = U 'Utilizador ou password errados.' }
    Show-Status $false $message
  } finally {
    $form.Cursor = 'Default'
    $list.Enabled = $true
    $update.Enabled = [bool]$database.SelectedItem
  }
}

$list.Add_Click({
  Invoke-Safely {
    $database.Items.Clear()
    $pending.Text = ''
    $status.Text = ''
    $target = Resolve-UpdateTarget $instance.Text
    $found = @(Get-SystemDatabases $target $user.Text.Trim() $password.Text)
    foreach ($name in $found) { [void]$database.Items.Add($name) }
    if ($found.Count) {
      $database.SelectedIndex = 0
      Show-Status $true ("$($found.Count) " + (U 'base(s) do MAVIE-HGest nesta inst\u00e2ncia.'))
    } else {
      Show-Status $false (U 'N\u00e3o h\u00e1 bases do MAVIE-HGest nesta inst\u00e2ncia.')
    }
  }
})

$database.Add_SelectedIndexChanged({
  if (-not $database.SelectedItem) { return }
  Invoke-Safely {
    $target = Resolve-UpdateTarget $instance.Text
    $missing = @(Get-PendingMigrations $target $user.Text.Trim() $password.Text "$($database.SelectedItem)")
    $pending.ForeColor = [Drawing.Color]::DimGray
    $pending.Text = if ($missing.Count) { "$($missing.Count) " + (U 'atualiza\u00e7\u00e3o(\u00f5es) por aplicar.') } else { U 'J\u00e1 est\u00e1 na vers\u00e3o mais recente.' }
  }
})

$update.Add_Click({
  $name = "$($database.SelectedItem)"
  $question = (U 'Vai ser feito um backup e a seguir atualizada a base ') + $name + (U '. Os hot\u00e9is que a usam param durante a atualiza\u00e7\u00e3o. Continuar?')
  if ([Windows.Forms.MessageBox]::Show($question, 'MAVIE-HGest', 'YesNo', 'Question') -ne 'Yes') { return }
  Invoke-Safely {
    Show-Status $true (U 'A fazer o backup e a atualizar... pode demorar alguns minutos.')
    [Windows.Forms.Application]::DoEvents()
    $target = Resolve-UpdateTarget $instance.Text
    $file = Update-SystemDatabase $target $user.Text.Trim() $password.Text $name
    $pending.Text = U 'J\u00e1 est\u00e1 na vers\u00e3o mais recente.'
    Show-Status $true ((U 'Base atualizada. Backup: ') + $file)
  }
})

[void]$form.ShowDialog()
