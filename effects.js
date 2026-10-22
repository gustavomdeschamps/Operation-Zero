// Efeitos visuais com pools reutilizáveis: partículas, marcas de impacto,
// traçantes, clarão de disparo e anéis de eliminação.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createCanvas, createRng, randRange } from './utils.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 0, 1);

class ParticlePool {
  constructor(max, blending) {
    this.max = max;
    this.cursor = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.gravity = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.active = 0;

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aColor', this.colAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending,
      vertexShader: /* glsl */`
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        uniform float uScale;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = aColor; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aAlpha > 0.0 ? max(aSize * uScale / -mv.z, 1.0) : 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.05, d) * vAlpha;
          gl_FragColor = vec4(vColor, a);
        }`,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(px, py, pz, vx, vy, vz, { color, life, size, sizeEnd, alpha = 1, gravity = 0, drag = 0 }) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = px; this.pos[i3 + 1] = py; this.pos[i3 + 2] = pz;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = color.r; this.col[i3 + 1] = color.g; this.col[i3 + 2] = color.b;
    this.life[i] = life; this.maxLife[i] = life;
    this.size0[i] = size; this.size1[i] = sizeEnd ?? size;
    this.alpha0[i] = alpha; this.alpha[i] = alpha; this.size[i] = size;
    this.gravity[i] = gravity; this.drag[i] = drag;
  }

  update(dt) {
    let any = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) { this.alpha[i] = 0; any++; } continue; }
      this.life[i] -= dt;
      const t = 1 - Math.max(this.life[i], 0) / this.maxLife[i];
      const i3 = i * 3;
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= dr; this.vel[i3 + 1] = this.vel[i3 + 1] * dr - this.gravity[i] * dt; this.vel[i3 + 2] *= dr;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.02 && this.vel[i3 + 1] < 0) { this.pos[i3 + 1] = 0.02; this.vel[i3 + 1] *= -0.3; this.vel[i3] *= 0.6; this.vel[i3 + 2] *= 0.6; }
      this.size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      this.alpha[i] = this.life[i] > 0 ? this.alpha0[i] * (1 - t * t) : 0;
      any++;
    }
    if (any) {
      this.posAttr.needsUpdate = true; this.colAttr.needsUpdate = true;
      this.sizeAttr.needsUpdate = true; this.alphaAttr.needsUpdate = true;
    }
  }

  clear() { this.life.fill(0); this.alpha.fill(0); this.alphaAttr.needsUpdate = true; }

  dispose() { this.points.geometry.dispose(); this.material.dispose(); }
}

