// Jogadores remotos: modelo humanoide procedural (geometria/materiais compartilhados),
// interpolação de snapshots no tempo do servidor, animação de passos/agachamento/mira,
// disparo, dano, eliminação e placas de nome sem revelar ninguém através de paredes.
import * as THREE from 'three';
import { TEAM, TEAM_COLORS } from '../shared/protocol.js';
import { MOVE_STATES } from '../shared/movement.js';
import { lerp, damp, wrapAngle, clamp, createCanvas } from '../utils.js';

const BUFFER_SIZE = 40;
const TEAM_ARMOR = { [TEAM.ALFA]: 0x3c6f7d, [TEAM.OMEGA]: 0x7d3324, [TEAM.NONE]: 0x5a5f66 };
const TEAM_GLOW = { [TEAM.ALFA]: 0x3ef0ff, [TEAM.OMEGA]: 0xff6a3d, [TEAM.NONE]: 0xcfd6dc };

function createShared() {
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  return {
    geo: {
      boot: B(0.15, 0.1, 0.27), shin: B(0.13, 0.42, 0.15), knee: B(0.14, 0.11, 0.06), thigh: B(0.15, 0.44, 0.17),
      hips: B(0.36, 0.16, 0.22), belly: B(0.3, 0.22, 0.2), chest: B(0.46, 0.38, 0.28), plate: B(0.34, 0.24, 0.05),
      pack: B(0.34, 0.36, 0.14), shoulder: B(0.15, 0.13, 0.2), upperArm: B(0.1, 0.3, 0.11), foreArm: B(0.09, 0.28, 0.1),
      neck: new THREE.CylinderGeometry(0.055, 0.065, 0.1, 8), helmet: B(0.25, 0.23, 0.27), visor: B(0.22, 0.06, 0.02),
      rifleBody: B(0.06, 0.09, 0.42), rifleBarrel: new THREE.CylinderGeometry(0.014, 0.014, 0.3, 6).rotateX(Math.PI / 2),
      rifleMag: B(0.045, 0.14, 0.07), rifleStock: B(0.05, 0.08, 0.16), flash: new THREE.PlaneGeometry(0.3, 0.3),
    },
    suit: new THREE.MeshStandardMaterial({ color: 0x2a2f37, roughness: 0.85, metalness: 0.1 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.6, metalness: 0.5 }),
    gun: new THREE.MeshStandardMaterial({ color: 0x30353d, roughness: 0.4, metalness: 0.75 }),
    flash: new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  };
}

