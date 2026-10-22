// Apresentação da arena FOUNDRY-7: materiais procedurais, iluminação, céu e o builder visual
// do layout compartilhado (shared/arena-layout.js). Colisões e consultas físicas vêm de
// shared/arena-collision.js — a mesma representação usada pelo servidor.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import {
  createCanvas, paintNoise, createRng, createWorldBoxGeometry, mergeGeometries, disposeObject3D,
} from './utils.js';
import { buildArenaLayout, siteMarkers, BOT_SPAWNS, ZONES, BOUNDS, zoneAt } from './shared/arena-layout.js';
import { getArenaCollision } from './shared/arena-collision.js';

// ---------------------------------------------------------------------------
// Texturas procedurais
// ---------------------------------------------------------------------------

function finishTexture(canvas, { color = true, anisotropy = 4 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function blotches(ctx, rng, size, count, rgba, rMin, rMax) {
  for (let i = 0; i < count; i++) {
    const x = rng() * size, y = rng() * size, r = rMin + rng() * (rMax - rMin);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      ctx.save(); ctx.translate(ox, oy); ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore();
    }
  }
}

function makeConcreteCanvas(rng, { base = 150, tint = [1.0, 0.98, 0.93], panels = true } = {}) {
  const S = 512;
  const c = createCanvas(S);
  const ctx = c.getContext('2d');
  paintNoise(ctx, S, S, rng, { base, amp: 26, scale: 4, octaves: 5, tint });
  blotches(ctx, rng, S, 18, 'rgba(40,36,30,0.10)', 20, 90);
  blotches(ctx, rng, S, 10, 'rgba(255,250,240,0.06)', 30, 110);
  // escorridos verticais
  for (let i = 0; i < 26; i++) {
    const x = rng() * S, len = 40 + rng() * 220, w = 1 + rng() * 3;
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, 'rgba(30,26,22,0.18)'); g.addColorStop(1, 'rgba(30,26,22,0)');
    ctx.fillStyle = g; ctx.fillRect(x, 0, w, len);
  }
  if (panels) {
    // juntas de forma (painéis de 1,5 m) e furos de tirante
    ctx.fillStyle = 'rgba(25,22,20,0.55)';
    ctx.fillRect(0, 0, S, 2); ctx.fillRect(0, S / 2, S, 2);
    ctx.fillRect(0, 0, 2, S); ctx.fillRect(S / 2, 0, 2, S);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(0, 3, S, 1); ctx.fillRect(0, S / 2 + 3, S, 1);
    for (let px = 0; px < 2; px++) for (let py = 0; py < 2; py++) {
      for (const [fx, fy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const x = (px + fx) * (S / 2), y = (py + fy) * (S / 2);
        ctx.fillStyle = 'rgba(20,18,16,0.7)';
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath(); ctx.arc(x + 1, y + 1.5, 4, 0, Math.PI); ctx.fill();
      }
    }
  }
  return c;
}

function makeFloorCanvas(rng) {
  const S = 512;
  const c = createCanvas(S);
  const ctx = c.getContext('2d');
  paintNoise(ctx, S, S, rng, { base: 118, amp: 22, scale: 6, octaves: 5, tint: [1, 0.985, 0.95] });
  blotches(ctx, rng, S, 14, 'rgba(20,18,16,0.16)', 25, 80);   // manchas de óleo
  blotches(ctx, rng, S, 12, 'rgba(255,248,236,0.05)', 40, 120);
  // juntas de placas (2 m)
  ctx.fillStyle = 'rgba(18,16,14,0.65)';
  ctx.fillRect(0, 0, S, 3); ctx.fillRect(0, 0, 3, S);
  ctx.fillRect(0, S / 2, S, 2); ctx.fillRect(S / 2, 0, 2, S);
  // fissuras
  ctx.strokeStyle = 'rgba(20,18,16,0.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    let x = rng() * S, y = rng() * S;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 7; k++) { x += (rng() - 0.5) * 40; y += (rng() - 0.5) * 40; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  return c;
}

function makeMetalPanelCanvas(rng) {
  const S = 512;
  const c = createCanvas(S);
  const ctx = c.getContext('2d');
  paintNoise(ctx, S, S, rng, { base: 120, amp: 14, scale: 8, octaves: 4 });
  // painéis
  const rows = [0, 160, 352, 512];
  const cols = [0, 256, 512];
  for (let r = 0; r < rows.length - 1; r++) {
    for (let k = 0; k < cols.length - 1; k++) {
      const x0 = cols[k], x1 = cols[k + 1], y0 = rows[r], y1 = rows[r + 1];
      ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fillRect(x0 + 3, y0 + 3, x1 - x0 - 6, 2);
      ctx.fillRect(x0 + 3, y0 + 3, 2, y1 - y0 - 6);
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x0 + 3, y1 - 5, x1 - x0 - 6, 2);
      ctx.fillRect(x1 - 5, y0 + 3, 2, y1 - y0 - 6);
      ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillRect(x0, y0, x1 - x0, 2); ctx.fillRect(x0, y0, 2, y1 - y0);
      // rebites
      for (const [rx, ry] of [[x0 + 12, y0 + 12], [x1 - 12, y0 + 12], [x0 + 12, y1 - 12], [x1 - 12, y1 - 12]]) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.arc(rx + 1, ry + 1, 3.2, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(rx, ry, 2.6, 0, 7); ctx.fill();
      }
    }
  }
  // arranhões
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  for (let i = 0; i < 70; i++) {
    const x = rng() * S, y = rng() * S, a = rng() * Math.PI, l = 6 + rng() * 30;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  blotches(ctx, rng, S, 10, 'rgba(0,0,0,0.12)', 20, 70);
  return c;
}

function makeCorrugatedCanvas(rng) {
  const S = 512;
  const c = createCanvas(S);
  const ctx = c.getContext('2d');
  paintNoise(ctx, S, S, rng, { base: 205, amp: 16, scale: 6, octaves: 4 });
  const ribs = 16;
  for (let i = 0; i < ribs; i++) {
    const x = (i / ribs) * S, w = S / ribs;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.30)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.10)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.0)');
    g.addColorStop(0.8, 'rgba(0,0,0,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = g; ctx.fillRect(x, 0, w, S);
  }
  // ferrugem e sujeira
  blotches(ctx, rng, S, 22, 'rgba(90,50,25,0.22)', 6, 40);
  for (let i = 0; i < 30; i++) {
    const x = rng() * S, len = 30 + rng() * 140;
    const g = ctx.createLinearGradient(0, S - len, 0, S);
    g.addColorStop(0, 'rgba(70,45,30,0)'); g.addColorStop(1, 'rgba(70,45,30,0.25)');
    ctx.fillStyle = g; ctx.fillRect(x, S - len, 2 + rng() * 4, len);
  }
  return c;
}

