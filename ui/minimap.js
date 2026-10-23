// Minimapa e mapa tático ampliado. A planta é desenhada a partir da COLISÃO REAL do mapa carregado
// (as mesmas caixas usadas pela física e pelo servidor), então nunca mostra um mapa diferente da arena.
// Integridade competitiva: só o próprio jogador e aliados aparecem — nenhuma posição inimiga é desenhada.

const PPM = 6;                 // pixels por metro na planta pré-renderizada

/** Desenha a planta superior de um mapa num canvas (cache por mapa). */
export function renderPlan(collision, def, ppm = PPM) {
  const b = def.bounds;
  const pad = 2;
  const W = Math.ceil((b.maxX - b.minX + pad * 2) * ppm), H = Math.ceil((b.maxZ - b.minZ + pad * 2) * ppm);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const X = (x) => (x - b.minX + pad) * ppm;
  const Y = (z) => (b.maxZ - z + pad) * ppm;
  ctx.fillStyle = '#0d1319';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#18212b';
  ctx.fillRect(X(b.minX), Y(b.maxZ), (b.maxX - b.minX) * ppm, (b.maxZ - b.minZ) * ppm);
  // zonas (tom levemente diferente para leitura dos setores)
  ctx.globalAlpha = 0.35;
  def.zones.forEach((zn, i) => {
    ctx.fillStyle = i % 2 ? '#1d2833' : '#1a242e';
    ctx.fillRect(X(zn.minX), Y(zn.maxZ), (zn.maxX - zn.minX) * ppm, (zn.maxZ - zn.minZ) * ppm);
  });
  ctx.globalAlpha = 1;
  // sólidos que interessam à navegação: obstáculos baixos (cobertura), plataformas e paredes
  const sorted = [...collision.colliders].sort((p, q) => p.max.y - q.max.y);
  for (const col of sorted) {
    const h = col.max.y, y0 = col.min.y;
    if (h <= 0.2 || y0 > 2.2) continue;                       // piso e telhados
    const w = col.max.x - col.min.x, d = col.max.z - col.min.z;
    if (w > (b.maxX - b.minX) * 1.05 && d > (b.maxZ - b.minZ) * 1.05) continue;
    let fill;
    if (h < 1.3) fill = '#3a4754';                            // cobertura baixa
    else if (h <= 3.0 && w > 1.2 && d > 1.2 && y0 < 0.2) fill = '#4b5968';  // plataformas / volumes médios
    else fill = '#7b8a97';                                    // paredes e volumes altos
    ctx.fillStyle = fill;
    ctx.fillRect(X(col.min.x), Y(col.max.z), Math.max(1, w * ppm), Math.max(1, d * ppm));
  }
  // objetivos
  ctx.lineWidth = 2;
  for (const s of Object.values(def.sites)) {
    ctx.strokeStyle = '#ff7a4d';
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(X(s.minX), Y(s.maxZ), (s.maxX - s.minX) * ppm, (s.maxZ - s.minZ) * ppm);
    ctx.setLineDash([]);
    ctx.fillStyle = '#ff9a73';
    ctx.font = `700 ${Math.round(ppm * 3)}px Bahnschrift, Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(s.id, X(s.cx), Y(s.cz));
  }
  // estações de munição
  for (const st of def.ammoStations) {
    ctx.fillStyle = '#7ff6ff';
    ctx.fillRect(X(st.x) - ppm * 0.6, Y(st.z) - ppm * 0.6, ppm * 1.2, ppm * 1.2);
  }
  return { canvas: c, X, Y, ppm, pad, bounds: b };
}

/** Rótulos dos setores (só no mapa ampliado e nas prévias). */
function drawZoneLabels(ctx, def, toScreen, scale) {
  ctx.font = `700 ${Math.max(11, Math.round(11 * scale))}px Bahnschrift, Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const zn of def.zones) {
    const [x, y] = toScreen((zn.minX + zn.maxX) / 2, (zn.minZ + zn.maxZ) / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const w = ctx.measureText(zn.name).width + 10;
    ctx.fillRect(x - w / 2, y - 9, w, 18);
    ctx.fillStyle = '#c3ccd4';
    ctx.fillText(zn.name, x, y);
  }
}

function drawPlayerArrow(ctx, x, y, yaw, size, color) {
  // yaw 0 olha para -Z (sul): na planta com o norte para cima, a seta aponta para baixo
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI + yaw);
  ctx.beginPath();
  ctx.moveTo(0, -size); ctx.lineTo(size * 0.7, size * 0.8); ctx.lineTo(0, size * 0.4); ctx.lineTo(-size * 0.7, size * 0.8);
  ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#000'; ctx.stroke();
  ctx.restore();
}

