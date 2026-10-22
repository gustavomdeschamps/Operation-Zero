// Sistema de armas: modelos em primeira pessoa, disparo hitscan, munição,
// recarga, cadência, dispersão por estado, recuo e animações.
import * as THREE from 'three';
import { CONFIG, DEG2RAD } from './config.js';
import { clamp, damp, lerp, createRng, createCanvas, smoothstep, disposeObject3D } from './utils.js';
import { computeSpread, recoilKick } from './shared/weapon-rules.js';

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _end = new THREE.Vector3();
const _muzzleWorld = new THREE.Vector3();

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

/** Materiais compartilhados entre os modelos em primeira pessoa. */
function createViewmodelMaterials() {
  return {
    gunmetal: new THREE.MeshStandardMaterial({ color: 0x4a515b, roughness: 0.36, metalness: 0.7 }),
    polymer: new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.62, metalness: 0.15 }),
    cerakote: new THREE.MeshStandardMaterial({ color: 0x8b8170, roughness: 0.6, metalness: 0.2 }),
    accent: new THREE.MeshStandardMaterial({ color: 0x0d3236, emissive: 0x3ef0ff, emissiveIntensity: 1.6, roughness: 0.3 }),
    glove: new THREE.MeshStandardMaterial({ color: 0x5a5148, roughness: 0.8, metalness: 0.05 }),
    sleeve: new THREE.MeshStandardMaterial({ color: 0x4d5a6b, roughness: 0.88, metalness: 0 }),
    knuckle: new THREE.MeshStandardMaterial({ color: 0x2f3338, roughness: 0.6, metalness: 0.3 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x0b2a2e, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.28, depthWrite: false }),
    reticle: new THREE.MeshBasicMaterial({ color: 0xff3a3a }),
  };
}

function part(parent, geo, mat, pos, rot = null) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(m);
  return m;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r1, r2, h, s = 12) => { const g = new THREE.CylinderGeometry(r1, r2, h, s); g.rotateX(Math.PI / 2); return g; };

function addArm(parent, M, handPos, sleeveDir, handRot) {
  const hand = new THREE.Group();
  hand.position.set(...handPos);
  hand.rotation.set(...handRot);
  part(hand, box(0.075, 0.085, 0.1), M.glove, [0, 0, 0]);
  part(hand, box(0.08, 0.03, 0.04), M.knuckle, [0, 0.03, -0.035]);
  // antebraço (manga) saindo da tela
  const dir = new THREE.Vector3(...sleeveDir).normalize();
  const sleeve = new THREE.Mesh(box(0.095, 0.1, 0.42), M.sleeve);
  sleeve.position.copy(dir).multiplyScalar(0.23);
  sleeve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  hand.add(sleeve);
  part(hand, box(0.1, 0.105, 0.05), M.polymer, [sleeveDir[0] * 0.06, sleeveDir[1] * 0.06, sleeveDir[2] * 0.06 + 0.02]);
  parent.add(hand);
  return hand;
}

function buildRifle(M) {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  part(gun, box(0.066, 0.1, 0.36), M.gunmetal, [0, 0, 0]);                 // receptor
  part(gun, box(0.07, 0.03, 0.34), M.polymer, [0, -0.06, 0.0]);            // receptor inferior
  part(gun, box(0.034, 0.022, 0.42), M.gunmetal, [0, 0.062, -0.08]);       // trilho
  for (let i = 0; i < 9; i++) part(gun, box(0.04, 0.008, 0.012), M.polymer, [0, 0.076, -0.26 + i * 0.045]);
  part(gun, box(0.074, 0.088, 0.3), M.cerakote, [0, 0.0, -0.33]);          // guarda-mão
  for (let i = 0; i < 4; i++) {
    part(gun, box(0.076, 0.014, 0.05), M.polymer, [0, -0.015, -0.24 - i * 0.065]);
  }
  part(gun, box(0.004, 0.012, 0.22), M.accent, [0.0385, 0.02, -0.32]);     // faixa ciano
  part(gun, box(0.004, 0.012, 0.22), M.accent, [-0.0385, 0.02, -0.32]);
  part(gun, cyl(0.013, 0.013, 0.22), M.gunmetal, [0, 0.012, -0.58]);       // cano
  part(gun, cyl(0.021, 0.021, 0.07), M.polymer, [0, 0.012, -0.69]);        // freio de boca
  part(gun, box(0.05, 0.12, 0.06), M.polymer, [0, -0.115, 0.085], [-0.32, 0, 0]); // empunhadura
  part(gun, box(0.05, 0.075, 0.2), M.polymer, [0, -0.01, 0.29]);           // coronha
  part(gun, box(0.054, 0.12, 0.03), M.gunmetal, [0, -0.03, 0.4]);
  part(gun, box(0.02, 0.03, 0.06), M.gunmetal, [0.04, 0.03, 0.08]);        // alavanca de manejo
  part(gun, box(0.044, 0.07, 0.035), M.polymer, [0, -0.07, -0.12]);        // guarda-mato
  // mira holográfica
  const sight = new THREE.Group();
  sight.position.set(0, 0.105, -0.04);
  part(sight, box(0.05, 0.012, 0.08), M.gunmetal, [0, -0.026, 0]);
  part(sight, box(0.006, 0.05, 0.075), M.gunmetal, [0.024, 0, 0]);
  part(sight, box(0.006, 0.05, 0.075), M.gunmetal, [-0.024, 0, 0]);
  part(sight, box(0.05, 0.006, 0.075), M.gunmetal, [0, 0.025, 0]);
  part(sight, new THREE.PlaneGeometry(0.042, 0.044), M.lens, [0, 0, -0.03]);
  part(sight, new THREE.CircleGeometry(0.0016, 10), M.reticle, [0, 0.0, -0.031]);
  part(sight, new THREE.RingGeometry(0.0085, 0.0098, 32), M.reticle, [0, 0.0, -0.031]);
  gun.add(sight);
  // carregador
  const mag = new THREE.Group();
  mag.position.set(0, -0.08, -0.07);
  part(mag, box(0.046, 0.19, 0.085), M.polymer, [0, -0.09, -0.01], [0.18, 0, 0]);
  part(mag, box(0.048, 0.02, 0.09), M.gunmetal, [0, -0.18, -0.03], [0.18, 0, 0]);
  gun.add(mag);
  // mãos
  addArm(gun, M, [0.012, -0.115, 0.1], [0.45, -0.55, 0.7], [-0.3, 0, 0.1]);
  addArm(gun, M, [-0.01, -0.06, -0.36], [-0.55, -0.6, 0.6], [0, 0, -0.35]);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.012, -0.74);
  gun.add(muzzle);
  return { root, gun, mag, muzzle, magRest: mag.position.clone() };
}

