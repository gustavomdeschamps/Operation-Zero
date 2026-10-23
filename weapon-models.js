// Modelos procedurais das armas — a MESMA construção é usada na primeira pessoa (com mãos),
// nos personagens em terceira pessoa e no arsenal, para que a arma exibida seja sempre a jogada.
// Convenção: origem no centro do receptor, cano para -Z, topo para +Y, unidades em metros.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Materiais compartilhados (um conjunto por cena/renderizador). */
export function createWeaponMaterials() {
  return {
    gunmetal: new THREE.MeshStandardMaterial({ color: 0x4a515b, roughness: 0.36, metalness: 0.7 }),
    darkmetal: new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.42, metalness: 0.75 }),
    polymer: new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.62, metalness: 0.15 }),
    cerakote: new THREE.MeshStandardMaterial({ color: 0x8b8170, roughness: 0.6, metalness: 0.2 }),
    olive: new THREE.MeshStandardMaterial({ color: 0x4f5440, roughness: 0.66, metalness: 0.12 }),
    accent: new THREE.MeshStandardMaterial({ color: 0x0d3236, emissive: 0x3ef0ff, emissiveIntensity: 1.6, roughness: 0.3 }),
    glove: new THREE.MeshStandardMaterial({ color: 0x5a5148, roughness: 0.8, metalness: 0.05 }),
    sleeve: new THREE.MeshStandardMaterial({ color: 0x4d5a6b, roughness: 0.88, metalness: 0 }),
    knuckle: new THREE.MeshStandardMaterial({ color: 0x2f3338, roughness: 0.6, metalness: 0.3 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x0b2a2e, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.28, depthWrite: false }),
    reticle: new THREE.MeshBasicMaterial({ color: 0xff3a3a }),
  };
}

const GEO_CACHE = new Map();
/** Geometrias são compartilhadas entre todas as instâncias (nada é recriado por personagem). */
function geo(key, make) {
  let g = GEO_CACHE.get(key);
  if (!g) { g = make(); GEO_CACHE.set(key, g); }
  return g;
}
const box = (w, h, d) => geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (r1, r2, h, s = 12) => geo(`c${r1},${r2},${h},${s}`, () => { const g = new THREE.CylinderGeometry(r1, r2, h, s); g.rotateX(Math.PI / 2); return g; });
const plane = (w, h) => geo(`p${w},${h}`, () => new THREE.PlaneGeometry(w, h));
const ring = (a, b) => geo(`r${a},${b}`, () => new THREE.RingGeometry(a, b, 32));
const circle = (r) => geo(`o${r}`, () => new THREE.CircleGeometry(r, 10));

function part(parent, g, mat, pos, rot = null) {
  const m = new THREE.Mesh(g, mat);
  m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(m);
  return m;
}

function addArm(parent, M, handPos, sleeveDir, handRot) {
  const hand = new THREE.Group();
  hand.position.set(...handPos);
  hand.rotation.set(...handRot);
  part(hand, box(0.075, 0.085, 0.1), M.glove, [0, 0, 0]);
  part(hand, box(0.08, 0.03, 0.04), M.knuckle, [0, 0.03, -0.035]);
  const dir = new THREE.Vector3(...sleeveDir).normalize();
  const sleeve = new THREE.Mesh(box(0.095, 0.1, 0.42), M.sleeve);
  sleeve.position.copy(dir).multiplyScalar(0.23);
  sleeve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  hand.add(sleeve);
  part(hand, box(0.1, 0.105, 0.05), M.polymer, [sleeveDir[0] * 0.06, sleeveDir[1] * 0.06, sleeveDir[2] * 0.06 + 0.02]);
  parent.add(hand);
  return hand;
}

function holoSight(M, y, z, scale = 1) {
  const sight = new THREE.Group();
  sight.position.set(0, y, z);
  sight.scale.setScalar(scale);
  part(sight, box(0.05, 0.012, 0.08), M.gunmetal, [0, -0.026, 0]);
  part(sight, box(0.006, 0.05, 0.075), M.gunmetal, [0.024, 0, 0]);
  part(sight, box(0.006, 0.05, 0.075), M.gunmetal, [-0.024, 0, 0]);
  part(sight, box(0.05, 0.006, 0.075), M.gunmetal, [0, 0.025, 0]);
  part(sight, plane(0.042, 0.044), M.lens, [0, 0, -0.03]);
  part(sight, circle(0.0016), M.reticle, [0, 0.0, -0.031]);
  part(sight, ring(0.0085, 0.0098), M.reticle, [0, 0.0, -0.031]);
  return sight;
}

