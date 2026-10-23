// Estado sincronizado da partida (Colyseus Schema). Somente o servidor escreve nele.
import { schema, t } from '@colyseus/schema';

/** Jogador. Inclui o estado completo de movimento para a reconciliação da predição do dono. */
export const PlayerState = schema({
  name: t.string().default(''),
  team: t.uint8().default(0),
  operator: t.string().default('gaviao'),   // aparência (catálogo validado no servidor)
  primary: t.string().default('rifle'),     // arma do slot 1 em uso (rifle | smg | sniper)
  skins: t.string().default(''),            // acabamentos equipados da conta ("rifle=carbono;…"), definidos pelo servidor
  ready: t.boolean().default(false),
  bot: t.boolean().default(false),       // participante controlado pelo servidor (sempre exibido como BOT)
  connected: t.boolean().default(true),
  // movimento
  x: t.float32().default(0),
  y: t.float32().default(0),
  z: t.float32().default(0),
  vx: t.float32().default(0),
  vy: t.float32().default(0),
  vz: t.float32().default(0),
  h: t.float32().default(1.8),
  crouch: t.boolean().default(false),
  ground: t.boolean().default(true),
  coyote: t.float32().default(0),
  jbuf: t.float32().default(0),
  yaw: t.float32().default(0),
  pitch: t.float32().default(0),
  move: t.uint8().default(0),        // índice em MOVE_STATES (animação dos avatares)
  // combate
  hp: t.uint8().default(100),
  alive: t.boolean().default(false),
  slot: t.uint8().default(1),
  mag: t.uint8().default(0),
  reserve: t.uint16().default(0),
  reloading: t.boolean().default(false),
  switching: t.boolean().default(false),
  abilityCd: t.float32().default(0),  // recarga restante da fumaça (s)
  respawnIn: t.float32().default(0),
  shielded: t.boolean().default(false),
  action: t.uint8().default(0),       // 0 nenhuma, 1 instalando, 2 desarmando
  spawnSeq: t.uint16().default(0),    // incrementa a cada surgimento (cliente reposiciona a câmera)
  // placar
  kills: t.uint16().default(0),
  deaths: t.uint16().default(0),
  score: t.uint16().default(0),
  ping: t.uint16().default(0),
}, 'PlayerState');

export const SmokeState = schema({
  x: t.float32().default(0),
  y: t.float32().default(0),
  z: t.float32().default(0),
  remaining: t.float32().default(0),
  team: t.uint8().default(0),
}, 'SmokeState');

/** Dispositivo do modo tático. */
export const SpikeState = schema({
  state: t.uint8().default(0),        // SPIKE.*
  site: t.string().default(''),
  x: t.float32().default(0),
  y: t.float32().default(0),
  z: t.float32().default(0),
  progress: t.float32().default(0),   // 0..1 instalando/desarmando
  timer: t.float32().default(0),      // tempo até detonar
  actor: t.string().default(''),      // sessão de quem instala/desarma
}, 'SpikeState');

export const MatchState = schema({
  mode: t.string().default('tdm'),
  map: t.string().default('foundry7'),
  phase: t.string().default('lobby'),
  timeLeft: t.float32().default(0),
  roomName: t.string().default(''),
  code: t.string().default(''),
  isPrivate: t.boolean().default(false),
  hostId: t.string().default(''),
  maxPlayers: t.uint8().default(10),
  minPlayers: t.uint8().default(2),
  scoreAlfa: t.uint16().default(0),
  scoreOmega: t.uint16().default(0),
  scoreLimit: t.uint16().default(0),
  round: t.uint8().default(0),
  roundsToWin: t.uint8().default(0),
  attackers: t.uint8().default(2),
  winner: t.uint8().default(0),
  endReason: t.string().default(''),
  botDifficulty: t.string().default('normal'),
  players: t.map(PlayerState),
  smokes: t.map(SmokeState),
  spike: t.ref(SpikeState),
}, 'MatchState');

/** Quadro de entrada (cliente → servidor), um por passo fixo. Ver shared/protocol.js (INPUT_FIELDS). */
export const PlayerInput = schema({
  mf: t.int8().default(0),
  mr: t.int8().default(0),
  btn: t.uint16().default(0),
  yaw: t.float32().default(0),
  pitch: t.float32().default(0),
  slot: t.uint8().default(1),
  dx: t.float32().default(0),
  dy: t.float32().default(0),
  dz: t.float32().default(-1),
}, 'PlayerInput');
