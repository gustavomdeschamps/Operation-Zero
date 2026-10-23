// Interface: HUD, telas e feedback de combate.
// Os elementos são consultados uma única vez e só são atualizados quando o valor muda.
// A mira é desenhada por crosshair.js — a mesma função usada pela prévia das configurações.
import { CONFIG } from './config.js';
import { formatTime, clamp } from './utils.js';
import { CrosshairView } from './crosshair.js';

const STATE_LABELS = {
  idle: 'PARADO', walk: 'ANDANDO', run: 'CORRENDO', air: 'NO AR', crouch: 'AGACHADO', 'crouch-move': 'AGACHADO',
};

export class UI {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('hud'),
      kills: $('hud-kills'), target: $('hud-target'), timer: $('hud-timer'), zone: $('hud-zone'), arena: $('hud-arena-name'),
      objective: $('hud-objective'),
      health: $('hud-health'), healthFill: $('hud-health-fill'), healthBlock: $('health-block'), state: $('hud-state'),
      mag: $('hud-mag'), reserve: $('hud-reserve'), weapon: $('hud-weapon'), reloadFill: $('hud-reload-fill'), ammoBlock: $('ammo-block'),
      slots: document.querySelectorAll('#weapon-slots [data-slot]'),
      abilityCard: $('ability-card'), abilityCd: $('ability-cd'), abilityTimer: $('ability-timer'),
      crosshair: $('crosshair'), hitmarker: $('hitmarker'), centerMsg: $('center-message'), killfeed: $('killfeed'),
      reloadIndicator: $('reload-indicator'),
      vignette: $('damage-vignette'), indicators: $('damage-indicators'), smoke: $('smoke-overlay'),
      fps: $('fps-counter'),
      lockPrompt: $('lock-prompt'), lockText: $('lock-text'),
      loadingText: $('loading-text'), loadingBar: $('loading-bar'),
      errorText: $('error-text'),
      endTitle: $('end-title'), endSubtitle: $('end-subtitle'), endStats: $('end-stats'), endBadge: $('end-badge'),
      weaponPanel: document.querySelector('.weapon-panel'), toast: $('toast'),
    };
    this.crosshair = new CrosshairView(this.el.crosshair, 160);
    this.toastTimer = 0;
    this.screens = {};
    document.querySelectorAll('.screen').forEach((s) => { this.screens[s.dataset.screen] = s; });
    this.cache = {};
    this.messageT = 0;
    this.hitT = 0;
    this.vignetteT = 0;
    this.feed = [];
    this.indicators = [];
    for (let i = 0; i < 4; i++) {
      const d = document.createElement('div');
      d.className = 'dmg-indicator';
      this.el.indicators.appendChild(d);
      this.indicators.push({ el: d, t: 0 });
    }
    this.indicatorCursor = 0;
  }

  // ---- telas -------------------------------------------------------------
  showScreen(name) {
    for (const [key, el] of Object.entries(this.screens)) el.classList.toggle('visible', key === name);
    this.currentScreen = name;
  }

  showHUD(visible) { this.el.hud.classList.toggle('hidden', !visible); }

  setLoading(text, progress) {
    this.el.loadingText.textContent = text;
    this.el.loadingBar.style.transform = `scaleX(${clamp(progress, 0, 1)})`;
  }

  showError(message) {
    this.el.errorText.textContent = message;
    this.showScreen('error');
  }

  showLockPrompt(visible, text = 'CLIQUE PARA RETOMAR') {
    this.el.lockPrompt.classList.toggle('visible', visible);
    this.el.lockText.textContent = text;
  }

  showEnd({ victory, kills, target, time, shots, hits, headshots, damageTaken = 0 }) {
    const acc = shots ? Math.round((hits / shots) * 100) : 0;
    const hsr = hits ? Math.round((headshots / hits) * 100) : 0;
    this.el.endBadge.textContent = victory ? 'CONCLUÍDO' : 'FALHA';
    this.el.endBadge.className = `end-badge ${victory ? 'win' : 'lose'}`;
    this.el.endTitle.textContent = victory ? 'TREINAMENTO CONCLUÍDO' : 'OPERADOR ABATIDO';
    this.el.endSubtitle.textContent = victory
      ? `Todos os ${target} alvos foram neutralizados.`
      : 'Os bots revidaram. Use cobertura e a névoa para avançar.';
    const rows = [
      ['ELIMINAÇÕES', `${kills} / ${target}`],
      ['TEMPO', formatTime(time)],
      ['PRECISÃO', `${acc}%`],
      ['TIROS NA CABEÇA', `${hsr}%`],
      ['DISPAROS', String(shots)],
      ['DANO RECEBIDO', String(Math.round(damageTaken))],
    ];
    this.el.endStats.replaceChildren(...rows.map(([k, v]) => {
      const row = document.createElement('div');
      row.className = 'stat';
      const a = document.createElement('span'); a.className = 'stat-label'; a.textContent = k;
      const b = document.createElement('span'); b.className = 'stat-value'; b.textContent = v;
      row.append(a, b);
      return row;
    }));
    this.showScreen('end');
  }

  // ---- HUD ---------------------------------------------------------------
  _set(key, el, value, fn = (e, v) => { e.textContent = v; }) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    fn(el, value);
  }

  setKills(kills, target) {
    this._set('kills', this.el.kills, String(kills).padStart(2, '0'));
    this._set('target', this.el.target, String(target));
  }

  setTimer(seconds) { this._set('timer', this.el.timer, formatTime(seconds)); }

  setZone(name) { this._set('zone', this.el.zone, name); }

  setObjective(text) { this._set('objective', this.el.objective, text); }

  setHealth(hp) {
    const v = Math.ceil(hp);
    this._set('health', this.el.health, String(v));
    this._set('healthFill', this.el.healthFill, v, (e, val) => { e.style.transform = `scaleX(${val / CONFIG.player.maxHealth})`; });
    this._set('healthLow', this.el.healthBlock, v <= 35, (e, low) => e.classList.toggle('low', low));
  }

  setMovementState(state) { this._set('state', this.el.state, STATE_LABELS[state] || state); }

  setAmmo({ mag, reserve, magSize, name, slot }) {
    this._set('mag', this.el.mag, String(mag));
    this._set('reserve', this.el.reserve, String(reserve));
    this._set('weapon', this.el.weapon, name, (e, v) => {
      e.textContent = v;
      const panel = this.el.weaponPanel;
      panel.classList.remove('swap');
      void panel.offsetWidth;          // reinicia a animação de troca
      panel.classList.add('swap');
    });
    this._set('lowAmmo', this.el.ammoBlock, mag <= Math.ceil(magSize * 0.25), (e, low) => e.classList.toggle('low', low));
    this._set('slot', this.el.slots, slot, (els, s) => els.forEach((e) => e.classList.toggle('active', Number(e.dataset.slot) === s)));
  }

  setReload(progress, active) {
    this._set('reloadActive', this.el.reloadIndicator, active, (e, a) => e.classList.toggle('visible', a));
    const q = Math.round(progress * 100) / 100;
    this._set('reloadProgress', this.el.reloadFill, q, (e, p) => { e.style.transform = `scaleX(${p})`; });
  }

  setAbility({ ready, cooldown, cooldownFrac, activeRemaining }) {
    this._set('abilityReady', this.el.abilityCard, ready, (e, r) => e.classList.toggle('ready', r));
    const frac = Math.round(cooldownFrac * 200) / 200;
    this._set('abilityFrac', this.el.abilityCd, frac, (e, f) => e.style.setProperty('--cd', `${f * 360}deg`));
    const label = activeRemaining > 0 ? `${activeRemaining.toFixed(1)}s` : cooldown > 0 ? `${Math.ceil(cooldown)}` : '';
    this._set('abilityTimer', this.el.abilityTimer, label);
  }

  /** Configuração da retícula (já normalizada por settings.js). */
  setCrosshairConfig(cfg) { this.crosshairCfg = cfg; this.crosshair.setConfig(cfg); }

  /** spreadPx = abertura dinâmica (px de tela) vinda da dispersão real da arma. */
  setCrosshairSpread(spreadPx) {
    const scale = this.crosshairCfg ? this.crosshairCfg.scale : 1;
    this.crosshair.setSpread(clamp(spreadPx, 0, 90) / scale);
    this.crosshair.render();
  }

  setCrosshairVisible(v) { this.crosshair.setVisible(v); }

  /** Luneta do fuzil de precisão (sobreposição em tela cheia). */
  setScope(on) {
    if (this._scope === on) return;
    this._scope = on;
    (this._scopeEl || (this._scopeEl = document.getElementById('scope'))).classList.toggle('hidden', !on);
  }

  /** Feedback de habilidade indisponível (cartão treme). */
  abilityDenied() {
    const e = this.el.abilityCard;
    e.classList.remove('denied');
    void e.offsetWidth;
    e.classList.add('denied');
  }

  /** Aviso curto na parte de baixo da tela (menus e HUD). kind: '' | 'warn' | 'error'. */
  toast(text, kind = '', seconds = 2.6) {
    const e = this.el.toast;
    e.textContent = text;
    e.className = `visible ${kind}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => e.classList.remove('visible'), seconds * 1000);
  }

  hitmarker(kind) {
    const e = this.el.hitmarker;
    e.classList.remove('show', 'head', 'kill');
    void e.offsetWidth; // reinicia a animação CSS
    if (kind === 'head') e.classList.add('head');
    if (kind === 'kill') e.classList.add('kill');
    e.classList.add('show');
  }

  killfeed(text, kind = 'kill') {
    const item = document.createElement('div');
    item.className = `feed-item ${kind}`;
    item.textContent = text;
    this.el.killfeed.prepend(item);
    this.feed.push({ el: item, t: 3.2 });
    while (this.feed.length > 5) this.feed.shift().el.remove();
  }

  message(text, kind = 'info', duration = 1.8) {
    const e = this.el.centerMsg;
    e.textContent = text;
    e.className = `visible ${kind}`;
    this.messageT = duration;
  }

  /** Registra dano: vinheta + indicador direcional que acompanha a origem do disparo. */
  damage(source, amount) {
    this.vignetteT = Math.min(1, this.vignetteT + amount / 30 + 0.25);
    const ind = this.indicators[this.indicatorCursor];
    this.indicatorCursor = (this.indicatorCursor + 1) % this.indicators.length;
    ind.t = 1.4;
    ind.source = source ? { x: source.x, y: source.y, z: source.z } : null;
    ind.el.style.opacity = source ? '1' : '0';
  }

  setSmoke(amount) {
    const v = Math.round(amount * 50) / 50;
    this._set('smoke', this.el.smoke, v, (e, val) => { e.style.opacity = String(val); });
  }

  setFps(fps) { this._set('fps', this.el.fps, `${fps} FPS`); }

  setFpsVisible(v) { this.el.fps.classList.toggle('hidden', !v); }

  /** Temporizadores visuais (avançam apenas com o jogo ativo). */
  update(dt, angleOf = null) {
    if (this.messageT > 0) {
      this.messageT -= dt;
      if (this.messageT <= 0) this.el.centerMsg.classList.remove('visible');
    }
    for (let i = this.feed.length - 1; i >= 0; i--) {
      const f = this.feed[i];
      f.t -= dt;
      if (f.t < 0.4) f.el.classList.add('fading');
      if (f.t <= 0) { f.el.remove(); this.feed.splice(i, 1); }
    }
    if (this.vignetteT > 0) {
      this.vignetteT = Math.max(0, this.vignetteT - dt * 1.4);
      this.el.vignette.style.opacity = String(Math.round(this.vignetteT * 100) / 100);
    }
    for (const ind of this.indicators) {
      if (ind.t <= 0) continue;
      ind.t -= dt;
      ind.el.style.opacity = String(clamp(ind.t / 0.6, 0, 1));
      if (ind.source && angleOf) ind.el.style.setProperty('--angle', `${angleOf(ind.source)}rad`);
    }
  }

  reset() {
    this.feed.forEach((f) => f.el.remove());
    this.feed.length = 0;
    this.messageT = 0;
    this.el.centerMsg.classList.remove('visible');
    this.vignetteT = 0;
    this.el.vignette.style.opacity = '0';
    for (const ind of this.indicators) { ind.t = 0; ind.el.style.opacity = '0'; }
    this.el.hitmarker.classList.remove('show', 'head', 'kill');
    this.setSmoke(0);
    this.cache = {};
  }
}
