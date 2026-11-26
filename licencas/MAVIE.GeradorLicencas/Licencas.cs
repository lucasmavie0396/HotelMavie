using System.Buffers.Text;
using System.Globalization;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Mavie.GeradorLicencas;

public sealed record DadosLicenca(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("name")] string Nome,
    [property: JsonPropertyName("nuit")] string Nuit,
    [property: JsonPropertyName("issuedAt")] string EmitidaEm,
    [property: JsonPropertyName("validUntil")] string ValidaAte,
    [property: JsonPropertyName("v")] int V = 1);

public sealed record DadosDesbloqueio(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("nuit")] string Nuit,
    [property: JsonPropertyName("request")] string Pedido,
    [property: JsonPropertyName("issuedAt")] string EmitidoEm,
    [property: JsonPropertyName("validUntil")] string ValidoAte,
    [property: JsonPropertyName("v")] int V = 1);

public static partial class FormatoLicenca
{
    public const string Prefixo = "MAVIE1";
    public const string PrefixoDesbloqueio = "MAVIER1";

    [GeneratedRegex(@"^\d{9}$")]
    private static partial Regex RegexNuit();

    [GeneratedRegex(@"^\d{9}-\d{12}$")]
    private static partial Regex RegexPedido();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Espacos();

    public static bool NuitValido(string? nuit) => nuit is not null && RegexNuit().IsMatch(nuit);

    public static bool PedidoValido(string? pedido) => pedido is not null && RegexPedido().IsMatch(pedido);

    public static string Dia(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    public static string Codificar<T>(string prefixo, T dados, ECDsa chave)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(dados);
        var assinatura = chave.SignData(bytes, HashAlgorithmName.SHA256);
        return $"{prefixo}.{Base64Url.EncodeToString(bytes)}.{Base64Url.EncodeToString(assinatura)}";
    }

    public static T? Verificar<T>(string prefixo, string texto, ECDsa publica) where T : class
    {
        var partes = Espacos().Replace(texto, "").Split('.');
        if (partes.Length != 3 || partes[0] != prefixo)
            return null;
        try
        {
            var bytes = Base64Url.DecodeFromChars(partes[1]);
            var assinatura = Base64Url.DecodeFromChars(partes[2]);
            return publica.VerifyData(bytes, assinatura, HashAlgorithmName.SHA256) ? JsonSerializer.Deserialize<T>(bytes) : null;
        }
        catch (Exception ex) when (ex is FormatException or JsonException or CryptographicException)
        {
            return null;
        }
    }
}

public sealed class ArmazemLicencas(string pasta, string? publicaDoSistema)
{
    public const int DiasDesbloqueio = 3;

    public static string PastaPadrao => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MAVIE-HGest", "Licencas");

    public string Pasta { get; } = pasta;
    public string? PublicaDoSistema { get; } = publicaDoSistema;
    private string FicheiroChave => Path.Combine(Pasta, "chave-privada.pem");
    public string RegistoLinhaComandos => Path.Combine(Pasta, "registo.json");

    public bool TemChave => File.Exists(FicheiroChave);

    public static string? PublicaEmbutida()
    {
        using var recurso = Assembly.GetExecutingAssembly().GetManifestResourceStream("public-key.ts");
        if (recurso is null)
            return null;
        using var leitor = new StreamReader(recurso);
        var texto = leitor.ReadToEnd();
        var inicio = texto.IndexOf("-----BEGIN PUBLIC KEY-----", StringComparison.Ordinal);
        var fim = texto.IndexOf("-----END PUBLIC KEY-----", StringComparison.Ordinal);
        return inicio < 0 || fim < 0 ? null : texto[inicio..(fim + "-----END PUBLIC KEY-----".Length)];
    }

    private static string Normalizar(string pem) => string.Concat(pem.Where(c => !char.IsWhiteSpace(c)));

    public ECDsa CarregarChave()
    {
        var chave = ECDsa.Create();
        chave.ImportFromPem(File.ReadAllText(FicheiroChave));
        return chave;
    }

    public string ChavePublica()
    {
        using var chave = CarregarChave();
        return chave.ExportSubjectPublicKeyInfoPem();
    }

    public bool ChaveDoSistema => PublicaDoSistema is null || (TemChave && Normalizar(ChavePublica()) == Normalizar(PublicaDoSistema));

    public string CriarChave()
    {
        if (TemChave)
            throw new InvalidOperationException("Já existe uma chave neste computador. Substituí-la invalidaria todas as licenças emitidas.");
        using var chave = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        Gravar(chave);
        return chave.ExportSubjectPublicKeyInfoPem();
    }

