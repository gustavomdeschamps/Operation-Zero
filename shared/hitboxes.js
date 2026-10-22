// Hitboxes dos jogadores online (cabeça, corpo, pernas) — mesmas no cliente e no servidor.
// Caixas alinhadas aos eixos, proporcionais à altura atual (em pé ou agachado).
import { rayAABB } from './math.js';

export const HITBOX = {
  head: { half: 0.17, top: 0.04, size: 0.34 },  // relativo ao topo da cabeça
  body: { half: 0.28, legsRatio: 0.47 },
  legs: { half: 0.2 },
};

/** Preenche `out` com as três caixas do jogador cujos pés estão em (x,y,z) e altura h. */
export function playerHitboxes(x, y, z, h, out = createHitboxSet()) {
  const headBottom = y + h - (HITBOX.head.size - HITBOX.head.top);
  const legsTop = y + h * HITBOX.body.legsRatio;
  setBox(out[0], x, z, HITBOX.head.half, headBottom, y + h + HITBOX.head.top);
  setBox(out[1], x, z, HITBOX.body.half, legsTop, headBottom);
  setBox(out[2], x, z, HITBOX.legs.half, y, legsTop);
  return out;
}

export function createHitboxSet() {
  return ['head', 'body', 'legs'].map((zone) => ({ zone, min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }));
}

function setBox(b, x, z, half, y0, y1) {
  b.min.x = x - half; b.min.y = y0; b.min.z = z - half;
  b.max.x = x + half; b.max.y = y1; b.max.z = z + half;
}

const scratch = createHitboxSet();
const n = { x: 0, y: 0, z: 0 };
/** Raio contra um jogador. Retorna { t, zone } do acerto mais próximo ou null. */
export function rayVsPlayer(origin, dir, maxDist, x, y, z, h) {
  playerHitboxes(x, y, z, h, scratch);
  let best = maxDist, zone = null;
  for (const b of scratch) {
    const t = rayAABB(origin, dir, b.min, b.max, best, n);
    if (t >= 0 && t < best) { best = t; zone = b.zone; }
  }
  return zone ? { t: best, zone } : null;
}
