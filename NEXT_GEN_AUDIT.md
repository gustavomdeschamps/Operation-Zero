# Auditoria — OPERATION ZERO Next-Gen

Auditoria feita sobre o projeto existente (mesma pasta, mesmo histórico; nenhuma substituição por
demonstração). Tecnologia confirmada no código e nos `package.json`:

- **Cliente:** Three.js **r160** (cópia local em `vendor/three/`), módulos ES, sem bundler.
- **Servidor:** Node.js 20+ com **Colyseus 0.18** (`@colyseus/core` 0.18.10, `@colyseus/schema` 5.0.42,
  `@colyseus/ws-transport` 0.18.4, SDK `@colyseus/sdk` 0.18.6) e Express 4.22.3.
- **Dependências:** nenhuma foi atualizada. A única dependência usada de forma nova é o `express`,
  que já estava instalado, para ler JSON na API da loja.

Cada problema abaixo tem uma severidade, a evidência e o que foi feito. As medidas e os testes
citados foram executados de verdade (ver “Como reproduzir”). Os marcados **mantido** continuam como
limitação documentada.

---

## 1. Convenção de coordenadas (documentada em `shared/hitboxes.js` e `shared/movement.js`)

| Item | Valor |
|---|---|
| Unidade | metro |
| Eixo vertical | **+Y** |
| Frente com `yaw = 0` | **−Z** |
| Vetor frente | F = (−sin yaw, 0, −cos yaw) |
| Vetor direita | R = (cos yaw, 0, −sin yaw) |
| Pés do jogador | (x, y, z) do estado |
| Altura | 1,80 em pé · 1,22 agachado |
| Olhos | altura − 0,13 |
| Raio da cápsula | 0,32 m |
| Degrau máximo | 0,46 m |

- **Origem do disparo:** é sempre o **olho autoritativo** no servidor (`tryFire`).
- **Traçante:** sai da boca do cano da arma em 1ª/3ª pessoa. É apenas visual: o raio que acerta é o
  do olho. Assim o tiro sai do centro da tela e o cano não “vê” paredes que o olho não vê.

## 2. Problemas encontrados e correções

### Críticos

**C1. Hitbox da cabeça desalinhada da cabeça animada.**

- **Evidência:** as caixas eram centradas sobre os pés. Medindo os ossos dos quatro operadores
  animados no ambiente de personagens:
  - agachado, a cabeça fica ~0,25 m à frente e ~0,19 m à direita (ombro esquerdo adiantado);
  - correndo, ~0,19 m à frente e 0,11 m mais baixa;
  - a caixa antiga tinha meia-largura de 0,17 m.
  - Resultado: tiros na cabeça visível de alguém agachado ou correndo contavam como tronco ou
    erro, e tiros no ar ao lado da cabeça contavam como cabeça.
- **Correção:** hitboxes **por postura** (`shared/hitboxes.js`). Cabeça e tronco seguem o
  deslocamento medido para agachar, correr e mirar para baixo. A mesma função é usada no servidor,
  no cliente (previsão de acerto) e nos alvos do treino.
- **Verificação:**
  - no ambiente de personagens, todas as posições medidas da cabeça (5 posturas × 4 operadores)
    ficaram dentro da nova caixa;
  - os testes de precisão P1–P10 passam (seção 3).

**C2. Compensação de latência girava a postura de forma errada perto de ±180°.**

- **Evidência:** o *Rewind* do Colyseus interpola os campos linearmente. Entre `yaw = 3,1` e
  `yaw = −3,1` ele produz ~0, ou seja, o jogador virado ao contrário. Com a hitbox por postura,
  isso deslocaria a cabeça no instante rebobinado.
- **Correção:** `yaw/pitch/vx/vz` são registrados num grupo separado com `interpolate: 'step'`.
  `x/y/z/h` continuam interpolados.
- **Teste:** P9 e os testes de compensação existentes.

**C3. Partida pública com uma pessoa nunca começava.**

- **Evidência:** o mínimo é 2 jogadores e não havia preenchimento. Quem buscasse partida sozinho
  ficava no lobby indefinidamente.