// ---- VX-9 RANGER (fuzil de assalto) -------------------------------------------
function buildRifle(M, hands) {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  part(gun, box(0.066, 0.1, 0.36), M.gunmetal, [0, 0, 0]);                 // receptor superior
  part(gun, box(0.07, 0.03, 0.34), M.polymer, [0, -0.06, 0.0]);            // receptor inferior
  part(gun, box(0.068, 0.018, 0.1), M.darkmetal, [0, 0.03, 0.05]);         // janela de ejeção
  part(gun, box(0.034, 0.022, 0.42), M.gunmetal, [0, 0.062, -0.08]);       // trilho
  for (let i = 0; i < 9; i++) part(gun, box(0.04, 0.008, 0.012), M.polymer, [0, 0.076, -0.26 + i * 0.045]);
  part(gun, box(0.074, 0.088, 0.3), M.cerakote, [0, 0.0, -0.33]);          // guarda-mão
  for (let i = 0; i < 4; i++) part(gun, box(0.076, 0.014, 0.05), M.polymer, [0, -0.015, -0.24 - i * 0.065]);
  part(gun, box(0.004, 0.012, 0.22), M.accent, [0.0385, 0.02, -0.32]);     // faixa ciano
  part(gun, box(0.004, 0.012, 0.22), M.accent, [-0.0385, 0.02, -0.32]);
  part(gun, box(0.03, 0.05, 0.05), M.polymer, [0, -0.06, -0.38], [0.12, 0, 0]); // empunhadura frontal
  part(gun, cyl(0.013, 0.013, 0.22), M.gunmetal, [0, 0.012, -0.58]);       // cano
  part(gun, cyl(0.021, 0.021, 0.07), M.polymer, [0, 0.012, -0.69]);        // freio de boca
  part(gun, box(0.05, 0.12, 0.06), M.polymer, [0, -0.115, 0.085], [-0.32, 0, 0]); // empunhadura
  part(gun, box(0.05, 0.075, 0.2), M.polymer, [0, -0.01, 0.29]);           // coronha
  part(gun, box(0.054, 0.12, 0.03), M.gunmetal, [0, -0.03, 0.4]);
  part(gun, box(0.02, 0.03, 0.06), M.gunmetal, [0.04, 0.03, 0.08]);        // alavanca de manejo
  part(gun, box(0.044, 0.07, 0.035), M.polymer, [0, -0.07, -0.12]);        // guarda-mato
  gun.add(holoSight(M, 0.105, -0.04));
  const mag = new THREE.Group();
  mag.position.set(0, -0.08, -0.07);
  part(mag, box(0.046, 0.19, 0.085), M.polymer, [0, -0.09, -0.01], [0.18, 0, 0]);
  part(mag, box(0.048, 0.02, 0.09), M.gunmetal, [0, -0.18, -0.03], [0.18, 0, 0]);
  gun.add(mag);
  if (hands) {
    addArm(gun, M, [0.012, -0.115, 0.1], [0.45, -0.55, 0.7], [-0.3, 0, 0.1]);
    addArm(gun, M, [-0.01, -0.06, -0.36], [-0.55, -0.6, 0.6], [0, 0, -0.35]);
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.012, -0.74);
  gun.add(muzzle);
  return {
    root, gun, mag, muzzle, magRest: mag.position.clone(), length: 0.84,
    // pontos de empunhadura (espaço da arma) usados pela IK dos personagens em 3ª pessoa
    grips: { right: [0, -0.115, 0.1], left: [0, -0.06, -0.31], shoulder: [0, -0.02, 0.41], sight: [0, 0.105, -0.04] },
  };
}

