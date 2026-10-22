// Bots de treinamento: modelo robótico procedural, vida, hitboxes por região,
// estados de combate, reações a dano, eliminação e reaparecimento.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, damp, wrapAngle, createRng, randRange, easeOutCubic, invLerp, mergeGeometries } from './utils.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _end = new THREE.Vector3();

class Enemy {
  constructor(def, manager, index) {
    this.id = `BOT-${def.id}`;
    this.def = def;
    this.index = index;
    this.manager = manager;
    this.spawn = new THREE.Vector3(def.x, def.y, def.z);
    this.railEnd = def.type === 'strafe' ? new THREE.Vector3(def.to[0], def.y, def.to[1]) : null;
    this.baseYaw = Math.atan2(0 - def.x, 38 - def.z); // voltado para a área de preparação
    this.position = new THREE.Vector3();
    this.hitboxes = [];
    this.stats = { shotsReceived: 0, damageTaken: 0, kills: 0 };
    this.buildModel();
  }

  buildModel() {
    const { geo, mat, merged } = this.manager.shared;
    this.armor = mat.armor.clone();
    this.visorMat = mat.visor.clone();
    const materialFor = { armor: this.armor, visor: this.visorMat, frame: mat.frame, joint: mat.joint };
    // as peças de cada grupo animado são fundidas por material (menos draw calls);
    // as geometrias fundidas são compartilhadas entre todos os bots
    const batches = new Map();
    const add = (parent, groupKey, g, matKey, x, y, z, shadow = false) => {
      const key = `${groupKey}|${matKey}`;
      const batchKey = `${key}@${parent.uuid}`;
      if (!batches.has(batchKey)) batches.set(batchKey, { parent, key, matKey, shadow: false, parts: [] });
      const batch = batches.get(batchKey);
      batch.shadow = batch.shadow || shadow;
      batch.parts.push({ g, x, y, z });
    };
    const root = new THREE.Group();
    root.name = this.id;
    this.root = root;
    this.body = new THREE.Group();          // usado para animação de morte/surgimento
    root.add(this.body);

    // pernas
    this.legs = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * 0.12, 0.86, 0);
      add(leg, 'leg', geo.thigh, 'frame', 0, -0.2, 0, true);
      add(leg, 'leg', geo.kneePad, 'armor', 0, -0.42, 0.09);
      add(leg, 'leg', geo.shin, 'armor', 0, -0.62, 0);
      add(leg, 'leg', geo.foot, 'frame', 0, -0.83, 0.04);
      this.body.add(leg);
      this.legs.push(leg);
    }
    // tronco
    const torso = new THREE.Group();
    torso.position.set(0, 0.86, 0);
    this.torso = torso;
    this.body.add(torso);
    add(torso, 'torso', geo.pelvis, 'frame', 0, 0.06, 0, true);
    add(torso, 'torso', geo.abdomen, 'joint', 0, 0.22, 0);
    add(torso, 'torso', geo.chest, 'armor', 0, 0.53, 0, true);
    add(torso, 'torso', geo.chestPlate, 'frame', 0, 0.56, 0.16);
    add(torso, 'torso', geo.backpack, 'frame', 0, 0.55, -0.21);
    add(torso, 'torso', geo.stripe, 'visor', 0, 0.42, 0.195);
    // braços
    this.arms = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.35, 0.74, 0);
      add(arm, 'arm', geo.shoulder, 'armor', 0, 0.04, 0);
      add(arm, 'arm', geo.upperArm, 'frame', 0, -0.18, 0);
      const fore = new THREE.Group();
      fore.position.set(0, -0.34, 0);
      fore.rotation.x = side > 0 ? -1.25 : -0.9;
      const foreKey = side > 0 ? 'foreR' : 'foreL';
      add(fore, foreKey, geo.forearm, 'armor', 0, -0.14, 0);
      if (side > 0) {
        add(fore, foreKey, geo.gun, 'frame', 0, -0.3, 0.0);
        this.muzzle = new THREE.Object3D();
        this.muzzle.position.set(0, -0.5, 0.0);
        fore.add(this.muzzle);
      }
      arm.add(fore);
      torso.add(arm);
      this.arms.push(arm);
    }
    // cabeça
    const head = new THREE.Group();
    head.position.set(0, 0.92, 0);
    this.head = head;
    torso.add(head);
    add(head, 'head', geo.neck, 'joint', 0, 0.0, 0);
    add(head, 'head', geo.head, 'armor', 0, 0.13, 0, true);
    add(head, 'head', geo.visor, 'visor', 0, 0.15, 0.135);
    add(head, 'head', geo.antenna, 'frame', 0.08, 0.36, -0.06);

    for (const b of batches.values()) {
      let g = merged.get(b.key);
      if (!g) {
        const parts = b.parts.map((p) => p.g.clone().translate(p.x, p.y, p.z));
        g = mergeGeometries(parts);
        parts.forEach((pg) => pg.dispose());
        merged.set(b.key, g);
      }
      const mesh = new THREE.Mesh(g, materialFor[b.matKey]);
      mesh.castShadow = b.shadow;
      b.parent.add(mesh);
    }

    // hitboxes invisíveis (regiões de dano)
    const hb = (g, parent, zone, x, y, z) => {
      const m = new THREE.Mesh(g, mat.hitbox);
      m.position.set(x, y, z);
      m.visible = false;
      m.userData.enemy = this;
      m.userData.zone = zone;
      parent.add(m);
      this.hitboxes.push(m);
    };
    hb(geo.hbHead, head, 'head', 0, 0.14, 0.01);
    hb(geo.hbTorso, torso, 'body', 0, 0.42, 0);
    hb(geo.hbLegs, this.body, 'legs', 0, 0.43, 0);
  }

  reset(startDelay = 0) {
    this.health = CONFIG.enemies.health;
    this.state = startDelay > 0 ? 'dead' : 'spawning';
    this.stateTime = 0;
    this.respawnTimer = startDelay;
    this.flashT = 0;
    this.hitKick = 0;
    this.hitSide = 0;
    this.alerted = false;
    this.combat = 'idle';
    this.combatT = 0;
    this.burstLeft = 0;
    this.burstT = 0;
    this.yaw = this.baseYaw;
    this.railT = 0;
    this.railDir = 1;
    this.railPause = 0;
    this.walkPhase = 0;
    this.distanceToPlayer = 0;
    this.stats.shotsReceived = 0;
    this.stats.damageTaken = 0;
    this.position.copy(this.spawn);
    this.root.position.copy(this.spawn);
    this.root.rotation.set(0, this.yaw, 0);
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.body.scale.set(1, 1, 1);
    this.torso.rotation.set(0, 0, 0);
    this.armor.emissive.setRGB(0, 0, 0);
    this.armor.transparent = false;
    this.armor.opacity = 1;
    this.visorMat.emissiveIntensity = 1.2;
    this.root.visible = this.state !== 'dead';
    if (this.state === 'spawning') this.body.scale.y = 0.01;
  }

  get active() { return this.state === 'active'; }

  /** Aplica dano. Retorna true apenas na transição para eliminado (contagem única). */
  receiveDamage(amount, fromPos) {
    if (this.state !== 'active') return false;
    this.stats.shotsReceived++;
    this.stats.damageTaken += amount;
    this.health = Math.max(0, this.health - amount);
    this.flashT = CONFIG.enemies.hitFlashTime;
    this.hitKick = 1;
    this.alerted = true;
    if (fromPos) {
      const rel = wrapAngle(Math.atan2(fromPos.x - this.position.x, fromPos.z - this.position.z) - this.yaw);
      this.hitSide = Math.sign(rel) || 1;
    }
    if (this.health <= 0) {
      this.state = 'dying';
      this.stateTime = 0;
      this.manager.releaseAggressor(this);
      this.combat = 'idle';
      return true;
    }
    return false;
  }

  update(dt, ctx) {
    const cfg = CONFIG.enemies;
    this.stateTime += dt;
    if (this.state === 'dead') {
      if (this.respawnTimer > 0) {
        this.respawnTimer -= dt;
        if (this.respawnTimer <= 0) this.beginSpawn();
      }
      return;
    }
    if (this.state === 'spawning') {
      const t = clamp(this.stateTime / cfg.spawnInTime, 0, 1);
      this.body.scale.y = Math.max(0.01, easeOutCubic(t));
      this.armor.emissive.setRGB(1.0 * (1 - t), 0.25 * (1 - t), 0.2 * (1 - t));
      if (t >= 1) { this.state = 'active'; this.stateTime = 0; this.armor.emissive.setRGB(0, 0, 0); }
      this.root.updateMatrixWorld(true);
      return;
    }
    if (this.state === 'dying') {
      this.updateDeath(dt);
      return;
    }

    // ---- ativo
    this.distanceToPlayer = this.position.distanceTo(ctx.playerPosition);

    // deslocamento lateral em trilho
    let moving = false;
    if (this.railEnd) {
      if (this.railPause > 0) this.railPause -= dt;
      else {
        const len = this.spawn.distanceTo(this.railEnd);
        this.railT += (this.railDir * cfg.strafeSpeed * dt) / len;
        if (this.railT >= 1 || this.railT <= 0) {
          this.railT = clamp(this.railT, 0, 1);
          this.railDir *= -1;
          this.railPause = 0.5;
        }
        moving = true;
      }
      const s = this.railT * this.railT * (3 - 2 * this.railT);
      this.position.lerpVectors(this.spawn, this.railEnd, s);
      this.root.position.copy(this.position);
    }

    // orientação
    const toPlayer = Math.atan2(ctx.playerPosition.x - this.position.x, ctx.playerPosition.z - this.position.z);
    let targetYaw = this.baseYaw + Math.sin(ctx.time * 0.5 + this.index * 1.7) * 0.35;
    if (this.alerted || this.combat !== 'idle') targetYaw = toPlayer;
    const diff = wrapAngle(targetYaw - this.yaw);
    this.yaw += clamp(diff, -cfg.turnSpeed * dt, cfg.turnSpeed * dt);
    this.root.rotation.y = this.yaw;

    // animação ociosa / caminhada
    this.walkPhase += dt * (moving ? 9 : 0);
    const swing = moving ? Math.sin(this.walkPhase) * 0.5 : 0;
    this.legs[0].rotation.x = damp(this.legs[0].rotation.x, swing, 12, dt);
    this.legs[1].rotation.x = damp(this.legs[1].rotation.x, -swing, 12, dt);
    const breathe = Math.sin(ctx.time * 2 + this.index) * 0.015;
    this.hitKick = damp(this.hitKick, 0, 10, dt);
    this.torso.position.y = 0.86 + breathe;
    this.torso.rotation.x = -0.28 * this.hitKick;
    this.torso.rotation.z = 0.12 * this.hitKick * this.hitSide;
    this.head.rotation.y = this.combat === 'idle' && !this.alerted ? Math.sin(ctx.time * 0.8 + this.index) * 0.4 : 0;

    // brilho de dano
    if (this.flashT > 0) {
      this.flashT -= dt;
      const k = clamp(this.flashT / cfg.hitFlashTime, 0, 1);
      this.armor.emissive.setRGB(k * 1.4, k * 1.2, k * 1.1);
    } else this.armor.emissive.setRGB(0, 0, 0);

    if (ctx.fireBack) this.updateCombat(dt, ctx, toPlayer);
    else if (this.combat !== 'idle') { this.manager.releaseAggressor(this); this.combat = 'idle'; }

    // indicador visual do visor
    const tele = this.combat === 'telegraph' ? 1.2 + Math.abs(Math.sin(this.combatT * 30)) * 3.5 : this.combat === 'firing' ? 4 : 1.2;
    this.visorMat.emissiveIntensity = tele;

    this.root.updateMatrixWorld(true);
  }

  canSeePlayer(ctx, toPlayer) {
    const cfg = CONFIG.enemies;
    if (ctx.playerSafe || !ctx.playerAlive) return false;
    if (this.distanceToPlayer > cfg.detectRange) return false;
    const off = Math.abs(wrapAngle(toPlayer - this.yaw));
    if (!this.alerted && off > cfg.viewCone / 2) return false;
    const eye = this.getEyePosition(_v1);
    return !ctx.visionBlocked(eye, ctx.playerChest);
  }

  updateCombat(dt, ctx, toPlayer) {
    const cfg = CONFIG.enemies;
    this.combatT += dt;
    const sees = this.canSeePlayer(ctx, toPlayer);
    switch (this.combat) {
      case 'idle':
        if (sees) { this.combat = 'reacting'; this.combatT = 0; this.alerted = true; }
        break;
      case 'reacting':
        if (!sees) { this.combat = 'idle'; break; }
        if (this.combatT >= cfg.reactionTime && this.manager.claimAggressor(this)) {
          this.combat = 'telegraph'; this.combatT = 0;
          this.manager.audio.play('enemyTelegraph', { at: this.position });
        }
        break;
      case 'telegraph':
        if (!sees) { this.manager.releaseAggressor(this); this.combat = 'idle'; break; }
        if (this.combatT >= cfg.telegraphTime) {
          this.combat = 'firing'; this.combatT = 0; this.burstLeft = cfg.burstShots; this.burstT = 0;
        }
        break;
      case 'firing':
        if (!sees) { this.manager.releaseAggressor(this); this.combat = 'cooldown'; this.combatT = 0; this.cooldown = cfg.cooldownMin; break; }
        this.burstT -= dt;
        if (this.burstT <= 0 && this.burstLeft > 0) {
          this.fireAtPlayer(ctx);
          this.burstLeft--;
          this.burstT = cfg.burstInterval;
        }
        if (this.burstLeft <= 0 && this.burstT <= 0) {
          this.manager.releaseAggressor(this);
          this.combat = 'cooldown'; this.combatT = 0;
          this.cooldown = randRange(this.manager.rng, cfg.cooldownMin, cfg.cooldownMax);
        }
        break;
      case 'cooldown':
        if (this.combatT >= this.cooldown) { this.combat = sees ? 'reacting' : 'idle'; this.combatT = cfg.reactionTime * 0.5; }
        break;
      default: break;
    }
  }

  fireAtPlayer(ctx) {
    const cfg = CONFIG.enemies;
    const acc = cfg.accuracy;
    const muzzle = this.muzzle.getWorldPosition(_muzzle);
    let p = acc.base * (1 - invLerp(acc.nearDistance, acc.farDistance, this.distanceToPlayer) * 0.7);
    const ms = ctx.playerMovement;
    if (ms.state === 'air') p *= acc.airMultiplier;
    else if (ms.state === 'run') p *= acc.movingMultiplier;
    if (ms.crouching) p *= acc.crouchMultiplier;
    p = Math.max(acc.minimum, p);
    const hit = this.manager.rng() < p;
    this.manager.effects.enemyMuzzleFlash(muzzle);
    this.manager.audio.play('enemyShot', { at: this.position });
    const target = _v3.copy(ctx.playerChest);
    if (hit) {
      // traçante termina pouco antes da câmera
      const end = _end.copy(target).sub(muzzle);
      const d = end.length();
      end.multiplyScalar(Math.max(0, d - 1.2) / d).add(muzzle);
      this.manager.effects.tracer(muzzle, end, 'enemy');
      ctx.onPlayerHit(cfg.damage, this.position);
    } else {
      // erro: desvia o tiro lateralmente e marca o impacto no cenário atrás do jogador
      const rng = this.manager.rng;
      target.x += (rng() - 0.5) * 2.4;
      target.y += (rng() - 0.3) * 1.2;
      target.z += (rng() - 0.5) * 2.4;
      const dir = _v1.copy(target).sub(muzzle).normalize();
      const hitInfo = this.manager.map.raycast(muzzle, dir, 80, this.manager._rayOut);
      const end = hitInfo ? hitInfo.point : _end.copy(muzzle).addScaledVector(dir, 80);
      this.manager.effects.tracer(muzzle, end, 'enemy');
      if (hitInfo) this.manager.effects.impact(hitInfo.point, hitInfo.normal, hitInfo.surface);
      this.manager.audio.play('bulletPass', { at: target });
    }
  }

  getEyePosition(out) { return out.set(this.position.x, this.position.y + 1.88, this.position.z); }

  getCenter(out) { return out.set(this.position.x, this.position.y + 1.2, this.position.z); }

  updateDeath(dt) {
    const cfg = CONFIG.enemies;
    const t = clamp(this.stateTime / cfg.deathTime, 0, 1);
    const fall = easeOutCubic(clamp(t / 0.6, 0, 1));
    this.body.rotation.x = -1.35 * fall;
    this.body.rotation.z = 0.25 * fall * this.hitSide;
    this.body.position.y = -0.15 * fall;
    const glow = 1 - t;
    this.armor.emissive.setRGB(0.9 * glow, 0.15 * glow, 0.1 * glow);
    this.visorMat.emissiveIntensity = 1.2 * (1 - t);
    if (t > 0.55) {
      const s = 1 - (t - 0.55) / 0.45;
      this.body.scale.set(1, Math.max(0.01, s), 1);
    }
    this.root.updateMatrixWorld(true);
    if (t >= 1) {
      this.state = 'dead';
      this.stateTime = 0;
      this.root.visible = false;
      this.respawnTimer = CONFIG.enemies.respawn ? CONFIG.enemies.respawnDelay : 0;
    }
  }

  beginSpawn() {
    this.reset(0);
    this.root.visible = true;
    this.manager.effects.spawnIn(this.position);
    this.manager.audio.play('spawnIn', { at: this.position });
  }
}