- **Correção:** bots **autoritativos no servidor** completam as salas públicas (seção 4). Nunca há
  partida só de bots: o início exige uma pessoa conectada, e a sala é encerrada quando a última
  pessoa sai.

### Altos

**A1. A abertura podia ser pulada** (botão PULAR INTRO, teclas Esc/Espaço/Enter e opção “não
mostrar”).

- **Correção:** abertura obrigatória e curta (~7 s; ~2,6 s com animações reduzidas), sem botão, sem
  teclas e sem a opção nas configurações.
- **Para testes locais:** existe `?nointro`, que só funciona em `localhost`/`127.0.0.1`.

**A2. Informações técnicas na interface principal.** O rodapé mostrava versão, “Three.js r160”,
“Colyseus 0.18” e os créditos da Rocketbox, e a aba JOGAR mostrava o endereço do servidor.

- **Correção:**
  - rodapé apenas com CONTROLES e CRÉDITOS;
  - créditos numa tela própria;
  - estado ONLINE/OFFLINE no lugar do endereço (os detalhes vão para o console);
  - teste de interface confirma que o texto do menu não contém versões nem nomes de bibliotecas.

**A3. Latência sempre visível na HUD.**

- **Correção:** opção “Mostrar latência” (desligada por padrão). O ponto de estado da conexão
  continua sempre visível. O FPS já era opcional.

**A4. Categoria PRECISÃO vazia.**

- **Correção:** **LR-12 SENTINELA**, fuzil de ferrolho com luneta 4x, validado pelo servidor (seção 5).

**A5. Sem economia, loja nem pós-partida com recompensa.**

- **Correção:** ZERO CREDITS calculados e gravados no servidor, loja com caixas, inventário,
  acabamentos e tela de pós-partida (seção 6 e `ECONOMY.md`).

**A6. Dispersão escolhida pelo cliente (mantido).**

- **O que o servidor faz:** confere se a direção está dentro do cone máximo da arma no estado de
  movimento, mas não sabe qual era o sorteio do cliente.
- **Consequência:** um cliente modificado pode atirar sempre no centro (“sem dispersão”), embora
  nunca fora do cone.
- **Por que não foi corrigido:** exigiria semente de dispersão compartilhada e sincronizada por
  disparo, o que muda o protocolo de previsão.

### Médios

**M1. Silhuetas dos operadores parecidas** (quatro modelos da mesma biblioteca).

- **Correção:** equipamento **original** por operador, modelado em código (`characters/gear.js`):
  - GAVIÃO: porta-carregadores;
  - BASALTO: placa e ombreiras;
  - CORVO: mochila de rádio com antena;
  - LINCE: tablete tático e cinto de granadas;
  - todos: emblema de braço com o símbolo do operador.

**M2. O equipamento como objetos filhos dos ossos dobrava o custo de CPU dos personagens.**

- **Evidência:** problema encontrado durante este trabalho. O treino passou de 1,45 para 2,88 ms por
  atualização dos inimigos.
- **Correção:** o equipamento virou malha com pele rígida no mesmo esqueleto (a GPU anima), fundida
  numa malha por personagem com cores por vértice, mais o emblema.
- **Resultado medido:** 246 draw calls no treino com 14 soldados (seção 7).

**M3. Sem reação de aterrissagem.**

- **Correção:** flexão rápida dos joelhos ao tocar o chão, nos personagens em 3ª pessoa.

**M4. Pós-partida sem dados pessoais.**

- **Correção:** a tela mostra:
  - resultado, K/D, instalações/desarmes;
  - recompensa detalhada (conclusão, vitória, desempenho, objetivos) e saldo, tudo enviado pelo
    servidor;
  - botões JOGAR NOVAMENTE e MENU PRINCIPAL.

**M5. O guindaste do Porto Vesper tem um bloco suspenso só visual** (mantido). Fica acima da área
jogável, então não engana colisão nem linha de tiro, mas não tem colisor.

**M6. Os inimigos do treino offline seguem rotas fixas** (mantido).

- A IA nova (patrulha, audição, cobertura, dificuldades) roda **no servidor** para as partidas online.
- O treino offline continua como estande de tiro com soldados roteirizados.
- Os dois usam as mesmas hitboxes por postura.

