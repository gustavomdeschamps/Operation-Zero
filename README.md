# OPERATION ZERO 2.0

FPS tático em primeira pessoa para o navegador (**HTML5 + CSS3 + módulos ES + Three.js r160**) com **multiplayer online** (**Node.js + Colyseus + WebSockets**) e **treino offline** contra bots.

A arena **FOUNDRY-7** é uma instalação industrial abandonada. Ela tem área de preparação, corredor central, duas rotas laterais (armazém e pátio), pátio de tiro com núcleo central, pórticos, plataforma elevada e dois objetivos (**A** no armazém, **B** no pátio) usados no modo tático.

| Modo | Onde roda | Descrição |
|---|---|---|
| **Treino offline** | só o navegador | O jogo da v1, intacto: 14 bots, meta de 30 eliminações, Névoa Ciano. |
| **Combate por equipes (TDM)** | servidor | ALFA × ÔMEGA. Vence quem chegar a 30 eliminações ou estiver à frente após 8 min. Retorno após 3 s com 1,5 s de proteção. |
| **Tático: ataque e defesa** | servidor | Rodadas de 100 s com 8 s de preparação. Os atacantes instalam o dispositivo em A ou B (F segurado, 3,5 s). Os defensores desarmam (F segurado, 5 s) ou eliminam todos os atacantes. Detonação em 35 s. Vence quem fizer 5 rodadas. Sem retorno dentro da rodada. |

