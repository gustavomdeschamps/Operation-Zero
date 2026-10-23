# OPERATION ZERO

FPS tático em primeira pessoa para o navegador (**HTML5 + CSS3 + módulos ES + Three.js r160**), com **multiplayer online** (**Node.js + Colyseus 0.18 + WebSockets**), **bots controlados pelo servidor** e **treinamento offline**.

## Next-Gen (4.0)

Evolução da 3.0 no mesmo projeto, sem substituir nada:

- **Combate mais preciso:**
  - hitboxes que seguem a postura animada (agachado, correndo, mirando);
  - compensação de latência corrigida;
  - 10 testes de precisão reproduzíveis.
- **Bots no servidor:**
  - completam as salas públicas e são sempre marcados como BOT;
  - navegação pela colisão real do mapa;
  - visão sem atravessar paredes nem fumaça, audição, cobertura e objetivos do tático;
  - dificuldades Normal, Difícil e Elite;
  - mesmas regras dos jogadores.
- **LR-12 SENTINELA:** fuzil de precisão por ferrolho com luneta 4x, validado pelo servidor.
- **ZERO CREDITS:**
  - recompensas calculadas no servidor (conclusão, vitória, desempenho, objetivos), pagas uma
    única vez;
  - **LOJA** com caixas (chances exibidas, sorteio no servidor, abertura animada), inventário,
    fragmentos de repetidos e seis **acabamentos originais**, apenas visuais.
- **Operadores com equipamento original** (silhuetas por função) e aterrissagem animada.
- **Interface:**
  - abertura obrigatória e curta (sem "pular");
  - menu sem informações técnicas, com LOJA, saldo e estado online, e tela de CRÉDITOS;
  - HUD com latência opcional;
  - pós-partida com recompensa detalhada e JOGAR NOVAMENTE.

**Documentação:**

| Arquivo | Conteúdo |
|---|---|
| `NEXT_GEN_AUDIT.md` | auditoria e correções |
| `ECONOMY.md` | economia, loja e persistência |
| `ART_DIRECTION.md` | direção de arte |
| `ASSET_CREDITS.md` | origem e licença de cada recurso |

### Bots

- **Onde rodam:** só no servidor (`server/src/ai/`). Um bot é um participante sem cliente: produz o
  mesmo quadro de entrada de um jogador, que passa pela física, munição, cadência e cone de
  dispersão do servidor.
- **Navegação:** grade de 0,5 m gerada da colisão real de cada mapa (`shared/ai/navgrid.js`), com
  A\*.
- **Busca pública:**
  - depois de ~8 s com você no lobby, a sala é completada até 6 participantes;
  - quando pessoas entram, bots saem;
  - sem pessoas, a sala termina.
- **Sala privada:** o anfitrião adiciona e remove bots (por equipe) e escolhe a dificuldade no lobby.

### ZERO CREDITS, loja e acabamentos

- **Ganhos por partida terminada:**

| Parcela | Valor |
|---|---|
| Conclusão | 100 |
| Vitória | +75 |
| Desempenho | até 50 |
| Objetivos | até 50 |

- **Regras:** teto de 1 500 ZC por dia; quem abandona ou fica ocioso não recebe.
- **Caixas** só com ZC ou fragmentos; não há dinheiro real.
- **Saldo e inventário** ficam no servidor (`DATA_DIR`).
  - **Atenção:** em disco efêmero (Render gratuito) eles se perdem a cada deploy.
  - Ver `ECONOMY.md`.

### Ferramenta de teste

Em `localhost`, `?nointro` dispensa a abertura (só para testes automatizados; em produção a abertura
é sempre exibida). `?debug` expõe o estado do jogo no console.

---

## Recursos da 3.0 (mantidos)

A 3.0 acrescentou:

- **operadores humanos 3D** com animação esquelética;
- **marca própria** e **abertura cinematográfica**;
- **menu principal completo** (operadores, arsenal, mapas e configurações);
- **segundo mapa** (Porto Vesper) e **nova arma** (SV-4 Vespa);
- **minimapa** com mapa tático e **editor de mira**.

