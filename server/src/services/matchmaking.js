// Registro de salas: códigos curtos, limites globais e por IP, listagem pública.
import { matchMaker } from '@colyseus/core';
import { ROOM_NAME, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, isValidRoomCode } from '../../../shared/protocol.js';
import { randomInt } from 'node:crypto';

const activeCodes = new Set();
const connectionsPerIp = new Map();

/** Gera um código curto e único (sem caracteres ambíguos). */
export function generateRoomCode() {
  for (let attempt = 0; attempt < 200; attempt++) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    if (!activeCodes.has(code)) { activeCodes.add(code); return code; }
  }
  throw new Error('Não foi possível gerar um código de sala.');
}

export function releaseRoomCode(code) { activeCodes.delete(code); }

export const activeRoomCount = () => activeCodes.size;

export function acquireIpSlot(ip, limit) {
  const key = ip || 'unknown';
  const n = connectionsPerIp.get(key) || 0;
  if (n >= limit) return false;
  connectionsPerIp.set(key, n + 1);
  return true;
}

export function releaseIpSlot(ip) {
  const key = ip || 'unknown';
  const n = (connectionsPerIp.get(key) || 1) - 1;
  if (n <= 0) connectionsPerIp.delete(key); else connectionsPerIp.set(key, n);
}

/** Salas públicas para o painel de partidas (somente dados não sensíveis). */
export async function listPublicRooms() {
  const rooms = await matchMaker.query({ name: ROOM_NAME });
  return rooms
    .filter((r) => !r.private && !r.unlisted && r.metadata)
    .map((r) => ({
      code: r.roomId,
      name: r.metadata.name,
      mode: r.metadata.mode,
      phase: r.metadata.phase,
      players: r.clients,
      maxPlayers: r.maxClients,
      joinable: !r.locked && r.clients < r.maxClients,
    }));
}

/** Situação de um código: para mensagens claras antes de tentar entrar. */
export async function describeRoomCode(code) {
  if (!isValidRoomCode(code)) return { status: 'invalid' };
  const [room] = await matchMaker.query({ name: ROOM_NAME, roomId: code });
  if (!room) return { status: 'not_found' };
  if (room.clients >= room.maxClients) return { status: 'full', mode: room.metadata?.mode };
  if (room.locked) return { status: 'in_progress', mode: room.metadata?.mode };
  return { status: 'ok', mode: room.metadata?.mode, players: room.clients, maxPlayers: room.maxClients };
}
