import { useState } from 'react';
import { useT } from '../../i18n';
import { affixById, PRIMARY_STATS, STAT_LABEL } from '../../meta/affixes';
import { generalById, weaponById } from '../../meta/catalog';
import { useLocalProfile } from '../../meta/localProfile';
import { baseFits, GEAR_SLOTS, INVENTORY_CAP, itemBase, itemEffect, RARITY_LABEL, REFORGE, rollItem, SALVAGE, SLOT_LABEL, type GearSlot, type Item } from '../../meta/loot';
import { equipItemProblem, gearOf, generalState, reforgeProblem, wearerOf, type Profile } from '../../meta/rules';
import { COMMANDERS } from '../../sim/grand/regions';
import { MOD_LABEL } from './TalentTree';

const pct = (f: number) => `+${Math.round((f - 1) * 1000) / 10}%`;

/**
 * Placeholder icons until painted ones exist (docs/design-growth.md lists the art): one line drawing per kind of
 * piece, in the rarity's colour. Weapons with a 3D model also show in the figure's hand when worn.
 */
const ICON: Record<string, string> = {
  sword: 'M6 26 L22 10 L25 7 L26 6 M8 20 L12 24 M5 27 L7 25',
  spear: 'M5 27 L25 7 M25 7 L27 3 L23 5 Z M21 9 L23 11',
  bow: 'M9 4 C26 10 26 22 9 28 M9 4 L9 28',
  armor: 'M8 8 L16 5 L24 8 L23 20 L16 27 L9 20 Z M12 12 L20 12 M12 16 L20 16',
  trinket: 'M8 26 L22 8 M20 6 L26 10 M18 8 C20 5 24 5 25 8',
  book: 'M7 6 L16 9 L25 6 L25 25 L16 28 L7 25 Z M16 9 L16 28',
  seal: 'M9 15 L23 15 L23 26 L9 26 Z M12 15 C12 9 20 9 20 15 M13 20 L19 20',
};
const iconOf = (item: Item) => {
  const base = itemBase(item.base);
  if (base?.slot !== 'weapon') return ICON[base?.slot ?? 'trinket']!;
  return ICON[weaponById(base.weapon ?? '')?.kind ?? 'sword']!;
};

export function ItemIcon({ item, size = 40 }: { item: Item; size?: number }) {
  const base = itemBase(item.base);
  // Weapons use their painted cards (the 무기 picker's); every other piece has its own (scripts/item-icons.mjs).
  const src = base?.weapon ? `ui/weapons/${base.weapon}.webp` : base ? `ui/items/${base.id}.webp` : null;
  if (src) return <img className={`loot-icon loot-icon--img loot-icon--${item.rarity}`} src={`${import.meta.env.BASE_URL}${src}`} alt="" width={size} height={size} loading="lazy" />;
  return (
    <svg className={`loot-icon loot-icon--${item.rarity}`} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d={iconOf(item)} />
    </svg>
  );
}

/** The worn pieces' factors multiplied together, in the order of MOD_LABEL. */
function combined(items: Item[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) for (const [k, v] of Object.entries(itemEffect(i))) out[k] = (out[k] ?? 1) * v!;
  return Object.fromEntries(Object.keys(MOD_LABEL).filter((k) => out[k]).map((k) => [k, out[k]!]));
}

const nameOf = (id: string) => COMMANDERS.find((c) => c.id === id)?.name ?? id;

