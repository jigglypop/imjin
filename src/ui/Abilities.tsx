import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Engine } from '../game/Engine';
import { t as tr, useT } from '../i18n';
import { ABILITIES, abilityAnchor, type AbilityId } from '../sim/abilities';
import type { Squadron } from '../sim/types';
import { pushToast, type GameSnapshot } from '../state/store';
import { tCommander, tName } from './battleNames';
import './abilities.css';

/** F1 to F4 call the first four commanders: every letter is an order or a camera key, and the digits pick groups. */
const HOTKEYS = ['F1', 'F2', 'F3', 'F4'];
/** One glyph of the ability's name, written large on its seal. */
const GLYPH: Record<AbilityId, string> = { crane_wing: '鶴', volley: '齊', ram: '衝', rally: '死', fire_arrows: '火', boarding: '登', ambush: '奇', smoke: '煙', bulwark: '壁', tide: '潮' };
/** How long a banner stays on screen, in seconds of real time. */
const BANNER_TIME = 2.8;

type Banner = { key: number; hanja: string; name: string; who: string; own: boolean; born: number };

/** The player's squadrons whose commander has an ability, in the order the cards show them. */
function commanders(engine: Engine): Squadron[] {
  return engine.battle.squadrons.filter((q) => q.ability && q.owner === engine.owner && q.shipIds.some((id) => engine.battle.isActive(engine.battle.get(id))));
}

/** Uses a commander's ability, or says why it cannot be used yet. */
function call(engine: Engine, sq: Squadron) {
  const b = engine.battle;
  const name = tr(ABILITIES[sq.ability!].name);
  if (!abilityAnchor(b, sq)) {
    pushToast(tr('대장선을 잃어 {name|을/를} 쓸 수 없습니다', { name }), 'bad');
    return;
  }
  if (b.time < (sq.abilityUntil ?? 0)) return;
  const wait = Math.ceil((sq.abilityReady ?? 0) - b.time);
  if (wait > 0) {
    pushToast(tr('{name} · {s}초 뒤에 다시 쓸 수 있습니다', { name, s: wait }));
    return;
  }
  engine.issue({ type: 'ability', squadron: sq.id });
}

/**
 * The commanders' abilities: one seal per squadron whose commander has one, above the commander cards. The seal's
 * dark sweep is the cooldown, its glow and the thin bar under it the time the ability still runs. A tap or F1-F4 uses
 * it. Also shows the banner when any commander in sight calls on his ability.
 */
