// FOUNDRY-7 — definição única da arena (geometria, setores, pontos de surgimento e objetivos).
//
// O layout é descrito por chamadas a um "builder". O cliente (map.js) implementa um builder
// visual (malhas, materiais, sinalização); o servidor e a física usam o builder de colisão de
// arena-collision.js, que registra apenas as caixas sólidas. Assim, visual, movimento, tiros e
// validação do servidor derivam do MESMO código — não existem duas versões do mapa.
//
// Interface do builder (métodos não implementados pelo builder de colisão são apenas visuais):
//   box(x0,x1,y0,y1,z0,z1, material, { collide=true, texel, worldUV, castShadow })
//   solid(x0,x1,y0,y1,z0,z1, surface)      colisor sem malha própria
//   crate(x0,x1,y0,y1,z0,z1)                caixa sólida com UV por face
//   paint / lightBar / pipe / barrel / cylinder / torus / floorRing / sign / floorLetter /
//   wallLetter / ammoStationVisual            somente visual

import { TEAM } from './protocol.js';

/** Limites jogáveis (faces internas das paredes externas). */
export const BOUNDS = { minX: -25, maxX: 25, minZ: -44, maxZ: 44 };

export const ZONES = [
  { name: 'STAGING', minX: -25, maxX: 25, minZ: 31, maxZ: 44 },
  { name: 'CORREDOR CENTRAL', minX: -6, maxX: 6, minZ: 6, maxZ: 31 },
  { name: 'SETOR A — ARMAZÉM', minX: -25, maxX: -6, minZ: -6, maxZ: 31 },
  { name: 'SETOR B — PÁTIO', minX: 6, maxX: 25, minZ: -6, maxZ: 31 },
  { name: 'JUNÇÃO', minX: -6, maxX: 6, minZ: -6, maxZ: 6 },
  { name: 'OVERWATCH', minX: -17, maxX: 17, minZ: -44, maxZ: -39 },
  { name: 'SETOR C — LIVE FIRE', minX: -25, maxX: 25, minZ: -44, maxZ: -6 },
];

export function zoneAt(x, z) {
  for (const zn of ZONES) if (x >= zn.minX && x <= zn.maxX && z >= zn.minZ && z <= zn.maxZ) return zn.name;
  return 'FOUNDRY-7';
}

/** Estações de munição (reabastecem a reserva por proximidade). */
export const AMMO_STATIONS = [
  { x: -10, z: 42.6, rotY: Math.PI },
  { x: -8.5, z: -0.2, rotY: Math.PI / 2 },
];

/** Treinamento offline: surgimento do jogador e dos bots. */
export const OFFLINE_SPAWN = { x: 0, z: 39, yaw: 0 };

const bot = (id, x, z, extra = {}) => ({ id, x, z, type: 'static', ...extra });
export const BOT_SPAWNS = [
  bot('A1', -19, 12),
  bot('A2', -22, -1, { type: 'strafe', to: [-14, -1] }),
  bot('M1', 1.5, -1),
  bot('B1', 12, 17),
  bot('B2', 9, 4, { type: 'strafe', to: [16, 4] }),
  bot('B3', 22.5, 0),
  bot('C1', -6, -17),
  bot('C2', 7, -20),
  bot('C3', 4, -34, { type: 'strafe', to: [14, -34] }),
  bot('C4', -5, -41.2),
  bot('C5', 6, -41.2),
  bot('C6', -20, -36),
  bot('C7', 21.5, -30, { type: 'strafe', to: [21.5, -18] }),
  bot('C8', -12, -25),
];

const faceCenter = (x, z) => Math.atan2(x, z); // yaw que olha para (0,0) — câmera olha para -Z com yaw 0
const sp = (x, z, yaw = faceCenter(x, z)) => ({ x, z, yaw });

/**
 * Pontos de surgimento online. Todos são validados por teste automatizado
 * (não ficam dentro de sólidos e estão sobre o piso).
 */
