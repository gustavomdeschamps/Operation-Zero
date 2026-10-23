// PORTO VESPER — terminal portuário costeiro (mapa original do OPERATION ZERO 3.0).
//
// Planta (x: oeste → leste, z: sul → norte):
//   norte  PORTARIA ............ surgimento dos defensores (ALFA), estação de munição
//          PÁTIO NORTE ......... rotação entre os objetivos
//   oeste  ARMAZÉM 3 ........... OBJETIVO A (interior com estantes e mezanino; portas norte, leste e sul)
//   centro CONTÊINERES ......... três rotas entre pilhas de contêineres + estação de munição central
//   leste  CAIS DE CARGA ....... OBJETIVO B (pórtico rolante, pilhas de contêineres, carga)
//   sul    CAIS ................ surgimento dos atacantes (ÔMEGA), mar além da borda
//
// Visual e colisão vêm deste mesmo layout. Tudo marcado `collide: false` é apenas acabamento.
import { TEAM } from '../protocol.js';
import { stairs, ammoStation, jersey, container } from './parts.js';

const BOUNDS = { minX: -32, maxX: 32, minZ: -40, maxZ: 40 };

const ZONES = [
  { name: 'PORTARIA', minX: -32, maxX: 32, minZ: 30, maxZ: 40 },
  { name: 'ARMAZÉM 3 — OBJETIVO A', minX: -32, maxX: -12, minZ: -8, maxZ: 20 },
  { name: 'CAIS DE CARGA — OBJETIVO B', minX: 12, maxX: 32, minZ: -12, maxZ: 18 },
  { name: 'PÁTIO NORTE', minX: -32, maxX: 32, minZ: 20, maxZ: 30 },
  { name: 'CONTÊINERES', minX: -12, maxX: 12, minZ: -20, maxZ: 20 },
  { name: 'CAIS', minX: -32, maxX: 32, minZ: -40, maxZ: -12 },
];

const AMMO_STATIONS = [
  { x: 8, z: 38.6, rotY: Math.PI },
  { x: 1.5, z: 3.6, rotY: 0 },
];

const faceCenter = (x, z) => Math.atan2(x, z);
const sp = (x, z, yaw = faceCenter(x, z)) => ({ x, z, yaw });

const ONLINE_SPAWNS = {
  tdm: [
    sp(-26, 31.5), sp(0, 35), sp(24, 35), sp(-6, 24), sp(10, 24), sp(-27, 18), sp(-18.5, -1.5), sp(21, 21),
    sp(28.8, -3), sp(16, -15), sp(0, 13), sp(-4.5, -15), sp(11, -21), sp(-24, -30), sp(0, -34), sp(24, -32),
  ],
  // Tático: defensores (ALFA) na portaria; atacantes (ÔMEGA) no cais
  [TEAM.ALFA]: [sp(-6, 35, 0), sp(-3, 36.5, 0), sp(0, 35, 0), sp(3, 36.5, 0), sp(6, 35, 0)],
  [TEAM.OMEGA]: [sp(-6, -35, Math.PI), sp(-3, -36, Math.PI), sp(0, -35, Math.PI), sp(3, -36, Math.PI), sp(6, -35, Math.PI)],
};

const SITES = {
  A: { id: 'A', minX: -27, maxX: -15, minZ: -6, maxZ: 4, cx: -21, cz: -1 },
  B: { id: 'B', minX: 15, maxX: 27, minZ: -4, maxZ: 9, cx: 21, cz: 2.5 },
};

const H_WALL = 6;

