// Configuração do servidor a partir de variáveis de ambiente (ver ../../.env.example).
// Um arquivo .env na raiz do projeto é lido se existir; variáveis já definidas no ambiente
// (ex.: painel da hospedagem) têm prioridade.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME } from '../../shared/game-config.js';

function loadDotEnv() {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadDotEnv();

const int = (v, d) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const list = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));

const env = process.env;
const nodeEnv = env.NODE_ENV || 'development';

export const SERVER_CONFIG = Object.freeze({
  nodeEnv,
  production: nodeEnv === 'production',
  port: int(env.PORT, 2567),
  host: env.HOST || '0.0.0.0',
  /** URL pública do servidor de partidas (ex.: wss://oz.exemplo.com). Vazio = mesma origem da página. */
  publicServerUrl: env.PUBLIC_SERVER_URL || '',
  /** Origens permitidas (CSV). Vazio em desenvolvimento = qualquer origem; em produção = só a própria. */
  allowedOrigins: list(env.ALLOWED_ORIGINS),
  /** Servir o cliente estático pelo mesmo processo (recomendado: uma única URL). */
  serveClient: bool(env.SERVE_CLIENT, true),
  maxRooms: int(env.MAX_ROOMS, 50),
  maxPlayersPerRoom: Math.min(GAME.match.maxPlayersLimit, Math.max(2, int(env.MAX_PLAYERS_PER_ROOM, GAME.match.defaultMaxPlayers))),
  maxConnectionsPerIp: int(env.MAX_CONNECTIONS_PER_IP, 12),
  minPlayersToStart: Math.max(1, int(env.MIN_PLAYERS_TO_START, GAME.match.minPlayersToStart)),
  reconnectSeconds: int(env.RECONNECT_SECONDS, GAME.net.reconnectSeconds),
  trustProxy: bool(env.TRUST_PROXY, false),
  logLevel: env.LOG_LEVEL || (nodeEnv === 'production' ? 'info' : 'debug'),
});
