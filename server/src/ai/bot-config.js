// Parâmetros dos bots por dificuldade. A dificuldade muda tempo de reação, qualidade da mira
// (erro angular que diminui enquanto o bot acompanha o alvo), uso de cobertura, posicionamento e
// coordenação — nunca dano, munição, visão através de paredes ou velocidade além das regras.
const DEG = Math.PI / 180;

export const BOT_DIFFICULTIES = {
  normal: {
    label: 'NORMAL',
    reaction: [0.55, 0.9],        // s entre ver o alvo e começar a atirar
    aimError: 2.0 * DEG,          // desvio da mira (rad) já "assentada"; cresce com distância e movimento
    aimSettle: 1.1,               // s acompanhando o alvo até o erro chegar ao mínimo
    turnSpeed: 3.0,               // rad/s
    fov: 105 * DEG,
    visionRange: 55,
    hearing: 28,                  // alcance (m) para ouvir tiros
    burst: [2, 4], burstPause: [0.45, 0.9],
    coverChance: 0.25, retreatHp: 25, peekTime: [1.8, 3.2],
    headChance: 0.04, strafe: 0.45, crouchChance: 0.1,
    comms: false, flank: false,
  },
  hard: {
    label: 'DIFÍCIL',
    reaction: [0.35, 0.55],
    aimError: 1.35 * DEG,
    aimSettle: 0.8,
    turnSpeed: 4.4,
    fov: 120 * DEG,
    visionRange: 65,
    hearing: 36,
    burst: [3, 5], burstPause: [0.3, 0.6],
    coverChance: 0.55, retreatHp: 35, peekTime: [1.2, 2.4],
    headChance: 0.12, strafe: 0.7, crouchChance: 0.22,
    comms: false, flank: true,
  },
  elite: {
    label: 'ELITE',
    reaction: [0.24, 0.36],
    aimError: 0.95 * DEG,
    aimSettle: 0.6,
    turnSpeed: 5.6,
    fov: 135 * DEG,
    visionRange: 75,
    hearing: 44,
    burst: [3, 6], burstPause: [0.22, 0.45],
    coverChance: 0.8, retreatHp: 45, peekTime: [0.9, 1.8],
    headChance: 0.2, strafe: 0.85, crouchChance: 0.3,
    comms: true, flank: true,
  },
};

export const BOT_DIFFICULTY_IDS = Object.keys(BOT_DIFFICULTIES);
export const isValidDifficulty = (d) => typeof d === 'string' && BOT_DIFFICULTY_IDS.includes(d);

/** Nomes de bots: sempre com o prefixo [BOT] — nunca se passam por pessoas. */
export const BOT_NAMES = ['Ferro', 'Lótus', 'Ártico', 'Brasa', 'Quartzo', 'Vento', 'Cobalto', 'Sílex', 'Âmbar', 'Coral', 'Granito', 'Neblina'];

/** Preenchimento das salas públicas. */
export const BOT_FILL = {
  publicTarget: { tdm: 6, tactical: 6 },   // total de participantes (pessoas + bots)
  fillDelay: 8,                            // s com pessoas no lobby antes de completar com bots
  publicDifficulty: 'normal',
  maxPrivateBots: 9,
};