function shell(B) {
  B.box(-34, 34, -1, 0, -42, 42, 'asphalt', { castShadow: false });
  // concreto do cais (sul) e faixa de rolamento
  B.box(-32, 32, 0, 0.02, -40, -18, 'floor', { collide: false, castShadow: false });
  // muros do terminal (norte, oeste, leste)
  B.box(-34, 34, 0, H_WALL, 40, 42, 'concrete');
  B.box(-34, -32, 0, H_WALL, -40, 40, 'concrete');
  B.box(32, 34, 0, H_WALL, -40, 40, 'concrete');
  for (let z = -36; z <= 36; z += 8) {
    B.box(-32, -31.5, 0, H_WALL, z - 0.4, z + 0.4, 'concreteDark');
    B.box(31.5, 32, 0, H_WALL, z - 0.4, z + 0.4, 'concreteDark');
  }
  for (let x = -28; x <= 28; x += 8) B.box(x - 0.4, x + 0.4, 0, H_WALL, 39.5, 40, 'concreteDark');
  B.box(-32, 32, H_WALL, H_WALL + 0.2, 39.8, 40.2, 'metalTrim', { collide: false });
  B.box(-32.2, -31.8, H_WALL, H_WALL + 0.2, -40, 40, 'metalTrim', { collide: false });
  B.box(31.8, 32.2, H_WALL, H_WALL + 0.2, -40, 40, 'metalTrim', { collide: false });
  // arame no topo dos muros
  for (const x of [-31.9, 31.9]) B.pipe([x, H_WALL + 0.55, -39.8], [x, H_WALL + 0.55, 39.8], 0.03, 'metalTrim');
  B.pipe([-31.8, H_WALL + 0.55, 39.9], [31.8, H_WALL + 0.55, 39.9], 0.03, 'metalTrim');
  // borda do cais: meio-fio, defensas e cabeços de amarração
  B.box(-32, 32, 0, 0.35, -40.6, -40, 'concreteLight');
  B.box(-32, 32, -1.6, 0.0, -41.2, -40.6, 'concreteDark', { collide: false });
  for (let x = -28; x <= 28; x += 7) {
    B.solid(x - 0.3, x + 0.3, 0, 0.7, -39.9, -39.3, 'metal');
    B.cylinder(0.26, 0.3, 0.6, 12, 'steelBlue', [x, 0.3, -39.6]);
    B.cylinder(0.36, 0.36, 0.1, 12, 'steelBlue', [x, 0.65, -39.6]);
    B.box(x - 0.9, x + 0.9, -1.2, -0.2, -40.75, -40.6, 'rubber', { collide: false });
  }
  B.water(-140, 140, -260, -40.4, -0.9);
}

function gatehouse(B) {
  // guarita e escritório da portaria (noroeste)
  B.box(-31.5, -20, 0, 3.4, 33, 39.5, 'concreteLight');
  B.box(-31.6, -19.9, 3.4, 3.6, 32.9, 39.6, 'metalTrim');
  B.box(-20.06, -19.96, 1.1, 2.5, 34, 38.4, 'glassDark', { collide: false });
  for (let x = -30; x < -20.5; x += 2.4) B.box(x, x + 1.8, 1.2, 2.5, 32.96, 33.02, 'glassDark', { collide: false });
  B.box(-28, -24, 3.6, 4.6, 35, 37.5, 'containerGray');               // casa de máquinas no telhado
  B.sign([{ text: 'TERMINAL 4', size: 60 }, { text: 'PORTO VESPER', size: 30, color: '#3ef0ff' }], { position: [-25.75, 2.9, 32.96], rotationY: Math.PI, width: 3.2, height: 1.2 });
  // cancela e cabine
  B.box(-16, -14.6, 0, 2.6, 36.2, 38.4, 'steelBlue');
  B.box(-15.95, -14.65, 1.3, 2.3, 36.15, 36.22, 'glassDark', { collide: false });
  B.box(-14.6, -6, 1.0, 1.12, 37.2, 37.3, 'hazard', { collide: false });
  // caminhões estacionados (cavalo + baú)
  for (const [x, mat] of [[14, 'containerTeal'], [21, 'containerOrange']]) {
    B.box(x, x + 2.5, 0, 3.0, 29.5, 31.8, 'steelBlue');
    B.box(x + 0.1, x + 2.4, 1.6, 2.6, 29.45, 29.52, 'glassDark', { collide: false });
    B.box(x, x + 2.5, 0.9, 3.5, 32.2, 39.2, mat);
    B.box(x - 0.05, x + 2.55, 0.0, 0.9, 32.6, 33.4, 'rubber');
    B.box(x - 0.05, x + 2.55, 0.0, 0.9, 37.6, 38.8, 'rubber');
  }
  B.crate(26, 27.6, 0, 1.4, 36.5, 38.1);
  B.crate(26.2, 27.4, 1.4, 2.4, 36.7, 37.9);
  B.crate(28.2, 29.6, 0, 1.2, 37.2, 38.6);
  ammoStation(B, AMMO_STATIONS[0].x, AMMO_STATIONS[0].z, AMMO_STATIONS[0].rotY);
  // linha de barreiras que separa a portaria do pátio (com passagens)
  for (const [a, b] of [[-31.5, -26], [-20, -12], [-4, 4], [12, 18], [26, 31.5]]) jersey(B, a, b, 29.7, 30.3);
  // marcações de piso
  B.paint(-2, 2, 33.4, 33.5, 'paintCyan');
  B.paint(-2, 2, 37.9, 38.0, 'paintCyan');
  B.paint(-2, -1.9, 33.4, 38, 'paintCyan');
  B.paint(1.9, 2, 33.4, 38, 'paintCyan');
  for (let x = -30; x <= 30; x += 6) B.paint(x, x + 3, 31.2, 31.32, 'paintWhite');
}

