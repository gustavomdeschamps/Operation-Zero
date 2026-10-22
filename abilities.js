// Habilidade NÉVOA CIANO (tecla E): lançamento, validação do ponto, nuvem
// volumétrica em camadas, duração de 5 s em tempo de jogo, recarga e limpeza.
//
// Regra do protótipo: a fumaça bloqueia a VISÃO dos bots (eles não iniciam nem
// mantêm ataques através dela), mas NÃO bloqueia os disparos do jogador.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, createCanvas, createRng, easeOutCubic, smoothstep, segmentIntersectsSphere } from './utils.js';
import { computeSmokePlacement } from './shared/smoke-rules.js';

const _tmp = new THREE.Vector3();
const _right = new THREE.Vector3();

function makePuffTexture() {
  const S = 128;
  const c = createCanvas(S);
  const ctx = c.getContext('2d');
  const rng = createRng(31);
  for (let i = 0; i < 14; i++) {
    const x = 64 + (rng() - 0.5) * 44, y = 64 + (rng() - 0.5) * 44, r = 22 + rng() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  // borda sempre transparente
  const img = ctx.getImageData(0, 0, S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - 63.5, y - 63.5) / 64;
    const i = (y * S + x) * 4 + 3;
    img.data[i] = img.data[i] * clamp(1.15 - d * 1.2, 0, 1);
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class SmokeCloud {
  constructor(texture, ringGeometry, count, rng) {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.puffs = [];
    const colors = [new THREE.Color(0x4fa9ff), new THREE.Color(0x6fd8ff), new THREE.Color(0x8fb8ff), new THREE.Color(0x3d7fd8)];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({ map: texture, color: colors[i % colors.length], transparent: true, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(mat);
      // distribuição num elipsoide achatado, mais densa no centro
      const a = rng() * Math.PI * 2;
      const r = Math.cbrt(rng()) * 0.78;
      const h = Math.pow(rng(), 0.8);
      s.userData = {
        ox: Math.cos(a) * r, oz: Math.sin(a) * r, oy: 0.22 + h * 0.7,
        size: 0.8 + rng() * 0.55, spin: (rng() - 0.5) * 0.25, phase: rng() * 10, alpha: 0.78 + rng() * 0.22,
      };
      this.group.add(s);
      this.puffs.push(s);
    }
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x3ef0ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(ringGeometry, ringMat);
    this.ring.position.y = 0.03;
    this.group.add(this.ring);
    this.center = new THREE.Vector3();
    this.active = false;
    this.age = 0;
    this.density = 0;
  }

  deploy(position) {
    this.group.position.copy(position);
    this.center.set(position.x, position.y + CONFIG.abilities.smoke.height * 0.45, position.z);
    this.active = true;
    this.age = 0;
    this.density = 0;
    this.group.visible = true;
  }

  update(dt, time) {
    const cfg = CONFIG.abilities.smoke;
    this.age += dt;
    const fadeIn = smoothstep(0, cfg.fadeIn, this.age);
    const fadeOut = 1 - smoothstep(cfg.duration - cfg.fadeOut, cfg.duration, this.age);
    this.density = Math.min(fadeIn, fadeOut);
    const grow = 0.35 + 0.65 * easeOutCubic(clamp(this.age / 0.9, 0, 1)) + 0.1 * smoothstep(cfg.duration - cfg.fadeOut, cfg.duration, this.age);
    const R = cfg.radius, H = cfg.height;
    for (const s of this.puffs) {
      const u = s.userData;
      const drift = Math.sin(time * 0.6 + u.phase) * 0.12;
      s.position.set(u.ox * R * grow + drift, u.oy * H * (0.6 + 0.4 * grow), u.oz * R * grow - drift);
      const size = u.size * R * 0.95 * grow;
      s.scale.set(size, size, 1);
      s.material.rotation += u.spin * dt;
      s.material.opacity = u.alpha * this.density;
    }
    const ringT = clamp(this.age / 0.7, 0, 1);
    const rs = R * (0.3 + 0.75 * easeOutCubic(ringT));
    this.ring.scale.set(rs, rs, rs);
    this.ring.material.opacity = 0.55 * (1 - ringT) + 0.12 * this.density;
    if (this.age >= cfg.duration) this.deactivate();
  }

  deactivate() {
    this.active = false;
    this.density = 0;
    this.group.visible = false;
  }

  dispose() {
    for (const s of this.puffs) s.material.dispose();
    this.ring.material.dispose();
  }
}

export class SmokeAbility {
  constructor(scene, map, audio, events) {
    this.scene = scene;
    this.map = map;
    this.audio = audio;
    this.events = events;
    this.cfg = CONFIG.abilities.smoke;
    this.group = new THREE.Group();
    this.group.name = 'abilities';
    scene.add(this.group);
    this.texture = makePuffTexture();
    this.ringGeometry = new THREE.RingGeometry(0.92, 1, 48);
    this.ringGeometry.rotateX(-Math.PI / 2);
    const rng = createRng(555);
    // 6 nuvens no pool: o modo online pode ter várias fumaças de jogadores diferentes
    this.clouds = [0, 1, 2, 3, 4, 5].map(() => {
      const c = new SmokeCloud(this.texture, this.ringGeometry, this.cfg.puffs, rng);
      this.group.add(c.group);
      return c;
    });
    // granada em voo
    this.canisterMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.7, roughness: 0.4, emissive: 0x1aa8c0, emissiveIntensity: 0.6 });
    this.canister = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 10), this.canisterMat);
    this.canister.visible = false;
    this.group.add(this.canister);
    this.throwFrom = new THREE.Vector3();
    this.throwTo = new THREE.Vector3();
    this.reset();
  }

  reset() {
    this.netMode = false;
    this.cooldown = 0;
    this.throwing = false;
    this.throwT = 0;
    this.time = 0;
    this.canister.visible = false;
    for (const c of this.clouds) c.deactivate();
    this.wasReady = true;
  }

  get ready() { return this.cooldown <= 0 && !this.throwing; }

  getStatus() {
    const active = this.clouds.find((c) => c.active);
    return {
      ready: this.ready,
      cooldown: Math.max(0, this.cooldown),
      cooldownFrac: clamp(this.cooldown / this.cfg.cooldown, 0, 1),
      activeRemaining: active ? Math.max(0, this.cfg.duration - active.age) : 0,
    };
  }

  /** Tenta lançar a fumaça a partir do olho do jogador na direção da mira. */
  tryActivate(eye, dir, camera) {
    if (!this.ready) {
      this.events.emit('abilityDenied', { reason: this.throwing ? 'EM USO' : `RECARGA ${Math.ceil(this.cooldown)}s` });
      this.audio.play('smokeDenied');
      return false;
    }
    const placement = this.computePlacement(eye, dir);
    if (!placement.ok) {
      this.events.emit('abilityDenied', { reason: placement.reason });
      this.audio.play('smokeDenied');
      return false;
    }
    _right.setFromMatrixColumn(camera.matrixWorld, 0);
    this.throwFrom.copy(eye).addScaledVector(_right, 0.25).add(_tmp.set(0, -0.25, 0));
    this.throwTo.copy(placement.point);
    this.throwT = 0;
    this.throwing = true;
    this.cooldown = this.cfg.cooldown;
    this.canister.visible = true;
    this.canister.position.copy(this.throwFrom);
    this.audio.play('smokeThrow');
    this.events.emit('abilityUsed', {});
    return true;
  }

  /** Ponto de assentamento — regra compartilhada com o servidor (shared/smoke-rules.js). */
  computePlacement(eye, dir) {
    const res = computeSmokePlacement(this.map.collision, eye, dir, this.cfg);
    if (res.ok) res.point = new THREE.Vector3(res.point.x, res.point.y, res.point.z);
    return res;
  }

  update(dt) {
    this.time += dt;
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        this.cooldown = 0;
        this.events.emit('abilityReady', {});
        this.audio.play('abilityReady');
      }
    }
    if (this.throwing) {
      this.throwT += dt / this.cfg.throwTime;
      const t = Math.min(this.throwT, 1);
      this.canister.position.lerpVectors(this.throwFrom, this.throwTo, t);
      const arc = Math.min(3, this.throwFrom.distanceTo(this.throwTo) * 0.18);
      this.canister.position.y += Math.sin(Math.PI * t) * arc;
      this.canister.rotation.x += dt * 14;
      this.canister.rotation.z += dt * 7;
      if (this.throwT >= 1) {
        this.throwing = false;
        this.canister.visible = false;
        if (this.netMode) return this.updateClouds(dt); // online: a nuvem vem do servidor
        const cloud = this.clouds.find((c) => !c.active) || this.clouds[0];
        cloud.deploy(this.throwTo);
        this.audio.play('smokeDeploy', { at: this.throwTo });
        this.events.emit('smokeDeployed', { position: this.throwTo.clone() });
      }
    }
    this.updateClouds(dt);
  }

  updateClouds(dt) {
    for (const c of this.clouds) if (c.active) c.update(dt, this.time);
  }

  // ---- modo online: o servidor aprova, cria e remove as nuvens ----------------
  /** Animação do lançamento (sem efeito de jogo local). */
  throwVisual(from, to) {
    this.throwFrom.set(from[0], from[1], from[2]);
    this.throwTo.set(to[0], to[1], to[2]);
    this.throwT = 0;
    this.throwing = true;
    this.canister.visible = true;
    this.canister.position.copy(this.throwFrom);
  }

  spawnNetSmoke(id, x, y, z, remaining) {
    if (this.clouds.some((c) => c.active && c.netId === id)) return;
    const cloud = this.clouds.find((c) => !c.active) || this.clouds.reduce((a, b) => (a.age > b.age ? a : b));
    cloud.deploy(new THREE.Vector3(x, y, z));
    cloud.netId = id;
    cloud.age = Math.max(0, this.cfg.duration - remaining);
    this.audio.play('smokeDeploy', { at: cloud.center });
  }

  removeNetSmoke(id) {
    for (const c of this.clouds) if (c.active && c.netId === id) c.deactivate();
  }

  /** O segmento a→b atravessa alguma fumaça densa? (usado pela visão dos bots) */
  blocksSegment(a, b) {
    if (!this.cfg.blocksBotVision) return false;
    for (const c of this.clouds) {
      if (c.active && c.density > 0.35 && segmentIntersectsSphere(a, b, c.center, this.cfg.radius * 0.85)) return true;
    }
    return false;
  }

  /** Quanto o ponto está imerso na fumaça (0..1) — usado no filtro de tela. */
  immersion(point) {
    let best = 0;
    for (const c of this.clouds) {
      if (!c.active) continue;
      const d = point.distanceTo(c.center) / (this.cfg.radius * 0.95);
      best = Math.max(best, clamp(1 - d, 0, 1) * c.density);
    }
    return smoothstep(0, 0.5, best);
  }

  dispose() {
    this.scene.remove(this.group);
    for (const c of this.clouds) c.dispose();
    this.texture.dispose();
    this.ringGeometry.dispose();
    this.canister.geometry.dispose();
    this.canisterMat.dispose();
  }
}
