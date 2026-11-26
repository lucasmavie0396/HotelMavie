using System.Globalization;
using System.Text.Json;

namespace Mavie.GeradorLicencas;

internal static class Program
{
    private const string Titulo = "MAVIE-HGest — Gerador de licenças";

    [STAThread]
    private static int Main(string[] args)
    {
        var pasta = ArmazemLicencas.PastaPadrao;
        if (args is ["--pasta", var p, .. var resto])
        {
            pasta = p;
            args = resto;
        }
        var armazem = new ArmazemLicencas(pasta, args is ["--captura", ..] or ["--sem-sistema", ..] ? null : ArmazemLicencas.PublicaEmbutida());
        if (args is ["--sem-sistema", .. var depois])
            args = depois;
        var hoje = DateOnly.FromDateTime(DateTime.Today);
        try
        {
            switch (args)
            {
                case ["--criar-chave", var ficheiro]:
                    File.WriteAllText(ficheiro, armazem.CriarChave());
                    return 0;
                case ["--chave-publica", var ficheiro]:
                    if (!armazem.TemChave)
                        return 3;
                    File.WriteAllText(ficheiro, armazem.ChavePublica());
                    return 0;
                case ["--emitir", var nome, var nuit, var ate, var ficheiro]:
                    File.WriteAllText(ficheiro, armazem.Emitir(nome, nuit, DateOnly.ParseExact(ate, "yyyy-MM-dd", CultureInfo.InvariantCulture), hoje).Texto);
                    return 0;
                case ["--desbloquear", var pedido, var ficheiro]:
                    File.WriteAllText(ficheiro, armazem.EmitirDesbloqueio(pedido, hoje).Texto);
                    return 0;
                case ["--exportar", var ficheiro, var senha]:
                    armazem.ExportarCopia(ficheiro, senha);
                    return 0;
                case ["--importar", var ficheiro, var senha]:
                    armazem.ImportarCopia(ficheiro, senha);
                    return 0;
                case ["--captura", var imagem]:
                    Captura(armazem, imagem, hoje);
                    return 0;
                case []:
                    break;
                default:
                    return 2;
            }
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException or IOException or FormatException)
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }

        ApplicationConfiguration.Initialize();
        if (!armazem.TemChave && !PrimeiraUtilizacao(armazem))
            return 0;
        if (!armazem.ChaveDoSistema)
            MessageBox.Show("A chave deste computador NÃO é a do sistema MAVIE-HGest: o gerador vai recusar emitir licenças.\n\n" +
                "Feche, apague a pasta de dados (menu Abrir pasta de dados) e reponha a cópia de segurança certa ao voltar a abrir.",
                Titulo, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        BaseLicencas baseLicencas;
        try
        {
            baseLicencas = new BaseLicencas(armazem.Pasta);
            if (!baseLicencas.TemLicencas && File.Exists(armazem.RegistoLinhaComandos) && armazem.ChaveDoSistema)
            {
                var n = baseLicencas.ImportarLinhaComandos(armazem);
                if (n > 0)
                    MessageBox.Show($"{n} licenças emitidas pela linha de comandos foram importadas.\n\nPreencha em cada cliente o plano e o valor por mês.",
                        Titulo, MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException or InvalidOperationException)
        {
            MessageBox.Show("Não consegui abrir os dados das licenças: " + ex.Message, Titulo, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        Application.Run(new JanelaPrincipal(armazem, baseLicencas));
        return 0;
    }

    private static bool PrimeiraUtilizacao(ArmazemLicencas armazem)
    {
        var resposta = MessageBox.Show(
            "Este computador ainda não tem a chave de assinatura das licenças.\n\n" +
            "Sim — repor a partir de uma cópia de segurança (.pem).\n" +
            "Não — criar uma chave NOVA (só se for a primeira vez: o sistema MAVIE-HGest tem de ser compilado com a nova chave pública, " +
            "e as licenças assinadas com outra chave deixam de servir).",
            Titulo, MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question);
        try
        {
            if (resposta == DialogResult.Yes)
            {
                using var dialogo = new OpenFileDialog { Filter = "Cópia da chave (*.pem)|*.pem" };
                if (dialogo.ShowDialog() != DialogResult.OK || Palavra.Pedir(null, "Palavra-passe da cópia:", false) is not { } senha)
                    return false;
                armazem.ImportarCopia(dialogo.FileName, senha);
                MessageBox.Show("Chave reposta. Este computador já pode emitir licenças.", Titulo, MessageBoxButtons.OK, MessageBoxIcon.Information);
                return true;
            }
            if (resposta == DialogResult.No)
            {
                if (MessageBox.Show("Criar uma chave NOVA? As licenças já emitidas e os sistemas já instalados deixam de reconhecer as licenças novas " +
                        "até o sistema ser compilado com a nova chave pública.", Titulo, MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes)
                    return false;
                var publica = armazem.CriarChave();
                Clipboard.SetText(publica);
                MessageBox.Show("Chave criada. A chave pública foi copiada: grave-a em backend\\src\\license\\public-key.ts (ou corra " +
                    "\"node licencas/gerar-licenca.mjs publica\"), volte a gerar o gerador e o instalador e publique o sistema.\n\n" +
                    "Faça já uma cópia de segurança (menu Chave).", Titulo, MessageBoxButtons.OK, MessageBoxIcon.Information);
                return true;
            }
        }
        catch (InvalidOperationException ex)
        {
            MessageBox.Show(ex.Message, Titulo, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        return false;
    }

    private static void Captura(ArmazemLicencas armazem, string imagem, DateOnly hoje)
    {
        ApplicationConfiguration.Initialize();
        if (!armazem.TemChave)
            armazem.CriarChave();
        var dados = new BaseLicencas(armazem.Pasta);
        var sol = dados.CriarCliente("Hotel Sol Nascente", "400123456", "84 000 0000", Plano.Mensal, 2500m, null);
        dados.RegistarPagamento(armazem, sol, hoje.AddMonths(-1), 2500m, 1, "M-Pesa 1", hoje);
        dados.RegistarPagamento(armazem, sol, hoje, 2500m, 1, "M-Pesa 2", hoje);
        var mare = dados.CriarCliente("Pousada Maré Alta", "400765432", null, Plano.Trimestral, 3000m, null);
        dados.EmitirSemPagamento(armazem, mare, hoje.AddDays(1), "Período de teste", hoje);
        var lua = dados.CriarCliente("Lodge Lua Cheia", "400111222", null, Plano.Mensal, 2000m, null);
        dados.EmitirSemPagamento(armazem, lua, hoje.AddDays(5), "Período de teste", hoje);
        dados.MudarEstado(lua, EstadoCliente.Suspenso, "Falta de pagamento");
        using var janela = new JanelaPrincipal(armazem, dados) { StartPosition = FormStartPosition.Manual, Location = new Point(-3000, -3000), ShowInTaskbar = false };
        janela.Show();
        janela.SelecionarPrimeiro();
        foreach (var (separador, sufixo) in new[] { (0, ""), (1, "-pagamentos"), (2, "-licencas"), (3, "-historico") })
        {
            janela.MostrarSeparador(separador);
            Application.DoEvents();
            using var bmp = new Bitmap(janela.Width, janela.Height);
            janela.DrawToBitmap(bmp, new Rectangle(Point.Empty, janela.Size));
            bmp.Save(Path.ChangeExtension(imagem, null) + sufixo + ".png", System.Drawing.Imaging.ImageFormat.Png);
        }
        void Fotografar(string sufixo, Action abrir)
        {
            using var relogio = new System.Windows.Forms.Timer { Interval = 700 };
            relogio.Tick += (_, _) =>
            {
                relogio.Stop();
                if (Application.OpenForms.Cast<Form>().LastOrDefault() is not { } f)
                    return;
                using var bmp = new Bitmap(f.Width, f.Height);
                f.DrawToBitmap(bmp, new Rectangle(Point.Empty, f.Size));
                bmp.Save(Path.ChangeExtension(imagem, null) + sufixo + ".png", System.Drawing.Imaging.ImageFormat.Png);
                f.DialogResult = DialogResult.Cancel;
            };
            relogio.Start();
            abrir();
        }
        var exemplo = dados.Cliente(sol);
        Fotografar("-pagamento", () => Dialogos.Pagamento(null, exemplo));
        Fotografar("-desbloqueio", () => Dialogos.Desbloqueio(null, exemplo));
        Fotografar("-sem-pagamento", () => Dialogos.SemPagamento(null, exemplo));
    }
}