    private void Gravar(ECDsa chave)
    {
        Directory.CreateDirectory(Pasta);
        File.WriteAllText(FicheiroChave, chave.ExportPkcs8PrivateKeyPem());
    }

    public void ExportarCopia(string ficheiro, string senha)
    {
        if (senha.Length < 10)
            throw new ArgumentException("A palavra-passe da cópia tem de ter pelo menos 10 caracteres.");
        using var chave = CarregarChave();
        File.WriteAllText(ficheiro, chave.ExportEncryptedPkcs8PrivateKeyPem(senha, new PbeParameters(PbeEncryptionAlgorithm.Aes256Cbc, HashAlgorithmName.SHA256, 600_000)));
    }

    public void ImportarCopia(string ficheiro, string senha)
    {
        if (TemChave)
            throw new InvalidOperationException($"Já existe uma chave neste computador ({FicheiroChave}).");
        using var chave = ECDsa.Create();
        try
        {
            chave.ImportFromEncryptedPem(File.ReadAllText(ficheiro), senha);
        }
        catch (Exception ex) when (ex is CryptographicException or ArgumentException)
        {
            throw new InvalidOperationException("Palavra-passe errada, ou o ficheiro não é uma cópia da chave das licenças.");
        }
        if (PublicaDoSistema is not null && Normalizar(chave.ExportSubjectPublicKeyInfoPem()) != Normalizar(PublicaDoSistema))
            throw new InvalidOperationException("Esta cópia não é a chave do sistema MAVIE-HGest: as licenças assinadas com ela seriam recusadas.");
        Gravar(chave);
    }

    private void Confirmar(string prefixo, string texto)
    {
        if (PublicaDoSistema is null)
            return;
        using var publica = ECDsa.Create();
        publica.ImportFromPem(PublicaDoSistema);
        var aceite = prefixo == FormatoLicenca.Prefixo
            ? FormatoLicenca.Verificar<DadosLicenca>(prefixo, texto, publica) is not null
            : FormatoLicenca.Verificar<DadosDesbloqueio>(prefixo, texto, publica) is not null;
        if (!aceite)
            throw new InvalidOperationException("A chave deste computador não é a do sistema MAVIE-HGest: o sistema recusaria esta licença. Reponha a cópia de segurança certa (menu Chave).");
    }

    public bool AceiteNoSistema(string texto)
    {
        if (PublicaDoSistema is null)
            return true;
        using var publica = ECDsa.Create();
        publica.ImportFromPem(PublicaDoSistema);
        return FormatoLicenca.Verificar<DadosLicenca>(FormatoLicenca.Prefixo, texto, publica) is not null;
    }

    public (DadosLicenca Dados, string Texto) Emitir(string nome, string nuit, DateOnly ate, DateOnly hoje, string? id = null, DateOnly? emitidaEm = null)
    {
        if (string.IsNullOrWhiteSpace(nome))
            throw new ArgumentException("Indique o nome comercial.");
        if (!FormatoLicenca.NuitValido(nuit))
            throw new ArgumentException("O NUIT tem de ter 9 algarismos.");
        if (ate < hoje && emitidaEm is null)
            throw new ArgumentException("A data de validade já passou.");
        var dados = new DadosLicenca(id ?? Guid.NewGuid().ToString(), nome.Trim(), nuit, FormatoLicenca.Dia(emitidaEm ?? hoje), FormatoLicenca.Dia(ate));
        using var chave = CarregarChave();
        var texto = FormatoLicenca.Codificar(FormatoLicenca.Prefixo, dados, chave);
        Confirmar(FormatoLicenca.Prefixo, texto);
        return (dados, texto);
    }

    public (DadosDesbloqueio Dados, string Texto) EmitirDesbloqueio(string pedido, DateOnly hoje)
    {
        if (!FormatoLicenca.PedidoValido(pedido))
            throw new ArgumentException("O pedido tem a forma NUIT-AAAAMMDDHHmm (9 + 12 algarismos), como o sistema do cliente o mostra.");
        var dados = new DadosDesbloqueio(Guid.NewGuid().ToString(), pedido[..9], pedido, FormatoLicenca.Dia(hoje), FormatoLicenca.Dia(hoje.AddDays(DiasDesbloqueio)));
        using var chave = CarregarChave();
        var texto = FormatoLicenca.Codificar(FormatoLicenca.PrefixoDesbloqueio, dados, chave);
        Confirmar(FormatoLicenca.PrefixoDesbloqueio, texto);
        return (dados, texto);
    }
}
