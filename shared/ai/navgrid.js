// Navegação dos bots: grade de células andáveis gerada a partir da COLISÃO REAL do mapa
// (a mesma usada pela física e pelos tiros), A* com 8 vizinhos e suavização por linha de passagem.
//
// Uma célula (0,5 m) é andável quando o jogador (cápsula aproximada por caixa de raio 0,32 m e
// 1,8 m de altura) cabe em pé sobre o piso mais alto abaixo de 3 m. Vizinhas se ligam quando a
// diferença de altura cabe num degrau (0,46 m); diagonais exigem as duas laterais livres.
// Limitação documentada: superfícies acima de 3 m (telhados) não entram na grade.
import { GAME } from '../game-config.js';
import { getArenaCollision } from '../arena-collision.js';

const CELL = 0.5;
const MAX_FLOOR = 3.0;
const SQRT2 = Math.SQRT2;

export class NavGrid {
  constructor(arena, cell = CELL) {
    this.arena = arena;
    this.cell = cell;
    const b = arena.bounds;
    this.x0 = b.minX; this.z0 = b.minZ;
    this.w = Math.ceil((b.maxX - b.minX) / cell);
    this.h = Math.ceil((b.maxZ - b.minZ) / cell);
    const n = this.w * this.h;
    this.walk = new Uint8Array(n);
    this.floor = new Float32Array(n);
    this.clearance = new Uint8Array(n);       // distância (em células) até o obstáculo mais próximo
    this.links = new Uint8Array(n);           // bit k = passagem para o vizinho DIRS[k]
    this.gScore = new Float32Array(n);
    this.came = new Int32Array(n);
    this.stamp = new Uint32Array(n);          // geração da busca (evita limpar os arrays a cada A*)
    this.closedStamp = new Uint32Array(n);
    this.gen = 0;
    this.build();
  }

  idx(i, j) { return j * this.w + i; }
  cellOf(x, z) { return [Math.floor((x - this.x0) / this.cell), Math.floor((z - this.z0) / this.cell)]; }
  center(i, j, out = { x: 0, y: 0, z: 0 }) {
    out.x = this.x0 + (i + 0.5) * this.cell; out.z = this.z0 + (j + 0.5) * this.cell;
    out.y = this.floor[this.idx(i, j)];
    return out;
  }

