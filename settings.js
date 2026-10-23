// Preferências do jogador: padrões, validação (nada salvo ou importado é usado sem passar por aqui),
// persistência local e presets/código da mira. Estado da partida nunca é guardado aqui.
import { DEFAULT_BINDS } from './player.js';

export const SETTINGS_KEY = 'operation-zero-settings-v3';
const LEGACY_KEY = 'operation-zero-settings-v1';

/** Estilos de retícula — cada um tem um desenho diferente (ver crosshair.js). */
export const CROSSHAIR_STYLES = {
  cross: 'Cruz (4 linhas)',
  tshape: 'T (sem linha superior)',
  dot: 'Somente ponto',
  circle: 'Círculo',
  chevron: 'Divisa (ângulo)',
};

const XH_BASE = {
  style: 'cross', color: '#3ef0ff', length: 7, thickness: 2, gap: 5, opacity: 1,
  outline: true, outlineThickness: 1, outlineColor: '#000000',
  dot: false, dotSize: 2, dotOpacity: 1, scale: 1,
  moveExpand: true, fireExpand: true, showAds: false, showReload: true,
};

export const CROSSHAIR_PRESETS = {
  classica: { label: 'Clássica', ...XH_BASE },
  ponto: { label: 'Ponto', ...XH_BASE, style: 'dot', dot: true, dotSize: 4, moveExpand: false, fireExpand: false, color: '#ffffff' },
  compacta: { label: 'Compacta', ...XH_BASE, length: 4, gap: 2, thickness: 2, moveExpand: false },
  aberta: { label: 'Aberta', ...XH_BASE, length: 10, gap: 11, thickness: 2, dot: true, dotSize: 2, color: '#ffe14a' },
  tatica: { label: 'Tática', ...XH_BASE, style: 'tshape', length: 8, gap: 4, dot: true, dotSize: 2, color: '#7dff6a' },
  circular: { label: 'Circular', ...XH_BASE, style: 'circle', length: 9, thickness: 2, gap: 0, dot: true, dotSize: 2, color: '#3ef0ff' },
};

export const DEFAULT_SETTINGS = {
  // controles
  sensitivity: 1.0, sensitivityY: 1.0, invertY: false, adsSensitivity: 1.0,
  binds: DEFAULT_BINDS,
  // vídeo
  fov: 78, quality: 'medium', renderScale: 1.0, shadowQuality: 'auto', effectsQuality: 'high',
  fpsLimit: 0, showFps: false, showPing: false, reduceEffects: false,
  // áudio
  volume: 0.7, sfxVolume: 1.0, uiVolume: 0.8, musicVolume: 0.5, muted: false,
  // interface e acessibilidade
  hudScale: 1.0, minimapScale: 1.0, minimapOpacity: 0.9, minimapPosition: 'top-right', showMinimap: true,
  showKillfeed: true, highContrast: false, reducedMotion: 'auto',
  // jogo
  botsFireBack: true,
  // mira
  crosshairPreset: 'classica',
  crosshair: { ...XH_BASE },
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d, a, b) => { const n = Number(v); return Number.isFinite(n) ? clamp(n, a, b) : d; };
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const pick = (v, list, d) => (list.includes(v) ? v : d);
const color = (v, d) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : d);
const CODE_RE = /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Space|ShiftLeft|ShiftRight|ControlLeft|ControlRight|AltLeft|AltRight|Tab|CapsLock|Backquote|Minus|Equal|BracketLeft|BracketRight|Semicolon|Quote|Comma|Period|Slash|Backslash|F[1-9]|F1[0-2]|Arrow(Up|Down|Left|Right)|Insert|Home|End|PageUp|PageDown|Delete)$/;

export function normalizeCrosshair(c = {}) {
  const d = XH_BASE;
  return {
    style: pick(c.style, Object.keys(CROSSHAIR_STYLES), d.style),
    color: color(c.color, d.color),
    length: Math.round(num(c.length, d.length, 0, 30)),
    thickness: Math.round(num(c.thickness, d.thickness, 1, 8)),
    gap: Math.round(num(c.gap, d.gap, 0, 30)),
    opacity: num(c.opacity, d.opacity, 0.1, 1),
    outline: bool(c.outline, d.outline),
    outlineThickness: Math.round(num(c.outlineThickness, d.outlineThickness, 1, 3)),
    outlineColor: color(c.outlineColor, d.outlineColor),
    dot: bool(c.dot, d.dot),
    dotSize: Math.round(num(c.dotSize, d.dotSize, 1, 10)),
    dotOpacity: num(c.dotOpacity, d.dotOpacity, 0.1, 1),
    scale: num(c.scale, d.scale, 0.5, 2),
    moveExpand: bool(c.moveExpand, d.moveExpand),
    fireExpand: bool(c.fireExpand, d.fireExpand),
    showAds: bool(c.showAds, d.showAds),
    showReload: bool(c.showReload, d.showReload),
  };
}

function normalizeBinds(b) {
  const out = {};
  for (const [action, def] of Object.entries(DEFAULT_BINDS)) {
    const v = b && b[action];
    const list = (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).filter((k) => typeof k === 'string' && CODE_RE.test(k));
    out[action] = list.length ? list.slice(0, 3) : def.slice();
  }
  return out;
}