export function AbilityTray({ engine, snap }: { engine: Engine; snap: GameSnapshot }) {
  const t = useT();
  const b = engine.battle;
  const list = commanders(engine);
  const listRef = useRef(list);
  listRef.current = list;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const i = HOTKEYS.indexOf(e.code);
      if (i < 0 || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return;
      e.preventDefault();
      const sq = listRef.current[i];
      if (sq) call(engine, sq);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine]);

  return (
    <>
      <AbilityBanners engine={engine} time={snap.time} />
      {list.length > 0 && (
        <div className="abilities interactive" role="toolbar" aria-label={t('장수 특기')}>
          {list.map((sq, i) => {
            const def = ABILITIES[sq.ability!];
            const left = Math.max(0, (sq.abilityUntil ?? 0) - b.time);
            const wait = Math.max(0, (sq.abilityReady ?? 0) - b.time);
            const lost = !abilityAnchor(b, sq);
            const active = left > 0 && !lost;
            const cooling = !active && wait > 0 && !lost;
            const key = HOTKEYS[i];
            const style = {
              '--cd': cooling ? Math.min(1, wait / (def.cooldown - def.duration)) : 0,
              '--run': active ? left / def.duration : 0,
            } as CSSProperties;
            const state = lost ? t('대장선을 잃었습니다') : active ? t('{s}초 남음', { s: Math.ceil(left) }) : cooling ? t('{s}초 뒤 사용 가능', { s: Math.ceil(wait) }) : t('사용 가능');
            return (
              <button
                key={sq.id}
                className={`ability f-${sq.faction}${active ? ' ability--on' : ''}${cooling ? ' ability--cool' : ''}${lost ? ' ability--lost' : ''}${!active && !cooling && !lost ? ' ability--ready' : ''}`}
                style={style}
                onClick={() => call(engine, sq)}
                aria-label={`${t(def.name)} · ${tCommander(sq.commander)} · ${state}`}
              >
                <span className="ability-seal">
                  <span className="ability-glyph" lang="zh-Hant">{GLYPH[def.id]}</span>
                  {cooling && <span className="ability-wait">{Math.ceil(wait)}</span>}
                  <img className="ability-face" src={`/ui/portraits/${sq.portrait}.jpg`} alt="" />
                  {key && <kbd className="ability-key">{key}</kbd>}
                </span>
                <span className="ability-name">{t(def.name)}</span>
                <span className="ability-run" />
                <span className="ability-tip" role="tooltip">
                  <b>
                    {t(def.name)} <span lang="zh-Hant">{def.hanja}</span>
                  </b>
                  <span className="ability-tip-who">
                    {tCommander(sq.commander)} · {tName(sq.name)}
                  </span>
                  <span>{t(def.desc)}</span>
                  <span className="ability-tip-meta">
                    {t(typeof def.area === 'number' ? '기함 둘레 {r}m' : '대장의 함대', { r: def.area as number })} · {t('{s}초 지속', { s: def.duration })} · {t('재사용 {s}초', { s: def.cooldown })}
                  </span>
                  <span className="ability-tip-meta">
                    {state}
                    {key ? ` · ${key}` : ''}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

/**
 * A calligraphic banner across the top of the screen when a commander calls on his ability: the hanja large, the
 * name and the commander under it, in the gold of the player's side or the red of the enemy's. It watches the
 * squadrons' timers, so a local battle and a server's battle show it the same way.
 */
function AbilityBanners({ engine, time }: { engine: Engine; time: number }) {
  const t = useT();
  const seen = useRef(new Map<number, number>());
  const battle = useRef(engine.battle);
  const [banners, setBanners] = useState<Banner[]>([]);
  const counter = useRef(0);

  useEffect(() => {
    const b = engine.battle;
    if (battle.current !== b) {
      battle.current = b;
      seen.current.clear();
      setBanners([]);
    }
    const fresh: Banner[] = [];
    for (const sq of b.squadrons) {
      if (!sq.ability) continue;
      const until = sq.abilityUntil ?? 0;
      const before = seen.current.get(sq.id);
      seen.current.set(sq.id, until);
      // The first look only learns the timers: a battle joined or reloaded mid-ability does not replay its banner.
      if (before === undefined || until <= before || until <= b.time) continue;
      const def = ABILITIES[sq.ability];
      const own = sq.team === engine.team;
      fresh.push({ key: (counter.current += 1), hanja: def.hanja, name: t(def.name), who: own ? tCommander(sq.commander) : t('적장 {name}', { name: tCommander(sq.commander) }), own, born: performance.now() });
    }
    const now = performance.now();
    setBanners((list) => {
      const kept = list.filter((x) => now - x.born < BANNER_TIME * 1000);
      return fresh.length || kept.length !== list.length ? [...kept, ...fresh].slice(-2) : list;
    });
  }, [engine, time]);

  // Banners leave on their own clock: the snapshot stops while the battle is paused.
  useEffect(() => {
    if (!banners.length) return;
    const id = window.setTimeout(() => setBanners((list) => list.filter((x) => performance.now() - x.born < BANNER_TIME * 1000)), BANNER_TIME * 1000 + 50);
    return () => window.clearTimeout(id);
  }, [banners]);

  if (!banners.length) return null;
  return (
    <div className="ability-banners" aria-live="polite">
      {banners.map((x) => (
        <div key={x.key} className={`ability-banner ${x.own ? 'ability-banner--own' : 'ability-banner--foe'}`}>
          <span className="ability-banner-hanja" lang="zh-Hant">{x.hanja}</span>
          <span className="ability-banner-text">
            <b>{x.name}</b>
            <span>{x.who}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