export class Minimap {
  constructor({ canvas, bigCanvas }) {
    this.canvas = canvas;
    // canvas pequeno redesenhado com frequência: contexto 2D em CPU evita idas e voltas à GPU
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.big = bigCanvas;
    this.bigCtx = bigCanvas.getContext('2d');
    this.plans = new Map();
    this.plan = null;
    this.def = null;
    this.range = 24;           // metros do centro à borda do minimapa
    this.bigZoom = 1;
    this.bigOpen = false;
    this.accum = 0;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.opacity = 0.9;
    this.setStyle({ scale: 1, opacity: 0.9 });
  }

  /**
   * Escala e opacidade do minimapa. Recorte, borda e transparência são desenhados no próprio canvas:
   * clip-path/transform/opacity em CSS num canvas redesenhado 30×/s custam caro na composição.
   */
  setStyle({ scale = 1, opacity = 0.9 }) {
    this.opacity = opacity;
    const px = Math.round(200 * scale * this.dpr);
    if (this.canvas.width !== px) { this.canvas.width = px; this.canvas.height = px; }
    this.accum = 1;
  }

  setMap(collision, def) {
    if (this.def && this.def.id === def.id) return;
    let plan = this.plans.get(def.id);
    if (!plan) { plan = renderPlan(collision, def); this.plans.set(def.id, plan); }
    this.plan = plan;
    this.def = def;
  }

  /**
   * view: { x, z, yaw } do jogador · allies: [{ x, z, yaw, alive }] · extras: { spike: {x,z,active} }
   * Desenha no máximo 30 vezes por segundo.
   */
  update(dt, view, allies = [], extras = {}) {
    if (!this.plan) return;
    this.accum += dt;
    if (this.accum < 1 / 30) return;
    this.accum = 0;
    this.drawMini(view, allies, extras);
    if (this.bigOpen) this.drawBig(view, allies, extras);
  }