  build() {
    const a = this.arena, cfg = GAME.player;
    const r = cfg.radius + 0.04, H = cfg.height;
    const cols = a.colliders;
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const x = this.x0 + (i + 0.5) * this.cell, z = this.z0 + (j + 0.5) * this.cell;
        if (!a.inBounds(x, z, r)) continue;
        const y = a.groundHeight(x, z, MAX_FLOOR, 0.05);
        let blocked = false;
        for (let k = 0; k < cols.length && !blocked; k++) {
          const c = cols[k];
          // sólidos até um degrau acima do piso não bloqueiam (a física sobe neles, ex.: escadas)
          if (x + r > c.min.x && x - r < c.max.x && z + r > c.min.z && z - r < c.max.z && y + cfg.stepHeight < c.max.y && y + H > c.min.y) blocked = true;
        }
        if (blocked) continue;
        const id = this.idx(i, j);
        this.walk[id] = 1;
        this.floor[id] = y;
      }
    }
    // folga: bots preferem não raspar nas paredes
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const id = this.idx(i, j);
      if (!this.walk[id]) continue;
      let c = 0;
      outer: for (let d = 1; d <= 3; d++) {
        for (let dj = -d; dj <= d; dj++) for (let di = -d; di <= d; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== d) continue;
          if (!this.isWalk(i + di, j + dj)) break outer;
        }
        c = d;
      }
      this.clearance[id] = c;
    }
    // ligações: degrau entre centros amostrado a cada 1/8 de metro (escadas sobem, caixas altas não)
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const id = this.idx(i, j);
      if (!this.walk[id]) continue;
      let mask = 0;
      for (let k = 0; k < 8; k++) {
        const [di, dj] = DIRS[k];
        if (this.computeLink(i, j, di, dj)) mask |= 1 << k;
      }
      this.links[id] = mask;
    }
  }

  computeLink(i, j, di, dj) {
    const ni = i + di, nj = j + dj;
    if (!this.isWalk(ni, nj)) return false;
    if (di && dj && (!this.isWalk(i + di, j) || !this.isWalk(i, j + dj))) return false;
    const y0 = this.floor[this.idx(i, j)], y1 = this.floor[this.idx(ni, nj)];
    const step = GAME.player.stepHeight;
    if (Math.abs(y1 - y0) <= 0.2) return true;
    if (Math.abs(y1 - y0) > step * 3) return false;
    // subida/descida gradual (escada): cada trecho de 1/8 m não pode passar de um degrau
    const ax = this.x0 + (i + 0.5) * this.cell, az = this.z0 + (j + 0.5) * this.cell;
    const n = Math.ceil((this.cell * (di && dj ? SQRT2 : 1)) / 0.125);
    let prev = y0;
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      const y = this.arena.groundHeight(ax + di * this.cell * t, az + dj * this.cell * t, Math.max(y0, y1) + step, 0.05);
      if (Math.abs(y - prev) > step) return false;
      prev = y;
    }
    return Math.abs(y1 - prev) <= step;
  }

  isWalk(i, j) { return i >= 0 && j >= 0 && i < this.w && j < this.h && this.walk[this.idx(i, j)] === 1; }

  /** Passagem direta entre duas células vizinhas (pré-calculada em build). */
  link(i, j, di, dj) {
    if (!this.isWalk(i, j)) return false;
    return (this.links[this.idx(i, j)] & (1 << DIR_INDEX[(dj + 1) * 3 + (di + 1)])) !== 0;
  }

  /** Célula andável mais próxima de (x,z) (busca em anel até `maxR` células). */
  nearest(x, z, maxR = 8) {
    const [ci, cj] = this.cellOf(x, z);
    if (this.isWalk(ci, cj)) return [ci, cj];
    for (let d = 1; d <= maxR; d++) {
      let best = null, bd = Infinity;
      for (let dj = -d; dj <= d; dj++) for (let di = -d; di <= d; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== d || !this.isWalk(ci + di, cj + dj)) continue;
        const dd = di * di + dj * dj;
        if (dd < bd) { bd = dd; best = [ci + di, cj + dj]; }
      }
      if (best) return best;
    }
    return null;
  }

  /**
   * A* de (ax,az) até (bx,bz). Retorna lista de pontos {x,y,z} (já suavizada) ou null.
   * `avoid(x,z)` opcional devolve custo extra (ex.: áreas expostas a um inimigo).
   */
  findPath(ax, az, bx, bz, { maxNodes = 12000, avoid = null } = {}) {
    const s = this.nearest(ax, az), g = this.nearest(bx, bz);
    if (!s || !g) return null;
    const W = this.w;
    const start = this.idx(s[0], s[1]), goal = this.idx(g[0], g[1]);
    if (start === goal) return [this.center(g[0], g[1])];
    const gen = ++this.gen;
    const gScore = this.gScore, came = this.came, stamp = this.stamp, closed = this.closedStamp;
    const open = new MinHeap();
    const hfn = (id) => { const i = id % W, j = (id / W) | 0; const dx = Math.abs(i - g[0]), dz = Math.abs(j - g[1]); return (dx + dz) + (SQRT2 - 2) * Math.min(dx, dz); };
    stamp[start] = gen; gScore[start] = 0; came[start] = -1;
    open.push(start, hfn(start));
    let expanded = 0, found = false;
    while (open.size) {
      const cur = open.pop();
      if (cur === goal) { found = true; break; }
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      if (++expanded > maxNodes) return null;
      const i = cur % W, j = (cur / W) | 0;
      const mask = this.links[cur];
      for (let k = 0; k < 8; k++) {
        if (!(mask & (1 << k))) continue;
        const di = DIRS[k][0], dj = DIRS[k][1];
        const nid = cur + dj * W + di;
        if (closed[nid] === gen) continue;
        // custo: distância + penalidade perto de paredes (+ custo tático opcional)
        let cost = (di && dj ? SQRT2 : 1) + (this.clearance[nid] < 1 ? 0.8 : this.clearance[nid] < 2 ? 0.25 : 0);
        if (avoid) { const c = this.center(i + di, j + dj, _c); cost += avoid(c.x, c.z); }
        const ng = gScore[cur] + cost;
        if (stamp[nid] !== gen || ng < gScore[nid]) {
          stamp[nid] = gen; gScore[nid] = ng; came[nid] = cur;
          open.push(nid, ng + hfn(nid));
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let id = goal; id !== -1; id = came[id]) cells.push(id);
    cells.reverse();
    return this.smooth(cells.map((id) => this.center(id % W, (id / W) | 0, { x: 0, y: 0, z: 0 })));
  }

  /** Remove pontos intermediários quando há passagem direta (sem degraus altos nem paredes). */
  smooth(pts) {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let anchor = 0;
    for (let k = 2; k < pts.length; k++) {
      if (!this.walkable(pts[anchor], pts[k])) { out.push(pts[k - 1]); anchor = k - 1; }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  /** Dá para andar em linha reta de a até b? (amostra a grade a cada ¼ de célula) */
  walkable(a, b) {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(d / (this.cell * 0.25)));
    let [pi, pj] = this.cellOf(a.x, a.z);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const [i, j] = this.cellOf(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
      if (i === pi && j === pj) continue;
      if (!this.isWalk(i, j) || this.clearance[this.idx(i, j)] < 1) return false;
      if (Math.abs(i - pi) > 1 || Math.abs(j - pj) > 1 || !this.link(pi, pj, i - pi, j - pj)) return false;
      pi = i; pj = j;
    }
    return true;
  }

  /** Ponto andável aleatório (rng → [0,1)), opcionalmente dentro de um retângulo. */
  randomPoint(rng, rect = null, tries = 60) {
    for (let t = 0; t < tries; t++) {
      const x = rect ? rect.minX + (rect.maxX - rect.minX) * rng() : this.x0 + this.w * this.cell * rng();
      const z = rect ? rect.minZ + (rect.maxZ - rect.minZ) * rng() : this.z0 + this.h * this.cell * rng();
      const [i, j] = this.cellOf(x, z);
      if (this.isWalk(i, j) && this.clearance[this.idx(i, j)] >= 1) return this.center(i, j, { x: 0, y: 0, z: 0 });
    }
    return null;
  }

  /** Quantidade de células andáveis (diagnóstico/testes). */
  get walkableCount() { let n = 0; for (let k = 0; k < this.walk.length; k++) n += this.walk[k]; return n; }
}

const _c = { x: 0, y: 0, z: 0 };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const DIR_INDEX = new Int8Array(9).fill(-1);
DIRS.forEach(([di, dj], k) => { DIR_INDEX[(dj + 1) * 3 + (di + 1)] = k; });

class MinHeap {
  constructor() { this.ids = []; this.keys = []; }
  get size() { return this.ids.length; }
  push(id, key) {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id); keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p]; keys[i] = keys[p]; i = p;
    }
    ids[i] = id; keys[i] = key;
  }
  pop() {
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop(), lastKey = keys.pop();
    if (ids.length) {
      let i = 0;
      const n = ids.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c]; keys[i] = keys[c]; i = c;
      }
      ids[i] = lastId; keys[i] = lastKey;
    }
    return top;
  }
}

const cache = new Map();
/** Uma grade por mapa (estática, como a colisão). */
export function getNavGrid(mapId) {
  let g = cache.get(mapId);
  if (!g) { g = new NavGrid(getArenaCollision(mapId)); cache.set(mapId, g); }
  return g;
}