// ---- SV-4 VESPA (submetralhadora) ---------------------------------------------
function buildSmg(M, hands) {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  part(gun, box(0.06, 0.085, 0.26), M.darkmetal, [0, 0.0, -0.02]);         // receptor
  part(gun, box(0.064, 0.026, 0.24), M.olive, [0, -0.052, -0.02]);         // carcaça inferior
  part(gun, box(0.028, 0.018, 0.26), M.gunmetal, [0, 0.052, -0.04]);       // trilho
  for (let i = 0; i < 6; i++) part(gun, box(0.034, 0.007, 0.012), M.polymer, [0, 0.064, -0.14 + i * 0.04]);
  part(gun, box(0.066, 0.07, 0.17), M.olive, [0, 0.004, -0.235]);          // guarda-mão curto
  for (let i = 0; i < 3; i++) part(gun, box(0.068, 0.012, 0.03), M.polymer, [0, -0.012, -0.18 - i * 0.05]);
  part(gun, box(0.004, 0.01, 0.12), M.accent, [0.0345, 0.018, -0.23]);
  part(gun, box(0.004, 0.01, 0.12), M.accent, [-0.0345, 0.018, -0.23]);
  part(gun, cyl(0.022, 0.022, 0.16), M.darkmetal, [0, 0.008, -0.39]);      // supressor integrado
  part(gun, cyl(0.016, 0.016, 0.01), M.polymer, [0, 0.008, -0.473]);
  part(gun, box(0.046, 0.11, 0.056), M.polymer, [0, -0.1, 0.06], [-0.28, 0, 0]); // empunhadura
  part(gun, box(0.04, 0.06, 0.035), M.polymer, [0, -0.065, -0.05]);        // guarda-mato
  part(gun, box(0.016, 0.03, 0.05), M.gunmetal, [0.034, 0.025, 0.02]);     // alavanca
  // coronha rebatível em armação de arame
  part(gun, box(0.012, 0.012, 0.2), M.gunmetal, [0.022, 0.0, 0.2]);
  part(gun, box(0.012, 0.012, 0.2), M.gunmetal, [-0.022, 0.0, 0.2]);
  part(gun, box(0.056, 0.1, 0.022), M.polymer, [0, -0.02, 0.305]);
  // mira de ponto vermelho compacta
  const dot = new THREE.Group();
  dot.position.set(0, 0.088, -0.02);
  part(dot, box(0.034, 0.012, 0.05), M.gunmetal, [0, -0.022, 0]);
  part(dot, cyl(0.019, 0.019, 0.045, 14), M.darkmetal, [0, 0.004, 0]);
  part(dot, circle(0.0016), M.reticle, [0, 0.004, -0.024]);
  gun.add(dot);
  const mag = new THREE.Group();
  mag.position.set(0, -0.07, -0.1);
  part(mag, box(0.034, 0.21, 0.05), M.polymer, [0, -0.1, 0], [0.06, 0, 0]);
  part(mag, box(0.036, 0.016, 0.054), M.gunmetal, [0, -0.205, -0.006], [0.06, 0, 0]);
  gun.add(mag);
  if (hands) {
    addArm(gun, M, [0.012, -0.1, 0.075], [0.45, -0.55, 0.7], [-0.28, 0, 0.1]);
    addArm(gun, M, [-0.012, -0.05, -0.24], [-0.55, -0.6, 0.6], [0, 0, -0.35]);
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.008, -0.48);
  gun.add(muzzle);
  return {
    root, gun, mag, muzzle, magRest: mag.position.clone(), length: 0.8,
    grips: { right: [0, -0.1, 0.075], left: [0, -0.045, -0.22], shoulder: [0, -0.02, 0.315], sight: [0, 0.092, -0.02] },
  };
}

