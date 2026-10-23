// Equipamento original dos operadores (modelado em código para o OPERATION ZERO): porta-carregadores,
// placas, ombreiras, rádio com antena, bolsas utilitárias e emblemas de braço com o símbolo de cada
// operador. Reforça a silhueta e a função de cada um sobre a base humana (Microsoft Rocketbox, MIT).
//
// Cada peça é descrita no espaço do personagem (x direita, y cima, z frente, metros) a partir de um
// osso; na primeira instância de cada operador as peças são convertidas para o espaço local do osso
// e fundidas (uma malha por osso e material), e as instâncias seguintes reutilizam a geometria.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const SYMBOLS = {
  gaviao: 'M4 18 L13 8 L22 18 M4 24 L13 14 L22 24',
  basalto: 'M13 3 L22 6 V13 C22 18 18 22 13 24 C8 22 4 18 4 13 V6 Z',
  corvo: 'M2 13 C6 6 20 6 24 13 C20 20 6 20 2 13 Z M13 9.5 A3.5 3.5 0 1 0 13 16.5 A3.5 3.5 0 1 0 13 9.5 Z',
  lince: 'M13 2 L24 13 L13 24 L2 13 Z M13 8 L18 13 L13 18 L8 13 Z',
};

// [osso, material, forma, dimensões, posição (relativa ao osso, eixos do personagem), rotação (graus, opcional)]
const GEAR = {
  gaviao: [ // ASSALTO: porta-carregadores frontais e emblema
    ['spine2', 'nylon', 'box', [0.3, 0.15, 0.05], [0, -0.08, 0.13]],
    ['spine2', 'plate', 'box', [0.07, 0.12, 0.035], [-0.09, -0.02, 0.165], [-6, 0, 0]],
    ['spine2', 'plate', 'box', [0.07, 0.12, 0.035], [0, -0.02, 0.17], [-6, 0, 0]],
    ['spine2', 'plate', 'box', [0.07, 0.12, 0.035], [0.09, -0.02, 0.165], [-6, 0, 0]],
    ['spine', 'nylon', 'box', [0.12, 0.08, 0.05], [0.13, -0.02, 0.1]],
    ['L.upper', 'patch', 'box', [0.006, 0.075, 0.075], [-0.075, -0.1, 0.0]],
  ],
  basalto: [ // DEFESA: placa frontal reforçada, ombreiras e rádio de ombro
    ['spine2', 'plate', 'box', [0.33, 0.26, 0.05], [0, -0.06, 0.14], [-4, 0, 0]],
    ['spine2', 'metal', 'box', [0.12, 0.02, 0.01], [0, 0.03, 0.17]],
    ['L.upper', 'plate', 'box', [0.06, 0.05, 0.15], [-0.05, -0.02, 0.0], [0, 0, 18]],
    ['R.upper', 'plate', 'box', [0.06, 0.05, 0.15], [0.05, -0.02, 0.0], [0, 0, -18]],
    ['L.clav', 'metal', 'box', [0.05, 0.09, 0.035], [-0.03, 0.06, 0.09]],
    ['L.clav', 'metal', 'cyl', [0.005, 0.2], [-0.045, 0.19, 0.09]],
    ['R.upper', 'patch', 'box', [0.006, 0.075, 0.075], [0.08, -0.12, 0.0]],
  ],
  corvo: [ // RECONHECIMENTO: mochila de rádio com antena longa e luz de status
    ['spine2', 'nylon', 'box', [0.26, 0.32, 0.12], [0, 0.0, -0.18]],
    ['spine2', 'plate', 'box', [0.2, 0.08, 0.03], [0, -0.08, -0.25]],
    ['spine2', 'metal', 'cyl', [0.006, 0.46], [0.09, 0.32, -0.2], [0, 0, -8]],
    ['spine2', 'led', 'box', [0.025, 0.012, 0.006], [-0.06, 0.1, -0.245]],
    ['spine', 'nylon', 'box', [0.1, 0.08, 0.05], [-0.13, -0.03, 0.1]],
    ['L.upper', 'patch', 'box', [0.006, 0.075, 0.075], [-0.075, -0.1, 0.0]],
  ],
  lince: [ // ESPECIALISTA: tablete tático no peito, cinto com bolsas e granadas de fumaça
    ['spine2', 'plate', 'box', [0.15, 0.1, 0.02], [0, -0.04, 0.15], [-12, 0, 0]],
    ['spine2', 'led', 'box', [0.11, 0.06, 0.004], [0, -0.04, 0.162], [-12, 0, 0]],
    ['pelvis', 'nylon', 'box', [0.09, 0.09, 0.06], [0.15, 0.02, 0.08]],
    ['pelvis', 'nylon', 'box', [0.09, 0.09, 0.06], [-0.15, 0.02, 0.08]],
    ['pelvis', 'metal', 'cyl', [0.03, 0.11], [0.19, 0.0, -0.02]],
    ['pelvis', 'metal', 'cyl', [0.03, 0.11], [-0.19, 0.0, -0.02]],
    ['L.upper', 'patch', 'box', [0.006, 0.075, 0.075], [-0.07, -0.1, 0.0]],
  ],
};