/** The general's five gear slots, then the account's loot with the picked piece's card. */
export function Inventory({ id, profile }: { id: string; profile: Profile }) {
  const t = useT();
  const equipItem = useLocalProfile((s) => s.equipItem);
  const [slot, setSlot] = useState<GearSlot | 'all'>('all');
  const [pick, setPick] = useState<string | null>(null);
  const gear = generalState(profile, id).gear ?? {};
  const worn = gearOf(profile, id);
  // The bag shows what this general's war and navy can carry; the other wars' pieces wait under their own navies.
  const faction = generalById(id)?.faction ?? '';
  const usable = profile.items.filter((i) => { const b = itemBase(i.base); return !!b && baseFits(b, faction); });
  const items = usable.filter((i) => slot === 'all' || itemBase(i.base)?.slot === slot);
  const picked = profile.items.find((i) => i.uid === pick) ?? null;
  return (
    <section className="loot" aria-label={t('장비와 전리품')}>
      <div className="loot-slots" role="list" aria-label={t('장비')}>
        {GEAR_SLOTS.map((s) => {
          const item = profile.items.find((i) => i.uid === gear[s]);
          return (
            <button key={s} role="listitem" data-slot={s} className={`loot-slot${item ? ` loot-slot--${item.rarity}` : ''}${slot === s ? ' loot-slot--on' : ''}`} onClick={() => { setSlot(s); setPick(item?.uid ?? null); }}>
              {item ? <ItemIcon item={item} size={34} /> : <span className="loot-slot__empty" aria-hidden="true">+</span>}
              <small>{t(SLOT_LABEL[s])}</small>
              {item && <b>{t(itemBase(item.base)?.name ?? '')}</b>}
            </button>
          );
        })}
      </div>
      {worn.length > 0 && <p className="loot-total">{t('장비 효과')}: {Object.entries(combined(worn)).map(([k, v]) => `${t(MOD_LABEL[k]!)} ${pct(v)}`).join(' · ')}</p>}
      <div className="loot-bag">
        <header>
          <h3>{t('전리품')} <small>{usable.length} · {t('가방')} {profile.items.length} / {INVENTORY_CAP}</small></h3>
          <div className="loot-filter" role="tablist">
            {(['all', ...GEAR_SLOTS] as const).map((s) => (
              <button key={s} role="tab" aria-selected={slot === s} className={slot === s ? 'loot-filter--on' : ''} onClick={() => setSlot(s)}>{t(s === 'all' ? '전체' : SLOT_LABEL[s])}</button>
            ))}
          </div>
        </header>
        {items.length === 0 ? (
          <p className="loot-empty">{t('전투에서 이기면 칼·창·활·방구·등채·병서·인장을 얻습니다. 별이 많고 많이 격침할수록 귀한 것이 나옵니다.')}</p>
        ) : (
          <div className="loot-grid">
            {items.map((i) => {
              const who = wearerOf(profile, i.uid);
              return (
                <button key={i.uid} data-item={i.uid} className={`loot-item loot-item--${i.rarity}${pick === i.uid ? ' loot-item--pick' : ''}`} onClick={() => setPick(i.uid)} title={t(itemBase(i.base)?.name ?? '')}>
                  <ItemIcon item={i} />
                  {who && <span className="loot-item__worn">{t(nameOf(who)).slice(0, 3)}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {picked && <ItemCard key={picked.uid} item={picked} generalId={id} profile={profile} onEquip={(s, u) => equipItem(id, s, u)} onGone={() => setPick(null)} />}
    </section>
  );
}

function ItemCard({ item, generalId, profile, onEquip, onGone }: { item: Item; generalId: string; profile: Profile; onEquip: (slot: GearSlot, uid: string | null) => void; onGone: () => void }) {
  const t = useT();
  const salvage = useLocalProfile((s) => s.salvage);
  const reforge = useLocalProfile((s) => s.reforge);
  const [armed, setArmed] = useState(false);
  const base = itemBase(item.base)!;
  const roll = rollItem(item);
  const who = wearerOf(profile, item.uid);
  const mine = who === generalId;
  const why = equipItemProblem(profile, generalId, base.slot, item.uid);
  const reforgeWhy = reforgeProblem(profile, item.uid);
  return (
    <article className={`loot-card loot-card--${item.rarity}`} data-item-card={item.uid}>
      <header>
        <ItemIcon item={item} size={52} />
        <div>
          <span className="loot-card__rarity">{t(RARITY_LABEL[item.rarity])} · {t(SLOT_LABEL[base.slot])}</span>
          <h4>{t(base.name)} <small>{base.hanja}</small></h4>
          <p>{t(base.line)}{(base.weapon || base.model) && ` · ${t(baseFits(base, generalById(generalId)?.faction ?? '') ? '장착하면 3D 모습에 보입니다' : '이 제독이 쓸 수 없는 무기')}`}</p>
        </div>
      </header>
      <div className="gen-armor-roll__stats">
        {PRIMARY_STATS.map((k) => <span key={k} className={roll.stats[k] ? '' : 'gen-armor-roll__zero'}><b>{roll.stats[k]}</b>{t(STAT_LABEL[k])}</span>)}
      </div>
      {roll.affixes.length > 0 && (
        <ul className="gen-armor-roll__affixes">
          {roll.affixes.map((a) => {
            const af = affixById(a.id);
            return <li key={a.id} className={`gen-affix gen-affix--${af?.rarity ?? 'common'}`}><b>{t(af?.label ?? a.id)}</b><small>{Object.entries(a.values).map(([k, v]) => `${t(MOD_LABEL[k]!)} ${pct(1 + v!)}`).join(' · ')}</small></li>;
          })}
        </ul>
      )}
      <p className="gen-armor-roll__total">{Object.entries(itemEffect(item)).map(([k, v]) => `${t(MOD_LABEL[k]!)} ${pct(v!)}`).join(' · ')}</p>
      {who && !mine && <p className="loot-card__who">{t('{n}이(가) 지니고 있습니다', { n: t(nameOf(who)) })}</p>}
      <div className="loot-card__actions">
        {mine ? (
          <button onClick={() => onEquip(base.slot, null)}>{t('해제')}</button>
        ) : (
          <button className="loot-card__equip" disabled={!!why} title={why ? t(why) : undefined} onClick={() => onEquip(base.slot, item.uid)}>{t('장착')}</button>
        )}
        <button disabled={!!reforgeWhy} title={reforgeWhy ? t(reforgeWhy) : undefined} onClick={() => reforge(item.uid)}>{t('다시 벼리기')} <small>{REFORGE[item.rarity].toLocaleString()}</small></button>
        <button className={armed ? 'loot-card__salvage--armed' : ''} onClick={() => { if (armed) { salvage(item.uid); onGone(); } else setArmed(true); }} onBlur={() => setArmed(false)}>
          {armed ? t('정말 분해할까요?') : t('분해')} <small>+{SALVAGE[item.rarity].toLocaleString()}</small>
        </button>
      </div>
      <p className="loot-card__src">{t('출처')}: {item.src} · #{item.uid}{item.rerolls ? ` · ${t('벼림 {n}회', { n: item.rerolls })}` : ''}</p>
    </article>
  );
}