function warehouse(B) {
  // Armazém 3: x -32..-12, z -8..20. Paredes de 0,5 m e 7 m de altura.
  const H = 7, x0 = -32, x1 = -12, z0 = -8, z1 = 20, t = 0.5;
  // parede norte com porta (x -24..-19)
  B.box(x0, -24, 0, H, z1 - t, z1, 'containerGray');
  B.box(-19, x1, 0, H, z1 - t, z1, 'containerGray');
  B.box(-24, -19, 3.2, H, z1 - t, z1, 'containerGray');
  // parede leste com porta lateral (z 2..6) e janela (z 12..15)
  B.box(x1 - t, x1, 0, H, z0, 2, 'containerGray');
  B.box(x1 - t, x1, 0, H, 6, 12, 'containerGray');
  B.box(x1 - t, x1, 0, 1.1, 12, 15, 'containerGray');
  B.box(x1 - t, x1, 2.4, H, 12, 15, 'containerGray');
  B.box(x1 - t, x1, 0, H, 15, z1, 'containerGray');
  B.box(x1 - t, x1, 3.0, H, 2, 6, 'containerGray');
  // parede sul com portão de enrolar (x -27..-21) parcialmente aberto
  B.box(x0, -27, 0, H, z0, z0 + t, 'containerGray');
  B.box(-21, x1, 0, H, z0, z0 + t, 'containerGray');
  B.box(-27, -21, 3.4, H, z0, z0 + t, 'containerGray');
  B.box(-27, -21, 3.0, 3.4, z0 - 0.1, z0 + 0.6, 'steelBlue', { collide: false });  // porta enrolada
  // batentes
  for (const [a, b, zz] of [[-24, -19, z1 - t], [-27, -21, z0]]) {
    B.box(a - 0.15, a, 0, 3.4, zz - 0.1, zz + t + 0.1, 'hazard', { collide: false });
    B.box(b, b + 0.15, 0, 3.4, zz - 0.1, zz + t + 0.1, 'hazard', { collide: false });
  }
  B.box(x1 - t - 0.1, x1 + 0.1, 0, 3.0, 1.85, 2.0, 'hazard', { collide: false });
  B.box(x1 - t - 0.1, x1 + 0.1, 0, 3.0, 6.0, 6.15, 'hazard', { collide: false });
  // telhado (sólido) e treliças
  B.box(x0, x1, H, H + 0.25, z0, z1, 'metal');
  for (let z = -6; z <= 18; z += 4) B.box(x0 + 0.5, x1 - 0.5, H - 0.5, H - 0.3, z - 0.1, z + 0.1, 'metalTrim', { collide: false });
  for (let z = -4; z <= 16; z += 8) B.lightBar(-28, -16, H - 0.55, H - 0.5, z - 0.1, z + 0.1, 'lightWarm');
  // estantes de carga (sólidas) com caixas
  for (const zz of [9, 14]) {
    B.box(-29.5, -22, 0, 0.12, zz, zz + 1.4, 'metalTrim');
    for (const y of [1.0, 2.0, 3.0]) B.box(-29.5, -22, y, y + 0.08, zz, zz + 1.4, 'steelBlue');
    for (const x of [-29.5, -25.8, -22.12]) B.box(x, x + 0.12, 0, 3.6, zz, zz + 1.4, 'containerOrange');
    B.solid(-29.5, -22, 0, 3.6, zz + 0.2, zz + 1.2, 'metal');
    for (let x = -29.2; x < -22.5; x += 1.25) {
      B.crate(x, x + 1.0, 0.12, 0.92, zz + 0.25, zz + 1.15);
      if ((x * 7) % 3 > 1) B.crate(x + 0.1, x + 0.9, 1.08, 1.86, zz + 0.3, zz + 1.1);
    }
  }
  // mezanino (oeste) com escada: posição elevada de defesa
  B.box(-32, -28.5, 0, 2.6, -6, 6, 'concreteDark');
  B.box(-28.55, -28.45, 2.6, 3.6, -6, 6, 'metalTrim');
  stairs(B, { x0: -31.6, x1: -28.6, z0: 6, z1: 10, axis: 'z', dir: -1, steps: 8, rise: 0.325 });
  B.box(-32, -28.5, 2.6, 2.68, -6.05, 6.05, 'hazard', { collide: false });
  // carga no objetivo A: contêiner, paletes e empilhadeira
  container(B, -25, -19, 0, 1.2, 3.64, 'containerBlue');
  B.crate(-17.4, -15.8, 0, 1.3, -5.6, -4.0);
  B.crate(-17.2, -16.0, 1.3, 2.3, -5.4, -4.2);
  B.box(-22.5, -21, 0, 0.16, -5.5, -4.1, 'woodDeck', { worldUV: false });
  B.box(-22.5, -21, 0.16, 1.1, -5.5, -4.1, 'containerGray');
  // empilhadeira
  B.box(-17.6, -15.6, 0, 1.4, 8.2, 10.6, 'containerYellow');
  B.box(-17.4, -15.8, 1.4, 2.3, 9.4, 10.5, 'metalTrim', { collide: false });
  B.box(-17.5, -15.7, 0.1, 0.18, 7.0, 8.2, 'metalTrim', { collide: false });
  B.wallLetter('A', [-21.5, 2.6, -7.46], 0, 2.6, '#e9eef2');
  B.floorLetter('A', -21, 0.5, 3.4, '#e9eef2', Math.PI);
  B.sign([{ text: 'ARMAZÉM 3', size: 64 }, { text: 'OBJETIVO A  ◀', size: 32, color: '#3ef0ff' }], { position: [-21.5, 4.6, 20.04], width: 3, height: 1.125 });
}