let MATS = null;
const patchMats = new Map();
// cores por peça (uma única malha com cores por vértice: 1 chamada de desenho por personagem)
const COLORS = { nylon: 0x33362f, plate: 0x3c4249, metal: 0x6a7077, led: 0x7ff6ff };
function materials() {
  if (MATS) return MATS;
  MATS = { gear: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.28 }) };
  return MATS;
}

/** Emblema de braço: símbolo do operador sobre tecido (desenho original, canvas). */
function patchMaterial(operator) {
  let m = patchMats.get(operator);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#2b2e28'; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#8b8f84'; g.lineWidth = 3; g.strokeRect(3, 3, 58, 58);
  g.translate(6, 6); g.scale(2, 2);
  g.strokeStyle = '#d6dbd2'; g.lineWidth = 2.2; g.lineJoin = 'round';
  g.stroke(new Path2D(SYMBOLS[operator] || SYMBOLS.lince));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
  patchMats.set(operator, m);
  return m;
}

const cache = new Map();   // operador → [{ mat, geometry }] (geometria com pesos de pele)
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();

function boneOf(bones, path) { return path.split('.').reduce((o, k) => (o ? o[k] : null), bones); }
const bodyMesh = (character) => character.instance.meshes.find((m) => m.isSkinnedMesh);

/**
 * Constrói (uma vez por operador) a geometria do equipamento como malha com pele rígida: cada peça
 * tem peso 1 no seu osso. Assim a GPU anima o equipamento junto com o corpo, sem objetos extras na
 * cena para a CPU atualizar a cada quadro.
 */
function build(character) {
  const spec = GEAR[character.operator];
  const body = bodyMesh(character);
  if (!spec || !body) return [];
  const skel = body.skeleton;
  // pose de referência: parado (mesma para todas as instâncias)
  character.idle.setEffectiveWeight(1);
  character.idle.time = 0;
  character.mixer.update(0);
  character.root.updateMatrixWorld(true);
  const B = character.bones;
  const L = B.L.clav.getWorldPosition(new THREE.Vector3());
  const R = B.R.clav.getWorldPosition(new THREE.Vector3());
  const right = R.sub(L).setY(0).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const fwd = new THREE.Vector3().crossVectors(up, right);
  const basis = new THREE.Matrix4().makeBasis(right, up, fwd);
  const groups = new Map();
  for (const [path, mat, shape, dims, at, rot] of spec) {
    const bone = boneOf(B, path);
    const index = bone ? skel.bones.indexOf(bone) : -1;
    if (index < 0) continue;
    const geo = shape === 'cyl' ? new THREE.CylinderGeometry(dims[0], dims[0], dims[1], 10) : new THREE.BoxGeometry(dims[0], dims[1], dims[2]);
    if (rot) geo.applyMatrix4(_m.makeRotationFromEuler(new THREE.Euler(rot[0] * Math.PI / 180, rot[1] * Math.PI / 180, rot[2] * Math.PI / 180)));
    const world = new THREE.Matrix4().copy(basis);
    world.setPosition(bone.getWorldPosition(_v).add(new THREE.Vector3(...at).applyMatrix4(basis)));
    // espaço local do osso → espaço de ligação da malha do corpo (inverso do que o skinning aplica)
    const local = new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(world);
    // (no modo "attached" do three.js a posição final é ossoMundo · boneInverse · bindMatrix · P)
    const bindSpace = new THREE.Matrix4().copy(body.bindMatrix).invert().multiply(new THREE.Matrix4().copy(skel.boneInverses[index]).invert()).multiply(local);
    geo.applyMatrix4(bindSpace);
    if (bindSpace.determinant() < 0) {
      // a transformação espelha a peça (eixos do esqueleto Biped): inverte a ordem dos vértices
      const idx = geo.index.array;
      for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
    }
    const n = geo.attributes.position.count;
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? index : 0)), 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    const group = mat === 'patch' ? 'patch' : 'gear';
    if (group === 'gear') {
      const col = new THREE.Color(COLORS[mat]);
      geo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n).fill(0).flatMap(() => [col.r, col.g, col.b]), 3));
    }
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(geo);
  }
  return [...groups.entries()].map(([mat, list]) => {
    const geometry = mergeGeometries(list);
    list.forEach((x) => x.dispose());
    return { mat, geometry };
  });
}

/** Anexa o equipamento (uma malha com pele por material, ligada ao esqueleto do corpo). */
export function attachGear(character) {
  let parts = cache.get(character.operator);
  if (!parts) { parts = build(character); cache.set(character.operator, parts); }
  const body = bodyMesh(character);
  if (!body) return [];
  const M = materials();
  return parts.map((p) => {
    const mesh = new THREE.SkinnedMesh(p.geometry, p.mat === 'patch' ? patchMaterial(character.operator) : M.gear);
    mesh.position.copy(body.position); mesh.quaternion.copy(body.quaternion); mesh.scale.copy(body.scale);
    body.parent.add(mesh);
    mesh.bind(body.skeleton, body.bindMatrix);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  });
}
