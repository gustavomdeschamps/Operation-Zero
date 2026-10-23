# Direção de arte — OPERATION ZERO

## Identidade

- **Tema:** operações táticas num futuro próximo, em instalações industriais e portuárias.
- **Tom:** sóbrio, técnico, legível. Nada de exagero cartunesco nem de brilho decorativo.
- **Assinatura visual:** grafite e preto azulado, branco frio e **ciano como cor funcional**. O
  ciano marca a tecnologia da facção: faixas nas armas, luzes de status, retícula e seleção na
  interface.
  - Vermelho indica hostil ou alerta.
  - Âmbar indica aviso e moeda.
  - Verde indica confirmação.
- **Tokens:** as cores ficam no `:root` de `style.css` (`--cyan`, `--red`, `--amber`, `--green`,
  `--ink-*`). A tipografia é condensada (Bahnschrift/DIN e equivalentes do sistema), com texto
  funcional ≥ 11 px.

## Personagens

A base humana vem da Microsoft Rocketbox (MIT), adaptada:

- malha otimizada;
- **insígnias reais removidas**;
- uniforme recolorido por equipe (ALFA grafite, ÔMEGA oliva).

Por cima dessa base, cada operador recebe **equipamento original modelado em código**
(`characters/gear.js`) que comunica a função pela silhueta:

| Operador | Função | Silhueta |
|---|---|---|
| GAVIÃO | assalto | porta-carregadores frontais, perfil enxuto |
| BASALTO | defesa | placa frontal reforçada, ombreiras e rádio de ombro: ombros largos |
| CORVO | reconhecimento | mochila de rádio com **antena alta** e luz de status: lido de longe pelas costas |
| LINCE | especialista | tablete tático no peito (luz ciano), cinto com bolsas e granadas de fumaça |

- **Emblemas de braço:** o símbolo de cada operador (chevron, escudo, olho, losango) é um desenho
  próprio.
- **Animação:** captura de movimento para a locomoção e camadas procedurais para empunhadura,
  mira, recuo, recarga, reação a impacto, queda e **aterrissagem**.

## Armas

Modelos procedurais originais (`weapon-models.js`):

- **Linguagem visual:** blocos com chanfros, guarda-mãos com aletas, faixas ciano nas laterais,
  miras com retícula vermelha.
- **Silhuetas:**

| Arma | Silhueta |
|---|---|
| VX-9 RANGER | guarda-mão claro de cerâmica |
| SV-4 VESPA | supressor integrado e coronha de arame |
| K-2 SIDEARM | ferrolho serrilhado |
| LR-12 SENTINELA | chassi oliva esqueletado, cano pesado com freio de boca, luneta longa, ferrolho lateral visível |

- **Acabamentos:** seis padrões procedurais. Cada um tem um conceito material claro; a raridade
  sobe com a complexidade do material, não com efeitos chamativos.

| Acabamento | Conceito material |
|---|---|
| Grafite tático | jateado fosco |
| Carbono industrial | trama |
| Camuflagem de reconhecimento | manchas angulares pintadas à mão |
| Cerâmica ártica | branco-gelo com faixas de nível |
| Liga de cobre | escovado com pátina |
| Circuito experimental | trilhas gravadas com pulso emissivo |

## Mapas

- **FOUNDRY-7:** fundição desativada, com concreto, aço oxidado e sinalização amarela. Combina
  corredores fechados com um corredor central longo.
- **PORTO VESPER:** terminal costeiro com contêineres empilhados, armazém de carga e cais aberto ao
  pôr do sol.
- Texturas procedurais (`map.js`), colisão idêntica ao visual, minimapa gerado da mesma planta.

## Interface

- Painéis escuros translúcidos com cantos chanfrados e hierarquia por tamanho e peso, não por cor.
- A interface principal **não mostra** versões, bibliotecas nem créditos técnicos (eles ficam na
  tela CRÉDITOS).
- A HUD é limpa por padrão; FPS e latência são opcionais.

## Imagens de referência (estudo)

As quatro imagens enviadas (um soldado, um FPS num armazém, uma arma de ficção científica e um menu
de FPS móvel) foram usadas **só como estudo**. Nenhuma delas foi incorporada ao jogo, recortada,
traçada ou usada como textura, plano 2D ou modelo.

**O que guiamos a partir delas:**

- leitura de silhueta por camadas de equipamento;
- contraste de valores entre personagem e cenário;
- arma em 1ª pessoa ocupando o terço inferior direito;
- faixas de luz para dar identidade tecnológica;
- menu com ações principais grandes e perfil/moedas no topo.

**O que não foi copiado:** personagens, logotipos, armas, skins, mapas ou layouts específicos de
outras franquias.
