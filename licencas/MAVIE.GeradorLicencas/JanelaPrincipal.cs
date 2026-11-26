using System.Globalization;
using System.Text.Json;

namespace Mavie.GeradorLicencas;

public sealed class JanelaPrincipal : Form
{
    private readonly ArmazemLicencas armazem;
    private readonly BaseLicencas base_;
    private readonly TextBox pesquisa = new() { PlaceholderText = "Pesquisar nome ou NUIT…", Dock = DockStyle.Top };
    private readonly ComboBox filtro = new() { DropDownStyle = ComboBoxStyle.DropDownList, Dock = DockStyle.Top };
    private readonly ListView clientes = Lista(("Cliente", 175), ("NUIT", 92), ("Plano", 88), ("Válida até", 98), ("Situação", 290));
    private readonly Label resumo = new() { Dock = DockStyle.Bottom, Height = 28, TextAlign = ContentAlignment.MiddleLeft, ForeColor = Color.FromArgb(71, 85, 105) };

    private readonly TextBox nome = new() { Width = 360, MaxLength = 150 };
    private readonly TextBox nuit = new() { Width = 140, MaxLength = 9 };
    private readonly TextBox contacto = new() { Width = 320, MaxLength = 200, PlaceholderText = "Telefone, e-mail…" };
    private readonly ComboBox plano = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 140 };
    private readonly TextBox valorMensal = new() { Width = 140, MaxLength = 20, PlaceholderText = "ex.: 2500,00" };
    private readonly TextBox observacoes = new() { Width = 320, MaxLength = 1000, Multiline = true, Height = 54 };
    private readonly Label situacao = new() { AutoSize = true, MaximumSize = new Size(520, 0), Font = new Font("Segoe UI", 10.5f, FontStyle.Bold), Margin = new Padding(0, 4, 0, 8) };
    private readonly Button guardarCliente = Botao("Guardar cliente");
    private readonly Button novoCliente = Botao("Novo cliente");
    private readonly Button suspender = Botao("Suspender", ativo: false);
    private readonly Button cancelar = Botao("Cancelar contrato", ativo: false);

    private readonly ListView pagamentos = Lista(("Data", 90), ("Valor", 110), ("Meses", 55), ("Pago até", 90), ("Referência", 140), ("Estado", 160));
    private readonly Button registarPagamento = Botao("Registar pagamento…", ativo: false);
    private readonly Button anularPagamento = Botao("Anular pagamento…", ativo: false);

    private readonly ListView licencas = Lista(("Emitida", 90), ("Válida até", 90), ("Origem", 170), ("Licença", 250));
    private readonly TextBox texto = new() { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Height = 110, Dock = DockStyle.Bottom, Font = new Font("Consolas", 9f) };
    private readonly Button copiarMensagem = Botao("Copiar mensagem para o cliente", ativo: false);
    private readonly Button copiar = Botao("Copiar só a licença", ativo: false);
    private readonly Button guardar = Botao("Guardar ficheiro .lic…", ativo: false);
    private readonly Button semPagamento = Botao("Emitir sem pagamento…", ativo: false);
    private readonly Button desbloquear = Botao("Desbloquear relógio…", ativo: false);

    private readonly ListView historico = Lista(("Data", 130), ("Ação", 140), ("Detalhe", 380), ("Utilizador", 140));
    private readonly TabControl separadores = new() { Dock = DockStyle.Fill };
    private readonly Label estado = new() { Dock = DockStyle.Bottom, Height = 28, TextAlign = ContentAlignment.MiddleLeft, ForeColor = Color.FromArgb(71, 85, 105) };

    private ClienteResumo? atual;
    private LicencaRegisto? licencaMostrada;

    private static Button Botao(string texto, bool ativo = true) =>
        new() { Text = texto, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Padding = new Padding(10, 4, 10, 4), MinimumSize = new Size(100, 34), Enabled = ativo };

    public JanelaPrincipal(ArmazemLicencas armazem, BaseLicencas baseLicencas)
    {
        this.armazem = armazem;
        base_ = baseLicencas;
        Text = "MAVIE-HGest — Licenças e cobrança";
        Font = new Font("Segoe UI", 9.75f);
        ClientSize = new Size(1420, 780);
        MinimumSize = new Size(1300, 700);
        StartPosition = FormStartPosition.CenterScreen;
        if (Environment.ProcessPath is { } exe && Icon.ExtractAssociatedIcon(exe) is { } icone)
            Icon = icone;

        var menu = new MenuStrip();
        var menuDados = new ToolStripMenuItem("Dados");
        menuDados.DropDownItems.Add("Cópia de segurança dos dados…", null, (_, _) => CopiaDados());
        menuDados.DropDownItems.Add("Importar o registo da linha de comandos (registo.json)", null, (_, _) => ImportarRegisto());
        var chave = new ToolStripMenuItem("Chave");
        chave.DropDownItems.Add("Ver chave pública", null, (_, _) => VerChavePublica());
        chave.DropDownItems.Add("Exportar cópia de segurança…", null, (_, _) => ExportarCopia());
        menu.Items.AddRange([menuDados, chave, new ToolStripMenuItem("Abrir pasta de dados", null, (_, _) => System.Diagnostics.Process.Start("explorer.exe", armazem.Pasta))]);
        MainMenuStrip = menu;

        filtro.Items.AddRange(["Todos os clientes", "Em atraso", "A vencer (7 dias)", "Suspensos", "Sem licença", "Cancelados"]);
        filtro.SelectedIndex = 0;
        var esquerda = new Panel { Dock = DockStyle.Left, Width = 770, Padding = new Padding(12) };
        clientes.Dock = DockStyle.Fill;
        esquerda.Controls.AddRange([clientes, resumo, new Panel { Dock = DockStyle.Top, Height = 6 }, filtro, new Panel { Dock = DockStyle.Top, Height = 6 }, pesquisa,
            new Label { Text = "Clientes", Dock = DockStyle.Top, Height = 26, Font = new Font(Font, FontStyle.Bold) }]);
        clientes.BringToFront();

        separadores.TabPages.Add(PaginaCliente());
        separadores.TabPages.Add(PaginaPagamentos());
        separadores.TabPages.Add(PaginaLicencas());
        var paginaHistorico = new TabPage("Histórico") { Padding = new Padding(8) };
        historico.Dock = DockStyle.Fill;
        paginaHistorico.Controls.Add(historico);
        separadores.TabPages.Add(paginaHistorico);
        var direita = new Panel { Dock = DockStyle.Fill, Padding = new Padding(0, 12, 12, 0) };
        direita.Controls.AddRange([separadores, estado]);

        Controls.Add(direita);
        Controls.Add(esquerda);
        Controls.Add(menu);

        pesquisa.TextChanged += (_, _) => CarregarLista();
        filtro.SelectedIndexChanged += (_, _) => CarregarLista();
        clientes.SelectedIndexChanged += (_, _) => { if (clientes.SelectedItems.Count > 0 && clientes.SelectedItems[0].Tag is ClienteResumo c) Selecionar(c.Id); };
        Limpar();
        CarregarLista();
    }

    private static DateOnly Hoje => DateOnly.FromDateTime(DateTime.Today);
    private static string Data(DateOnly? d) => d is { } v ? RegrasCobranca.Data(v) : "—";

    private static void Ajustar(ListView l)
    {
        if (l.Items.Count == 0)
            return;
        for (var i = 0; i < l.Columns.Count; i++)
        {
            l.AutoResizeColumn(i, ColumnHeaderAutoResizeStyle.ColumnContent);
            var conteudo = l.Columns[i].Width;
            l.AutoResizeColumn(i, ColumnHeaderAutoResizeStyle.HeaderSize);
            l.Columns[i].Width = Math.Max(conteudo, l.Columns[i].Width) + 6;
        }
    }

    private static ListView Lista(params (string Titulo, int Largura)[] colunas)
    {
        var l = new ListView { View = View.Details, FullRowSelect = true, MultiSelect = false, HideSelection = false, GridLines = true };
        foreach (var (titulo, largura) in colunas)
            l.Columns.Add(titulo, largura);
        return l;
    }

    private static string NomePlano(Plano p) => p switch
    {
        Plano.Mensal => "Mensal", Plano.Trimestral => "Trimestral", Plano.Semestral => "Semestral", _ => "Anual",
    };

    private TabPage PaginaCliente()
    {
        foreach (var p in Enum.GetValues<Plano>())
            plano.Items.Add(NomePlano(p));
        plano.SelectedIndex = 0;
        nuit.KeyPress += (_, e) => e.Handled = !char.IsControl(e.KeyChar) && !char.IsAsciiDigit(e.KeyChar);

        var pagina = new TabPage("Cliente") { Padding = new Padding(12) };
        var tabela = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, AutoScroll = true };
        tabela.Controls.Add(situacao);
        var campos = new TableLayoutPanel { AutoSize = true, ColumnCount = 2 };
        void Campo(string rotulo, Control c)
        {
            campos.Controls.Add(new Label { Text = rotulo, AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(0, 8, 10, 4) });
            campos.Controls.Add(c);
        }
        Campo("Nome comercial", nome);
        Campo("NUIT", nuit);
        Campo("Contacto", contacto);
        Campo("Plano", plano);
        Campo("Valor por mês (MT)", valorMensal);
        Campo("Observações", observacoes);
        tabela.Controls.Add(campos);
        var botoes = new FlowLayoutPanel { AutoSize = true, Margin = new Padding(0, 12, 0, 0) };
        botoes.Controls.AddRange([guardarCliente, novoCliente, suspender, cancelar]);
        tabela.Controls.Add(botoes);
        tabela.Controls.Add(new Label
        {
            AutoSize = true, MaximumSize = new Size(580, 0), ForeColor = Color.FromArgb(71, 85, 105), Margin = new Padding(0, 14, 0, 0),
            Text = "O NUIT tem de ser igual ao do hotel no sistema (Configuração → Dados fiscais). Suspender: o gerador deixa de emitir licenças " +
                   "para este cliente. A licença que ele já tem vale até à data dela; depois, ao fim de " +
                   $"{RegrasCobranca.DiasToleranciaSistema} dias de tolerância, o sistema bloqueia as vendas e gravações (a consulta e os relatórios " +
                   "continuam). Não é possível retirar uma licença já emitida antes da data.",
        });
        pagina.Controls.Add(tabela);

        guardarCliente.Click += (_, _) => GuardarCliente();
        novoCliente.Click += (_, _) => Limpar();
        suspender.Click += (_, _) => Suspender();
        cancelar.Click += (_, _) => Cancelar();
        return pagina;
    }

    private TabPage PaginaPagamentos()
    {
        var pagina = new TabPage("Pagamentos") { Padding = new Padding(8) };
        pagamentos.Dock = DockStyle.Fill;
        var barra = new FlowLayoutPanel { Dock = DockStyle.Bottom, AutoSize = true, Padding = new Padding(0, 6, 0, 0) };
        barra.Controls.AddRange([registarPagamento, anularPagamento]);
        pagina.Controls.AddRange([pagamentos, barra]);
        registarPagamento.Click += (_, _) => RegistarPagamento();
        anularPagamento.Click += (_, _) => AnularPagamento();
        pagamentos.SelectedIndexChanged += (_, _) =>
            anularPagamento.Enabled = pagamentos.SelectedItems.Count > 0 && pagamentos.SelectedItems[0].Tag is PagamentoRegisto { Anulado: false };
        return pagina;
    }

    private TabPage PaginaLicencas()
    {
        var pagina = new TabPage("Licenças") { Padding = new Padding(8) };
        licencas.Dock = DockStyle.Fill;
        var barra = new FlowLayoutPanel { Dock = DockStyle.Bottom, AutoSize = true, Padding = new Padding(0, 6, 0, 0) };
        barra.Controls.AddRange([copiarMensagem, copiar, guardar, semPagamento, desbloquear]);
        pagina.Controls.AddRange([licencas, texto, barra]);
        licencas.SelectedIndexChanged += (_, _) =>
        {
            if (licencas.SelectedItems.Count > 0 && licencas.SelectedItems[0].Tag is LicencaRegisto l)
                MostrarLicenca(l);
        };
        copiarMensagem.Click += (_, _) =>
        {
            if (licencaMostrada is null || atual is null) return;
            Clipboard.SetText(RegrasCobranca.Mensagem(atual.Nome, licencaMostrada.ValidaAte, licencaMostrada.Texto));
            estado.Text = "Mensagem copiada: cole-a no WhatsApp ou no e-mail do cliente.";
        };
        copiar.Click += (_, _) => { if (licencaMostrada is not null) { Clipboard.SetText(licencaMostrada.Texto); estado.Text = "Licença copiada."; } };
        guardar.Click += (_, _) => GuardarFicheiro();
        semPagamento.Click += (_, _) => EmitirSemPagamento();
        desbloquear.Click += (_, _) => Desbloquear();
        return pagina;
    }

    private bool Tentar(Action acao)
    {
        try
        {
            acao();
            return true;
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException)
        {
            MessageBox.Show(this, ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        {
            MessageBox.Show(this, "Erro ao gravar os dados: " + ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        return false;
    }

    private static bool Passa(int indice, ClienteResumo c) => indice switch
    {
        1 => RegrasCobranca.SituacaoDe(c.Estado, c.ValidaAte, Hoje) == Situacao.EmAtraso,
        2 => RegrasCobranca.SituacaoDe(c.Estado, c.ValidaAte, Hoje) == Situacao.AVencer,
        3 => c.Estado == EstadoCliente.Suspenso,
        4 => RegrasCobranca.SituacaoDe(c.Estado, c.ValidaAte, Hoje) == Situacao.SemLicenca,
        5 => c.Estado == EstadoCliente.Cancelado,
        _ => true,
    };

    private static Color Cor(Situacao s) => s switch
    {
        Situacao.EmAtraso => Color.Firebrick,
        Situacao.AVencer => Color.DarkOrange,
        Situacao.Suspenso or Situacao.Cancelado => Color.Gray,
        _ => SystemColors.WindowText,
    };

    private void CarregarLista()
    {
        var todos = base_.Clientes();
        var procura = pesquisa.Text.Trim();
        clientes.BeginUpdate();
        clientes.Items.Clear();
        foreach (var c in todos.Where(c => Passa(filtro.SelectedIndex, c) && (procura.Length == 0
                     || c.Nome.Contains(procura, StringComparison.CurrentCultureIgnoreCase) || c.Nuit.Contains(procura, StringComparison.Ordinal))))
        {
            var s = RegrasCobranca.SituacaoDe(c.Estado, c.ValidaAte, Hoje);
            var item = new ListViewItem([c.Nome, c.Nuit, NomePlano(c.Plano), Data(c.ValidaAte), RegrasCobranca.Descrever(s, c.ValidaAte, Hoje)])
                { Tag = c, ForeColor = Cor(s) };
            clientes.Items.Add(item);
            if (atual?.Id == c.Id)
                item.Selected = true;
        }
        Ajustar(clientes);
        clientes.EndUpdate();
        var ativos = todos.Where(c => c.Estado == EstadoCliente.Ativo).ToList();
        int Conta(Situacao s) => ativos.Count(c => RegrasCobranca.SituacaoDe(c.Estado, c.ValidaAte, Hoje) == s);
        resumo.Text = $"{ativos.Count} ativos · {Conta(Situacao.EmAtraso)} em atraso · {Conta(Situacao.AVencer)} a vencer · " +
                      $"{todos.Count(c => c.Estado == EstadoCliente.Suspenso)} suspensos · receita mensal {RegrasCobranca.Valor(ativos.Sum(c => c.ValorMensal))}";
    }

    internal void SelecionarPrimeiro()
    {
        if (clientes.Items.Count > 0)
            clientes.Items[0].Selected = true;
    }

    internal void MostrarSeparador(int i) => separadores.SelectedIndex = i;

    private void Selecionar(int id)
    {
        ClienteResumo? c = null;
        IReadOnlyList<PagamentoRegisto> ps = [];
        IReadOnlyList<LicencaRegisto> ls = [];
        IReadOnlyList<EventoHistorico> hs = [];
        if (!Tentar(() => { c = base_.Cliente(id); ps = base_.Pagamentos(id); ls = base_.Licencas(id); hs = base_.Historico(id); }) || c is null)
            return;
        atual = c;
        nome.Text = c.Nome;
        nuit.Text = c.Nuit;
        nuit.ReadOnly = true;
        contacto.Text = c.Contacto ?? "";
        plano.SelectedIndex = Array.IndexOf(Enum.GetValues<Plano>(), c.Plano);
        valorMensal.Text = c.ValorMensal.ToString("0.00", CultureInfo.GetCultureInfo("pt-PT"));
        observacoes.Text = c.Observacoes ?? "";
        var s = RegrasCobranca.SituacaoDe(c.Estado, c.ValidaAte, Hoje);
        situacao.Text = $"{RegrasCobranca.Descrever(s, c.ValidaAte, Hoje)} · licença válida até {Data(c.ValidaAte)} · último pagamento {Data(c.UltimoPagamento)}";
        situacao.ForeColor = Cor(s);
        var ativo = c.Estado == EstadoCliente.Ativo;
        suspender.Enabled = c.Estado != EstadoCliente.Cancelado;
        suspender.Text = ativo ? "Suspender" : "Reativar";
        cancelar.Enabled = c.Estado != EstadoCliente.Cancelado;
        registarPagamento.Enabled = semPagamento.Enabled = ativo;
        desbloquear.Enabled = true;

        pagamentos.Items.Clear();
        anularPagamento.Enabled = false;
        foreach (var p in ps)
            pagamentos.Items.Add(new ListViewItem([RegrasCobranca.Data(p.Data), RegrasCobranca.Valor(p.Valor), p.Meses.ToString(CultureInfo.InvariantCulture),
                RegrasCobranca.Data(p.PeriodoAte), p.Referencia ?? "", p.Anulado ? $"Anulado: {p.MotivoAnulacao}" : "Válido"])
                { Tag = p, ForeColor = p.Anulado ? Color.Gray : SystemColors.WindowText });

        licencas.Items.Clear();
        texto.Text = "";
        licencaMostrada = null;
        copiar.Enabled = copiarMensagem.Enabled = guardar.Enabled = false;
        foreach (var l in ls)
        {
            var aceite = armazem.AceiteNoSistema(l.Texto);
            licencas.Items.Add(new ListViewItem([RegrasCobranca.Data(l.EmitidaEm), RegrasCobranca.Data(l.ValidaAte),
                l.PagamentoId is int p ? $"Pagamento {p}" : l.Observacoes ?? "Sem pagamento", l.LicencaId + (aceite ? "" : "  (inválida: outra chave)")])
                { Tag = l, ForeColor = aceite ? SystemColors.WindowText : Color.Firebrick });
        }
        Ajustar(pagamentos);
        Ajustar(licencas);
        if (ls.Count > 0)
            MostrarLicenca(ls[0]);

        historico.Items.Clear();
        foreach (var h in hs)
            historico.Items.Add(new ListViewItem([h.DataUtc.ToLocalTime().ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture), h.Acao, h.Detalhe, h.Utilizador]));
        Ajustar(historico);
        estado.Text = "";
    }

    private void MostrarLicenca(LicencaRegisto l)
    {
        licencaMostrada = l;
        texto.Text = l.Texto;
        copiar.Enabled = copiarMensagem.Enabled = guardar.Enabled = true;
    }

    private void Limpar()
    {
        atual = null;
        clientes.SelectedItems.Clear();
        nome.Text = nuit.Text = contacto.Text = observacoes.Text = valorMensal.Text = texto.Text = "";
        nuit.ReadOnly = false;
        plano.SelectedIndex = 0;
        situacao.Text = "Novo cliente: preencha os dados e carregue em «Guardar cliente».";
        situacao.ForeColor = SystemColors.ControlText;
        suspender.Enabled = cancelar.Enabled = registarPagamento.Enabled = anularPagamento.Enabled = semPagamento.Enabled = desbloquear.Enabled = false;
        copiar.Enabled = copiarMensagem.Enabled = guardar.Enabled = false;
        pagamentos.Items.Clear();
        licencas.Items.Clear();
        historico.Items.Clear();
        licencaMostrada = null;
        separadores.SelectedIndex = 0;
        estado.Text = "";
        nome.Focus();
    }

    private void GuardarCliente()
    {
        if (!RegrasCobranca.LerValor(valorMensal.Text, out var valor))
        {
            MessageBox.Show(this, "Indique o valor por mês (ex.: 2500 ou 2500,50).", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        var p = Enum.GetValues<Plano>()[plano.SelectedIndex];
        var id = atual?.Id;
        if (!Tentar(() =>
            {
                if (id is int existente)
                    base_.AlterarCliente(existente, nome.Text, contacto.Text, p, valor, observacoes.Text);
                else
                    id = base_.CriarCliente(nome.Text, nuit.Text, contacto.Text, p, valor, observacoes.Text);
            }))
            return;
        atual = base_.Cliente(id!.Value);
        CarregarLista();
        Selecionar(id.Value);
        estado.Text = "Cliente guardado. Registe o pagamento para emitir a licença.";
    }

    private void Suspender()
    {
        if (atual is null)
            return;
        var novo = atual.Estado == EstadoCliente.Ativo ? EstadoCliente.Suspenso : EstadoCliente.Ativo;
        var motivo = Dialogos.Texto(this, novo == EstadoCliente.Suspenso ? $"Suspender «{atual.Nome}»" : $"Reativar «{atual.Nome}»",
            novo == EstadoCliente.Suspenso
                ? "Motivo (ex.: falta de pagamento de novembro). O gerador deixa de emitir licenças para este cliente."
                : "Motivo da reativação (ex.: pagamento em atraso regularizado).");
        if (motivo is null || !Tentar(() => base_.MudarEstado(atual.Id, novo, motivo)))
            return;
        CarregarLista();
        Selecionar(atual.Id);
        estado.Text = novo == EstadoCliente.Suspenso ? "Cliente suspenso." : "Cliente reativado: já pode registar o pagamento.";
    }

    private void Cancelar()
    {
        if (atual is null)
            return;
        var motivo = Dialogos.Texto(this, $"Cancelar o contrato de «{atual.Nome}»", "Motivo do cancelamento (o cliente deixa de receber licenças; os registos ficam).");
        if (motivo is null || !Tentar(() => base_.MudarEstado(atual.Id, EstadoCliente.Cancelado, motivo)))
            return;
        CarregarLista();
        Selecionar(atual.Id);
    }

    private void RegistarPagamento()
    {
        if (atual is null)
            return;
        var dados = Dialogos.Pagamento(this, atual);
        if (dados is null)
            return;
        var id = atual.Id;
        LicencaRegisto? licenca = null;
        PagamentoRegisto? pagamento = null;
        if (!Tentar(() => (pagamento, licenca) = base_.RegistarPagamento(armazem, id, dados.Value.Data, dados.Value.Valor, dados.Value.Meses, dados.Value.Referencia, Hoje)))
            return;
        CarregarLista();
        Selecionar(id);
        if (licenca is null)
        {
            separadores.SelectedIndex = 1;
            estado.Text = $"Pagamento registado (período já terminado, até {RegrasCobranca.Data(pagamento!.PeriodoAte)}): não foi emitida licença.";
            return;
        }
        separadores.SelectedIndex = 2;
        Clipboard.SetText(RegrasCobranca.Mensagem(atual.Nome, licenca.ValidaAte, licenca.Texto));
        estado.Text = $"Pagamento registado; licença válida até {RegrasCobranca.Data(licenca.ValidaAte)} emitida e mensagem copiada: cole-a no WhatsApp ou e-mail do cliente.";
    }

    private void AnularPagamento()
    {
        if (atual is null || pagamentos.SelectedItems.Count == 0 || pagamentos.SelectedItems[0].Tag is not PagamentoRegisto p)
            return;
        var motivo = Dialogos.Texto(this, "Anular pagamento",
            $"Anular o pagamento de {RegrasCobranca.Valor(p.Valor)} de {RegrasCobranca.Data(p.Data)}? Fica registado como anulado.\n" +
            $"A licença já emitida com ele (até {RegrasCobranca.Data(p.PeriodoAte)}) continua a valer no cliente até essa data.\n\nMotivo:");
        if (motivo is null || !Tentar(() => base_.AnularPagamento(p.Id, motivo)))
            return;
        Selecionar(atual.Id);
        estado.Text = "Pagamento anulado.";
    }

    private void Desbloquear()
    {
        if (atual is null || Dialogos.Desbloqueio(this, atual) is not { } dados)
            return;
        DesbloqueioRegisto? codigo = null;
        var id = atual.Id;
        if (!Tentar(() => codigo = base_.EmitirDesbloqueio(armazem, id, dados.Pedido, dados.Motivo, Hoje)))
            return;
        Selecionar(id);
        Clipboard.SetText(RegrasCobranca.MensagemDesbloqueio(codigo!.Pedido, codigo.ValidoAte, codigo.Texto));
        estado.Text = "Código de desbloqueio copiado: cole-o no WhatsApp ou no e-mail do cliente.";
    }

    private void EmitirSemPagamento()
    {
        if (atual is null)
            return;
        var dados = Dialogos.SemPagamento(this, atual);
        if (dados is null)
            return;
        LicencaRegisto? l = null;
        if (!Tentar(() => l = base_.EmitirSemPagamento(armazem, atual.Id, dados.Value.ValidaAte, dados.Value.Motivo, Hoje)))
            return;
        CarregarLista();
        Selecionar(atual.Id);
        separadores.SelectedIndex = 2;
        Clipboard.SetText(RegrasCobranca.Mensagem(atual.Nome, l!.ValidaAte, l.Texto));
        estado.Text = $"Licença válida até {RegrasCobranca.Data(l.ValidaAte)} emitida e mensagem copiada.";
    }

    private void GuardarFicheiro()
    {
        if (licencaMostrada is null || atual is null)
            return;
        using var dialogo = new SaveFileDialog
        {
            Filter = "Licença MAVIE-HGest (*.lic)|*.lic",
            FileName = $"licenca-{atual.Nuit}-{licencaMostrada.ValidaAte:yyyyMMdd}.lic",
        };
        if (dialogo.ShowDialog(this) == DialogResult.OK)
        {
            File.WriteAllText(dialogo.FileName, licencaMostrada.Texto);
            estado.Text = "Ficheiro guardado: " + dialogo.FileName;
        }
    }

    private void CopiaDados()
    {
        using var d = new FolderBrowserDialog { Description = "Pasta para a cópia dos clientes e licenças (ex.: pen USB)" };
        if (d.ShowDialog(this) != DialogResult.OK)
            return;
        var ficheiro = "";
        if (Tentar(() => ficheiro = base_.Copia(d.SelectedPath)))
            MessageBox.Show(this, $"Cópia gravada em:\n{ficheiro}\n\nGuarde-a fora deste computador.", Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    private void ImportarRegisto()
    {
        var n = 0;
        if (Tentar(() => n = base_.ImportarLinhaComandos(armazem)))
        {
            CarregarLista();
            MessageBox.Show(this, n == 0 ? "Nada a importar: o registo da linha de comandos já está todo aqui." : $"{n} licenças importadas. Preencha em cada cliente o plano e o valor por mês.",
                Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }

    private void VerChavePublica() =>
        MessageBox.Show(this, "Chave pública (a que vai no sistema MAVIE-HGest, em backend\\src\\license\\public-key.ts):\n\n" + armazem.ChavePublica(), Text,
            MessageBoxButtons.OK, MessageBoxIcon.Information);

    private void ExportarCopia()
    {
        var senha = Palavra.Pedir(this, "Palavra-passe da cópia (mín. 10 caracteres). Guarde-a em lugar seguro: sem ela a cópia não serve.", confirmar: true);
        if (senha is null)
            return;
        using var dialogo = new SaveFileDialog { Filter = "Cópia da chave (*.pem)|*.pem", FileName = "mavie-chave-licencas.pem" };
        if (dialogo.ShowDialog(this) != DialogResult.OK)
            return;
        if (Tentar(() => armazem.ExportarCopia(dialogo.FileName, senha)))
            MessageBox.Show(this, "Cópia guardada. Guarde o ficheiro fora deste computador (ex.: pen USB num cofre).", Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
    }
}