export const ONLINE_SPAWNS = {
  // Combate por equipes: pontos espalhados; o servidor escolhe o mais distante dos inimigos vivos.
  tdm: [
    sp(-20, 38), sp(20, 38), sp(0, 35), sp(-20, 24), sp(-14, 12), sp(12, 26), sp(22, 10), sp(0, 16),
    sp(-3, 0), sp(-20, -12), sp(20, -12), sp(-8, -28), sp(8, -26), sp(-20, -40), sp(20, -38), sp(0, -36),
  ],
  // Tático: defensores (ALFA) na área de preparação; atacantes (ÔMEGA) no pátio de tiro.
  [TEAM.ALFA]: [sp(-6, 37, 0), sp(-3, 39, 0), sp(0, 37, 0), sp(3, 39, 0), sp(6, 37, 0)],
  [TEAM.OMEGA]: [sp(-6, -36, Math.PI), sp(-3, -35.5, Math.PI), sp(0, -36, Math.PI), sp(3, -35.5, Math.PI), sp(6, -36, Math.PI)],
};

/** Objetivos do modo tático (retângulos no piso). */
export const SITES = {
  A: { id: 'A', minX: -22, maxX: -12, minZ: 11, maxZ: 24, cx: -17, cz: 16 },
  B: { id: 'B', minX: 8, maxX: 20, minZ: 15, maxZ: 26, cx: 14, cz: 20 },
};

export function siteAt(x, z) {
  for (const s of Object.values(SITES)) if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) return s.id;
  return null;
}

/** Escada maciça (cada degrau é sólido até o chão). axis 'x' ou 'z', dir +1/-1 = sentido de subida. */
export function stairs(b, { x0, x1, z0, z1, axis, dir, steps, rise, y0 = 0, mat = 'concreteDark' }) {
  const len = axis === 'x' ? x1 - x0 : z1 - z0;
  const depth = len / steps;
  for (let i = 0; i < steps; i++) {
    const top = y0 + rise * (i + 1);
    let a, c;
    if (dir > 0) { a = (axis === 'x' ? x0 : z0) + depth * i; c = a + depth; } else { c = (axis === 'x' ? x1 : z1) - depth * i; a = c - depth; }
    if (axis === 'x') b.box(a, c, y0, top, z0, z1, mat);
    else b.box(x0, x1, y0, top, a, c, mat);
    // borda de segurança no degrau
    if (axis === 'x') b.box(dir > 0 ? a : c - 0.06, dir > 0 ? a + 0.06 : c, top - 0.02, top + 0.005, z0, z1, 'hazard', { collide: false, castShadow: false });
    else b.box(x0, x1, top - 0.02, top + 0.005, dir > 0 ? a : c - 0.06, dir > 0 ? a + 0.06 : c, 'hazard', { collide: false, castShadow: false });
  }
}

/** Estação de munição: a caixa é sólida; ícone, faixa e anel são visuais. */
function ammoStation(b, x, z, rotationY) {
  b.crate(x - 0.7, x + 0.7, 0, 0.9, z - 0.5, z + 0.5);
  b.box(x - 0.72, x + 0.72, 0.9, 0.96, z - 0.52, z + 0.52, 'metalTrim');
  b.ammoStationVisual(x, z, rotationY);
}

/** Marcadores visuais dos objetivos A/B (somente no modo tático online). */
export function siteMarkers(b) {
  for (const s of Object.values(SITES)) b.siteMarker(s);
}

/** Constrói toda a arena com o builder informado. */
export function buildArenaLayout(b) {
  shell(b);
  staging(b);
  midLane(b);
  warehouse(b);
  yard(b);
  junction(b);
  courtyard(b);
  signage(b);
}

// ---------------------------------------------------------------------------
// Setores
// ---------------------------------------------------------------------------