> **Estado da publicação:** o projeto está **preparado** para ser hospedado (variáveis de ambiente, CORS/origens, WSS, `/health`, encerramento ordenado, Dockerfile, [DEPLOY.md](DEPLOY.md)), mas **não foi publicado** na internet. Todos os testes multiplayer foram feitos em `localhost` (ver [Testes](#testes-executados)).

---

## Início rápido

Requisitos: **Node.js 20 ou superior** (para o online). Para o modo offline, basta qualquer servidor HTTP estático.

### Online + offline (recomendado)

Na pasta `operation-zero/` (a que contém `index.html` e `package.json`):

```bash
npm install      # instala também as dependências de server/ (postinstall)
npm start        # servidor de partidas + arquivos do jogo em http://localhost:2567
```

Abra **http://localhost:2567** no Chrome, Edge ou Firefox. O mesmo endereço oferece **JOGAR ONLINE** e **TREINO OFFLINE**.

No Windows, use os mesmos comandos no **PowerShell** ou no **Prompt de Comando**. Se a porta 2567 estiver ocupada:

```powershell
$env:PORT=8080; npm start          # PowerShell
```
```bat
set PORT=8080 && npm start         & rem Prompt de Comando
```

Para não digitar a porta toda vez, copie `.env.example` para `.env` e edite os valores.

### Somente offline (como na v1)

```bat
python -m http.server 8080
```

Abra **http://localhost:8080** e escolha **TREINO OFFLINE**. Nesse caso o **JOGAR ONLINE** mostra "servidor indisponível", porque o servidor Node não está rodando.

> O Three.js vem do CDN jsDelivr (`three@0.160.0`), então o primeiro carregamento precisa de internet. O SDK de rede (Colyseus) é servido pelo próprio servidor em `/vendor/colyseus.js` e só é baixado ao entrar no modo online.

### Testes automatizados

```bash
npm test         # 39 testes do servidor (node:test), incluindo integração com clientes reais
```

---

## Como testar com dois jogadores

**No mesmo computador:**

1. Rode `npm start`.
2. Abra **http://localhost:2567** em duas janelas. Use uma janela normal e uma anônima, ou dois navegadores diferentes, porque cada aba guarda a própria identidade de reconexão.
3. Janela 1: **JOGAR ONLINE** → digite um nome → escolha o modo → **CRIAR SALA PRIVADA**. O lobby mostra um **código de 5 caracteres** (ex.: `27ZD5`) com o botão **COPIAR**.
4. Janela 2: **JOGAR ONLINE** → nome → digite o código → **ENTRAR COM CÓDIGO**.
5. Na janela 1, que é a do anfitrião, clique em **INICIAR**. Clique na tela do jogo para capturar o mouse.

**Em dois computadores da mesma rede (Wi-Fi/cabo):**

1. No computador que roda `npm start`, descubra o IP local: `ipconfig` no Windows (campo "Endereço IPv4"), ou `ip addr`/`ifconfig` no Linux/macOS.
2. No outro computador, abra `http://IP-DO-SERVIDOR:2567`, por exemplo `http://192.168.0.15:2567`.
3. Se não conectar, libere a porta 2567 no Firewall do Windows. Na primeira execução, o Windows costuma perguntar se o Node.js pode usar a rede: permita em "Redes privadas".

**Partida pública:** em **JOGAR ONLINE**, clique em **PARTIDA RÁPIDA**. O jogador entra em uma sala pública com vaga no modo escolhido, ou uma sala nova é criada. Salas públicas começam sozinhas quando todos estão prontos ou 20 s depois de haver jogadores suficientes. A lista **SALAS PÚBLICAS** mostra as salas abertas reais (nunca jogadores fictícios).

## Salas privadas

- Ao criar, o servidor gera um código de 5 caracteres sem caracteres ambíguos (sem `0/O/1/I`), único entre as salas ativas.
- Para compartilhar, clique em **COPIAR** no lobby e envie o código. A outra pessoa digita o código em **ENTRAR COM CÓDIGO**; maiúsculas e minúsculas tanto faz.
- Salas privadas não aparecem na lista pública nem na partida rápida.
- Somente o **anfitrião** vê **INICIAR**. Se ele sair, outro jogador assume.
- Código inexistente, sala cheia, partida tática em andamento e versão incompatível geram mensagens claras.

---

## Controles

| Tecla | Ação |
|---|---|
| W A S D | Mover (diagonal normalizada) |
| Mouse | Olhar |
| Botão esquerdo | Disparar (automático no fuzil, semiautomático na pistola) |
| Botão direito | Mirar (ADS: zoom, menos dispersão, movimento mais lento) |
| Shift | Caminhar devagar e em silêncio (sem passos) |
| C ou Ctrl | Agachar (mais precisão, menor silhueta) |
| Espaço | Pular |
| R | Recarregar |
| E | Habilidade **Névoa Ciano** (fumaça) |
| 1 / 2 | Fuzil VX-9 Ranger / Pistola K-2 Sidearm |
| F (segurar) | Online, modo tático: instalar / desarmar o dispositivo |
| Tab (segurar) | Online: placar |
| Esc | Liberar o mouse e abrir o menu (offline pausa; online a partida continua) |

> **Atenção:** `Ctrl + W` fecha a aba em qualquer navegador e não pode ser bloqueado por páginas. Por isso o jogo pede confirmação antes de sair durante uma sessão, e recomendamos usar **C** para agachar.

---

## Arquitetura

```
operation-zero/
├── index.html, style.css         telas (menu, online, lobby, fim), HUD, placar, sobreposições
├── game.js                       renderer, estados, loop, integração offline/online
├── config.js                     parâmetros do cliente (derivados de shared/game-config.js)
├── client-config.js              URL do servidor para cliente hospedado separadamente (vazio = mesma origem)
├── player.js, weapon.js, abilities.js, map.js, enemies.js, effects.js, audio.js, ui.js, utils.js
│                                 sistemas da v1 (preservados; agora usam os módulos compartilhados)
├── shared/                       código usado pelo NAVEGADOR e pelo SERVIDOR (mesma regra nos dois lados)
│   ├── game-config.js            armas, movimento, fumaça, rede, partidas
│   ├── arena-layout.js           layout único da arena → visual (cliente) e colisão (ambos); spawns, objetivos A/B
│   ├── arena-collision.js        colisores AABB + raycast (sem Three.js)
│   ├── movement.js               física do jogador (passo determinístico)
│   ├── weapon-rules.js           dispersão, recuo, dano
│   ├── hitboxes.js               cabeça/corpo/pernas
│   ├── smoke-rules.js            posicionamento e bloqueio de visão da fumaça
│   ├── protocol.js               versão, mensagens, fases, equipes, botões, validação de códigos
│   └── math.js
├── online/                       camada multiplayer do cliente
│   ├── connection.js             descoberta do servidor, SDK, criar/entrar/partida rápida, erros
│   ├── lobby.js                  telas online e lobby (dados reais do servidor)
│   ├── match.js                  predição, reconciliação, interpolação, HUD online, placar
│   ├── avatars.js                personagens remotos com cores de equipe e nomes
│   └── spike.js                  dispositivo do modo tático no mundo (farol e bipe)
├── server/
│   ├── package.json              dependências com versões fixas
│   ├── src/index.js              HTTP (Express) + WebSocket (Colyseus), /health, /api, origens, arquivos estáticos
│   ├── src/config.js             variáveis de ambiente (+ leitura de .env)
│   ├── src/rooms/MatchRoom.js    sala: entrada, autenticação, reconexão, passo fixo, mensagens
│   ├── src/schema/MatchState.js  estado sincronizado (jogadores, fumaças, dispositivo, placar)
│   ├── src/systems/              simulação, combate, habilidades, fluxo da partida
│   ├── src/modes/                tdm.js, tactical.js
│   ├── src/services/             validação, matchmaking/códigos, spawns, logs
│   └── tests/                    testes unitários e de integração
├── package.json                  scripts da raiz (install/start/test delegam para server/)
├── .env.example, Dockerfile, .dockerignore, DEPLOY.md
└── README.md
```

### Fluxo de rede

```
Navegador                                        Servidor (autoritativo, 60 Hz)
─────────                                        ──────────────────────────────
entrada → quadro {mf, mr, botões, yaw, pitch} ─▶ fila por jogador (máx. 32, saneada)
predição local com shared/movement.js            mesmo shared/movement.js + colisão compartilhada
                                                 armas, dano, fumaça, objetivos, placar
reconciliação ◀── patch de estado (20 Hz) ────── último quadro processado por jogador
interpolação dos outros (100 ms de atraso)
efeitos imediatos do próprio tiro          ◀──── tiro/acerto/eliminação confirmados
```

- **Servidor autoritativo:** o cliente envia apenas intenções (teclas, botões, ângulo de visão). Posição, vida, munição, dano, eliminações, fumaças, objetivos e placar são decididos no servidor.
- **Passo fixo:** `setFixedTimestep` a 60 Hz; patches a cada 50 ms.
- **Predição + reconciliação:** cada quadro enviado é simulado localmente. A cada patch, o jogador volta à posição oficial e os quadros ainda não confirmados são reaplicados. Diferenças pequenas são suavizadas na câmera; erros acima de 2,5 m (teleporte, surgimento) são corrigidos na hora. Yaw e pitch são quantizados em float32 nos dois lados, para que a reaplicação seja idêntica.
- **Interpolação:** os outros jogadores são desenhados 100 ms no passado, entre dois snapshots no tempo do servidor. Um novo surgimento não interpola a partir da posição anterior.
- **Compensação de atraso limitada:** o servidor guarda 300 ms de histórico de posições (`allowRewindState`) e testa o tiro contra as posições que o atirador estava vendo (último snapshot recebido por ele, limitado a 300 ms). Paredes e o estado atual (vivo/morto) não retrocedem.
- **Validação do tiro:** cadência e munição no servidor, origem = olho oficial, direção = ângulo do quadro com tolerância de dispersão (cone máximo da arma + folga). Fora disso, o tiro é rejeitado e registrado.
- **Reconexão:** queda inesperada reserva a vaga por 20 s (`allowReconnection`). O SDK tenta reconectar sozinho, e a HUD mostra "RECONECTANDO" e depois "CONECTADO" ou "CONEXÃO PERDIDA". Uma saída voluntária libera a vaga na hora.

### Sistemas multiplayer

- **Lobby real:** lista de jogadores por equipe, anfitrião, pronto/aguardando, troca de equipe, contagem mínima de jogadores e contagem regressiva.
- **Equipes balanceadas:** novos jogadores vão para a equipe menor. A troca manual só é aceita se não desequilibrar as equipes em mais de 1.
- **Matchmaking público:** salas por modo (`filterBy(['mode'])`), trancadas quando cheias ou durante uma partida tática. A partida rápida usa `joinOrCreate`.
- **Fumaça compartilhada:** o servidor valida o ponto (mesma regra da v1, `shared/smoke-rules.js`), controla duração e recarga e replica a nuvem para todos. A nuvem esconde os personagens visualmente, e os nomes de inimigos atrás ou dentro dela não são mostrados.
- **Colisão compartilhada:** o mesmo `shared/arena-layout.js` gera o visual do cliente e os colisores do servidor (187 AABB).
- **HUD online:** placar das equipes, tempo, fase, rodada, ping com indicador de qualidade, equipe, estado da conexão, objetivo da equipe, barra de instalação/desarme, tela de eliminado, faixa de fim de rodada, feed com eliminações confirmadas e placar completo (Tab) com E/M/pontos/ping.
- **Segurança:**
  - entradas saneadas (limites de valores, NaN, ângulos);
  - orçamento de quadros por tempo real (*anti-speed-hack*) e quadros ociosos quando o cliente para de enviar;
  - limite de taxa em mensagens;
  - nomes saneados e únicos;
  - versão de protocolo checada;
  - conexões limitadas por IP;
  - origens WebSocket checadas;
  - identidade duplicada recusada;
  - limite de salas;
  - arquivos servidos por lista de permissões (`server/`, `.env` e `node_modules` nunca são servidos);
  - nenhum segredo enviado ao cliente.

### Funcionalidades preservadas da v1

O modo offline continua completo e foi testado de novo após a refatoração (ver [Testes](#testes-executados)). Os módulos que passaram para `shared/` (layout da arena, colisão, movimento, regras de arma e fumaça) mantêm exatamente os mesmos valores.

- **Fluxo de telas:** carregamento com progresso → menu com câmera cinematográfica sobre a arena → pronto (captura do mouse) → jogando → pausa → fim de sessão (vitória/derrota com estatísticas). Erros de WebGL, de carregamento de módulos e de abertura via `file://` mostram uma tela explicativa.
- **Movimento:** aceleração/desaceleração, corrida/caminhada/agachamento, pulo com *buffer* e *coyote time*, gravidade, subida de degraus (até 0,46 m), aderência ao descer escadas, colisão AABB com sub-passos (não atravessa paredes mesmo em alta velocidade), checagem de teto ao levantar. O PointerLock só fornece o mouse; a física é própria (`player.js`).
- **Armas:** fuzil automático (25/100, 9,75 tiros/s, 34 de dano → 3 tiros no corpo) e pistola semiautomática. Hitscan a partir do centro da câmera (o centro da mira é o ponto de impacto). Cadência por tempo de jogo, munição/reserva reais, recarga com estágios de som, recarga automática, bloqueio de disparo na recarga/troca/pausa, R repetido não duplica a recarga.
- **Precisão:** dispersão base por estado (agachado < parado < caminhando < correndo < no ar), *bloom* por disparo consecutivo com recuperação gradual, multiplicador de ADS. Amostragem com PRNG determinístico (reproduzível). A mira de 4 linhas abre e fecha com a dispersão projetada na tela.
- **Recuo:** padrão determinístico por disparo (vertical + oscilação lateral), aplicado à câmera e à arma, com recuperação exponencial independente do FPS. Puxar o mouse para baixo compensa o recuo sem desalinhar a visão de forma permanente.
- **Bots:** 14 robôs procedurais (corpo, cabeça com visor, braços, arma), 4 deles em trilhos móveis. Hitboxes de cabeça (×3,5), corpo e pernas, brilho de dano, recuo ao ser atingido, animação de morte, contagem única de eliminação, reaparecimento após 3,5 s. Estados de combate: ocioso → reação → aviso visual/sonoro (visor pisca) → rajada → recarga. No máximo 2 atacantes simultâneos; nunca atiram na área de preparação.
- **Névoa Ciano (E):** ponto calculado pela mira (máx. 17 m), recuado de paredes, assentado no chão, recusado se estiver obstruído, fora da arena ou perto demais (com feedback na tela). Lançamento em arco, nuvem com 34 camadas de partículas, anel de solo, entrada/saída suaves, **5 s de tempo de jogo** e recarga de 14 s exibida na HUD. Dentro da nuvem a tela recebe um filtro azul.
- **Regra da fumaça (documentada):** a fumaça **bloqueia a visão dos bots**: eles não iniciam nem mantêm ataques através dela, e um jogador dentro dela não é visto. Ela **não bloqueia os disparos do jogador**: balas atravessam a fumaça, como em shooters táticos, mas você também não enxerga bem através dela.
- **Estações de munição:** duas caixas com ícone holográfico (preparação e junção) reabastecem a reserva por proximidade (recarga de 12 s por estação).
- **Efeitos:** partículas reutilizáveis (faíscas aditivas e poeira), marcas de impacto em *ring buffer* (90), traçantes do jogador e dos bots, clarão de boca (malha + luz sempre presente, sem recompilar shaders), explosão e anel de eliminação, partículas de surgimento.
- **Áudio procedural (Web Audio):** disparos, recarga, vazio, impactos por material, acertos (corpo/cabeça), eliminação, passos, pouso, fumaça, tiros e avisos dos bots com pan estéreo, dano, estação de munição, vitória/derrota. Inicializado apenas após clique. Se o navegador não tiver Web Audio, tudo vira operação nula e o jogo continua.
- **HUD:** arena/setor atual, eliminações/meta, tempo, objetivo, vida com barra e estado de movimento, munição/reserva/arma/slots, barra de recarga, cartão da habilidade com cooldown radial, marcador de acerto (corpo/cabeça/eliminação), feed de eliminações, mensagens centrais, vinheta e indicadores direcionais de dano, contador de FPS opcional. O DOM só é tocado quando um valor muda.
- **Configurações (persistidas em `localStorage`):** sensibilidade, FOV, volume, qualidade gráfica (baixa/média/alta: resolução e sombras), cor da mira, bots revidam, mostrar FPS.
- **Visual:** materiais PBR com texturas procedurais em canvas (concreto com juntas e furos de tirante, piso com placas e fissuras, painéis metálicos com rebites, contêineres corrugados, caixas, faixas de segurança), *bump maps*, céu de entardecer em shader, mapa de ambiente PMREM gerado do céu, sol com sombras suaves, luzes quentes/frias localizadas, neblina, *skyline* industrial ao fundo, sinalização por setor. A geometria estática é fundida por material (poucas draw calls).

---

## Testes executados

Todos foram executados neste ambiente (Linux, Node 22, Chromium headless via Playwright com WebGL por software/SwiftShader). Nos testes de navegador, o URL do CDN do Three.js foi redirecionado para uma cópia local idêntica (`three@0.160.0`), porque o ambiente não acessa o jsDelivr. Todos os testes multiplayer usaram `localhost`. Os roteiros de navegador (Playwright) foram executados neste ambiente de desenvolvimento e não fazem parte do projeto entregue; os testes do servidor estão em `server/tests/` e rodam com `npm test`.

| Conjunto | Resultado |
|---|---|
| `npm test`: servidor (13 compartilhados + 19 combate/modos + 7 integração com clientes Colyseus reais) | **39/39** |
| E2E online TDM: duas sessões de navegador | **19/19**, sem erros no console |
| E2E online tático: duas sessões de navegador | **13/13**, sem erros no console |
| Regressão offline (determinística) | **36/36**, sem erros no console |
| Fluxo offline com cliques reais (Pointer Lock, pausa, retomar, configurações, sair, sem Web Audio, CDN bloqueado) | aprovado |

**Servidor (`npm test`, 39 testes):**

- **Compartilhados (13):**
  - 187 colisores gerados do layout;
  - spawns válidos; objetivos A/B acessíveis;
  - gravidade, pulo sem repetição no ar, paredes (inclusive em alta velocidade), escada;
  - movimento determinístico (base da reconciliação);
  - regras de posicionamento da fumaça;
  - hitboxes;
  - dano e dispersão;
  - saneamento de entradas maliciosas (NaN, infinitos, ângulos enormes, bits desconhecidos);
  - validação de nomes, códigos e opções.
- **Combate e armas (19, com os sistemas reais da sala):**
  - tiro válido desconta munição e confirma para os dois lados;
  - 3 tiros no corpo eliminam, com eliminação única, placar e retorno;
  - tiro na cabeça elimina;
  - parede bloqueia o dano;
  - cadência acelerada rejeitada sem gastar munição;
  - recarga sem tiros, R repetido não duplica;
  - munição nunca negativa e recarga automática;
  - direção fora do cone de precisão rejeitada;
  - morto não atira e fogo amigo desligado;
  - disparos fora da fase de combate rejeitados.
- **Compensação de atraso:** acerta na posição vista até 300 ms atrás, com o `Rewind` real do Colyseus; um pedido mais antigo é limitado à janela. Uma mutação do teste confirmou que ele falha sem a compensação.
- **Estação de munição:** proximidade, recarga de 12 s, sem efeito à distância.
- **Fumaça:** aprovada pelo servidor, com recarga autoritativa, dura 5 s e é removida.
- **Anti-aceleração:** entradas em excesso não simulam mais rápido que o tempo real; colisão continua valendo no servidor.
- **Modos:**
  - TDM: limite de pontos encerra a partida uma vez;
  - tático: instalação + detonação dão a rodada aos atacantes;
  - desarme dá a rodada aos defensores; eliminação total encerra a rodada;
  - sem entrada tardia; a partida termina ao atingir as rodadas.
- **Integração com clientes Colyseus reais por WebSocket (7):**
  - `/health` e estado inicial;
  - erros claros (código inexistente, versão incompatível, nome inválido, aba duplicada, sala cheia);
  - dois jogadores em equipes equilibradas;
  - início pelo anfitrião; movimento e orientação sincronizados;
  - combate autoritativo visto pelos dois;
  - saída e reconexão sem entidades fantasmas ou duplicadas; sala vazia encerrada;
  - partida rápida reúne jogadores do mesmo modo e não mistura modos; listagem;
  - entrada tardia bloqueada em partida tática.

**E2E TDM (duas janelas):**

- **Lobby:** sala privada com código; código inexistente → "Sala não encontrada"; lobby com os dois jogadores em equipes diferentes; só o anfitrião vê INICIAR; partida começa nas duas sessões.
- **Visibilidade e movimento:**
  - cada jogador vê o personagem 3D do outro na posição oficial;
  - predição reconciliada;
  - movimento do outro interpolado até a posição do servidor (5,7 m);
  - orientação sincronizada.
- **Combate e placar:**
  - dano e eliminação aplicados pelo servidor;
  - munição oficial = HUD;
  - eliminação anunciada nas duas sessões e contada uma vez;
  - placar sincronizado;
  - retorno após o atraso.
- **Fumaça:** aparece nas duas sessões e desaparece em ambas após 5 s.
- **Interface e saída:** placar Tab; pausa online com SAIR DA PARTIDA (sem REINICIAR); saída de um jogador sem entidade fantasma.
- **Rede:** 0 correções de predição fora dos teleportes do teste.

**E2E tático (duas janelas):**

- **Preparação:** rodada 1 em preparação; objetivos diferentes por equipe; F durante a preparação não instala.
- **Instalação:** barra de instalação real (F segurado); servidor registra o dispositivo em A.
- **Dispositivo instalado:** o defensor vê "DISPOSITIVO ATIVO", com objetivo de desarme; dispositivo 3D visível nas duas sessões na posição oficial.
- **Desarme:** barra de desarme; rodada vencida pelos defensores e contada uma vez.
- **Troca de rodada:** faixa de fim de rodada nas duas sessões; dispositivo some; rodada 2 começa reiniciada.

## Limitações conhecidas

- **Não publicado e não testado pela internet.** Latência real, perda de pacotes e NAT/firewall entre redes diferentes não foram avaliados; apenas `localhost`. Também não foi verificado com dois computadores físicos.
- **Docker:** o `Dockerfile` foi escrito, mas não foi construído neste ambiente.
- **FPS em GPU real não medido.** O ambiente de teste renderiza por software (1–3 FPS), então os testes de navegador avançaram a simulação por tempo real com renderização opcional desativada. A CPU gasta ~0,2 ms por atualização no offline.
- **Escala:** um processo, salas em memória, sem Redis. Use uma instância só.
- **Visibilidade:** todas as posições da sala são enviadas a todos os clientes. A fumaça e as paredes escondem visualmente, mas um cliente modificado poderia ler as posições (não há *culling* de visibilidade no servidor).
- **Modo tático simplificado:** não há troca de lados no intervalo e não há portador do dispositivo (qualquer atacante pode instalar). Também não há economia nem compra de armas.
- **Pausa online:** o menu (Esc) não pausa a partida, porque o servidor continua. O jogador fica parado e vulnerável.
- **Ping no placar:** é informado pelo cliente (apenas exibição; não afeta regras).
- **X-Forwarded-For:** com `TRUST_PROXY=true`, o limite por IP confia nesse cabeçalho; ative apenas atrás do proxy da hospedagem.
- **Da v1:** áudio procedural não avaliado de ouvido; `Ctrl + W` não pode ser bloqueado; os bots (offline) usam IA simples, sem navegação; modelos procedurais, sem animação esquelética.

## Publicação

Veja **[DEPLOY.md](DEPLOY.md)**. Resumo:

1. Use uma hospedagem com processo Node persistente e WebSocket (Render, Railway, Fly.io, VPS). **Não** use funções *serverless*.
2. Use `npm install` como instalação e `npm start` como comando de início. A porta vem de `PORT`. Health check em `GET /health`.
3. Defina `NODE_ENV=production` e `TRUST_PROXY=true`. Defina `ALLOWED_ORIGINS` apenas se o cliente ficar em outro domínio. Nesse caso, use também `SERVE_CLIENT=false` no servidor e preencha `client-config.js` no cliente.
4. A hospedagem fornece HTTPS, e o cliente passa a usar `wss://` automaticamente.
5. Depois de publicar, verifique `/health` e faça uma partida entre duas redes diferentes.

### Portas e endereços

| Item | Valor |
|---|---|
| Jogo + servidor (padrão) | `http://localhost:2567` |
| WebSocket | mesmo host/porta (`ws://`; `wss://` com HTTPS) |
| Saúde | `GET /health` |
| Salas públicas | `GET /api/rooms` |
| Consulta de código | `GET /api/rooms/:codigo` |
| SDK do cliente | `GET /vendor/colyseus.js` |
| Servidor alternativo (teste) | `?server=http://host:porta` no URL do jogo |
