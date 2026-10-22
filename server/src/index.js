// OPERATION ZERO 2.0 — servidor multiplayer (Node.js + Colyseus).
// Um único processo atende: WebSocket das partidas, matchmaking HTTP, API auxiliar,
// verificação de saúde e (opcionalmente) os arquivos estáticos do cliente.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { SERVER_CONFIG } from './config.js';
import { MatchRoom } from './rooms/MatchRoom.js';
import { listPublicRooms, describeRoomCode, activeRoomCount } from './services/matchmaking.js';
import { normalizeRoomCode } from './services/validation.js';
import { ROOM_NAME, PROTOCOL_VERSION } from '../../shared/protocol.js';
import { GAME } from '../../shared/game-config.js';
import { log } from './services/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const require = createRequire(import.meta.url);
const SDK_BUNDLE = path.join(path.dirname(require.resolve('@colyseus/sdk/package.json')), 'dist', 'colyseus.js');
const startedAt = Date.now();

// ---------------------------------------------------------------------------
// Política de origens (HTTP de matchmaking, API e upgrade de WebSocket)
// ---------------------------------------------------------------------------
export function originAllowed(origin, host) {
  if (!origin) return true; // clientes não-navegador (testes, verificação de saúde)
  const list = SERVER_CONFIG.allowedOrigins;
  if (list.includes('*')) return true;
  if (list.length) return list.includes(origin);
  if (!SERVER_CONFIG.production) return true; // desenvolvimento: qualquer origem (ex.: cliente em :8000)
  try { return new URL(origin).host === host; } catch { return false; }
}

matchMaker.controller.getCorsHeaders = function corsHeaders(headers) {
  const origin = headers.get('origin');
  const allowed = originAllowed(origin, headers.get('host'));
  return { 'Access-Control-Allow-Origin': allowed ? (origin || '*') : 'null', Vary: 'Origin' };
};

// ---------------------------------------------------------------------------
// Rotas HTTP
// ---------------------------------------------------------------------------
const ROOT_FILE = /^\/[a-z0-9][a-z0-9-]*\.(js|css|html)$/i;
const CLIENT_DIR_FILE = /^\/(shared|online)\/[a-z0-9][a-z0-9-]*\.js$/i;

function configureHttp(app) {
  if (SERVER_CONFIG.trustProxy) app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (req.path === '/health' || req.path.startsWith('/api/')) {
      const origin = req.headers.origin;
      if (!originAllowed(origin, req.headers.host)) return res.status(403).json({ error: 'origem não permitida' });
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    }
    return next();
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', protocol: PROTOCOL_VERSION, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000), rooms: activeRoomCount() });
  });

  app.get('/api/rooms', async (req, res) => {
    try { res.json({ rooms: await listPublicRooms() }); } catch (err) {
      log.error('api.rooms', { error: err.message });
      res.status(500).json({ error: 'falha ao listar salas' });
    }
  });

  app.get('/api/rooms/:code', async (req, res) => {
    try { res.json(await describeRoomCode(normalizeRoomCode(req.params.code))); } catch (err) {
      log.error('api.room', { error: err.message });
      res.status(500).json({ error: 'falha ao consultar sala' });
    }
  });

  app.get('/api/config', (req, res) => {
    res.json({ protocol: PROTOCOL_VERSION, tickRate: GAME.net.tickRate, maxPlayers: SERVER_CONFIG.maxPlayersPerRoom, minPlayers: SERVER_CONFIG.minPlayersToStart });
  });

  // SDK do Colyseus para o navegador (carregado só ao entrar no modo online)
  app.get('/vendor/colyseus.js', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.type('application/javascript').sendFile(SDK_BUNDLE);
  });

  if (!SERVER_CONFIG.serveClient) return;

  // configuração do cliente gerada a partir do ambiente (sobrepõe o arquivo estático)
  app.get('/client-config.js', (req, res) => {
    res.type('application/javascript').setHeader('Cache-Control', 'no-cache');
    res.send(`// Gerado pelo servidor a partir de PUBLIC_SERVER_URL.\nexport const CLIENT_CONFIG = ${JSON.stringify({ serverUrl: SERVER_CONFIG.publicServerUrl })};\n`);
  });

  // cliente estático: somente arquivos do jogo (nunca server/, node_modules nem arquivos ocultos)
  app.get('*', (req, res, next) => {
    const p = req.path === '/' ? '/index.html' : req.path;
    if (!ROOT_FILE.test(p) && !CLIENT_DIR_FILE.test(p)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(path.join(PROJECT_ROOT, p), { dotfiles: 'deny' }, (err) => { if (err) next(); });
  });
}

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------
export async function startServer({ port = SERVER_CONFIG.port, host = SERVER_CONFIG.host } = {}) {
  const transport = new WebSocketTransport({
    maxPayload: 16 * 1024,                // quadros de entrada são minúsculos
    beforeUpgrade: (request, context) => {
      const origin = context.headers.get('origin');
      if (!originAllowed(origin, context.headers.get('host'))) {
        log.warn('ws.origin_rejected', { origin });
        return new Response('Origem não permitida', { status: 403 });
      }
      return undefined;
    },
  });
  const gameServer = new Server({ transport, greet: false, express: configureHttp });
  gameServer.define(ROOM_NAME, MatchRoom).filterBy(['mode']);
  gameServer.onShutdown(() => log.info('server.shutdown', {}));
  await gameServer.listen(port, host);
  log.info('server.listening', {
    port, host, env: SERVER_CONFIG.nodeEnv, serveClient: SERVER_CONFIG.serveClient,
    publicServerUrl: SERVER_CONFIG.publicServerUrl || '(mesma origem)', allowedOrigins: SERVER_CONFIG.allowedOrigins,
  });
  return gameServer;
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  startServer().catch((err) => {
    log.error('server.start_failed', { error: err.message });
    process.exit(1);
  });
}