function shell(B) {
  const WH = 7.5;
  B.box(-27, 27, -1, 0, -46, 46, 'floor', { castShadow: false });
  B.box(-27, 27, 0, WH, -46, -44, 'concrete');
  B.box(-27, 27, 0, WH, 44, 46, 'concrete');
  B.box(-27, -25, 0, WH, -44, 44, 'concrete');
  B.box(25, 27, 0, WH, -44, 44, 'concrete');
  // coroamento metálico
  B.box(-25.2, 25.2, WH, WH + 0.25, -44.2, -43.8, 'metalTrim', { collide: false });
  B.box(-25.2, 25.2, WH, WH + 0.25, 43.8, 44.2, 'metalTrim', { collide: false });
  B.box(-25.2, -24.8, WH, WH + 0.25, -44, 44, 'metalTrim', { collide: false });
  B.box(24.8, 25.2, WH, WH + 0.25, -44, 44, 'metalTrim', { collide: false });
  // rodapé escuro
  B.box(-25, -24.94, 0, 0.35, -44, 44, 'rubber', { collide: false, worldUV: false });
  B.box(24.94, 25, 0, 0.35, -44, 44, 'rubber', { collide: false, worldUV: false });
  // pilastras rítmicas
  for (let z = -40; z <= 40; z += 8) {
    B.box(-25, -24.5, 0, WH, z - 0.45, z + 0.45, 'concreteDark');
    B.box(24.5, 25, 0, WH, z - 0.45, z + 0.45, 'concreteDark');
  }
  for (let x = -24; x <= 24; x += 8) {
    B.box(x - 0.45, x + 0.45, 0, WH, -44, -43.5, 'concreteDark');
  }
  // frisos horizontais
  B.box(-25, -24.92, 4.0, 4.12, -44, 44, 'metalTrim', { collide: false });
  B.box(24.92, 25, 4.0, 4.12, -44, 44, 'metalTrim', { collide: false });
  B.box(-25, 25, 4.0, 4.12, -44, -43.92, 'metalTrim', { collide: false });
  // tubulações ao longo das paredes externas
  B.pipe([-24.75, 5.4, -43.6], [-24.75, 5.4, 43.6], 0.12, 'steelBlue');
  B.pipe([-24.75, 5.75, -43.6], [-24.75, 5.75, 43.6], 0.07, 'metalTrim');
  B.pipe([24.75, 5.2, -43.6], [24.75, 5.2, 43.6], 0.16, 'containerRust');
  B.pipe([-24.6, 6.2, -43.75], [24.6, 6.2, -43.75], 0.1, 'steelBlue');
  for (let z = -36; z <= 36; z += 12) {
    B.box(-24.95, -24.55, 5.1, 5.85, z - 0.06, z + 0.06, 'metalTrim', { collide: false });
    B.box(24.55, 24.95, 4.9, 5.5, z - 0.06, z + 0.06, 'metalTrim', { collide: false });
  }
}

function staging(B) {
  // parede da área de preparação com três acessos
  const z0 = 31, z1 = 31.6, H = 4.2;
  for (const [a, b] of [[-25, -17], [-13, -2.5], [2.5, 13], [17, 25]]) B.box(a, b, 0, H, z0, z1, 'concrete');
  for (const [a, b] of [[-17, -13], [-2.5, 2.5], [13, 17]]) {
    B.box(a, b, 3.0, H, z0, z1, 'concrete');
    // batentes metálicos
    B.box(a - 0.02, a + 0.16, 0, 3.0, z0 - 0.08, z1 + 0.08, 'metalTrim');
    B.box(b - 0.16, b + 0.02, 0, 3.0, z0 - 0.08, z1 + 0.08, 'metalTrim');
    B.box(a, b, 2.86, 3.02, z0 - 0.08, z1 + 0.08, 'metalTrim');
    B.box(a, b, 0, 0.02, z0 - 0.3, z1 + 0.3, 'hazard', { collide: false, castShadow: false });
    B.lightBar(a + 0.4, b - 0.4, 3.05, 3.1, z0 - 0.12, z0 - 0.06);
  }
  B.box(-25, 25, H, H + 0.14, z0 - 0.05, z1 + 0.05, 'metalTrim', { collide: false });

  // cobertura com claraboias
  for (const [a, b] of [[-25, -10], [-7, 7], [10, 25]]) B.box(a, b, 5.6, 5.85, 32.4, 44, 'metal');
  B.box(-25, 25, 5.15, 5.6, 31.9, 32.5, 'metalTrim');
  for (const x of [-19, -8, 8, 19]) B.box(x - 0.2, x + 0.2, 0, 5.15, 31.95, 32.45, 'metalTrim');
  for (const x of [-10, -7, 7, 10]) B.box(x - 0.12, x + 0.12, 5.3, 5.6, 32.4, 44, 'metalTrim', { collide: false });
  for (const x of [-17, -2, 2, 17]) B.lightBar(x - 1.2, x + 1.2, 5.52, 5.6, 37.8, 38.0);

  // bancada e equipamentos
  B.box(-3, 3, 0, 0.92, 42.3, 43.3, 'metal');
  B.box(-3.05, 3.05, 0.92, 0.98, 42.25, 43.35, 'metalTrim');
  B.box(-2.6, 2.6, 1.3, 2.3, 43.9, 44, 'metalTrim', { collide: false });
  for (let i = 0; i < 5; i++) B.box(-2.2 + i * 1.1, -2.0 + i * 1.1, 1.35, 2.25, 43.82, 43.9, 'steelBlue', { collide: false });
  // armários
  for (let i = 0; i < 6; i++) {
    const x = 7.5 + i * 0.95;
    B.box(x, x + 0.9, 0, 2.1, 43.25, 44, 'steelBlue');
    B.box(x + 0.1, x + 0.8, 1.7, 1.78, 43.2, 43.26, 'metalTrim', { collide: false });
  }
  // caixas
  B.crate(-22.4, -20.8, 0, 1.3, 41.6, 43.2);
  B.crate(-22.2, -21.0, 1.3, 2.3, 41.8, 43.0);
  B.crate(-20.6, -19.6, 0, 0.9, 42.1, 43.1);
  B.crate(19.4, 21.0, 0, 1.2, 35.8, 37.4);
  // estação de munição A
  ammoStation(B, AMMO_STATIONS[0].x, AMMO_STATIONS[0].z, AMMO_STATIONS[0].rotY);
  // marcações de piso
  B.paint(-1.6, 1.6, 36.4, 36.5, 'paintCyan');
  B.paint(-1.6, 1.6, 41.5, 41.6, 'paintCyan');
  B.paint(-1.6, -1.5, 36.4, 41.6, 'paintCyan');
  B.paint(1.5, 1.6, 36.4, 41.6, 'paintCyan');
  for (let z = 32.2; z < 35.6; z += 1.1) B.paint(-0.06, 0.06, z, z + 0.6, 'paintWhite');
  B.paint(-15.15, -14.85, 32, 35, 'paintWhite');
  B.paint(14.85, 15.15, 32, 35, 'paintWhite');
}

