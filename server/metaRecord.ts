// The growth profile (src/meta/rules.ts Profile) as the rows the account stores keep it in: one row of account totals,
// the armor bought from the shop, a row per commander (experience, level, keystone, talents), the loot one row per
// piece, and what each commander wears in each gear slot. PostgreSQL keeps them in the tables of schema 2
// (accountsPg.ts MIGRATIONS); the memory store keeps the same records. The profile the rules work on is rebuilt from
// them through normalizeProfile, so nothing a row says is trusted past the rules (rolls are derived from the account).
import { GEAR_SLOTS, type GearSlot, type Rarity } from '../src/meta/loot';
import { PROFILE_VERSION, keystoneOf, levelOf, normalizeProfile, type Profile } from '../src/meta/rules';

export type MetaAccountRow = { version: number; stats: Profile['stats']; firsts: string[]; day: string; earned: number; drops: number; dropped: number };
export type ArmorRow = { armorId: string; rerolls: number };
export type CommanderRow = { commanderId: string; xp: number; level: number; keystone: string | null; respecs: number; armorId: string | null; weaponId: string | null; talents: Record<string, number> };
/** A piece of loot the account holds; `pos` is its place in the inventory. */
export type ItemRow = { uid: string; defId: string; rarity: Rarity; seed: number; reforgeCount: number; src: string; pos: number };
export type EquipmentRow = { commanderId: string; slot: GearSlot; uid: string };
export type MetaRecord = { account: MetaAccountRow; armor: ArmorRow[]; commanders: CommanderRow[]; items: ItemRow[]; equipment: EquipmentRow[] };

/** The rows of a profile (the coins stay in the ledger, the salt is the account id). */
export function recordOf(p: Profile): MetaRecord {
  const equipment: EquipmentRow[] = [];
  const commanders = Object.entries(p.generals).map(([commanderId, g]): CommanderRow => {
    for (const slot of GEAR_SLOTS) {
      const uid = g.gear?.[slot];
      if (uid) equipment.push({ commanderId, slot, uid });
    }
    return { commanderId, xp: g.xp, level: levelOf(g.xp), keystone: keystoneOf(p, commanderId)?.id ?? null, respecs: g.respecs ?? 0, armorId: g.armor ?? null, weaponId: g.weapon ?? null, talents: { ...g.talents } };
  });
  return {
    account: { version: p.v, stats: { ...p.stats }, firsts: [...p.firsts], day: p.day, earned: p.earned, drops: p.drops, dropped: p.dropped },
    armor: p.owned.map((armorId) => ({ armorId, rerolls: p.rolls[armorId]?.rerolls ?? 0 })),
    commanders,
    items: p.items.map((i, pos) => ({ uid: i.uid, defId: i.base, rarity: i.rarity, seed: i.seed, reforgeCount: i.rerolls, src: i.src, pos })),
    equipment,
  };
}

/** The profile its rows describe, through the same checks as any stored profile. */
export function profileOf(rec: MetaRecord, accountId: string, coins = 0): Profile {
  const generals: Record<string, Record<string, unknown>> = {};
  for (const c of rec.commanders) generals[c.commanderId] = { xp: c.xp, talents: c.talents, respecs: c.respecs, ...(c.armorId && { armor: c.armorId }), ...(c.weaponId && { weapon: c.weaponId }) };
  for (const e of rec.equipment) {
    const g = generals[e.commanderId];
    if (g) g.gear = { ...(g.gear as object), [e.slot]: e.uid };
  }
  const raw = {
    v: PROFILE_VERSION,
    coins,
    salt: accountId,
    owned: rec.armor.map((a) => a.armorId),
    rolls: Object.fromEntries(rec.armor.map((a) => [a.armorId, { rerolls: a.rerolls }])),
    generals,
    stats: rec.account.stats,
    firsts: rec.account.firsts,
    day: rec.account.day,
    earned: rec.account.earned,
    drops: rec.account.drops,
    dropped: rec.account.dropped,
    items: [...rec.items].sort((a, b) => a.pos - b.pos).map((i) => ({ uid: i.uid, base: i.defId, rarity: i.rarity, rerolls: i.reforgeCount, src: i.src })),
  };
  return normalizeProfile(raw, accountId);
}
