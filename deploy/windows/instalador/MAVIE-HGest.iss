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

[Components]
Name: "sistema"; Description: "Sistema MAVIE-HGest e base de dados"; Types: servidor; Flags: fixed
Name: "posto"; Description: "Atalho do painel e agente de impressão"; Types: posto; Flags: fixed

[Tasks]
Name: "atalho"; Description: "Atalho ""MAVIE-HGest - Novo hotel"" no ambiente de trabalho"; Components: sistema
Name: "impressao"; Description: "Imprimir talões neste posto (instala o agente de impressão)"; Components: posto

[Files]
Source: "{#Stage}\backend\*"; DestDir: "{app}\backend"; Flags: recursesubdirs createallsubdirs ignoreversion; Components: sistema
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
Name: "{group}\Manual de instalação"; Filename: "{app}\deploy\windows\README.md"
Name: "{group}\Pasta do MAVIE-HGest"; Filename: "{app}"
Name: "{commondesktop}\MAVIE-HGest - Novo hotel"; Filename: "{app}\deploy\windows\Novo hotel.cmd"; WorkingDir: "{app}\deploy\windows"; IconFilename: "{app}\deploy\windows\lam-company.ico"; Tasks: atalho

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\deploy\windows\hoteis.ps1"" -Acao atualizar -SemCompilar"; StatusMsg: "A atualizar as bases de dados e a arrancar os hotéis..."; Flags: runhidden waituntilterminated; Check: HasHotels
Filename: "{app}\deploy\windows\Novo hotel.cmd"; Description: "Abrir o assistente para criar um hotel"; Flags: postinstall shellexec skipifsilent nowait; Components: sistema
Filename: "{code:PanelUrl}"; Description: "Abrir o painel no navegador"; Flags: postinstall shellexec skipifsilent nowait; Components: posto

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\deploy\windows\desinstalar.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "PararHoteis"

[UninstallDelete]
Type: files; Name: "{app}\posto-atalhos.txt"
Type: files; Name: "{app}\posto-origens.txt"
Type: files; Name: "{app}\posto.log"

[Code]
var
  ServerPage: TInputQueryWizardPage;

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

function ServerAddress: String;
begin
  Result := Trim(ServerPage.Values[0]);
end;

function ServerPort: String;
begin
  Result := Trim(ServerPage.Values[1]);
  if Result = '' then Result := '3101';
end;

function PanelUrl(Param: String): String;
begin
  Result := 'http://' + ServerAddress + ':' + ServerPort;
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

procedure InitializeWizard;
begin
  ServerPage := CreateInputQueryPage(wpSelectComponents, 'Ligação ao servidor', 'Onde está instalado o MAVIE-HGest nesta rede?',
    'Indique o IP do servidor e a porta do hotel. Estes dados aparecem no fim da criação do hotel, no servidor (a porta do primeiro hotel é 3101).');
  ServerPage.Add('IP ou nome do servidor:', False);
  ServerPage.Add('Porta do hotel:', False);
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
begin
  Result := True;
  if CurPageID = ServerPage.ID then
  begin
    if ServerAddress = '' then
    begin
      MsgBox('Indique o IP ou o nome do servidor.', mbError, MB_OK);
      Result := False;
    end
    else if (StrToIntDef(ServerPort, 0) < 1) or (StrToIntDef(ServerPort, 0) > 65535) then
    begin
      MsgBox('A porta tem de ser um número entre 1 e 65535.', mbError, MB_OK);
      Result := False;
    end
    else if not ServerResponds(PanelUrl('') + '/api/health') then
      Result := MsgBox('O servidor não respondeu em ' + PanelUrl('') + '.' + #13#10#13#10 +
        'Confirme o IP e a porta, se o servidor está ligado e se a firewall dele deixa passar esta porta.' + #13#10#13#10 +
        'Continuar mesmo assim?', mbConfirmation, MB_YESNO) = IDYES;
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
  Params := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\deploy\windows\posto.ps1') + '" -Servidor "' + ServerAddress + '" -Porta ' + ServerPort;
  if not WizardIsTaskSelected('impressao') then Params := Params + ' -SemImpressao';
  if not Exec('powershell.exe', Params, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
    SuppressibleMsgBox('Não foi possível configurar este posto. Veja o motivo em ' + ExpandConstant('{app}\posto.log') + '.', mbError, MB_OK, IDOK);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and WizardIsComponentSelected('posto') then ConfigureWorkstation;
end;