function midLane(B) {
  const H = 4.5;
  for (const side of [-1, 1]) {
    const a = side < 0 ? -6.6 : 6.0, b = side < 0 ? -6.0 : 6.6;
    B.box(a, b, 0, H, 17, 31, 'concrete');
    B.box(a, b, 0, H, 6, 14, 'concrete');
    B.box(a, b, 0, 1.05, 14, 17, 'concrete');
    B.box(a, b, 2.4, H, 14, 17, 'concrete');
    // moldura da janela
    B.box(a - 0.06, b + 0.06, 1.0, 1.08, 13.9, 17.1, 'metalTrim');
    B.box(a - 0.06, b + 0.06, 2.34, 2.42, 13.9, 17.1, 'metalTrim');
    B.box(a - 0.04, b + 0.04, H, H + 0.15, 6, 31, 'metalTrim', { collide: false });
    // calha de cabos
    const x = side < 0 ? -5.92 : 5.92;
    B.box(x - 0.08, x + 0.08, 3.6, 3.75, 6.2, 30.8, 'metalTrim', { collide: false });
    B.pipe([side < 0 ? -5.9 : 5.9, 3.95, 6.2], [side < 0 ? -5.9 : 5.9, 3.95, 30.8], 0.05, 'containerRust');
    B.lightBar(x - 0.03, x + 0.03, 0.25, 0.3, 7, 13);
    B.lightBar(x - 0.03, x + 0.03, 0.25, 0.3, 18, 30);
  }
  // vigas superiores e luminárias
  for (const c of [27, 19, 11]) {
    B.box(-6.6, 6.6, H, H + 0.45, c - 0.25, c + 0.25, 'metalTrim');
    B.box(-1.0, 1.0, H - 0.18, H, c - 0.18, c + 0.18, 'metalTrim', { collide: false });
    B.lightBar(-0.9, 0.9, H - 0.2, H - 0.18, c - 0.12, c + 0.12, 'lightWarm');
  }
  // coberturas
  B.crate(-3.3, -1.8, 0, 1.15, 21.4, 22.9);
  B.crate(-1.8, -0.9, 0, 0.8, 21.7, 22.6);
  B.crate(2.2, 3.8, 0, 1.6, 11.0, 12.6);
  B.crate(2.4, 3.6, 1.6, 2.6, 11.2, 12.4);
  B.box(-3.8, -1.2, 0, 0.95, 7.6, 8.2, 'concreteLight');
  B.box(-3.8, -1.2, 0.95, 1.0, 7.58, 8.22, 'hazard', { collide: false });
  // pintura de faixa central
  for (let z = 7; z < 30; z += 2.2) B.paint(-0.08, 0.08, z, z + 1.2, 'paintYellow');
  B.paint(-5.9, -5.75, 6, 31, 'paintYellow');
  B.paint(5.75, 5.9, 6, 31, 'paintYellow');
}