### Baixos

- **B1.** Os botões da tela de resultado ficavam fora da tela em janelas baixas → painel com rolagem.
- **B2.** A tela de busca só dizia “Conectando…” → agora mostra a etapa real (servidor e depois sala
  pública do modo), com CANCELAR. A busca é o *matchmaking* real (`joinOrCreate`), não um
  temporizador.
- **B3.** A lista de salas públicas não diferenciava pessoas e bots → mostra “2/10 +4 BOT”.

## 3. Precisão do combate — testes reproduzíveis (`server/tests/precision.test.js`)

Todos executam os sistemas reais do servidor (`tryFire` → `resolveShot` → `rayVsPlayer`) com
entradas como as do cliente.

| Teste | Situação | Resultado |
|---|---|---|
| P1 | Cabeça, tronco e pernas a 8 m | zona correta em cada uma |
| P2 | Perto (1,5 m) e longe (45 m) | acerto e zona corretos |
| P3 | Atirador andando de lado e no ar | acerto validado com a dispersão do estado |
| P4 | Alvo agachado: cabeça no deslocamento da postura | cabeça; o centro antigo da caixa **não** é cabeça (P10) |
| P5 | Alvo correndo | cabeça adiantada/baixa reconhecida |
| P6 | Parede e cobertura parcial (caixote de 1,15 m) | parede bloqueia; caixote bloqueia as pernas, não a cabeça |
| P7 | Alvos alinhados | só o mais próximo é atingido |
| P8 | Morte no meio da rajada | sem dano após a morte; o morto não atira |
| P9 | Desconexão e reconexão | sem dano enquanto desconectado; volta a ser atingível |
| P10 | Centro da caixa antiga num alvo agachado | não conta como cabeça |

Mais os testes de combate anteriores, ainda válidos:

- compensação limitada a `maxRewindMs`;
- cadência e recarga;
- cone de dispersão;
- fogo amigo desligado;
- anti-aceleração.

## 4. Bots (servidor) — resumo técnico

**Arquivos:**

- `server/src/ai/bot-brain.js`, `bot-manager.js` e `bot-config.js`;
- `shared/ai/navgrid.js`: grade de navegação de 0,5 m gerada da **colisão real** de cada mapa,
  com A\*, degraus e escadas;
- medido: 15 189 células andáveis na Foundry-7 e 17 162 no Porto Vesper; construção ~0,12 s,
  caminhos em 3–10 ms.

**Mesmas regras dos jogadores:**

- O bot gera o mesmo quadro de entrada de um jogador (`mf/mr`, botões, `yaw`, `pitch`, direção).
- O quadro passa por `sanitizeInput`, pela física compartilhada, por munição, recarga, cadência e
  pelo cone de dispersão do servidor.
- **Nenhum disparo de bot foi recusado nos testes.**

**Percepção sem trapaça:**

- campo de visão a partir da mira e alcance por dificuldade;
- linha de visão contra a colisão real (cabeça ou peito) e contra a fumaça;
- audição de tiros e de passos de corrida, com erro de posição;
- direção aproximada de quem o atingiu;
- no Elite, rádio da equipe com atraso.

**Mira humana:**

- giro limitado por segundo;
- erro angular que diminui enquanto acompanha o alvo e cresce com a distância e o movimento;
- recuo da própria arma.

**Comportamentos:**

- patrulha;
- investigação de sons, com busca no local;
- engajamento com rajadas, desvio lateral e agachar;
- cobertura (pontos que escondem o olho do atirador), recuo com pouca vida, recarga tática;
- apoio a aliado atingido;
- separação entre bots e detecção de “preso”, com novo caminho ou pulo;
- tático: plano de objetivo por rodada; no Difícil/Elite, metade dos atacantes usa rota alternativa;
  instalação e desarme seguem as regras do modo.

**Dificuldades** (Normal, Difícil, Elite):

- mudam reação, erro de mira, campo de visão e audição, uso de cobertura, flanco e rádio;
- **não mudam** dano, munição, velocidade nem visão através de paredes;
- teste B6 confere isso.