function containerYard(B) {
  // corredor de contêineres (centro): três rotas norte-sul
  container(B, -9.8, -7.36, 0, 13, 19.06, 'containerTeal');
  container(B, -9.8, -7.36, 2.6, 13.4, 19.46, 'containerOrange');
  container(B, 7.36, 9.8, 0, 13, 19.06, 'containerRust');
  container(B, 7.36, 9.8, 2.6, 12.6, 18.66, 'containerGreen');
  container(B, -3.03, 3.03, 0, 8, 10.44, 'containerBlue');
  container(B, -9.8, -3.74, 0, -0.5, 1.94, 'containerYellow');
  container(B, -9.4, -3.34, 2.6, -0.5, 1.94, 'containerTeal');
  container(B, 3.74, 9.8, 0, -4, -1.56, 'containerGreen');
  container(B, -2.4, 0.04, 0, -13, -6.94, 'containerOrange');
  container(B, -2.4, 0.04, 2.6, -12.6, -6.54, 'containerGray');
  container(B, 5, 7.44, 0, -16, -9.94, 'containerBlue');
  container(B, -9.2, -6.76, 0, -16.5, -10.44, 'containerRust');
  // caixas soltas e barreiras entre as pilhas
  B.crate(3.6, 5.0, 0, 1.3, 13.6, 15.0);
  B.crate(-5.2, -4.0, 0, 1.0, 5.0, 6.2);
  B.crate(9.6, 11.0, 0, 1.2, 4.4, 5.8);
  jersey(B, -6, -3.6, -19.6, -19);
  jersey(B, 2.4, 4.8, -19.6, -19);
  // torre de controle (plataforma baixa ao norte do corredor)
  B.box(-3, 3, 0, 2.4, 20.5, 25, 'concreteDark');
  B.box(-3.05, 3.05, 2.4, 2.48, 20.45, 25.05, 'metalTrim', { collide: false });
  B.box(-3, 3, 2.4, 3.3, 24.85, 25, 'metalTrim');
  B.box(-3, -2.85, 2.4, 3.3, 20.5, 25, 'metalTrim');
  B.box(2.85, 3, 2.4, 3.3, 20.5, 25, 'metalTrim');
  stairs(B, { x0: 3, x1: 6, z0: 22.6, z1: 24.6, axis: 'x', dir: -1, steps: 8, rise: 0.3 });
  B.box(-2.4, 2.4, 2.48, 5.2, 23.2, 24.6, 'glassDark', { collide: false });
  B.box(-2.6, 2.6, 5.2, 5.4, 22.9, 24.9, 'metal', { collide: false });
  B.sign([{ text: 'CONTROLE', size: 62 }, { text: 'TERMINAL 4', size: 30, color: '#3ef0ff' }], { position: [0, 1.5, 20.44], rotationY: Math.PI, width: 2.4, height: 0.9 });
  ammoStation(B, AMMO_STATIONS[1].x, AMMO_STATIONS[1].z, AMMO_STATIONS[1].rotY);
  // faixas de tráfego
  for (let z = -18; z < 18; z += 3) B.paint(-5.1, -4.9, z, z + 1.6, 'paintYellow');
  for (let z = -18; z < 18; z += 3) B.paint(10.9, 11.1, z, z + 1.6, 'paintYellow');
}