function makeNameTexture(name, color) {
  const c = createCanvas(256, 64);
  const ctx = c.getContext('2d');
  ctx.font = '700 30px Bahnschrift, "Arial Narrow", Arial, sans-serif';
  const w = Math.min(240, ctx.measureText(name).width + 28);
  ctx.fillStyle = 'rgba(8,11,15,0.72)';
  ctx.fillRect((256 - w) / 2, 10, w, 44);
  ctx.fillStyle = color;
  ctx.fillRect((256 - w) / 2, 10, 4, 44);
  ctx.fillStyle = '#ecf1f4';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(name, 128 + 2, 33);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Avatar {
  constructor(manager, sid, team, name) {
    this.manager = manager;
    this.sid = sid;
    this.team = team;
    this.name = name;
    this.buffer = [];
    this.root = new THREE.Group();
    this.root.name = `avatar-${sid}`;
    this.pos = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.h = 1.8; this.alive = true; this.move = 0;
    this.walkPhase = 0; this.speed = 0; this.deathT = 0; this.flashT = 0; this.hitT = 0; this.kick = 0;
    this.connected = true;
    this.build();
  }

  build() {
    const S = this.manager.shared;
    const g = S.geo;
    this.armor = new THREE.MeshStandardMaterial({ color: TEAM_ARMOR[this.team], roughness: 0.45, metalness: 0.35, emissive: 0x000000 });
    this.glow = new THREE.MeshStandardMaterial({ color: 0x101418, emissive: TEAM_GLOW[this.team], emissiveIntensity: 1.6 });
    const add = (parent, geo, mat, x, y, z, shadow = false) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; parent.add(m); return m;
    };
    this.body = new THREE.Group();
    this.root.add(this.body);
    // pernas (pivô no quadril)
    this.legs = [-1, 1].map((side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.1, 0.9, 0);
      add(hip, g.thigh, S.suit, 0, -0.22, 0, true);
      const knee = new THREE.Group();
      knee.position.set(0, -0.44, 0);
      add(knee, g.knee, this.armor, 0, 0.02, -0.09);
      add(knee, g.shin, S.suit, 0, -0.21, 0, true);
      add(knee, g.boot, S.dark, 0, -0.41, -0.04);
      hip.add(knee);
      this.body.add(hip);
      return { hip, knee };
    });
    // tronco (pivô na cintura) — inclina com a mira
    this.torso = new THREE.Group();
    this.torso.position.set(0, 0.9, 0);
    this.body.add(this.torso);
    add(this.torso, g.hips, S.dark, 0, 0.04, 0, true);
    add(this.torso, g.belly, S.suit, 0, 0.2, 0);
    add(this.torso, g.chest, this.armor, 0, 0.47, 0, true);
    add(this.torso, g.plate, this.glow, 0, 0.42, -0.16);
    add(this.torso, g.pack, S.dark, 0, 0.47, 0.2, true);
    for (const side of [-1, 1]) add(this.torso, g.shoulder, this.armor, side * 0.29, 0.6, 0);
    // cabeça
    this.head = new THREE.Group();
    this.head.position.set(0, 0.7, 0);
    this.torso.add(this.head);
    add(this.head, g.neck, S.dark, 0, 0.02, 0);
    add(this.head, g.helmet, this.armor, 0, 0.17, 0, true);
    add(this.head, g.visor, this.glow, 0, 0.18, -0.136);
    // braços + fuzil (pivô nos ombros, acompanha a inclinação da mira)
    this.aim = new THREE.Group();
    this.aim.position.set(0, 0.58, 0);
    this.torso.add(this.aim);
    const armR = add(this.aim, g.upperArm, S.suit, 0.25, -0.12, -0.08); armR.rotation.x = 0.9;
    const armL = add(this.aim, g.upperArm, S.suit, -0.22, -0.12, -0.12); armL.rotation.set(1.0, 0, -0.35);
    const foreR = add(this.aim, g.foreArm, this.armor, 0.16, -0.2, -0.3); foreR.rotation.set(1.5, 0, 0.5);
    const foreL = add(this.aim, g.foreArm, this.armor, -0.08, -0.16, -0.38); foreL.rotation.set(1.5, 0, -0.8);
    const rifle = new THREE.Group();
    rifle.position.set(0.08, -0.17, -0.42);
    add(rifle, g.rifleBody, S.gun, 0, 0, 0, true);
    add(rifle, g.rifleBarrel, S.gun, 0, 0.01, -0.34);
    add(rifle, g.rifleMag, S.dark, 0, -0.1, -0.04);
    add(rifle, g.rifleStock, S.dark, 0, -0.01, 0.27);
    this.flash = add(rifle, g.flash, S.flash, 0, 0.01, -0.52);
    this.flash.visible = false;
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.01, -0.5);
    rifle.add(this.muzzle);
    this.aim.add(rifle);
    // placa de nome
    this.nameTex = makeNameTexture(this.name, TEAM_COLORS[this.team]);
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.nameTex, depthTest: false, transparent: true }));
    this.label.scale.set(1.1, 0.275, 1);
    this.label.position.set(0, 2.15, 0);
    this.label.renderOrder = 20;
    this.label.visible = false;
    this.root.add(this.label);
  }

  setTeam(team) {
    if (team === this.team) return;
    this.team = team;
    this.armor.color.setHex(TEAM_ARMOR[team]);
    this.glow.emissive.setHex(TEAM_GLOW[team]);
    this.setName(this.name, true);
  }

  setName(name, force = false) {
    if (name === this.name && !force) return;
    this.name = name;
    this.nameTex.dispose();
    this.nameTex = makeNameTexture(name, TEAM_COLORS[this.team]);
    this.label.material.map = this.nameTex;
    this.label.material.needsUpdate = true;
  }

  /** Recebe um snapshot do servidor (t = tempo do servidor em ms). */
  push(t, p, spawnSeq) {
    const last = this.buffer[this.buffer.length - 1];
    if (last && t <= last.t) return; // fora de ordem/duplicado
    const teleport = last && (spawnSeq !== last.spawnSeq || Math.hypot(p.x - last.x, p.z - last.z) > 4);
    if (teleport) this.buffer.length = 0;
    this.buffer.push({ t, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, h: p.h, move: p.move, spawnSeq });
    if (this.buffer.length > BUFFER_SIZE) this.buffer.shift();
  }

  /** Interpola no instante renderT (ms no relógio do servidor). */
  sample(renderT) {
    const b = this.buffer;
    if (!b.length) return false;
    let a = b[0], c = b[b.length - 1];
    if (renderT <= a.t) c = a;
    else if (renderT >= c.t) a = c;
    else {
      for (let i = 0; i < b.length - 1; i++) if (b[i].t <= renderT && b[i + 1].t >= renderT) { a = b[i]; c = b[i + 1]; break; }
    }
    const span = c.t - a.t;
    const k = span > 0 ? clamp((renderT - a.t) / span, 0, 1) : 1;
    this.prevPos.copy(this.pos);
    this.pos.set(lerp(a.x, c.x, k), lerp(a.y, c.y, k), lerp(a.z, c.z, k));
    this.yaw = a.yaw + wrapAngle(c.yaw - a.yaw) * k;
    this.pitch = lerp(a.pitch, c.pitch, k);
    this.h = lerp(a.h, c.h, k);
    this.move = k < 0.5 ? a.move : c.move;
    return true;
  }

  fire() { this.flashT = 0.05; this.kick = 1; }

  hit() { this.hitT = 0.15; }

  update(dt, renderT) {
    if (!this.sample(renderT)) { this.root.visible = false; return; }
    this.root.visible = this.connected && (this.alive || this.deathT < 2.4);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    const moved = Math.hypot(this.pos.x - this.prevPos.x, this.pos.z - this.prevPos.z);
    this.speed = damp(this.speed, dt > 0 ? moved / dt : 0, 12, dt);
    const state = MOVE_STATES[this.move] || 'idle';
    const crouch = clamp((1.8 - this.h) / 0.58, 0, 1);
    // agachamento: abaixa o tronco e dobra os joelhos
    const hipY = 0.9 - crouch * 0.5;
    this.torso.position.y = hipY;
    for (const [i, leg] of this.legs.entries()) {
      leg.hip.position.y = hipY;
      this.walkPhase += i === 0 ? this.speed * dt * 2.4 : 0;
      const swing = state === 'air' ? 0.35 : Math.sin(this.walkPhase + i * Math.PI) * clamp(this.speed / 5, 0, 1) * 0.65;
      leg.hip.rotation.x = -crouch * 1.1 + swing;
      leg.knee.rotation.x = crouch * 1.9 + Math.max(0, -swing) * 0.6;
    }
    // mira: inclina tronco e braços com o pitch
    this.kick = damp(this.kick, 0, 18, dt);
    this.aim.rotation.x = this.pitch * 0.85 + this.kick * 0.12;
    this.head.rotation.x = this.pitch * 0.5;
    this.torso.rotation.x = this.pitch * 0.15 + crouch * 0.12;
    // disparo e dano
    if (this.flashT > 0) { this.flashT -= dt; this.flash.visible = this.flashT > 0; this.flash.rotation.z += 1.7; }
    if (this.hitT > 0) { this.hitT -= dt; const k = Math.max(0, this.hitT / 0.15); this.armor.emissive.setRGB(k * 1.2, k * 0.9, k * 0.8); }
    else this.armor.emissive.setRGB(0, 0, 0);
    // eliminação: queda para trás e desaparecimento
    if (!this.alive) {
      this.deathT += dt;
      const f = clamp(this.deathT / 0.5, 0, 1);
      this.body.rotation.x = 1.4 * f * f;
      this.body.position.y = -0.1 * f;
    } else {
      this.deathT = 0;
      this.body.rotation.x = 0;
      this.body.position.y = 0;
    }
  }

  getMuzzleWorld(out) { this.root.updateMatrixWorld(true); return this.muzzle.getWorldPosition(out); }

  dispose() {
    this.armor.dispose(); this.glow.dispose(); this.nameTex.dispose(); this.label.material.dispose();
  }
}