function warehouse(B) {
  // cobertura do galpão
  B.box(-25, -11, 5.6, 5.85, 2, 28, 'metal');
  B.box(-11.4, -11.0, 5.15, 5.6, 2, 28, 'metalTrim');
  for (const z of [3, 11, 19, 27]) {
    B.box(-11.4, -11.0, 0, 5.15, z - 0.2, z + 0.2, 'metalTrim');
    B.box(-11.5, -10.9, 0, 0.25, z - 0.3, z + 0.3, 'metalTrim');
  }
  for (const z of [5, 9, 13, 17, 21, 25]) {
    B.box(-25, -11.2, 5.3, 5.6, z - 0.1, z + 0.1, 'metalTrim', { collide: false });
    B.lightBar(-20, -15, 5.25, 5.3, z - 0.08, z + 0.08, z % 8 === 1 ? 'lightWarm' : 'lightWarm');
  }
  // contêineres
  B.box(-24.4, -22, 0, 2.6, 14, 20, 'containerTeal');
  B.box(-24.4, -22, 2.6, 5.2, 14.6, 20.6, 'containerOrange');
  B.box(-17, -11.6, 0, 2.6, 6.5, 8.9, 'containerBlue');
  for (const [x0, x1, z0, z1, y0] of [[-24.4, -22, 14, 20, 0], [-24.4, -22, 14.6, 20.6, 2.6]]) {
    // reforços nas extremidades
    B.box(x0 - 0.04, x1 + 0.04, y0, y0 + 2.6, z0 - 0.04, z0 + 0.12, 'metalTrim', { collide: false });
    B.box(x0 - 0.04, x1 + 0.04, y0, y0 + 2.6, z1 - 0.12, z1 + 0.04, 'metalTrim', { collide: false });
  }
  B.box(-17.04, -16.88, 0, 2.6, 6.46, 8.94, 'metalTrim', { collide: false });
  B.box(-11.72, -11.56, 0, 2.6, 6.46, 8.94, 'metalTrim', { collide: false });
  // pilha de caixas
  B.crate(-15, -13.6, 0, 1.4, 23, 24.4);
  B.crate(-13.4, -12.2, 0, 1.2, 23.2, 24.4);
  B.crate(-14.8, -13.8, 1.4, 2.4, 23.2, 24.2);
  // barris
  B.solid(-24.25, -22.3, 0, 0.92, 8.4, 10.8);
  B.barrel(-23.6, 9.0); B.barrel(-22.9, 9.6, 0, 'containerRust'); B.barrel(-23.6, 10.2);
  // paletes
  B.box(-20, -18.6, 0, 0.16, 25, 26.4, 'crate', { worldUV: false });
  B.box(-20, -18.6, 0.16, 0.5, 25, 26.4, 'containerGray');
  // muro de saída
  B.box(-25, -19, 0, 4.2, -6, -5.4, 'concrete');
  B.box(-25, -19, 4.2, 4.34, -6.05, -5.35, 'metalTrim', { collide: false });
  B.wallLetter('A', [-17.0, 1.6, 8.92], 0, 2.4, '#e9eef2');
  B.floorLetter('A', -16.5, 16, 3.2, '#e9eef2', Math.PI);
}