// ---- K-2 SIDEARM (pistola) -------------------------------------------------------
function buildPistol(M, hands) {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  const slide = part(gun, box(0.042, 0.046, 0.2), M.gunmetal, [0, 0.03, -0.04]);
  for (let i = 0; i < 6; i++) part(gun, box(0.044, 0.03, 0.006), M.polymer, [0, 0.03, 0.03 + i * 0.01]);
  part(gun, box(0.004, 0.008, 0.12), M.accent, [0.022, 0.035, -0.06]);
  part(gun, box(0.04, 0.034, 0.17), M.polymer, [0, -0.01, -0.03]);
  part(gun, cyl(0.009, 0.009, 0.03), M.gunmetal, [0, 0.03, -0.155]);
  part(gun, box(0.008, 0.012, 0.01), M.gunmetal, [0, 0.059, -0.13]);
  part(gun, box(0.03, 0.012, 0.012), M.gunmetal, [0, 0.059, 0.05]);
  part(gun, box(0.038, 0.13, 0.055), M.polymer, [0, -0.08, 0.04], [-0.22, 0, 0]);
  part(gun, box(0.034, 0.05, 0.03), M.polymer, [0, -0.04, -0.03]);
  const mag = new THREE.Group();
  mag.position.set(0, -0.08, 0.045);
  part(mag, box(0.03, 0.12, 0.045), M.gunmetal, [0, -0.02, 0], [-0.22, 0, 0]);
  gun.add(mag);
  if (hands) {
    addArm(gun, M, [0.01, -0.09, 0.05], [0.4, -0.6, 0.7], [-0.2, 0, 0.1]);
    addArm(gun, M, [-0.035, -0.1, 0.03], [-0.5, -0.6, 0.65], [-0.2, 0, -0.5]);
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.03, -0.17);
  gun.add(muzzle);
  return {
    root, gun, mag, muzzle, slide, magRest: mag.position.clone(), length: 0.22,
    grips: { right: [0, -0.085, 0.05], left: [-0.02, -0.095, 0.04], shoulder: null },
  };
}

// ---- LR-12 SENTINELA (fuzil de precisão por ferrolho) ---------------------------------
function buildSniper(M, hands) {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  part(gun, box(0.06, 0.082, 0.42), M.darkmetal, [0, 0, 0.01]);             // receptor
  part(gun, box(0.074, 0.05, 0.62), M.olive, [0, -0.05, -0.02]);            // chassi
  part(gun, box(0.004, 0.012, 0.3), M.accent, [0.0375, -0.035, -0.12]);     // faixa ciano
  part(gun, box(0.004, 0.012, 0.3), M.accent, [-0.0375, -0.035, -0.12]);
  for (let i = 0; i < 5; i++) part(gun, box(0.078, 0.01, 0.03), M.polymer, [0, -0.03, -0.12 - i * 0.05]); // aletas
  part(gun, box(0.064, 0.07, 0.28), M.olive, [0, -0.005, -0.42]);           // guarda-mão flutuante
  part(gun, cyl(0.016, 0.014, 0.5), M.gunmetal, [0, 0.008, -0.72]);         // cano pesado
  part(gun, cyl(0.024, 0.024, 0.09), M.darkmetal, [0, 0.008, -1.0]);        // freio de boca
  for (let i = 0; i < 3; i++) part(gun, box(0.05, 0.006, 0.012), M.polymer, [0, 0.008, -0.975 - i * 0.022]);
  part(gun, box(0.05, 0.12, 0.06), M.polymer, [0, -0.115, 0.12], [-0.3, 0, 0]); // empunhadura
  part(gun, box(0.044, 0.06, 0.035), M.polymer, [0, -0.07, 0.03]);         // guarda-mato
  // coronha esqueletada com apoio de face regulável
  part(gun, box(0.05, 0.03, 0.3), M.olive, [0, 0.0, 0.36]);
  part(gun, box(0.05, 0.03, 0.26), M.olive, [0, -0.1, 0.38], [0.12, 0, 0]);
  part(gun, box(0.056, 0.15, 0.03), M.polymer, [0, -0.05, 0.52]);
  part(gun, box(0.046, 0.025, 0.14), M.polymer, [0, 0.03, 0.36]);           // apoio de face
  part(gun, cyl(0.006, 0.006, 0.06, 6), M.gunmetal, [0, 0.015, 0.36], [Math.PI / 2, 0, 0]);
  // bipé recolhido sob o guarda-mão
  part(gun, box(0.012, 0.012, 0.22), M.gunmetal, [0.016, -0.05, -0.62]);
  part(gun, box(0.012, 0.012, 0.22), M.gunmetal, [-0.016, -0.05, -0.62]);
  // ferrolho (anima a cada disparo)
  const bolt = new THREE.Group();
  bolt.position.set(0.032, 0.02, 0.1);
  part(bolt, cyl(0.009, 0.009, 0.05, 8), M.gunmetal, [0.03, 0, 0], [0, Math.PI / 2, 0]);
  part(bolt, geo('sphere-knob', () => new THREE.SphereGeometry(0.014, 10, 8)), M.polymer, [0.058, -0.004, 0]);
  gun.add(bolt);
  // luneta 4x
  const scope = new THREE.Group();
  scope.position.set(0, 0.088, -0.04);
  part(scope, cyl(0.022, 0.022, 0.28, 16), M.darkmetal, [0, 0, 0]);
  part(scope, cyl(0.03, 0.022, 0.08, 16), M.darkmetal, [0, 0, -0.17]);     // objetiva
  part(scope, cyl(0.026, 0.022, 0.06, 16), M.darkmetal, [0, 0, 0.15]);     // ocular
  part(scope, cyl(0.016, 0.016, 0.03, 10), M.gunmetal, [0, 0.03, 0], [Math.PI / 2, 0, 0]);   // torre
  part(scope, cyl(0.016, 0.016, 0.03, 10), M.gunmetal, [0.03, 0, 0], [0, 0, Math.PI / 2]);
  part(scope, geo('lens-big', () => new THREE.CircleGeometry(0.028, 18)), M.lens, [0, 0, -0.211]);
  part(scope, box(0.014, 0.05, 0.03), M.gunmetal, [0, -0.035, -0.07]);     // anéis
  part(scope, box(0.014, 0.05, 0.03), M.gunmetal, [0, -0.035, 0.07]);
  part(scope, box(0.003, 0.008, 0.18), M.accent, [0.0225, 0, 0]);
  gun.add(scope);
  const mag = new THREE.Group();
  mag.position.set(0, -0.08, -0.06);
  part(mag, box(0.05, 0.09, 0.1), M.polymer, [0, -0.03, 0]);
  part(mag, box(0.052, 0.014, 0.104), M.gunmetal, [0, -0.08, 0]);
  gun.add(mag);
  if (hands) {
    addArm(gun, M, [0.012, -0.115, 0.13], [0.45, -0.55, 0.7], [-0.3, 0, 0.1]);
    addArm(gun, M, [-0.01, -0.07, -0.42], [-0.55, -0.6, 0.6], [0, 0, -0.35]);
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.008, -1.05);
  gun.add(muzzle);
  return {
    root, gun, mag, muzzle, bolt, scope, magRest: mag.position.clone(), length: 1.2,
    grips: { right: [0, -0.115, 0.13], left: [0, -0.07, -0.4], shoulder: [0, -0.05, 0.53], sight: [0, 0.088, 0.11] },
  };
}

