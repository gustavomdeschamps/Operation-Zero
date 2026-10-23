// Controlador de um personagem humano animado (operadores remotos, bots de treino, menu e abertura).
//
// Camadas, nesta ordem, a cada quadro:
//  1. Locomoção (captura de movimento): mistura por velocidade entre parado/andar/correr/sprint com
//     fase sincronizada (os pés não deslizam), sentido para frente/para trás e agachamento aditivo.
//  2. Corpo superior procedural: torção do tronco para mirar onde a cabeça aponta, inclinação com o
//     pitch da mira, reação a dano e recuo.
//  3. Arma posicionada no ombro na direção da mira + IK de dois ossos nos braços (mãos na empunhadura
//     e no guarda-mão), orientação das mãos e dedos fechados.
//  4. Eliminação: joelhos cedem, queda com pivô nos pés e a arma cai separada do corpo.
//
// A animação nunca decide nada de jogo: vida, dano e eliminação vêm do servidor/simulação.
import * as THREE from 'three';
import { characterLibrary, LOCOMOTION_CLIPS } from './library.js';
import { buildWeaponModel } from '../weapon-models.js';
import { getSkinMaterials } from '../skins-render.js';
import { attachGear } from './gear.js';

const MODEL_YAW = Math.PI;          // clips andam para +Z; no jogo a frente é -Z
const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _e = new THREE.Vector3();
const _t = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _aimQ = new THREE.Quaternion();
const _wpos = new THREE.Vector3();
const _wquat = new THREE.Quaternion();
const _lat = new THREE.Vector3();
const _feet = new THREE.Vector3();
const _armT = new THREE.Vector3();
const _foreT = new THREE.Vector3();

const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const wrap = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };

/** Gira um osso em torno de um eixo do MUNDO (mantém a hierarquia coerente). */
function rotateBoneWorld(bone, axisWorld, angle) {
  if (!angle) return;
  bone.parent.getWorldQuaternion(_q1);
  _d1.copy(axisWorld).applyQuaternion(_q1.invert()).normalize();
  _q2.setFromAxisAngle(_d1, angle);
  bone.quaternion.premultiply(_q2);
}

/** Gira um osso para que a direção `from` (mundo) passe a apontar para `to` (mundo). */
function aimBone(bone, from, to, weight = 1) {
  _q2.setFromUnitVectors(_d1.copy(from).normalize(), _d2.copy(to).normalize());
  if (weight < 1) _q2.slerp(_q3.identity(), 1 - weight);
  bone.parent.getWorldQuaternion(_q1);
  _q3.copy(_q1).invert().multiply(_q2).multiply(_q1);   // delta no espaço do pai
  bone.quaternion.premultiply(_q3);
}

/** Define a orientação de MUNDO de um osso. */
function setBoneWorldQuaternion(bone, worldQ) {
  bone.parent.getWorldQuaternion(_q1);
  bone.quaternion.copy(_q1.invert().multiply(worldQ));
}

function findBones(root) {
  const by = {};
  root.traverse((o) => { if (o.isBone || o.name === 'Bip01') by[o.name] = o; });
  const b = (n) => by[`Bip01_${n}`];
  const side = (s) => ({
    clav: b(`${s}_Clavicle`), upper: b(`${s}_UpperArm`), fore: b(`${s}_Forearm`), hand: b(`${s}_Hand`),
    thigh: b(`${s}_Thigh`), calf: b(`${s}_Calf`), foot: b(`${s}_Foot`),
    fingers: [0, 1, 2, 3, 4].map((f) => [b(`${s}_Finger${f}`), b(`${s}_Finger${f}1`), b(`${s}_Finger${f}2`)]),
  });
  return {
    root: by.Bip01, pelvis: b('Pelvis'), spine: b('Spine'), spine1: b('Spine1'), spine2: b('Spine2'),
    neck: b('Neck'), head: b('Head'), eye: b('REye') || b('Head'), L: side('L'), R: side('R'),
  };
}

// ---- recursos compartilhados (clarão de disparo) ----------------------------------
let FLASH = null;
function flashResources() {
  if (FLASH) return FLASH;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,248,225,1)');
  grad.addColorStop(0.3, 'rgba(255,190,100,0.85)');
  grad.addColorStop(1, 'rgba(255,110,30,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  FLASH = {
    geo: new THREE.PlaneGeometry(0.34, 0.34),
    mat: new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  };
  return FLASH;
}

/**
 * Pose das mãos por arma, no espaço da arma (x direita, y cima, z para trás):
 * `wrist` = posição do punho, `fingers` = direção punho→dedos, `index` = lado do indicador.
 */
