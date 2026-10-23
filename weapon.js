// Sistema de armas: modelos em primeira pessoa, disparo hitscan, munição,
// recarga, cadência, dispersão por estado, recuo e animações.
// O kit (arma primária + pistola) vem do perfil/servidor; os modelos são os mesmos do arsenal e dos
// personagens em terceira pessoa (weapon-models.js), com mãos apenas na primeira pessoa.
import * as THREE from 'three';
import { CONFIG, DEG2RAD } from './config.js';
import { clamp, damp, lerp, createRng, createCanvas, smoothstep, disposeObject3D } from './utils.js';
import { computeSpread, recoilKick, loadoutFor } from './shared/weapon-rules.js';
import { buildWeaponModel } from './weapon-models.js';
import { getSkinMaterials } from './skins-render.js';

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _end = new THREE.Vector3();
const _muzzleWorld = new THREE.Vector3();
const _eject = new THREE.Vector3();

/** Pontos de ejeção das cápsulas no espaço da arma (janela do ferrolho / topo do ferrolho). */
const EJECT_PORT = { rifle: [0.03, 0.045, -0.06], smg: [0.026, 0.04, -0.03], pistol: [0.018, 0.05, -0.02], sniper: [0.036, 0.04, 0.06] };
const SHOT_SOUND = { rifle: 'rifleShot', smg: 'smgShot', pistol: 'pistolShot', sniper: 'sniperShot' };
const FLASH_SIZE = { rifle: 0.17, smg: 0.12, pistol: 0.13, sniper: 0.26 };
// recuo visual da arma em 1ª pessoa: [recuo para trás, inclinação]
const KICK = { rifle: [0.035, 0.045], smg: [0.026, 0.03], pistol: [0.05, 0.11], sniper: [0.085, 0.2] };

/**
 * Cápsulas ejetadas na arma em 1ª pessoa: conjunto fixo reaproveitado (sem criar geometria por
 * disparo), física simples no espaço da câmera da arma. Puramente visual.
 */
class CasingPool {
  constructor(scene, count = 12) {
    this.geometry = new THREE.CylinderGeometry(0.0042, 0.0042, 0.02, 6);
    this.geometry.rotateZ(Math.PI / 2);
    this.material = new THREE.MeshStandardMaterial({ color: 0xc9a050, metalness: 0.85, roughness: 0.35 });
    this.items = [];
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.items.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 });
    }
    this.cursor = 0;
  }

  spawn(pos, rng, scale = 1) {
    const c = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    c.mesh.position.copy(pos);
    c.mesh.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    c.mesh.scale.setScalar(scale);
    c.vel.set(1.1 + rng() * 0.5, 0.9 + rng() * 0.45, 0.15 + rng() * 0.2);
    c.spin.set(18 + rng() * 10, rng() * 8, 12 + rng() * 8);
    c.life = 0.6;
    c.mesh.visible = true;
  }

  update(dt) {
    for (const c of this.items) {
      if (c.life <= 0) continue;
      c.life -= dt;
      c.vel.y -= 9.8 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt; c.mesh.rotation.y += c.spin.y * dt; c.mesh.rotation.z += c.spin.z * dt;
      if (c.life <= 0) c.mesh.visible = false;
    }
  }

  clear() { for (const c of this.items) { c.life = 0; c.mesh.visible = false; } }

  dispose() { this.geometry.dispose(); this.material.dispose(); }
}

