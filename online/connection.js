// Camada de conexão do modo online: resolve o endereço do servidor, carrega o SDK do Colyseus
// sob demanda (o modo offline nunca depende dele) e expõe operações de sala com erros claros.
import { CLIENT_CONFIG } from '../client-config.js';
import { ROOM_NAME, PROTOCOL_VERSION, CMSG, normalizeRoomCode, isValidRoomCode } from '../shared/protocol.js';
import { GAME } from '../shared/game-config.js';

const DEFAULT_DEV_PORT = 2567;
const REQUEST_TIMEOUT = 8000;

async function fetchJson(url, timeout = 2500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

const trimSlash = (u) => u.replace(/\/+$/, '');
const toHttp = (u) => trimSlash(u.replace(/^ws(s?):\/\//i, 'http$1://'));

/** Identificador por aba (sessionStorage): impede entrada duplicada da mesma aba e permite duas abas. */
export function getClientKey() {
  try {
    let k = sessionStorage.getItem('oz-client-key');
    if (!k) { k = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^a-zA-Z0-9-]/g, ''); sessionStorage.setItem('oz-client-key', k); }
    return k;
  } catch { return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }
}

/** Traduz erros do matchmaking/servidor em mensagens para o jogador. */
export function describeError(err) {
  const msg = (err && err.message) || String(err || '');
  const code = err && err.code;
  if (code === 522 || /not found/i.test(msg)) return 'Sala não encontrada. Confira o código.';
  if (/full|locked/i.test(msg)) return 'Sala cheia ou partida em andamento.';
  if (/Failed to fetch|NetworkError|ECONNREFUSED|fetch failed|timeout|aborted/i.test(msg)) return 'Servidor indisponível. Verifique se ele está em execução e o endereço configurado.';
  if (/seat reservation expired/i.test(msg)) return 'A reserva da vaga expirou. Tente novamente.';
  return msg || 'Erro de conexão.';
}

export class OnlineConnection {
  constructor() {
    this.httpUrl = null;
    this.client = null;
    this.room = null;
    this.sdk = null;
    this.loadout = {};      // { operator, primary } enviados na entrada (validados pelo servidor)
  }

  /** Descobre o servidor: ?server=, client-config.js, mesma origem ou porta padrão local. */
  async resolveServer() {
    if (this.httpUrl) return this.httpUrl;
    const candidates = [];
    const q = new URLSearchParams(location.search).get('server');
    if (q) candidates.push(toHttp(q));
    if (CLIENT_CONFIG.serverUrl) candidates.push(toHttp(CLIENT_CONFIG.serverUrl));
    if (location.protocol.startsWith('http')) {
      candidates.push(trimSlash(location.origin));
      candidates.push(`${location.protocol}//${location.hostname}:${DEFAULT_DEV_PORT}`);
    }
    const tried = [];
    for (const url of [...new Set(candidates)]) {
      tried.push(url);
      try {
        const h = await fetchJson(`${url}/health`);
        if (h && h.status === 'ok') {
          if (h.protocol !== PROTOCOL_VERSION) throw Object.assign(new Error('Versão do servidor incompatível com este cliente. Atualize a página.'), { fatal: true });
          this.httpUrl = url;
          return url;
        }
      } catch (err) { if (err.fatal) throw err; }
    }
    throw new Error(`Servidor multiplayer não encontrado (tentado: ${tried.join(', ')}). Inicie-o com "npm start" na pasta do projeto.`);
  }

  /** Carrega o SDK do navegador servido pelo próprio servidor (mesma versão do backend). */
  async loadSdk() {
    if (this.sdk) return this.sdk;
    if (!window.Colyseus) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = `${this.httpUrl}/vendor/colyseus.js`;
        s.async = true;
        s.onload = resolve;
        s.onerror = () => reject(new Error('Falha ao carregar o SDK de rede do servidor.'));
        document.head.appendChild(s);
      });
    }
    this.sdk = window.Colyseus;
    return this.sdk;
  }

  async connect() {
    await this.resolveServer();
    await this.loadSdk();
    if (!this.client) this.client = new this.sdk.Client(this.httpUrl);
    return this.client;
  }

  joinOptions(name, extra = {}) {
    const token = this.accountToken ? this.accountToken() : '';
    return { name, clientKey: getClientKey(), protocol: PROTOCOL_VERSION, ...this.loadout, ...(token ? { accountToken: token } : {}), ...extra };
  }

  withTimeout(promise, label) {
    return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label}: tempo esgotado`)), REQUEST_TIMEOUT))]);
  }

  async listRooms() {
    await this.resolveServer();
    const data = await fetchJson(`${this.httpUrl}/api/rooms`, 4000);
    return data.rooms || [];
  }

  async checkCode(code) {
    await this.resolveServer();
    return fetchJson(`${this.httpUrl}/api/rooms/${encodeURIComponent(code)}`, 4000);
  }

  async createRoom(name, { mode, maxPlayers, map }) {
    await this.connect();
    const room = await this.withTimeout(this.client.create(ROOM_NAME, this.joinOptions(name, { mode, maxPlayers, map, private: true })), 'Criar sala');
    return this.adopt(room);
  }

  async joinByCode(name, rawCode) {
    const code = normalizeRoomCode(rawCode);
    if (!isValidRoomCode(code)) throw new Error('Código inválido: são 5 letras/números (ex.: K7Q2M).');
    const info = await this.checkCode(code);
    if (info.status === 'not_found') throw new Error('Sala não encontrada. Confira o código.');
    if (info.status === 'full') throw new Error('Sala cheia.');
    if (info.status === 'in_progress') throw new Error('Partida tática em andamento: aguarde o fim da partida.');
    await this.connect();
    const room = await this.withTimeout(this.client.joinById(code, this.joinOptions(name)), 'Entrar na sala');
    return this.adopt(room);
  }

  /**
   * Busca pública: entra numa sala do modo ou cria outra (com o mapa preferido — salas existentes
   * mantêm o mapa delas, que vem no estado da sala). `isCancelled` permite desistir.
   */
  async quickMatch(name, mode, isCancelled = () => false, map = undefined) {
    await this.connect();
    const room = await this.withTimeout(this.client.joinOrCreate(ROOM_NAME, this.joinOptions(name, { mode, map })), 'Buscar partida');
    if (isCancelled()) { room.leave(true).catch(() => {}); return null; }
    return this.adopt(room);
  }

  adopt(room) {
    this.room = room;
    room.reconnection.maxRetries = 12;
    room.reconnection.minUptime = 1500;
    this.input = room.input({ renderDelay: GAME.net.interpDelayMs });
    return room;
  }

  reportPing(ms) {
    if (this.room && Number.isFinite(ms)) this.room.send(CMSG.PING, { ms: Math.round(ms) });
  }

  async leave() {
    const room = this.room;
    this.room = null;
    this.input = null;
    if (room) { try { room.removeAllListeners(); await room.leave(true); } catch { /* já desconectado */ } }
  }
}
