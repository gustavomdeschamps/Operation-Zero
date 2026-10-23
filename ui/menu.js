// Menu principal: navegação (INÍCIO, JOGAR, OPERADORES, ARSENAL, MAPAS), perfil local, estado do
// servidor, avisos e as telas de operadores, arsenal e mapas. Escolhas de operador/arma ficam no
// perfil local; dentro de uma sala online são enviadas ao servidor, que valida e aplica.
import { OPERATORS, PRIMARY_WEAPONS, SECONDARY_WEAPON, MAPS, operatorById, mapById, isValidOperator, isValidPrimary } from '../shared/catalog.js';
import { weaponById } from '../shared/weapon-rules.js';
import { GAME } from '../shared/game-config.js';
import { getMapDef } from '../shared/arena-layout.js';
import { getArenaCollision } from '../shared/arena-collision.js';
import { CMSG, MODE_LABELS, PHASE } from '../shared/protocol.js';
import { characterLibrary } from '../characters/library.js';
import { drawMapPreview } from './minimap.js';
import { SKINS, RARITIES, isSkinnableWeapon } from '../shared/skins.js';
import { skinSwatch } from '../skins-render.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Ícones simples (traço) para operadores e armas. */
const ICONS = {
  chevron: 'M4 18 L13 8 L22 18 M4 24 L13 14 L22 24',
  shield: 'M13 3 L22 6 V13 C22 18 18 22 13 24 C8 22 4 18 4 13 V6 Z',
  eye: 'M2 13 C6 6 20 6 24 13 C20 20 6 20 2 13 Z M13 9.5 A3.5 3.5 0 1 0 13 16.5 A3.5 3.5 0 1 0 13 9.5 Z',
  diamond: 'M13 2 L24 13 L13 24 L2 13 Z M13 8 L18 13 L13 18 L8 13 Z',
  rifle: 'M1 12 H18 L21 10 H25 V13 H21 L19 15 H12 L10 19 H7 L8 15 H1 Z',
  smg: 'M3 11 H19 V14 H14 L13 19 H10 L11 14 H3 Z M19 12 H25',
  pistol: 'M5 9 H21 V12 H12 L10 19 H6 L7.5 12 H5 Z',
  sniper: 'M1 13 H25 M8 10 H16 V13 M4 13 L3 17',
  smoke: 'M8 21 C4 21 3 17 6 15 C5 11 9 9 12 11 C13 7 19 7 20 11 C24 11 25 16 21 18 C21 21 18 22 16 21 Z',
};

function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 26 26');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name] || ICONS.diamond);
  svg.append(path);
  return svg;
}

/** Categorias do arsenal. Só existem itens reais e jogáveis; categorias vazias dizem isso. */
const CATEGORIES = [
  { id: 'pistol', label: 'PISTOLAS', items: ['pistol'] },
  { id: 'smg', label: 'SUBMETRALHADORAS', items: ['smg'] },
  { id: 'rifle', label: 'FUZIS', items: ['rifle'] },
  { id: 'precision', label: 'PRECISÃO', items: ['sniper'] },
  { id: 'gear', label: 'EQUIPAMENTOS', items: ['smoke'] },
];

const CATEGORY_LABELS = { rifle: 'FUZIL DE ASSALTO', smg: 'SUBMETRALHADORA', sniper: 'FUZIL DE PRECISÃO', pistol: 'PISTOLA · SECUNDÁRIA', gear: 'EQUIPAMENTO TÁTICO' };