function yard(B) {
  const jersey = (x0, x1, z0, z1) => {
    B.box(x0, x1, 0, 0.95, z0, z1, 'concreteLight');
    if (x1 - x0 > z1 - z0) B.box(x0, x1, 0.18, 0.3, z0 - 0.01, z1 + 0.01, 'hazard', { collide: false });
    else B.box(x0 - 0.01, x1 + 0.01, 0.18, 0.3, z0, z1, 'hazard', { collide: false });
  };
  jersey(9.5, 12, 22, 22.6);
  jersey(16.7, 17.3, 15, 17.5);
  jersey(20, 22.5, 25, 25.6);
  jersey(10, 12.5, 7.5, 8.1);
  // contêiner
  B.box(14, 20, 0, 2.6, 10.8, 13.2, 'containerRust');
  B.box(13.96, 14.12, 0, 2.6, 10.76, 13.24, 'metalTrim', { collide: false });
  B.box(19.88, 20.04, 0, 2.6, 10.76, 13.24, 'metalTrim', { collide: false });
  // tanque de combustível
  B.solid(21.4, 23.8, 0, 2.7, 16, 22);
  B.cylinder(1.18, 1.18, 5.6, 24, 'containerGray', [22.6, 1.5, 19], [Math.PI / 2, 0, 0]);
  for (const z of [17.0, 21.0]) B.box(21.6, 23.6, 0, 0.75, z - 0.2, z + 0.2, 'metalTrim', { collide: false });
  for (const z of [16.6, 19, 21.4]) B.torus(1.2, 0.04, 6, 28, 'metalTrim', [22.6, 1.5, z]);
  B.pipe([22.6, 2.68, 18.2], [22.6, 3.3, 18.2], 0.08, 'metalTrim');
  B.pipe([22.6, 3.3, 18.2], [24.7, 3.3, 18.2], 0.08, 'metalTrim');
  // torre de observação
  B.box(19.5, 25, 0, 2.4, -4, 3, 'concreteDark');
  B.box(19.45, 25, 2.4, 2.48, -4.05, 3.05, 'metalTrim', { collide: false });
  stairs(B, { x0: 15.5, x1: 19.5, z0: -4, z1: -1.8, axis: 'x', dir: 1, steps: 8, rise: 0.3 });
  B.box(19.45, 19.6, 2.4, 3.4, -1.8, 3, 'metalTrim');
  B.box(19.5, 25, 2.4, 3.4, 2.85, 3.0, 'metalTrim');
  B.box(19.5, 25, 2.4, 3.35, -4, -3.7, 'concrete');
  B.box(15.5, 19.5, 0, 1.1, -1.82, -1.7, 'metalTrim');
  B.box(17.5, 19.5, 1.1, 2.4, -1.82, -1.7, 'metalTrim');
  for (let x = 15.6; x < 19.5; x += 0.9) B.box(x, x + 0.05, 0.2 + (x - 15.5) * 0.6, 1.2 + (x - 15.5) * 0.6, -4.05, -4.0, 'metalTrim', { collide: false });
  B.box(15.5, 19.5, 1.2, 1.25, -4.06, -3.99, 'metalTrim', { collide: false });
  B.box(23.6, 23.8, 3.4, 5.6, 2.6, 2.8, 'metalTrim', { collide: false });
  B.box(22.8, 23.9, 5.5, 5.62, 2.2, 2.9, 'metalTrim', { collide: false });
  B.lightBar(22.9, 23.8, 5.46, 5.5, 2.3, 2.8, 'lightWarm');
  B.wallLetter('B', [19.48, 1.3, 0.2], -Math.PI / 2, 2.2, '#e9eef2');
  B.floorLetter('B', 15, 20, 3.2, '#e9eef2', Math.PI);
  B.paint(7, 24.5, 28.6, 28.75, 'paintYellow');
}

function junction(B) {
  B.box(-6, -2.5, 0, 1.1, -6.3, -5.7, 'concreteLight');
  B.box(2.5, 6, 0, 1.1, -6.3, -5.7, 'concreteLight');
  B.box(-6, -2.5, 1.1, 1.16, -6.32, -5.68, 'metalTrim', { collide: false });
  B.box(2.5, 6, 1.1, 1.16, -6.32, -5.68, 'metalTrim', { collide: false });
  ammoStation(B, AMMO_STATIONS[1].x, AMMO_STATIONS[1].z, AMMO_STATIONS[1].rotY);
  B.paint(-6.6, 6.6, 5.9, 6.05, 'paintYellow');
}

