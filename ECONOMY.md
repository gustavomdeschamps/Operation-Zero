# Economia ZERO CREDITS, loja e acabamentos

ZERO CREDITS (ZC) é a moeda **virtual** do OPERATION ZERO:

- não é comprada com dinheiro real;
- não tem valor em dinheiro;
- não pode ser transferida entre jogadores nem convertida em nada fora do jogo.

Não existem pagamentos, apostas nem trocas. Toda conta, saldo, sorteio e item é decidido e gravado
**no servidor**. O navegador só pede e exibe.

## Contas

- Na primeira conexão, o cliente pede `POST /api/account`.
  - O servidor gera um **token aleatório de 32 bytes**, guarda **apenas o hash SHA-256** e devolve o
    token uma única vez.
  - O navegador guarda o token em `localStorage` (`oz-account-token`).
- O token vai nas requisições (`Authorization: Bearer …`) e na entrada da sala (`accountToken`),
  onde o servidor o verifica.
  - O token nunca entra no estado replicado da partida.
  - A mesma conta não pode estar duas vezes na mesma sala.
- **Sem recuperação:** apagar os dados do navegador ou trocar de navegador cria uma conta nova.
  Não há e-mail nem senha.
- Criação limitada a 6 contas por hora por conexão, e as requisições da API também têm limite de
  taxa.
- Conta nova recebe **300 ZC de boas-vindas** (registrado como transação).

## Recompensas de partida (servidor)

Calculadas em `server/src/economy/economy.js` (`computeReward`) com os dados autoritativos da sala.
A configuração central fica em `server/src/economy/config.js`.

| Parcela | Valor |
|---|---|
| Conclusão (estar na sala no resultado) | **100** |
| Vitória | **+75** |
| Desempenho | 6 por eliminação de pessoa, 3 por eliminação de bot, +2 por tiro na cabeça — **máximo 50** |
| Objetivos (tático) | 20 por instalação, 25 por desarme — **máximo 50** |

**Regras contra abuso:**

- **Identificador único de conclusão:** `instância da sala : nº da partida : conta`. Repetir o
  pagamento devolve o mesmo resultado sem creditar de novo.
- **Abandono:** quem não está conectado no resultado não recebe nada, então terminar a partida é
  sempre melhor.
- **Inatividade:** é preciso jogar de fato (andar, atirar, pular ou interagir) por pelo menos
  45 s, ou 25% da duração da partida, o que for menor.
- **Partidas curtas** (ex.: o adversário saiu logo) rendem proporcionalmente até 180 s.
- **Teto diário** de 1 500 ZC por conta (dia UTC).
- Nenhum valor enviado pelo cliente entra no cálculo.

O servidor envia a recompensa ao jogador (`MSG.REWARD`) e a tela de pós-partida mostra cada parcela
e o novo saldo.

## Loja e caixas

`GET /api/shop` devolve o catálogo **com as chances reais** usadas no sorteio. A loja mostra as
chances antes da compra.

| Caixa | Preço | Conteúdo | Comum | Raro | Épico | Lendário |
|---|---|---|---|---|---|---|
| CAIXA DE CAMPO | 250 ZC | todos os acabamentos × 4 armas | 60% | 28% | 9,5% | 2,5% |
| CAIXA DE PRECISÃO | 350 ZC | acabamentos do LR-12 e da pistola | 45% | 38% | 13% | 4% |
| CAIXA DE OFICINA | 120 fragmentos | todos | 50% | 32% | 14% | 4% |

**Abertura** (`POST /api/shop/open { caseId, requestId }`):

1. **Sorteio:** `crypto.randomInt` sorteia a raridade pelas chances publicadas (inteiros em
   1/100 000) e depois um item uniforme dentro da raridade. O cliente não escolhe nada; campos
   extras são ignorados.
2. **Idempotência:** o `requestId` é gerado pelo cliente e reaproveitado se a resposta se perder.
   Repetir o mesmo pedido devolve o **mesmo** resultado sem cobrar de novo.
3. **Registro:** cobrança, item, raridade e fragmentos são gravados numa única transação antes da
   resposta.
4. **Animação:** a roleta só começa **depois** que o servidor respondeu, e o item final é o que já
   foi concedido.

**Repetidos** viram fragmentos:

| Raridade | Fragmentos |
|---|---|
| Comum | 15 |
| Raro | 35 |
| Épico | 80 |
| Lendário | 200 |

Fragmentos compram a CAIXA DE OFICINA.

## Acabamentos (skins)

| Acabamento | Raridade |
|---|---|
| Grafite tático | comum |
| Carbono industrial | comum |
| Camuflagem de reconhecimento | rara |
| Cerâmica ártica | rara |
| Liga de cobre | épica |
| Circuito experimental | lendária |

- **Armas:** cada acabamento existe para as 4 armas jogáveis (24 itens).
- **Origem:** os padrões são procedurais e originais (`skins-render.js`). São gerados em canvas com
  semente fixa e aplicados por projeção triplanar aos modelos reais, em 1ª e 3ª pessoa e no arsenal.
- **Equipar** (`POST /api/inventory/equip`) só aceita itens que a conta possui. O servidor coloca os
  acabamentos equipados no estado do jogador (`skins`) ao entrar na sala; o cliente não consegue
  declarar acabamentos.
- **Sem efeito no jogo:** acabamentos não mudam dano, cadência, precisão, recuo, munição nem
  hitboxes. O teste W5 confere isso.

## Persistência

- **Onde:** os dados ficam em `DATA_DIR` (padrão `server/data/`).
  - `economy.json` guarda contas, inventários, equipados e conclusões já pagas. A gravação é
    atômica: arquivo temporário e depois `rename`.
  - `transactions.jsonl` é o registro de transações, só de acréscimo, gravado antes de responder.
  - Arquivo ilegível nunca é sobrescrito: ele é copiado para `economy.json.corrupt-<data>`.
- **Limite honesto:** em hospedagens com disco **efêmero** (ex.: plano gratuito do Render), os
  dados são apagados a cada nova implantação ou reinício.
  - Os jogadores perdem saldo e inventário.
  - O cliente detecta isso (token desconhecido), cria uma conta nova e avisa na loja.
  - Para persistir de verdade, aponte `DATA_DIR` para um **disco persistente** (ex.: *Persistent
    Disk* do Render, pago) ou troque o armazenamento por um banco de dados. Essa troca não foi feita.
- **Escala:** o armazenamento é um processo único. Vários servidores em paralelo precisariam de um
  banco compartilhado.

## Endpoints

| Método | Rota | Autenticação | Função |
|---|---|---|---|
| POST | `/api/account` | — | cria conta (devolve token e conta) |
| GET | `/api/account` | Bearer | saldo, fragmentos, inventário, equipados, histórico |
| GET | `/api/shop` | — | catálogo, preços e chances |
| POST | `/api/shop/open` | Bearer | abre caixa (`caseId`, `requestId`) |
| POST | `/api/inventory/equip` | Bearer | equipa/remove acabamento (`weapon`, `skin` ou `null`) |
