# Créditos e licenças dos recursos — OPERATION ZERO

Este arquivo lista **todos** os recursos de terceiros incluídos no projeto, com origem, licença e
alterações. Recursos não listados aqui foram criados para o projeto (ver "Recursos originais").
Nenhum recurso foi extraído de jogos comerciais e nenhum recurso pago foi usado.

## Personagens humanos — Microsoft Rocketbox Avatar Library

- **Origem:** <https://github.com/microsoft/Microsoft-Rocketbox> (commit `0943055`, out/2022).
- **Licença:** MIT — Copyright (c) 2020 Microsoft. O texto completo está em
  `assets/characters/LICENSE-Rocketbox.md` e `assets/animations/LICENSE-Rocketbox.md`.
- **Arquivos derivados:**

| Arquivo no jogo | Operador | Avatar de origem (`Assets/Avatars/Professions/…`) |
|---|---|---|
| `assets/characters/gaviao.glb` | GAVIÃO | `Military_Male_01/Export/Military_Male_01.fbx` |
| `assets/characters/corvo.glb` | CORVO | `Military_Male_03/Export/Military_Male_03.fbx` |
| `assets/characters/basalto.glb` | BASALTO | `Military_Male_04/Export/Military_Male_04.fbx` |
| `assets/characters/lince.glb` | LINCE | `Military_Female_01/Export/Military_Female_01.fbx` |

- **Alterações feitas (pipeline em Blender 5.2 via `bpy`, scripts não incluídos no jogo):**
  - FBX convertido para glTF binário (GLB), mantendo o esqueleto *Biped* e a pele (skinning);
  - malha reduzida com o modificador *Decimate* (proporção 0,7);
  - texturas redimensionadas (corpo/cabeça/equipamento 1024 px, capacete 512 px, acessórios 256 px)
    e gravadas em WebP (qualidade 82); mapa ORM gerado a partir do mapa especular original;
  - **bandeiras e insígnias reais removidas** das texturas do uniforme (substituídas pela cor do
    tecido ao redor), para que nenhum operador use símbolo de país ou força armada real;
  - nomes dos operadores, funções e descrições são do OPERATION ZERO (não pertencem à biblioteca).
- **Em jogo:** o uniforme é recolorido por shader conforme a equipe (ALFA grafite, ÔMEGA oliva);
  pele e rosto não são alterados.

## Animações de captura de movimento — Microsoft Rocketbox

- **Origem e licença:** as mesmas acima (MIT, Copyright (c) 2020 Microsoft).

| Arquivo no jogo | Origem (`Assets/Animations/…`) |
|---|---|
| `assets/animations/idle.glb` | `all_animations_max_motextr_static/m_idle_neutral_01.max.fbx` |
| `assets/animations/idle_look.glb` | `all_animations_max_motextr_static/m_idle_look_around_01.max.fbx` |
| `assets/animations/crouch.glb` | `all_animations_max_motextr_static/m_crouch_idle.max.fbx` |
| `assets/animations/walk.glb` | `all_animations_max_motextr_xy/m_walk_neutral_01.max.fbx` |
| `assets/animations/walk_fast.glb` | `all_animations_max_motextr_xy/m_walk_fast_01.max.fbx` |
| `assets/animations/run_slow.glb` | `all_animations_max_motextr_xy/m_run_slow_01.max.fbx` |
| `assets/animations/run.glb` | `all_animations_max_motextr_xy/m_run_neutral_01.max.fbx` |
| `assets/animations/sprint.glb` | `all_animations_max_motextr_xy/m_run_fast_01.max.fbx` |

- **Alterações:** exportadas apenas com o esqueleto e um clip por arquivo; deslocamento da raiz
  removido em tempo de execução (o jogo controla a posição); o agachamento é aplicado como camada
  aditiva. Empunhadura da arma, mira, recuo, reação a dano e queda são **procedurais** (código do
  projeto em `characters/human.js`), não animações da biblioteca.

## three.js (r160)

- **Origem:** <https://github.com/mrdoob/three.js> (pacote npm `three@0.160.0`).
- **Licença:** MIT — Copyright © 2010-2023 three.js authors. Texto em `vendor/three/LICENSE`.
- **Arquivos:** `vendor/three/three.module.min.js`, `vendor/three/addons/loaders/GLTFLoader.js`,
  `vendor/three/addons/utils/SkeletonUtils.js`, `vendor/three/addons/utils/BufferGeometryUtils.js`
  (sem alterações). Ficam no projeto para o jogo funcionar sem CDN.

## Colyseus (servidor e SDK do navegador)

- Dependências npm do servidor (`server/package.json`): `@colyseus/core`, `@colyseus/schema`,
  `@colyseus/ws-transport`, `@colyseus/sdk` — licença MIT, Copyright (c) Endel Dreyer
  (2015-2026 em core/ws-transport/sdk; 2018 em schema — ver o LICENSE de cada pacote). O SDK do navegador é servido pelo próprio servidor a partir de `node_modules`.
- `express` — licença MIT.

## Recursos originais do projeto

Criados especificamente para o OPERATION ZERO (código e arte procedural no próprio repositório):

- **Marca:** símbolo octogonal com o "Z", logotipo horizontal/vertical, versões clara/escura e
  favicon (`assets/branding/*.svg`, `favicon.svg`) — desenhados em SVG para este projeto.
- **Armas:** VX-9 RANGER, SV-4 VESPA, K-2 SIDEARM e **LR-12 SENTINELA** (fuzil de precisão, com
  ferrolho animado e luneta) são modelos procedurais (`weapon-models.js`); nomes e designs fictícios,
  sem cópia de armas de jogos comerciais. A retícula da luneta é um desenho próprio em CSS.
- **Acabamentos de armas (skins):** Grafite tático, Carbono industrial, Camuflagem de
  reconhecimento, Cerâmica ártica, Liga de cobre e Circuito experimental — padrões gerados em canvas
  no próprio código (`skins-render.js`, semente fixa) e aplicados por projeção triplanar. Nenhuma
  textura de terceiros.
- **Equipamento dos operadores:** porta-carregadores, placas, ombreiras, rádio com antena, tablete,
  bolsas, granadas e emblemas de braço (`characters/gear.js`) — modelados em código para o projeto e
  animados com o esqueleto Rocketbox. **Os corpos, rostos e uniformes continuam sendo da Rocketbox**
  (seção acima); só o equipamento adicional e os emblemas são originais.
- **Bots, navegação e economia:** IA, grade de navegação, loja, caixas e recompensas são código do
  projeto (`server/src/ai/`, `shared/ai/`, `server/src/economy/`).
- **Mapas:** FOUNDRY-7 e PORTO VESPER (`shared/maps/`), geometria e texturas procedurais (`map.js`).
- **Áudio:** todos os sons (disparos, passos, interface, ambiente do menu e abertura) são
  sintetizados em tempo real com Web Audio API (`audio.js`). Não há arquivos de áudio.
- **Efeitos visuais:** partículas, traçantes, clarões, fumaça e marcas de impacto (`effects.js`,
  `abilities.js`) — texturas geradas em canvas no próprio código.
- **Fontes:** o jogo usa fontes do sistema (Bahnschrift/DIN/Segoe UI/Arial); nenhuma fonte é
  distribuída com o projeto.
