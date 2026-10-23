// Modo online (aba JOGAR do menu): nome, modos, busca pública, sala privada com modo e mapa,
// entrada por código, lista de partidas, lobby da sala e resultado. Toda operação de rede tem
// retorno visível. Operador e arma vão junto na entrada; o servidor valida tudo.
import { OnlineConnection, describeError } from './connection.js';
import { AccountClient } from './account.js';
import { sanitizeName, MODE_LABELS, TEAM, TEAM_LABELS, PHASE, REASON_LABELS, normalizeRoomCode } from '../shared/protocol.js';
import { mapById, mapSupportsMode, operatorById, isValidMap } from '../shared/catalog.js';
import { weaponById } from '../shared/weapon-rules.js';
import { formatTime } from '../utils.js';
const DIFF_LABELS = { normal: 'NORMAL', hard: 'DIFÍCIL', elite: 'ELITE' };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

export class OnlineMenu {
  constructor(game) {
    this.game = game;
    this.ui = game.ui;
    this.conn = new OnlineConnection();
    this.account = new AccountClient(this.conn);
    game.account = this.account;
    this.conn.accountToken = () => this.account.token;
    this.mode = 'tdm';
    this.map = isValidMap(game.profile.map) ? game.profile.map : 'foundry7';
    this.busy = false;
    this.cancelled = false;
    const $ = (id) => document.getElementById(id);
    this.el = {
      name: $('net-name'), code: $('net-code'), message: $('net-message'), server: $('net-server'), rooms: $('net-rooms'),
      modeButtons: document.querySelectorAll('#net-mode [data-mode]'),
      mapButtons: document.querySelectorAll('#net-map [data-map]'), lobbyMap: $('lobby-map'), lobbyLoadout: $('lobby-loadout'),
      searchTitle: $('search-title'), searchText: $('search-text'),
      lobbyMode: $('lobby-mode'), lobbyName: $('lobby-name'), lobbyCode: $('lobby-code'), lobbyCount: $('lobby-count'), lobbyPing: $('lobby-ping'),
      team1: $('lobby-team-1'), team2: $('lobby-team-2'), lobbyStatus: $('lobby-status'), lobbyStart: $('lobby-start'), lobbyReady: $('lobby-ready'),
      endBadge: $('net-end-badge'), endTitle: $('net-end-title'), endSubtitle: $('net-end-subtitle'), end1: $('net-end-1'), end2: $('net-end-2'),
      endRows: $('net-end-rows'), endReturn: $('net-end-return'),
      endKd: $('net-end-kd'), endObj: $('net-end-obj'), endTotal: $('net-end-total'), endBalance: $('net-end-balance'), endBreakdown: $('net-end-breakdown'), endAgain: $('net-again'),
      lobbyBots: $('lobby-bots'), botDiff: document.querySelectorAll('#lobby-bot-diff [data-diff]'),
    };
    this.el.botDiff.forEach((b) => b.addEventListener('click', () => this.game.net?.bots('difficulty', { difficulty: b.dataset.diff })));
    this.el.name.value = game.profile.name || '';
    this.el.name.addEventListener('change', () => { const n = sanitizeName(this.el.name.value); if (n) { game.profile.name = n; game.saveProfile(); game.menu?.refreshProfile(); } });
    this.el.modeButtons.forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.mode)));
    this.el.mapButtons.forEach((b) => b.addEventListener('click', () => this.setMap(b.dataset.map)));
    this.setMap(this.map);
    this.el.code.addEventListener('input', () => { this.el.code.value = normalizeRoomCode(this.el.code.value).slice(0, 5); });
    this.el.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.joinCode(); });
    this.lastLobbyKey = '';
  }

  setMode(mode) {
    this.mode = mode;
    this.el.modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  }

  /** Mapa da sala personalizada e preferido ao criar uma sala pública. */
  setMap(id) {
    if (!isValidMap(id)) return;
    this.map = id;
    this.el.mapButtons.forEach((b) => {
      b.classList.toggle('active', b.dataset.map === id);
      b.setAttribute('aria-pressed', String(b.dataset.map === id));
    });
  }

  setMessage(text, kind = '') {
    this.el.message.textContent = text;
    this.el.message.className = `net-message ${kind}`;
  }

  /** Volta para a aba JOGAR do menu com uma mensagem (erros, cancelamento, saída da sala). */
  open(message = '', kind = '') {
    this.game.menu.show('play');
    this.setMessage(message, kind);
  }

  /** Chamado pelo menu ao entrar/sair da aba JOGAR: atualiza a lista periodicamente. */
  enterPlayPane() {
    this.el.name.value = this.el.name.value || this.game.profile.name || '';
    this.checkServer();
    this.refreshRooms();
    clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => { if (this.ui.currentScreen === 'menu' && this.game.menu.pane === 'play') this.refreshRooms(); }, 4000);
  }

  leavePlayPane() { clearInterval(this.refreshTimer); this.refreshTimer = 0; }

  close() { this.leavePlayPane(); }

  async checkServer() {
    this.el.server.textContent = 'Verificando conexão…';
    this.el.server.dataset.state = 'pending';
    try {
      await this.conn.resolveServer();
      this.el.server.textContent = 'ONLINE · servidores disponíveis';
      this.el.server.dataset.state = 'online';
      if (this.account.status !== 'ready') this.account.ensure(this.game.profile.name);
    } catch (err) {
      // detalhes técnicos (endereços tentados) ficam no console, não na interface
      console.warn('[online]', err.message);
      this.el.server.textContent = err.fatal ? 'ATUALIZE A PÁGINA · nova versão disponível' : 'OFFLINE · servidor indisponível no momento';
      this.el.server.dataset.state = 'offline';
    }
  }

  readName() {
    const name = sanitizeName(this.el.name.value);
    if (!name) { this.setMessage('Informe um nome de 2 a 16 caracteres (letras, números, espaço, ponto, hífen ou sublinhado).', 'error'); this.el.name.focus(); return null; }
    this.el.name.value = name;
    this.game.profile.name = name;
    this.game.saveProfile();
    this.game.menu.refreshProfile();
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
      b.append(el('span', 'rn', r.name), el('span', 'rp', r.bots ? `${r.players}/${r.maxPlayers} +${r.bots} BOT` : `${r.players}/${r.maxPlayers}`),
        el('span', 'rm', `${MODE_LABELS[r.mode] || r.mode} · ${mapById(r.map).name}`), el('span', 'rs', r.joinable ? (r.phase === PHASE.LOBBY ? 'NO LOBBY' : 'EM ANDAMENTO') : 'INDISPONÍVEL'));
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
    // operador e arma do perfil seguem na entrada (o servidor recusa valores desconhecidos)
    this.conn.loadout = { operator: this.game.profile.operator, primary: this.game.profile.primary };
    this.el.searchTitle.textContent = title;
    this.el.searchText.textContent = 'Conectando ao servidor…';
    this.ui.showScreen('searching');
    try {
      // conta para as recompensas (se falhar, joga como convidado e é avisado no fim da partida)
      await this.account.ensure(name);
      if (this.cancelled) return;
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

  /** Busca pública: entra em qualquer sala do modo; se criar uma, usa o mapa preferido. */
  quick(mode = this.mode) {
    const map = mapSupportsMode(this.map, mode) ? this.map : 'foundry7';
    return this.run('PROCURANDO PARTIDA', async (name) => {
      await this.conn.connect();
      if (this.cancelled) return null;
      this.el.searchText.textContent = `Procurando sala pública · ${MODE_LABELS[mode]}…`;
      return this.conn.quickMatch(name, mode, () => this.cancelled, map);
    });
  }

  create() {
    if (!mapSupportsMode(this.map, this.mode)) { this.setMessage('Este mapa não suporta o modo escolhido.', 'error'); return undefined; }
    return this.run('CRIANDO SALA', (name) => this.conn.createRoom(name, { mode: this.mode, maxPlayers: 10, map: this.map }));
  }

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
    this.el.lobbyPing.textContent = `${Math.round(ping)} ms`;
    this.el.lobbyMap.textContent = mapById(state.map).name;
    if (me) this.el.lobbyLoadout.textContent = `${operatorById(me.operator).name} · ${(weaponById(me.primary) || weaponById('rifle')).name}`;
    const humans = players.filter(([, p]) => !p.bot).length;
    const botCount = players.length - humans;
    this.el.lobbyCount.textContent = botCount ? `${humans}/${state.maxPlayers} · ${botCount} BOT${botCount > 1 ? 'S' : ''}` : `${players.length}/${state.maxPlayers}`;
    const showBots = state.isPrivate && isHost && state.phase === PHASE.LOBBY;
    this.el.lobbyBots.classList.toggle('hidden', !showBots);
    this.el.botDiff.forEach((b) => { const on = b.dataset.diff === state.botDifficulty; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    const key = JSON.stringify(players.map(([sid, p]) => [sid, p.name, p.team, p.ready, p.connected, p.operator, p.primary, p.bot]).concat([state.hostId, state.botDifficulty]));
    if (key !== this.lastLobbyKey) {
      this.lastLobbyKey = key;
      for (const team of [TEAM.ALFA, TEAM.OMEGA]) {
        const list = team === TEAM.ALFA ? this.el.team1 : this.el.team2;
        const rows = players.filter(([, p]) => p.team === team).map(([sid, p]) => {
          const li = el('li', sid === mySid ? 'me' : '');
          const who = el('span', 'who');
          who.append(el('span', 'name', p.name), el('span', 'op', `${operatorById(p.operator).name} · ${(weaponById(p.primary) || weaponById('rifle')).name}`));
          if (sid === state.hostId) who.append(el('span', 'tag host', 'ANFITRIÃO'));
          const status = p.bot ? el('span', 'tag bot', `BOT · ${DIFF_LABELS[state.botDifficulty] || 'NORMAL'}`)
            : el('span', `tag ${!p.connected ? 'off' : p.ready ? 'ready' : ''}`, !p.connected ? 'RECONECTANDO' : p.ready ? 'PRONTO' : 'AGUARDANDO');
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
    if (!state.isPrivate && state.phase === PHASE.LOBBY && players.length < 6) status += ' Vagas restantes serão completadas com bots (marcados como BOT).';
    this.el.lobbyStatus.textContent = status;
    this.el.lobbyStart.style.display = state.isPrivate && isHost ? '' : 'none';
    this.el.lobbyStart.disabled = !enough || state.phase !== PHASE.LOBBY;
    this.el.lobbyReady.textContent = me && me.ready ? 'CANCELAR PRONTO' : 'PRONTO';
    this.el.lobbyReady.disabled = state.phase !== PHASE.LOBBY;
  }

  renderEnd(state, mySid, reward = null, readyAgain = false) {
    const me = state.players.get(mySid);
    const myTeam = me ? me.team : 0;
    const won = state.winner !== 0 && state.winner === myTeam;
    const draw = state.winner === 0;
    this.el.endBadge.textContent = draw ? 'EMPATE' : won ? 'VITÓRIA' : 'DERROTA';
    this.el.endBadge.className = `end-badge ${draw ? '' : won ? 'win' : 'lose'}`;
    this.el.endTitle.textContent = draw ? 'PARTIDA EMPATADA' : `VITÓRIA DA EQUIPE ${TEAM_LABELS[state.winner]}`;
    this.el.endSubtitle.textContent = `${MODE_LABELS[state.mode]} · ${mapById(state.map).name} · ${REASON_LABELS[state.endReason] || ''}`;
    this.el.end1.textContent = String(state.scoreAlfa);
    this.el.end2.textContent = String(state.scoreOmega);
    const rows = [...state.players.entries()].sort((a, b) => b[1].score - a[1].score || b[1].kills - a[1].kills).map(([sid, p]) => {
      const tr = el('tr', sid === mySid ? 'me' : '');
      [p.name, TEAM_LABELS[p.team], p.kills, p.deaths, p.score].forEach((v) => tr.append(el('td', '', String(v))));
      return tr;
    });
    this.el.endRows.replaceChildren(...rows);
    this.el.endReturn.textContent = `Voltando ao lobby em ${formatTime(state.timeLeft)}`;
    this.el.endAgain.disabled = readyAgain;
    this.el.endAgain.textContent = readyAgain ? 'PRONTO PARA A PRÓXIMA' : 'JOGAR NOVAMENTE';
    if (me) {
      this.el.endKd.textContent = `${me.kills} / ${me.deaths}`;
      this.el.endObj.textContent = reward && reward.stats ? `${reward.stats.plants} / ${reward.stats.defuses}` : '—';
    }
    this.renderReward(reward);
  }

  /** Recompensa calculada e paga pelo servidor (o cliente só exibe). */
  renderReward(r) {
    const E = this.el;
    if (!r) { E.endTotal.textContent = '…'; E.endBalance.textContent = 'Calculando no servidor…'; E.endBreakdown.replaceChildren(); return; }
    if (r.guest) {
      E.endTotal.textContent = '—';
      E.endBalance.textContent = 'Sem conta conectada: créditos não foram registrados.';
      E.endBreakdown.replaceChildren();
      return;
    }
    if (r.failed) {
      E.endTotal.textContent = '—';
      E.endBalance.textContent = 'O servidor não conseguiu registrar a recompensa agora; nada foi creditado.';
      E.endBreakdown.replaceChildren();
      return;
    }
    if (!r.eligible) {
      E.endTotal.textContent = '0 ZC';
      E.endBalance.textContent = 'Sem recompensa: tempo jogando insuficiente (inativo).';
      E.endBreakdown.replaceChildren();
      return;
    }
    E.endTotal.textContent = `+${r.granted} ZC`;
    E.endBalance.textContent = `Saldo: ${Number(r.balance).toLocaleString('pt-BR')} ZC${r.capped ? ' · limite diário atingido' : ''}`;
    const rows = [['Conclusão', r.completion], ['Vitória', r.win], ['Desempenho', r.performance], ['Objetivos', r.objective]];
    E.endBreakdown.replaceChildren(...rows.map(([label, v]) => { const li = el('li', v ? '' : 'zero'); li.append(el('span', null, label), el('b', null, v ? `+${v}` : '0')); return li; }));

  }
}
