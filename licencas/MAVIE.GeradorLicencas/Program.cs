using System.Globalization;
using System.Text.Json;

namespace Mavie.GeradorLicencas;

internal static class Program
{
    private const string Titulo = "MAVIE-HGest — Gerador de licenças";
    private const string PedidoSenhaRepor = "Palavra-passe da cópia:";
    private const string TextoChaveReposta = "Chave reposta. Este computador já pode emitir licenças.";
    private const string TextoPrimeiraUtilizacao =
        "Este computador ainda não tem a chave de assinatura das licenças.\n\n" +
        "Sim — repor a partir de uma cópia de segurança (.pem).\n" +
        "Não — criar uma chave NOVA (só se for a primeira vez: o sistema MAVIE-HGest tem de ser compilado com a nova chave pública, " +
        "e as licenças assinadas com outra chave deixam de servir).";

    [STAThread]
    private static int Main(string[] args)
    {
        var pasta = ArmazemLicencas.PastaPadrao;
        if (args is ["--pasta", var p, .. var resto])
        {
            pasta = p;
            args = resto;
        }
        LigacaoBase? ligacaoFixa = null;
        if (args is ["--ligacao", var instancia, var nomeBase, .. var seguintes])
        {
            ligacaoFixa = new LigacaoBase(instancia, nomeBase);
            args = seguintes;
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
                case ["--captura", var imagem] when ligacaoFixa is not null:
                    Captura(armazem, ligacaoFixa, imagem, hoje);
                    return 0;
                case ["--migrar", var ficheiro] when ligacaoFixa is not null:
                {
                    var b = new BaseLicencas(ligacaoFixa);
                    b.Preparar();
                    Console.WriteLine(b.MigrarFicheiro(ficheiro));
                    return 0;
                }
                case ["--copia-base"] when ligacaoFixa is not null:
                    Console.WriteLine(new BaseLicencas(ligacaoFixa).Copia());
                    return 0;
                case ["--apagar-base-testes"] when ligacaoFixa is not null:
                    new BaseLicencas(ligacaoFixa).ApagarBaseDeTestes();
                    return 0;
                case []:
                    break;
                default:
                    return 2;
            }
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException or IOException or FormatException or Microsoft.Data.SqlClient.SqlException)
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
        if (AbrirBase(armazem.Pasta, ligacaoFixa) is not { } baseLicencas)
            return 0;
        try
        {
            var antigo = Path.Combine(armazem.Pasta, BaseLicencas.FicheiroAntigo);
            if (File.Exists(antigo) && baseLicencas.Vazia)
            {
                var n = baseLicencas.MigrarFicheiro(antigo);
                File.Move(antigo, antigo + ".migrado", overwrite: true);
                MessageBox.Show($"Os dados de {n} clientes passaram do ficheiro para a base {baseLicencas.NomeBase} do SQL Server.\n\n" +
                    $"O ficheiro antigo ficou como {BaseLicencas.FicheiroAntigo}.migrado.", Titulo, MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            else if (!baseLicencas.TemLicencas && File.Exists(armazem.RegistoLinhaComandos) && armazem.ChaveDoSistema)
            {
                var n = baseLicencas.ImportarLinhaComandos(armazem);
                if (n > 0)
                    MessageBox.Show($"{n} licenças emitidas pela linha de comandos foram importadas.\n\nPreencha em cada cliente o plano e o valor por mês.",
                        Titulo, MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException or InvalidOperationException or Microsoft.Data.SqlClient.SqlException)
        {
            MessageBox.Show("Não consegui passar os dados para a base: " + BaseLicencas.ExplicarErro(ex), Titulo, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        Application.Run(new JanelaPrincipal(armazem, baseLicencas));
        return 0;
    }

    private static BaseLicencas? AbrirBase(string pasta, LigacaoBase? fixa)
    {
        var ligacao = fixa ?? LigacaoBase.Ler(pasta);
        string? erro = null;
        while (true)
        {
            if (ligacao is null || erro is not null)
            {
                if (fixa is not null)
                {
                    MessageBox.Show(erro, Titulo, MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return null;
                }
                ligacao = Dialogos.Ligacao(null, ligacao, erro);
                if (ligacao is null)
                    return null;
            }
            try
            {
                var b = new BaseLicencas(ligacao);
                b.Preparar();
                if (fixa is null)
                    ligacao.Gravar(pasta);
                return b;
            }
            catch (Exception ex) when (ex is Microsoft.Data.SqlClient.SqlException or InvalidOperationException or ArgumentException
                or System.Security.Cryptography.CryptographicException or IOException)
            {
                erro = BaseLicencas.ExplicarErro(ex);
            }
        }
    }

    private static bool PrimeiraUtilizacao(ArmazemLicencas armazem)
    {
        var resposta = MessageBox.Show(TextoPrimeiraUtilizacao, Titulo, MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question);
        try
        {
            if (resposta == DialogResult.Yes)
            {
                using var dialogo = new OpenFileDialog { Filter = "Cópia da chave (*.pem)|*.pem" };
                if (dialogo.ShowDialog() != DialogResult.OK || Palavra.Pedir(null, PedidoSenhaRepor, false) is not { } senha)
                    return false;
                armazem.ImportarCopia(dialogo.FileName, senha);
                MessageBox.Show(TextoChaveReposta, Titulo, MessageBoxButtons.OK, MessageBoxIcon.Information);
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

    private static void Captura(ArmazemLicencas armazem, LigacaoBase ligacao, string imagem, DateOnly hoje)
    {
        ApplicationConfiguration.Initialize();
        if (!armazem.TemChave)
            armazem.CriarChave();
        var dados = new BaseLicencas(ligacao);
        dados.Preparar();
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
        Fotografar("-ligacao", () => Dialogos.Ligacao(null, null, null));
        Fotografar("-senha-exportar", () => Palavra.Pedir(null, JanelaPrincipal.PedidoSenhaExportar, true));
        Fotografar("-senha-repor", () => Palavra.Pedir(null, PedidoSenhaRepor, false));
        void FotografarMensagem(string sufixo, Action abrir)
        {
            using var relogio = new System.Windows.Forms.Timer { Interval = 900 };
            relogio.Tick += (_, _) =>
            {
                relogio.Stop();
                var janela = Nativo.FindWindow("#32770", Titulo);
                if (janela == IntPtr.Zero || !Nativo.GetWindowRect(janela, out var r))
                    return;
                using var bmp = new Bitmap(r.Direita - r.Esquerda, r.Fundo - r.Topo);
                using (var g = Graphics.FromImage(bmp))
                {
                    var dc = g.GetHdc();
                    Nativo.PrintWindow(janela, dc, 2);
                    g.ReleaseHdc(dc);
                }
                bmp.Save(Path.ChangeExtension(imagem, null) + sufixo + ".png", System.Drawing.Imaging.ImageFormat.Png);
                Nativo.PostMessage(janela, 0x0010, IntPtr.Zero, IntPtr.Zero);
            };
            relogio.Start();
            abrir();
        }
        FotografarMensagem("-primeira", () => MessageBox.Show(TextoPrimeiraUtilizacao, Titulo, MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question));
        FotografarMensagem("-reposta", () => MessageBox.Show(TextoChaveReposta, Titulo, MessageBoxButtons.OK, MessageBoxIcon.Information));
    }

    private static class Nativo
    {
        [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
        public struct Retangulo { public int Esquerda, Topo, Direita, Fundo; }

        [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
        public static extern IntPtr FindWindow(string classe, string titulo);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr janela, out Retangulo r);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        public static extern bool PrintWindow(IntPtr janela, IntPtr dc, uint opcoes);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        public static extern bool PostMessage(IntPtr janela, uint mensagem, IntPtr w, IntPtr l);
    }
}
