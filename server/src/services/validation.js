// Validação de tudo que chega da rede. Nada vindo do cliente é usado sem passar por aqui.
import { GAME } from '../../../shared/game-config.js';
import { BTN, sanitizeName, isValidMode, normalizeRoomCode, isValidRoomCode, PROTOCOL_VERSION } from '../../../shared/protocol.js';
import { wrapAngle, clamp } from '../../../shared/math.js';

const BTN_MASK = Object.values(BTN).reduce((a, b) => a | b, 0);
const finiteOr = (v, d) => (Number.isFinite(v) ? v : d);
const intIn = (v, min, max, d) => (Number.isInteger(v) ? clamp(v, min, max) : d);

/**
 * Saneia um quadro de entrada IN PLACE (chamado pelo framework antes de qualquer leitura).
 * Valores não finitos viram neutros, ângulos são normalizados, bits desconhecidos descartados.
 */
export function sanitizeInput(f) {
  f.mf = intIn(f.mf, -1, 1, 0);
  f.mr = intIn(f.mr, -1, 1, 0);
  f.btn = Number.isInteger(f.btn) ? f.btn & BTN_MASK : 0;
  f.yaw = wrapAngle(finiteOr(f.yaw, 0));
  f.pitch = clamp(finiteOr(f.pitch, 0), -GAME.pitchLimit, GAME.pitchLimit);
  f.slot = f.slot === 2 ? 2 : 1;
  f.dx = clamp(finiteOr(f.dx, 0), -1, 1);
  f.dy = clamp(finiteOr(f.dy, 0), -1, 1);
  f.dz = clamp(finiteOr(f.dz, -1), -1, 1);
}

/** Opções de entrada/criação de sala. Lança Error com mensagem amigável quando inválidas. */
export function validateJoinOptions(options = {}) {
  const errors = [];
  if (options.protocol !== PROTOCOL_VERSION) errors.push('Versão do cliente incompatível com o servidor. Recarregue a página.');
  const name = sanitizeName(options.name);
  if (!name) errors.push('Nome inválido: use de 2 a 16 letras, números, espaço, ponto, hífen ou sublinhado.');
  const clientKey = typeof options.clientKey === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(options.clientKey) ? options.clientKey : null;
  if (!clientKey) errors.push('Identificador de sessão do navegador ausente.');
  if (errors.length) throw new Error(errors[0]);
  return { name, clientKey };
}

export function validateCreateOptions(options = {}, maxPlayersLimit) {
  const mode = isValidMode(options.mode) ? options.mode : 'tdm';
  const isPrivate = options.private === true;
  const requested = Number.isInteger(options.maxPlayers) ? options.maxPlayers : maxPlayersLimit;
  const maxPlayers = clamp(requested, 2, maxPlayersLimit);
  const roomName = sanitizeName(typeof options.roomName === 'string' ? options.roomName.slice(0, 16) : '') || null;
  return { mode, isPrivate, maxPlayers, roomName };
}

export { normalizeRoomCode, isValidRoomCode };

/** Limitador simples por janela deslizante (mensagens por segundo). */
export class RateLimiter {
  constructor(maxPerSecond) { this.max = maxPerSecond; this.tokens = maxPerSecond; this.last = Date.now(); }
  allow() {
    const now = Date.now();
    this.tokens = Math.min(this.max, this.tokens + ((now - this.last) / 1000) * this.max);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
