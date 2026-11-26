using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Mavie.GeradorLicencas;

public sealed record LigacaoBase(string Instancia, string Base, string? Utilizador = null, string? SenhaCifrada = null)
{
    public const string BasePadrao = "MAVIE_Licencas";
    public const string Ficheiro = "ligacao-sql.json";
    private static readonly byte[] Entropia = "MAVIE.Licencas.Base"u8.ToArray();

    public static LigacaoBase ComUtilizador(string instancia, string baseDados, string utilizador, string senha) =>
        new(instancia.Trim(), baseDados.Trim(), utilizador.Trim(),
            Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(senha), Entropia, DataProtectionScope.CurrentUser)));

    public string? Senha() => SenhaCifrada is null ? null
        : Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(SenhaCifrada), Entropia, DataProtectionScope.CurrentUser));

    public string Descricao => $"{Instancia} · base {Base} · " + (string.IsNullOrWhiteSpace(Utilizador) ? "autenticação do Windows" : $"utilizador {Utilizador}");

    public static IReadOnlyList<string> InstanciasLocais()
    {
        var lista = new List<string>();
        foreach (var vista in new[] { Microsoft.Win32.RegistryView.Registry64, Microsoft.Win32.RegistryView.Registry32 })
        {
            try
            {
                using var raiz = Microsoft.Win32.RegistryKey.OpenBaseKey(Microsoft.Win32.RegistryHive.LocalMachine, vista);
                using var chave = raiz.OpenSubKey(@"SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL");
                foreach (var nome in chave?.GetValueNames() ?? [])
                    lista.Add(nome.Equals("MSSQLSERVER", StringComparison.OrdinalIgnoreCase) ? "." : @".\" + nome);
            }
            catch (Exception ex) when (ex is System.Security.SecurityException or UnauthorizedAccessException or IOException)
            {
            }
        }
        return [.. lista.Distinct(StringComparer.OrdinalIgnoreCase).Order(StringComparer.OrdinalIgnoreCase)];
    }

    public static LigacaoBase? Ler(string pasta)
    {
        var f = Path.Combine(pasta, Ficheiro);
        return File.Exists(f) ? JsonSerializer.Deserialize<LigacaoBase>(File.ReadAllText(f)) : null;
    }

    public void Gravar(string pasta)
    {
        Directory.CreateDirectory(pasta);
        File.WriteAllText(Path.Combine(pasta, Ficheiro), JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
    }
}
