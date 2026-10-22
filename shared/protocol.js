// Contrato de comunicação cliente ↔ servidor do OPERATION ZERO 2.0.
//
// Canais:
//  1. ENTRADA (cliente → servidor): canal de input do Colyseus (`room.input()`), um quadro por
//     passo fixo de 1/60 s. Campos definidos em server/src/schema/InputSchema.js e listados em INPUT_FIELDS.
//  2. ESTADO (servidor → cliente): Schema sincronizado (jogadores, fumaças, placar, fase, objetivo).
//  3. MENSAGENS: eventos pontuais (MSG) — disparos para efeitos, confirmações, eliminações, avisos.
//
// O servidor NUNCA aceita resultados do cliente (dano, munição, acertos); só comandos.

export const PROTOCOL_VERSION = 2;
export const ROOM_NAME = 'match';

export const MODES = { TDM: 'tdm', TACTICAL: 'tactical' };
export const MODE_LABELS = { tdm: 'COMBATE POR EQUIPES', tactical: 'TÁTICO — ATAQUE E DEFESA' };

export const PHASE = {
  LOBBY: 'lobby',            // aguardando jogadores / anfitrião
  COUNTDOWN: 'countdown',    // contagem antes do início
  LIVE: 'live',              // combate por equipes em andamento
  ROUND_PREP: 'round_prep',  // tático: preparação (jogadores congelados)
  ROUND_LIVE: 'round_live',  // tático: rodada em combate
  ROUND_END: 'round_end',    // tático: intervalo entre rodadas
  ENDED: 'ended',            // resultado final (volta ao lobby depois)
};

export const PHASE_LABELS = {
  lobby: 'AGUARDANDO', countdown: 'INICIANDO', live: 'EM COMBATE', round_prep: 'PREPARAÇÃO',
  round_live: 'RODADA', round_end: 'FIM DA RODADA', ended: 'PARTIDA ENCERRADA',
};

export const TEAM = { NONE: 0, ALFA: 1, OMEGA: 2 };
export const TEAM_LABELS = { 0: '—', 1: 'ALFA', 2: 'ÔMEGA' };
export const TEAM_COLORS = { 0: '#8e9ba7', 1: '#3ef0ff', 2: '#ff6a3d' };

/** Bits do campo `btn` do quadro de entrada. JUMP/RELOAD/ABILITY são bordas (pressionado neste passo). */
export const BTN = {
  JUMP: 1, CROUCH: 2, WALK: 4, FIRE: 8, ADS: 16, RELOAD: 32, ABILITY: 64, INTERACT: 128,
};

/** Campos do quadro de entrada (documentação; o tipo vive no schema do servidor). */
export const INPUT_FIELDS = {
  mf: 'int8 — frente/trás (-1..1)',
  mr: 'int8 — direita/esquerda (-1..1)',
  btn: 'uint16 — bits de BTN',
  yaw: 'float32 — guinada da câmera (rad, inclui recuo)',
  pitch: 'float32 — inclinação da câmera (rad, inclui recuo)',
  slot: 'uint8 — arma desejada (1 ou 2)',
  dx: 'float32 — direção do disparo (com dispersão) quando FIRE',
  dy: 'float32', dz: 'float32',
};

/** Estado do dispositivo do modo tático. */
export const SPIKE = { NONE: 0, PLANTING: 1, PLANTED: 2, DEFUSING: 3, DEFUSED: 4, DETONATED: 5 };

/** Mensagens servidor → cliente. */
export const MSG = {
  SHOT: 'shot',          // { s: sid atirador, o:[x,y,z], e:[x,y,z], k: 0 parede | 1 jogador | 2 nada }  (para os outros)
  HIT: 'hit',            // { t: sid alvo, z: zona, d: dano, k: eliminou? }       (só para o atirador)
  DAMAGED: 'damaged',    // { a: sid atacante, d: dano, x, y, z }                   (só para a vítima)
  KILL: 'kill',          // { k: sid, kn: nome, v: sid, vn: nome, hs, w }           (todos)
  NOTICE: 'notice',      // { t: tipo, n: nome, m: texto }                           (todos)
  REJECT: 'reject',      // { a: ação, r: motivo }                                   (só para o autor)
  ROUND: 'round',        // { w: equipe vencedora, r: motivo, n: rodada }            (todos)
  ABILITY: 'ability',    // { id, x, y, z, s: sid }                                  (todos — efeito sonoro/visual de lançamento)
};

/** Mensagens cliente → servidor (fora do canal de entrada). */
export const CMSG = {
  READY: 'ready',        // { ready: boolean }
  START: 'start',        // anfitrião inicia a partida
  TEAM: 'team',          // { team: 1|2 } — só no lobby
  PING: 'ping_report',   // { ms } — latência medida pelo cliente (apenas exibição no placar)
};

export const NOTICE_TYPES = { JOIN: 'join', LEAVE: 'leave', DROP: 'drop', RECONNECT: 'reconnect', HOST: 'host', INFO: 'info' };

export const END_REASON = {
  SCORE: 'score', TIME: 'time', ELIMINATION: 'elimination', DETONATED: 'detonated', DEFUSED: 'defused',
  FORFEIT: 'forfeit',
};

export const REASON_LABELS = {
  score: 'Limite de pontos atingido', time: 'Tempo esgotado', elimination: 'Equipe adversária eliminada',
  detonated: 'Dispositivo detonado', defused: 'Dispositivo desarmado', forfeit: 'Equipe adversária abandonou',
};

// ---------------------------------------------------------------------------
// Validação compartilhada (o servidor revalida tudo; o cliente usa para feedback imediato)
// ---------------------------------------------------------------------------

export const NAME_MIN = 2;
export const NAME_MAX = 16;

/** Retorna o nome normalizado ou null se inválido. */
export function sanitizeName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFC').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) return null;
  if (!/^[\p{L}\p{N} _.\-]+$/u.test(name)) return null;
  return name;
}

/** Códigos de sala: 5 caracteres sem ambíguos (sem 0/O/1/I). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
export const normalizeRoomCode = (raw) => (typeof raw === 'string' ? raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : '');
export const isValidRoomCode = (code) => typeof code === 'string' && code.length === ROOM_CODE_LENGTH && [...code].every((ch) => ROOM_CODE_ALPHABET.includes(ch));

export const isValidMode = (m) => m === MODES.TDM || m === MODES.TACTICAL;