function cargoDock(B) {
  // cais de carga (leste) com pórtico rolante sobre trilhos
  for (const [x, z] of [[13.5, -10], [13.5, 15], [30, -10], [30, 15]]) {
    B.box(x - 0.7, x + 0.7, 0, 1.0, z - 0.7, z + 0.7, 'concreteDark');
    B.box(x - 0.45, x + 0.45, 1.0, 14, z - 0.45, z + 0.45, 'containerYellow');
  }
  B.crane(13.5, 30, -10, 15, 14);
  B.paint(13.2, 13.8, -12, 17, 'paintWhite');
  B.paint(29.7, 30.3, -12, 17, 'paintWhite');
  // pilhas de contêineres (cobertura do objetivo B)
  container(B, 16, 22.06, 0, 10.5, 12.94, 'containerRust');
  container(B, 16.4, 22.46, 2.6, 10.5, 12.94, 'containerBlue');
  container(B, 25, 27.44, 0, -6.5, -0.44, 'containerGreen');
  container(B, 22, 28.06, 0, 14.5, 16.94, 'containerOrange');
  // carga no objetivo B
  B.crate(17.2, 18.8, 0, 1.5, -2.8, -1.2);
  B.crate(17.4, 18.6, 1.5, 2.6, -2.6, -1.4);
  B.crate(19.2, 20.4, 0, 1.0, -3.0, -1.8);
  B.crate(22.6, 24.0, 0, 1.3, 5.2, 6.6);
  B.box(19.5, 21.5, 0, 0.16, 6.4, 8.0, 'woodDeck', { worldUV: false });
  B.box(19.5, 21.5, 0.16, 1.3, 6.4, 8.0, 'containerGray');
  // carretel de cabos e bobinas
  B.solid(28.6, 30.6, 0, 1.6, 1.4, 4.4, 'metal');
  B.cylinder(0.8, 0.8, 2.0, 20, 'woodDeck', [29.6, 0.8, 2.9], [0, 0, Math.PI / 2]);
  B.cylinder(0.85, 0.85, 0.12, 20, 'steelBlue', [28.65, 0.8, 2.9], [0, 0, Math.PI / 2]);
  B.cylinder(0.85, 0.85, 0.12, 20, 'steelBlue', [30.55, 0.8, 2.9], [0, 0, Math.PI / 2]);
  B.wallLetter('B', [26.2, 1.4, -0.4], 0, 2.2, '#e9eef2');
  B.floorLetter('B', 21, 2.5, 3.4, '#e9eef2', Math.PI);
  B.sign([{ text: 'CAIS DE CARGA', size: 54 }, { text: 'OBJETIVO B  ▶', size: 32, color: '#3ef0ff' }], { position: [22, 2.0, 17.0], width: 3.2, height: 1.2 });
  // barreiras ao norte do cais de carga (rota dos defensores)
  jersey(B, 14, 17, 19, 19.6);
  jersey(B, 24, 27, 21.5, 22.1);
}

