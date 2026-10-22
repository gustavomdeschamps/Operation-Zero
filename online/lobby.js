// Menus do modo online: nome, modo, busca pública, sala privada, entrada por código,
// lista de partidas, lobby da sala e resultado. Toda operação de rede tem retorno visível.
import { OnlineConnection, describeError } from './connection.js';
import { sanitizeName, MODE_LABELS, TEAM, TEAM_LABELS, PHASE, REASON_LABELS, normalizeRoomCode } from '../shared/protocol.js';
import { formatTime } from '../utils.js';

const NAME_KEY = 'oz-player-name';
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

export class OnlineMenu {
  constructor(game) {
    this.game = game;
    this.ui = game.ui;
    this.conn = new OnlineConnection();
    this.mode = 'tdm';
    this.busy = false;
    this.cancelled = false;
    const $ = (id) => document.getElementById(id);
    this.el = {
      name: $('net-name'), code: $('net-code'), message: $('net-message'), server: $('net-server'), rooms: $('net-rooms'),
      modeButtons: document.querySelectorAll('#net-mode [data-mode]'),
      searchTitle: $('search-title'), searchText: $('search-text'),
      lobbyMode: $('lobby-mode'), lobbyName: $('lobby-name'), lobbyCode: $('lobby-code'), lobbyCount: $('lobby-count'), lobbyPing: $('lobby-ping'),
      team1: $('lobby-team-1'), team2: $('lobby-team-2'), lobbyStatus: $('lobby-status'), lobbyStart: $('lobby-start'), lobbyReady: $('lobby-ready'),
      endBadge: $('net-end-badge'), endTitle: $('net-end-title'), endSubtitle: $('net-end-subtitle'), end1: $('net-end-1'), end2: $('net-end-2'),
      endRows: $('net-end-rows'), endReturn: $('net-end-return'),
    };
    try { this.el.name.value = localStorage.getItem(NAME_KEY) || ''; } catch { /* sem armazenamento */ }
    this.el.modeButtons.forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.mode)));
    this.el.code.addEventListener('input', () => { this.el.code.value = normalizeRoomCode(this.el.code.value).slice(0, 5); });
    this.el.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.joinCode(); });
    this.lastLobbyKey = '';
  }

  setMode(mode) {
    this.mode = mode;
    this.el.modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  }

  setMessage(text, kind = '') {
    this.el.message.textContent = text;
    this.el.message.className = `net-message ${kind}`;
  }

  open(message = '', kind = '') {
    this.ui.showScreen('online');
    this.setMessage(message, kind);
    this.checkServer();
    this.refreshRooms();
    clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => { if (this.ui.currentScreen === 'online') this.refreshRooms(); }, 4000);
  }

  close() { clearInterval(this.refreshTimer); }

  async checkServer() {
    this.el.server.textContent = 'Servidor: procurando…';
    try {
      const url = await this.conn.resolveServer();
      this.el.server.textContent = `Servidor: ${url} · conectado`;
    } catch (err) {
      this.el.server.textContent = `Servidor: indisponível — ${err.message}`;
    }
  }

  readName() {
    const name = sanitizeName(this.el.name.value);
    if (!name) { this.setMessage('Informe um nome de 2 a 16 caracteres (letras, números, espaço, ponto, hífen ou sublinhado).', 'error'); this.el.name.focus(); return null; }
    this.el.name.value = name;
    try { localStorage.setItem(NAME_KEY, name); } catch { /* ignora */ }
    return name;
  }

  async refreshRooms() {
    try {
      const rooms = await this.conn.listRooms();
      this.renderRooms(rooms);
    } catch {
      this.el.rooms.replaceChildren(el('li', 'empty', 'Lista indisponível: servidor fora do ar.'));
    }
  }

  renderRooms(rooms) {
    if (!rooms.length) { this.el.rooms.replaceChildren(el('li', 'empty', 'Nenhuma partida pública no momento. Use "Buscar partida" para criar uma.')); return; }
    this.el.rooms.replaceChildren(...rooms.map((r) => {
      const li = el('li');
      const b = el('button', 'room-item');
      b.type = 'button';
      b.disabled = !r.joinable;
      b.append(el('span', 'rn', r.name), el('span', 'rp', `${r.players}/${r.maxPlayers}`),
        el('span', 'rm', MODE_LABELS[r.mode] || r.mode), el('span', 'rs', r.joinable ? (r.phase === PHASE.LOBBY ? 'NO LOBBY' : 'EM ANDAMENTO') : 'INDISPONÍVEL'));
      b.addEventListener('click', () => this.joinCode(r.code));
      li.append(b);
      return li;
    }));
  }

  /** Executa uma operação de entrada com tela de espera, cancelamento e erro claro. */
  async run(title, op) {
    if (this.busy) return;
    const name = this.readName();
    if (!name) return;
    this.busy = true;
    this.cancelled = false;
    this.el.searchTitle.textContent = title;
    this.el.searchText.textContent = 'Conectando ao servidor…';
    this.ui.showScreen('searching');
    try {
      const room = await op(name);
      if (this.cancelled || !room) { if (room) await this.conn.leave(); return; }
      this.close();
      this.game.beginOnline(this.conn, room);
    } catch (err) {
      if (!this.cancelled) this.open(describeError(err), 'error');
    } finally {
      this.busy = false;
    }
  }

  quick() { return this.run('PROCURANDO PARTIDA', (name) => { this.el.searchText.textContent = `Buscando ${MODE_LABELS[this.mode]}…`; return this.conn.quickMatch(name, this.mode, () => this.cancelled); }); }

  create() { return this.run('CRIANDO SALA', (name) => this.conn.createRoom(name, { mode: this.mode, maxPlayers: 10 })); }

  joinCode(code) {
    const c = code || this.el.code.value;
    return this.run('ENTRANDO NA SALA', (name) => { this.el.searchText.textContent = `Sala ${normalizeRoomCode(c)}…`; return this.conn.joinByCode(name, c); });
  }

  cancel() {
    this.cancelled = true;
    this.open('Busca cancelada.');
  }

  // ---- lobby da sala --------------------------------------------------------
  renderLobby(state, mySid, ping) {
    const players = [...state.players.entries()];
    const me = state.players.get(mySid);
    const isHost = state.hostId === mySid;
    this.el.lobbyMode.textContent = `${MODE_LABELS[state.mode]} · ${state.isPrivate ? 'SALA PRIVADA' : 'SALA PÚBLICA'}`;
    this.el.lobbyName.textContent = state.roomName;
    this.el.lobbyCode.textContent = state.code;
    this.el.lobbyCount.textContent = `${players.length}/${state.maxPlayers}`;
    this.el.lobbyPing.textContent = `${Math.round(ping)} ms`;
    const key = JSON.stringify(players.map(([sid, p]) => [sid, p.name, p.team, p.ready, p.connected]).concat([state.hostId]));
    if (key !== this.lastLobbyKey) {
      this.lastLobbyKey = key;
      for (const team of [TEAM.ALFA, TEAM.OMEGA]) {
        const list = team === TEAM.ALFA ? this.el.team1 : this.el.team2;
        const rows = players.filter(([, p]) => p.team === team).map(([sid, p]) => {
          const li = el('li', sid === mySid ? 'me' : '');
          const who = el('span', 'who');
          who.append(el('span', 'name', p.name));
          if (sid === state.hostId) who.append(el('span', 'tag host', 'ANFITRIÃO'));
          const status = el('span', `tag ${!p.connected ? 'off' : p.ready ? 'ready' : ''}`, !p.connected ? 'RECONECTANDO' : p.ready ? 'PRONTO' : 'AGUARDANDO');
          li.append(who, status);
          return li;
        });
        list.replaceChildren(...(rows.length ? rows : [el('li', 'empty', '—')]));
      }
    }
    const counts = { 1: 0, 2: 0 };
    players.forEach(([, p]) => { counts[p.team] = (counts[p.team] || 0) + 1; });
    const enough = players.length >= state.minPlayers && (state.mode !== 'tactical' || (counts[1] > 0 && counts[2] > 0));
    let status;
    if (state.phase === PHASE.COUNTDOWN) status = `Partida começando em ${Math.ceil(state.timeLeft)} s…`;
    else if (!enough) status = state.mode === 'tactical' && players.length >= state.minPlayers ? 'As duas equipes precisam de pelo menos um jogador.' : `Aguardando jogadores (mínimo ${state.minPlayers}). Compartilhe o código ${state.code}.`;
    else if (state.isPrivate) status = isHost ? 'Pronto para iniciar. Você é o anfitrião.' : 'Aguardando o anfitrião iniciar a partida.';
    else status = `Início automático quando todos estiverem prontos ou em ${Math.ceil(state.timeLeft)} s.`;
    this.el.lobbyStatus.textContent = status;
    this.el.lobbyStart.style.display = state.isPrivate && isHost ? '' : 'none';
    this.el.lobbyStart.disabled = !enough || state.phase !== PHASE.LOBBY;
    this.el.lobbyReady.textContent = me && me.ready ? 'CANCELAR PRONTO' : 'PRONTO';
    this.el.lobbyReady.disabled = state.phase !== PHASE.LOBBY;
  }

  renderEnd(state, mySid) {
    const me = state.players.get(mySid);
    const myTeam = me ? me.team : 0;
    const won = state.winner !== 0 && state.winner === myTeam;
    const draw = state.winner === 0;
    this.el.endBadge.textContent = draw ? 'EMPATE' : won ? 'VITÓRIA' : 'DERROTA';
    this.el.endBadge.className = `end-badge ${draw ? '' : won ? 'win' : 'lose'}`;
    this.el.endTitle.textContent = draw ? 'PARTIDA EMPATADA' : `VITÓRIA DA EQUIPE ${TEAM_LABELS[state.winner]}`;
    this.el.endSubtitle.textContent = `${MODE_LABELS[state.mode]} · ${REASON_LABELS[state.endReason] || ''}`;
    this.el.end1.textContent = String(state.scoreAlfa);
    this.el.end2.textContent = String(state.scoreOmega);
    const rows = [...state.players.entries()].sort((a, b) => b[1].score - a[1].score || b[1].kills - a[1].kills).map(([sid, p]) => {
      const tr = el('tr', sid === mySid ? 'me' : '');
      [p.name, TEAM_LABELS[p.team], p.kills, p.deaths, p.score].forEach((v) => tr.append(el('td', '', String(v))));
      return tr;
    });
    this.el.endRows.replaceChildren(...rows);
    this.el.endReturn.textContent = `Voltando ao lobby em ${formatTime(state.timeLeft)}`;
  }
}