const BUILDERS = { rifle: buildRifle, smg: buildSmg, pistol: buildPistol, sniper: buildSniper };

/**
 * Funde as peças da arma numa malha por material (personagens em 3ª pessoa: ~20 malhas → ~5).
 * A geometria fundida é calculada uma vez por arma e compartilhada por todas as instâncias.
 */
function mergeByMaterial(model, materials) {
  const gun = model.gun;
  const keyOf = new Map(Object.entries(materials).map(([k, m]) => [m, k]));
  let merged = GEO_CACHE.get(`merged:${model.id}`);
  const meshes = [];
  gun.updateMatrixWorld(true);
  gun.traverse((o) => { if (o.isMesh) meshes.push(o); });
  if (!merged) {
    const inv = new THREE.Matrix4().copy(gun.matrixWorld).invert();
    const groups = new Map();
    for (const o of meshes) {
      const key = keyOf.get(o.material);
      const g = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(g);
    }
    merged = [...groups.entries()].map(([key, list]) => {
      const g = mergeGeometries(list);
      list.forEach((x) => x.dispose());
      return [key, g];
    });
    GEO_CACHE.set(`merged:${model.id}`, merged);
  }
  for (const o of meshes) o.removeFromParent();
  for (const [key, g] of merged) gun.add(new THREE.Mesh(g, materials[key]));
}

/**
 * Cria o modelo da arma `id`. `hands` = true apenas para a primeira pessoa; `merged` = true para
 * personagens (uma malha por material; o carregador deixa de ser uma peça animável).
 * Retorna { root, gun, mag, muzzle, slide?, magRest, grips, length }.
 */
export function buildWeaponModel(id, materials, { hands = false, merged = false } = {}) {
  const build = BUILDERS[id];
  if (!build) throw new Error(`arma desconhecida: ${id}`);
  const model = build(materials, hands);
  model.id = id;
  if (merged && !hands) mergeByMaterial(model, materials);
  return model;
}

export const WEAPON_MODEL_IDS = Object.keys(BUILDERS);
