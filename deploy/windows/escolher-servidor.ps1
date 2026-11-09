[CmdletBinding()]
param(
  [string]$Saida = ''
)

$ErrorActionPreference = 'Stop'

function U([string]$Text) { return [regex]::Unescape($Text) }

function Get-LocalNetworks {
  return @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
    $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixLength -ge 16
  } | ForEach-Object { $_.IPAddress.Substring(0, $_.IPAddress.LastIndexOf('.')) } | Select-Object -Unique)
}

function Find-BrowserInstances([string[]]$Networks) {
  $udp = New-Object Net.Sockets.UdpClient(0)
  $udp.EnableBroadcast = $true
  try {
    foreach ($destination in @('255.255.255.255') + @($Networks | ForEach-Object { "$_.255" })) {
      try { [void]$udp.Send([byte[]]@(2), 1, $destination, 1434) } catch { continue }
    }
    $deadline = (Get-Date).AddSeconds(3)
    while ((Get-Date) -lt $deadline) {
      if (-not $udp.Available) {
        Start-Sleep -Milliseconds 60
        [Windows.Forms.Application]::DoEvents()
        continue
      }
      $remote = New-Object Net.IPEndPoint([Net.IPAddress]::Any, 0)
      $data = $udp.Receive([ref]$remote)
      if ($data.Length -lt 4 -or $data[0] -ne 5) { continue }
      foreach ($block in ([Text.Encoding]::ASCII.GetString($data, 3, $data.Length - 3) -split ';;')) {
        $parts = $block.Trim(';') -split ';'
        $values = @{}
        for ($index = 0; $index + 1 -lt $parts.Count; $index += 2) { $values[$parts[$index]] = $parts[$index + 1] }
        if (-not $values['InstanceName'] -or -not $values['tcp']) { continue }
        [pscustomobject]@{
          Ip = $remote.Address.ToString()
          Server = $values['ServerName']
          Instance = $values['InstanceName']
          Version = $values['Version']
          Port = [int]$values['tcp']
        }
      }
    }
  } finally {
    $udp.Close()
  }
}

function Find-DefaultPortHosts([string[]]$Networks) {
  $attempts = @()
  foreach ($network in $Networks) {
    foreach ($last in 1..254) {
      $client = New-Object Net.Sockets.TcpClient
      $attempts += [pscustomobject]@{ Ip = "$network.$last"; Client = $client; Task = $client.ConnectAsync("$network.$last", 1433) }
    }
  }
  $deadline = (Get-Date).AddMilliseconds(1500)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 60
    [Windows.Forms.Application]::DoEvents()
  }
  foreach ($attempt in $attempts) {
    if ($attempt.Task.Status -eq 'RanToCompletion') { $attempt.Ip }
    $attempt.Client.Close()
  }
}

function Read-Rows($Connection, [string]$Sql) {
  $command = $Connection.CreateCommand()
  $command.CommandText = $Sql
  $command.CommandTimeout = 20
  $reader = $command.ExecuteReader()
  try {
    while ($reader.Read()) {
      $row = New-Object object[] $reader.FieldCount
      [void]$reader.GetValues($row)
      , $row
    }
  } finally {
    $reader.Close()
  }
}

function Get-SystemHotels($Connection) {
  $names = @(Read-Rows $Connection 'SELECT name FROM sys.databases WHERE database_id > 4 AND state = 0 AND HAS_DBACCESS(name) = 1' | ForEach-Object { "$($_[0])" })
  foreach ($name in $names) {
    $bracket = $name.Replace(']', ']]')
    $tables = @(Read-Rows $Connection "SELECT COUNT(*) FROM [$bracket].sys.tables WHERE name IN (N'hotels', N'reservations', N'_prisma_migrations')")
    if ("$($tables[0][0])" -ne '3') { continue }
    $info = @(Read-Rows $Connection "SELECT (SELECT TOP 1 name FROM [$bracket].dbo.hotels ORDER BY name), (SELECT CAST(value AS NVARCHAR(20)) FROM [$bracket].sys.extended_properties WHERE class = 0 AND name = N'MAVIE_PORT')")
    [pscustomobject]@{ Database = $name; Hotel = "$($info[0][0])"; Port = "$($info[0][1])" }
  }
}