export class EnemyManager {
  constructor(scene, map, effects, audio, events) {
    this.scene = scene;
    this.map = map;
    this.effects = effects;
    this.audio = audio;
    this.events = events;
    this.rng = createRng(9001);
    this.group = new THREE.Group();
    this.group.name = 'enemies';
    scene.add(this.group);
    this.enemies = [];
    this.aggressors = new Set();
    this.raycaster = new THREE.Raycaster();
    this._activeHitboxes = [];
    this._rayOut = {};
    this.createShared();
  }

  createShared() {
    const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    this.shared = {
      geo: {
        thigh: B(0.15, 0.42, 0.17), kneePad: B(0.15, 0.12, 0.06), shin: B(0.16, 0.42, 0.18), foot: B(0.17, 0.08, 0.28),
        pelvis: B(0.42, 0.16, 0.26), abdomen: B(0.3, 0.24, 0.2), chest: B(0.56, 0.5, 0.32), chestPlate: B(0.36, 0.26, 0.06),
        backpack: B(0.38, 0.42, 0.14), stripe: B(0.3, 0.035, 0.02),
        shoulder: B(0.22, 0.16, 0.26), upperArm: B(0.1, 0.3, 0.11), forearm: B(0.14, 0.3, 0.15), gun: B(0.08, 0.42, 0.1),
        neck: new THREE.CylinderGeometry(0.06, 0.07, 0.14, 8), head: B(0.26, 0.24, 0.28), visor: B(0.22, 0.06, 0.03),
        antenna: new THREE.CylinderGeometry(0.008, 0.008, 0.26, 4),
        hbHead: B(0.34, 0.32, 0.34), hbTorso: B(0.84, 0.84, 0.46), hbLegs: B(0.46, 0.86, 0.34),
      },
      merged: new Map(),
      mat: {
        armor: new THREE.MeshStandardMaterial({ color: 0xc81e28, roughness: 0.42, metalness: 0.25, emissive: 0x000000 }),
        frame: new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.5, metalness: 0.7 }),
        joint: new THREE.MeshStandardMaterial({ color: 0x0f1012, roughness: 0.8, metalness: 0.3 }),
        visor: new THREE.MeshStandardMaterial({ color: 0x1a0805, emissive: 0xffa13a, emissiveIntensity: 1.2, roughness: 0.2 }),
        hitbox: new THREE.MeshBasicMaterial({ visible: false }),
      },
    };
  }

  spawnAll(defs) {
    if (this.enemies.length) return; // nunca duplica bots
    defs.forEach((def, i) => {
      const e = new Enemy(def, this, i);
      this.group.add(e.root);
      this.enemies.push(e);
    });
    this.reset();
  }

  reset() {
    this.aggressors.clear();
    this.enemies.forEach((e) => e.reset(0));
    // todos surgem já ativos no início da sessão
    this.enemies.forEach((e) => { e.state = 'active'; e.body.scale.y = 1; e.root.visible = true; e.root.updateMatrixWorld(true); });
  }

  claimAggressor(enemy) {
    if (this.aggressors.has(enemy)) return true;
    if (this.aggressors.size >= CONFIG.enemies.maxAggressors) return false;
    this.aggressors.add(enemy);
    return true;
  }

  releaseAggressor(enemy) { this.aggressors.delete(enemy); }

  update(dt, ctx) {
    for (const e of this.enemies) e.update(dt, ctx);
  }

  get aliveCount() { return this.enemies.filter((e) => e.state === 'active').length; }

  /** Raio contra as hitboxes dos bots ativos. Retorna o acerto mais próximo. */
  raycast(origin, dir, maxDist) {
    const list = this._activeHitboxes;
    list.length = 0;
    for (const e of this.enemies) if (e.active) for (const h of e.hitboxes) list.push(h);
    if (!list.length) return null;
    this.raycaster.set(origin, dir);
    this.raycaster.near = 0;
    this.raycaster.far = maxDist;
    const hits = this.raycaster.intersectObjects(list, false);
    if (!hits.length) return null;
    const h = hits[0];
    const normal = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : dir.clone().negate();
    return { enemy: h.object.userData.enemy, zone: h.object.userData.zone, distance: h.distance, point: h.point.clone(), normal };
  }

  /** Aplica dano a um bot; emite eventos de acerto/eliminação. */
  applyDamage(enemy, zone, baseDamage, multipliers, point, normal, fromPos) {
    if (!enemy.active) return null;
    const amount = Math.round(baseDamage * (multipliers[zone] ?? 1));
    const killed = enemy.receiveDamage(amount, fromPos);
    const headshot = zone === 'head';
    this.effects.enemyHit(point, normal, headshot);
    this.events.emit('enemyHit', { enemy, zone, amount, killed, headshot });
    if (killed) {
      this.effects.killBurst(enemy.position);
      this.events.emit('enemyKilled', { enemy, headshot });
    }
    return { amount, killed, headshot };
  }

  dispose() {
    this.scene.remove(this.group);
    for (const e of this.enemies) { e.armor.dispose(); e.visorMat.dispose(); }
    Object.values(this.shared.geo).forEach((g) => g.dispose());
    this.shared.merged.forEach((g) => g.dispose());
    Object.values(this.shared.mat).forEach((m) => m.dispose());
    this.enemies.length = 0;
  }
}