function makeCrateCanvas(rng) {
  const S = 256;
  const c = createCanvas(S);
  const ctx = c.getContext('2d');
  paintNoise(ctx, S, S, rng, { base: 92, amp: 16, scale: 4, octaves: 4, tint: [0.78, 0.86, 0.92] });
  const frame = 22;
  ctx.fillStyle = 'rgba(30,34,40,0.9)';
  ctx.fillRect(0, 0, S, frame); ctx.fillRect(0, S - frame, S, frame);
  ctx.fillRect(0, 0, frame, S); ctx.fillRect(S - frame, 0, frame, S);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(frame, frame, S - frame * 2, 2); ctx.fillRect(frame, frame, 2, S - frame * 2);
  // reforço diagonal
  ctx.save();
  ctx.translate(S / 2, S / 2); ctx.rotate(Math.PI / 4);
  ctx.fillStyle = 'rgba(30,34,40,0.75)'; ctx.fillRect(-S * 0.7, -9, S * 1.4, 18);
  ctx.restore();
  // cantoneiras
  ctx.fillStyle = '#c9a23a';
  for (const [x, y] of [[0, 0], [S - 30, 0], [0, S - 30], [S - 30, S - 30]]) ctx.fillRect(x, y, 30, 30);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (const [x, y] of [[0, 0], [S - 30, 0], [0, S - 30], [S - 30, S - 30]]) ctx.fillRect(x + 4, y + 4, 22, 22);
  // estêncil
  ctx.fillStyle = 'rgba(230,230,220,0.55)';
  ctx.font = 'bold 22px Arial';
  ctx.fillText('FDY-7', frame + 14, S - frame - 14);
  blotches(ctx, rng, S, 8, 'rgba(0,0,0,0.18)', 10, 40);
  return c;
}

