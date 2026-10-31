# Agente de impressão MAVIE-HGest

Pequeno programa que corre em cada computador da receção, do bar ou da cozinha. Permite ao MAVIE-HGest:

- listar as impressoras instaladas no Windows (incluindo impressoras partilhadas `\\PC\Impressora`);
- imprimir talões (58 mm e 80 mm, ESC/POS) diretamente, sem janela de impressão.

Os documentos em A4 continuam a abrir na janela de impressão do navegador.

## Requisitos

- Windows 10/11 ou Windows Server 2016+
- Node.js 18 ou superior
- Impressora térmica compatível com ESC/POS instalada no Windows (USB, rede ou partilhada)

Não tem dependências: não é preciso `npm install`.

## Arrancar

```bat
iniciar.cmd
```

O agente escuta apenas em `http://127.0.0.1:9123`, por isso só é acessível a partir do próprio computador.

## Configuração

| Variável | Predefinição | Descrição |
|---|---|---|
| `PRINT_AGENT_PORT` | `9123` | Porta local |
| `PRINT_AGENT_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Endereços do MAVIE-HGest autorizados a imprimir (separados por vírgulas). Em produção, acrescente o domínio, por exemplo `https://hgest.exemplo.co.mz`. |

Pedidos vindos de outros sites são recusados.

## Arrancar com o Windows

1. `Win + R` → `shell:startup`
2. Crie um atalho para `iniciar.cmd` nessa pasta.

## Usar no MAVIE-HGest

Em **Configuração → Impressoras**, escolha a ligação **Instalada neste computador**. A lista mostra as impressoras do Windows; escolha a impressora, o papel e use **Testar**.

O talão sai pela impressora com esse nome no computador onde o documento é emitido. Se a cozinha imprimir a partir de vários postos, instale (ou partilhe) a impressora da cozinha com o mesmo nome em todos eles.

Para a cozinha e o bar imprimirem no seu próprio posto, abra o **Ecrã cozinha/bar** nesse computador e ligue **Imprimir pedidos novos neste ecrã**. Na impressora da cozinha/bar use **Saída = Impressora**; com **Saída = PDF** o talão só aparece no ecrã.

## Ambiente de Trabalho Remoto (RDP)

Quando o MAVIE-HGest é usado por Ligação ao Ambiente de Trabalho Remoto, o agente corre no servidor e só vê as impressoras redirecionadas da sessão:

1. Instale a térmica no Windows do computador local (o PC da cozinha ou do bar).
2. Na Ligação ao Ambiente de Trabalho Remoto: **Mostrar opções → Recursos locais → Impressoras** ativado.
3. Volte a ligar. A térmica aparece no servidor como `Nome (redirecionado N)`.

O número `N` muda a cada ligação. O MAVIE-HGest guarda o nome sem esse sufixo e o agente encontra a impressora em qualquer sessão.