const HAND_POSES = {
  long: {
    // mão direita na empunhadura: dedos envolvem a pistola pelo lado esquerdo, palma voltada para ela
    right: { grip: 'right', wrist: [0.034, 0.04, 0.07], fingers: [-0.45, -0.3, -0.85], palm: [-0.95, 0.1, 0.25], curl: [1.0, 1.15, 0.85], thumb: 0.5 },
    // mão esquerda por baixo do guarda-mão: palma para cima, dedos sobem pelo lado direito
    left: { grip: 'left', wrist: [-0.055, -0.03, 0.04], fingers: [0.9, 0.3, -0.25], palm: [-0.3, 0.95, 0], curl: [0.8, 0.95, 0.7], thumb: 0.35 },
  },
  pistol: {
    right: { grip: 'right', wrist: [0.024, 0.03, 0.07], fingers: [-0.4, -0.3, -0.85], palm: [-0.95, 0.1, 0.25], curl: [1.0, 1.15, 0.9], thumb: 0.45 },
    left: { grip: 'right', wrist: [-0.07, -0.02, 0.05], fingers: [0.8, -0.1, -0.55], palm: [0.6, 0.6, 0.4], curl: [0.85, 1.0, 0.75], thumb: 0.3 },
  },
};

/** Postura de tiro: ombros "de lado" para o apoio alcançar o guarda-mão. */
const STANCE_LONG = 44 * DEG;
const STANCE_PISTOL = 10 * DEG;

export class HumanCharacter {
  /**
   * @param {object} opts
   *   operator: id do catálogo · team: TEAM.* · weaponMaterials: materiais compartilhados das armas
   *   weapon: id inicial da arma · library: CharacterLibrary (padrão: a global)
   */
  constructor({ operator, team, weaponMaterials, weapon = 'rifle', library = characterLibrary }) {
    const inst = library.instantiate(operator, team);
    if (!inst) throw new Error(`operador ${operator} não carregado`);
    this.library = library;
    this.instance = inst;
    this.operator = operator;
    this.team = team;
    this.weaponMaterials = weaponMaterials;
    this.skins = {};                      // arma → acabamento (só visual)

    this.root = new THREE.Group();
    this.root.name = `human-${operator}`;
    this.fall = new THREE.Group();
    this.root.add(this.fall);
    this.model = inst.scene;
    this.model.rotation.y = MODEL_YAW;
    this.fall.add(this.model);
    this.bones = findBones(this.model);
    this.bind = new Map();
    this.model.traverse((o) => { if (o.isBone) this.bind.set(o, o.quaternion.clone()); });
    this.armBones = [];
    for (const s of ['L', 'R']) {
      const S = this.bones[s];
      this.armBones.push(S.clav, S.upper, S.fore, S.hand);
      for (const f of S.fingers) for (const j of f) if (j) this.armBones.push(j);
    }
    this.upperLen = {};
    this.foreLen = {};
    for (const s of ['L', 'R']) {
      const S = this.bones[s];
      this.upperLen[s] = S.fore.position.length() * 0.01;
      this.foreLen[s] = S.hand.position.length() * 0.01;
    }

    // ---- animação
    const clips = library.clips;
    this.mixer = new THREE.AnimationMixer(this.model);
    this.loco = LOCOMOTION_CLIPS.map((name) => {
      const clip = clips[name];
      const action = this.mixer.clipAction(clip);
      action.play();
      action.setEffectiveWeight(0);
      return { name, clip, action, speed: clip.userData.speed, stride: clip.userData.stride, weight: 0 };
    });
    this.idle = this.mixer.clipAction(clips.idle);
    this.idle.play();
    this.idleWeight = 1;
    this.crouchAdd = this.mixer.clipAction(clips.crouchAdd);
    this.crouchAdd.play();
    this.crouchAdd.setEffectiveWeight(0);
    this.mixer.timeScale = 0;           // o tempo de cada clip é controlado manualmente

    // ---- estado
    this.phase = Math.random();
    this.idleTime = Math.random() * clips.idle.duration;
    this.gait = 1;                      // 1 = para frente, -1 = de costas
    this.bodyYaw = 0;
    this.aimYaw = 0;
    this.aimPitch = 0;
    this.speed = 0;
    this.crouch = 0;
    this.lowReady = 0;
    this.kick = 0;
    this.kickVel = 0;
    this.hitPitch = 0; this.hitVel = 0; this.hitYaw = 0;
    this.flashT = 0;
    this.fireRecent = 0;
    this.reloadT = -1;
    this.switchT = -1;
    this.dead = false;
    this.deathT = 0;
    this.fallSide = 0;
    this.weaponDrop = null;
    this.visible = true;

    // ---- arma
    this.weapons = new Map();
    this.weaponId = null;
    this.weapon = null;
    this.setWeapon(weapon, true);

    this.groundOffset = this._computeGroundOffset();
    this.gear = attachGear(this);          // equipamento original por operador
    this._calibratePhases();
    this.model.position.y = this.groundOffset;
  }