function buildPistol(M) {
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
  addArm(gun, M, [0.01, -0.09, 0.05], [0.4, -0.6, 0.7], [-0.2, 0, 0.1]);
  addArm(gun, M, [-0.035, -0.1, 0.03], [-0.5, -0.6, 0.65], [-0.2, 0, -0.5]);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.03, -0.17);
  gun.add(muzzle);
  return { root, gun, mag, muzzle, slide, magRest: mag.position.clone() };
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

    this.materials = createViewmodelMaterials();
    this.flashTexture = makeFlashTexture();
    this.flashMaterial = new THREE.MeshBasicMaterial({ map: this.flashTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

    this.weapons = CONFIG.weapons.map((def) => {
      const model = def.id === 'rifle' ? buildRifle(this.materials) : buildPistol(this.materials);
      const flash = new THREE.Group();
      const fGeo = new THREE.PlaneGeometry(1, 1);
      const p1 = new THREE.Mesh(fGeo, this.flashMaterial);
      const p2 = new THREE.Mesh(fGeo, this.flashMaterial); p2.rotation.y = Math.PI / 2;
      const p3 = new THREE.Mesh(fGeo, this.flashMaterial); p3.rotation.x = Math.PI / 2;
      flash.add(p1, p2, p3);
      flash.visible = false;
      model.muzzle.add(flash);
      model.flash = flash;
      model.root.visible = false;
      this.viewScene.add(model.root);
      return { def, model, mag: def.magSize, reserve: def.reserve };
    });
    this.rng = createRng(1);
    // estratégia de resolução dos disparos (substituída pelo modo online)
    this.shotResolver = (origin, dir, def, end) => this.resolveOffline(origin, dir, def, end);
    this.reset();
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
    this.kickBack = 0; this.kickPitch = 0; this.kickRoll = 0;
    this.swayX = 0; this.swayY = 0;
    this.triggerLatched = false;
    this.autoReloadT = -1;
    this.equipT = 0;
    this.rng.reseed(1);
    this.current.model.root.visible = true;
    this.currentSpread = this.current.def.spread.idle;
    this.emitAmmo();
  }

  get current() { return this.weapons[this.index]; }

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
      if (input.wasPressed(`Digit${other.def.slot}`) && other !== w && !this.switching) this.beginSwitch(this.weapons.indexOf(other));
    }
    if (this.switching) this.updateSwitch(dt);

    // mira (ADS)
    const wantsAds = canFire && input.isButtonDown(2) && !this.reloading && !this.switching;
    this.adsT = damp(this.adsT, wantsAds ? 1 : 0, 14, dt);
    if (this.adsT < 0.001) this.adsT = 0;

    // recarga
    if (canFire && input.wasPressed('KeyR')) this.startReload();
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
    const fs = def.id === 'rifle' ? 0.17 : 0.13;
    w.model.flash.scale.setScalar(fs * (0.8 + this.rng() * 0.4));
    this.viewFlashLight.intensity = 3;
    this.audio.play(def.id === 'rifle' ? 'rifleShot' : 'pistolShot');

    // recuo (padrão determinístico)
    const i = this.shotsInSequence;
    const [kp, ky] = recoilKick(def, i);
    const adsDamp = 1 - this.adsT * 0.15;
    this.player.addRecoil(kp * DEG2RAD * adsDamp, ky * DEG2RAD * adsDamp, def.recoil.maxPitch * DEG2RAD);
    this.player.addPunch((i % 2 ? 1 : -1) * def.recoil.punchRoll * DEG2RAD);
    this.shotsInSequence++;
    this.bloom = Math.min(def.spread.maxBloom, this.bloom + def.spread.perShot);

    // animação da arma
    this.kickBack = Math.min(this.kickBack + (def.id === 'rifle' ? 0.035 : 0.05), 0.09);
    this.kickPitch = Math.min(this.kickPitch + (def.id === 'rifle' ? 0.045 : 0.11), 0.22);
    this.kickRoll += (this.rng() - 0.5) * 0.04;

    this.events.emit('shotFired', { weapon: def.id, hit: !!shot.hit, result: hitResult });
    this.emitAmmo();
    if (w.mag === 0 && w.reserve > 0) this.autoReloadT = 0.3;
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
    this.viewFlashLight.position.set(x, y + 0.05, z - 0.4);
    this.viewFlashLight.intensity = Math.max(0, this.viewFlashLight.intensity - dt * 70);

    // FOV de mira
    this.fovScale = lerp(1, w.def.viewmodel.adsFovScale, ads);
  }

  dispose() {
    disposeObject3D(this.viewScene);
    this.flashTexture.dispose();
  }
}
