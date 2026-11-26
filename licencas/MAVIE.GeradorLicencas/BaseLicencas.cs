using System.Data;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

namespace Mavie.GeradorLicencas;

public sealed class Cliente
{
    public int Id { get; set; }
    public string Nome { get; set; } = "";
    public string Nuit { get; set; } = "";
    public string? Contacto { get; set; }
    public Plano Plano { get; set; } = Plano.Mensal;
    public decimal ValorMensal { get; set; }
    public string? Observacoes { get; set; }
    public EstadoCliente Estado { get; set; } = EstadoCliente.Ativo;
    public DateTime CriadoEmUtc { get; set; }
}

public sealed class PagamentoRegisto
{
    public int Id { get; set; }
    public int ClienteId { get; set; }
    public DateOnly Data { get; set; }
    public decimal Valor { get; set; }
    public int Meses { get; set; }
    public DateOnly PeriodoAte { get; set; }
    public string? Referencia { get; set; }
    public bool Anulado { get; set; }
    public string? MotivoAnulacao { get; set; }
}

public sealed class LicencaRegisto
{
    public string LicencaId { get; set; } = "";
    public int ClienteId { get; set; }
    public DateOnly EmitidaEm { get; set; }
    public DateOnly ValidaAte { get; set; }
    public string Texto { get; set; } = "";
    public int? PagamentoId { get; set; }
    public string? Observacoes { get; set; }
    public DateTime EmitidaEmUtc { get; set; }
}

public sealed class DesbloqueioRegisto
{
    public string Id { get; set; } = "";
    public int ClienteId { get; set; }
    public string Pedido { get; set; } = "";
    public DateOnly ValidoAte { get; set; }
    public string Texto { get; set; } = "";
    public string Motivo { get; set; } = "";
    public DateTime EmitidoEmUtc { get; set; }
}

public sealed class EventoHistorico
{
    public DateTime DataUtc { get; set; }
    public int ClienteId { get; set; }
    public string Acao { get; set; } = "";
    public string Detalhe { get; set; } = "";
    public string Utilizador { get; set; } = "";
}

public sealed class FicheiroLicencas
{
    public int Versao { get; set; } = 1;
    public int ProximoId { get; set; } = 1;
    public List<Cliente> Clientes { get; set; } = [];
    public List<PagamentoRegisto> Pagamentos { get; set; } = [];
    public List<LicencaRegisto> Licencas { get; set; } = [];
    public List<DesbloqueioRegisto> Desbloqueios { get; set; } = [];
    public List<EventoHistorico> Historico { get; set; } = [];
}

public sealed record ClienteResumo(int Id, string Nome, string Nuit, string? Contacto, Plano Plano, decimal ValorMensal, EstadoCliente Estado,
    string? Observacoes, DateOnly? ValidaAte, DateOnly? UltimoPagamento);

