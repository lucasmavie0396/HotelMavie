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
UninstallDisplayIcon={sys}\WindowsPowerShell\v1.0\powershell.exe
CloseApplications=no
RestartApplications=no

[Languages]
Name: "portugues"; MessagesFile: "compiler:Languages\Portuguese.isl"

[Tasks]
Name: "atalho"; Description: "Atalho ""MAVIE-HGest - Novo hotel"" no ambiente de trabalho"

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Dirs]
Name: "{app}\dados"; Flags: uninsneveruninstall

[Icons]
Name: "{group}\Novo hotel"; Filename: "{app}\deploy\windows\Novo hotel.cmd"; WorkingDir: "{app}\deploy\windows"
Name: "{group}\Manual de instalacao"; Filename: "{app}\deploy\windows\README.md"
Name: "{group}\Pasta do MAVIE-HGest"; Filename: "{app}"
Name: "{commondesktop}\MAVIE-HGest - Novo hotel"; Filename: "{app}\deploy\windows\Novo hotel.cmd"; WorkingDir: "{app}\deploy\windows"; Tasks: atalho

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\deploy\windows\hoteis.ps1"" -Acao atualizar -SemCompilar"; StatusMsg: "A atualizar as bases de dados e a arrancar os hoteis..."; Flags: runhidden waituntilterminated; Check: HasHotels
Filename: "{app}\deploy\windows\Novo hotel.cmd"; Description: "Abrir o assistente para criar um hotel"; Flags: postinstall shellexec skipifsilent nowait

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\deploy\windows\desinstalar.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "PararHoteis"

[Code]
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
    WizardForm.PreparingLabel.Caption := 'A parar os hoteis antes de atualizar os ficheiros...';
    if not Exec('powershell.exe', '-NoProfile -ExecutionPolicy Bypass -File "' + Script + '" -Acao parar', Dir, SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
      Result := 'Nao foi possivel parar os hoteis desta instalacao. Para-os com hoteis.ps1 -Acao parar e volta a correr o instalador.';
  end;
end;