export class AvatarManager {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'remote-players';
    scene.add(this.group);
    this.shared = createShared();
    this.avatars = new Map();
    this.labelTimer = 0;
  }

  ensure(sid, team, name) {
    let a = this.avatars.get(sid);
    if (!a) {
      a = new Avatar(this, sid, team, name);
      this.avatars.set(sid, a);
      this.group.add(a.root);
    }
    return a;
  }

  remove(sid) {
    const a = this.avatars.get(sid);
    if (!a) return;
    this.group.remove(a.root);
    a.dispose();
    this.avatars.delete(sid);
  }

  clear() { for (const sid of [...this.avatars.keys()]) this.remove(sid); }

  /**
   * Atualiza poses e placas. As placas só aparecem com linha de visão livre (sem parede nem
   * fumaça no caminho): aliados sempre, inimigos apenas sob a mira.
   */
  update(dt, renderT, ctx) {
    for (const a of this.avatars.values()) a.update(dt, renderT);
    this.labelTimer -= dt;
    if (this.labelTimer > 0) return;
    this.labelTimer = 0.1;
    const { eye, forward, myTeam, map, smokeBlocked } = ctx;
    const head = new THREE.Vector3();
    for (const a of this.avatars.values()) {
      if (!a.root.visible || !a.alive) { a.label.visible = false; continue; }
      head.set(a.pos.x, a.pos.y + a.h + 0.15, a.pos.z);
      const toHead = head.clone().sub(eye);
      const dist = toHead.length();
      const ally = a.team === myTeam;
      let wanted = ally ? dist < 60 : false;
      if (!ally && dist < 45) {
        const chest = new THREE.Vector3(a.pos.x, a.pos.y + a.h * 0.7, a.pos.z).sub(eye).normalize();
        wanted = chest.dot(forward) > Math.cos(Math.atan2(0.45, dist));
      }
      if (wanted) {
        const target = new THREE.Vector3(a.pos.x, a.pos.y + a.h * 0.8, a.pos.z);
        wanted = !map.segmentBlocked(eye, target) && !smokeBlocked(eye, target);
      }
      a.label.visible = wanted;
      a.label.position.y = a.h + 0.35;
    }
  }

  dispose() {
    this.clear();
    this.scene.remove(this.group);
    Object.values(this.shared.geo).forEach((g) => g.dispose());
    ['suit', 'dark', 'gun', 'flash'].forEach((k) => this.shared[k].dispose());
  }
}