  /** Distância entre a origem do modelo e a sola do pé (na pose parada), calculada uma vez por operador. */
  _computeGroundOffset() {
    const t = this.instance.template;
    if (t.groundOffset !== undefined) return t.groundOffset;
    this.idle.setEffectiveWeight(1);
    this.idle.time = 0;
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    let minY = Infinity;
    for (const mesh of this.instance.meshes) {
      const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 3) {
        v.fromBufferAttribute(pos, i);
        mesh.applyBoneTransform(i, v);
        v.applyMatrix4(mesh.matrixWorld);
        if (v.y < minY) minY = v.y;
      }
    }
    t.groundOffset = Number.isFinite(minY) ? -minY : 0;
    return t.groundOffset;
  }

  /**
   * Alinha as fases dos clips de locomoção (uma vez): em fase 0 o pé esquerdo está apoiado em todos,
   * para que a mistura entre andar/correr nunca cruze as pernas.
   */
  _calibratePhases() {
    const clips = this.library.clips;
    if (clips.walk.userData.calibrated) return;
    const L = this.bones.L.foot, R = this.bones.R.foot;
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    this.idle.setEffectiveWeight(0);
    for (const l of this.loco) {
      for (const o of this.loco) o.action.setEffectiveWeight(o === l ? 1 : 0);
      let best = Infinity, bestK = 0;
      const N = 40;
      for (let k = 0; k < N; k++) {
        l.action.time = (k / N) * l.clip.duration;
        this.mixer.update(0);
        this.root.updateMatrixWorld(true);
        const d = L.getWorldPosition(a).y - R.getWorldPosition(b).y;
        if (d < best) { best = d; bestK = k; }
      }
      l.clip.userData.phaseOffset = bestK / N;
      l.action.setEffectiveWeight(0);
    }
    clips.walk.userData.calibrated = true;
    this.idle.setEffectiveWeight(1);
  }

  // ---- arma ---------------------------------------------------------------
  _weaponModel(id) {
    const skin = this.skins[id] || '';
    const key = `${id}|${skin}`;
    let m = this.weapons.get(key);
    if (!m) {
      m = buildWeaponModel(id, skin ? getSkinMaterials(skin) : this.weaponMaterials, { hands: false, merged: true });
      m.root.traverse((o) => { if (o.isMesh) { o.castShadow = this.castsShadow !== false; } });
      const F = flashResources();
      const flash = new THREE.Group();
      const p1 = new THREE.Mesh(F.geo, F.mat);
      const p2 = new THREE.Mesh(F.geo, F.mat); p2.rotation.y = Math.PI / 2;
      flash.add(p1, p2);
      flash.visible = false;
      m.muzzle.add(flash);
      m.flash = flash;
      m.root.visible = false;
      m.long = !!m.grips.shoulder;
      this.root.add(m.root);
      this.weapons.set(key, m);
    }
    return m;
  }

  setWeapon(id, immediate = false) {
    if (id === this.weaponId && this.weapon) return;
    if (!immediate && this.weapon && !this.dead) { this.switchT = 0; this.pendingWeapon = id; return; }
    if (this.weapon) this.weapon.root.visible = false;
    this.weaponId = id;
    this.weapon = this._weaponModel(id);
    this.weapon.root.visible = this.visible && !this.dead;
  }

  /** Acabamentos equipados (definidos pelo servidor a partir da conta do jogador). */
  setSkins(map = {}) {
    if (JSON.stringify(map) === JSON.stringify(this.skins)) return;
    this.skins = { ...map };
    if (!this.weapon) return;
    const next = this._weaponModel(this.weaponId);
    if (next !== this.weapon) {
      next.root.visible = this.weapon.root.visible;
      this.weapon.root.visible = false;
      this.weapon = next;
    }
  }

  setTeam(team) {
    if (team === this.team) return;
    this.team = team;
    this.library.setTeamMaterials(this.instance, team);
  }

  setVisible(v) {
    this.visible = v;
    this.root.visible = v;
  }

  /** Sombra projetada (desligada para personagens distantes: economiza o passe de sombra). */
  setShadow(on) {
    if (this.castsShadow === on) return;
    this.castsShadow = on;
    for (const m of this.instance.meshes) m.castShadow = on;
    for (const m of this.gear) m.castShadow = on;
    for (const w of this.weapons.values()) w.root.traverse((o) => { if (o.isMesh) o.castShadow = on; });
  }

  // ---- eventos visuais -------------------------------------------------------
  /** Luz de alerta na arma (aviso antes do disparo dos bots de treino). */
  setAlert(on, time = 0) {
    if (!this.alertLight) {
      const F = flashResources();
      if (!F.alertMat) F.alertMat = new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
      if (!F.alertGeo) F.alertGeo = new THREE.SphereGeometry(0.035, 10, 8);
      this.alertLight = new THREE.Mesh(F.alertGeo, F.alertMat);
      this.alertLight.visible = false;
    }
    const w = this.weapon;
    if (w && this.alertLight.parent !== w.muzzle) { w.muzzle.add(this.alertLight); this.alertLight.position.set(0.035, -0.03, 0.06); }
    this.alertLight.visible = on && Math.sin(time * 30) > -0.2;
  }

  fire() {
    this.kickVel += 9;
    this.flashT = 0.05;
    this.fireRecent = 0.6;
    if (this.weapon) { this.weapon.flash.visible = true; this.weapon.flash.rotation.z = Math.random() * Math.PI; }
  }

  hit(fromDir = null) {
    this.hitVel -= 7;
    if (fromDir) this.hitYaw = clamp(fromDir, -1, 1) * 0.12;
  }

  startReload(duration) { this.reloadT = 0; this.reloadDur = Math.max(0.3, duration || 2); }

  die(fromSide = 0) {
    if (this.dead) return;
    this.dead = true;
    this.deathT = 0;
    this.fallSide = clamp(fromSide, -1, 1);
    if (this.weapon) {
      this.weapon.flash.visible = false;
      this.weaponDrop = { y: this.weapon.root.position.y, vy: 0.6, spin: (Math.random() - 0.5) * 6, rest: false };
    }
  }

  revive() {
    this.dead = false;
    this.deathT = 0;
    this.weaponDrop = null;
    this.fall.rotation.set(0, 0, 0);
    this.fall.position.set(0, 0, 0);
    this.crouch = 0;
    this.speed = 0;
    this.reloadT = -1;
    this.switchT = -1;
    if (this.weapon) this.weapon.root.visible = this.visible;
  }

  /** Posição de mundo da boca do cano (para traçantes). */
  getMuzzleWorld(out) {
    if (!this.weapon) return out.copy(this.root.position).setY(this.root.position.y + 1.4);
    this.weapon.muzzle.updateWorldMatrix(true, false);
    return this.weapon.muzzle.getWorldPosition(out);
  }

  getHeadWorld(out) { return this.bones.head.getWorldPosition(out); }

  // ---- atualização ------------------------------------------------------------
  /**
   * state: { vx, vz (m/s, mundo), aimYaw, aimPitch, crouch (0..1), air (bool) }
   * A posição (pés) é definida por quem chama em `root.position`.
   */
  update(dt, state) {
    if (!this.visible) return;
    dt = Math.min(dt, 0.1);
    if (this.dead) { this._updateDeath(dt); return; }
    this.aimYaw = state.aimYaw;
    this.aimPitch = clamp(state.aimPitch, -1.2, 1.2);
    this._updateLocomotion(dt, state);
    this.mixer.update(0);
    this.root.rotation.y = this.bodyYaw;
    this.root.updateMatrixWorld(true);
    this._updateUpperBody(dt);
    this._updateWeapon(dt, state);
  }

  _updateLocomotion(dt, st) {
    const vx = st.vx || 0, vz = st.vz || 0;
    const speed = Math.hypot(vx, vz);
    this.speed = damp(this.speed, speed, 10, dt);
    const s = this.speed;
    const air = !!st.air;

    // direção das pernas: o corpo superior sempre mira; as pernas seguem o movimento
    let legTarget = 0;
    if (speed > 0.25) {
      const moveYaw = Math.atan2(-vx, -vz);
      const rel = wrap(moveYaw - this.aimYaw);
      const abs = Math.abs(rel);
      if (this.gait > 0 && abs > 118 * DEG) this.gait = -1;
      else if (this.gait < 0 && abs < 95 * DEG) this.gait = 1;
      legTarget = this.gait > 0 ? clamp(rel, -72 * DEG, 72 * DEG) : clamp(wrap(rel - Math.PI), -72 * DEG, 72 * DEG);
      this.bodyYaw = this.aimYaw + wrap(damp(wrap(this.bodyYaw - this.aimYaw), legTarget, 9, dt));
    } else {
      // parado: os pés só giram quando o tronco já torceu demais (giro no lugar)
      const diff = wrap(this.aimYaw - this.bodyYaw);
      if (Math.abs(diff) > 55 * DEG) this.bodyYaw = wrap(this.bodyYaw + diff - Math.sign(diff) * 55 * DEG);
      else if (s < 0.1) this.bodyYaw = wrap(this.bodyYaw + diff * (1 - Math.exp(-1.2 * dt)));
    }

    // mistura por velocidade entre clips vizinhos (fase única → passos sincronizados)
    const L = this.loco;
    let i = 0;
    while (i < L.length - 1 && s > L[i + 1].speed) i++;
    let wA = 1, wB = 0, stride = L[i].stride;
    if (s > L[i].speed && i < L.length - 1) {
      const k = clamp((s - L[i].speed) / (L[i + 1].speed - L[i].speed), 0, 1);
      wA = 1 - k; wB = k;
      stride = L[i].stride + (L[i + 1].stride - L[i].stride) * k;
    }
    const moving = air ? 0 : smooth(0.08, 0.7, s);
    if (!air && s > 0.05) this.phase = (this.phase + this.gait * (s / Math.max(0.3, stride)) * dt + 1) % 1;
    for (let j = 0; j < L.length; j++) {
      const target = (j === i ? wA : j === i + 1 ? wB : 0) * moving;
      L[j].weight = damp(L[j].weight, target, 12, dt);
    }
    let total = 0;
    for (const l of L) total += l.weight;
    this.idleWeight = Math.max(0, 1 - total);
    for (const l of L) {
      l.action.setEffectiveWeight(l.weight);
      l.action.time = ((this.phase + l.clip.userData.phaseOffset) % 1) * l.clip.duration;
    }
    this.idleTime = (this.idleTime + dt) % this.idle.getClip().duration;
    this.idle.time = this.idleTime;
    this.idle.setEffectiveWeight(this.idleWeight);

    // aterrissagem: flexão rápida dos joelhos ao tocar o chão depois de um pulo/queda
    if (this.wasAir && !air) this.landT = 0.32;
    this.wasAir = air;
    let land = 0;
    if (this.landT > 0) { this.landT -= dt; land = Math.sin(clamp(this.landT / 0.32, 0, 1) * Math.PI) * 0.45; }

    // agachamento (camada aditiva) + recolher as pernas no ar
    const crouchTarget = clamp(st.crouch || 0, 0, 1) * 0.92 + (air ? 0.35 : 0) + land;
    this.crouch = damp(this.crouch, clamp(crouchTarget, 0, 1), 10, dt);
    this.crouchAdd.time = this.idleTime % this.crouchAdd.getClip().duration;
    this.crouchAdd.setEffectiveWeight(this.crouch);

    const lowTarget = st.lowReady ?? (s > 4.6 && this.fireRecent <= 0 && this.reloadT < 0 ? 1 : 0);
    this.lowReady = damp(this.lowReady, lowTarget, 6, dt);
  }

  _updateUpperBody(dt) {
    const B = this.bones;
    // torção do tronco: das pernas até a mira (+ postura de tiro: ombro esquerdo à frente)
    const stance = (this.weapon && this.weapon.long ? STANCE_LONG : STANCE_PISTOL) * (1 - this.lowReady * 0.4);
    const twist = clamp(wrap(this.aimYaw - this.bodyYaw), -85 * DEG, 85 * DEG) - stance;   // ombro esquerdo à frente
    // reação a dano (mola amortecida)
    this.hitVel += (-this.hitPitch * 120 - this.hitVel * 14) * dt;
    this.hitPitch += this.hitVel * dt;
    this.hitYaw = damp(this.hitYaw, 0, 8, dt);
    const shares = [[B.spine, 0.22], [B.spine1, 0.28], [B.spine2, 0.3], [B.neck, 0.1], [B.head, 0.1]];
    for (const [bone, k] of shares) rotateBoneWorld(bone, UP, twist * k + this.hitYaw * k);
    // a cabeça desfaz a postura de tiro para olhar para a frente
    rotateBoneWorld(B.neck, UP, stance * 0.55);
    rotateBoneWorld(B.head, UP, stance * 0.45);
    // inclinação com o pitch da mira (eixo lateral da mira)
    _right.set(Math.cos(this.aimYaw), 0, -Math.sin(this.aimYaw));
    const pitch = this.aimPitch;
    const pShares = [[B.spine1, 0.16], [B.spine2, 0.2], [B.neck, 0.18], [B.head, 0.3]];
    for (const [bone, k] of pShares) rotateBoneWorld(bone, _right, pitch * k + (bone === B.spine2 ? this.hitPitch : 0));
    this.root.updateMatrixWorld(true);
  }

  _aimBasis(yaw, pitch) {
    _euler.set(pitch, yaw, 0, 'YXZ');
    _aimQ.setFromEuler(_euler);
    _fwd.set(0, 0, -1).applyQuaternion(_aimQ);
    _right.set(1, 0, 0).applyQuaternion(_aimQ);
    _up.set(0, 1, 0).applyQuaternion(_aimQ);
  }

  _updateWeapon(dt, st) {
    const w = this.weapon;
    if (!w) return;
    // recuo (mola) e clarão
    this.kickVel += (-this.kick * 260 - this.kickVel * 22) * dt;
    this.kick += this.kickVel * dt;
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) w.flash.visible = false; }
    if (this.fireRecent > 0) this.fireRecent -= dt;
    // troca de arma: abaixa, troca o modelo no meio, levanta
    let lower = 0;
    if (this.switchT >= 0) {
      this.switchT += dt / 0.5;
      lower = this.switchT < 0.5 ? smooth(0, 0.5, this.switchT) : 1 - smooth(0.5, 1, this.switchT);
      if (this.switchT >= 0.5 && this.pendingWeapon) { const id = this.pendingWeapon; this.pendingWeapon = null; this.setWeapon(id, true); }
      if (this.switchT >= 1) this.switchT = -1;
    }
    const wm = this.weapon;
    // recarga: arma inclinada; a mão esquerda vai ao carregador e à bolsa do colete
    let reload = 0, reloadPhase = 0;
    if (this.reloadT >= 0) {
      this.reloadT += dt / this.reloadDur;
      reloadPhase = this.reloadT;
      reload = this.reloadT < 0.12 ? smooth(0, 0.12, this.reloadT) : this.reloadT > 0.86 ? 1 - smooth(0.86, 1, this.reloadT) : 1;
      if (this.reloadT >= 1) this.reloadT = -1;
    }

    const B = this.bones;
    const pitch = this.aimPitch - this.lowReady * 0.55 - lower * 0.9 - reload * 0.22;
    const yaw = this.aimYaw + this.lowReady * 0.35 + reload * 0.15;
    this._aimBasis(yaw, pitch);
    _q3.setFromAxisAngle(_d1.set(0, 0, 1), -reload * 0.5 + this.kick * 0.02);     // inclinação lateral
    _wquat.copy(_aimQ).multiply(_q3);
    _q2.setFromAxisAngle(_d1.set(1, 0, 0), this.kick * 0.09);                     // levanta o cano
    _wquat.multiply(_q2);

    if (wm.long) {
      // coronha no "bolso" do ombro direito, alta o bastante para a mira ficar na linha do olho
      B.R.upper.getWorldPosition(_a);
      this._aimBasis(this.aimYaw, this.aimPitch);
      _a.addScaledVector(_up, 0.085).addScaledVector(_right, -0.055).addScaledVector(_fwd, 0.06);
      _b.fromArray(wm.grips.shoulder).applyQuaternion(_wquat);
      _wpos.copy(_a).sub(_b);
    } else {
      // pistola: braços estendidos, arma um pouco abaixo da linha dos olhos
      B.eye.getWorldPosition(_a);
      this._aimBasis(this.aimYaw, this.aimPitch);
      _wpos.copy(_a).addScaledVector(_fwd, 0.5).addScaledVector(_up, -0.12).addScaledVector(_right, -0.02);
    }
    _wpos.y -= lower * 0.25;
    _wpos.addScaledVector(_d1.set(0, 0, 1).applyQuaternion(_wquat), this.kick * 0.05);
    // para o espaço local da raiz
    this.root.updateMatrixWorld(true);
    _m1.copy(this.root.matrixWorld).invert();
    _m2.compose(_wpos, _wquat, _p.set(1, 1, 1)).premultiply(_m1);
    _m2.decompose(wm.root.position, wm.root.quaternion, _p);
    wm.root.visible = true;
    wm.root.updateMatrixWorld(true);
    if (wm.magRest) wm.mag.position.copy(wm.magRest);

    // IK dos braços
    const pose = wm.long ? HAND_POSES.long : HAND_POSES.pistol;
    this._solveArm('R', pose.right, wm, null);
    let leftOverride = null;
    if (reload > 0 && wm.long) {
      // trajetória da mão esquerda: carregador → bolsa no peito → carregador → guarda-mão
      const k = reloadPhase;
      const magW = _e.copy(wm.magRest).add(_c.set(0, -0.1, 0)).applyMatrix4(wm.gun.matrixWorld);
      B.spine2.getWorldPosition(_t);
      this._aimBasis(this.aimYaw, 0);
      _t.addScaledVector(_fwd, 0.22).addScaledVector(_right, -0.06).addScaledVector(UP, -0.12);
      let target;
      if (k < 0.3) target = magW.clone();
      else if (k < 0.5) target = magW.clone().lerp(_t, smooth(0.3, 0.5, k));
      else if (k < 0.7) target = _t.clone().lerp(magW, smooth(0.5, 0.7, k));
      else target = magW.clone();
      // o carregador acompanha a mão entre a retirada e a inserção
      const out = k > 0.22 && k < 0.66 ? smooth(0.22, 0.32, k) * (1 - smooth(0.56, 0.66, k)) : 0;
      if (out > 0) wm.mag.position.y = wm.magRest.y - out * 0.35;
      leftOverride = target;
    }
    this._solveArm('L', pose.left, wm, leftOverride, reload);
  }

  /** IK de dois ossos + orientação da mão + dedos. */
  _solveArm(s, hp, wm, overrideTarget = null, blendToOverride = 1) {
    const S = this.bones[s];
    // pose de partida fixa (determinística) para evitar torções acumuladas
    S.clav.quaternion.copy(this.bind.get(S.clav));
    S.upper.quaternion.copy(this.bind.get(S.upper));
    S.fore.quaternion.copy(this.bind.get(S.fore));
    S.hand.quaternion.copy(this.bind.get(S.hand));
    // clavícula levemente à frente (protração) para alcançar a arma
    this._aimBasis(this.aimYaw, 0);
    S.clav.updateWorldMatrix(true, false);
    rotateBoneWorld(S.clav, _right, s === 'L' ? -0.12 : -0.08);
    rotateBoneWorld(S.clav, UP, s === 'L' ? -0.32 : 0.12);
    S.clav.updateMatrixWorld(true);

    // alvo do punho em mundo
    const ik = this._ik || (this._ik = { sh: new THREE.Vector3(), el: new THREE.Vector3(), tg: new THREE.Vector3(), dir: new THREE.Vector3(), pole: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3() });
    ik.tg.fromArray(hp.wrist).add(_c.fromArray(wm.grips[hp.grip])).applyMatrix4(wm.root.matrixWorld);
    if (overrideTarget) ik.tg.lerp(overrideTarget, blendToOverride);
    S.upper.getWorldPosition(ik.sh);
    const l1 = this.upperLen[s], l2 = this.foreLen[s];
    ik.dir.copy(ik.tg).sub(ik.sh);
    const dist = clamp(ik.dir.length(), 0.05, (l1 + l2) * 0.999);
    ik.dir.normalize();
    const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    // polo: cotovelo para baixo e para fora
    this._aimBasis(this.aimYaw, 0);
    ik.pole.copy(UP).multiplyScalar(-1).addScaledVector(_right, s === 'L' ? -0.55 : 0.75).addScaledVector(_fwd, -0.2);
    ik.pole.addScaledVector(ik.dir, -ik.pole.dot(ik.dir)).normalize();
    ik.el.copy(ik.sh).addScaledVector(ik.dir, cosA * l1).addScaledVector(ik.pole, sinA * l1);
    // braço → cotovelo
    S.fore.getWorldPosition(ik.b);
    aimBone(S.upper, ik.a.copy(ik.b).sub(ik.sh), _p.copy(ik.el).sub(ik.sh));
    S.upper.updateMatrixWorld(true);
    // antebraço → punho
    S.fore.getWorldPosition(ik.b);
    S.hand.getWorldPosition(ik.a);
    ik.a.sub(ik.b);
    _p.copy(ik.sh).addScaledVector(ik.dir, dist).sub(ik.b);
    aimBone(S.fore, ik.a, _p);
    S.fore.updateMatrixWorld(true);

    // orientação da mão: base (dedos, indicador) no espaço da arma → mundo
    this._orientHand(S, hp, wm);
    // dedos fechados ao redor da empunhadura
    for (let f = 0; f < 5; f++) {
      const chain = S.fingers[f];
      for (let j = 0; j < 3; j++) {
        const bone = chain[j];
        if (!bone) continue;
        bone.quaternion.copy(this.bind.get(bone));
        const amount = f === 0 ? hp.thumb * (j === 0 ? 0.6 : 1) : hp.curl[j];
        _q2.setFromAxisAngle(_d1.set(0, 0, 1), -amount);
        bone.quaternion.multiply(_q2);
      }
    }
  }

  /**
   * Base de repouso da mão no espaço local do osso: direção punho→dedos e normal da palma.
   * A palma é medida (não suposta): é o lado para onde as pontas dos dedos vão ao fechar.
   */
  _handRestBasis(S) {
    if (!this._handBasis) this._handBasis = {};
    const key = S.hand.name;
    if (this._handBasis[key]) return this._handBasis[key];
    const mid = S.fingers[2];
    const dir = mid[0].position.clone().normalize();
    const tipLocal = (curl) => {
      const saved = mid.map((b) => b.quaternion.clone());
      for (const b of mid) { b.quaternion.copy(this.bind.get(b)); b.quaternion.multiply(_q2.setFromAxisAngle(_d1.set(0, 0, 1), -curl)); }
      S.hand.updateMatrixWorld(true);
      const tip = mid[2].getWorldPosition(new THREE.Vector3());
      S.hand.worldToLocal(tip);
      mid.forEach((b, i) => b.quaternion.copy(saved[i]));
      return tip;
    };
    const palm = tipLocal(0.9).sub(tipLocal(0));
    palm.addScaledVector(dir, -palm.dot(dir)).normalize();
    const third = new THREE.Vector3().crossVectors(dir, palm);
    const m = new THREE.Matrix4().makeBasis(dir, palm, third);
    this._handBasis[key] = m;
    return m;
  }

  _orientHand(S, hp, wm) {
    const hb = this._handRestBasis(S);
    wm.root.getWorldQuaternion(_q2);
    const dir = _d1.fromArray(hp.fingers).normalize().applyQuaternion(_q2);
    const palm = _d2.fromArray(hp.palm).normalize().applyQuaternion(_q2);
    palm.addScaledVector(dir, -palm.dot(dir)).normalize();
    const third = _e.crossVectors(dir, palm);
    _m1.makeBasis(dir, palm, third);
    // R_mundo(mão) * base_repouso = base_alvo  →  R_mundo(mão) = base_alvo * base_repouso^T
    _m2.copy(hb).transpose();
    _m1.multiply(_m2);
    _q3.setFromRotationMatrix(_m1);
    setBoneWorldQuaternion(S.hand, _q3);
  }

  _updateDeath(dt) {
    this.deathT += dt;
    const t = this.deathT;
    // 1) os joelhos cedem um pouco  2) o corpo tomba (pivô nos pés)  3) pequeno quique no chão
    this.crouch = damp(this.crouch, t < 0.35 ? 0.45 : 0.18, 9, dt);
    this.crouchAdd.setEffectiveWeight(this.crouch);
    for (const l of this.loco) { l.weight = damp(l.weight, 0, 10, dt); l.action.setEffectiveWeight(l.weight); }
    this.idleWeight = Math.max(0, 1 - this.loco.reduce((a, l) => a + l.weight, 0));
    this.idle.setEffectiveWeight(this.idleWeight);
    this.mixer.update(0);
    const k = smooth(0.08, 0.72, t);
    let angle = k * k * 86 * DEG;
    if (t > 0.72 && t < 0.98) angle -= Math.sin(((t - 0.72) / 0.26) * Math.PI) * 4 * DEG;
    const side = this.fallSide;
    this.fall.rotation.set(angle * (1 - Math.abs(side) * 0.5), 0, -side * angle * 0.6);
    this.fall.position.set(0, Math.sin(angle) * 0.17, Math.sin(angle) * 0.1);
    this.root.updateMatrixWorld(true);
    // braços soltos: para os lados do corpo e em direção ao chão (alvo no espaço do MUNDO, para que
    // nenhum braço aponte para o céu quando o corpo tomba de lado)
    const B = this.bones;
    const fq = this.fall.getWorldQuaternion(_wquat);
    for (const s of ['L', 'R']) {
      const S = B[s];
      const sign = s === 'L' ? -1 : 1;     // lado no espaço do jogo (frente = -Z)
      _lat.set(sign, 0, 0).applyQuaternion(fq); _lat.y = 0;
      if (_lat.lengthSq() < 1e-4) _lat.set(sign, 0, 0).applyQuaternion(this.root.quaternion);
      _lat.normalize();
      _feet.set(0, -1, 0).applyQuaternion(fq); _feet.y = 0;
      if (_feet.lengthSq() > 1e-4) _feet.normalize();
      _armT.copy(_lat).multiplyScalar(0.8).addScaledVector(_feet, 0.3 + 0.3 * (1 - k));
      _armT.y = -0.55;
      S.upper.getWorldPosition(_a);
      S.fore.getWorldPosition(_b);
      aimBone(S.upper, _p.copy(_b).sub(_a), _armT, k);
      S.upper.updateMatrixWorld(true);
      S.fore.getWorldPosition(_b);
      S.hand.getWorldPosition(_e);
      _foreT.copy(_armT); _foreT.y = -0.35;
      aimBone(S.fore, _p.copy(_e).sub(_b), _foreT, k);
    }
    // a arma cai separada do corpo e fica no chão
    const w = this.weapon, d = this.weaponDrop;
    if (w && d && !d.rest) {
      d.vy -= 9.8 * dt;
      w.root.position.y += d.vy * dt;
      w.root.rotation.z += d.spin * dt;
      w.root.rotation.x = damp(w.root.rotation.x, 0, 4, dt);
      if (w.root.position.y <= 0.04) { w.root.position.y = 0.04; d.rest = true; w.root.rotation.x = 0; w.root.rotation.z = Math.PI / 2; }
    }
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    for (const m of this.weapons.values()) this.root.remove(m.root);
    this.weapons.clear();
    this.root.removeFromParent();
  }
}