function Test-HotelPort([string]$Address, [string]$Port) {
  $request = [Net.WebRequest]::Create("http://${Address}:$Port/api/health")
  $request.Proxy = $null
  $request.Timeout = 4000
  try {
    $response = $request.GetResponse()
    $ok = [int]$response.StatusCode -eq 200
    $response.Close()
    return $ok
  } catch {
    return $false
  }
}

if ($MyInvocation.InvocationName -eq '.') { return }

Add-Type -AssemblyName System.Windows.Forms, System.Drawing, System.Data
[Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object Windows.Forms.Form
$form.Text = 'MAVIE-HGest - Ligar este posto a um servidor'
$form.ClientSize = New-Object Drawing.Size(760, 500)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.TopMost = $true
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

function Add-Button([string]$Text, [int]$X, [int]$Y, [int]$W) {
  $button = New-Object Windows.Forms.Button
  $button.Text = U $Text
  return Add-Field $button $X $Y $W 32
}

$title = Add-Text 'Ligar este posto a um servidor' 20 14 700
$title.Font = New-Object Drawing.Font('Segoe UI', 13, [Drawing.FontStyle]::Bold)
$title.Height = 30
Add-Text 'Servidor e inst\u00e2ncia' 20 58 150 | Out-Null
$server = New-Object Windows.Forms.ComboBox
Add-Field $server 175 55 450 26 | Out-Null
$search = Add-Button 'Procurar' 635 52 105
Add-Text 'Utilizador' 20 96 150 | Out-Null
$user = New-Object Windows.Forms.TextBox
$user.Text = 'sa'
Add-Field $user 175 93 170 26 | Out-Null
Add-Text 'Password' 360 96 75 | Out-Null
$password = New-Object Windows.Forms.TextBox
$password.UseSystemPasswordChar = $true
Add-Field $password 440 93 185 26 | Out-Null
$connect = Add-Button 'Ligar' 635 90 105
Add-Text 'Escolha os hot\u00e9is deste posto' 20 134 700 | Out-Null

$grid = New-Object Windows.Forms.DataGridView
$grid.AllowUserToAddRows = $false
$grid.AllowUserToDeleteRows = $false
$grid.AllowUserToResizeRows = $false
$grid.RowHeadersVisible = $false
$grid.SelectionMode = 'CellSelect'
$grid.BackgroundColor = [Drawing.Color]::White
$useColumn = New-Object Windows.Forms.DataGridViewCheckBoxColumn
$useColumn.HeaderText = 'Ligar'
$useColumn.Width = 50
[void]$grid.Columns.Add($useColumn)
foreach ($column in @(@('Hotel', 220, $true), @('Base de dados', 190, $true), @('Porta', 70, $false), @('Teste', 175, $true))) {
  $textColumn = New-Object Windows.Forms.DataGridViewTextBoxColumn
  $textColumn.HeaderText = $column[0]
  $textColumn.Width = $column[1]
  $textColumn.ReadOnly = $column[2]
  $textColumn.SortMode = 'NotSortable'
  [void]$grid.Columns.Add($textColumn)
}
Add-Field $grid 20 158 720 190 | Out-Null

$status = Add-Text '' 20 358 720
$status.Height = 66
$test = Add-Button 'Testar liga\u00e7\u00e3o' 20 440 150
$test.Enabled = $false
$install = Add-Button 'Instalar posto e agente' 180 440 210
$install.Enabled = $false
$install.Font = New-Object Drawing.Font('Segoe UI', 10, [Drawing.FontStyle]::Bold)
$cancel = Add-Button 'Indicar o IP \u00e0 m\u00e3o' 590 440 150
$cancel.DialogResult = 'Cancel'
$form.CancelButton = $cancel
$form.AcceptButton = $connect

$script:entries = @{}
$script:lastKey = ''
$script:connected = $null

function Show-Status([bool]$Ok, [string]$Text) {
  $status.ForeColor = if ($Ok) { [Drawing.Color]::DarkGreen } else { [Drawing.Color]::Firebrick }
  $status.Text = $Text
}

function Get-FormKey { return "$($server.Text.Trim())|$($user.Text.Trim())|$($password.Text)" }

function Reset-Tests {
  $install.Enabled = $false
  foreach ($row in $grid.Rows) { $row.Cells[4].Value = '' }
}

function Invoke-Safely([scriptblock]$Action) {
  $form.Cursor = 'WaitCursor'
  foreach ($control in @($search, $connect, $test)) { $control.Enabled = $false }
  [Windows.Forms.Application]::DoEvents()
  try {
    & $Action
  } catch {
    $message = "$($_.Exception.Message)"
    if ($_.Exception.InnerException) { $message = "$($_.Exception.InnerException.Message)" }
    if ($message -match 'Login failed') { $message = U 'Utilizador ou password errados.' }
    elseif ($message -match 'network-related|server was not found|timeout|Timeout') { $message = U 'N\u00e3o foi poss\u00edvel chegar a esta inst\u00e2ncia. Confirme se est\u00e1 ligada e se o TCP e a firewall do servidor deixam passar a porta.' }
    Show-Status $false $message
  } finally {
    $form.Cursor = 'Default'
    $search.Enabled = $true
    $connect.Enabled = $true
    $test.Enabled = $grid.Rows.Count -gt 0
  }
}

function Get-SelectedTarget {
  $text = $server.Text.Trim()
  if ($script:entries.ContainsKey($text)) { return $script:entries[$text] }
  if ($text -match '^([A-Za-z0-9._-]+):(\d+)$') { return [pscustomobject]@{ Address = $Matches[1]; DataSource = "tcp:$($Matches[1]),$($Matches[2])" } }
  if ($text -match '^([A-Za-z0-9._-]+)\\(.+)$') { return [pscustomobject]@{ Address = $Matches[1]; DataSource = $text } }
  if ($text -match '^[A-Za-z0-9._-]+$') { return [pscustomobject]@{ Address = $text; DataSource = "tcp:$text,1433" } }
  throw (U 'Escolha o servidor ou escreva IP:porta.')
}

function Update-Hotels {
  $script:lastKey = Get-FormKey
  $script:connected = $null
  $grid.Rows.Clear()
  $install.Enabled = $false
  Show-Status $true (U 'A ligar ao servidor...')
  [Windows.Forms.Application]::DoEvents()
  $target = Get-SelectedTarget
  $builder = New-Object Data.SqlClient.SqlConnectionStringBuilder
  $builder['Data Source'] = $target.DataSource
  $builder['Initial Catalog'] = 'master'
  $builder['Connect Timeout'] = 6
  if ($user.Text.Trim()) {
    $builder['User ID'] = $user.Text.Trim()
    $builder['Password'] = $password.Text
  } else {
    $builder['Integrated Security'] = $true
  }
  $connection = New-Object Data.SqlClient.SqlConnection($builder.ConnectionString)
  try {
    $connection.Open()
    $hotels = @(Get-SystemHotels $connection)
  } finally {
    $connection.Dispose()
  }
  $script:connected = $target
  foreach ($hotel in $hotels) { [void]$grid.Rows.Add(($hotels.Count -eq 1), $hotel.Hotel, $hotel.Database, $hotel.Port, '') }
  if (-not $hotels.Count) {
    Show-Status $false (U 'N\u00e3o h\u00e1 bases do MAVIE-HGest nesta inst\u00e2ncia.')
  } elseif (@($hotels | Where-Object { -not $_.Port }).Count) {
    Show-Status $false (U 'H\u00e1 hot\u00e9is sem porta conhecida. Atualize o servidor com o setup novo ou escreva a porta na tabela, e carregue em Testar liga\u00e7\u00e3o.')
  } else {
    Show-Status $true (U 'Escolha os hot\u00e9is e carregue em Testar liga\u00e7\u00e3o.')
  }
}

function Request-Hotels {
  if ((Get-FormKey) -eq $script:lastKey) { return }
  if (-not $server.Text.Trim()) { return }
  if ($user.Text.Trim() -and -not $password.Text) { return }
  Invoke-Safely { Update-Hotels }
}

function Start-Search {
  Invoke-Safely {
    Show-Status $true (U 'A procurar servidores SQL Server na rede...')
    [Windows.Forms.Application]::DoEvents()
    $networks = @(Get-LocalNetworks)
    $found = @(Find-BrowserInstances $networks)
    $known = @($found | Where-Object { $_.Port -eq 1433 } | ForEach-Object { $_.Ip })
    $extra = @(Find-DefaultPortHosts $networks | Where-Object { $known -notcontains $_ })
    $server.Items.Clear()
    $script:entries = @{}
    $sorted = @($found | Sort-Object @{ Expression = { $networks -contains $_.Ip.Substring(0, $_.Ip.LastIndexOf('.')) }; Descending = $true }, Ip)
    foreach ($item in @($sorted | Group-Object Server, Instance | ForEach-Object { $_.Group[0] })) {
      $label = "$($item.Server)\$($item.Instance)  -  $($item.Ip):$($item.Port)  -  SQL Server $($item.Version)"
      $script:entries[$label] = [pscustomobject]@{ Address = $item.Ip; DataSource = "tcp:$($item.Ip),$($item.Port)" }
      [void]$server.Items.Add($label)
    }
    foreach ($ip in $extra) {
      $label = "$ip`:1433"
      $script:entries[$label] = [pscustomobject]@{ Address = $ip; DataSource = "tcp:$ip,1433" }
      [void]$server.Items.Add($label)
    }
    if ($server.Items.Count) {
      $server.SelectedIndex = 0
      Show-Status $true ("$($server.Items.Count) " + (U 'inst\u00e2ncia(s) encontrada(s). Escreva a password e carregue em Ligar.'))
      [void]$password.Focus()
    } else {
      Show-Status $false (U 'N\u00e3o foi encontrado nenhum servidor. Escreva IP:porta do SQL Server ou indique o IP do hotel \u00e0 m\u00e3o.')
    }
  }
}

$form.Add_Shown({ Start-Search })
$search.Add_Click({ Start-Search })
$connect.Add_Click({ Invoke-Safely { Update-Hotels } })
$server.Add_SelectionChangeCommitted({
  $server.Text = "$($server.SelectedItem)"
  Request-Hotels
})
$server.Add_Leave({ Request-Hotels })
$user.Add_Leave({ Request-Hotels })
$password.Add_Leave({ Request-Hotels })
$grid.Add_CurrentCellDirtyStateChanged({ if ($grid.IsCurrentCellDirty) { [void]$grid.CommitEdit('CurrentCellChange') } })
$grid.Add_CellValueChanged({ if ($_.ColumnIndex -eq 0 -or $_.ColumnIndex -eq 3) { Reset-Tests } })

$test.Add_Click({
  Invoke-Safely {
    $grid.EndEdit() | Out-Null
    $chosen = @($grid.Rows | Where-Object { $_.Cells[0].Value -eq $true })
    if (-not $chosen.Count) {
      Show-Status $false (U 'Escolha pelo menos um hotel.')
      return
    }
    $allOk = $true
    foreach ($row in $chosen) {
      $port = "$($row.Cells[3].Value)".Trim()
      if ($port -notmatch '^\d+$' -or [int]$port -lt 1 -or [int]$port -gt 65535) {
        $row.Cells[4].Value = 'Falta a porta'
        $allOk = $false
        continue
      }
      $row.Cells[4].Value = 'A testar...'
      [Windows.Forms.Application]::DoEvents()
      if (Test-HotelPort $script:connected.Address $port) {
        $row.Cells[4].Value = 'OK'
      } else {
        $row.Cells[4].Value = 'Sem resposta'
        $allOk = $false
      }
    }
    if ($allOk) {
      $install.Enabled = $true
      Show-Status $true (U 'Tudo OK. Carregue em Instalar posto e agente.')
    } else {
      Show-Status $false (U 'H\u00e1 hot\u00e9is que n\u00e3o respondem. No servidor, abra as portas com hoteis.ps1 -Acao firewall (ou corra o setup novo) e confirme que o hotel est\u00e1 a correr e que a rede n\u00e3o est\u00e1 como P\u00fablica.')
    }
  }
})

$install.Add_Click({
  $ports = @($grid.Rows | Where-Object { $_.Cells[0].Value -eq $true } | ForEach-Object { "$($_.Cells[3].Value)".Trim() })
  if ($Saida) { [IO.File]::WriteAllLines($Saida, [string[]]@($script:connected.Address, ($ports -join ','))) }
  $form.DialogResult = 'OK'
  $form.Close()
})

[void]$form.ShowDialog()