  drawMini(view, allies, extras) {
    const ctx = this.ctx, P = this.plan;
    const S = this.canvas.width;
    const dpr = S / 200;                       // unidade de desenho (acompanha escala e densidade)
    const scale = S / (this.range * 2 * P.ppm);
    const cut = 14 * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    // recorte chanfrado (canto inferior direito) e transparência configurável
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(S, 0); ctx.lineTo(S, S - cut); ctx.lineTo(S - cut, S); ctx.lineTo(0, S); ctx.closePath();
    ctx.clip();
    ctx.globalAlpha = this.opacity;
    ctx.fillStyle = '#0a0e13';
    ctx.fillRect(0, 0, S, S);
    const px = P.X(view.x), py = P.Y(view.z);
    ctx.setTransform(scale, 0, 0, scale, S / 2 - px * scale, S / 2 - py * scale);
    ctx.drawImage(P.canvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const toS = (x, z) => [S / 2 + (P.X(x) - px) * scale, S / 2 + (P.Y(z) - py) * scale];
    if (extras.spike && extras.spike.active) {
      const [sx, sy] = toS(extras.spike.x, extras.spike.z);
      ctx.fillStyle = '#ff5a46';
      ctx.beginPath(); ctx.arc(sx, sy, 5 * dpr, 0, Math.PI * 2); ctx.fill();
    }
    for (const a of allies) {
      const [ax, ay] = toS(a.x, a.z);
      if (ax < -10 || ay < -10 || ax > S + 10 || ay > S + 10) continue;
      ctx.globalAlpha = a.alive ? 1 : 0.4;
      drawPlayerArrow(ctx, ax, ay, a.yaw, 6 * dpr, '#4fd8e6');
      ctx.globalAlpha = 1;
    }
    drawPlayerArrow(ctx, S / 2, S / 2, view.yaw, 8 * dpr, '#e9eff3');
    // marcação do norte
    ctx.fillStyle = '#c3ccd4';
    ctx.font = `700 ${11 * dpr}px Bahnschrift, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('N', S / 2, 12 * dpr);
    // borda
    ctx.globalAlpha = Math.min(1, this.opacity + 0.1);
    ctx.strokeStyle = 'rgba(220, 232, 240, 0.32)';
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();
    const h = ctx.lineWidth / 2;
    ctx.moveTo(h, h); ctx.lineTo(S - h, h); ctx.lineTo(S - h, S - cut); ctx.lineTo(S - cut, S - h); ctx.lineTo(h, S - h); ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  drawBig(view, allies, extras) {
    const ctx = this.bigCtx, P = this.plan;
    const S = this.big.width;
    const planW = P.canvas.width, planH = P.canvas.height;
    const fit = Math.min(S / planW, S / planH) * this.bigZoom;
    // com zoom, centraliza no jogador; sem zoom, mostra o mapa inteiro
    const cx = this.bigZoom > 1 ? P.X(view.x) : planW / 2;
    const cy = this.bigZoom > 1 ? P.Y(view.z) : planH / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#070a0d';
    ctx.fillRect(0, 0, S, S);
    ctx.setTransform(fit, 0, 0, fit, S / 2 - cx * fit, S / 2 - cy * fit);
    ctx.drawImage(P.canvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const toS = (x, z) => [S / 2 + (P.X(x) - cx) * fit, S / 2 + (P.Y(z) - cy) * fit];
    drawZoneLabels(ctx, this.def, toS, fit / 1.2);
    if (extras.spike && extras.spike.active) {
      const [sx, sy] = toS(extras.spike.x, extras.spike.z);
      ctx.fillStyle = '#ff5a46'; ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2); ctx.fill();
    }
    for (const a of allies) {
      const [ax, ay] = toS(a.x, a.z);
      ctx.globalAlpha = a.alive ? 1 : 0.4;
      drawPlayerArrow(ctx, ax, ay, a.yaw, 10, '#4fd8e6');
      ctx.globalAlpha = 1;
    }
    const [mx, my] = toS(view.x, view.z);
    drawPlayerArrow(ctx, mx, my, view.yaw, 13, '#e9eff3');
  }

  toggleBig(open = !this.bigOpen) { this.bigOpen = open; this.accum = 1; return open; }

  cycleZoom() { this.bigZoom = this.bigZoom >= 2.5 ? 1 : this.bigZoom === 1 ? 1.6 : 2.5; this.accum = 1; return this.bigZoom; }
}

/** Prévia estática de um mapa (tela MAPAS): planta + rótulos dos setores. */
export function drawMapPreview(canvas, collision, def) {
  const plan = renderPlan(collision, def, 4);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = canvas.clientWidth * dpr || 360;
  canvas.height = canvas.clientHeight * dpr || 450;
  const s = Math.min(canvas.width / plan.canvas.width, canvas.height / plan.canvas.height);
  ctx.fillStyle = '#070a0d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const ox = (canvas.width - plan.canvas.width * s) / 2, oy = (canvas.height - plan.canvas.height * s) / 2;
  ctx.drawImage(plan.canvas, ox, oy, plan.canvas.width * s, plan.canvas.height * s);
  const toS = (x, z) => [ox + plan.X(x) * s, oy + plan.Y(z) * s];
  // pontos de surgimento das equipes (lados de cada time)
  for (const [team, color] of [[1, '#4fd8e6'], [2, '#ff7a4d']]) {
    const list = def.onlineSpawns[team] || [];
    const cx = list.reduce((a, p) => a + p.x, 0) / (list.length || 1), cz = list.reduce((a, p) => a + p.z, 0) / (list.length || 1);
    const [x, y] = toS(cx, cz);
    ctx.fillStyle = color;
    ctx.fillRect(x - 5 * dpr, y - 5 * dpr, 10 * dpr, 10 * dpr);
  }
}
