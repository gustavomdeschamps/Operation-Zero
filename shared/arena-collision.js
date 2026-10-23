// Representação de colisão de cada mapa — usada pela física do cliente, pela predição online e
// pela validação autoritativa do servidor. Gerada a partir do layout compartilhado (arena-layout.js).
import { buildArenaLayout, getMapDef } from './arena-layout.js';
import { DEFAULT_MAP } from './catalog.js';
import { rayAABB, boxesOverlap, clamp } from './math.js';

const SURFACE_OF = {
  concrete: 'concrete', concreteDark: 'concrete', concreteLight: 'concrete', floor: 'concrete',
  metal: 'metal', metalTrim: 'metal', steelBlue: 'metal', containerTeal: 'metal', containerOrange: 'metal',
  containerBlue: 'metal', containerRust: 'metal', containerGray: 'metal', crate: 'wood', hazard: 'metal',
  rubber: 'concrete', asphalt: 'concrete', woodDeck: 'wood', containerGreen: 'metal', containerYellow: 'metal',
  glassDark: 'metal',
};

export const surfaceOf = (material) => SURFACE_OF[material] || 'concrete';

/** Builder que registra apenas o que é sólido; todas as chamadas visuais são ignoradas. */
class CollisionBuilder {
  constructor() { this.colliders = []; }
  box(x0, x1, y0, y1, z0, z1, material, { collide = true } = {}) {
    if (collide) this.colliders.push(makeCollider(x0, x1, y0, y1, z0, z1, surfaceOf(material)));
  }
  solid(x0, x1, y0, y1, z0, z1, surface = 'metal') { this.colliders.push(makeCollider(x0, x1, y0, y1, z0, z1, surface)); }
  crate(x0, x1, y0, y1, z0, z1) { this.colliders.push(makeCollider(x0, x1, y0, y1, z0, z1, 'wood')); }
}
for (const visual of ['paint', 'lightBar', 'pipe', 'barrel', 'cylinder', 'torus', 'floorRing', 'sign', 'floorLetter', 'wallLetter', 'ammoStationVisual', 'siteMarker', 'water', 'crane', 'deco']) {
  CollisionBuilder.prototype[visual] = () => {};
}

function makeCollider(x0, x1, y0, y1, z0, z1, surface) {
  return { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 }, surface };
}

export class ArenaCollision {
  constructor(colliders, bounds, mapId = DEFAULT_MAP) {
    this.mapId = mapId;
    this.colliders = colliders;
    this.bounds = bounds;
    this._n = { x: 0, y: 0, z: 0 };
    this._d = { x: 0, y: 0, z: 0 };
  }

  /**
   * Raio contra todos os sólidos. Retorna o impacto mais próximo (ou null).
   * `out.point`/`out.normal` podem ser objetos do chamador (ex.: THREE.Vector3) — são preenchidos por campo.
   */
  raycast(origin, dir, maxDist, out = {}) {
    let best = maxDist;
    let hit = null;
    const n = this._n;
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      const t = rayAABB(origin, dir, c.min, c.max, best, n);
      if (t >= 0 && t < best) { best = t; hit = c; nx = n.x; ny = n.y; nz = n.z; }
    }
    if (!hit) return null;
    const p = out.point || (out.point = { x: 0, y: 0, z: 0 });
    p.x = origin.x + dir.x * best; p.y = origin.y + dir.y * best; p.z = origin.z + dir.z * best;
    const nn = out.normal || (out.normal = { x: 0, y: 0, z: 0 });
    nn.x = nx; nn.y = ny; nn.z = nz;
    out.distance = best;
    out.surface = hit.surface;
    out.collider = hit;
    return out;
  }

  /** Existe sólido entre a e b? (linha de visão) */
  segmentBlocked(a, b) {
    const d = this._d;
    d.x = b.x - a.x; d.y = b.y - a.y; d.z = b.z - a.z;
    const len = Math.hypot(d.x, d.y, d.z);
    if (len < 1e-5) return false;
    d.x /= len; d.y /= len; d.z /= len;
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      if (rayAABB(a, d, c.min, c.max, len, null) >= 0) return true;
    }
    return false;
  }

  /** Altura do topo sólido mais alto sob (x,z) que não ultrapassa fromY. */
  groundHeight(x, z, fromY, radius = 0) {
    let best = -Infinity;
    for (const c of this.colliders) {
      if (x + radius <= c.min.x || x - radius >= c.max.x || z + radius <= c.min.z || z - radius >= c.max.z) continue;
      if (c.max.y <= fromY + 1e-4 && c.max.y > best) best = c.max.y;
    }
    return best === -Infinity ? 0 : best;
  }

  overlapsSolid(min, max, eps = 1e-4) {
    for (const c of this.colliders) if (boxesOverlap(min, max, c.min, c.max, eps)) return true;
    return false;
  }

  inBounds(x, z, margin = 0) {
    const b = this.bounds;
    return x >= b.minX + margin && x <= b.maxX - margin && z >= b.minZ + margin && z <= b.maxZ - margin;
  }

  clampToBounds(v, margin = 0.4) {
    v.x = clamp(v.x, this.bounds.minX + margin, this.bounds.maxX - margin);
    v.z = clamp(v.z, this.bounds.minZ + margin, this.bounds.maxZ - margin);
    return v;
  }
}

const cache = new Map();
/** Uma instância por mapa (os layouts são estáticos). */
export function getArenaCollision(mapId = DEFAULT_MAP) {
  const def = getMapDef(mapId);
  let arena = cache.get(def.id);
  if (!arena) {
    const builder = new CollisionBuilder();
    buildArenaLayout(builder, def.id);
    arena = new ArenaCollision(builder.colliders, def.bounds, def.id);
    cache.set(def.id, arena);
  }
  return arena;
}
