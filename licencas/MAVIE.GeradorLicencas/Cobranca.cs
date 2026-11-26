using System.Globalization;

namespace Mavie.GeradorLicencas;

public enum Plano { Mensal = 1, Trimestral = 3, Semestral = 6, Anual = 12 }

public enum EstadoCliente { Ativo, Suspenso, Cancelado }

public enum Situacao { SemLicenca, EmDia, AVencer, EmAtraso, Suspenso, Cancelado }

public static class RegrasCobranca
{
    public const int DiasToleranciaSistema = 7;
    public const int DiasAVencer = 7;

    public static DateOnly NovaValidade(DateOnly? validaAteAtual, DateOnly dataPagamento, int meses)
    {
        if (meses is < 1 or > 36)
            throw new ArgumentException("Indique de 1 a 36 meses.");
        var inicio = validaAteAtual is { } v && v.AddDays(DiasToleranciaSistema) >= dataPagamento ? v : dataPagamento;
        return inicio.AddMonths(meses);
    }

    public static Situacao SituacaoDe(EstadoCliente estado, DateOnly? validaAte, DateOnly hoje) => estado switch
    {
        EstadoCliente.Suspenso => Situacao.Suspenso,
        EstadoCliente.Cancelado => Situacao.Cancelado,
        _ when validaAte is null => Situacao.SemLicenca,
        _ when validaAte < hoje => Situacao.EmAtraso,
        _ when validaAte.Value.DayNumber - hoje.DayNumber <= DiasAVencer => Situacao.AVencer,
        _ => Situacao.EmDia,
    };

    public static string Descrever(Situacao s, DateOnly? validaAte, DateOnly hoje) => s switch
    {
        Situacao.SemLicenca => "Sem licença",
        Situacao.Suspenso => "Suspenso",
        Situacao.Cancelado => "Cancelado",
        Situacao.EmAtraso when hoje.DayNumber - validaAte!.Value.DayNumber is var d =>
            d <= DiasToleranciaSistema
                ? $"Em atraso há {Dias(d)} (bloqueia dentro de {Dias(DiasToleranciaSistema - d + 1)})"
                : $"Em atraso há {Dias(d)} (sistema bloqueado)",
        Situacao.AVencer => validaAte!.Value == hoje ? "Vence hoje" : $"Vence em {Dias(validaAte.Value.DayNumber - hoje.DayNumber)}",
        _ => "Em dia",
    };

    private static string Dias(int n) => n == 1 ? "1 dia" : $"{n} dias";

    public static decimal ValorSugerido(decimal valorMensal, int meses) => decimal.Round(valorMensal * meses, 2);

    public static string Data(DateOnly d) => d.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);

    public static string Mensagem(string nome, DateOnly validaAte, string licenca) =>
        $"Olá. Segue a licença do sistema MAVIE-HGest para {nome}, válida até {Data(validaAte)}.\n" +
        "Para ativar: no sistema, Configuração → Sistema e licença → cole o texto abaixo (todo) → Ativar licença.\n\n" + licenca;

    public static string MensagemDesbloqueio(string pedido, DateOnly validoAte, string codigo) =>
        $"Código de desbloqueio do relógio do sistema MAVIE-HGest (pedido {pedido}, válido até {Data(validoAte)}, uma só vez).\n" +
        "Confirme primeiro que a data e a hora do servidor estão certas e, no sistema, Configuração → Sistema e licença → " +
        "Desbloquear → cole o código abaixo.\n\n" + codigo;

    public static bool LerValor(string texto, out decimal valor)
    {
        var t = texto.Replace(" ", "").Replace(" ", "").Replace(',', '.');
        return decimal.TryParse(t, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out valor) && valor >= 0 && decimal.Round(valor, 2) == valor;
    }

    public static string Valor(decimal v) => v.ToString("#,##0.00", CultureInfo.GetCultureInfo("pt-PT")) + " MT";
}
