// OPERATION ZERO 2.0 — parâmetros de gameplay compartilhados entre cliente e servidor.
// Qualquer regra que o servidor valide (movimento, armas, fumaça, partidas) vem DESTE arquivo,
// para que a predição do cliente e a autoridade do servidor nunca divirjam.
// Unidades: metros, segundos e radianos (exceto quando indicado).

const DEG = Math.PI / 180;

export const DEG2RAD = DEG;

export const GAME = {
  pitchLimit: 88 * DEG,

  player: {
    radius: 0.32,
    height: 1.80,
    crouchHeight: 1.22,
    eyeFromTop: 0.13,
    runSpeed: 5.6,
    walkSpeed: 2.7,           // Shift — silencioso
    crouchSpeed: 2.0,
    adsSpeedMultiplier: 0.78,
    groundAccel: 60,
    groundDecel: 42,
    airAccel: 9,
    gravity: 20,
    jumpVelocity: 6.3,
    jumpBuffer: 0.12,
    coyoteTime: 0.08,
    stepHeight: 0.46,
    crouchLerp: 14,
    maxHealth: 100,
    regenDelay: 5,
    regenRate: 14,
    footstepDistance: 2.35,
    spawn: { x: 0, z: 39, yaw: 0 },
    killPlaneY: -10,
  },

  weapons: [
    {
      id: 'rifle',
      name: 'VX-9 RANGER',
      slot: 1,
      automatic: true,
      fireRate: 9.75,          // disparos por segundo
      magSize: 25,
      reserve: 100,
      reloadTime: 2.1,
      damage: 34,              // 3 tiros no corpo eliminam 100 HP
      multipliers: { head: 3.5, body: 1.0, legs: 0.82 },
      range: 160,
      spread: {
        idle: 0.0018,
        crouch: 0.0010,
        walk: 0.0110,
        run: 0.0380,
        air: 0.1000,
        adsMultiplier: 0.55,
        perShot: 0.0042,
        maxBloom: 0.032,
        bloomRecovery: 0.11,   // rad/s
        firstShotGrace: 0.24,  // tempo sem atirar para o 1º tiro voltar a ser preciso
      },
      recoil: {
        // padrão determinístico: [pitch, yaw] em graus por disparo
        pattern: [
          [0.62, 0.00], [0.70, 0.02], [0.72, -0.04], [0.68, 0.06], [0.58, 0.10],
          [0.42, 0.16], [0.30, 0.20], [0.24, 0.12], [0.22, -0.08], [0.20, -0.22],
          [0.20, -0.26], [0.18, -0.18], [0.18, 0.04], [0.18, 0.20], [0.18, 0.26],
          [0.18, 0.18], [0.16, -0.06], [0.16, -0.22], [0.16, -0.24], [0.16, -0.10],
        ],
        maxPitch: 5.2,         // graus
        recoveryDelay: 0.11,
        recoveryRate: 11.5,    // amortecimento exponencial
        punchRoll: 0.35,       // graus (apenas visual)
      },
      viewmodel: { hip: [0.215, -0.235, -0.5], ads: [0.0, -0.105, -0.3], adsFovScale: 0.82 },
    },
    {
      id: 'pistol',
      name: 'K-2 SIDEARM',
      slot: 2,
      automatic: false,
      fireRate: 6.25,
      magSize: 12,
      reserve: 48,
      reloadTime: 1.45,
      damage: 26,
      multipliers: { head: 4.0, body: 1.0, legs: 0.85 },
      range: 90,
      spread: {
        idle: 0.0024,
        crouch: 0.0016,
        walk: 0.0080,
        run: 0.0240,
        air: 0.0750,
        adsMultiplier: 0.6,
        perShot: 0.0090,
        maxBloom: 0.030,
        bloomRecovery: 0.08,
        firstShotGrace: 0.30,
      },
      recoil: {
        pattern: [[1.05, 0.05], [1.0, -0.08], [0.95, 0.1]],
        maxPitch: 4.0,
        recoveryDelay: 0.08,
        recoveryRate: 13,
        punchRoll: 0.5,
      },
      viewmodel: { hip: [0.15, -0.15, -0.4], ads: [0.0, -0.064, -0.34], adsFovScale: 0.88 },
    },
  ],

  abilities: {
    smoke: {
      key: 'KeyE',
      name: 'NÉVOA CIANO',
      duration: 5,
      cooldown: 14,
      radius: 3.6,
      height: 3.4,
      maxRange: 17,
      minRange: 1.6,
      wallOffset: 0.9,
      throwTime: 0.5,
      fadeIn: 0.55,
      fadeOut: 0.8,
      puffs: 34,
      blocksBotVision: true,     // bots não enxergam através da fumaça
      blocksBullets: false,      // disparos do jogador atravessam (documentado no README)
    },
  },

  ammoStation: {
    radius: 1.7,
    cooldown: 12,
  },

  net: {
    tickRate: 60,             // passos de simulação/entrada por segundo (cliente e servidor)
    patchRateMs: 50,          // replicação de estado (20 Hz)
    interpDelayMs: 100,       // atraso de interpolação dos jogadores remotos
    maxRewindMs: 300,         // limite da compensação de latência (anti-manipulação)
    maxInputBurst: 8,         // entradas extras processáveis num tick após oscilação de rede
    idleAfterMs: 250,         // sem entradas por mais que isso → o servidor simula entrada neutra
    reconnectSeconds: 20,     // janela de reconexão após queda inesperada
    snapDistance: 2.5,        // divergência (m) que força correção imediata
    maxShotAngleSlack: 0.006, // folga (rad) na validação do cone de dispersão
  },

  match: {
    minPlayersToStart: 2,
    defaultMaxPlayers: 10,
    maxPlayersLimit: 10,
    countdown: 5,
    resultsTime: 12,          // tempo exibindo o resultado antes de voltar ao lobby
    tdm: {
      scoreLimit: 30,
      timeLimit: 480,
      respawnDelay: 3,
      spawnProtection: 1.5,
    },
    tactical: {
      roundsToWin: 5,
      prepTime: 8,
      roundTime: 100,
      plantTime: 3.5,
      defuseTime: 5,
      detonateTime: 35,
      roundEndTime: 5,
      interactRange: 1.6,
    },
  },
};