/** Valida tudo (valores fora de faixa voltam ao limite; desconhecidos ao padrão). */
export function normalizeSettings(raw = {}) {
  const d = DEFAULT_SETTINGS;
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    sensitivity: num(r.sensitivity, d.sensitivity, 0.1, 4),
    sensitivityY: num(r.sensitivityY, d.sensitivityY, 0.25, 2),
    invertY: bool(r.invertY, d.invertY),
    adsSensitivity: num(r.adsSensitivity, d.adsSensitivity, 0.3, 1.5),
    binds: normalizeBinds(r.binds),
    fov: Math.round(num(r.fov, d.fov, 70, 100)),
    quality: pick(r.quality, ['low', 'medium', 'high'], d.quality),
    renderScale: num(r.renderScale, d.renderScale, 0.5, 1),
    shadowQuality: pick(r.shadowQuality, ['auto', 'off', 'low', 'medium', 'high'], d.shadowQuality),
    effectsQuality: pick(r.effectsQuality, ['low', 'medium', 'high'], d.effectsQuality),
    fpsLimit: pick(Number(r.fpsLimit), [0, 30, 60, 90, 120, 144], d.fpsLimit),
    showFps: bool(r.showFps, d.showFps),
    showPing: bool(r.showPing, d.showPing),
    reduceEffects: bool(r.reduceEffects, d.reduceEffects),
    volume: num(r.volume, d.volume, 0, 1),
    sfxVolume: num(r.sfxVolume, d.sfxVolume, 0, 1),
    uiVolume: num(r.uiVolume, d.uiVolume, 0, 1),
    musicVolume: num(r.musicVolume, d.musicVolume, 0, 1),
    muted: bool(r.muted, d.muted),
    hudScale: num(r.hudScale, d.hudScale, 0.75, 1.35),
    minimapScale: num(r.minimapScale, d.minimapScale, 0.7, 1.5),
    minimapOpacity: num(r.minimapOpacity, d.minimapOpacity, 0.3, 1),
    minimapPosition: pick(r.minimapPosition, ['top-right', 'top-left'], d.minimapPosition),
    showMinimap: bool(r.showMinimap, d.showMinimap),
    showKillfeed: bool(r.showKillfeed, d.showKillfeed),
    highContrast: bool(r.highContrast, d.highContrast),
    reducedMotion: pick(r.reducedMotion, ['auto', 'on', 'off'], d.reducedMotion),
    botsFireBack: bool(r.botsFireBack, d.botsFireBack),
    crosshairPreset: pick(r.crosshairPreset, [...Object.keys(CROSSHAIR_PRESETS), 'personalizada'], d.crosshairPreset),
    crosshair: normalizeCrosshair(r.crosshair || (r.crosshairColor ? { color: r.crosshairColor } : undefined)),
  };
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY) || localStorage.getItem(LEGACY_KEY);
    return normalizeSettings(raw ? JSON.parse(raw) : {});
  } catch { return normalizeSettings({}); }
}

export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); return true; } catch { return false; }
}

/** Código compartilhável da mira (texto curto, validado na importação). */
export function exportCrosshair(c) {
  const x = normalizeCrosshair(c);
  const order = ['style', 'color', 'length', 'thickness', 'gap', 'opacity', 'outline', 'outlineThickness', 'outlineColor', 'dot', 'dotSize', 'dotOpacity', 'scale', 'moveExpand', 'fireExpand', 'showAds', 'showReload'];
  const parts = order.map((k) => {
    const v = x[k];
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (typeof v === 'number') return String(Math.round(v * 100) / 100);
    return String(v).replace('#', '');
  });
  return `OZX1-${parts.join('-')}`;
}

export function importCrosshair(code) {
  if (typeof code !== 'string') return null;
  const p = code.trim().split('-');
  if (p[0] !== 'OZX1' || p.length !== 18) return null;
  const b = (v) => v === '1';
  const n = (v) => Number(v);
  const raw = {
    style: p[1], color: `#${p[2]}`, length: n(p[3]), thickness: n(p[4]), gap: n(p[5]), opacity: n(p[6]),
    outline: b(p[7]), outlineThickness: n(p[8]), outlineColor: `#${p[9]}`, dot: b(p[10]), dotSize: n(p[11]),
    dotOpacity: n(p[12]), scale: n(p[13]), moveExpand: b(p[14]), fireExpand: b(p[15]), showAds: b(p[16]), showReload: b(p[17]),
  };
  if (!(p[1] in CROSSHAIR_STYLES) || !/^[0-9a-f]{6}$/i.test(p[2]) || !/^[0-9a-f]{6}$/i.test(p[9])) return null;
  return normalizeCrosshair(raw);
}

/** Preferência efetiva de animações reduzidas (configuração ou sistema operacional). */
export function prefersReducedMotion(s) {
  if (s.reducedMotion === 'on') return true;
  if (s.reducedMotion === 'off') return false;
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

// ---- perfil local (nome, operador, arma primária) ------------------------------
const PROFILE_KEY = 'operation-zero-profile-v1';

export function loadProfile(catalog) {
  const d = { name: '', operator: catalog.DEFAULT_OPERATOR, primary: catalog.DEFAULT_PRIMARY, map: catalog.DEFAULT_MAP };
  try {
    const raw = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');
    const legacyName = localStorage.getItem('oz-player-name') || '';
    return {
      name: typeof raw.name === 'string' ? raw.name.slice(0, 16) : legacyName.slice(0, 16),
      operator: catalog.isValidOperator(raw.operator) ? raw.operator : d.operator,
      primary: catalog.isValidPrimary(raw.primary) ? raw.primary : d.primary,
      map: catalog.isValidMap(raw.map) ? raw.map : d.map,
    };
  } catch { return d; }
}

export function saveProfile(p) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    if (p.name) localStorage.setItem('oz-player-name', p.name);
  } catch { /* armazenamento indisponível */ }
}