| Modo | Onde roda | Descrição |
|---|---|---|
| **Treinamento** | só o navegador | 14 soldados hostis na Foundry-7, meta de 30 eliminações. Eles avisam antes de atirar, revidam e reaparecem. |
| **Mata-mata por equipes** | servidor | ALFA × ÔMEGA. Vence quem chegar a 30 eliminações ou estiver à frente após 8 min. Retorno após 3 s com 1,5 s de proteção. |
| **Tático casual** | servidor | Rodadas de 100 s com 8 s de preparação. Atacantes instalam o dispositivo em A ou B (F segurado, 3,5 s); defensores desarmam (F segurado, 5 s) ou eliminam a equipe. Vence quem fizer 5 rodadas. |
| **Partida personalizada** | servidor | Sala privada com código, modo e mapa escolhidos pelo anfitrião. |
| **Competitivo** | — | **Indisponível** e identificado como "EM BREVE": exige contas e classificação, que não existem. |

> **Publicação:** nada foi publicado automaticamente. A versão online que já existe (Render) só muda quando você enviar estes arquivos ao repositório ligado a ela. Veja [Como atualizar sem quebrar a versão online](#como-atualizar-sem-quebrar-a-versão-online).

---

## Início rápido

Requisito: **Node.js 20 ou superior**.

Na pasta do projeto (a que contém `index.html` e `package.json`):

```bash
npm install      # instala também as dependências de server/
npm start        # servidor de partidas + arquivos do jogo em http://localhost:2567
```

Abra **http://localhost:2567** no Chrome, Edge ou Firefox.

No Windows, os comandos são os mesmos no **PowerShell** ou no **Prompt de Comando**. Se a porta 2567 estiver ocupada:

```powershell
$env:PORT=8080; npm start          # PowerShell
```

**Somente offline (sem Node):** `python -m http.server 8080` na pasta do projeto e abra `http://localhost:8080`. O treinamento funciona; as partidas online mostram "servidor indisponível".

> Todas as bibliotecas do navegador estão no projeto (`vendor/three/`), então o jogo não depende de CDN. O SDK de rede (Colyseus) é servido pelo próprio servidor em `/vendor/colyseus.js`.

### Testes automatizados

```bash
npm test         # 83 testes do servidor (node:test): precisão, bots, economia, armas, combate, integração
```

---

## Como atualizar sem quebrar a versão online

1. **Não apague a pasta atual.** Extraia o pacote numa pasta nova, por exemplo `Documentos\operation-zero-next`.
2. Nessa pasta, rode `npm install` e `npm start` e teste em `http://localhost:2567`, inclusive com duas janelas (uma anônima).
3. Só depois de aprovar, envie os arquivos ao repositório do GitHub ligado ao Render. Se o *Auto-Deploy* estiver ligado, o Render publica sozinho a cada envio para a branch configurada; para testar antes, use outra branch ou desligue o *Auto-Deploy* temporariamente.
4. **Não envie `server/node_modules`** nem `server/data/`: a primeira é recriada pelo `npm install` na hospedagem; a segunda guarda contas locais de teste. O envio pela página do GitHub aceita até **100 arquivos por vez**: se der erro, envie em partes (por exemplo, primeiro `assets/` e `vendor/`, depois `server/`, depois o resto).
5. As variáveis do Render (`NODE_ENV=production`, `TRUST_PROXY=true`) **não mudam**. Há uma variável **nova e opcional**, `DATA_DIR` (pasta da economia; ver `DEPLOY.md`).
6. Clientes antigos abertos durante a atualização recebem "Versão do servidor incompatível" (protocolo **4**) e precisam recarregar a página.

---

## Novidades da 3.0

### Operadores humanos

Quatro operadores, todos humanos, com esqueleto *Biped* de 80 ossos e malha com pele (*skinning*):

| Operador | Função | Modelo de origem (Microsoft Rocketbox, MIT) |
|---|---|---|
| **GAVIÃO** | Assalto | `Military_Male_01` |
| **BASALTO** | Defesa | `Military_Male_04` |
| **CORVO** | Reconhecimento | `Military_Male_03` |
| **LINCE** | Especialista | `Military_Female_01` |

- **Uniforme por equipe:** ALFA usa grafite e ÔMEGA usa oliva. A troca é feita por shader só no tecido e no equipamento; pele e rosto não mudam. As bandeiras e insígnias reais das texturas originais foram removidas.
- **Arquivos:** os modelos (`assets/characters/*.glb`, 1,3–1,5 MB cada, texturas WebP) carregam em segundo plano, com progresso na abertura.
- **Falha de carregamento:** se os modelos não carregarem, o jogo continua com silhuetas simplificadas e um aviso.
- **Onde aparecem:** no fundo do menu, no visualizador de operadores, nos jogadores remotos online e nos soldados do treinamento.
- **Aparência apenas:** operador e arma não dão vantagem de atributos.

### Animação (`characters/human.js`)

- **Locomoção por captura de movimento:** parado, andar, andar rápido, trote, corrida e sprint. A mistura acompanha a velocidade real (0,98 a 5,53 m/s) com fase sincronizada, então os pés não deslizam. Há sentido para frente e para trás e o deslocamento lateral acompanha a direção.
- **Agachamento:** camada aditiva, funciona parado ou andando.
- **Corpo superior procedural:**
  - torção do tronco para onde a mira aponta (as pernas seguem o movimento);
  - inclinação com o *pitch*;
  - postura de tiro com o ombro esquerdo à frente;
  - prontidão baixa ao correr.
- **Armas nas mãos:**
  - IK de dois ossos nos dois braços com vetor de polo, a mão direita na empunhadura e a esquerda no guarda-mão;
  - orientação das mãos calibrada e dedos fechados;
  - funciona com fuzil, SMG e pistola.
- **Combate:** recuo por disparo, reação a dano (mola amortecida) e alerta luminoso antes do disparo dos bots.
- **Eliminação:** joelhos cedem, queda com pivô nos pés e arma que cai separada. O corpo fica alguns segundos e some (online, 2,4 s).
- **Nível de detalhe:** soldados a mais de 30 m e fora de combate atualizam a pose a 20 Hz. O acerto usa as hitboxes da simulação, não o esqueleto, então nada muda na jogabilidade.

### Marca e abertura

- **Marca:** símbolo octogonal com o "Z" e marcas ciano, logotipo geométrico "OPERATION ZERO" e versões horizontal clara/escura, empilhada, símbolo claro/escuro e favicon, em `assets/branding/` (SVG).
- **Abertura (~7 s):**
  - a câmera voa sobre o mapa até o operador do menu enquanto o símbolo e o logotipo se formam;
  - **PULAR INTRO**, **Esc**, **Espaço** ou **Enter** pulam;
  - a opção "Não mostrar a abertura nas próximas vezes" fica salva;
  - com **animações reduzidas** (do sistema ou das configurações) não há voo de câmera e a abertura dura ~2,6 s;
  - a barra de progresso mostra o carregamento dos operadores;
  - se os modelos demorarem, a abertura espera no máximo 14 s e segue.

### Menu principal

- **Barra superior:** INÍCIO, JOGAR, OPERADORES, ARSENAL, MAPAS e CONFIGURAÇÕES; perfil local (nome + kit); estado do servidor (consulta `/health` e `/api/rooms`); silenciar e tela cheia.
- **Fundo do menu:** o operador escolhido no mapa real, com câmera cinematográfica e ambiente sonoro sintetizado.
- **Teclado:** ← → navegam pela barra, ↑ ↓ percorrem listas, **Esc** volta ao INÍCIO.
- **JOGAR:**
  - os modos reais da tabela acima;
  - busca pública por modo;
  - sala personalizada com **modo e mapa**;
  - entrada por código;
  - lista de partidas públicas com o mapa de cada uma.
- **OPERADORES:**
  - visualizador 3D com câmera própria (arrastar para girar, roda do mouse ou botões para aproximar);
  - prévia dos dois uniformes;
  - seleção salva no perfil.
  - **Dentro do lobby** (botão TROCAR OPERADOR), a escolha é enviada ao servidor, que valida e aplica. No lobby a troca é imediata; em partida, vale a partir do próximo surgimento.
- **ARSENAL:**
  - categorias Pistolas, Submetralhadoras, Fuzis, Precisão e Equipamentos;
  - visualizador 3D com o **mesmo modelo** usado em jogo, com giro, zoom e INSPECIONAR;
  - atributos calculados dos números reais da simulação: dano, cadência, tempo para eliminar, precisão parado e andando, recuo, carregador, recarga e alcance;
  - **comparação** com a arma equipada (marcas âmbar) e EQUIPAR.
  - A categoria **Precisão** está vazia e diz isso; a pistola e a fumaça aparecem como "sempre incluídas" e não fingem ser equipáveis.
- **MAPAS:**
  - planta de cada mapa gerada da colisão real, com setores, objetivos e lados das equipes;
  - **VER MAPA** coloca o mapa no fundo do menu;
  - **JOGAR NESTE MAPA** abre JOGAR com o mapa selecionado.

### Armas jogáveis

| Arma | Slot | Dano | Cadência | Carregador | Observação |
|---|---|---|---|---|---|
| **VX-9 RANGER** (fuzil) | 1 | 34 | 585/min | 25 + 100 | 3 tiros no corpo; mira óptica |
| **SV-4 VESPA** (submetralhadora) | 1 | 24 | 798/min | 32 + 128 | nova; supressor; mais precisa em movimento |
| **K-2 SIDEARM** (pistola) | 2 | 26 | semiautomática | 12 + 48 | sempre no kit |

- **Escolha da primária:** fuzil ou SMG no arsenal.
- **Validação no servidor:** o servidor valida a arma escolhida (`shared/catalog.js`) e aplica cadência, dano, munição e dispersão da arma realmente equipada. Um identificador desconhecido é recusado.
- **Modelos compartilhados:** a primeira pessoa, os personagens 3D e o arsenal usam o mesmo modelo (`weapon-models.js`).

### Mapas

| Mapa | Colisores | Modos | Destaques |
|---|---|---|---|
| **FOUNDRY-7** (aprimorado) | 187 | Treinamento, Equipes, Tático | Mesma jogabilidade da 2.0 (colisão idêntica). Detalhes visuais novos sem colisão: tubulações, eletrocalhas, caixas elétricas, extintores, placas de rota de fuga, marcas de desgaste e luminárias extras. |
| **PORTO VESPER** (novo) | 193 | Equipes, Tático | Complexo portuário: portaria, pátio norte, armazém 3 (objetivo A), corredor de contêineres empilhados, cais de carga (objetivo B), cais aberto com guindaste e água. Tema de céu/luz próprio. |

- **Uma definição por mapa:** cada mapa (`shared/maps/*.js`) define geometria, setores, objetivos, surgimentos e tema. A **mesma** definição gera o visual no cliente e a colisão no servidor.
- **Mapa da sala:** o anfitrião escolhe o mapa ao criar a sala; o servidor valida e o envia no estado da sala, então todos os jogadores carregam o mesmo mapa.
- **Partida rápida:** entra em qualquer sala pública do modo; se precisar criar uma, usa o mapa preferido.
- **Treinamento:** acontece sempre na Foundry-7.
- **Verificação automática:** testes confirmam que os surgimentos não ficam dentro de sólidos e que todo o piso alcançável é conectado (*flood fill*) nos dois mapas.

### Minimapa e mapa tático

- **Minimapa:** desenhado da planta de colisão do mapa carregado, girado com o norte para cima, com a seta do jogador, aliados (online), objetivos, munição e o dispositivo instalado.
- **Mapa tático:** tecla **M** (configurável) ou botão na pausa, com zoom de 1×, 1,6× e 2,5×.
- **Sem inimigos:** o minimapa **nunca recebe posições inimigas**. Só você e os aliados são desenhados; um teste E2E confirma isso.

### Mira

- **Editor:**
  - tipos cruz, T, ponto, círculo e divisa;
  - tamanho, comprimento, espessura e distância do centro;
  - cor e opacidade; contorno (espessura e cor);
  - ponto central (tamanho e opacidade);
  - expansão com movimento e com disparo, ligada à **dispersão real da arma**;
  - mostrar ao mirar com mira óptica e durante a recarga.
- **Presets:** Clássica, Ponto, Compacta, Aberta, Tática e Circular. Qualquer ajuste vira **Personalizada**.
- **Prévia:** desenhada pela **mesma função** da partida (`crosshair.js`), com fundos de cena, escuro e claro e SIMULAR DISPAROS.
- **Código compartilhável** `OZX1-…`: COPIAR e IMPORTAR, validado (código inválido é recusado com aviso).

### Configurações (aplicadas na hora e salvas no navegador)

- **Controles:** sensibilidade horizontal; multiplicador vertical; sensibilidade ao mirar; inverter eixo Y; **remapeamento de teclas** (uma tecla não fica em duas ações).
- **Vídeo:** FOV; qualidade; escala de renderização (50–100%); sombras (conforme qualidade, desligadas, 1024, 2048 ou 4096); partículas e efeitos; limite de FPS (30–144 ou vsync); mostrar FPS; reduzir efeitos pesados (clarões e partículas); tela cheia.
- **Áudio:** canais geral, efeitos, interface e música/ambiente; silenciar.
- **Mira:** o editor acima.
- **Interface:**
  - escala da HUD; feed de eliminações;
  - minimapa: ligado/desligado, escala, opacidade e posição;
  - alto contraste; animações reduzidas (sistema/ligado/desligado);
  - pular a abertura.
- **Jogo:** soldados do treinamento revidam.
- **Restaurar padrão:** cada aba tem RESTAURAR PADRÃO DA ABA. Valores salvos ou importados passam por validação (`settings.js`) antes de serem usados.

### HUD e áudio

- **HUD:** mapa e setor atual; vida e estado de movimento; munição e arma, com animação ao trocar; cartão da habilidade (treme quando a habilidade é recusada); marcador de acerto; feed; indicadores de dano; FPS opcional.
- **HUD online:** placar, tempo, rodada, ping e **E/M** do jogador.
- **Áudio:** continua 100% sintetizado (Web Audio). Agora há canais separados, sons de interface (passar o mouse, confirmar, recusar), o impacto da abertura e um ambiente grave no menu. O áudio só começa após o primeiro clique ou tecla, como exigem os navegadores.

---

## Como testar com dois jogadores

1. Rode `npm start` e abra **http://localhost:2567** em duas janelas (uma normal e uma anônima).
2. **Janela 1:** JOGAR → nome → em PARTIDA PERSONALIZADA escolha modo e mapa → **CRIAR SALA**. O lobby mostra o código de 5 caracteres (botão COPIAR), o mapa e o kit de cada jogador.
3. **Janela 2:** JOGAR → nome → digite o código → **ENTRAR**.
4. No lobby, cada um pode usar **TROCAR OPERADOR / TROCAR ARMA**; **Esc** ou VOLTAR AO LOBBY retorna.
5. O anfitrião clica em **INICIAR PARTIDA**. Clique na tela para capturar o mouse.

**Rede local:** no outro computador, abra `http://IP-DO-SERVIDOR:2567` (descubra o IP com `ipconfig`). Libere o Node.js no firewall em "Redes privadas".

## Controles (padrão — todos remapeáveis, exceto mouse e Esc)

| Tecla | Ação |
|---|---|
| W A S D | Mover |
| Mouse / botão esquerdo / botão direito | Olhar / disparar / mirar |
| Shift | Caminhar em silêncio |
| C ou Ctrl | Agachar |
| Espaço | Pular |
| R | Recarregar |
| E | Névoa Ciano |
| 1 / 2 | Arma primária / pistola |
| F (segurar) | Tático: instalar / desarmar |
| Tab (segurar) | Placar online |
| M | Mapa tático |
| Esc | Liberar o mouse / pausa (online a partida continua) |

> `Ctrl + W` fecha a aba em qualquer navegador e não pode ser bloqueado; o jogo pede confirmação antes de sair durante uma partida. Prefira **C** para agachar.

---

## Arquitetura

```
operation-zero/
├── index.html, style.css          telas (carregamento, abertura, menu, pausa, configurações, lobby, fim), HUD
├── game.js                        renderer, estados, loop, troca de mapa, operador do menu, aplicação das preferências
├── settings.js                    preferências: padrões, validação, persistência, presets e código da mira, perfil local
├── crosshair.js                   desenho da mira (HUD e prévia usam a mesma função)
├── weapon-models.js               modelos das armas (1ª pessoa, personagens e arsenal), incl. LR-12
├── skins-render.js                acabamentos procedurais (canvas + projeção triplanar)
├── player.js, weapon.js, abilities.js, map.js, enemies.js, effects.js, audio.js, ui.js, utils.js, config.js
├── characters/
│   ├── library.js                 carregamento/cache dos GLB, clips, uniformes por equipe
│   ├── human.js                   personagem animado (locomoção, IK, recuo, dano, queda, aterrissagem)
│   └── gear.js                    equipamento original por operador (pele rígida no esqueleto)
├── ui/
│   ├── menu.js                    navegação, perfil, servidor, operadores, arsenal, mapas
│   ├── settings-panel.js          abas de configuração, teclas, editor de mira
│   ├── intro.js                   abertura
│   ├── studio.js                  visualizador 3D (câmera própria) de operadores e armas (com acabamento)
│   ├── shop.js                    LOJA: caixas, abertura animada, inventário, histórico
│   └── minimap.js                 minimapa, mapa tático e prévias dos mapas
├── shared/                        mesmo código no navegador e no servidor
│   ├── catalog.js                 operadores, armas primárias e mapas válidos (o servidor valida contra ele)
│   ├── maps/foundry7.js, vesper.js, parts.js
│   ├── arena-layout.js, arena-collision.js, movement.js, weapon-rules.js, hitboxes.js, smoke-rules.js
│   ├── game-config.js, protocol.js (protocolo 4), math.js, skins.js (catálogo de acabamentos)
│   └── ai/navgrid.js              grade de navegação gerada da colisão (bots)
├── online/                        conexão, conta (account.js), lobby, partida (predição/reconciliação/interpolação), avatares, dispositivo
├── server/                        Colyseus + Express (salas, simulação, combate, modos, validação, testes)
│   ├── src/ai/                    bots: cérebro, gerenciador, dificuldades
│   └── src/economy/               contas, recompensas, loja, armazenamento (DATA_DIR)
├── assets/characters, assets/animations   GLB (Microsoft Rocketbox, MIT — ver ASSET_CREDITS.md)
├── assets/branding                marca (SVG)
├── vendor/three                   three.js r160 + GLTFLoader/SkeletonUtils/BufferGeometryUtils (MIT)
└── NEXT_GEN_AUDIT.md, ECONOMY.md, ART_DIRECTION.md, ASSET_CREDITS.md, DEPLOY.md, Dockerfile, .env.example
```

### Rede e segurança (inalteradas na essência desde a 2.0)

- **Servidor autoritativo a 60 Hz:**
  - o cliente envia só intenções (teclas, botões, ângulos);
  - posição, vida, munição, dano, eliminações, fumaças, objetivos e placar são decididos no servidor;
  - patches a 20 Hz;
  - predição e reconciliação do próprio jogador;
  - interpolação de 100 ms dos demais;
  - compensação de atraso limitada a 300 ms.
- **Protocolo 3:**
  - `operator` e `primary` na entrada e na mensagem `loadout` (com limite de taxa);
  - `map` na criação da sala;
  - cada identificador é validado contra `shared/catalog.js`, e valores desconhecidos são recusados;
  - o kit troca no lobby ou no próximo surgimento;
  - o servidor usa a arma realmente equipada para validar cadência, dano e munição.
- **Arquivos estáticos por lista de permissões:**
  - entram só o código do cliente, `assets/` (GLB e SVG) e `vendor/three/`;
  - `server/`, `node_modules`, `.env` e arquivos ocultos nunca são servidos (há teste).
- **Demais proteções (desde a 2.0):** entradas saneadas, orçamento de quadros contra aceleração, limite por IP, origens WebSocket checadas, nomes únicos e saneados, reconexão com vaga reservada por 20 s.

---

## Testes executados

Executados neste ambiente de desenvolvimento: Linux, Node 22, Chromium headless (Playwright) com WebGL **por software** (SwiftShader). Os testes multiplayer usaram o servidor real em `localhost` (não pela internet). Os roteiros de navegador ficaram no ambiente de desenvolvimento e não fazem parte do pacote; os testes do servidor estão em `server/tests/` e rodam com `npm test`.

| Conjunto | Resultado |
|---|---|
| `npm test`: servidor | **83/83** |
| Interface (abertura obrigatória, menu, créditos, loja, arsenal com acabamentos, LR-12 com luneta, configurações, persistência, mapas, limpeza) | **48/48** |
| Regressão do treinamento offline (física, armas, soldados, fumaça, recarga, reinício) | **36/36** |
| E2E online, duas sessões, **Foundry-7**, com conta e recompensa | **29/29** |
| E2E online, duas sessões, **Porto Vesper**, com conta e recompensa | **29/29** |
| E2E busca pública com **bots do servidor** | **10/10** |

Detalhe dos testes do servidor:

| Arquivo | Testes | Conteúdo |
|---|---|---|
| `precision.test.js` | 10 | precisão P1–P10 |
| `bots.test.js` | 12 | bots |
| `economy.test.js` | 11 | economia e API |
| `weapons.test.js` | 5 | LR-12 e acabamentos |
| demais | 45 | testes da 3.0 |

Em todos os roteiros de navegador, o console ficou **sem erros**. Na regressão offline aparece um `ERR_CONNECTION_REFUSED` esperado: o cliente procura o servidor também em `:2567`, que não existe nesse teste.

**Detalhe dos testes novos:**

- **Precisão (servidor):**
  - zonas cabeça/tronco/pernas;
  - perto e longe;
  - atirador andando e no ar;
  - alvo agachado e correndo (cabeça na postura animada);
  - parede e cobertura parcial;
  - alvos alinhados;
  - morte no meio da rajada;
  - desconexão e reconexão;
  - centro antigo da caixa não é mais cabeça.
- **Bots (servidor):**
  - identificação como bot;
  - visão bloqueada por parede, campo de visão e fumaça;
  - não atira através de parede;
  - munição, recarga e cone aceitos pelo servidor (zero disparos recusados);
  - dano igual à tabela da arma;
  - não acerta tudo e erra mais de longe;
  - Elite reage antes e acerta mais que Normal, sem mudar dano;
  - navegação até destinos aleatórios nos dois mapas;
  - investiga tiros ouvidos;
  - preenchimento público e saída de bots quando pessoas entram, sem partida só de bots;
  - controles do anfitrião só na sala privada e no lobby;
  - defensor bot desarma;
  - partida tática só com bots e uma pessoa ociosa chega ao fim (custo médio < 3 ms por passo).
- **Economia (servidor):**
  - token só como hash;
  - abertura idempotente (pedido repetido não cobra de novo);
  - chances conferidas estatisticamente (40 000 sorteios);
  - repetidos → fragmentos;
  - equipar só o que possui;
  - recompensas e limites;
  - pagamento único por conclusão; quem abandona não recebe; teto diário;
  - falha de registro desfaz a operação;
  - gravação atômica, recarga e arquivo corrompido preservado;
  - API HTTP com acesso negado sem token.
- **E2E com conta:**
  - os dois jogadores entram com conta verificada pelo servidor;
  - ao fim (adversário abandonou) a tela mostra vitória, K/D e recompensa;
  - recompensa: +100 conclusão, +75 vitória, desempenho, com o saldo idêntico ao do servidor;
  - uma única transação registrada; quem abandonou não recebe.
- **E2E bots:**
  - busca pública real;
  - sala completada com 5 bots marcados em ~10 s;
  - partida iniciada; os bots andam pelo mapa e combatem;
  - o cliente vê os bots como soldados humanos;
  - o placar mostra BOT no lugar da latência;
  - a sala termina quando a pessoa sai.

**Custo de renderização** (medido com `renderer.info`, independente da GPU, a 1280×720 em qualidade média, contando o passe de sombra):

| Cena | Draw calls | Triângulos |
|---|---|---|
| Menu (Foundry-7 + operador) | 82 | 39 mil |
| Visualizador de operadores | 39 | 24 mil |
| Treinamento (14 soldados com equipamento) | 246–299 | 170–182 mil |
| Porto Vesper (portaria) | 97 | 15 mil |

- **CPU:** 2,8–3,1 ms por atualização do treinamento depois do aquecimento, sem renderização; memória JS ~28 MB.
- **Servidor:** 0,08–0,17 ms por passo de 60 Hz com 6 participantes (5 bots).
- **Otimização nova:** o equipamento dos operadores, primeiro feito como objetos ligados aos ossos, dobrava o custo de CPU. Ele virou uma malha com pele rígida animada pela GPU, uma por personagem.

## Limitações conhecidas

- **Pasta Documentos do Windows:** este ambiente na nuvem não acessa o seu computador. O trabalho foi feito na cópia de origem do projeto (a mesma que gerou o pacote 2.0) e é entregue como pacote para substituir a pasta, seguindo [Como atualizar](#como-atualizar-sem-quebrar-a-versão-online).
- **Nada foi publicado nem testado pela internet:** a versão online (Render) não foi alterada. Latência real e redes diferentes não foram avaliadas; dois computadores físicos também não.
- **FPS em GPU real não medido:** o ambiente renderiza por software (abaixo de 1 FPS em quadros completos). Por isso o custo foi medido por draw calls/triângulos, e os testes avançam a simulação em tempo real com a renderização desligada.
- **Animações:**
  - a locomoção é captura de movimento (Rocketbox);
  - empunhadura, mira, recuo, recarga em 3ª pessoa, reação a dano e queda são procedurais;
  - não há animação facial, salto capturado (no ar o corpo só recolhe as pernas, de forma procedural), escalada nem corpo em 1ª pessoa (só braços/mãos procedurais);
  - a pose de queda é simplificada (sem física de *ragdoll*).
- **Operadores:**
  - são cosméticos;
  - os corpos dos quatro modelos vêm de uma biblioteca aberta (Rocketbox, MIT) e foram adaptados, **não criados do zero**;
  - o equipamento adicional e os emblemas são originais, mas simples (peças geométricas, sem escultura de alta resolução).
- **Armas:** quatro jogáveis (pistola, SMG, fuzil, fuzil de precisão) com modelos procedurais *low-poly*; não há miras/acessórios trocáveis.
- **Dispersão:** o servidor confere o cone máximo de cada disparo, mas o sorteio da dispersão é do cliente. Um cliente modificado poderia atirar sempre no centro (nunca fora do cone). Ver `NEXT_GEN_AUDIT.md` (A6).
- **Bots:**
  - jogam TDM e tático nos dois mapas, com o fuzil ou a SMG; não usam o fuzil de precisão nem a fumaça;
  - o treino offline continua com os soldados roteirizados da 3.0 (a IA nova roda no servidor);
  - o equilíbrio das dificuldades foi medido em simulação (acertos por disparo de ~18% no Normal, ~21% no Difícil e ~28% no Elite em partidas simuladas de 3 min entre bots), não com jogadores reais.
- **Economia:**
  - conta sem recuperação: apagar os dados do navegador gera conta nova;
  - em disco efêmero (Render gratuito) os saldos se perdem a cada deploy (ver `ECONOMY.md`);
  - armazenamento em arquivo para um único processo.
- **Modos:** Competitivo **não existe** (sem classificação). O tático continua simplificado como na 2.0 (sem troca de lados, sem portador do dispositivo).
- **Mapas:**
  - o treinamento offline existe só na Foundry-7;
  - a partida rápida entra em qualquer sala pública do modo, mesmo que o mapa seja diferente do preferido (o mapa da sala é mostrado no lobby).
- **Visibilidade online:** o servidor envia as posições de todos os jogadores a todos (necessário para a interpolação). O minimapa nunca as desenha, mas um cliente modificado poderia lê-las (não há *culling* de visibilidade no servidor).
- **Áudio:**
  - todo sintetizado e não avaliado de ouvido;
  - pela regra dos navegadores, só toca depois do primeiro clique ou tecla, então a abertura da primeira visita pode ficar em silêncio até essa interação.
- **Docker:** o `Dockerfile` não foi construído neste ambiente.
- **Da 2.0:** `Ctrl + W` não pode ser bloqueado; a pausa online não para a partida; o ping do placar é informado pelo cliente.

## Publicação

Veja **[DEPLOY.md](DEPLOY.md)**. Resumo:

1. Use uma hospedagem com processo Node persistente e WebSocket (Render, Railway, Fly.io, VPS); **não** use funções *serverless* (Vercel/Netlify Functions).
2. Instalação `npm install`, início `npm start`, porta em `PORT`, health check `GET /health`.
3. `NODE_ENV=production` e `TRUST_PROXY=true`.

| Item | Valor |
|---|---|
| Jogo + servidor (padrão) | `http://localhost:2567` |
| WebSocket | mesmo host/porta (`wss://` com HTTPS) |
| Saúde | `GET /health` (inclui `protocol: 4`) |
| Conta / loja | `POST/GET /api/account`, `GET /api/shop`, `POST /api/shop/open`, `POST /api/inventory/equip` (ver `ECONOMY.md`) |
| Salas públicas | `GET /api/rooms` |
| Consulta de código | `GET /api/rooms/:codigo` |
| Servidor alternativo (teste) | `?server=http://host:porta` no URL do jogo |
