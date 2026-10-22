// OPERATION ZERO — configuração centralizada.
// Todos os valores de balanceamento, desempenho e apresentação ficam aqui.
// Unidades: metros, segundos e radianos (exceto quando indicado).

import { GAME, DEG2RAD } from './shared/game-config.js';

const DEG = DEG2RAD;

export const CONFIG = {
  version: '2.0.0',
  arenaName: 'FOUNDRY-7',
  arenaSubtitle: 'Instalação de Treinamento Tático',

  session: {
    targetKills: 30,          // eliminações necessárias para concluir o treinamento
  },

  perf: {
    maxDelta: 1 / 20,         // limite de delta time (evita saltos após pausas/travamentos)
    maxShotsPerFrame: 2,
  },

  camera: {
    fov: 78,                  // FOV vertical do mundo (graus)
    viewmodelFov: 54,
    near: 0.05,
    far: 420,
  },

  input: {
    baseSensitivity: 0.0021,  // radianos por pixel com multiplicador 1.0
    sensitivity: 1.0,
    pitchLimit: GAME.pitchLimit,
  },

  player: GAME.player,

  weapons: GAME.weapons,

  enemies: {
    health: 100,
    respawn: true,
    respawnDelay: 3.5,
    spawnInTime: 0.6,
    deathTime: 0.85,
    hitFlashTime: 0.12,
    strafeSpeed: 2.1,
    turnSpeed: 5.0,
    // combate
    fireBack: true,
    detectRange: 34,
    viewCone: 140 * Math.PI / 180,
    reactionTime: 0.65,
    telegraphTime: 0.5,
    burstShots: 3,
    burstInterval: 0.13,
    cooldownMin: 2.2,
    cooldownMax: 3.6,
    maxAggressors: 2,
    damage: 6,
    accuracy: {
      base: 0.4,
      nearDistance: 8,
      farDistance: 34,
      minimum: 0.12,
      movingMultiplier: 0.6,
      crouchMultiplier: 0.75,
      airMultiplier: 0.45,
    },
  },

  abilities: GAME.abilities,

  ammoStation: GAME.ammoStation,

  effects: {
    maxParticles: 900,
    maxDecals: 90,
    maxTracers: 28,
    tracerSpeed: 320,
    tracerLength: 3.2,
  },

  graphics: {
    presets: {
      low:    { label: 'Baixa',  pixelRatio: 1.0, shadows: false, shadowMapSize: 1024 },
      medium: { label: 'Média',  pixelRatio: 1.25, shadows: true, shadowMapSize: 2048 },
      high:   { label: 'Alta',   pixelRatio: 2.0, shadows: true, shadowMapSize: 4096 },
    },
    defaultQuality: 'medium',
    fogDensity: 0.0105,
    exposure: 1.0,
  },

  audio: {
    masterVolume: 0.7,
  },

  defaultSettings: {
    sensitivity: 1.0,
    fov: 78,
    volume: 0.7,
    quality: 'medium',
    botsFireBack: true,
    showFps: false,
    crosshairColor: '#3ef0ff',
  },

  storageKey: 'operation-zero-settings-v1',
};

export { DEG2RAD, GAME };
