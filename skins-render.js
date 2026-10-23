// Renderização dos acabamentos (skins) de armas — 100% procedural e original.
//
// Cada acabamento de shared/skins.js vira uma textura gerada em canvas (padrão repetível, com
// semente fixa: todos os clientes veem o mesmo desenho) aplicada por projeção triplanar no espaço
// do modelo. Assim o padrão cobre qualquer peça da arma sem coordenadas UV dedicadas e mantém a
// escala física (metros) entre armas diferentes. Só a aparência muda — nunca os atributos.
import * as THREE from 'three';
import { skinById } from './shared/skins.js';
import { createWeaponMaterials } from './weapon-models.js';
import { createRng } from './utils.js';

const SIZE = 256;
const textureCache = new Map();   // skinId → { map, glow }
const materialCache = new Map();  // skinId → conjunto de materiais

function seedOf(id) { let h = 2166136261; for (const c of id) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

/** Desenha `fn(dx, dy)` nas 9 posições de ladrilho para o padrão emendar sem costura. */
const tiled = (fn) => { for (const dx of [-SIZE, 0, SIZE]) for (const dy of [-SIZE, 0, SIZE]) fn(dx, dy); };

const PATTERNS = {
  speckle(ctx, L, rng) {
    ctx.fillStyle = L.base; ctx.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 2600; i++) {
      const x = rng() * SIZE, y = rng() * SIZE, r = 0.4 + rng() * 1.3;
      ctx.fillStyle = rng() < 0.7 ? L.alt : L.accent;
      ctx.globalAlpha = 0.35 + rng() * 0.5;
      ctx.fillRect(x, y, r, r);
    }
    ctx.globalAlpha = 1;
  },
  weave(ctx, L) {
    const n = 16, s = SIZE / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const horiz = (i + j) % 2 === 0;
      const g = horiz ? ctx.createLinearGradient(i * s, j * s, i * s, (j + 1) * s) : ctx.createLinearGradient(i * s, j * s, (i + 1) * s, j * s);
      g.addColorStop(0, L.base); g.addColorStop(0.5, L.alt); g.addColorStop(1, L.base);
      ctx.fillStyle = g; ctx.fillRect(i * s, j * s, s, s);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
      ctx.strokeRect(i * s + 0.5, j * s + 0.5, s - 1, s - 1);
    }
  },
  camo(ctx, L, rng) {
    ctx.fillStyle = L.base; ctx.fillRect(0, 0, SIZE, SIZE);
    for (const [color, count] of [[L.alt, 14], [L.accent, 9], ['rgba(20,22,16,0.85)', 6]]) {
      for (let k = 0; k < count; k++) {
        const cx = rng() * SIZE, cy = rng() * SIZE, r = 18 + rng() * 34;
        const n = 5 + Math.floor(rng() * 3);
        const pts = Array.from({ length: n }, (_, i) => {
          const ang = (i / n) * Math.PI * 2 + rng() * 0.6;
          const rr = r * (0.55 + rng() * 0.6);
          return [Math.cos(ang) * rr, Math.sin(ang) * rr * 0.7];
        });
        ctx.fillStyle = color;
        tiled((dx, dy) => {
          ctx.beginPath();
          pts.forEach(([x, y], i) => (i ? ctx.lineTo(cx + x + dx, cy + y + dy) : ctx.moveTo(cx + x + dx, cy + y + dy)));
          ctx.closePath(); ctx.fill();
        });
      }
    }
  },
  stripes(ctx, L, rng) {
    ctx.fillStyle = L.base; ctx.fillRect(0, 0, SIZE, SIZE);
    // microtextura cerâmica
    for (let i = 0; i < 900; i++) { ctx.fillStyle = `rgba(255,255,255,${0.05 + rng() * 0.08})`; ctx.fillRect(rng() * SIZE, rng() * SIZE, 1.5, 1.5); }
    ctx.save();
    ctx.translate(SIZE / 2, SIZE / 2); ctx.rotate(-Math.PI / 4); ctx.translate(-SIZE, -SIZE);
    const period = SIZE * Math.SQRT2 / 2;
    for (let k = 0; k < 6; k++) {
      const y = k * period;
      ctx.fillStyle = L.alt; ctx.fillRect(0, y, SIZE * 2, period * 0.42);
      ctx.fillStyle = L.accent; ctx.fillRect(0, y + period * 0.46, SIZE * 2, period * 0.06);
    }
    ctx.restore();
  },
  brushed(ctx, L, rng) {
    ctx.fillStyle = L.base; ctx.fillRect(0, 0, SIZE, SIZE);
    for (let y = 0; y < SIZE; y++) {
      const v = rng();
      ctx.fillStyle = v < 0.5 ? `rgba(255,220,190,${v * 0.18})` : `rgba(40,18,8,${(v - 0.5) * 0.25})`;
      ctx.fillRect(0, y, SIZE, 1);
    }
    // oxidação nas "reentrâncias" + gravação geométrica
    for (let k = 0; k < 10; k++) {
      const cx = rng() * SIZE, cy = rng() * SIZE, r = 10 + rng() * 26;
      tiled((dx, dy) => {
        const g = ctx.createRadialGradient(cx + dx, cy + dy, 0, cx + dx, cy + dy, r);
        g.addColorStop(0, `${L.accent}88`); g.addColorStop(1, `${L.accent}00`);
        ctx.fillStyle = g; ctx.fillRect(cx + dx - r, cy + dy - r, r * 2, r * 2);
      });
    }
    ctx.strokeStyle = L.alt; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.25;
    for (let i = 0; i < 4; i++) {
      const o = (i * SIZE) / 4;
      ctx.beginPath(); ctx.moveTo(o, 0); ctx.lineTo(o + 32, 32); ctx.lineTo(o, 64); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(o, 128); ctx.lineTo(o + 32, 160); ctx.lineTo(o, 192); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
  circuit(ctx, L, rng, glow) {
    ctx.fillStyle = L.base; ctx.fillRect(0, 0, SIZE, SIZE);
    glow.fillStyle = '#000'; glow.fillRect(0, 0, SIZE, SIZE);
    const step = 16;
    for (let k = 0; k < 22; k++) {
      let x = Math.floor(rng() * (SIZE / step)) * step, y = Math.floor(rng() * (SIZE / step)) * step;
      const lit = rng() < 0.3;
      const pts = [[x, y]];
      for (let s = 0; s < 4 + Math.floor(rng() * 5); s++) {
        const dir = Math.floor(rng() * 4);
        const len = step * (1 + Math.floor(rng() * 4));
        if (dir === 0) x += len; else if (dir === 1) y += len; else if (dir === 2) { x += len; y += len; } else { x -= len; y += len; }
        pts.push([x, y]);
      }
      for (const [c, w, target] of [[L.alt, 3, ctx], ...(lit ? [[L.accent, 1.2, ctx], ['#fff', 1.4, glow]] : [])]) {
        target.strokeStyle = c; target.lineWidth = w; target.lineJoin = 'round';
        tiled((dx, dy) => {
          target.beginPath();
          pts.forEach(([px, py], i) => (i ? target.lineTo(px + dx, py + dy) : target.moveTo(px + dx, py + dy)));
          target.stroke();
          const [ex, ey] = pts[pts.length - 1];
          target.beginPath(); target.arc(ex + dx, ey + dy, w + 1.5, 0, Math.PI * 2); target.fillStyle = c; target.fill();
        });
      }
    }
  },
};

function makeTextures(skin) {
  const cached = textureCache.get(skin.id);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  let glowCanvas = null, glowCtx = null;
  if (skin.look.emissive) {
    glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = SIZE;
    glowCtx = glowCanvas.getContext('2d');
  }
  PATTERNS[skin.look.pattern](ctx, skin.look, createRng(seedOf(skin.id)), glowCtx);
  const wrap = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const out = { map: wrap(canvas, true), glow: glowCanvas ? wrap(glowCanvas, false) : null };
  textureCache.set(skin.id, out);
  return out;
}

/** Aplica o acabamento a um material: projeção triplanar da textura no espaço do modelo. */
function skinMaterial(base, skin, tex, tint) {
  const m = base.clone();
  m.color.setRGB(tint, tint, tint);
  m.roughness = skin.look.rough;
  m.metalness = skin.look.metal;
  const uniforms = {
    uSkinMap: { value: tex.map }, uSkinGlow: { value: tex.glow }, uSkinScale: { value: 1 / skin.look.scale },
    uSkinGlowColor: { value: new THREE.Color(skin.look.accent).multiplyScalar(tex.glow ? 1.3 : 0) },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSkinPos;\nvarying vec3 vSkinNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSkinPos = position;\nvSkinNrm = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vSkinPos;
varying vec3 vSkinNrm;
uniform sampler2D uSkinMap;
uniform float uSkinScale;
${tex.glow ? 'uniform sampler2D uSkinGlow;\nuniform vec3 uSkinGlowColor;' : ''}
vec3 skinWeights() { vec3 w = pow(abs(normalize(vSkinNrm)), vec3(4.0)); return w / (w.x + w.y + w.z); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec3 sw = skinWeights();
  vec3 sp = vSkinPos * uSkinScale;
  vec4 sc = texture2D(uSkinMap, sp.zy) * sw.x + texture2D(uSkinMap, sp.xz) * sw.y + texture2D(uSkinMap, sp.xy) * sw.z;
  diffuseColor.rgb *= sc.rgb;
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
${tex.glow ? `{
  vec3 sw = skinWeights();
  vec3 sp = vSkinPos * uSkinScale;
  float g = texture2D(uSkinGlow, sp.zy).r * sw.x + texture2D(uSkinGlow, sp.xz).r * sw.y + texture2D(uSkinGlow, sp.xy).r * sw.z;
  totalEmissiveRadiance += uSkinGlowColor * g;
}` : ''}`);
  };
  m.customProgramCacheKey = () => `skin-${skin.id}`;
  return m;
}

// materiais da arma que recebem o acabamento (luvas, mangas, lentes e retícula ficam iguais)
const SKINNED = { gunmetal: 1, polymer: 0.9, cerakote: 1, olive: 1, darkmetal: 0.62 };

/**
 * Conjunto de materiais de arma com o acabamento `skinId` (null/desconhecido → padrão de fábrica).
 * Compartilhado: cada acabamento é compilado uma única vez.
 */
export function getSkinMaterials(skinId) {
  const key = skinId && skinById(skinId) ? skinId : '';
  let set = materialCache.get(key);
  if (set) return set;
  set = createWeaponMaterials();
  if (key) {
    const skin = skinById(key);
    const tex = makeTextures(skin);
    for (const [name, tint] of Object.entries(SKINNED)) {
      const old = set[name];
      set[name] = skinMaterial(old, skin, tex, tint);
      old.dispose();
    }
    set.accent = set.accent.clone();
    set.accent.emissive.set(skin.look.accent);
  }
  materialCache.set(key, set);
  return set;
}

/** Amostra do padrão (para cartões da loja/inventário): canvas 2D do acabamento. */
export function skinSwatch(skinId) {
  const skin = skinById(skinId);
  if (!skin) return null;
  return makeTextures(skin).map.image;
}
