using System.Globalization;

namespace Mavie.GeradorLicencas;

internal static class Dialogos
{
    private static Form Janela(string titulo, int largura, int altura) => new()
    {
        Text = titulo, FormBorderStyle = FormBorderStyle.FixedDialog, StartPosition = FormStartPosition.CenterParent, MinimizeBox = false, MaximizeBox = false,
        ClientSize = new Size(largura, altura), Font = new Font("Segoe UI", 9.75f), ShowInTaskbar = false,
    };

    private static void Botoes(Form f, int y)
    {
        var ok = new Button { Text = "OK", DialogResult = DialogResult.OK, Location = new Point(f.ClientSize.Width - 184, y), Width = 80, Height = 30 };
        var cancelar = new Button { Text = "Cancelar", DialogResult = DialogResult.Cancel, Location = new Point(f.ClientSize.Width - 96, y), Width = 84, Height = 30 };
        f.Controls.AddRange([ok, cancelar]);
        f.AcceptButton = ok;
        f.CancelButton = cancelar;
    }

    private static Label Rotulo(string texto, int x, int y, int largura = 170) =>
        new() { Text = texto, Location = new Point(x, y + 4), Size = new Size(largura, 22) };

    public static string? Texto(IWin32Window? dono, string titulo, string mensagem)
    {
        using var f = Janela(titulo, 520, 210);
        var m = new Label { Text = mensagem, Location = new Point(12, 12), Size = new Size(496, 90) };
        var t = new TextBox { Location = new Point(12, 110), Width = 496, MaxLength = 500 };
        f.Controls.AddRange([m, t]);
        Botoes(f, 160);
        while (f.ShowDialog(dono) == DialogResult.OK)
        {
            if (t.Text.Trim().Length >= 3)
                return t.Text.Trim();
            MessageBox.Show(f, "Indique o motivo (pelo menos 3 caracteres).", titulo, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        return null;
    }

    public static (DateOnly Data, decimal Valor, int Meses, string? Referencia)? Pagamento(IWin32Window? dono, ClienteResumo cliente)
    {
        using var f = Janela($"Pagamento de «{cliente.Nome}»", 520, 290);
        var data = new DateTimePicker { Location = new Point(190, 12), Width = 150, Format = DateTimePickerFormat.Short, MaxDate = DateTime.Today, Value = DateTime.Today };
        var meses = new NumericUpDown { Location = new Point(190, 48), Width = 80, Minimum = 1, Maximum = 36, Value = (int)cliente.Plano };
        var valor = new TextBox { Location = new Point(190, 84), Width = 150 };
        var referencia = new TextBox { Location = new Point(190, 120), Width = 310, MaxLength = 100, PlaceholderText = "M-Pesa, transferência, recibo…" };
        var previsao = new Label { Location = new Point(12, 162), Size = new Size(496, 60), Font = new Font("Segoe UI", 9.75f, FontStyle.Bold) };
        f.Controls.AddRange([Rotulo("Data do pagamento", 12, 12), data, Rotulo("Meses pagos", 12, 48), meses, Rotulo("Valor recebido (MT)", 12, 84), valor,
            Rotulo("Referência", 12, 120), referencia, previsao]);
        Botoes(f, 240);

        var valorEditado = false;
        string Sugerido() => RegrasCobranca.ValorSugerido(cliente.ValorMensal, (int)meses.Value).ToString("0.00", CultureInfo.GetCultureInfo("pt-PT"));
        valor.Text = Sugerido();
        valor.TextChanged += (_, _) => valorEditado = valor.Focused;
        void Atualizar()
        {
            if (!valorEditado)
                valor.Text = Sugerido();
            var ate = RegrasCobranca.NovaValidade(cliente.ValidaAte, DateOnly.FromDateTime(data.Value), (int)meses.Value);
            previsao.Text = $"A licença fica válida até {RegrasCobranca.Data(ate)}" +
                            (cliente.ValidaAte is { } v ? $" (a atual vale até {RegrasCobranca.Data(v)})." : ".");
        }
        meses.ValueChanged += (_, _) => Atualizar();
        data.ValueChanged += (_, _) => Atualizar();
        Atualizar();

        while (f.ShowDialog(dono) == DialogResult.OK)
        {
            if (RegrasCobranca.LerValor(valor.Text, out var v) && v > 0)
                return (DateOnly.FromDateTime(data.Value), v, (int)meses.Value, string.IsNullOrWhiteSpace(referencia.Text) ? null : referencia.Text.Trim());
            MessageBox.Show(f, "Indique o valor recebido (ex.: 2500 ou 2500,50).", f.Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        return null;
    }

    public static (string Pedido, string Motivo)? Desbloqueio(IWin32Window? dono, ClienteResumo cliente)
    {
        using var f = Janela($"Desbloquear relógio — «{cliente.Nome}»", 540, 250);
        var pedido = new TextBox { Location = new Point(190, 12), Width = 330, Text = cliente.Nuit + "-", PlaceholderText = "NUIT-AAAAMMDDHHmm" };
        var motivo = new TextBox { Location = new Point(190, 48), Width = 330, MaxLength = 500, PlaceholderText = "ex.: relógio adiantado por engano em 30/11" };
        var aviso = new Label { Location = new Point(12, 88), Size = new Size(516, 100), ForeColor = Color.FromArgb(71, 85, 105),
            Text = "Use só quando o cliente se enganou na data (relógio adiantado e depois acertado) e o sistema mostra «relógio atrasado». " +
                   "Confirme primeiro com o cliente que a data do servidor já está certa. O pedido aparece no aviso do sistema e em " +
                   $"Configuração → Sistema e licença. O código vale {ArmazemLicencas.DiasDesbloqueio} dias e uma só vez." };
        f.Controls.AddRange([Rotulo("Pedido do cliente", 12, 12), pedido, Rotulo("Motivo", 12, 48), motivo, aviso]);
        Botoes(f, 205);
        while (f.ShowDialog(dono) == DialogResult.OK)
        {
            if (motivo.Text.Trim().Length >= 3 && FormatoLicenca.PedidoValido(pedido.Text.Trim()))
                return (pedido.Text.Trim(), motivo.Text.Trim());
            MessageBox.Show(f, "Indique o pedido do cliente (NUIT-AAAAMMDDHHmm) e o motivo.", f.Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        return null;
    }

    public static LigacaoBase? Ligacao(IWin32Window? dono, LigacaoBase? atual, string? erro)
    {
        using var f = Janela("Base de dados das licenças (SQL Server)", 560, 350);
        f.ShowInTaskbar = dono is null;
        var instancia = new ComboBox { Location = new Point(190, 12), Width = 350 };
        var locais = LigacaoBase.InstanciasLocais();
        instancia.Items.AddRange([.. locais]);
        instancia.Text = atual?.Instancia ?? locais.FirstOrDefault() ?? @".\SQLEXPRESS";
        var nomeBase = new TextBox { Location = new Point(190, 48), Width = 200, Text = atual?.Base ?? LigacaoBase.BasePadrao };
        var windows = new RadioButton { Text = "Autenticação do Windows", Location = new Point(190, 84), AutoSize = true };
        var sql = new RadioButton { Text = "Utilizador do SQL Server", Location = new Point(190, 110), AutoSize = true };
        var utilizador = new TextBox { Location = new Point(190, 140), Width = 200, Text = atual?.Utilizador ?? "sa" };
        var senha = new TextBox { Location = new Point(190, 176), Width = 200, UseSystemPasswordChar = true };
        var aviso = new Label
        {
            Location = new Point(12, 212), Size = new Size(536, 84),
            ForeColor = erro is null ? Color.FromArgb(71, 85, 105) : Color.FromArgb(185, 28, 28),
            Text = erro ?? "A base é criada na primeira ligação, com as tabelas dos clientes, pagamentos, licenças e histórico. " +
                   "A palavra-passe do SQL Server fica guardada cifrada pelo Windows, só para este utilizador.",
        };
        f.Controls.AddRange([Rotulo("Instância SQL Server", 12, 12), instancia, Rotulo("Nome da base", 12, 48), nomeBase, Rotulo("Entrar com", 12, 84),
            windows, sql, Rotulo("Utilizador", 12, 140), utilizador, Rotulo("Palavra-passe", 12, 176), senha, aviso]);
        Botoes(f, 308);
        void Atualizar() => utilizador.Enabled = senha.Enabled = sql.Checked;
        windows.CheckedChanged += (_, _) => Atualizar();
        sql.CheckedChanged += (_, _) => Atualizar();
        (string.IsNullOrWhiteSpace(atual?.Utilizador) ? windows : sql).Checked = true;
        Atualizar();
        while (f.ShowDialog(dono) == DialogResult.OK)
        {
            try
            {
                BaseLicencas.ValidarNome(nomeBase.Text);
                if (string.IsNullOrWhiteSpace(instancia.Text))
                    throw new ArgumentException("Indique a instância do SQL Server.");
                if (windows.Checked)
                    return new LigacaoBase(instancia.Text.Trim(), nomeBase.Text.Trim());
                if (string.IsNullOrWhiteSpace(utilizador.Text))
                    throw new ArgumentException("Indique o utilizador do SQL Server.");
                if (senha.Text.Length == 0 && atual?.Utilizador == utilizador.Text.Trim() && atual.SenhaCifrada is not null)
                    return atual with { Instancia = instancia.Text.Trim(), Base = nomeBase.Text.Trim() };
                return LigacaoBase.ComUtilizador(instancia.Text, nomeBase.Text, utilizador.Text, senha.Text);
            }
            catch (ArgumentException ex)
            {
                MessageBox.Show(f, ex.Message, f.Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }
        return null;
    }

    public static (DateOnly ValidaAte, string Motivo)? SemPagamento(IWin32Window? dono, ClienteResumo cliente)
    {
        using var f = Janela($"Licença sem pagamento — «{cliente.Nome}»", 520, 200);
        var ate = new DateTimePicker { Location = new Point(190, 12), Width = 150, Format = DateTimePickerFormat.Short, MinDate = DateTime.Today.AddDays(1), Value = DateTime.Today.AddDays(30) };
        var motivo = new TextBox { Location = new Point(190, 48), Width = 310, MaxLength = 500, PlaceholderText = "ex.: período de teste" };
        var aviso = new Label { Location = new Point(12, 88), Size = new Size(496, 50), ForeColor = Color.FromArgb(71, 85, 105),
            Text = "Use só para testes, ofertas ou contratos pagos por fora: fica no histórico como licença sem pagamento." };
        f.Controls.AddRange([Rotulo("Válida até", 12, 12), ate, Rotulo("Motivo", 12, 48), motivo, aviso]);
        Botoes(f, 150);
        while (f.ShowDialog(dono) == DialogResult.OK)
        {
            if (motivo.Text.Trim().Length >= 3)
                return (DateOnly.FromDateTime(ate.Value), motivo.Text.Trim());
            MessageBox.Show(f, "Indique o motivo.", f.Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        return null;
    }
}

internal static class Palavra
{
    public static string? Pedir(IWin32Window? dono, string mensagem, bool confirmar)
    {
        using var f = new Form { Text = "Palavra-passe", FormBorderStyle = FormBorderStyle.FixedDialog, StartPosition = FormStartPosition.CenterParent,
            MinimizeBox = false, MaximizeBox = false, ClientSize = new Size(420, confirmar ? 190 : 150), Font = new Font("Segoe UI", 9.75f), ShowInTaskbar = dono is null };
        var texto = new Label { Text = mensagem, Location = new Point(12, 12), Size = new Size(396, 44) };
        var a = new TextBox { UseSystemPasswordChar = true, Location = new Point(12, 60), Width = 396 };
        var b = new TextBox { UseSystemPasswordChar = true, Location = new Point(12, 96), Width = 396, PlaceholderText = "Confirmar" };
        var ok = new Button { Text = "OK", DialogResult = DialogResult.OK, Location = new Point(242, confirmar ? 146 : 106), Width = 80 };
        var cancelar = new Button { Text = "Cancelar", DialogResult = DialogResult.Cancel, Location = new Point(328, confirmar ? 146 : 106), Width = 80 };
        f.Controls.AddRange(confirmar ? [texto, a, b, ok, cancelar] : [texto, a, ok, cancelar]);
        f.AcceptButton = ok;
        f.CancelButton = cancelar;
        while (f.ShowDialog(dono) == DialogResult.OK)
        {
            if (confirmar && a.Text != b.Text)
            {
                MessageBox.Show(f, "As palavras-passe não coincidem.", f.Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                continue;
            }
            return a.Text;
        }
        return null;
    }
}