/** Atributos exibidos: calculados dos MESMOS números usados pela simulação e pelo servidor. */
function weaponStats(def) {
  const avgKick = def.recoil.pattern.slice(0, 10).reduce((a, p) => a + p[0], 0) / Math.min(10, def.recoil.pattern.length);
  const shotsToKill = Math.ceil(GAME.player.maxHealth / def.damage);
  return [
    { key: 'damage', label: 'DANO', value: def.damage, frac: def.damage / 90, text: `${def.damage}` },
    { key: 'rate', label: 'CADÊNCIA', value: def.fireRate, frac: def.fireRate / 15, text: `${Math.round(def.fireRate * 60)} RPM` },
    { key: 'ttk', label: 'TEMPO P/ ELIMINAR', value: -((shotsToKill - 1) / def.fireRate), frac: 1 - ((shotsToKill - 1) / def.fireRate) / 0.8, text: `${Math.round(((shotsToKill - 1) / def.fireRate) * 1000)} ms` },
    { key: 'accuracy', label: 'PRECISÃO SEM MIRAR', value: -def.spread.idle, frac: 1 - def.spread.idle / 0.008, text: `${(def.spread.idle * 1000).toFixed(1)} mrad` },
    { key: 'ads', label: 'PRECISÃO MIRANDO', value: -def.spread.idle * def.spread.adsMultiplier, frac: 1 - (def.spread.idle * def.spread.adsMultiplier) / 0.003, text: `${(def.spread.idle * def.spread.adsMultiplier * 1000).toFixed(2)} mrad` },
    { key: 'mobility', label: 'PRECISÃO ANDANDO', value: -def.spread.walk, frac: 1 - def.spread.walk / 0.016, text: `${(def.spread.walk * 1000).toFixed(1)} mrad` },
    { key: 'recoil', label: 'CONTROLE DE RECUO', value: -avgKick, frac: 1 - avgKick / 1.2, text: `${avgKick.toFixed(2)}°/tiro` },
    { key: 'mag', label: 'CARREGADOR', value: def.magSize, frac: def.magSize / 40, text: `${def.magSize} / ${def.reserve}` },
    { key: 'reload', label: 'RECARGA', value: -def.reloadTime, frac: 1 - (def.reloadTime - 1) / 2.4, text: `${def.reloadTime.toFixed(2).replace('.', ',')} s` },
    { key: 'range', label: 'ALCANCE', value: def.range, frac: def.range / 250, text: `${def.range} m` },
  ];
}

const clamp01 = (v) => Math.max(0.04, Math.min(1, v));