public sealed class BaseLicencas
{
    private const string Sistema = "MAVIE-Licencas";
    private const int VersaoEsquema = 1;
    public const string FicheiroAntigo = "clientes-licencas.json";
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true, Converters = { new JsonStringEnumConverter() } };

    private readonly string ligacao;
    private readonly string ligacaoMaster;
    private readonly string utilizador;

    public BaseLicencas(LigacaoBase destino, string? utilizador = null)
    {
        NomeBase = ValidarNome(destino.Base);
        if (string.IsNullOrWhiteSpace(destino.Instancia))
            throw new ArgumentException("Indique a instância do SQL Server (ex.: .\\SQLEXPRESS).");
        var b = new SqlConnectionStringBuilder
        {
            DataSource = destino.Instancia.Trim(),
            TrustServerCertificate = true,
            ConnectTimeout = 15,
            ApplicationName = "MAVIE-Licencas",
        };
        if (string.IsNullOrWhiteSpace(destino.Utilizador))
            b.IntegratedSecurity = true;
        else
        {
            b.UserID = destino.Utilizador;
            b.Password = destino.Senha() ?? "";
        }
        b.InitialCatalog = "master";
        ligacaoMaster = b.ConnectionString;
        b.InitialCatalog = NomeBase;
        ligacao = b.ConnectionString;
        Descricao = destino.Descricao;
        this.utilizador = utilizador ?? Environment.UserName;
    }

    public string NomeBase { get; }
    public string Descricao { get; }

    public static string ValidarNome(string nome)
    {
        nome = (nome ?? "").Trim();
        if (!Regex.IsMatch(nome, "^[A-Za-z][A-Za-z0-9_]{0,99}$"))
            throw new ArgumentException("Nome da base inválido (só letras, algarismos e _, a começar por uma letra).");
        if (nome.ToLowerInvariant() is "master" or "model" or "msdb" or "tempdb")
            throw new ArgumentException($"A base «{nome}» é do próprio SQL Server. Use uma base própria (ex.: {LigacaoBase.BasePadrao}).");
        return nome;
    }

    public static string ExplicarErro(Exception ex) => ex is SqlException sql ? sql.Number switch
    {
        262 or 1801 when sql.Message.Contains("CREATE DATABASE", StringComparison.OrdinalIgnoreCase) =>
            "Esta conta não tem permissão para criar bases de dados neste SQL Server.\n\n" +
            "Escolha «Utilizador do SQL Server» e entre com o sa (ou outro administrador do SQL Server).",
        262 => "Sem permissão no SQL Server: " + sql.Message,
        18456 => "O SQL Server recusou o utilizador ou a palavra-passe (ou não aceita utilizadores do SQL Server: ative a autenticação mista).",
        4060 => "Sem acesso à base das licenças com esta conta: " + sql.Message,
        3201 or 3013 => "O SQL Server não conseguiu gravar a cópia nessa pasta: " + sql.Message,
        -1 or 2 or 53 or 26 => "Não encontrei a instância do SQL Server. Confirme o nome (ex.: .\\SQLEXPRESS) e se o serviço do SQL Server está a correr.",
        _ => sql.Message,
    } : ex.Message;

    public void Preparar()
    {
        using (var c = new SqlConnection(ligacaoMaster))
        {
            c.Open();
            Executar(c, null, $"IF DB_ID(@nome) IS NULL CREATE DATABASE [{NomeBase}]", ("@nome", NomeBase));
        }
        using var b = Abrir();
        var marca = Escalar(b, null, "IF OBJECT_ID('dbo.Esquema') IS NOT NULL SELECT TOP 1 Sistema FROM dbo.Esquema") as string;
        if (marca is null)
        {
            if (Convert.ToInt32(Escalar(b, null, "SELECT COUNT(*) FROM sys.tables")) > 0)
                throw new InvalidOperationException($"A base «{NomeBase}» já existe e tem dados de outro sistema. Escolha outro nome (ex.: {LigacaoBase.BasePadrao}).");
            using var t = b.BeginTransaction();
            Executar(b, t, """
                CREATE TABLE dbo.Esquema (Sistema nvarchar(40) NOT NULL, Versao int NOT NULL);
                CREATE TABLE dbo.Clientes (
                    Id int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Clientes PRIMARY KEY,
                    Nome nvarchar(200) NOT NULL,
                    Nuit char(9) NOT NULL CONSTRAINT UQ_Clientes_Nuit UNIQUE,
                    Contacto nvarchar(100) NULL,
                    Plano nvarchar(20) NOT NULL,
                    ValorMensal decimal(18,2) NOT NULL,
                    Observacoes nvarchar(1000) NULL,
                    Estado nvarchar(20) NOT NULL,
                    CriadoEmUtc datetime2(0) NOT NULL);
                CREATE TABLE dbo.Pagamentos (
                    Id int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Pagamentos PRIMARY KEY,
                    ClienteId int NOT NULL CONSTRAINT FK_Pagamentos_Clientes REFERENCES dbo.Clientes(Id),
                    Data date NOT NULL,
                    Valor decimal(18,2) NOT NULL,
                    Meses int NOT NULL,
                    PeriodoAte date NOT NULL,
                    Referencia nvarchar(200) NULL,
                    Anulado bit NOT NULL CONSTRAINT DF_Pagamentos_Anulado DEFAULT 0,
                    MotivoAnulacao nvarchar(500) NULL,
                    RegistadoPor nvarchar(128) NOT NULL,
                    RegistadoEmUtc datetime2(0) NOT NULL);
                CREATE TABLE dbo.Licencas (
                    LicencaId nvarchar(64) NOT NULL CONSTRAINT PK_Licencas PRIMARY KEY,
                    ClienteId int NOT NULL CONSTRAINT FK_Licencas_Clientes REFERENCES dbo.Clientes(Id),
                    EmitidaEm date NOT NULL,
                    ValidaAte date NOT NULL,
                    Texto nvarchar(max) NOT NULL,
                    PagamentoId int NULL CONSTRAINT FK_Licencas_Pagamentos REFERENCES dbo.Pagamentos(Id),
                    Observacoes nvarchar(500) NULL,
                    EmitidaEmUtc datetime2(0) NOT NULL,
                    EmitidaPor nvarchar(128) NOT NULL);
                CREATE TABLE dbo.Desbloqueios (
                    Id nvarchar(64) NOT NULL CONSTRAINT PK_Desbloqueios PRIMARY KEY,
                    ClienteId int NOT NULL CONSTRAINT FK_Desbloqueios_Clientes REFERENCES dbo.Clientes(Id),
                    Pedido nvarchar(40) NOT NULL,
                    ValidoAte date NOT NULL,
                    Texto nvarchar(max) NOT NULL,
                    Motivo nvarchar(500) NOT NULL,
                    EmitidoEmUtc datetime2(0) NOT NULL,
                    EmitidoPor nvarchar(128) NOT NULL);
                CREATE TABLE dbo.Historico (
                    Id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_Historico PRIMARY KEY,
                    DataUtc datetime2(0) NOT NULL,
                    ClienteId int NULL CONSTRAINT FK_Historico_Clientes REFERENCES dbo.Clientes(Id),
                    Acao nvarchar(60) NOT NULL,
                    Detalhe nvarchar(1000) NOT NULL,
                    Utilizador nvarchar(128) NOT NULL);
                CREATE INDEX IX_Pagamentos_Cliente ON dbo.Pagamentos(ClienteId);
                CREATE INDEX IX_Licencas_Cliente ON dbo.Licencas(ClienteId);
                CREATE INDEX IX_Historico_Cliente ON dbo.Historico(ClienteId, DataUtc);
                """);
            Executar(b, t, "INSERT dbo.Esquema (Sistema, Versao) VALUES (@s, @v)", ("@s", Sistema), ("@v", VersaoEsquema));
            Registar(b, t, null, "Base criada", $"Base {NomeBase} criada");
            t.Commit();
        }
        else if (marca != Sistema)
            throw new InvalidOperationException($"A base «{NomeBase}» pertence a outro sistema ({marca}). Escolha outro nome.");
    }

    private SqlConnection Abrir()
    {
        var c = new SqlConnection(ligacao);
        c.Open();
        return c;
    }

    private static SqlCommand Comando(SqlConnection c, SqlTransaction? t, string sql, (string Nome, object? Valor)[] p)
    {
        var cmd = new SqlCommand(sql, c, t);
        foreach (var (nome, valor) in p)
        {
            var parametro = valor switch
            {
                DateOnly d => new SqlParameter(nome, SqlDbType.Date) { Value = d.ToDateTime(TimeOnly.MinValue) },
                DateTime d => new SqlParameter(nome, SqlDbType.DateTime2) { Value = d },
                string s => new SqlParameter(nome, SqlDbType.NVarChar, s.Length > 4000 ? -1 : Math.Max(s.Length, 1)) { Value = s },
                _ => new SqlParameter(nome, valor ?? DBNull.Value),
            };
            cmd.Parameters.Add(parametro);
        }
        return cmd;
    }

    private static int Executar(SqlConnection c, SqlTransaction? t, string sql, params (string Nome, object? Valor)[] p)
    {
        using var cmd = Comando(c, t, sql, p);
        return cmd.ExecuteNonQuery();
    }

    private static object? Escalar(SqlConnection c, SqlTransaction? t, string sql, params (string Nome, object? Valor)[] p)
    {
        using var cmd = Comando(c, t, sql, p);
        var v = cmd.ExecuteScalar();
        return v is DBNull ? null : v;
    }

    private static List<T> Ler<T>(SqlConnection c, SqlTransaction? t, string sql, Func<SqlDataReader, T> linha, params (string Nome, object? Valor)[] p)
    {
        using var cmd = Comando(c, t, sql, p);
        using var r = cmd.ExecuteReader();
        var lista = new List<T>();
        while (r.Read())
            lista.Add(linha(r));
        return lista;
    }

    private static string? TextoOuNulo(SqlDataReader r, string campo) => r[campo] is DBNull ? null : (string)r[campo];
    private static DateOnly Dia(SqlDataReader r, string campo) => DateOnly.FromDateTime((DateTime)r[campo]);
    private static DateOnly? DiaOuNulo(SqlDataReader r, string campo) => r[campo] is DBNull ? null : DateOnly.FromDateTime((DateTime)r[campo]);
    private static DateTime Utc(SqlDataReader r, string campo) => DateTime.SpecifyKind((DateTime)r[campo], DateTimeKind.Utc);

    private void Registar(SqlConnection c, SqlTransaction? t, int? clienteId, string acao, string detalhe, DateTime? quando = null, string? quem = null) =>
        Executar(c, t, "INSERT dbo.Historico (DataUtc, ClienteId, Acao, Detalhe, Utilizador) VALUES (@d, @c, @a, @t, @u)",
            ("@d", quando ?? DateTime.UtcNow), ("@c", clienteId), ("@a", acao), ("@t", detalhe.Length > 1000 ? detalhe[..1000] : detalhe), ("@u", quem ?? utilizador));

    private const string SelecaoResumo = """
        SELECT c.Id, c.Nome, c.Nuit, c.Contacto, c.Plano, c.ValorMensal, c.Estado, c.Observacoes,
            (SELECT MAX(l.ValidaAte) FROM dbo.Licencas l WHERE l.ClienteId = c.Id) AS ValidaAte,
            (SELECT MAX(p.Data) FROM dbo.Pagamentos p WHERE p.ClienteId = c.Id AND p.Anulado = 0) AS UltimoPagamento
        FROM dbo.Clientes c
        """;

    private static ClienteResumo LerResumo(SqlDataReader r) => new((int)r["Id"], (string)r["Nome"], (string)r["Nuit"], TextoOuNulo(r, "Contacto"),
        Enum.Parse<Plano>((string)r["Plano"]), (decimal)r["ValorMensal"], Enum.Parse<EstadoCliente>((string)r["Estado"]), TextoOuNulo(r, "Observacoes"),
        DiaOuNulo(r, "ValidaAte"), DiaOuNulo(r, "UltimoPagamento"));

    private ClienteResumo Obter(SqlConnection c, SqlTransaction? t, int id) =>
        Ler(c, t, SelecaoResumo + " WHERE c.Id = @id", LerResumo, ("@id", id)).FirstOrDefault() ?? throw new InvalidOperationException("Cliente não encontrado.");

    public bool TemLicencas
    {
        get
        {
            using var c = Abrir();
            return Escalar(c, null, "SELECT TOP 1 1 FROM dbo.Licencas") is not null;
        }
    }

    public bool Vazia
    {
        get
        {
            using var c = Abrir();
            return Escalar(c, null, "SELECT TOP 1 1 FROM dbo.Clientes") is null;
        }
    }

    public IReadOnlyList<ClienteResumo> Clientes()
    {
        using var c = Abrir();
        return [.. Ler(c, null, SelecaoResumo, LerResumo).OrderBy(x => x.Nome, StringComparer.CurrentCultureIgnoreCase)];
    }

    public ClienteResumo Cliente(int id)
    {
        using var c = Abrir();
        return Obter(c, null, id);
    }

    public IReadOnlyList<PagamentoRegisto> Pagamentos(int id)
    {
        using var c = Abrir();
        return Ler(c, null, "SELECT * FROM dbo.Pagamentos WHERE ClienteId = @id ORDER BY Data DESC, Id DESC", r => new PagamentoRegisto
        {
            Id = (int)r["Id"], ClienteId = (int)r["ClienteId"], Data = Dia(r, "Data"), Valor = (decimal)r["Valor"], Meses = (int)r["Meses"],
            PeriodoAte = Dia(r, "PeriodoAte"), Referencia = TextoOuNulo(r, "Referencia"), Anulado = (bool)r["Anulado"], MotivoAnulacao = TextoOuNulo(r, "MotivoAnulacao"),
        }, ("@id", id));
    }

    public IReadOnlyList<LicencaRegisto> Licencas(int id)
    {
        using var c = Abrir();
        return Ler(c, null, "SELECT * FROM dbo.Licencas WHERE ClienteId = @id ORDER BY EmitidaEmUtc DESC, EmitidaEm DESC", r => new LicencaRegisto
        {
            LicencaId = (string)r["LicencaId"], ClienteId = (int)r["ClienteId"], EmitidaEm = Dia(r, "EmitidaEm"), ValidaAte = Dia(r, "ValidaAte"),
            Texto = (string)r["Texto"], PagamentoId = r["PagamentoId"] is DBNull ? null : (int)r["PagamentoId"], Observacoes = TextoOuNulo(r, "Observacoes"),
            EmitidaEmUtc = Utc(r, "EmitidaEmUtc"),
        }, ("@id", id));
    }

    public IReadOnlyList<EventoHistorico> Historico(int id)
    {
        using var c = Abrir();
        return Ler(c, null, "SELECT * FROM dbo.Historico WHERE ClienteId = @id ORDER BY DataUtc DESC, Id DESC", r => new EventoHistorico
        {
            DataUtc = Utc(r, "DataUtc"), ClienteId = (int)r["ClienteId"], Acao = (string)r["Acao"], Detalhe = (string)r["Detalhe"], Utilizador = (string)r["Utilizador"],
        }, ("@id", id));
    }

    private static string Limpo(string? texto) => (texto ?? "").Trim();

    private static string? NuloSeVazio(string? texto) => string.IsNullOrWhiteSpace(texto) ? null : texto.Trim();

    private static void ValidarDados(string nome, decimal valorMensal)
    {
        if (Limpo(nome).Length < 2)
            throw new ArgumentException("Indique o nome comercial do cliente.");
        if (valorMensal < 0)
            throw new ArgumentException("O valor por mês não pode ser negativo.");
    }

    public int CriarCliente(string nome, string nuit, string? contacto, Plano plano, decimal valorMensal, string? observacoes)
    {
        ValidarDados(nome, valorMensal);
        nuit = Limpo(nuit);
        if (!FormatoLicenca.NuitValido(nuit))
            throw new ArgumentException("O NUIT tem de ter 9 algarismos.");
        using var c = Abrir();
        using var t = c.BeginTransaction(IsolationLevel.Serializable);
        if (Escalar(c, t, "SELECT TOP 1 1 FROM dbo.Clientes WHERE Nuit = @n", ("@n", nuit)) is not null)
            throw new InvalidOperationException($"Já existe um cliente com o NUIT {nuit}.");
        var id = Convert.ToInt32(Escalar(c, t, """
            INSERT dbo.Clientes (Nome, Nuit, Contacto, Plano, ValorMensal, Observacoes, Estado, CriadoEmUtc)
            OUTPUT INSERTED.Id VALUES (@nome, @nuit, @contacto, @plano, @valor, @obs, @estado, @em)
            """, ("@nome", Limpo(nome)), ("@nuit", nuit), ("@contacto", NuloSeVazio(contacto)), ("@plano", plano.ToString()), ("@valor", valorMensal),
            ("@obs", NuloSeVazio(observacoes)), ("@estado", EstadoCliente.Ativo.ToString()), ("@em", DateTime.UtcNow)));
        Registar(c, t, id, "Cliente criado", $"{Limpo(nome)} · NUIT {nuit} · {plano} · {RegrasCobranca.Valor(valorMensal)} por mês");
        t.Commit();
        return id;
    }

    public void AlterarCliente(int id, string nome, string? contacto, Plano plano, decimal valorMensal, string? observacoes)
    {
        ValidarDados(nome, valorMensal);
        using var c = Abrir();
        using var t = c.BeginTransaction();
        var antes = Obter(c, t, id);
        var mudancas = new List<string>();
        if (antes.Nome != Limpo(nome)) mudancas.Add($"nome «{antes.Nome}» → «{Limpo(nome)}»");
        if (antes.Plano != plano) mudancas.Add($"plano {antes.Plano} → {plano}");
        if (antes.ValorMensal != valorMensal) mudancas.Add($"valor {RegrasCobranca.Valor(antes.ValorMensal)} → {RegrasCobranca.Valor(valorMensal)}");
        Executar(c, t, "UPDATE dbo.Clientes SET Nome = @nome, Contacto = @contacto, Plano = @plano, ValorMensal = @valor, Observacoes = @obs WHERE Id = @id",
            ("@nome", Limpo(nome)), ("@contacto", NuloSeVazio(contacto)), ("@plano", plano.ToString()), ("@valor", valorMensal), ("@obs", NuloSeVazio(observacoes)), ("@id", id));
        Registar(c, t, id, "Cliente alterado", mudancas.Count == 0 ? "Contacto ou observações" : string.Join("; ", mudancas));
        t.Commit();
    }

    public void MudarEstado(int id, EstadoCliente estado, string motivo)
    {
        using var c = Abrir();
        using var t = c.BeginTransaction();
        if (Obter(c, t, id).Estado == EstadoCliente.Cancelado)
            throw new InvalidOperationException("O contrato deste cliente está cancelado.");
        Executar(c, t, "UPDATE dbo.Clientes SET Estado = @e WHERE Id = @id", ("@e", estado.ToString()), ("@id", id));
        Registar(c, t, id, estado switch { EstadoCliente.Suspenso => "Suspenso", EstadoCliente.Cancelado => "Contrato cancelado", _ => "Reativado" }, motivo);
        t.Commit();
    }

    private static void ExigirAtivo(ClienteResumo c)
    {
        if (c.Estado != EstadoCliente.Ativo)
            throw new InvalidOperationException(c.Estado == EstadoCliente.Suspenso
                ? "Este cliente está suspenso: reative-o antes de emitir licenças."
                : "O contrato deste cliente está cancelado: não se emitem licenças.");
    }

    private LicencaRegisto GuardarLicenca(SqlConnection c, SqlTransaction t, ArmazemLicencas armazem, ClienteResumo cliente, DateOnly ate, DateOnly hoje,
        int? pagamentoId, string? observacoes)
    {
        var (licenca, texto) = armazem.Emitir(cliente.Nome, cliente.Nuit, ate, hoje);
        var registo = new LicencaRegisto
        {
            LicencaId = licenca.Id, ClienteId = cliente.Id, EmitidaEm = hoje, ValidaAte = ate, Texto = texto, PagamentoId = pagamentoId,
            Observacoes = observacoes, EmitidaEmUtc = DateTime.UtcNow,
        };
        InserirLicenca(c, t, registo, utilizador);
        return registo;
    }

    private static void InserirLicenca(SqlConnection c, SqlTransaction t, LicencaRegisto l, string por) =>
        Executar(c, t, """
            INSERT dbo.Licencas (LicencaId, ClienteId, EmitidaEm, ValidaAte, Texto, PagamentoId, Observacoes, EmitidaEmUtc, EmitidaPor)
            VALUES (@id, @c, @em, @ate, @texto, @p, @obs, @utc, @por)
            """, ("@id", l.LicencaId), ("@c", l.ClienteId), ("@em", l.EmitidaEm), ("@ate", l.ValidaAte), ("@texto", l.Texto), ("@p", l.PagamentoId),
            ("@obs", l.Observacoes), ("@utc", l.EmitidaEmUtc), ("@por", por));

    public (PagamentoRegisto Pagamento, LicencaRegisto? Licenca) RegistarPagamento(ArmazemLicencas armazem, int id, DateOnly data, decimal valor, int meses, string? referencia, DateOnly hoje)
    {
        if (data > hoje)
            throw new ArgumentException("A data do pagamento não pode ser futura.");
        if (valor <= 0)
            throw new ArgumentException("Indique o valor recebido.");
        using var c = Abrir();
        using var t = c.BeginTransaction(IsolationLevel.Serializable);
        var cliente = Obter(c, t, id);
        ExigirAtivo(cliente);
        var ate = RegrasCobranca.NovaValidade(cliente.ValidaAte, data, meses);
        var pagamento = new PagamentoRegisto
        {
            ClienteId = id, Data = data, Valor = valor, Meses = meses, PeriodoAte = ate, Referencia = NuloSeVazio(referencia),
        };
        pagamento.Id = Convert.ToInt32(Escalar(c, t, """
            INSERT dbo.Pagamentos (ClienteId, Data, Valor, Meses, PeriodoAte, Referencia, RegistadoPor, RegistadoEmUtc)
            OUTPUT INSERTED.Id VALUES (@c, @d, @v, @m, @ate, @ref, @por, @em)
            """, ("@c", id), ("@d", data), ("@v", valor), ("@m", meses), ("@ate", ate), ("@ref", pagamento.Referencia), ("@por", utilizador), ("@em", DateTime.UtcNow)));
        LicencaRegisto? licenca = null;
        if (ate >= hoje)
            licenca = GuardarLicenca(c, t, armazem, cliente, ate, hoje, pagamento.Id, null);
        Registar(c, t, id, "Pagamento", $"{RegrasCobranca.Valor(valor)} · {meses} mês(es) · até {RegrasCobranca.Data(ate)}" +
            (pagamento.Referencia is null ? "" : $" · {pagamento.Referencia}") + (licenca is null ? " · sem licença (período já terminado)" : " · licença emitida"));
        t.Commit();
        return (pagamento, licenca);
    }

    public void AnularPagamento(int pagamentoId, string motivo)
    {
        using var c = Abrir();
        using var t = c.BeginTransaction();
        var p = Ler(c, t, "SELECT ClienteId, Valor, Data, Anulado FROM dbo.Pagamentos WITH (UPDLOCK) WHERE Id = @id",
            r => (Cliente: (int)r["ClienteId"], Valor: (decimal)r["Valor"], Data: Dia(r, "Data"), Anulado: (bool)r["Anulado"]), ("@id", pagamentoId)).FirstOrDefault();
        if (p == default)
            throw new InvalidOperationException("Pagamento não encontrado.");
        if (p.Anulado)
            throw new InvalidOperationException("Este pagamento já está anulado.");
        Executar(c, t, "UPDATE dbo.Pagamentos SET Anulado = 1, MotivoAnulacao = @m WHERE Id = @id", ("@m", motivo), ("@id", pagamentoId));
        Registar(c, t, p.Cliente, "Pagamento anulado", $"{RegrasCobranca.Valor(p.Valor)} de {RegrasCobranca.Data(p.Data)} · {motivo}");
        t.Commit();
    }

    public LicencaRegisto EmitirSemPagamento(ArmazemLicencas armazem, int id, DateOnly ate, string motivo, DateOnly hoje)
    {
        if (ate <= hoje)
            throw new ArgumentException("A licença tem de valer pelo menos até amanhã.");
        using var c = Abrir();
        using var t = c.BeginTransaction();
        var cliente = Obter(c, t, id);
        ExigirAtivo(cliente);
        var licenca = GuardarLicenca(c, t, armazem, cliente, ate, hoje, null, motivo);
        Registar(c, t, id, "Licença sem pagamento", $"Até {RegrasCobranca.Data(ate)} · {motivo}");
        t.Commit();
        return licenca;
    }

    public DesbloqueioRegisto EmitirDesbloqueio(ArmazemLicencas armazem, int id, string pedido, string motivo, DateOnly hoje)
    {
        using var c = Abrir();
        using var t = c.BeginTransaction();
        var cliente = Obter(c, t, id);
        pedido = Limpo(pedido);
        if (!pedido.StartsWith(cliente.Nuit + "-", StringComparison.Ordinal))
            throw new ArgumentException($"O pedido tem de começar pelo NUIT deste cliente ({cliente.Nuit}-).");
        var (dadosCodigo, texto) = armazem.EmitirDesbloqueio(pedido, hoje);
        var registo = new DesbloqueioRegisto
        {
            Id = dadosCodigo.Id, ClienteId = id, Pedido = pedido, ValidoAte = hoje.AddDays(ArmazemLicencas.DiasDesbloqueio), Texto = texto, Motivo = motivo,
            EmitidoEmUtc = DateTime.UtcNow,
        };
        InserirDesbloqueio(c, t, registo, utilizador);
        Registar(c, t, id, "Desbloqueio do relógio", $"Pedido {pedido} · {motivo}");
        t.Commit();
        return registo;
    }

    private static void InserirDesbloqueio(SqlConnection c, SqlTransaction t, DesbloqueioRegisto d, string por) =>
        Executar(c, t, """
            INSERT dbo.Desbloqueios (Id, ClienteId, Pedido, ValidoAte, Texto, Motivo, EmitidoEmUtc, EmitidoPor)
            VALUES (@id, @c, @p, @ate, @texto, @m, @utc, @por)
            """, ("@id", d.Id), ("@c", d.ClienteId), ("@p", d.Pedido), ("@ate", d.ValidoAte), ("@texto", d.Texto), ("@m", d.Motivo), ("@utc", d.EmitidoEmUtc), ("@por", por));

    public int ImportarLinhaComandos(ArmazemLicencas armazem)
    {
        if (!File.Exists(armazem.RegistoLinhaComandos))
            return 0;
        using var documento = JsonDocument.Parse(File.ReadAllText(armazem.RegistoLinhaComandos));
        using var c = Abrir();
        using var t = c.BeginTransaction(IsolationLevel.Serializable);
        var importadas = 0;
        foreach (var e in documento.RootElement.EnumerateArray())
        {
            string? Texto(string nome) => e.TryGetProperty(nome, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
            if (Texto("type") != "licenca" || Texto("id") is not { } licencaId || Texto("nuit") is not { } nuit || Texto("validUntil") is not { } ate
                || Texto("issuedAt") is not { } emitida || Escalar(c, t, "SELECT TOP 1 1 FROM dbo.Licencas WHERE LicencaId = @id", ("@id", licencaId)) is not null)
                continue;
            var nome = Texto("name") ?? nuit;
            var clienteId = Escalar(c, t, "SELECT Id FROM dbo.Clientes WHERE Nuit = @n", ("@n", nuit)) is int existente ? existente : 0;
            if (clienteId == 0)
            {
                clienteId = Convert.ToInt32(Escalar(c, t, """
                    INSERT dbo.Clientes (Nome, Nuit, Plano, ValorMensal, Observacoes, Estado, CriadoEmUtc)
                    OUTPUT INSERTED.Id VALUES (@nome, @nuit, @plano, 0, @obs, @estado, @em)
                    """, ("@nome", nome), ("@nuit", nuit), ("@plano", Plano.Mensal.ToString()), ("@obs", "Importado do registo da linha de comandos."),
                    ("@estado", EstadoCliente.Ativo.ToString()), ("@em", DateTime.UtcNow)));
                Registar(c, t, clienteId, "Cliente importado", "Do registo da linha de comandos (registo.json)");
            }
            var validaAte = DateOnly.ParseExact(ate, "yyyy-MM-dd");
            var emitidaEm = DateOnly.ParseExact(emitida, "yyyy-MM-dd");
            var (_, texto) = armazem.Emitir(nome, nuit, validaAte, emitidaEm, licencaId, emitidaEm);
            InserirLicenca(c, t, new LicencaRegisto
            {
                LicencaId = licencaId, ClienteId = clienteId, EmitidaEm = emitidaEm, ValidaAte = validaAte, Texto = texto,
                Observacoes = string.IsNullOrWhiteSpace(Texto("motivo")) ? "Importada da linha de comandos" : Texto("motivo"),
                EmitidaEmUtc = DateTime.TryParse(Texto("at"), null, System.Globalization.DateTimeStyles.AdjustToUniversal, out var em) ? em : DateTime.UtcNow,
            }, utilizador);
            Registar(c, t, clienteId, "Licença importada", $"Até {RegrasCobranca.Data(validaAte)}");
            importadas++;
        }
        t.Commit();
        return importadas;
    }

    public int MigrarFicheiro(string caminho)
    {
        var dados = JsonSerializer.Deserialize<FicheiroLicencas>(File.ReadAllText(caminho), Json) ?? new FicheiroLicencas();
        using var c = Abrir();
        using var t = c.BeginTransaction(IsolationLevel.Serializable);
        if (Escalar(c, t, "SELECT TOP 1 1 FROM dbo.Clientes") is not null)
            throw new InvalidOperationException("A base já tem clientes: os dados do ficheiro não foram passados para não duplicar.");
        var por = "migrado do ficheiro";
        Executar(c, t, "SET IDENTITY_INSERT dbo.Clientes ON");
        foreach (var x in dados.Clientes)
            Executar(c, t, """
                INSERT dbo.Clientes (Id, Nome, Nuit, Contacto, Plano, ValorMensal, Observacoes, Estado, CriadoEmUtc)
                VALUES (@id, @nome, @nuit, @contacto, @plano, @valor, @obs, @estado, @em)
                """, ("@id", x.Id), ("@nome", x.Nome), ("@nuit", x.Nuit), ("@contacto", x.Contacto), ("@plano", x.Plano.ToString()), ("@valor", x.ValorMensal),
                ("@obs", x.Observacoes), ("@estado", x.Estado.ToString()), ("@em", x.CriadoEmUtc));
        Executar(c, t, "SET IDENTITY_INSERT dbo.Clientes OFF");
        Executar(c, t, "SET IDENTITY_INSERT dbo.Pagamentos ON");
        foreach (var p in dados.Pagamentos)
            Executar(c, t, """
                INSERT dbo.Pagamentos (Id, ClienteId, Data, Valor, Meses, PeriodoAte, Referencia, Anulado, MotivoAnulacao, RegistadoPor, RegistadoEmUtc)
                VALUES (@id, @c, @d, @v, @m, @ate, @ref, @an, @mot, @por, @em)
                """, ("@id", p.Id), ("@c", p.ClienteId), ("@d", p.Data), ("@v", p.Valor), ("@m", p.Meses), ("@ate", p.PeriodoAte), ("@ref", p.Referencia),
                ("@an", p.Anulado), ("@mot", p.MotivoAnulacao), ("@por", por), ("@em", DateTime.UtcNow));
        Executar(c, t, "SET IDENTITY_INSERT dbo.Pagamentos OFF");
        foreach (var l in dados.Licencas)
            InserirLicenca(c, t, l, por);
        foreach (var d in dados.Desbloqueios)
            InserirDesbloqueio(c, t, d, por);
        foreach (var h in dados.Historico.OrderBy(h => h.DataUtc))
            Registar(c, t, h.ClienteId, h.Acao, h.Detalhe, h.DataUtc, h.Utilizador);
        Registar(c, t, null, "Dados migrados", $"{dados.Clientes.Count} clientes, {dados.Pagamentos.Count} pagamentos, {dados.Licencas.Count} licenças de {Path.GetFileName(caminho)}");
        t.Commit();
        return dados.Clientes.Count;
    }

    public string Copia()
    {
        using var c = Abrir();
        var pasta = Escalar(c, null, "SELECT CAST(COALESCE(SERVERPROPERTY('InstanceDefaultBackupPath'), SERVERPROPERTY('InstanceDefaultDataPath')) AS nvarchar(400))") as string
            ?? throw new InvalidOperationException("Não encontrei a pasta de cópias do SQL Server.");
        var ficheiro = Path.Combine(pasta, $"{NomeBase}-{DateTime.Now:yyyyMMdd-HHmmss}.bak");
        using (var cmd = Comando(c, null, $"BACKUP DATABASE [{NomeBase}] TO DISK = @f WITH COPY_ONLY, INIT, CHECKSUM", [("@f", ficheiro)]))
        {
            cmd.CommandTimeout = 600;
            cmd.ExecuteNonQuery();
        }
        Registar(c, null, null, "Cópia da base", ficheiro);
        return ficheiro;
    }

    internal void ApagarBaseDeTestes()
    {
        if (!NomeBase.EndsWith("_Testes", StringComparison.Ordinal))
            throw new InvalidOperationException("Só se apagam bases de testes (nome terminado em _Testes).");
        SqlConnection.ClearAllPools();
        using var c = new SqlConnection(ligacaoMaster);
        c.Open();
        Executar(c, null, $"IF DB_ID('{NomeBase}') IS NOT NULL BEGIN ALTER DATABASE [{NomeBase}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{NomeBase}]; END");
    }
}