function courtyard(B) {
  // núcleo central
  B.box(-3, 3, 0, 3.2, -25, -19, 'metal');
  B.box(-3.1, 3.1, 0, 0.3, -25.1, -18.9, 'metalTrim');
  B.box(-3.08, 3.08, 3.2, 3.36, -25.08, -18.92, 'metalTrim');
  B.box(-1.2, 1.2, 3.2, 6.4, -23.2, -20.8, 'metalTrim');
  B.box(-1.3, 1.3, 6.4, 6.55, -23.3, -20.7, 'metal', { collide: false });
  B.pipe([0, 6.5, -22], [0, 8.6, -22], 0.05, 'metalTrim');
  B.lightBar(-0.06, 0.06, 8.6, 8.75, -22.06, -21.94, 'lightRed');
  B.lightBar(-3.02, 3.02, 2.55, 2.65, -25.02, -24.98);
  B.lightBar(-3.02, 3.02, 2.55, 2.65, -19.02, -18.98);
  B.lightBar(-3.02, -2.98, 2.55, 2.65, -25.02, -18.98);
  B.lightBar(2.98, 3.02, 2.55, 2.65, -25.02, -18.98);
  B.lightBar(-1.22, 1.22, 5.6, 5.7, -23.22, -20.78);
  // pilares e pórtico rolante
  for (const [x, z] of [[-10, -14], [10, -14], [-10, -32], [10, -32]]) {
    B.box(x - 0.6, x + 0.6, 0, 6.2, z - 0.6, z + 0.6, 'concrete');
    B.box(x - 0.7, x + 0.7, 0, 0.4, z - 0.7, z + 0.7, 'concreteDark');
    B.box(x - 0.66, x + 0.66, 1.6, 1.9, z - 0.66, z + 0.66, 'hazard', { collide: false });
  }
  for (const z of [-14, -32]) {
    B.box(-10.6, 10.6, 5.6, 6.2, z - 0.3, z + 0.3, 'metalTrim');
    B.box(-10.6, 10.6, 6.2, 6.3, z - 0.34, z + 0.34, 'hazard', { collide: false });
  }
  for (const x of [-9.6, 9.6]) B.box(x - 0.2, x + 0.2, 5.75, 6.05, -31.7, -14.3, 'metalTrim', { collide: false });
  B.box(2, 3.4, 5.2, 5.6, -24, -22, 'containerGray', { collide: false });
  B.pipe([2.7, 5.2, -23], [2.7, 3.8, -23], 0.02, 'metalTrim');
  // coberturas
  B.box(-7.5, -5, 0, 0.95, -12.3, -11.7, 'concreteLight');
  B.box(5, 7.5, 0, 0.95, -12.3, -11.7, 'concreteLight');
  B.crate(-12.4, -11, 0, 1.4, -15, -13.6);
  B.crate(11, 12.2, 0, 1.2, -31.8, -30.6);
  B.crate(4.5, 6, 0, 1.3, -29, -27.5);
  B.crate(-6.2, -5, 0, 1.0, -30.6, -29.4);
  // contêineres
  B.box(-22, -16, 0, 2.6, -20.2, -17.8, 'containerBlue');
  B.box(16, 18.4, 0, 2.6, -27, -21, 'containerTeal');
  B.box(16, 18.4, 2.6, 5.2, -26.4, -21.6, 'containerGray');
  // corredor de teste de fumaça
  B.box(-16, -15.4, 0, 3.2, -37, -25.5, 'concrete');
  B.box(-16.05, -15.35, 3.2, 3.32, -37.05, -25.45, 'metalTrim', { collide: false });
  B.crate(-23.5, -22, 0, 1.4, -31, -29.5);
  // círculo de teste no piso
  B.floorRing(1.6, 1.75, 40, 'paintCyan', -20, -29.5);
  // plataforma de vigilância
  B.box(-12, 12, 0, 2.7, -44, -39, 'concreteDark');
  B.box(-12, 12, 2.7, 3.6, -39.3, -39, 'concrete');
  B.box(-12.05, 12.05, 3.6, 3.68, -39.35, -38.95, 'metalTrim', { collide: false });
  B.box(-12.05, 12.05, 2.62, 2.72, -39.05, -38.95, 'hazard', { collide: false });
  stairs(B, { x0: -17, x1: -12, z0: -43.6, z1: -41.2, axis: 'x', dir: 1, steps: 9, rise: 0.3 });
  stairs(B, { x0: 12, x1: 17, z0: -43.6, z1: -41.2, axis: 'x', dir: -1, steps: 9, rise: 0.3 });
  B.box(-17, -12, 0, 1.2, -41.2, -41.06, 'metalTrim');
  B.box(-14.5, -12, 1.2, 2.7, -41.2, -41.06, 'metalTrim');
  B.box(12, 17, 0, 1.2, -41.2, -41.06, 'metalTrim');
  B.box(12, 14.5, 1.2, 2.7, -41.2, -41.06, 'metalTrim');
  B.box(-12.15, -12, 2.7, 3.6, -41.2, -39.3, 'metalTrim');
  B.box(12, 12.15, 2.7, 3.6, -41.2, -39.3, 'metalTrim');
  for (let x = -11; x <= 11; x += 4) B.box(x - 0.9, x + 0.9, 0.6, 2.2, -39.02, -38.96, 'metal', { collide: false });
  B.lightBar(-11.6, 11.6, 2.35, 2.42, -38.98, -38.94);
  // trilhos dos alvos móveis
  B.paint(3.5, 14.5, -34.12, -33.88, 'paintCyan');
  B.paint(21.38, 21.62, -30.5, -17.5, 'paintCyan');
  B.paint(-22.5, -13.5, -1.12, -0.88, 'paintCyan');
  B.paint(8.5, 16.5, 3.88, 4.12, 'paintCyan');
  B.floorLetter('C', 0, -10, 3.6, '#e9eef2', 0);
}

