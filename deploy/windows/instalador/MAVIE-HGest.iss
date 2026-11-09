#ifndef Stage
  #error Corre gerar-instalador.ps1 (define Stage, Output, AppVersion e BuildStamp)
#endif

#define AppName "MAVIE-HGest"

[Setup]
AppId={{35D5B951-9DD7-4638-9F74-94E9A83E0E61}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion} ({#BuildStamp})
AppPublisher=MAVIE
DefaultDirName=C:\MAVIE-HGest
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
UsePreviousAppDir=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.14393
OutputDir={#Output}
OutputBaseFilename=MAVIE-HGest-Setup-{#AppVersion}-{#BuildStamp}
Compression=lzma2
SolidCompression=yes
LZMANumBlockThreads=1
WizardStyle=modern
UninstallDisplayName={#AppName}
SetupIconFile=..\lam-company.ico
UninstallDisplayIcon={app}\deploy\windows\lam-company.ico
CloseApplications=no
RestartApplications=no

[Languages]
Name: "portugues"; MessagesFile: "compiler:Languages\Portuguese.isl"

[Types]
Name: "servidor"; Description: "Servidor: sistema completo, base de dados e hotéis"
Name: "posto"; Description: "Posto de trabalho: liga a um servidor da rede pelo IP"
Name: "atualizacao"; Description: "Atualização: novo programa e escolha da base SQL Server a atualizar"

[Components]
Name: "sistema"; Description: "Sistema MAVIE-HGest e base de dados"; Types: servidor atualizacao; Flags: fixed
Name: "posto"; Description: "Atalho do painel e agente de impressão"; Types: posto; Flags: fixed

[Tasks]
Name: "atalho"; Description: "Atalho ""MAVIE-HGest - Novo hotel"" no ambiente de trabalho"; Components: sistema
Name: "impressao"; Description: "Imprimir talões neste posto (instala o agente de impressão)"; Components: posto

[Files]
Source: "{#Stage}\deploy\windows\escolher-servidor.ps1"; Flags: dontcopy
Source: "{#Stage}\deploy\windows\lam-company.ico"; Flags: dontcopy
Source: "{#Stage}\backend\*"; DestDir: "{app}\backend"; Flags: recursesubdirs createallsubdirs ignoreversion solidbreak; Components: sistema
Source: "{#Stage}\frontend\*"; DestDir: "{app}\frontend"; Flags: recursesubdirs createallsubdirs ignoreversion; Components: sistema
Source: "{#Stage}\instaladores\mariadb-*"; DestDir: "{app}\instaladores"; Flags: ignoreversion skipifsourcedoesntexist; Components: sistema
Source: "{#Stage}\instaladores\node-*"; DestDir: "{app}\instaladores"; Flags: ignoreversion skipifsourcedoesntexist
Source: "{#Stage}\deploy\*"; DestDir: "{app}\deploy"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#Stage}\print-agent\*"; DestDir: "{app}\print-agent"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#Stage}\README.md"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
Name: "{app}\dados"; Flags: uninsneveruninstall; Components: sistema

[Icons]
Name: "{group}\Novo hotel"; Filename: "{app}\deploy\windows\Novo hotel.cmd"; WorkingDir: "{app}\deploy\windows"; IconFilename: "{app}\deploy\windows\lam-company.ico"; Components: sistema
Name: "{group}\Atualizar base de dados"; Filename: "{app}\deploy\windows\Atualizar base de dados.cmd"; WorkingDir: "{app}\deploy\windows"; IconFilename: "{app}\deploy\windows\lam-company.ico"; Components: sistema
Name: "{group}\Manual de instalação"; Filename: "{app}\deploy\windows\README.md"
Name: "{group}\Pasta do MAVIE-HGest"; Filename: "{app}"
Name: "{commondesktop}\MAVIE-HGest - Novo hotel"; Filename: "{app}\deploy\windows\Novo hotel.cmd"; WorkingDir: "{app}\deploy\windows"; IconFilename: "{app}\deploy\windows\lam-company.ico"; Tasks: atalho

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\deploy\windows\hoteis.ps1"" -Acao atualizar -SemCompilar"; StatusMsg: "A atualizar as bases de dados e a arrancar os hotéis..."; Flags: runhidden waituntilterminated; Check: HasHotels
Filename: "{app}\deploy\windows\Novo hotel.cmd"; Description: "Abrir o assistente para criar um hotel"; Flags: postinstall shellexec skipifsilent nowait; Components: sistema; Check: not IsUpdate
Filename: "{app}\deploy\windows\Atualizar base de dados.cmd"; Description: "Escolher a base de dados a atualizar"; Flags: postinstall shellexec skipifsilent nowait; Components: sistema; Check: IsUpdate
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\deploy\windows\abrir-painel.ps1"" -Url ""{code:PanelUrl}"""; Description: "Abrir o painel em ecrã inteiro"; Flags: postinstall skipifsilent nowait runhidden; Components: posto

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\deploy\windows\desinstalar.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "PararHoteis"

[UninstallDelete]
Type: files; Name: "{app}\posto-atalhos.txt"
Type: files; Name: "{app}\posto-origens.txt"
Type: files; Name: "{app}\posto.log"
Type: files; Name: "{app}\sqlserver-config.log"

[Code]
var
  ServerPage: TInputQueryWizardPage;
  SearchShown: Boolean;

function HotelsIn(Dir: String): Boolean;
var
  Search: TFindRec;
begin
  Result := False;
  if FindFirst(AddBackslash(Dir) + 'dados\hoteis\*', Search) then
  begin
    try
      repeat
        if (Search.Name <> '.') and (Search.Name <> '..') and
           FileExists(AddBackslash(Dir) + 'dados\hoteis\' + Search.Name + '\hotel.env') then
        begin
          Result := True;
          Exit;
        end;
      until not FindNext(Search);
    finally
      FindClose(Search);
    end;
  end;
end;

function HasHotels: Boolean;
begin
  Result := HotelsIn(ExpandConstant('{app}'));
end;

function IsUpdate: Boolean;
begin
  Result := WizardSetupType(False) = 'atualizacao';
end;

function ServerAddress: String;
begin
  Result := Trim(ServerPage.Values[0]);
end;

function ServerPort: String;
begin
  Result := Trim(ServerPage.Values[1]);
  if Result = '' then Result := '3101';
end;

function NextPort(var Rest: String): String;
var
  Comma: Integer;
begin
  Comma := Pos(',', Rest);
  if Comma = 0 then
  begin
    Result := Trim(Rest);
    Rest := '';
  end
  else
  begin
    Result := Trim(Copy(Rest, 1, Comma - 1));
    Rest := Copy(Rest, Comma + 1, Length(Rest));
  end;
end;

function PanelUrl(Param: String): String;
var
  Rest: String;
begin
  Rest := ServerPort;
  Result := 'http://' + ServerAddress + ':' + NextPort(Rest);
end;

function PortsValid: Boolean;
var
  Rest, Port: String;
begin
  Result := True;
  Rest := ServerPort;
  while Result and (Rest <> '') do
  begin
    Port := NextPort(Rest);
    Result := (StrToIntDef(Port, 0) >= 1) and (StrToIntDef(Port, 0) <= 65535);
  end;
end;

function ServerResponds(Url: String): Boolean;
var
  Http: Variant;
begin
  Result := False;
  try
    Http := CreateOleObject('WinHttp.WinHttpRequest.5.1');
    Http.SetTimeouts(3000, 3000, 3000, 3000);
    Http.Open('GET', Url, False);
    Http.Send('');
    Result := Http.Status = 200;
  except
    Result := False;
  end;
end;

procedure ChooseServer(Sender: TObject);
var
  Output: String;
  Lines: TArrayOfString;
  Code: Integer;
begin
  Output := ExpandConstant('{tmp}\servidor-escolhido.txt');
  DeleteFile(Output);
  if not FileExists(ExpandConstant('{tmp}\escolher-servidor.ps1')) then
  begin
    ExtractTemporaryFile('escolher-servidor.ps1');
    ExtractTemporaryFile('lam-company.ico');
  end;
  WizardForm.NextButton.Enabled := False;
  WizardForm.BackButton.Enabled := False;
  try
    Exec('powershell.exe', '-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "' + ExpandConstant('{tmp}\escolher-servidor.ps1') + '" -Saida "' + Output + '"', ExpandConstant('{tmp}'), SW_HIDE, ewWaitUntilTerminated, Code);
  finally
    WizardForm.NextButton.Enabled := True;
    WizardForm.BackButton.Enabled := True;
  end;
  if LoadStringsFromFile(Output, Lines) and (GetArrayLength(Lines) >= 2) then
  begin
    ServerPage.Values[0] := Lines[0];
    ServerPage.Values[1] := Lines[1];
  end;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if (CurPageID = ServerPage.ID) and not SearchShown and not WizardSilent then
  begin
    SearchShown := True;
    ChooseServer(nil);
  end;
end;

procedure InitializeWizard;
var
  SearchButton: TNewButton;
begin
  ServerPage := CreateInputQueryPage(wpSelectComponents, 'Ligação ao servidor', 'Onde está instalado o MAVIE-HGest nesta rede?',
    'Procure o servidor na rede ou indique o IP e a porta do hotel. Para vários hotéis, separe as portas por vírgulas (por exemplo 3101,3102).');
  ServerPage.Add('IP ou nome do servidor:', False);
  ServerPage.Add('Porta(s) do hotel:', False);
  SearchButton := TNewButton.Create(ServerPage);
  SearchButton.Parent := ServerPage.Surface;
  SearchButton.Left := ServerPage.Edits[1].Left;
  SearchButton.Top := ServerPage.Edits[1].Top + ServerPage.Edits[1].Height + ScaleY(14);
  SearchButton.Width := ScaleX(220);
  SearchButton.Height := ScaleY(28);
  SearchButton.Caption := 'Procurar servidores na rede...';
  SearchButton.OnClick := @ChooseServer;
  ServerPage.Values[0] := GetPreviousData('Servidor', ExpandConstant('{param:SERVIDOR|}'));
  ServerPage.Values[1] := GetPreviousData('Porta', ExpandConstant('{param:PORTA|3101}'));
  if ExpandConstant('{param:SERVIDOR|}') <> '' then ServerPage.Values[0] := ExpandConstant('{param:SERVIDOR|}');
  if ExpandConstant('{param:PORTA|}') <> '' then ServerPage.Values[1] := ExpandConstant('{param:PORTA|}');
end;

procedure RegisterPreviousData(PreviousDataKey: Integer);
begin
  SetPreviousData(PreviousDataKey, 'Servidor', ServerAddress);
  SetPreviousData(PreviousDataKey, 'Porta', ServerPort);
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = ServerPage.ID) and not WizardIsComponentSelected('posto');
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Rest, Port, Url: String;
begin
  Result := True;
  if CurPageID = ServerPage.ID then
  begin
    if ServerAddress = '' then
    begin
      MsgBox('Indique o IP ou o nome do servidor.', mbError, MB_OK);
      Result := False;
    end
    else if not PortsValid then
    begin
      MsgBox('Cada porta tem de ser um número entre 1 e 65535.', mbError, MB_OK);
      Result := False;
    end
    else
    begin
      Rest := ServerPort;
      while Result and (Rest <> '') do
      begin
        Port := NextPort(Rest);
        Url := 'http://' + ServerAddress + ':' + Port;
        if not ServerResponds(Url + '/api/health') then
          Result := MsgBox('O servidor não respondeu em ' + Url + '.' + #13#10#13#10 +
            'Confirme o IP e a porta, se o servidor está ligado e se a firewall dele deixa passar esta porta.' + #13#10#13#10 +
            'Continuar mesmo assim?', mbConfirmation, MB_YESNO) = IDYES;
      end;
    end;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Dir, Script: String;
  Code: Integer;
begin
  Result := '';
  Dir := WizardDirValue;
  Script := AddBackslash(Dir) + 'deploy\windows\hoteis.ps1';
  if FileExists(Script) and HotelsIn(Dir) then
  begin
    WizardForm.PreparingLabel.Caption := 'A parar os hotéis antes de atualizar os ficheiros...';
    if not Exec('powershell.exe', '-NoProfile -ExecutionPolicy Bypass -File "' + Script + '" -Acao parar', Dir, SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
      Result := 'Não foi possível parar os hotéis desta instalação. Pare-os com hoteis.ps1 -Acao parar e volte a correr o instalador.';
  end;
end;

procedure ConfigureWorkstation;
var
  Params: String;
  Code: Integer;
begin
  WizardForm.StatusLabel.Caption := 'A configurar este posto...';
  Params := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\deploy\windows\posto.ps1') + '" -Servidor "' + ServerAddress + '" -Porta "' + ServerPort + '"';
  if not WizardIsTaskSelected('impressao') then Params := Params + ' -SemImpressao';
  if not Exec('powershell.exe', Params, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
    SuppressibleMsgBox('Não foi possível configurar este posto. Veja o motivo em ' + ExpandConstant('{app}\posto.log') + '.', mbError, MB_OK, IDOK);
end;

procedure PrepareSqlServer;
var
  Code: Integer;
begin
  if ExpandConstant('{param:SEMSQLCONFIG|0}') = '1' then Exit;
  WizardForm.StatusLabel.Caption := 'A preparar o SQL Server (TCP fixo e autenticação SQL)...';
  if not Exec('powershell.exe', '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\deploy\windows\preparar-sqlserver.ps1') + '"', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
    SuppressibleMsgBox('Não foi possível preparar o SQL Server. Veja o motivo em ' + ExpandConstant('{app}\sqlserver-config.log') + '. Pode corrigir depois em Novo hotel, com Instalar o que falta.', mbError, MB_OK, IDOK);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep <> ssPostInstall then Exit;
  if WizardIsComponentSelected('posto') then ConfigureWorkstation;
  if WizardIsComponentSelected('sistema') and not IsUpdate then PrepareSqlServer;
end;
