// Matemática e colisão puras — compartilhadas entre cliente (navegador) e servidor (Node.js).
// Não dependem de Three.js: vetores são quaisquer objetos com campos x, y, z.

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export const smoothstep = (a, b, v) => { const t = invLerp(a, b, v); return t * t * (3 - 2 * t); };

// Interpolação exponencial independente da taxa de quadros.
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));

const TAU = Math.PI * 2;
/** Normaliza para [-π, π). Aritmética modular: seguro mesmo para valores enormes vindos da rede. */
export const wrapAngle = (a) => {
  if (!Number.isFinite(a)) return 0;
  const r = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return r;
};

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

// PRNG determinístico (mulberry32) — usado para dispersão reproduzível.
export function createRng(seed = 1) {
  let s = seed >>> 0;
  const rng = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.reseed = (v) => { s = v >>> 0; };
  return rng;
}

export const randRange = (rng, min, max) => min + (max - min) * rng();

// ---------------------------------------------------------------------------
// Colisão
// ---------------------------------------------------------------------------

/**
 * Interseção raio x AABB (método das placas).
 * Retorna a distância de entrada e grava a normal da face atingida em outNormal.
 */
export function rayAABB(origin, dir, min, max, maxDist, outNormal) {
  let tmin = 0;
  let tmax = maxDist;
  let axisHit = -1;
  let signHit = 0;
  for (let i = 0; i < 3; i++) {
    const o = i === 0 ? origin.x : i === 1 ? origin.y : origin.z;
    const d = i === 0 ? dir.x : i === 1 ? dir.y : dir.z;
    const bmin = i === 0 ? min.x : i === 1 ? min.y : min.z;
    const bmax = i === 0 ? max.x : i === 1 ? max.y : max.z;
    if (Math.abs(d) < 1e-9) {
      if (o < bmin || o > bmax) return -1;
    } else {
      const inv = 1 / d;
      let t1 = (bmin - o) * inv;
      let t2 = (bmax - o) * inv;
      let sign = -1;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
      if (t1 > tmin) { tmin = t1; axisHit = i; signHit = sign; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  if (axisHit === -1) return -1; // origem dentro da caixa
  if (outNormal) {
    outNormal.x = 0; outNormal.y = 0; outNormal.z = 0;
    if (axisHit === 0) outNormal.x = signHit; else if (axisHit === 1) outNormal.y = signHit; else outNormal.z = signHit;
  }
  return tmin;
}

export function boxesOverlap(aMin, aMax, bMin, bMax, eps = 0) {
  return aMin.x < bMax.x - eps && aMax.x > bMin.x + eps &&
         aMin.y < bMax.y - eps && aMax.y > bMin.y + eps &&
         aMin.z < bMax.z - eps && aMax.z > bMin.z + eps;
}

/** O segmento a→b passa a menos de `radius` do ponto `center`? */
export function segmentIntersectsSphere(a, b, center, radius) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const acx = center.x - a.x, acy = center.y - a.y, acz = center.z - a.z;
  const lenSq = abx * abx + aby * aby + abz * abz;
  const t = lenSq > 0 ? clamp((acx * abx + acy * aby + acz * abz) / lenSq, 0, 1) : 0;
  const px = a.x + abx * t - center.x, py = a.y + aby * t - center.y, pz = a.z + abz * t - center.z;
  return px * px + py * py + pz * pz <= radius * radius;
}

/** Ângulo (rad) do ponto em relação à direção de visão horizontal (yaw). 0 = à frente, positivo = direita. */
export function relativeYaw(fromPos, yaw, targetPos) {
  const dx = targetPos.x - fromPos.x;
  const dz = targetPos.z - fromPos.z;
  const angleTo = Math.atan2(-dx, -dz);
  return wrapAngle(yaw - angleTo);
}