function signage(B) {
  const style = { width: 512, height: 192 };
  B.sign([{ text: 'SETOR C', size: 64 }, { text: 'LIVE FIRE  ▲', size: 34, color: '#3ef0ff' }], { position: [0, 3.6, 31.66], rotationY: 0, width: 2.6, height: 0.975, style });
  B.sign([{ text: 'SETOR A', size: 64 }, { text: 'ARMAZÉM  ◀', size: 34, color: '#3ef0ff' }], { position: [-15, 3.6, 31.66], width: 2.6, height: 0.975, style });
  B.sign([{ text: 'SETOR B', size: 64 }, { text: 'PÁTIO  ▶', size: 34, color: '#3ef0ff' }], { position: [15, 3.6, 31.66], width: 2.6, height: 0.975, style });
  B.sign([{ text: 'STAGING // 00', size: 58 }, { text: 'ÁREA SEGURA — SEM FOGO HOSTIL', size: 26, color: '#ffcf6a' }], { position: [0, 3.4, 30.94], rotationY: Math.PI, width: 3.4, height: 1.275, style });
  B.sign([
    { text: 'OPERATION ZERO', size: 54 },
    { text: 'PROTOCOLO DE TREINAMENTO 07', size: 28, color: '#3ef0ff' },
    { text: 'ELIMINE OS ALVOS HOSTIS', size: 26, color: '#c9d2da', weight: 400 },
  ], { position: [0, 3.55, 43.97], rotationY: Math.PI, width: 5.2, height: 1.95, style: { width: 640, height: 240 } });
  B.sign([{ text: 'ZONA DE TESTE', size: 50 }, { text: 'FUMAÇA [E]', size: 40, color: '#3ef0ff' }], { position: [-15.38, 2.4, -29], rotationY: -Math.PI / 2, width: 2.4, height: 0.9, style });
  B.sign([{ text: 'CORE-7', size: 72, color: '#e9eef2' }, { text: 'NÃO OBSTRUIR', size: 30, color: '#ff6a5a' }], { position: [0, 1.7, -18.93], width: 2.0, height: 0.75, style });
  B.sign([{ text: 'OVERWATCH', size: 60 }, { text: 'PLATAFORMA DE VIGILÂNCIA', size: 26, color: '#3ef0ff' }], { position: [0, 1.4, -38.92], width: 3.2, height: 1.2, style });
  B.sign([{ text: 'MUNIÇÃO', size: 56 }, { text: 'APROXIME-SE PARA REABASTECER', size: 22, color: '#3ef0ff' }], { position: [-10, 2.0, 43.97], rotationY: Math.PI, width: 2.0, height: 0.75, style });
}