export class MainMenu {
  constructor(game) {
    this.game = game;
    this.pane = 'home';
    this.fromLobby = false;
    this.previewOperator = game.profile.operator;
    this.previewTeam = 1;
    this.category = 'rifle';
    this.previewWeapon = game.profile.primary;
    const $ = (id) => document.getElementById(id);
    this.screen = document.querySelector('[data-screen="menu"]');
    this.el = {
      nav: document.querySelectorAll('.mainnav [data-nav]'),
      panes: document.querySelectorAll('.pane[data-pane]'),
      profileName: $('profile-name'), profileLoadout: $('profile-loadout'),
      serverChip: $('server-chip'), serverStatus: $('server-status'), homeServer: $('home-server'), homeRooms: $('home-rooms'),
      homeOpName: $('home-op-name'), homeOpRole: $('home-op-role'),
      opList: $('op-list'), opRole: $('op-role'), opName: $('op-name'), opTagline: $('op-tagline'), opKit: $('op-kit'),
      opTeam: document.querySelectorAll('#op-team [data-team]'), opSelect: $('op-select'), opStatus: $('op-status'),
      cats: $('arsenal-cats'), weaponList: $('weapon-list'), wdCat: $('wd-cat'), wdName: $('wd-name'), wdDesc: $('wd-desc'),
      wdStats: $('wd-stats'), wdCompare: $('wd-compare'), wdEquip: $('wd-equip'),
      wdSkinBlock: $('wd-skin-block'), wdSkins: $('wd-skins'), wdSkinNote: $('wd-skin-note'),
      mapGrid: $('map-grid'), muteBtn: $('btn-mute'),
    };
    document.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => { game.audio.play('uiClick'); this.show(b.dataset.nav); }));
    this.el.opTeam.forEach((b) => b.addEventListener('click', () => { this.previewTeam = Number(b.dataset.team); this.renderOperators(); }));
    this.bindKeyboard();
    this.bindHoverSounds();
    this.buildCategories();
    this.buildMaps();
    this.refreshProfile();
  }

  // ---- navegação --------------------------------------------------------------
  /** Mostra o menu (se preciso) na aba pedida. */
  show(pane = this.pane) {
    if (this.fromLobby && pane !== 'operators' && pane !== 'arsenal') pane = 'operators';
    this.pane = pane;
    if (this.game.ui.currentScreen !== 'menu') this.game.ui.showScreen('menu');
    this.el.nav.forEach((b) => {
      const on = b.dataset.nav === pane;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    this.el.panes.forEach((p) => p.classList.toggle('visible', p.dataset.pane === pane));
    const viewer = pane === 'operators' || pane === 'arsenal';
    this.screen.classList.toggle('viewer-mode', viewer);
    this.game.studio.active = viewer;
    if (pane === 'operators') this.renderOperators();
    if (pane === 'arsenal') this.renderArsenal();
    if (pane === 'maps') this.renderMaps();
    if (pane === 'shop') this.game.shop.enter();
    if (pane === 'play') this.game.onlineMenu.enterPlayPane();
    else this.game.onlineMenu.leavePlayPane();
    if (pane === 'home') this.refreshServer();
  }

  get visible() { return this.game.ui.currentScreen === 'menu'; }

  /** Numa sala online com a partida em andamento (no lobby a troca de kit é imediata). */
  get inMatch() { return !!this.game.net && this.game.net.phase !== PHASE.LOBBY; }

  /** Abre OPERADORES/ARSENAL de dentro do lobby (com botão de volta). */
  openFromLobby(pane) {
    this.fromLobby = true;
    this.screen.classList.add('from-lobby');
    this.show(pane);
  }

  backToLobby() {
    this.exitLobbyOverlay();
    this.game.ui.showScreen('lobby');
  }

  /** Encerra o modo "menu aberto pelo lobby" (a partida começou ou a sala foi deixada). */
  exitLobbyOverlay() {
    if (!this.fromLobby) return;
    this.fromLobby = false;
    this.screen.classList.remove('from-lobby');
    this.game.studio.active = false;
  }

  bindKeyboard() {
    const nav = [...this.el.nav];
    nav.forEach((b, i) => b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const n = nav[(i + (e.key === 'ArrowRight' ? 1 : nav.length - 1)) % nav.length];
      n.focus();
    }));
    window.addEventListener('keydown', (e) => {
      if (!this.visible || e.code !== 'Escape' || e.defaultPrevented) return;
      if (this.fromLobby) this.backToLobby();
      else if (this.pane !== 'home') this.show('home');
    });
    // setas ↑/↓ percorrem listas de operadores e armas
    for (const list of [this.el.opList, this.el.weaponList]) {
      list.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const items = [...list.querySelectorAll('button:not([disabled])')];
        const i = items.indexOf(document.activeElement);
        if (i < 0) return;
        e.preventDefault();
        const n = items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
        n.focus(); n.click();
      });
    }
  }

  bindHoverSounds() {
    let last = 0;
    this.screen.addEventListener('pointerover', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled || b.contains(e.relatedTarget)) return;
      const now = performance.now();
      if (now - last < 60) return;
      last = now;
      this.game.audio.play('uiHover');
    });
  }

  // ---- perfil -------------------------------------------------------------------
  refreshProfile() {
    const p = this.game.profile;
    const op = operatorById(p.operator);
    const w = weaponById(p.primary);
    this.el.profileName.textContent = p.name || 'RECRUTA';
    this.el.profileLoadout.textContent = `${op.name} · ${w.name}`;
    this.el.homeOpName.textContent = op.name;
    this.el.homeOpRole.textContent = op.role;
    const lobbyLoadout = document.getElementById('lobby-loadout');
    if (lobbyLoadout) lobbyLoadout.textContent = `${op.name} · ${w.name}`;
  }

  /** Aplica operador/arma ao perfil; numa sala online, pede ao servidor (que valida). */
  setLoadout({ operator = this.game.profile.operator, primary = this.game.profile.primary }) {
    if (!isValidOperator(operator) || !isValidPrimary(primary)) return;
    const g = this.game;
    g.profile.operator = operator;
    g.profile.primary = primary;
    g.saveProfile();
    this.refreshProfile();
    g.onProfileLoadout();
    if (g.net && g.net.room) g.net.room.send(CMSG.LOADOUT, { operator, primary });
  }

  // ---- estado do servidor ------------------------------------------------------------
  async refreshServer() {
    const conn = this.game.onlineMenu.conn;
    const chip = this.el.serverChip;
    try {
      await conn.resolveServer();
      const rooms = await conn.listRooms();
      chip.className = 'server-chip ok';
      this.el.serverStatus.textContent = 'ONLINE';
      if (this.game.account.status !== 'ready') this.game.account.ensure(this.game.profile.name);
      this.el.homeServer.textContent = 'DISPONÍVEL';
      const players = rooms.reduce((a, r) => a + r.players, 0);
      this.el.homeRooms.textContent = rooms.length
        ? `${rooms.length} partida${rooms.length > 1 ? 's' : ''} pública${rooms.length > 1 ? 's' : ''} · ${players} jogador${players === 1 ? '' : 'es'} em sala.`
        : 'Servidor no ar. Nenhuma partida pública agora — use JOGAR para abrir uma.';
    } catch {
      chip.className = 'server-chip down';
      this.el.serverStatus.textContent = 'OFFLINE';
      this.el.homeServer.textContent = 'INDISPONÍVEL';
      this.el.homeRooms.textContent = 'Servidor multiplayer não encontrado. O TREINAMENTO funciona offline normalmente.';
    }
  }

  // ---- OPERADORES ------------------------------------------------------------------------
  renderOperators() {
    const g = this.game;
    const current = g.profile.operator;
    const preview = this.previewOperator;
    this.el.opList.replaceChildren(...OPERATORS.map((op) => {
      const li = el('li');
      const b = el('button', `op-item${op.id === preview ? ' active' : ''}`);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(op.id === preview));
      const sym = el('span', 'sym'); sym.append(icon(op.symbol));
      const txt = el('span'); txt.append(el('b', null, op.name), el('small', null, op.role));
      b.append(sym, txt, el('span', 'badge', op.id === current ? 'EM USO' : ''));
      b.addEventListener('click', () => { this.previewOperator = op.id; g.audio.play('uiClick'); this.renderOperators(); });
      li.append(b);
      return li;
    }));
    const op = operatorById(preview);
    this.el.opRole.textContent = op.role;
    this.el.opName.textContent = op.name;
    this.el.opTagline.textContent = op.tagline;
    this.el.opKit.replaceChildren(...op.kit.map((k) => el('li', null, k)));
    this.el.opTeam.forEach((b) => b.classList.toggle('active', Number(b.dataset.team) === this.previewTeam));
    const selected = preview === current;
    this.el.opSelect.textContent = selected ? 'OPERADOR EM USO' : 'SELECIONAR OPERADOR';
    this.el.opSelect.disabled = selected;
    // modelo 3D: carrega sob demanda e mostra o progresso
    const shown = g.studio.showOperator(preview, this.previewTeam);
    if (shown) this.el.opStatus.textContent = '';
    else if (characterLibrary.failed.has(preview)) this.el.opStatus.textContent = 'Falha ao carregar o modelo 3D deste operador. Verifique a conexão e recarregue a página.';
    else {
      this.el.opStatus.textContent = 'Carregando modelo 3D…';
      Promise.all([characterLibrary.loadClips(), characterLibrary.loadOperator(preview)])
        .then(() => { if (this.pane === 'operators' && this.previewOperator === preview) this.renderOperators(); })
        .catch(() => { if (this.pane === 'operators') this.renderOperators(); });
    }
  }

  selectOperator() {
    this.setLoadout({ operator: this.previewOperator });
    this.game.audio.play('uiConfirm');
    const op = operatorById(this.previewOperator);
    this.game.toast(this.inMatch ? `${op.name} selecionado. O servidor aplica a troca na próxima vez que você surgir.` : `${op.name} selecionado.`);
    this.renderOperators();
  }

  // ---- ARSENAL --------------------------------------------------------------------------
  buildCategories() {
    this.el.cats.replaceChildren(...CATEGORIES.map((c) => {
      const b = el('button', '', c.label);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.dataset.cat = c.id;
      b.addEventListener('click', () => {
        this.category = c.id;
        if (c.items[0]) this.previewWeapon = c.items[0];
        this.game.audio.play('uiClick');
        this.renderArsenal();
      });
      return b;
    }));
  }

  renderArsenal() {
    const g = this.game;
    const cat = CATEGORIES.find((c) => c.id === this.category) || CATEGORIES[2];
    this.el.cats.querySelectorAll('[data-cat]').forEach((b) => {
      b.classList.toggle('active', b.dataset.cat === cat.id);
      b.setAttribute('aria-selected', String(b.dataset.cat === cat.id));
    });
    if (!cat.items.length) {
      const li = el('li', 'empty muted small', cat.empty);
      this.el.weaponList.replaceChildren(li);
      this.el.wdCat.textContent = cat.label;
      this.el.wdName.textContent = '—';
      this.el.wdDesc.textContent = cat.empty;
      this.el.wdStats.replaceChildren();
      this.el.wdCompare.textContent = '';
      this.el.wdEquip.disabled = true;
      this.el.wdEquip.textContent = 'INDISPONÍVEL';
      this.el.wdSkinBlock.hidden = true;
      g.studio.showNothing();
      return;
    }
    if (!cat.items.includes(this.previewWeapon)) this.previewWeapon = cat.items[0];
    this.el.weaponList.replaceChildren(...cat.items.map((id) => {
      const li = el('li');
      const b = el('button', `weapon-item${id === this.previewWeapon ? ' active' : ''}`);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(id === this.previewWeapon));
      const sym = el('span', 'sym'); sym.append(icon(id === 'smoke' ? 'smoke' : id));
      const txt = el('span');
      if (id === 'smoke') txt.append(el('b', null, GAME.abilities.smoke.name), el('small', null, 'HABILIDADE · TECLA E'));
      else { const d = weaponById(id); txt.append(el('b', null, d.name), el('small', null, CATEGORY_LABELS[d.category])); }
      b.append(sym, txt, el('span', 'badge', this.equippedLabel(id)));
      b.addEventListener('click', () => { this.previewWeapon = id; g.audio.play('uiClick'); this.renderArsenal(); });
      li.append(b);
      return li;
    }));
    this.renderWeaponDetail(this.previewWeapon);
  }

  equippedLabel(id) {
    if (id === 'smoke' || id === SECONDARY_WEAPON) return 'SEMPRE';
    return this.game.profile.primary === id ? 'EQUIPADA' : '';
  }

  renderWeaponDetail(id) {
    const g = this.game;
    if (id === 'smoke') {
      const s = GAME.abilities.smoke;
      this.el.wdCat.textContent = CATEGORY_LABELS.gear;
      this.el.wdName.textContent = s.name;
      this.el.wdDesc.textContent = `Lança uma nuvem que bloqueia a visão por ${s.duration} s (raio de ${s.radius} m, alcance de ${s.maxRange} m). Recarga de ${s.cooldown} s. Os disparos atravessam a fumaça; a visão, não.`;
      this.el.wdStats.replaceChildren();
      this.el.wdCompare.textContent = 'Incluída em todos os kits. Não há modelo 3D de inspeção para a granada.';
      this.el.wdEquip.disabled = true;
      this.el.wdEquip.textContent = 'INCLUÍDA EM TODOS OS KITS';
      this.el.wdSkinBlock.hidden = true;
      g.studio.showNothing();
      return;
    }
    const def = weaponById(id);
    this.el.wdCat.textContent = CATEGORY_LABELS[def.category];
    this.el.wdName.textContent = def.name;
    this.el.wdDesc.textContent = def.description;
    // comparação: com a arma do mesmo slot que está equipada
    const ref = def.slot === 1 && g.profile.primary !== id ? weaponById(g.profile.primary) : null;
    const refStats = ref ? weaponStats(ref) : null;
    const stats = weaponStats(def);
    this.el.wdStats.replaceChildren(...stats.map((s, i) => {
      const row = el('div', 'stat-row');
      const bar = el('div', 'bar');
      const fill = el('i'); fill.style.width = `${clamp01(s.frac) * 100}%`;
      bar.append(fill);
      if (refStats) { const mark = el('s'); mark.style.left = `calc(${clamp01(refStats[i].frac) * 100}% - 1px)`; mark.title = `${ref.name}: ${refStats[i].text}`; bar.append(mark); }
      row.append(el('span', null, s.label), bar, el('b', null, s.text));
      return row;
    }));
    if (ref) {
      const better = [], worse = [];
      stats.forEach((s, i) => { if (s.value > refStats[i].value) better.push(s.label.toLowerCase()); else if (s.value < refStats[i].value) worse.push(s.label.toLowerCase()); });
      this.el.wdCompare.textContent = `Marcas âmbar = ${ref.name} (equipada). Melhor em: ${better.join(', ') || '—'}. Pior em: ${worse.join(', ') || '—'}.`;
    } else if (def.slot === 2) this.el.wdCompare.textContent = 'A pistola é a arma secundária de todos os kits (tecla 2).';
    else this.el.wdCompare.textContent = 'Arma primária equipada no seu kit (tecla 1).';
    if (def.slot === 2) { this.el.wdEquip.disabled = true; this.el.wdEquip.textContent = 'SEMPRE EQUIPADA (SLOT 2)'; }
    else if (g.profile.primary === id) { this.el.wdEquip.disabled = true; this.el.wdEquip.textContent = 'EQUIPADA (SLOT 1)'; }
    else { this.el.wdEquip.disabled = false; this.el.wdEquip.textContent = 'EQUIPAR COMO PRIMÁRIA'; }
    this.previewSkin = this.previewSkinFor === id ? this.previewSkin : null;
    this.previewSkinFor = id;
    this.renderSkins(def);
  }

  /**
   * Acabamentos da arma: o de fábrica, os possuídos (equipáveis) e os demais (apenas prévia).
   * A posse vem da conta no servidor; sem conexão, só a prévia funciona.
   */
  renderSkins(def) {
    const g = this.game;
    const acc = g.account;
    const block = this.el.wdSkinBlock;
    if (!def || !isSkinnableWeapon(def.id)) { block.hidden = true; return; }
    block.hidden = false;
    const equipped = acc.equipped()[def.id] || '';
    const shown = this.previewSkin ?? equipped;
    const opts = [{ id: '', name: 'FÁBRICA', rarity: null }, ...SKINS];
    this.el.wdSkins.replaceChildren(...opts.map((s) => {
      const owned = !s.id || acc.owns(def.id, s.id);
      const b = el('button', `skin-opt${s.id === shown ? ' active' : ''}${owned ? '' : ' locked'}${s.id === equipped ? ' equipped' : ''}`);
      b.type = 'button';
      b.title = `${s.name}${s.rarity ? ` · ${RARITIES[s.rarity].label}` : ''}${owned ? (s.id === equipped ? ' · EQUIPADO' : '') : ' · não possuído (prévia)'}`;
      if (s.rarity) b.style.setProperty('--rc', RARITIES[s.rarity].color);
      if (s.id) {
        const c = el('canvas'); c.width = c.height = 36;
        const src = skinSwatch(s.id);
        if (src) c.getContext('2d').drawImage(src, 0, 0, 96, 96, 0, 0, 36, 36);
        b.append(c);
      } else b.append(el('span', 'factory', 'F'));
      b.setAttribute('aria-label', b.title);
      b.addEventListener('click', () => this.pickSkin(def, s.id, owned));
      return b;
    }));
    const sk = SKINS.find((s) => s.id === shown);
    this.el.wdSkinNote.textContent = sk
      ? `${sk.name} — ${sk.description}${acc.owns(def.id, sk.id) ? (sk.id === equipped ? ' (equipado)' : ' Clique de novo para equipar.') : ' Não possuído: disponível nas caixas da LOJA.'}`
      : acc.status === 'ready' ? 'Acabamento de fábrica. Acabamentos são apenas visuais.' : 'Conecte-se ao servidor para usar seus acabamentos.';
    g.studio.showWeapon(def.id, shown);
  }

  async pickSkin(def, skinId, owned) {
    const g = this.game;
    const equipped = g.account.equipped()[def.id] || '';
    if (owned && skinId === (this.previewSkin ?? equipped) && skinId !== equipped) {
      try { await g.account.equip(def.id, skinId || null); g.audio.play('uiConfirm'); g.toast(`Acabamento equipado em ${def.name}.`); } catch (err) { g.toast(err.message, 'warn'); }
      this.previewSkin = null;
    } else this.previewSkin = skinId;
    g.audio.play('uiClick');
    this.renderSkins(def);
  }

  /** Conta atualizada (saldo, inventário, equipados). */
  onAccountChange() {
    if (this.visible && this.pane === 'arsenal' && this.previewWeapon !== 'smoke') this.renderSkins(weaponById(this.previewWeapon));
  }

  equipWeapon() {
    const id = this.previewWeapon;
    if (!PRIMARY_WEAPONS.includes(id)) return;
    this.setLoadout({ primary: id });
    this.game.audio.play('uiConfirm');
    const name = weaponById(id).name;
    this.game.toast(this.inMatch ? `${name} equipada. Entra em uso no seu próximo surgimento.` : `${name} equipada como arma primária.`);
    this.renderArsenal();
  }

  // ---- MAPAS -------------------------------------------------------------------------------
  buildMaps() {
    this.mapCards = new Map();
    this.el.mapGrid.replaceChildren(...MAPS.map((m) => {
      const card = el('article', 'map-card');
      const canvas = el('canvas');
      canvas.setAttribute('aria-label', `Planta de ${m.name}`);
      const info = el('div', 'info');
      const def = getMapDef(m.id);
      const zones = el('div', 'zones');
      def.zones.forEach((z) => zones.append(el('span', null, z.name)));
      const modes = m.modes.map((k) => (k === 'training' ? 'TREINAMENTO' : MODE_LABELS[k] || k)).join(' · ');
      const actions = el('div', 'actions');
      const view = el('button', 'btn small', 'VER MAPA');
      view.type = 'button';
      view.addEventListener('click', () => this.viewMap(m.id));
      const play = el('button', 'btn small primary', 'JOGAR NESTE MAPA');
      play.type = 'button';
      play.addEventListener('click', () => this.playOnMap(m.id));
      actions.append(view, play);
      info.append(el('span', 'label', m.subtitle.toUpperCase()), el('h3', null, m.name), el('p', null, m.description), el('span', 'label', `MODOS: ${modes}`), zones, actions);
      card.append(canvas, info);
      this.mapCards.set(m.id, { card, canvas, drawn: false });
      return card;
    }));
  }

  renderMaps() {
    for (const [id, c] of this.mapCards) {
      c.card.classList.toggle('active', this.game.map.id === id);
      if (!c.drawn) {
        // a planta é desenhada a partir da colisão real do mapa (mesma do jogo e do servidor)
        requestAnimationFrame(() => { drawMapPreview(c.canvas, getArenaCollision(id), getMapDef(id)); });
        c.drawn = true;
      }
    }
  }

  /** Coloca o mapa escolhido no fundo do menu (mesma geometria da partida). */
  viewMap(id) {
    this.game.setMap(id, { menu: true });
    this.game.audio.play('uiConfirm');
    this.game.toast(`${mapById(id).name} carregado no fundo do menu.`);
    this.renderMaps();
  }

  playOnMap(id) {
    const om = this.game.onlineMenu;
    om.setMap(id);
    this.game.profile.map = id;
    this.game.saveProfile();
    this.show('play');
    const m = mapById(id);
    om.setMessage(m.modes.includes('training')
      ? `${m.name} selecionado para partidas online. O treinamento offline também acontece aqui.`
      : `${m.name} selecionado para partidas online (busca pública e sala personalizada). O treinamento offline usa a Foundry-7.`, 'ok');
  }
}