function makeFlashTexture() {
  const c = createCanvas(128);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,250,230,1)');
  g.addColorStop(0.2, 'rgba(255,200,110,0.9)');
  g.addColorStop(0.5, 'rgba(255,120,40,0.25)');
  g.addColorStop(1, 'rgba(255,90,20,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(255,210,140,0.75)';
  for (let i = 0; i < 6; i++) {
    ctx.save(); ctx.translate(64, 64); ctx.rotate((i / 6) * Math.PI * 2 + 0.3);
    ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(0, -62); ctx.lineTo(5, 0); ctx.fill();
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class WeaponSystem {
  constructor({ camera, map, enemies, effects, audio, events, player }) {
    this.camera = camera;
    this.map = map;
    this.enemies = enemies;
    this.effects = effects;
    this.audio = audio;
    this.events = events;
    this.player = player;

    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(CONFIG.camera.viewmodelFov, 1, 0.01, 10);
    this.viewScene.add(new THREE.HemisphereLight(0xc9d6ff, 0x40362e, 1.4));
    const key = new THREE.DirectionalLight(0xffd8b0, 2.2);
    key.position.set(-1, 2, 1.5);
    this.viewScene.add(key);
    const rim = new THREE.DirectionalLight(0x7fe9ff, 1.0);
    rim.position.set(1.5, 0.5, -1);
    this.viewScene.add(rim);
    this.viewFlashLight = new THREE.PointLight(0xffb060, 0, 2, 2);
    this.viewScene.add(this.viewFlashLight);
    this.casings = new CasingPool(this.viewScene);
    this.fxRng = createRng(77);              // separado: efeitos não alteram a sequência da dispersão

    this.flashTexture = makeFlashTexture();
    this.flashMaterial = new THREE.MeshBasicMaterial({ map: this.flashTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.models = new Map();               // id → modelo em 1ª pessoa (criado sob demanda, reaproveitado)
    this.primaryId = null;
    this.skins = {};                       // arma → acabamento equipado (só visual)
    this.setLoadout('rifle');
    this.rng = createRng(1);
    // estratégia de resolução dos disparos (substituída pelo modo online)
    this.shotResolver = (origin, dir, def, end) => this.resolveOffline(origin, dir, def, end);
    this.reset();
  }

  /** Modelo em primeira pessoa da arma `id` (com mãos e clarão de disparo). */
  modelFor(id, skin = this.skins[id] || '') {
    const key = `${id}|${skin}`;
    let model = this.models.get(key);
    if (!model) {
      model = buildWeaponModel(id, getSkinMaterials(skin), { hands: true });
      const flash = new THREE.Group();
      const fGeo = this._flashGeo || (this._flashGeo = new THREE.PlaneGeometry(1, 1));
      const p1 = new THREE.Mesh(fGeo, this.flashMaterial);
      const p2 = new THREE.Mesh(fGeo, this.flashMaterial); p2.rotation.y = Math.PI / 2;
      const p3 = new THREE.Mesh(fGeo, this.flashMaterial); p3.rotation.x = Math.PI / 2;
      flash.add(p1, p2, p3);
      flash.visible = false;
      model.muzzle.add(flash);
      model.flash = flash;
      model.root.visible = false;
      this.viewScene.add(model.root);
      this.models.set(key, model);
    }
    return model;
  }

  /**
   * Define o kit (arma primária + pistola). Online, o servidor confirma o kit em uso; offline vem do
   * perfil do jogador. Reinicia munição e estado das armas quando o kit muda.
   */
  setLoadout(primaryId, force = false) {
    const kit = loadoutFor(primaryId);
    if (this.primaryId === kit[1].id && this.weapons && !force) return false;
    this.primaryId = kit[1].id;
    for (const m of this.models.values()) m.root.visible = false;
    this.weapons = [kit[1], kit[2]].map((def) => ({ def, model: this.modelFor(def.id), mag: def.magSize, reserve: def.reserve }));
    if (this.rng) this.reset();
    return true;
  }

  /**
   * Acabamentos equipados (arma → skin). Só troca os modelos exibidos: munição, dispersão, recuo e
   * cadência continuam vindo exclusivamente da definição da arma.
   */
  setSkins(map = {}) {
    const next = { ...map };
    if (JSON.stringify(next) === JSON.stringify(this.skins)) return false;
    this.skins = next;
    if (!this.weapons) return true;
    const visible = this.current.model.root.visible;
    for (const w of this.weapons) {
      const model = this.modelFor(w.def.id);
      if (model !== w.model) { w.model.root.visible = false; w.model = model; }
    }
    this.current.model.root.visible = visible;
    return true;
  }

  reset() {
    for (const w of this.weapons) { w.mag = w.def.magSize; w.reserve = w.def.reserve; w.model.root.visible = false; }
    this.index = 0;
    this.time = 0;
    this.nextFireTime = 0;
    this.lastShotTime = -10;
    this.shotsInSequence = 0;
    this.bloom = 0;
    this.reloading = false;
    this.reloadT = 0;
    this.reloadStage = 0;
    this.switching = false;
    this.switchT = 0;
    this.switchTarget = 0;
    this.adsT = 0;
    this.flashT = 0;
    this.casings?.clear();
    this.kickBack = 0; this.kickPitch = 0; this.kickRoll = 0;
    this.swayX = 0; this.swayY = 0;
    this.triggerLatched = false;
    this.autoReloadT = -1;
    this.equipT = 0;
    this.boltT = -1;
    this.scoped = false;
    this.rng.reseed(1);
    this.current.model.root.visible = true;
    this.currentSpread = this.current.def.spread.idle;
    this.emitAmmo();
  }

  get current() { return this.weapons[this.index]; }

  /** Materiais de fábrica compartilhados (personagens em 3ª pessoa sem acabamento). */
  get materials() { return getSkinMaterials(''); }

  /** Usa o mesmo mapa de ambiente do mundo para reflexos coerentes na arma. */
  setEnvironment(texture) { this.viewScene.environment = texture; }

  setAspect(aspect) { this.viewCamera.aspect = aspect; this.viewCamera.updateProjectionMatrix(); }

  emitAmmo() {
    const w = this.current;
    this.events.emit('ammoChanged', { mag: w.mag, reserve: w.reserve, magSize: w.def.magSize, name: w.def.name, slot: w.def.slot, reloading: this.reloading });
  }

  /** Reabastece a munição reserva de todas as armas. Retorna true se algo mudou. */
  refillReserve() {
    let changed = false;
    for (const w of this.weapons) if (w.reserve < w.def.reserve) { w.reserve = w.def.reserve; changed = true; }
    if (changed) this.emitAmmo();
    return changed;
  }

  // ---- precisão -------------------------------------------------------------
  computeSpread(movement) {
    return computeSpread(this.current.def, movement, this.adsT, this.bloom);
  }

  // ---- ciclo ----------------------------------------------------------------
  update(dt, input, { movement, lookDX = 0, lookDY = 0, canFire = true, animate = true }) {
    this.time += dt;
    const w = this.current;
    const def = w.def;

    // troca de arma
    for (const other of this.weapons) {
      if (input.pressedAction(other.def.slot === 1 ? 'primary' : 'secondary') && other !== w && !this.switching) this.beginSwitch(this.weapons.indexOf(other));
    }
    if (this.switching) this.updateSwitch(dt);

    // mira (ADS)
    const wantsAds = canFire && input.isButtonDown(2) && !this.reloading && !this.switching;
    this.adsT = damp(this.adsT, wantsAds ? 1 : 0, 14, dt);
    if (this.adsT < 0.001) this.adsT = 0;

    // recarga
    if (canFire && input.pressedAction('reload')) this.startReload();
    if (this.autoReloadT >= 0) {
      this.autoReloadT -= dt;
      if (this.autoReloadT < 0) this.startReload();
    }
    if (this.reloading) this.updateReload(dt);

    // disparo
    const triggerDown = canFire && input.isButtonDown(0);
    if (!triggerDown) this.triggerLatched = false;
    if (triggerDown && !this.reloading && !this.switching && this.equipT >= 1) {
      if (w.mag <= 0) {
        if (!this.triggerLatched) {
          this.audio.play('empty');
          this.triggerLatched = true;
          if (w.reserve > 0) this.startReload();
        }
      } else if (def.automatic || !this.triggerLatched) {
        if (this.nextFireTime < this.time - dt) this.nextFireTime = this.time - dt;
        let shots = 0;
        while (this.time >= this.nextFireTime && w.mag > 0 && shots < CONFIG.perf.maxShotsPerFrame) {
          this.fire(movement);
          this.nextFireTime += 1 / def.fireRate;
          shots++;
          if (!def.automatic) break;
        }
        if (!def.automatic && shots > 0) this.triggerLatched = true;
      }
    }

    // recuperação da dispersão e do recuo
    const sinceShot = this.time - this.lastShotTime;
    if (sinceShot > 0.12) this.bloom = Math.max(0, this.bloom - def.spread.bloomRecovery * dt);
    if (sinceShot > def.spread.firstShotGrace) { this.shotsInSequence = 0; this.bloom = 0; }
    this.player.updateRecoil(dt, def.recoil.recoveryRate, sinceShot > def.recoil.recoveryDelay);

    this.currentSpread = this.computeSpread(movement);
    if (animate) this.animate(dt, lookDX, lookDY);
  }

  fire(movement) {
    const w = this.current;
    const def = w.def;
    w.mag--;
    this.lastShotTime = this.time;

    // direção: centro da câmera (já inclui o recuo) + dispersão em cone
    const spread = this.computeSpread(movement);
    this.camera.updateMatrixWorld();
    _origin.setFromMatrixPosition(this.camera.matrixWorld);
    this.camera.getWorldDirection(_dir);
    _right.setFromMatrixColumn(this.camera.matrixWorld, 0);
    _up.setFromMatrixColumn(this.camera.matrixWorld, 1);
    const ang = spread * Math.sqrt(this.rng());
    const theta = this.rng() * Math.PI * 2;
    const tanA = Math.tan(ang);
    _dir.addScaledVector(_right, tanA * Math.cos(theta)).addScaledVector(_up, tanA * Math.sin(theta)).normalize();

    // resolução do disparo: offline (local, contra bots) ou online (servidor autoritativo)
    const shot = this.shotResolver(_origin, _dir, def, _end);
    const hitResult = shot.result ?? null;

    // efeitos de disparo
    this.getMuzzleWorldPosition(_muzzleWorld);
    this.effects.tracer(_muzzleWorld, _end, 'player');
    this.effects.muzzleFlash(_muzzleWorld);
    this.flashT = 0.045;
    w.model.flash.visible = true;
    w.model.flash.rotation.z = this.rng() * Math.PI;
    w.model.flash.scale.setScalar((FLASH_SIZE[def.id] || 0.15) * (0.8 + this.rng() * 0.4));
    this.viewFlashLight.intensity = 3 * (this.flashScale ?? 1);
    this.audio.play(SHOT_SOUND[def.id] || 'rifleShot');
    // cápsula ejetada pela janela (no fuzil de ferrolho, só quando o ferrolho é manejado)
    if (def.bolt) this.boltT = 0;
    else this.ejectCasing(w, def);

    // recuo (padrão determinístico)
    const i = this.shotsInSequence;
    const [kp, ky] = recoilKick(def, i);
    const adsDamp = 1 - this.adsT * 0.15;
    this.player.addRecoil(kp * DEG2RAD * adsDamp, ky * DEG2RAD * adsDamp, def.recoil.maxPitch * DEG2RAD);
    this.player.addPunch((i % 2 ? 1 : -1) * def.recoil.punchRoll * DEG2RAD);
    this.shotsInSequence++;
    this.bloom = Math.min(def.spread.maxBloom, this.bloom + def.spread.perShot);

    // animação da arma
    const [kb, kp2] = KICK[def.id] || KICK.rifle;
    this.kickBack = Math.min(this.kickBack + kb, 0.11);
    this.kickPitch = Math.min(this.kickPitch + kp2, 0.26);
    this.kickRoll += (this.rng() - 0.5) * 0.04;

    this.events.emit('shotFired', { weapon: def.id, hit: !!shot.hit, result: hitResult });
    this.emitAmmo();
    if (w.mag === 0 && w.reserve > 0) this.autoReloadT = 0.3;
  }

  ejectCasing(w, def) {
    const port = EJECT_PORT[def.id] || EJECT_PORT.rifle;
    w.model.gun.updateMatrixWorld(true);
    this.casings.spawn(w.model.gun.localToWorld(_eject.set(port[0], port[1], port[2])), this.fxRng, def.id === 'pistol' ? 0.8 : def.id === 'sniper' ? 1.5 : 1);
  }

  /**
   * Ferrolho do fuzil de precisão: gira para cima, recua (ejeta a cápsula), avança e trava.
   * Apenas visual/sonoro — a cadência real é a mesma do servidor (fireRate).
   */
  updateBolt(dt, w) {
    const b = w.def.bolt;
    if (!b || this.boltT < 0) { if (w.model.bolt) { w.model.bolt.rotation.z = 0; w.model.bolt.position.z = 0.1; } return 0; }
    const prev = this.boltT;
    this.boltT += dt;
    const p = (this.boltT - b.delay) / b.duration;
    const pp = (prev - b.delay) / b.duration;
    if (pp < 0 && p >= 0) this.audio.play('boltOpen');
    if (pp < 0.45 && p >= 0.45) this.ejectCasing(w, w.def);
    if (pp < 0.7 && p >= 0.7) this.audio.play('boltClose');
    let lift = 0, pull = 0;
    if (p > 0 && p < 1) {
      lift = p < 0.2 ? p / 0.2 : p > 0.8 ? (1 - p) / 0.2 : 1;
      pull = p < 0.2 ? 0 : p < 0.45 ? (p - 0.2) / 0.25 : p < 0.7 ? 1 - (p - 0.45) / 0.25 : 0;
    }
    if (p >= 1) this.boltT = -1;
    if (w.model.bolt) { w.model.bolt.rotation.z = lift * 1.1; w.model.bolt.position.z = 0.1 + pull * 0.09; }
    return lift;
  }

  /**
   * Resolução local (treino offline): o mais próximo entre cenário e bots vence,
   * portanto não há dano através de paredes. Preenche `end` com o ponto final do traçante.
   */
  resolveOffline(origin, dir, def, end) {
    const worldHit = this.map.raycast(origin, dir, def.range, this._worldOut || (this._worldOut = {}));
    const maxEnemy = worldHit ? worldHit.distance : def.range;
    const enemyHit = this.enemies ? this.enemies.raycast(origin, dir, maxEnemy) : null;
    if (enemyHit) {
      end.copy(enemyHit.point);
      const result = this.enemies.applyDamage(enemyHit.enemy, enemyHit.zone, def.damage, def.multipliers, enemyHit.point, enemyHit.normal, origin);
      return { hit: true, result };
    }
    if (worldHit) {
      end.copy(worldHit.point);
      this.effects.impact(worldHit.point, worldHit.normal, worldHit.surface);
      this.audio.play('impact', { at: worldHit.point, surface: worldHit.surface });
    } else {
      end.copy(origin).addScaledVector(dir, def.range);
    }
    return { hit: false };
  }

  /** Converte a boca do cano (espaço do viewmodel) para o mundo, mantendo a posição na tela. */
  getMuzzleWorldPosition(out) {
    const model = this.current.model;
    model.root.updateMatrixWorld(true);
    _tmp.setFromMatrixPosition(model.muzzle.matrixWorld);
    const dist = _tmp.length();
    _tmp.project(this.viewCamera);
    out.set(_tmp.x, _tmp.y, 0.5).unproject(this.camera).sub(this.camera.position).normalize()
      .multiplyScalar(dist * 1.4).add(this.camera.position);
    return out;
  }

  startReload() {
    const w = this.current;
    this.autoReloadT = -1;
    if (this.reloading || this.switching) return false;          // evita recarga duplicada
    if (w.mag >= w.def.magSize || w.reserve <= 0) return false;
    this.reloading = true;
    this.reloadT = 0;
    this.reloadStage = 0;
    this.events.emit('reloadStart', { duration: w.def.reloadTime });
    this.emitAmmo();
    return true;
  }

  updateReload(dt) {
    const w = this.current;
    this.reloadT += dt / w.def.reloadTime;
    const stages = [[0.12, 'magOut'], [0.62, 'magIn'], [0.82, 'rack']];
    while (this.reloadStage < stages.length && this.reloadT >= stages[this.reloadStage][0]) {
      this.audio.play(stages[this.reloadStage][1]);
      this.reloadStage++;
    }
    if (this.reloadT >= 1) {
      const need = w.def.magSize - w.mag;
      const take = Math.min(need, w.reserve);
      w.mag += take;
      w.reserve -= take;
      this.reloading = false;
      this.reloadT = 0;
      this.shotsInSequence = 0;
      this.events.emit('reloadEnd', {});
      this.emitAmmo();
    }
  }

  cancelReload() {
    if (!this.reloading) return;
    this.reloading = false;
    this.reloadT = 0;
    this.events.emit('reloadEnd', { cancelled: true });
  }

  beginSwitch(target) {
    this.cancelReload();
    this.autoReloadT = -1;
    this.switching = true;
    this.switchT = 0;
    this.switchTarget = target;
    this.audio.play('switchWeapon');
  }

  updateSwitch(dt) {
    const prev = this.switchT;
    this.switchT += dt / 0.36;
    if (prev < 0.5 && this.switchT >= 0.5) {
      this.current.model.root.visible = false;
      this.index = this.switchTarget;
      this.current.model.root.visible = true;
      this.shotsInSequence = 0;
      this.bloom = 0;
      this.emitAmmo();
      this.events.emit('weaponSwitched', { name: this.current.def.name });
    }
    if (this.switchT >= 1) { this.switching = false; this.switchT = 0; }
  }

  getReloadProgress() { return this.reloading ? this.reloadT : 0; }

  // ---- animação em primeira pessoa ------------------------------------------
  animate(dt, lookDX, lookDY) {
    const w = this.current;
    const vm = w.def.viewmodel;
    const m = w.model;
    const p = this.player;
    this.equipT = Math.min(1, this.equipT + dt / 0.45);

    this.swayX = damp(this.swayX, clamp(-lookDX * 0.00045, -0.03, 0.03), 9, dt);
    this.swayY = damp(this.swayY, clamp(lookDY * 0.00045, -0.03, 0.03), 9, dt);
    this.kickBack = damp(this.kickBack, 0, 14, dt);
    this.kickPitch = damp(this.kickPitch, 0, 12, dt);
    this.kickRoll = damp(this.kickRoll, 0, 10, dt);

    const ads = smoothstep(0, 1, this.adsT);
    const hipAmt = 1 - ads * 0.85;
    const bobA = (p.bobAmount || 0) * hipAmt;
    const bx = Math.cos(p.bobPhase) * 0.011 * bobA;
    const by = -Math.abs(Math.sin(p.bobPhase)) * 0.012 * bobA;
    const breathe = Math.sin(this.time * 1.7) * 0.0018 * hipAmt;
    const airY = clamp(-p.velocity.y * 0.0035, -0.02, 0.025) * hipAmt;
    const crouchRoll = p.crouching ? 0.04 * hipAmt : 0;

    // envelope da recarga
    let r = 0;
    if (this.reloading) {
      const t = this.reloadT;
      r = t < 0.15 ? smoothstep(0, 0.15, t) : t > 0.85 ? 1 - smoothstep(0.85, 1, t) : 1;
      const magOut = t < 0.12 ? 0 : t < 0.35 ? smoothstep(0.12, 0.35, t) : t < 0.5 ? 1 : 1 - smoothstep(0.5, 0.66, t);
      m.mag.position.set(m.magRest.x, m.magRest.y - magOut * 0.28, m.magRest.z + magOut * 0.05);
      m.mag.rotation.x = magOut * 0.4;
    } else {
      m.mag.position.copy(m.magRest);
      m.mag.rotation.x = 0;
    }
    // envelope da troca/equipar
    let lower = 0;
    if (this.switching) lower = this.switchT < 0.5 ? smoothstep(0, 0.5, this.switchT) : 1 - smoothstep(0.5, 1, this.switchT);
    lower = Math.max(lower, 1 - smoothstep(0, 1, this.equipT));

    const x = lerp(vm.hip[0], vm.ads[0], ads) + this.swayX + bx;
    const y = lerp(vm.hip[1], vm.ads[1], ads) + this.swayY + by + breathe + airY - r * 0.05 - lower * 0.32;
    const z = lerp(vm.hip[2], vm.ads[2], ads) + this.kickBack;
    m.root.position.set(x, y, z);
    m.root.rotation.set(
      this.kickPitch * (1 - ads * 0.6) - r * 0.28 - lower * 0.7 + this.swayY * 2,
      this.swayX * 2.5 + r * 0.15 + 0.045 * (1 - ads),
      this.kickRoll + r * 0.6 + crouchRoll,
    );
    if (m.slide) m.slide.position.z = -0.04 + Math.min(this.kickBack * 0.9, 0.04);

    // clarão
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) m.flash.visible = false;
    }
    this.casings.update(dt);
    this.viewFlashLight.position.set(x, y + 0.05, z - 0.4);
    this.viewFlashLight.intensity = Math.max(0, this.viewFlashLight.intensity - dt * 70);

    // ferrolho (fuzil de precisão): a arma inclina levemente enquanto é manejado
    const boltLift = this.updateBolt(dt, w);
    if (boltLift) { m.root.rotation.z += boltLift * 0.18; m.root.position.y -= boltLift * 0.012; }

    // FOV de mira; luneta: a arma some e a sobreposição da luneta aparece
    this.fovScale = lerp(1, w.def.viewmodel.adsFovScale, ads);
    this.scoped = !!w.def.scope && this.adsT >= w.def.scope.hideViewmodelAt && !this.switching;
    if (this.scoped) { m.root.visible = false; this._scopeHid = m; }
    else if (this._scopeHid) { if (this._scopeHid === m) m.root.visible = true; this._scopeHid = null; }
  }

  dispose() {
    this.casings.dispose();
    disposeObject3D(this.viewScene);
    this.flashTexture.dispose();
  }
}