**Identificação:** nome sempre `[BOT] …`, campo `bot` no estado, etiqueta BOT no lobby e “BOT” no
lugar da latência no placar. Os bots não usam o fuzil de precisão.

**Preenchimento:**

- salas públicas: após 8 s com uma pessoa no lobby, completam até 6 participantes; saem quando
  pessoas entram;
- salas privadas: o anfitrião adiciona e remove bots e escolhe a dificuldade, só no lobby;
- uma única IA por bot, no servidor: todos os clientes veem o mesmo inimigo.

## 5. Armas

| Arma | Categoria | Dano | Cadência | Carregador |
|---|---|---|---|---|
| K-2 SIDEARM | pistola | 26 | 6,25/s | 12 |
| SV-4 VESPA | submetralhadora | 24 | 13,3/s | 32 |
| VX-9 RANGER | fuzil de assalto | 34 | 9,75/s | 25 |
| **LR-12 SENTINELA** (nova) | fuzil de precisão | 85 (cabeça elimina) | 0,95/s (ferrolho) | 5 |

Detalhes do LR-12:

- **Precisão:** dispersão de 45 mrad sem mirar e 0,54 mrad com a luneta.
- **Luneta 4x:** sobreposição com retícula original; a arma é ocultada; a sensibilidade cai na
  proporção do campo de visão.
- **Animação e som:** ferrolho animado, com cápsula ejetada no recuo do ferrolho; sons sintetizados
  de disparo, de abertura e de fechamento.
- **Testes de servidor (W1–W3):** dano, cadência do ferrolho e cone.

Todas as armas são modelos procedurais originais (`weapon-models.js`). Os mesmos modelos aparecem
em 1ª pessoa, nos personagens e no arsenal (giro e zoom).

## 6. Economia, loja e acabamentos

Ver `ECONOMY.md`. Pontos verificados por teste:

- **Recompensas:** valores centrais (100 / +75 / desempenho até 50 / objetivos até 50); pagas uma
  única vez por identificador de conclusão; quem abandona não recebe; ocioso não recebe; teto
  diário.
- **Caixas:** sorteio no servidor com `crypto.randomInt` e chances publicadas (teste estatístico com
  40 000 sorteios); idempotência por `requestId`; repetidos viram fragmentos.
- **Itens:** equipar só o que possui; transações registradas; persistência atômica.
- **Acabamentos:** não alteram nenhum atributo (W5).

## 7. Desempenho medido

Medido com `renderer.info`, independente da GPU, a 1280×720 em qualidade média, contando o passe de
sombra:

| Cena | Draw calls | Triângulos |
|---|---|---|
| Menu (Foundry-7 + operador) | 82 | 39 mil |
| Visualizador de operadores | 39 | 24 mil |
| Treinamento (14 soldados com equipamento) | 246 | 170 mil |
| Treinamento olhando para o armazém | 299 | 182 mil |
| Porto Vesper (portaria) | 97 | 15 mil |

- **CPU:** 2,8–3,1 ms por atualização do treinamento depois do aquecimento (duas medições), sem
  renderização, no ambiente de teste com WebGL por software. A CPU é dividida com o rasterizador por software, então
  esse número é pessimista.
- **Servidor:** com 6 participantes (5 bots), 0,08–0,17 ms por passo de 60 Hz.
- **Mecanismos de desempenho** (3.0, mantidos):
  - personagens fora da câmera não são desenhados;
  - sombra dos personagens só até 25 m;
  - pose a 20 Hz para soldados distantes;
  - armas dos personagens fundidas por material;
  - qualidade de sombras configurável (desligada/baixa/média/alta).
- **Novos:**
  - equipamento animado pela GPU (pele rígida), fundido numa malha por personagem;
  - acabamentos compilados uma vez por tipo e compartilhados.

## 8. Como reproduzir

```bash
cd server && npm test                    # 82 testes (inclui precisão, bots, economia, armas)
node --test tests/precision.test.js      # apenas precisão
node --test tests/bots.test.js           # apenas bots
```

Os roteiros de navegador (Playwright) foram executados no ambiente de desenvolvimento; os resultados
estão no `README.md`, em “Testes executados”.
