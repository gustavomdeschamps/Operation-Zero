// Registro dos mapas jogáveis. Cada mapa (shared/maps/*.js) descreve geometria, setores, pontos de
// surgimento, objetivos e tema visual num único lugar.
//
// O layout é descrito por chamadas a um "builder". O cliente (map.js) implementa um builder
// visual (malhas, materiais, sinalização); o servidor e a física usam o builder de colisão de
// arena-collision.js, que registra apenas as caixas sólidas. Assim, visual, movimento, tiros e
// validação do servidor derivam do MESMO código — não existem duas versões de um mapa.
//
// Interface do builder (métodos não implementados pelo builder de colisão são apenas visuais):
//   box(x0,x1,y0,y1,z0,z1, material, { collide=true, texel, worldUV, castShadow })
//   solid(x0,x1,y0,y1,z0,z1, surface)      colisor sem malha própria
//   crate(x0,x1,y0,y1,z0,z1)                caixa sólida com UV por face
//   paint / lightBar / pipe / barrel / cylinder / torus / floorRing / sign / floorLetter /
//   wallLetter / ammoStationVisual / siteMarker / water / crane   somente visual

import { FOUNDRY7 } from './maps/foundry7.js';
import { VESPER } from './maps/vesper.js';
import { DEFAULT_MAP } from './catalog.js';

export const MAP_DEFS = { [FOUNDRY7.id]: FOUNDRY7, [VESPER.id]: VESPER };

/** Definição do mapa (identificadores desconhecidos caem no mapa padrão). */
export const getMapDef = (id = DEFAULT_MAP) => MAP_DEFS[id] || MAP_DEFS[DEFAULT_MAP];

export function zoneAt(x, z, mapId = DEFAULT_MAP) {
  const def = getMapDef(mapId);
  for (const zn of def.zones) if (x >= zn.minX && x <= zn.maxX && z >= zn.minZ && z <= zn.maxZ) return zn.name;
  return def.name;
}

export function siteAt(x, z, mapId = DEFAULT_MAP) {
  for (const s of Object.values(getMapDef(mapId).sites)) if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) return s.id;
  return null;
}

/** Constrói o mapa inteiro com o builder informado. */
export function buildArenaLayout(b, mapId = DEFAULT_MAP) { getMapDef(mapId).build(b); }

/** Marcadores visuais dos objetivos A/B (somente no modo tático online). */
export function siteMarkers(b, mapId = DEFAULT_MAP) {
  for (const s of Object.values(getMapDef(mapId).sites)) b.siteMarker(s);
}

export { stairs } from './maps/parts.js';

// Compatibilidade: constantes do Foundry-7 (mapa do treino offline e padrão das salas).
export const BOUNDS = FOUNDRY7.bounds;
export const ZONES = FOUNDRY7.zones;
export const AMMO_STATIONS = FOUNDRY7.ammoStations;
export const OFFLINE_SPAWN = FOUNDRY7.offlineSpawn;
export const BOT_SPAWNS = FOUNDRY7.botSpawns;
export const ONLINE_SPAWNS = FOUNDRY7.onlineSpawns;
export const SITES = FOUNDRY7.sites;