function quay(B) {
  // linha de contêineres que protege o surgimento dos atacantes
  container(B, -26, -19.94, 0, -25, -22.56, 'containerTeal');
  container(B, -14, -7.94, 0, -24.5, -22.06, 'containerOrange');
  container(B, -13.6, -7.54, 2.6, -24.5, -22.06, 'containerGray');
  container(B, 3, 9.06, 0, -25, -22.56, 'containerBlue');
  container(B, 15, 21.06, 0, -24, -21.56, 'containerRust');
  container(B, 26, 28.44, 0, -30, -23.94, 'containerGreen');
  // galpão de ferramentas e caixas no cais
  B.box(-31.5, -26, 0, 3.0, -34, -29, 'concreteLight');
  B.box(-31.6, -25.9, 3.0, 3.2, -34.1, -28.9, 'metalTrim');
  B.box(-26.06, -25.96, 1.0, 2.4, -33, -30, 'glassDark', { collide: false });
  B.crate(-18, -16.6, 0, 1.4, -31, -29.6);
  B.crate(16.6, 18, 0, 1.2, -33.4, -32);
  B.crate(-2.4, -1.0, 0, 1.1, -29.4, -28.0);
  // postes de iluminação do cais
  for (const x of [-20, 0, 20]) {
    B.box(x - 0.15, x + 0.15, 0, 7.5, -38.6, -38.3, 'metalTrim');
    B.box(x - 0.8, x + 0.8, 7.4, 7.6, -38.7, -38.2, 'metalTrim', { collide: false });
    B.lightBar(x - 0.7, x + 0.7, 7.35, 7.4, -38.6, -38.3, 'lightWarm');
  }
  // trilhos do guindaste ao longo do cais
  B.paint(-32, 32, -37.2, -37.05, 'paintWhite');
  B.paint(-32, 32, -27.2, -27.05, 'paintWhite');
  B.sign([{ text: 'CAIS 4', size: 66 }, { text: 'ÁREA DE ATRACAÇÃO', size: 28, color: '#ffcf6a' }], { position: [-28.75, 2.4, -28.94], width: 2.8, height: 1.05 });
}

function lampPosts(B) {
  for (const [x, z] of [[-6, 28], [18, 26], [-28, 24], [26, -14], [-8, -20], [10, 6]]) {
    B.box(x - 0.12, x + 0.12, 0, 6.5, z - 0.12, z + 0.12, 'metalTrim');
    B.box(x - 0.6, x + 0.6, 6.4, 6.55, z - 0.25, z + 0.25, 'metalTrim', { collide: false });
    B.lightBar(x - 0.5, x + 0.5, 6.35, 6.4, z - 0.18, z + 0.18, 'lightWarm');
  }
}

export const VESPER = {
  id: 'vesper',
  name: 'PORTO VESPER',
  bounds: BOUNDS,
  zones: ZONES,
  ammoStations: AMMO_STATIONS,
  offlineSpawn: { x: 0, z: 35, yaw: 0 },
  botSpawns: [],
  onlineSpawns: ONLINE_SPAWNS,
  sites: SITES,
  isSafeZone: (x, z) => z > 31,
  build(B) {
    shell(B);
    gatehouse(B);
    warehouse(B);
    containerYard(B);
    cargoDock(B);
    quay(B);
    lampPosts(B);
  },
  theme: {
    sky: { zenith: 0x3d6fb4, mid: 0x86aed8, horizon: 0xdfe8ee, ground: 0x4f5a62, sun: 0xfff1d6 },
    sunDir: [0.42, 0.62, -0.66],
    sunColor: 0xfff0dc, sunIntensity: 3.0,
    hemi: [0xcfe2ff, 0x5a5148, 0.7],
    fog: { color: 0xb7c7d4, density: 0.0072 },
    exposure: 1.05,
    skyline: 'port',
    lights: [
      [0xffdcae, 70, 22, -21, 6.3, 12],
      [0xffdcae, 70, 22, -21, 6.3, 0],
      [0xffdcae, 45, 18, -27, 6.0, -5],
      [0xcfe4ff, 40, 18, -16, 5.5, 5],
      [0x9ff4ff, 16, 16, 0, 3.2, 22.5],
    ],
  },
};