function makeBulletHoleTexture() {
  const S = 64;
  const c = createCanvas(S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(5,5,5,1)');
  g.addColorStop(0.22, 'rgba(15,14,13,0.95)');
  g.addColorStop(0.36, 'rgba(60,55,50,0.6)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(20,18,16,0.55)';
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + Math.random() * 0.5;
    ctx.beginPath(); ctx.moveTo(32 + Math.cos(a) * 7, 32 + Math.sin(a) * 7);
    ctx.lineTo(32 + Math.cos(a) * (14 + Math.random() * 10), 32 + Math.sin(a) * (14 + Math.random() * 10));
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.rng = createRng(4242);
    this.group = new THREE.Group();
    this.group.name = 'effects';
    scene.add(this.group);

    const max = CONFIG.effects.maxParticles;
    this.glow = new ParticlePool(Math.floor(max * 0.55), THREE.AdditiveBlending);
    this.dust = new ParticlePool(Math.floor(max * 0.45), THREE.NormalBlending);
    this.group.add(this.glow.points, this.dust.points);

    // marcas de impacto
    this.decalTexture = makeBulletHoleTexture();
    this.decalMaterial = new THREE.MeshStandardMaterial({
      map: this.decalTexture, transparent: true, depthWrite: false, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.decalGeometry = new THREE.PlaneGeometry(0.17, 0.17);
    this.decals = [];
    this.decalCursor = 0;
    for (let i = 0; i < CONFIG.effects.maxDecals; i++) {
      const m = new THREE.Mesh(this.decalGeometry, this.decalMaterial);
      m.visible = false;
      m.matrixAutoUpdate = false;
      this.group.add(m);
      this.decals.push(m);
    }

    // traçantes
    this.tracerGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.tracerGeometry.translate(0, 0, -0.5);
    this.tracerMaterials = {
      player: new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
      enemy: new THREE.MeshBasicMaterial({ color: 0xff5a46, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    };
    this.tracers = [];
    this.tracerCursor = 0;
    for (let i = 0; i < CONFIG.effects.maxTracers; i++) {
      const m = new THREE.Mesh(this.tracerGeometry, this.tracerMaterials.player);
      m.visible = false;
      m.frustumCulled = false;
      this.group.add(m);
      this.tracers.push({ mesh: m, start: new THREE.Vector3(), end: new THREE.Vector3(), dir: new THREE.Vector3(), length: 0, travel: 0, active: false, width: 0.016 });
    }

    // clarão de disparo (luz sempre presente; só a intensidade varia — sem recompilar shaders)
    this.muzzleLight = new THREE.PointLight(0xffb45a, 0, 9, 2);
    this.group.add(this.muzzleLight);
    this.enemyFlashLight = new THREE.PointLight(0xff5a3a, 0, 7, 2);
    this.group.add(this.enemyFlashLight);

    // anéis de eliminação
    this.ringGeometry = new THREE.RingGeometry(0.85, 1, 48);
    this.ringGeometry.rotateX(-Math.PI / 2);
    this.rings = [];
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const m = new THREE.Mesh(this.ringGeometry, mat);
      m.visible = false;
      this.group.add(m);
      this.rings.push({ mesh: m, t: 1, active: false });
    }
    this.ringCursor = 0;

    this.colors = {
      spark: new THREE.Color(1.0, 0.72, 0.32),
      sparkHot: new THREE.Color(1.0, 0.92, 0.7),
      concrete: new THREE.Color(0.62, 0.59, 0.55),
      metal: new THREE.Color(0.45, 0.47, 0.5),
      wood: new THREE.Color(0.38, 0.36, 0.33),
      enemy: new THREE.Color(1.0, 0.25, 0.18),
      enemyDark: new THREE.Color(0.12, 0.1, 0.1),
      head: new THREE.Color(1.0, 0.95, 0.55),
      cyan: new THREE.Color(0.35, 0.95, 1.0),
      smoke: new THREE.Color(0.55, 0.55, 0.58),
    };
  }

  setViewport(heightPx, fovDeg) {
    const scale = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.glow.material.uniforms.uScale.value = scale;
    this.dust.material.uniforms.uScale.value = scale;
  }

  _coneDir(normal, spread, out) {
    const r = this.rng;
    out.set(normal.x + (r() - 0.5) * spread * 2, normal.y + (r() - 0.5) * spread * 2, normal.z + (r() - 0.5) * spread * 2).normalize();
    return out;
  }

  /** Impacto em superfície do mapa: faíscas, poeira e marca. */
  impact(point, normal, surface = 'concrete') {
    const r = this.rng;
    const sparks = surface === 'metal' ? 9 : surface === 'wood' ? 2 : 4;
    for (let i = 0; i < sparks; i++) {
      this._coneDir(normal, 0.9, _v);
      const sp = randRange(r, 3, 8);
      this.glow.emit(point.x, point.y, point.z, _v.x * sp, _v.y * sp, _v.z * sp,
        { color: i % 3 === 0 ? this.colors.sparkHot : this.colors.spark, life: randRange(r, 0.12, 0.32), size: 0.035, sizeEnd: 0.01, gravity: 12, drag: 2 });
    }
    const dustColor = this.colors[surface] || this.colors.concrete;
    const dustCount = surface === 'metal' ? 3 : 6;
    for (let i = 0; i < dustCount; i++) {
      this._coneDir(normal, 0.6, _v);
      const sp = randRange(r, 0.4, 1.8);
      this.dust.emit(point.x + normal.x * 0.03, point.y + normal.y * 0.03, point.z + normal.z * 0.03, _v.x * sp, _v.y * sp + 0.2, _v.z * sp,
        { color: dustColor, life: randRange(r, 0.45, 0.9), size: 0.08, sizeEnd: 0.42, alpha: 0.42, gravity: -0.15, drag: 3.5 });
    }
    // fragmentos
    for (let i = 0; i < 3; i++) {
      this._coneDir(normal, 0.8, _v);
      const sp = randRange(r, 2, 4);
      this.dust.emit(point.x, point.y, point.z, _v.x * sp, _v.y * sp, _v.z * sp,
        { color: this.colors.enemyDark, life: 0.5, size: 0.025, sizeEnd: 0.02, alpha: 0.9, gravity: 14, drag: 0.5 });
    }
    this.flashAt(point, 0.12);
    this.decal(point, normal);
  }

  decal(point, normal) {
    const m = this.decals[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % this.decals.length;
    _v.copy(point).addScaledVector(normal, 0.004);
    _q.setFromUnitVectors(_up, normal);
    const spin = new THREE.Quaternion().setFromAxisAngle(normal, this.rng() * Math.PI * 2);
    _q.premultiply(spin);
    const s = 0.8 + this.rng() * 0.45;
    m.matrix.compose(_v, _q, new THREE.Vector3(s, s, s));
    m.visible = true;
  }

  /** Impacto em inimigo: faíscas vermelhas e estilhaços. */
  enemyHit(point, normal, headshot) {
    const r = this.rng;
    const n = headshot ? 16 : 9;
    for (let i = 0; i < n; i++) {
      this._coneDir(normal, 1.1, _v);
      const sp = randRange(r, 2.5, headshot ? 9 : 6);
      this.glow.emit(point.x, point.y, point.z, _v.x * sp, _v.y * sp, _v.z * sp,
        { color: headshot && i % 2 ? this.colors.head : this.colors.enemy, life: randRange(r, 0.15, 0.4), size: headshot ? 0.05 : 0.04, sizeEnd: 0.01, gravity: 9, drag: 2 });
    }
    for (let i = 0; i < 4; i++) {
      this._coneDir(normal, 1.0, _v);
      const sp = randRange(r, 1.5, 3.5);
      this.dust.emit(point.x, point.y, point.z, _v.x * sp, _v.y * sp + 1, _v.z * sp,
        { color: this.colors.enemyDark, life: 0.7, size: 0.035, sizeEnd: 0.03, alpha: 1, gravity: 12, drag: 0.6 });
    }
  }

  /** Explosão de eliminação + anel no chão. */
  killBurst(position, color = 0xff3b3b) {
    const r = this.rng;
    for (let i = 0; i < 34; i++) {
      _v.set(r() - 0.5, r() * 0.9 + 0.1, r() - 0.5).normalize();
      const sp = randRange(r, 1.5, 6);
      this.glow.emit(position.x, position.y + 1.1 + (r() - 0.5) * 0.8, position.z, _v.x * sp, _v.y * sp, _v.z * sp,
        { color: i % 4 === 0 ? this.colors.sparkHot : this.colors.enemy, life: randRange(r, 0.3, 0.75), size: 0.06, sizeEnd: 0.01, gravity: 6, drag: 1.5 });
    }
    for (let i = 0; i < 10; i++) {
      _v.set(r() - 0.5, r() * 0.5, r() - 0.5).normalize();
      this.dust.emit(position.x, position.y + 0.6 + r(), position.z, _v.x * 0.8, _v.y * 0.8 + 0.3, _v.z * 0.8,
        { color: this.colors.smoke, life: randRange(r, 0.8, 1.4), size: 0.25, sizeEnd: 1.0, alpha: 0.32, gravity: -0.3, drag: 2 });
    }
    const ring = this.rings[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % this.rings.length;
    ring.mesh.position.set(position.x, position.y + 0.04, position.z);
    ring.mesh.material.color.setHex(color);
    ring.t = 0; ring.active = true; ring.mesh.visible = true;
  }

  spawnIn(position) {
    const r = this.rng;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      this.glow.emit(position.x + Math.cos(a) * 0.5, position.y + 0.05, position.z + Math.sin(a) * 0.5, Math.cos(a) * 0.3, randRange(r, 1.5, 3.5), Math.sin(a) * 0.3,
        { color: this.colors.enemy, life: 0.5, size: 0.05, sizeEnd: 0.01, drag: 1 });
    }
  }

  /** Traçante que percorre o trajeto do disparo. */
  tracer(start, end, kind = 'player') {
    const t = this.tracers[this.tracerCursor];
    this.tracerCursor = (this.tracerCursor + 1) % this.tracers.length;
    t.start.copy(start); t.end.copy(end);
    t.dir.subVectors(end, start);
    t.length = t.dir.length();
    if (t.length < 0.5) { t.active = false; t.mesh.visible = false; return; }
    t.dir.divideScalar(t.length);
    t.travel = 0;
    t.active = true;
    t.width = kind === 'enemy' ? 0.03 : 0.016;
    t.mesh.material = this.tracerMaterials[kind];
    t.mesh.visible = true;
  }

  muzzleFlash(position) {
    this.muzzleLight.position.copy(position);
    this.muzzleLight.intensity = 16;
  }

  enemyMuzzleFlash(position) {
    this.enemyFlashLight.position.copy(position);
    this.enemyFlashLight.intensity = 10;
    for (let i = 0; i < 5; i++) {
      this.glow.emit(position.x, position.y, position.z, (this.rng() - 0.5) * 2, (this.rng() - 0.5) * 2, (this.rng() - 0.5) * 2,
        { color: this.colors.sparkHot, life: 0.06, size: 0.12, sizeEnd: 0.02 });
    }
  }

  flashAt(point, size) {
    this.glow.emit(point.x, point.y, point.z, 0, 0, 0, { color: this.colors.sparkHot, life: 0.05, size, sizeEnd: size * 0.3 });
  }

  update(dt) {
    this.glow.update(dt);
    this.dust.update(dt);
    const speed = CONFIG.effects.tracerSpeed;
    const len = CONFIG.effects.tracerLength;
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.travel += speed * dt;
      const head = Math.min(t.travel, t.length);
      const tail = Math.max(0, t.travel - len);
      if (tail >= t.length) { t.active = false; t.mesh.visible = false; continue; }
      _v.copy(t.start).addScaledVector(t.dir, tail);
      t.mesh.position.copy(_v);
      _v.copy(t.start).addScaledVector(t.dir, head);
      t.mesh.lookAt(_v);
      t.mesh.scale.set(t.width, t.width, Math.max(0.01, head - tail));
    }
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 260);
    this.enemyFlashLight.intensity = Math.max(0, this.enemyFlashLight.intensity - dt * 160);
    for (const ring of this.rings) {
      if (!ring.active) continue;
      ring.t += dt / 0.6;
      const s = 0.3 + ring.t * 2.2;
      ring.mesh.scale.set(s, 1, s);
      ring.mesh.material.opacity = Math.max(0, 0.9 * (1 - ring.t));
      if (ring.t >= 1) { ring.active = false; ring.mesh.visible = false; }
    }
  }

  clear() {
    this.glow.clear();
    this.dust.clear();
    for (const d of this.decals) d.visible = false;
    for (const t of this.tracers) { t.active = false; t.mesh.visible = false; }
    for (const r of this.rings) { r.active = false; r.mesh.visible = false; }
    this.muzzleLight.intensity = 0;
    this.enemyFlashLight.intensity = 0;
  }

  dispose() {
    this.scene.remove(this.group);
    this.glow.dispose(); this.dust.dispose();
    this.decalTexture.dispose(); this.decalMaterial.dispose(); this.decalGeometry.dispose();
    this.tracerGeometry.dispose();
    Object.values(this.tracerMaterials).forEach((m) => m.dispose());
    this.ringGeometry.dispose();
    this.rings.forEach((r) => r.mesh.material.dispose());
  }
}
