// Desenho da retícula. A MESMA função desenha a mira da partida e a prévia das configurações,
// então o que o jogador vê no menu é exatamente o que aparece em jogo.

/**
 * Desenha a mira centrada no canvas.
 * cfg: configuração normalizada (settings.js) · spread: abertura dinâmica em px CSS · dpr: densidade.
 */
export function drawCrosshair(ctx, cfg, spread = 0, dpr = 1) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);
  const s = cfg.scale * dpr;
  const cx = Math.round(W / 2), cy = Math.round(H / 2);
  const t = Math.max(1, Math.round(cfg.thickness * s));
  const len = cfg.length * s;
  const gap = (cfg.gap + spread) * s;
  const o = cfg.outline ? Math.max(1, Math.round(cfg.outlineThickness * s)) : 0;
  const rects = [];
  const style = cfg.style;
  if (style === 'cross' || style === 'tshape') {
    const half = t / 2;
    if (len > 0) {
      if (style === 'cross') rects.push([cx - half, cy - gap - len, t, len]);             // cima
      rects.push([cx - half, cy + gap, t, len]);                                         // baixo
      rects.push([cx - gap - len, cy - half, len, t]);                                   // esquerda
      rects.push([cx + gap, cy - half, len, t]);                                         // direita
    }
  }
  const fillRects = (color, grow) => {
    ctx.fillStyle = color;
    for (const [x, y, w, h] of rects) ctx.fillRect(Math.round(x - grow), Math.round(y - grow), Math.round(w + grow * 2), Math.round(h + grow * 2));
  };
  ctx.globalAlpha = cfg.opacity;
  if (o) fillRects(cfg.outlineColor, o);
  fillRects(cfg.color, 0);

  if (style === 'circle') {
    const r = Math.max(3 * s, gap + len * 0.5);
    ctx.lineWidth = t;
    if (o) { ctx.strokeStyle = cfg.outlineColor; ctx.lineWidth = t + o * 2; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = t; }
    ctx.strokeStyle = cfg.color;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  } else if (style === 'chevron') {
    const L = Math.max(3 * s, len);
    const path = () => { ctx.beginPath(); ctx.moveTo(cx - L, cy + gap + L * 0.8); ctx.lineTo(cx, cy + gap); ctx.lineTo(cx + L, cy + gap + L * 0.8); };
    ctx.lineJoin = 'miter';
    if (o) { ctx.strokeStyle = cfg.outlineColor; ctx.lineWidth = t + o * 2; path(); ctx.stroke(); }
    ctx.strokeStyle = cfg.color; ctx.lineWidth = t; path(); ctx.stroke();
  }

  if (cfg.dot || style === 'dot') {
    const d = Math.max(1, Math.round(cfg.dotSize * s));
    ctx.globalAlpha = cfg.dotOpacity * cfg.opacity;
    const x = Math.round(cx - d / 2), y = Math.round(cy - d / 2);
    if (o) { ctx.fillStyle = cfg.outlineColor; ctx.fillRect(x - o, y - o, d + o * 2, d + o * 2); }
    ctx.fillStyle = cfg.color;
    ctx.fillRect(x, y, d, d);
  }
  ctx.globalAlpha = 1;
}

/** Mira viva num canvas do DOM: redesenha só quando algo muda. */
export class CrosshairView {
  constructor(canvas, size = 180) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = size;
    this.cfg = null;
    this.spread = 0;
    this.visible = true;
    this.dirty = true;
    this.resize();
  }

  resize() {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.canvas.width = Math.round(this.size * dpr);
    this.canvas.height = Math.round(this.size * dpr);
    this.canvas.style.width = `${this.size}px`;
    this.canvas.style.height = `${this.size}px`;
    this.dirty = true;
  }

  setConfig(cfg) { this.cfg = cfg; this.dirty = true; this.render(); }

  /** Abertura dinâmica (px) — quantizada para evitar redesenhos a cada quadro. */
  setSpread(px) {
    const q = Math.round(px * 2) / 2;
    if (q !== this.spread) { this.spread = q; this.dirty = true; }
  }

  setVisible(v) {
    if (v === this.visible) return;
    this.visible = v;
    this.canvas.style.visibility = v ? 'visible' : 'hidden';
  }

  render() {
    if (!this.dirty || !this.cfg) return;
    this.dirty = false;
    drawCrosshair(this.ctx, this.cfg, this.spread, this.dpr);
  }
}
