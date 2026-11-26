# Licenças do MAVIE-HGest

Gerador de licenças e de códigos de desbloqueio. Corre só no computador de quem vende o sistema e nunca vai no instalador.

## Como funciona

- A licença é um texto `MAVIE1.<dados>.<assinatura>`. Os dados são o nome comercial, o NUIT, a data de emissão e a data de fim (`--ate`). A assinatura é ECDSA P-256 / SHA-256.
- O sistema só tem a chave **pública** (`backend/src/license/public-key.ts`). Só verifica licenças: não as consegue criar.
- A chave **privada** fica em `%APPDATA%\MAVIE-HGest\Licencas\chave-privada.pem`, nunca no Git. Quem a tiver emite licenças para qualquer cliente.
- `registo.json`, na mesma pasta, guarda cada licença e código emitidos.

## No hotel (Configuração → Sistema e licença)

| Estado | O que acontece |
|---|---|
| Período de teste | 30 dias desde a instalação (os hotéis que já existiam também ganharam 30 dias). Funciona tudo. |
| Válida | Funciona tudo. |
| A terminar | Aviso no topo: 5 dias antes do fim, ou 15 em licenças com mais de 45 dias. |
| Tolerância | 7 dias depois do fim. Funciona tudo, com aviso. |
| Expirada / sem licença / inválida | Vendas e gravações bloqueadas. A consulta, os relatórios, as exportações e o login continuam. |
| Relógio atrasado | A data do servidor está mais de 36 h atrás da última utilização. Bloqueia até acertar a data ou até ser introduzido um código de desbloqueio. |

A licença é do NUIT do hotel (Configuração → Dados fiscais). Se o NUIT do hotel não for igual ao da licença, a licença não é aceite.

## Gerador com janela (MAVIE-Licencas.exe)

Igual ao do LAMGest. É um só ficheiro: não precisa de instalar nada (nem .NET nem Node).

- **Clientes:** um por NUIT, com plano (mensal, trimestral, semestral, anual), valor por mês e situação (em dia, a vencer, em atraso, suspenso, cancelado). Filtros e resumo da receita mensal.
- **Pagamentos:** cada pagamento emite a licença até ao fim do período pago. Pago antes do fim, ou dentro dos 7 dias de tolerância, continua a partir do fim do período anterior; pago depois, conta a partir da data do pagamento. A mensagem para o cliente (WhatsApp ou e-mail) fica copiada.
- **Licenças:** copiar mensagem, copiar só a licença, guardar `.lic`, emitir sem pagamento (teste, oferta) e desbloquear o relógio.
- **Suspender / cancelar:** o gerador deixa de emitir licenças a esse cliente. A licença já emitida vale até à data dela.
- **Histórico** de tudo o que foi feito em cada cliente, com o utilizador do Windows.
- Antes de entregar cada licença, confirma-a com a chave pública do sistema: uma chave errada neste computador nunca produz licenças que o sistema recusaria.

Os dados ficam em `%APPDATA%\MAVIE-HGest\Licencas\clientes-licencas.json` (com a versão anterior em `.anterior`). Menu **Dados → Cópia de segurança dos dados** grava uma cópia, por exemplo para uma pen. As licenças emitidas antes pela linha de comandos (`registo.json`) são importadas na primeira abertura, ou pelo menu Dados.

Gerar o `.exe` (precisa do .NET 9 SDK só no computador que compila):

```powershell
powershell -ExecutionPolicy Bypass -File licencas\criar-gerador.ps1
```

Fica em `licencas\publicar\MAVIE-Licencas.exe` (fora do Git). No fim, o script confirma que a chave deste computador é a do sistema.

### Levar o gerador para outro computador

1. Neste computador: menu **Chave → Exportar cópia de segurança** para uma pen (palavra-passe de 10 ou mais caracteres, guardada noutro sítio) e menu **Dados → Cópia de segurança dos dados**.
2. Copie também `MAVIE-Licencas.exe` para a pen.
3. No outro computador: abra o `MAVIE-Licencas.exe` e responda **Sim** (repor a partir de uma cópia). Escolha o `.pem` e escreva a palavra-passe. Nunca responda **Não**: cria uma chave nova que os sistemas instalados não aceitam.
4. Feche o gerador, copie a cópia dos dados para `%APPDATA%\MAVIE-HGest\Licencas\clientes-licencas.json` e volte a abrir.

A chave fica em `%APPDATA%`, por isso é por utilizador do Windows. A cópia `.pem` serve nos dois sentidos: o gerador com janela lê a da linha de comandos e vice-versa.

## Linha de comandos

Uma só vez, no computador de quem emite as licenças:

```powershell
node licencas/gerar-licenca.mjs chave
```

Emitir uma licença (copiar o texto e enviá-lo ao cliente, que o cola em Configuração → Sistema e licença):

```powershell
node licencas/gerar-licenca.mjs emitir --nome "Hotel X" --nuit 400123456 --ate 2027-12-31 --motivo "Pago M-Pesa ref. 123"
```

Desbloquear um sistema com o relógio atrasado (o cliente lê o pedido no ecrã):

```powershell
node licencas/gerar-licenca.mjs desbloquear --pedido 400123456-202612011030 --dias 3
```

Fazer uma cópia protegida da chave privada (fazer já, para uma pen ou outro disco):

```powershell
node licencas/gerar-licenca.mjs exportar --ficheiro E:\mavie-chave.pem --senha <senha>
```

Repor a chave num computador novo:

```powershell
node licencas/gerar-licenca.mjs importar --ficheiro E:\mavie-chave.pem --senha <senha>
```

`publica` mostra a chave pública. Só é preciso se a chave mudar; nesse caso todas as licenças antigas deixam de valer.
