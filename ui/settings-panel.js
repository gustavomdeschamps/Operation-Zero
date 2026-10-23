// Tela de CONFIGURAÇÕES: abas geradas a partir de um esquema, aplicação imediata (e persistida),
// restauração por aba, remapeamento de teclas e editor de mira com prévia ao vivo.
// A prévia da mira usa o mesmo desenho da partida (crosshair.js).
import { DEFAULT_SETTINGS, CROSSHAIR_PRESETS, CROSSHAIR_STYLES, normalizeCrosshair, exportCrosshair, importCrosshair } from '../settings.js';
import { ACTION_LABELS, DEFAULT_BINDS } from '../player.js';
import { CrosshairView } from '../crosshair.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const pct = (v) => `${Math.round(v * 100)}%`;

export function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  const map = { Space: 'Espaço', ShiftLeft: 'Shift', ShiftRight: 'Shift Dir.', ControlLeft: 'Ctrl', ControlRight: 'Ctrl Dir.', AltLeft: 'Alt', AltRight: 'Alt Dir.', Tab: 'Tab', CapsLock: 'Caps', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  return map[code] || code;
}

/** Esquema das abas (exceto MIRA, que tem editor próprio). */
const TABS = {
  controls: [
    { group: 'MOUSE' },
    { key: 'sensitivity', label: 'Sensibilidade horizontal', type: 'range', min: 0.1, max: 4, step: 0.05, fmt: (v) => v.toFixed(2) },
    { key: 'sensitivityY', label: 'Sensibilidade vertical (multiplicador)', type: 'range', min: 0.25, max: 2, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
    { key: 'adsSensitivity', label: 'Sensibilidade ao mirar (ADS)', type: 'range', min: 0.3, max: 1.5, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
    { key: 'invertY', label: 'Inverter eixo vertical', type: 'check' },
    { group: 'TECLAS', binds: true },
  ],
  video: [
    { group: 'IMAGEM' },
    { key: 'fov', label: 'Campo de visão (vertical)', type: 'range', min: 70, max: 100, step: 1, fmt: (v) => `${v}°` },
    { key: 'quality', label: 'Qualidade gráfica', type: 'select', options: [['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta']] },
    { key: 'renderScale', label: 'Escala de renderização', type: 'range', min: 0.5, max: 1, step: 0.05, fmt: pct },
    { key: 'shadowQuality', label: 'Sombras', type: 'select', options: [['auto', 'Conforme a qualidade'], ['off', 'Desligadas'], ['low', 'Baixa (1024)'], ['medium', 'Média (2048)'], ['high', 'Alta (4096)']] },
    { key: 'effectsQuality', label: 'Partículas e efeitos', type: 'select', options: [['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta']] },
    { group: 'DESEMPENHO' },
    { key: 'fpsLimit', label: 'Limite de FPS', type: 'select', options: [[0, 'Sem limite (vsync)'], [30, '30'], [60, '60'], [90, '90'], [120, '120'], [144, '144']], number: true },
    { key: 'showFps', label: 'Mostrar FPS medido', type: 'check' },
    { key: 'showPing', label: 'Mostrar latência (ms) na partida online', type: 'check' },
    { key: 'reduceEffects', label: 'Reduzir efeitos pesados (clarões, partículas, vinheta)', type: 'check' },
    { action: 'toggle-fullscreen', label: 'Tela cheia', button: 'ALTERNAR TELA CHEIA' },
  ],
  audio: [
    { group: 'VOLUME' },
    { key: 'volume', label: 'Volume geral', type: 'range', min: 0, max: 1, step: 0.01, fmt: pct },
    { key: 'sfxVolume', label: 'Efeitos (armas, passos, impactos)', type: 'range', min: 0, max: 1, step: 0.01, fmt: pct },
    { key: 'uiVolume', label: 'Interface', type: 'range', min: 0, max: 1, step: 0.01, fmt: pct },
    { key: 'musicVolume', label: 'Música e ambiente do menu', type: 'range', min: 0, max: 1, step: 0.01, fmt: pct },
    { key: 'muted', label: 'Silenciar o jogo', type: 'check' },
  ],
  interface: [
    { group: 'HUD' },
    { key: 'hudScale', label: 'Escala da HUD', type: 'range', min: 0.75, max: 1.35, step: 0.05, fmt: pct },
    { key: 'showKillfeed', label: 'Mostrar feed de eliminações', type: 'check' },
    { group: 'MINIMAPA' },
    { key: 'showMinimap', label: 'Mostrar minimapa', type: 'check' },
    { key: 'minimapScale', label: 'Escala do minimapa', type: 'range', min: 0.7, max: 1.5, step: 0.05, fmt: pct },
    { key: 'minimapOpacity', label: 'Opacidade do minimapa', type: 'range', min: 0.3, max: 1, step: 0.05, fmt: pct },
    { key: 'minimapPosition', label: 'Posição do minimapa', type: 'select', options: [['top-right', 'Superior direita'], ['top-left', 'Superior esquerda']] },
    { group: 'ACESSIBILIDADE' },
    { key: 'highContrast', label: 'Alto contraste na interface', type: 'check' },
    { key: 'reducedMotion', label: 'Animações reduzidas', type: 'select', options: [['auto', 'Conforme o sistema'], ['on', 'Ativadas'], ['off', 'Desativadas']] },
  ],
  game: [
    { group: 'TREINAMENTO' },
    { key: 'botsFireBack', label: 'Soldados hostis revidam (dano ao jogador)', type: 'check' },
  ],
};

const TAB_KEYS = {
  controls: ['sensitivity', 'sensitivityY', 'adsSensitivity', 'invertY', 'binds'],
  video: ['fov', 'quality', 'renderScale', 'shadowQuality', 'effectsQuality', 'fpsLimit', 'showFps', 'showPing', 'reduceEffects'],
  audio: ['volume', 'sfxVolume', 'uiVolume', 'musicVolume', 'muted'],
  crosshair: ['crosshair', 'crosshairPreset'],
  interface: ['hudScale', 'showKillfeed', 'showMinimap', 'minimapScale', 'minimapOpacity', 'minimapPosition', 'highContrast', 'reducedMotion'],
  game: ['botsFireBack'],
};

export class SettingsPanel {
  /** @param game objeto com { settings, applySettings(patch, persist), handleAction(action) } */
  constructor(game) {
    this.game = game;
    this.form = document.getElementById('settings-form');
    this.tabs = document.getElementById('settings-tabs');
    this.saved = document.getElementById('settings-saved');
    this.tab = 'controls';
    this.waitingBind = null;
    this.xhBg = 'scene';
    this.tabs.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => this.show(b.dataset.tab)));
    this._keyCapture = (e) => this.captureKey(e);
    window.addEventListener('keydown', this._keyCapture, true);
  }

  get s() { return this.game.settings; }

  show(tab = this.tab) {
    this.tab = tab;
    this.tabs.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    this.waitingBind = null;
    this.form.replaceChildren(tab === 'crosshair' ? this.buildCrosshair() : this.buildTab(TABS[tab]));
  }

  apply(patch) {
    this.game.applySettings(patch, true);
    this.saved.textContent = 'Alterações aplicadas e salvas neste navegador.';
  }

  /** Restaura os valores padrão apenas da aba aberta. */
  resetTab() {
    const patch = {};
    for (const k of TAB_KEYS[this.tab]) patch[k] = structuredClone(DEFAULT_SETTINGS[k]);
    this.apply(patch);
    this.show(this.tab);
    this.saved.textContent = 'Padrões desta aba restaurados.';
  }

  buildTab(schema) {
    const root = document.createDocumentFragment();
    let group = null;
    for (const f of schema) {
      if (f.group) {
        group = el('div', 'set-group');
        group.append(el('h4', null, f.group));
        root.append(group);
        if (f.binds) this.buildBinds(group);
        continue;
      }
      group.append(this.buildField(f, this.s, (patch) => this.apply(patch)));
    }
    return root;
  }

  buildField(f, values, onChange) {
    if (f.action) {
      const row = el('div', 'set-row wide');
      row.append(el('span', null, f.label));
      const b = el('button', 'btn small', f.button);
      b.type = 'button';
      b.addEventListener('click', () => this.game.handleAction(f.action));
      row.append(b);
      return row;
    }
    const v = values[f.key];
    if (f.type === 'check') {
      const row = el('label', 'set-row check');
      row.append(el('span', null, f.label));
      const input = el('input');
      input.type = 'checkbox';
      input.checked = !!v;
      input.addEventListener('change', () => onChange({ [f.key]: input.checked }));
      row.append(input);
      return row;
    }
    if (f.type === 'select') {
      const row = el('label', 'set-row wide');
      row.append(el('span', null, f.label));
      const sel = el('select');
      for (const [val, label] of f.options) {
        const o = el('option', null, label);
        o.value = String(val);
        if (String(val) === String(v)) o.selected = true;
        sel.append(o);
      }
      sel.addEventListener('change', () => onChange({ [f.key]: f.number ? Number(sel.value) : sel.value }));
      row.append(sel);
      return row;
    }
    if (f.type === 'color') {
      const row = el('label', 'set-row wide');
      row.append(el('span', null, f.label));
      const input = el('input');
      input.type = 'color';
      input.value = v;
      input.addEventListener('input', () => onChange({ [f.key]: input.value }));
      row.append(input);
      return row;
    }
    const row = el('label', 'set-row');
    row.append(el('span', null, f.label));
    const input = el('input');
    input.type = 'range';
    input.min = f.min; input.max = f.max; input.step = f.step;
    input.value = v;
    const out = el('output', null, f.fmt ? f.fmt(Number(v)) : String(v));
    input.addEventListener('input', () => {
      const n = Number(input.value);
      out.textContent = f.fmt ? f.fmt(n) : String(n);
      onChange({ [f.key]: n });
    });
    row.append(input, out);
    return row;
  }

  // ---- teclas ------------------------------------------------------------
  buildBinds(group) {
    for (const action of Object.keys(DEFAULT_BINDS)) {
      const row = el('div', 'set-row wide');
      row.append(el('span', null, ACTION_LABELS[action]));
      const b = el('button', 'keybind', this.s.binds[action].map(keyLabel).join(' / '));
      b.type = 'button';
      b.dataset.bind = action;
      b.addEventListener('click', () => {
        this.form.querySelectorAll('.keybind.waiting').forEach((x) => { x.classList.remove('waiting'); x.textContent = this.s.binds[x.dataset.bind].map(keyLabel).join(' / '); });
        this.waitingBind = action;
        b.classList.add('waiting');
        b.textContent = 'PRESSIONE UMA TECLA… (Esc cancela)';
      });
      row.append(b);
      group.append(row);
    }
  }

  captureKey(e) {
    if (!this.waitingBind || this.game.ui.currentScreen !== 'settings') return;
    e.preventDefault();
    e.stopPropagation();
    const action = this.waitingBind;
    this.waitingBind = null;
    if (e.code !== 'Escape') {
      const binds = structuredClone(this.s.binds);
      // a tecla deixa de acionar qualquer outra ação (evita conflitos)
      for (const [a, list] of Object.entries(binds)) if (a !== action) binds[a] = list.filter((k) => k !== e.code);
      for (const [a, list] of Object.entries(binds)) if (!list.length) binds[a] = DEFAULT_BINDS[a].filter((k) => k !== e.code).slice(0, 1);
      binds[action] = [e.code];
      this.apply({ binds });
    }
    this.show('controls');
  }

  // ---- mira ------------------------------------------------------------------
  buildCrosshair() {
    const wrap = el('div', 'xh-layout');
    const prev = el('div', 'xh-preview');
    const stage = el('div', `xh-stage bg-${this.xhBg}`);
    const canvas = el('canvas');
    stage.append(canvas);
    this.preview = new CrosshairView(canvas, 200);
    this.preview.setConfig(this.s.crosshair);
    prev.append(el('span', 'label', 'PRÉVIA (igual à partida)'), stage);
    const bgRow = el('div', 'segmented');
    for (const [k, label] of [['scene', 'CENA'], ['dark', 'ESCURO'], ['light', 'CLARO']]) {
      const b = el('button', k === this.xhBg ? 'active' : '', label);
      b.type = 'button';
      b.addEventListener('click', () => { this.xhBg = k; stage.className = `xh-stage bg-${k}`; bgRow.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)); });
      bgRow.append(b);
    }
    const sim = el('button', 'btn small', 'SIMULAR DISPAROS');
    sim.type = 'button';
    sim.addEventListener('click', () => this.simulateSpread());
    prev.append(bgRow, sim);

    prev.append(el('span', 'label', 'PRESETS'));
    const presets = el('div', 'xh-presets');
    for (const [id, p] of Object.entries(CROSSHAIR_PRESETS)) {
      const b = el('button', this.s.crosshairPreset === id ? 'active' : '', p.label);
      b.type = 'button';
      b.addEventListener('click', () => { const { label, ...cfg } = p; this.apply({ crosshairPreset: id, crosshair: normalizeCrosshair(cfg) }); this.show('crosshair'); });
      presets.append(b);
    }
    const custom = el('button', this.s.crosshairPreset === 'personalizada' ? 'active' : '', 'Personalizada');
    custom.type = 'button';
    custom.disabled = this.s.crosshairPreset !== 'personalizada';
    presets.append(custom);
    prev.append(presets);

    prev.append(el('span', 'label', 'CÓDIGO DA MIRA'));
    const codeRow = el('div', 'xh-code');
    const code = el('input');
    code.type = 'text';
    code.value = exportCrosshair(this.s.crosshair);
    code.setAttribute('aria-label', 'Código da mira');
    const copy = el('button', 'btn small', 'COPIAR');
    copy.type = 'button';
    copy.addEventListener('click', () => {
      code.select();
      const done = () => this.game.toast('Código da mira copiado.');
      try { navigator.clipboard.writeText(code.value).then(done, done); } catch { done(); }
    });
    const imp = el('button', 'btn small', 'IMPORTAR');
    imp.type = 'button';
    imp.addEventListener('click', () => {
      const cfg = importCrosshair(code.value);
      if (!cfg) { this.game.toast('Código inválido: confira se ele começa com OZX1 e está completo.', 'error'); return; }
      this.apply({ crosshairPreset: 'personalizada', crosshair: cfg });
      this.show('crosshair');
      this.game.toast('Mira importada.');
    });
    codeRow.append(code, copy, imp);
    prev.append(codeRow);

    const fields = el('div');
    const c = this.s.crosshair;
    const onChange = (patch) => {
      const next = normalizeCrosshair({ ...this.s.crosshair, ...patch });
      this.apply({ crosshair: next, crosshairPreset: 'personalizada' });
      this.preview.setConfig(next);
      code.value = exportCrosshair(next);
      presets.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      custom.classList.add('active'); custom.disabled = false;
    };
    const groups = [
      ['FORMA', [
        { key: 'style', label: 'Tipo de retícula', type: 'select', options: Object.entries(CROSSHAIR_STYLES) },
        { key: 'scale', label: 'Tamanho geral', type: 'range', min: 0.5, max: 2, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
        { key: 'length', label: 'Comprimento das linhas', type: 'range', min: 0, max: 30, step: 1, fmt: (v) => `${v}px` },
        { key: 'thickness', label: 'Espessura', type: 'range', min: 1, max: 8, step: 1, fmt: (v) => `${v}px` },
        { key: 'gap', label: 'Distância do centro', type: 'range', min: 0, max: 30, step: 1, fmt: (v) => `${v}px` },
      ]],
      ['COR', [
        { key: 'color', label: 'Cor', type: 'color' },
        { key: 'opacity', label: 'Opacidade', type: 'range', min: 0.1, max: 1, step: 0.05, fmt: pct },
        { key: 'outline', label: 'Contorno', type: 'check' },
        { key: 'outlineThickness', label: 'Espessura do contorno', type: 'range', min: 1, max: 3, step: 1, fmt: (v) => `${v}px` },
        { key: 'outlineColor', label: 'Cor do contorno', type: 'color' },
      ]],
      ['PONTO CENTRAL', [
        { key: 'dot', label: 'Ponto central', type: 'check' },
        { key: 'dotSize', label: 'Tamanho do ponto', type: 'range', min: 1, max: 10, step: 1, fmt: (v) => `${v}px` },
        { key: 'dotOpacity', label: 'Opacidade do ponto', type: 'range', min: 0.1, max: 1, step: 0.05, fmt: pct },
      ]],
      ['COMPORTAMENTO', [
        { key: 'moveExpand', label: 'Expandir ao se mover (dispersão real)', type: 'check' },
        { key: 'fireExpand', label: 'Expandir ao disparar (bloom real)', type: 'check' },
        { key: 'showAds', label: 'Mostrar ao mirar com mira óptica', type: 'check' },
        { key: 'showReload', label: 'Mostrar durante a recarga', type: 'check' },
      ]],
    ];
    for (const [title, list] of groups) {
      const g = el('div', 'set-group');
      g.append(el('h4', null, title));
      for (const f of list) g.append(this.buildField(f, c, onChange));
      fields.append(g);
    }
    wrap.append(prev, fields);
    return wrap;
  }

  /** Demonstra a expansão (movimento + disparos) na prévia, com o mesmo cálculo de abertura. */
  simulateSpread() {
    const c = this.s.crosshair;
    let t = 0;
    const step = () => {
      if (!this.preview || this.tab !== 'crosshair') return;
      t += 1 / 30;
      const fire = c.fireExpand ? Math.max(0, Math.sin(t * 9)) * 6 * (t < 1.4 ? 1 : 0) : 0;
      const move = c.moveExpand ? Math.min(1, t) * (t < 2 ? 8 : Math.max(0, 8 - (t - 2) * 16)) : 0;
      this.preview.setSpread(fire + move);
      this.preview.render();
      if (t < 2.6) setTimeout(step, 33);
      else { this.preview.setSpread(0); this.preview.render(); }
    };
    step();
  }

  dispose() { window.removeEventListener('keydown', this._keyCapture, true); }
}
