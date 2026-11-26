using System.Text.Json;
using System.Text.Json.Serialization;

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
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true, Converters = { new JsonStringEnumConverter() } };
    private FicheiroLicencas dados;

    public BaseLicencas(string pasta)
    {
        Pasta = pasta;
        Directory.CreateDirectory(pasta);
        dados = File.Exists(Caminho)
            ? JsonSerializer.Deserialize<FicheiroLicencas>(File.ReadAllText(Caminho), Json) ?? new FicheiroLicencas()
            : new FicheiroLicencas();
    }

    public string Pasta { get; }
    public string Caminho => Path.Combine(Pasta, "clientes-licencas.json");
    public bool TemLicencas => dados.Licencas.Count > 0;

    private void Gravar()
    {
        var temporario = Caminho + ".tmp";
        File.WriteAllText(temporario, JsonSerializer.Serialize(dados, Json));
        if (File.Exists(Caminho))
            File.Replace(temporario, Caminho, Caminho + ".anterior");
        else
            File.Move(temporario, Caminho);
    }

    private int NovoId() => dados.ProximoId++;

    private void Registar(int clienteId, string acao, string detalhe) =>
        dados.Historico.Add(new EventoHistorico { DataUtc = DateTime.UtcNow, ClienteId = clienteId, Acao = acao, Detalhe = detalhe, Utilizador = Environment.UserName });

    private Cliente Obter(int id) => dados.Clientes.FirstOrDefault(c => c.Id == id) ?? throw new InvalidOperationException("Cliente não encontrado.");

    private ClienteResumo Resumo(Cliente c) => new(c.Id, c.Nome, c.Nuit, c.Contacto, c.Plano, c.ValorMensal, c.Estado, c.Observacoes,
        dados.Licencas.Where(l => l.ClienteId == c.Id).Select(l => (DateOnly?)l.ValidaAte).Max(),
        dados.Pagamentos.Where(p => p.ClienteId == c.Id && !p.Anulado).Select(p => (DateOnly?)p.Data).Max());

    public IReadOnlyList<ClienteResumo> Clientes() => [.. dados.Clientes.OrderBy(c => c.Nome, StringComparer.CurrentCultureIgnoreCase).Select(Resumo)];

    public ClienteResumo Cliente(int id) => Resumo(Obter(id));

    public IReadOnlyList<PagamentoRegisto> Pagamentos(int id) => [.. dados.Pagamentos.Where(p => p.ClienteId == id).OrderByDescending(p => p.Data).ThenByDescending(p => p.Id)];

    public IReadOnlyList<LicencaRegisto> Licencas(int id) => [.. dados.Licencas.Where(l => l.ClienteId == id).OrderByDescending(l => l.EmitidaEmUtc)];

    public IReadOnlyList<EventoHistorico> Historico(int id) => [.. dados.Historico.Where(h => h.ClienteId == id).OrderByDescending(h => h.DataUtc)];

    private static string Limpo(string? texto) => (texto ?? "").Trim();

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
        if (dados.Clientes.Any(c => c.Nuit == nuit))
            throw new InvalidOperationException($"Já existe um cliente com o NUIT {nuit}.");
        var cliente = new Cliente
        {
            Id = NovoId(), Nome = Limpo(nome), Nuit = nuit, Contacto = NuloSeVazio(contacto), Plano = plano, ValorMensal = valorMensal,
            Observacoes = NuloSeVazio(observacoes), CriadoEmUtc = DateTime.UtcNow,
        };
        dados.Clientes.Add(cliente);
        Registar(cliente.Id, "Cliente criado", $"{cliente.Nome} · NUIT {nuit} · {cliente.Plano} · {RegrasCobranca.Valor(valorMensal)} por mês");
        Gravar();
        return cliente.Id;
    }

    private static string? NuloSeVazio(string? texto) => string.IsNullOrWhiteSpace(texto) ? null : texto.Trim();

    public void AlterarCliente(int id, string nome, string? contacto, Plano plano, decimal valorMensal, string? observacoes)
    {
        ValidarDados(nome, valorMensal);
        var c = Obter(id);
        var mudancas = new List<string>();
        if (c.Nome != Limpo(nome)) mudancas.Add($"nome «{c.Nome}» → «{Limpo(nome)}»");
        if (c.Plano != plano) mudancas.Add($"plano {c.Plano} → {plano}");
        if (c.ValorMensal != valorMensal) mudancas.Add($"valor {RegrasCobranca.Valor(c.ValorMensal)} → {RegrasCobranca.Valor(valorMensal)}");
        c.Nome = Limpo(nome);
        c.Contacto = NuloSeVazio(contacto);
        c.Plano = plano;
        c.ValorMensal = valorMensal;
        c.Observacoes = NuloSeVazio(observacoes);
        Registar(id, "Cliente alterado", mudancas.Count == 0 ? "Contacto ou observações" : string.Join("; ", mudancas));
        Gravar();
    }

    public void MudarEstado(int id, EstadoCliente estado, string motivo)
    {
        var c = Obter(id);
        if (c.Estado == EstadoCliente.Cancelado)
            throw new InvalidOperationException("O contrato deste cliente está cancelado.");
        c.Estado = estado;
        Registar(id, estado switch { EstadoCliente.Suspenso => "Suspenso", EstadoCliente.Cancelado => "Contrato cancelado", _ => "Reativado" }, motivo);
        Gravar();
    }

    private void ExigirAtivo(Cliente c)
    {
        if (c.Estado != EstadoCliente.Ativo)
            throw new InvalidOperationException(c.Estado == EstadoCliente.Suspenso
                ? "Este cliente está suspenso: reative-o antes de emitir licenças."
                : "O contrato deste cliente está cancelado: não se emitem licenças.");
    }

    private LicencaRegisto GuardarLicenca(ArmazemLicencas armazem, Cliente c, DateOnly ate, DateOnly hoje, int? pagamentoId, string? observacoes)
    {
        var (licenca, texto) = armazem.Emitir(c.Nome, c.Nuit, ate, hoje);
        var registo = new LicencaRegisto
        {
            LicencaId = licenca.Id, ClienteId = c.Id, EmitidaEm = hoje, ValidaAte = ate, Texto = texto, PagamentoId = pagamentoId,
            Observacoes = observacoes, EmitidaEmUtc = DateTime.UtcNow,
        };
        dados.Licencas.Add(registo);
        return registo;
    }

    public (PagamentoRegisto Pagamento, LicencaRegisto? Licenca) RegistarPagamento(ArmazemLicencas armazem, int id, DateOnly data, decimal valor, int meses, string? referencia, DateOnly hoje)
    {
        var c = Obter(id);
        ExigirAtivo(c);
        if (data > hoje)
            throw new ArgumentException("A data do pagamento não pode ser futura.");
        if (valor <= 0)
            throw new ArgumentException("Indique o valor recebido.");
        var ate = RegrasCobranca.NovaValidade(Resumo(c).ValidaAte, data, meses);
        var pagamento = new PagamentoRegisto
        {
            Id = NovoId(), ClienteId = id, Data = data, Valor = valor, Meses = meses, PeriodoAte = ate, Referencia = NuloSeVazio(referencia),
        };
        LicencaRegisto? licenca = null;
        if (ate >= hoje)
            licenca = GuardarLicenca(armazem, c, ate, hoje, pagamento.Id, null);
        dados.Pagamentos.Add(pagamento);
        Registar(id, "Pagamento", $"{RegrasCobranca.Valor(valor)} · {meses} mês(es) · até {RegrasCobranca.Data(ate)}" +
            (pagamento.Referencia is null ? "" : $" · {pagamento.Referencia}") + (licenca is null ? " · sem licença (período já terminado)" : " · licença emitida"));
        Gravar();
        return (pagamento, licenca);
    }

    public void AnularPagamento(int pagamentoId, string motivo)
    {
        var p = dados.Pagamentos.FirstOrDefault(x => x.Id == pagamentoId) ?? throw new InvalidOperationException("Pagamento não encontrado.");
        if (p.Anulado)
            throw new InvalidOperationException("Este pagamento já está anulado.");
        p.Anulado = true;
        p.MotivoAnulacao = motivo;
        Registar(p.ClienteId, "Pagamento anulado", $"{RegrasCobranca.Valor(p.Valor)} de {RegrasCobranca.Data(p.Data)} · {motivo}");
        Gravar();
    }

    public LicencaRegisto EmitirSemPagamento(ArmazemLicencas armazem, int id, DateOnly ate, string motivo, DateOnly hoje)
    {
        var c = Obter(id);
        ExigirAtivo(c);
        if (ate <= hoje)
            throw new ArgumentException("A licença tem de valer pelo menos até amanhã.");
        var licenca = GuardarLicenca(armazem, c, ate, hoje, null, motivo);
        Registar(id, "Licença sem pagamento", $"Até {RegrasCobranca.Data(ate)} · {motivo}");
        Gravar();
        return licenca;
    }

    public DesbloqueioRegisto EmitirDesbloqueio(ArmazemLicencas armazem, int id, string pedido, string motivo, DateOnly hoje)
    {
        var c = Obter(id);
        pedido = Limpo(pedido);
        if (!pedido.StartsWith(c.Nuit + "-", StringComparison.Ordinal))
            throw new ArgumentException($"O pedido tem de começar pelo NUIT deste cliente ({c.Nuit}-).");
        var (dadosCodigo, texto) = armazem.EmitirDesbloqueio(pedido, hoje);
        var registo = new DesbloqueioRegisto
        {
            Id = dadosCodigo.Id, ClienteId = id, Pedido = pedido, ValidoAte = hoje.AddDays(ArmazemLicencas.DiasDesbloqueio), Texto = texto, Motivo = motivo,
            EmitidoEmUtc = DateTime.UtcNow,
        };
        dados.Desbloqueios.Add(registo);
        Registar(id, "Desbloqueio do relógio", $"Pedido {pedido} · {motivo}");
        Gravar();
        return registo;
    }

    public int ImportarLinhaComandos(ArmazemLicencas armazem)
    {
        if (!File.Exists(armazem.RegistoLinhaComandos))
            return 0;
        using var documento = JsonDocument.Parse(File.ReadAllText(armazem.RegistoLinhaComandos));
        var importadas = 0;
        foreach (var e in documento.RootElement.EnumerateArray())
        {
            string? Texto(string nome) => e.TryGetProperty(nome, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
            if (Texto("type") != "licenca" || Texto("id") is not { } licencaId || Texto("nuit") is not { } nuit || Texto("validUntil") is not { } ate
                || Texto("issuedAt") is not { } emitida || dados.Licencas.Any(l => l.LicencaId == licencaId))
                continue;
            var nome = Texto("name") ?? nuit;
            var cliente = dados.Clientes.FirstOrDefault(c => c.Nuit == nuit);
            if (cliente is null)
            {
                cliente = new Cliente { Id = NovoId(), Nome = nome, Nuit = nuit, CriadoEmUtc = DateTime.UtcNow, Observacoes = "Importado do registo da linha de comandos." };
                dados.Clientes.Add(cliente);
                Registar(cliente.Id, "Cliente importado", "Do registo da linha de comandos (registo.json)");
            }
            var validaAte = DateOnly.ParseExact(ate, "yyyy-MM-dd");
            var emitidaEm = DateOnly.ParseExact(emitida, "yyyy-MM-dd");
            var (_, texto) = armazem.Emitir(nome, nuit, validaAte, emitidaEm, licencaId, emitidaEm);
            dados.Licencas.Add(new LicencaRegisto
            {
                LicencaId = licencaId, ClienteId = cliente.Id, EmitidaEm = emitidaEm, ValidaAte = validaAte, Texto = texto,
                Observacoes = string.IsNullOrWhiteSpace(Texto("motivo")) ? "Importada da linha de comandos" : Texto("motivo"),
                EmitidaEmUtc = DateTime.TryParse(Texto("at"), null, System.Globalization.DateTimeStyles.AdjustToUniversal, out var em) ? em : DateTime.UtcNow,
            });
            Registar(cliente.Id, "Licença importada", $"Até {RegrasCobranca.Data(validaAte)}");
            importadas++;
        }
        if (importadas > 0)
            Gravar();
        return importadas;
    }

    public string Copia(string pasta)
    {
        var destino = Path.Combine(pasta, $"mavie-licencas-{DateTime.Now:yyyyMMdd-HHmm}.json");
        File.Copy(Caminho, destino, overwrite: false);
        return destino;
    }
}
