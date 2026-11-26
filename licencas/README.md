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

## Comandos

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
