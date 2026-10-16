import { CONQUEST_MAPS } from '../src/sim/maps';
import { SCENARIOS } from '../src/sim/scenarios';
import { FACTIONS } from '../src/sim/types';
import { SESSION_RULE } from '../src/account/wire';
import type { ClientMsg } from '../src/net/protocol';

/** A name or a line of chat as others see it: no control characters or angle brackets, trimmed, at most `max` long. */
export const clean = (text: unknown, max: number) => String(text ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;
const index = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 4;
const faction = (value: unknown) => typeof value === 'string' && FACTIONS.includes(value as (typeof FACTIONS)[number]);

function choice(value: unknown) {
  if (!record(value)) return false;
  if (value.kind === 'scenario') return typeof value.id === 'string' && Object.hasOwn(SCENARIOS, value.id);
  return value.kind === 'conquest' && typeof value.map === 'string' && Object.hasOwn(CONQUEST_MAPS, value.map) && (value.size === 2 || value.size === 4);
}

/** JSON has no TypeScript types. Validate the lobby fields before indexing seats or building a room. */
export function clientMessage(value: unknown): ClientMsg | null {
  if (!record(value) || typeof value.t !== 'string') return null;
  let valid = false;
  switch (value.t) {
    case 'hello':
      valid = text(value.name, 256) && typeof value.v === 'number' && Number.isInteger(value.v) && (value.token === undefined || (typeof value.token === 'string' && /^[a-f0-9]{32}$/.test(value.token))) && (value.account === undefined || (typeof value.account === 'string' && /^[a-f0-9]{64}$/.test(value.account))) && (value.session === undefined || (typeof value.session === 'string' && SESSION_RULE.test(value.session)));
      break;
    case 'create':
      valid = text(value.name, 256) && choice(value.battle);
      break;
    case 'join':
      valid = typeof value.room === 'string' && /^[a-z]{4}$/i.test(value.room);
      break;
    case 'take':
      valid = index(value.index);
      break;
    case 'seat':
      valid = index(value.index) && (value.faction !== undefined || value.human !== undefined) && (value.faction === undefined || faction(value.faction)) && (value.human === undefined || typeof value.human === 'boolean');
      break;
    case 'ready':
      valid = typeof value.ready === 'boolean';
      break;
    case 'quick':
      valid = choice(value.battle) && faction(value.faction);
      break;
    case 'ranked':
      valid = faction(value.faction);
      break;
    case 'ping':
      valid = typeof value.at === 'number' && Number.isFinite(value.at);
      break;
    case 'chat':
      valid = text(value.text, 4096);
      break;
    case 'cmd':
      // The simulation validates each command's fields and ownership before applying it.
      valid = record(value.cmd) && typeof value.cmd.type === 'string';
      break;
    case 'list':
    case 'leave':
    case 'start':
    case 'quickCancel':
    case 'rankedCancel':
    case 'rankedProfile':
    case 'leaderboard':
    case 'rematch':
    case 'loaded':
      valid = true;
      break;
  }
  return valid ? (value as ClientMsg) : null;
}
