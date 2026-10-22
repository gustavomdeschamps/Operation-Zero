// Utilitários puros e reutilizáveis (matemática, colisão, geometria, eventos).
import * as THREE from 'three';
import { clamp, lerp } from './shared/math.js';

// Funções puras vivem em shared/math.js (usadas também pelo servidor).
export * from './shared/math.js';

// ---------------------------------------------------------------------------
// Geometria
// ---------------------------------------------------------------------------

/**
 * Caixa com UVs em escala de mundo: a textura mantém densidade constante
 * independentemente das dimensões da caixa.
 */
export function createWorldBoxGeometry(w, h, d, texelScale = 1) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const normal = geo.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    let su, sv;
    if (nx > 0.5) { su = d; sv = h; } else if (ny > 0.5) { su = w; sv = d; } else { su = w; sv = h; }
    uv.setXY(i, (uv.getX(i) * su) / texelScale, (uv.getY(i) * sv) / texelScale);
  }
  uv.needsUpdate = true;
  return geo;
}

/** Junta geometrias (indexadas ou não) com position/normal/uv num único buffer. */
export function mergeGeometries(geometries) {
  let vertexCount = 0;
  let indexCount = 0;
  for (const g of geometries) {
    vertexCount += g.attributes.position.count;
    indexCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  let vOffset = 0;
  let iOffset = 0;
  for (const g of geometries) {
    const pos = g.attributes.position;
    positions.set(pos.array, vOffset * 3);
    normals.set(g.attributes.normal.array, vOffset * 3);
    if (g.attributes.uv) uvs.set(g.attributes.uv.array, vOffset * 2);
    if (g.index) {
      const idx = g.index.array;
      for (let i = 0; i < idx.length; i++) indices[iOffset + i] = idx[i] + vOffset;
      iOffset += idx.length;
    } else {
      for (let i = 0; i < pos.count; i++) indices[iOffset + i] = i + vOffset;
      iOffset += pos.count;
    }
    vOffset += pos.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

/** Libera geometrias, materiais e texturas de uma hierarquia. */
export function disposeObject3D(root, { keepShared = null } = {}) {
  root.traverse((obj) => {
    if (obj.geometry && !(keepShared && keepShared.has(obj.geometry))) obj.geometry.dispose();
    const mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
    for (const m of mats) {
      if (keepShared && keepShared.has(m)) continue;
      for (const key of ['map', 'emissiveMap', 'bumpMap', 'roughnessMap', 'alphaMap', 'normalMap']) {
        if (m[key] && !(keepShared && keepShared.has(m[key]))) m[key].dispose();
      }
      m.dispose();
    }
  });
}

// ---------------------------------------------------------------------------
// Coordenadas
// ---------------------------------------------------------------------------

const _proj = new THREE.Vector3();
/** Converte um ponto do mundo para pixels de tela. Retorna null se estiver atrás da câmera. */
export function worldToScreen(point, camera, width, height, out = { x: 0, y: 0 }) {
  _proj.copy(point).project(camera);
  if (_proj.z > 1) return null;
  out.x = (_proj.x * 0.5 + 0.5) * width;
  out.y = (-_proj.y * 0.5 + 0.5) * height;
  return out;
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

export class EventBus {
  constructor() { this.handlers = new Map(); }
  on(name, fn) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(fn);
    return () => this.off(name, fn);
  }
  off(name, fn) { this.handlers.get(name)?.delete(fn); }
  emit(name, payload) {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const fn of set) fn(payload);
  }
  clear() { this.handlers.clear(); }
}

// ---------------------------------------------------------------------------
// Texturas procedurais (canvas)
// ---------------------------------------------------------------------------

export function createCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Ruído de valor 2D simples e determinístico, desenhado em camadas (fBm). */
export function paintNoise(ctx, w, h, rng, { octaves = 4, base = 128, amp = 40, scale = 4, tint = [1, 1, 1] } = {}) {
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  const grids = [];
  for (let o = 0; o < octaves; o++) {
    const cells = scale * (1 << o);
    const g = new Float32Array((cells + 1) * (cells + 1));
    for (let i = 0; i < g.length; i++) g[i] = rng() * 2 - 1;
    // bordas iguais para manter a textura repetível
    for (let i = 0; i <= cells; i++) {
      g[i * (cells + 1) + cells] = g[i * (cells + 1)];
      g[cells * (cells + 1) + i] = g[i];
    }
    grids.push({ cells, g });
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      let a = 1;
      let norm = 0;
      for (const { cells, g } of grids) {
        const fx = (x / w) * cells, fy = (y / h) * cells;
        const ix = Math.floor(fx), iy = Math.floor(fy);
        const tx = fx - ix, ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const r = cells + 1;
        const v00 = g[iy * r + ix], v10 = g[iy * r + ix + 1];
        const v01 = g[(iy + 1) * r + ix], v11 = g[(iy + 1) * r + ix + 1];
        v += lerp(lerp(v00, v10, sx), lerp(v01, v11, sx), sy) * a;
        norm += a;
        a *= 0.5;
      }
      v /= norm;
      const i = (y * w + x) * 4;
      const k = base + v * amp;
      data[i] = clamp(k * tint[0], 0, 255);
      data[i + 1] = clamp(k * tint[1], 0, 255);
      data[i + 2] = clamp(k * tint[2], 0, 255);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}