function makeHazardCanvas() {
  const S = 256;
  const c = createCanvas(S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e7b416'; ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#17181b';
  for (let i = -S; i < S * 2; i += 64) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 32, 0); ctx.lineTo(i + 32 - S, S); ctx.lineTo(i - S, S); ctx.fill();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let i = 0; i < 300; i++) ctx.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  return c;
}

function makeSignCanvas(lines, { width = 512, height = 256, bg = '#15191f', fg = '#e9eef2', accent = '#3ef0ff', border = true, align = 'left' } = {}) {
  const c = createCanvas(width, height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
  if (border) {
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 4; ctx.strokeRect(6, 6, width - 12, height - 12);
    ctx.fillStyle = accent; ctx.fillRect(6, 6, 14, height - 12);
  }
  let y = 0;
  const total = lines.reduce((s, l) => s + l.size * 1.15, 0);
  y = (height - total) / 2;
  for (const l of lines) {
    ctx.font = `${l.weight || 700} ${l.size}px Bahnschrift, "DIN Alternate", "Arial Narrow", Arial, sans-serif`;
    ctx.fillStyle = l.color || fg;
    ctx.textBaseline = 'top';
    const x = align === 'center' ? (width - ctx.measureText(l.text).width) / 2 : (border ? 42 : 20);
    ctx.fillText(l.text, x, y);
    y += l.size * 1.15;
  }
  return c;
}

function makeBigLetterCanvas(letter, color = '#e9eef2') {
  const c = createCanvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.font = '700 220px Bahnschrift, "Arial Narrow", Arial, sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 140);
  return c;
}

function makeAmmoIconCanvas() {
  const c = createCanvas(128, 128);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#7ff6ff'; ctx.lineWidth = 5;
  ctx.strokeRect(10, 10, 108, 108);
  ctx.fillStyle = '#7ff6ff';
  for (let i = 0; i < 3; i++) {
    const x = 30 + i * 26;
    ctx.fillRect(x, 50, 16, 52);
    ctx.beginPath(); ctx.moveTo(x, 50); ctx.lineTo(x + 8, 30); ctx.lineTo(x + 16, 50); ctx.fill();
  }
  return c;
}

// ---------------------------------------------------------------------------
// Mapa
// ---------------------------------------------------------------------------

export class GameMap {
  constructor(scene, { anisotropy = 4 } = {}) {
    this.scene = scene;
    this.anisotropy = anisotropy;
    this.root = new THREE.Group();
    this.root.name = 'map';
    this.collision = getArenaCollision();
    this.colliders = this.collision.colliders;
    this.buckets = new Map();
    this.materials = {};
    this.textures = [];
    this.lights = [];
    this.animated = [];
    this.ammoStations = [];
    this.enemySpawns = [];
    this.zones = ZONES;
    this.bounds = BOUNDS;
    this.sunDirection = new THREE.Vector3(-0.52, 0.42, 0.74).normalize();
    this.rng = createRng(1337);
  }

  // ---- materiais ---------------------------------------------------------
  createMaterials() {
    const rng = this.rng;
    const tex = (canvas, color = true) => {
      const t = finishTexture(canvas, { color, anisotropy: this.anisotropy });
      this.textures.push(t);
      return t;
    };
    const concreteC = makeConcreteCanvas(rng);
    const concreteTex = tex(concreteC);
    const concreteBump = tex(concreteC, false);
    const plainConcreteC = makeConcreteCanvas(rng, { base: 160, panels: false });
    const plainConcrete = tex(plainConcreteC);
    const floorC = makeFloorCanvas(rng);
    const floorTex = tex(floorC);
    const floorBump = tex(floorC, false);
    const metalC = makeMetalPanelCanvas(rng);
    const metalTex = tex(metalC);
    const metalBump = tex(metalC, false);
    const corrC = makeCorrugatedCanvas(rng);
    const corrTex = tex(corrC);
    const corrBump = tex(corrC, false);
    const crateC = makeCrateCanvas(rng);
    const crateTex = tex(crateC);
    const hazardTex = tex(makeHazardCanvas());

    const std = (opts) => new THREE.MeshStandardMaterial(opts);
    this.materials = {
      concrete: std({ map: concreteTex, bumpMap: concreteBump, bumpScale: 0.6, color: 0xd9d2c6, roughness: 0.93, metalness: 0 }),
      concreteDark: std({ map: concreteTex, bumpMap: concreteBump, bumpScale: 0.6, color: 0x8d8a86, roughness: 0.95, metalness: 0 }),
      concreteLight: std({ map: plainConcrete, color: 0xe8e2d6, roughness: 0.9, metalness: 0 }),
      floor: std({ map: floorTex, bumpMap: floorBump, bumpScale: 0.5, color: 0xc4beb6, roughness: 0.86, metalness: 0 }),
      metal: std({ map: metalTex, bumpMap: metalBump, bumpScale: 0.8, color: 0x7d8792, roughness: 0.5, metalness: 0.65 }),
      metalTrim: std({ map: metalTex, color: 0x3c4249, roughness: 0.42, metalness: 0.85 }),
      steelBlue: std({ map: metalTex, color: 0x45607a, roughness: 0.5, metalness: 0.6 }),
      containerTeal: std({ map: corrTex, bumpMap: corrBump, bumpScale: 1.2, color: 0x2f7f86, roughness: 0.62, metalness: 0.35 }),
      containerOrange: std({ map: corrTex, bumpMap: corrBump, bumpScale: 1.2, color: 0xc0632b, roughness: 0.62, metalness: 0.35 }),
      containerBlue: std({ map: corrTex, bumpMap: corrBump, bumpScale: 1.2, color: 0x2e4d7c, roughness: 0.62, metalness: 0.35 }),
      containerRust: std({ map: corrTex, bumpMap: corrBump, bumpScale: 1.2, color: 0x8c3a2a, roughness: 0.7, metalness: 0.3 }),
      containerGray: std({ map: corrTex, bumpMap: corrBump, bumpScale: 1.2, color: 0x7b828a, roughness: 0.62, metalness: 0.35 }),
      crate: std({ map: crateTex, roughness: 0.8, metalness: 0.1 }),
      hazard: std({ map: hazardTex, roughness: 0.7, metalness: 0.1 }),
      rubber: std({ color: 0x1b1d20, roughness: 0.95, metalness: 0 }),
      paintYellow: std({ color: 0xd8a51c, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      paintWhite: std({ color: 0xd9dbd8, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      paintCyan: std({ color: 0x1a8f99, emissive: 0x1fb8c6, emissiveIntensity: 0.45, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      lightCyan: new THREE.MeshBasicMaterial({ color: 0x8ff8ff }),
      lightWarm: new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
      lightRed: new THREE.MeshBasicMaterial({ color: 0xff4a3a }),
      glassDark: std({ color: 0x0d1418, roughness: 0.15, metalness: 0.9 }),
      skyline: std({ color: 0x55607a, roughness: 1, metalness: 0 }),
      skylineDark: std({ color: 0x3e4559, roughness: 1, metalness: 0 }),
    };
  }

  // ---- construtores -----------------------------------------------------
  _push(matKey, geometry, castShadow = true) {
    const key = `${matKey}|${castShadow ? 1 : 0}`;
    if (!this.buckets.has(key)) this.buckets.set(key, { matKey, castShadow, geos: [] });
    this.buckets.get(key).geos.push(geometry);
  }

  /** Caixa sólida (min/max) — visual + colisão + tiro. */
  box(x0, x1, y0, y1, z0, z1, matKey, { texel = null, worldUV = true, castShadow = true } = {}) {
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    const t = texel ?? (matKey === 'floor' ? 4 : matKey.startsWith('concrete') ? 3 : matKey.startsWith('container') ? 2.6 : 2);
    const geo = worldUV ? createWorldBoxGeometry(w, h, d, t) : new THREE.BoxGeometry(w, h, d);
    geo.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this._push(matKey, geo, castShadow);
  }

  /** Colisor sem malha própria: só existe na representação de colisão compartilhada. */
  solid() {}

  crate(x0, x1, y0, y1, z0, z1) { this.box(x0, x1, y0, y1, z0, z1, 'crate', { worldUV: false }); }

  /** Geometria decorativa (sem colisão) transformada e agrupada por material. */
  deco(geometry, matKey, position, rotation = null, castShadow = true) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    if (rotation) q.setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2]));
    m.compose(new THREE.Vector3(...position), q, new THREE.Vector3(1, 1, 1));
    geometry.applyMatrix4(m);
    this._push(matKey, geometry, castShadow);
  }

  /** Faixa pintada no piso. */
  paint(x0, x1, z0, z1, matKey = 'paintYellow', y = 0.012) {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
    this._push(matKey, g, false);
  }

  barrel(x, z, y = 0, matKey = 'steelBlue') {
    const g = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 16);
    this.deco(g, matKey, [x, y + 0.45, z]);
    for (const hy of [0.18, 0.72]) this.deco(new THREE.TorusGeometry(0.305, 0.02, 4, 18), 'metalTrim', [x, y + hy, z], [Math.PI / 2, 0, 0]);
    this.deco(new THREE.CylinderGeometry(0.26, 0.26, 0.01, 16), 'metalTrim', [x, y + 0.905, z]);
  }

  pipe(a, b, radius, matKey = 'metalTrim') {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const g = new THREE.CylinderGeometry(radius, radius, len, 10, 1);
    const mid = va.clone().add(vb).multiplyScalar(0.5);
    const dir = vb.clone().sub(va).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const m = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    this._push(matKey, g, true);
  }

  cylinder(r1, r2, h, segments, matKey, position, rotation = null) {
    this.deco(new THREE.CylinderGeometry(r1, r2, h, segments, 1), matKey, position, rotation);
  }

  torus(radius, tube, radialSegments, tubularSegments, matKey, position, rotation = null) {
    this.deco(new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments), matKey, position, rotation);
  }

  floorRing(inner, outer, segments, matKey, x, z) {
    const ring = new THREE.RingGeometry(inner, outer, segments);
    ring.rotateX(-Math.PI / 2);
    ring.translate(x, 0.013, z);
    this._push(matKey, ring, false);
  }

  lightBar(x0, x1, y0, y1, z0, z1, matKey = 'lightCyan') {
    this.box(x0, x1, y0, y1, z0, z1, matKey, { collide: false, worldUV: false, castShadow: false });
  }

  sign(lines, { position, rotationY = 0, width = 2, height = 1, style = {} }) {
    const canvas = makeSignCanvas(lines, style);
    const t = finishTexture(canvas, { anisotropy: this.anisotropy });
    this.textures.push(t);
    const mat = new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.35, roughness: 0.6, metalness: 0.2 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    mesh.position.set(...position);
    mesh.rotation.y = rotationY;
    this.root.add(mesh);
    return mesh;
  }

  floorLetter(letter, x, z, size = 3, color = '#e9eef2', rotationY = 0) {
    const t = finishTexture(makeBigLetterCanvas(letter, color), { anisotropy: this.anisotropy });
    this.textures.push(t);
    const mat = new THREE.MeshStandardMaterial({ map: t, transparent: true, opacity: 0.75, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    mesh.rotation.set(-Math.PI / 2, 0, rotationY);
    mesh.position.set(x, 0.014, z);
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  wallLetter(letter, position, rotationY, size = 3, color = '#e9eef2') {
    const t = finishTexture(makeBigLetterCanvas(letter, color), { anisotropy: this.anisotropy });
    this.textures.push(t);
    const mat = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    mesh.position.set(...position);
    mesh.rotation.y = rotationY;
    this.root.add(mesh);
  }

  // ---- layout -----------------------------------------------------------
  build() {
    this.createMaterials();
    this.buildSky();
    this.buildLights();
    buildArenaLayout(this);          // layout compartilhado com o servidor
    this.buildSiteMarkers();
    this.buildSkyline();
    this.defineEnemySpawns();
    this.flush();
    this.scene.add(this.root);
  }

  buildSkyline() {
    const rng = createRng(77);
    const geos = [];
    const geosDark = [];
    for (let i = 0; i < 46; i++) {
      const a = rng() * Math.PI * 2;
      const r = 75 + rng() * 110;
      const x = Math.cos(a) * r, z = Math.sin(a) * r * 1.2;
      const w = 6 + rng() * 16, d = 6 + rng() * 16, h = 10 + rng() * 48;
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, h / 2 - 2, z);
      (rng() > 0.5 ? geos : geosDark).push(g);
    }
    for (const [x, z, h] of [[-70, -95, 70], [-58, -98, 62], [90, -60, 55], [-110, 30, 48]]) {
      const g = new THREE.CylinderGeometry(2.2, 3.2, h, 12);
      g.translate(x, h / 2, z);
      geosDark.push(g);
    }
    const m1 = new THREE.Mesh(mergeGeometries(geos), this.materials.skyline);
    const m2 = new THREE.Mesh(mergeGeometries(geosDark), this.materials.skylineDark);
    geos.forEach((g) => g.dispose()); geosDark.forEach((g) => g.dispose());
    this.root.add(m1, m2);
    // luzes de obstáculo nas chaminés
    for (const [x, z, h] of [[-70, -95, 70], [-58, -98, 62], [90, -60, 55]]) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), this.materials.lightRed);
      b.position.set(x, h + 0.6, z);
      this.root.add(b);
      this.animated.push({ type: 'blink', mesh: b, phase: x * 0.1 });
    }
  }

  /** Marcadores dos objetivos A/B do modo tático (ocultos fora dele). */
  buildSiteMarkers() {
    this.siteGroup = new THREE.Group();
    this.siteGroup.visible = false;
    this.root.add(this.siteGroup);
    this.siteBeacons = [];
    siteMarkers(this);
  }

  siteMarker(site) {
    const w = site.maxX - site.minX, d = site.maxZ - site.minZ;
    const edge = new THREE.MeshBasicMaterial({ color: 0xff6a3d, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    const t = 0.12;
    for (const [cx, cz, sx, sz] of [
      [site.cx, site.minZ + t / 2, w, t], [site.cx, site.maxZ - t / 2, w, t],
      [site.minX + t / 2, (site.minZ + site.maxZ) / 2, t, d], [site.maxX - t / 2, (site.minZ + site.maxZ) / 2, t, d],
    ]) {
      const g = new THREE.PlaneGeometry(sx, sz); g.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(g, edge);
      mesh.position.set(cx === site.cx ? (site.minX + site.maxX) / 2 : cx, 0.02, cz);
      this.siteGroup.add(mesh);
    }
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff6a3d, transparent: true, opacity: 0.07, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    fill.position.set((site.minX + site.maxX) / 2, 0.018, (site.minZ + site.maxZ) / 2);
    this.siteGroup.add(fill);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff6a3d, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 9, 16, 1, true), beaconMat);
    beacon.position.set(site.cx, 4.5, site.cz);
    this.siteGroup.add(beacon);
    this.siteBeacons.push(beacon);
    const t2 = finishTexture(makeBigLetterCanvas(site.id, '#ff8a5a'), { anisotropy: this.anisotropy });
    this.textures.push(t2);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: t2, transparent: true, depthWrite: false }));
    label.position.set(site.cx, 3.6, site.cz);
    label.scale.set(1.6, 1.6, 1);
    this.siteGroup.add(label);
  }

  setSitesVisible(visible) { this.siteGroup.visible = visible; }

  ammoStationVisual(x, z, rotationY) {
    const stripMat = new THREE.MeshBasicMaterial({ color: 0x7ff6ff });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.05, 1.04), stripMat);
    strip.position.set(x, 0.75, z);
    this.root.add(strip);
    const iconTex = finishTexture(makeAmmoIconCanvas(), { anisotropy: this.anisotropy });
    this.textures.push(iconTex);
    const iconMat = new THREE.MeshBasicMaterial({ map: iconTex, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const icon = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), iconMat);
    icon.position.set(x, 1.55, z);
    icon.rotation.y = rotationY;
    this.root.add(icon);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.45, 1.6, 40), new THREE.MeshBasicMaterial({ color: 0x2fc9d6, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.015, z);
    this.root.add(ring);
    const station = { position: new THREE.Vector3(x, 0, z), cooldown: 0, strip, icon, ring, stripMat, iconMat };
    this.ammoStations.push(station);
    return station;
  }

  buildSky() {
    const uniforms = {
      zenith: { value: new THREE.Color(0x2c3a73) },
      mid: { value: new THREE.Color(0x8f86b8) },
      horizon: { value: new THREE.Color(0xf2b7a2) },
      ground: { value: new THREE.Color(0x5a5560) },
      sunDir: { value: this.sunDirection.clone() },
      sunColor: { value: new THREE.Color(0xffd2a0) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vDir = normalize(wp.xyz - cameraPosition);
          gl_Position = projectionMatrix * viewMatrix * wp;
          gl_Position.z = gl_Position.w;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 zenith; uniform vec3 mid; uniform vec3 horizon; uniform vec3 ground;
        uniform vec3 sunDir; uniform vec3 sunColor;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, h));
          col = mix(col, zenith, smoothstep(0.22, 0.85, h));
          col = mix(col, ground, smoothstep(0.0, -0.2, h));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          col += sunColor * (pow(s, 900.0) * 6.0 + pow(s, 24.0) * 0.45 + pow(s, 4.0) * 0.12);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(380, 32, 16), mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.root.add(this.sky);
  }

  buildLights() {
    const hemi = new THREE.HemisphereLight(0xb9c6ff, 0x4a3f36, 0.55);
    const sun = new THREE.DirectionalLight(0xffcf9f, 2.7);
    sun.position.copy(this.sunDirection).multiplyScalar(90);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    const sc = sun.shadow.camera;
    sc.left = -58; sc.right = 58; sc.top = 58; sc.bottom = -58; sc.near = 10; sc.far = 220;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.mapSize.set(2048, 2048);
    const fill = new THREE.DirectionalLight(0x7d8fff, 0.35);
    fill.position.set(30, 25, -40);
    this.sun = sun;
    this.root.add(hemi, sun, sun.target, fill);
    this.lights.push(hemi, sun, fill);
    const point = (color, intensity, distance, x, y, z) => {
      const l = new THREE.PointLight(color, intensity, distance, 2);
      l.position.set(x, y, z);
      this.root.add(l);
      this.lights.push(l);
      return l;
    };
    point(0x9ff4ff, 30, 22, 0, 4.6, 38);         // área de preparação
    point(0xffb565, 40, 24, -17, 4.8, 15);       // armazém
    point(0x6ff2ff, 22, 16, 0, 3.4, -16.5);      // núcleo
    point(0xffc27a, 26, 18, 0, 4.0, 19);         // corredor central
  }

  /** Mapa de ambiente (reflexos/iluminação indireta) gerado a partir do céu procedural. */
  createEnvironment(renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const geo = new THREE.SphereGeometry(50, 32, 16);
    envScene.add(new THREE.Mesh(geo, this.sky.material));
    this.envTarget = pmrem.fromScene(envScene, 0.04, 0.1, 200);
    pmrem.dispose();
    geo.dispose();
    return this.envTarget.texture;
  }

  setShadowQuality(enabled, mapSize) {
    this.sun.castShadow = enabled;
    if (this.sun.shadow.mapSize.x !== mapSize) {
      this.sun.shadow.mapSize.set(mapSize, mapSize);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
  }

  /** Funde as geometrias de cada material num único mesh (poucas draw calls). */
  flush() {
    for (const { matKey, castShadow, geos } of this.buckets.values()) {
      if (!geos.length) continue;
      const merged = mergeGeometries(geos);
      geos.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(merged, this.materials[matKey]);
      const unlit = this.materials[matKey].isMeshBasicMaterial;
      mesh.castShadow = castShadow && !unlit;
      mesh.receiveShadow = !unlit;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.name = `static-${matKey}`;
      this.root.add(mesh);
    }
    this.buckets.clear();
  }

  // ---- alvos ------------------------------------------------------------
  defineEnemySpawns() {
    // fromY abaixo das coberturas: bots nascem no piso ou nas plataformas (≤ 2,7 m)
    this.enemySpawns = BOT_SPAWNS.map((s) => ({ ...s, y: this.groundHeight(s.x, s.z, 3.0, 0.3) }));
  }

  zoneAt(x, z) { return zoneAt(x, z); }

  isSafeZone(x, z) { return z > 31.6; }

  // ---- consultas físicas (delegadas à colisão compartilhada) -------------------
  /** Raio contra a geometria sólida. Preenche out.point/out.normal como THREE.Vector3. */
  raycast(origin, dir, maxDist, out = {}) {
    if (!out.point) out.point = new THREE.Vector3();
    if (!out.normal) out.normal = new THREE.Vector3();
    return this.collision.raycast(origin, dir, maxDist, out);
  }

  segmentBlocked(a, b) { return this.collision.segmentBlocked(a, b); }

  groundHeight(x, z, fromY, radius = 0) { return this.collision.groundHeight(x, z, fromY, radius); }

  overlapsSolid(min, max, eps = 1e-4) { return this.collision.overlapsSolid(min, max, eps); }

  clampToBounds(v, margin = 0.4) { return this.collision.clampToBounds(v, margin); }

  // ---- animação de ambiente -------------------------------------------------
  update(dt, time) {
    if (this.siteGroup.visible) for (const b of this.siteBeacons) b.material.opacity = 0.16 + Math.sin(time * 2.5) * 0.06;
    for (const a of this.animated) {
      if (a.type === 'blink') a.mesh.visible = Math.sin(time * 2.2 + a.phase) > 0.2;
    }
    for (const s of this.ammoStations) {
      const ready = s.cooldown <= 0;
      s.icon.position.y = 1.55 + Math.sin(time * 2.4) * 0.06;
      s.icon.rotation.y += dt * 1.2;
      s.icon.visible = ready;
      s.stripMat.color.setHex(ready ? 0x7ff6ff : 0x3a4048);
      s.ring.material.opacity = ready ? 0.4 + Math.sin(time * 3) * 0.15 : 0.12;
    }
  }

  dispose() {
    this.scene.remove(this.root);
    disposeObject3D(this.root);
    for (const t of this.textures) t.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
    this.envTarget?.dispose();
  }
}
