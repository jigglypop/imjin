import { useEffect, useRef, useState } from 'react';
import type { Engine } from '../game/Engine';
import { t as tr, useT } from '../i18n';
import type { Battle } from '../sim/battle';
import type { Ship } from '../sim/types';
import { pushToast, type GameSnapshot } from '../state/store';
import { tName } from './battleNames';
import './abilities.css';

/** An enemy ship lost within this many seconds of battle time of the last one keeps a streak going. */
const STREAK_GAP = 25;
/** Streak lengths worth a callout; a great battle would otherwise call one every few seconds. */
const STREAK_MARKS = new Set([2, 3, 5, 8, 12, 20, 30]);
const CALLOUT_TIME = 2.6;

/**
 * What the feed has seen of a battle, kept for the medals on the result card: which ships are lost, when the first
 * enemy flagship went down, and the flagships and ships each side started with.
 */
type FeedRecord = { down: Set<number>; enemyFlagship: number; ownFlagships: number; enemyFlagships: number; flagshipDownAt: number; ownFlagshipLost: boolean; streak: number; lastKill: number };
const records = new WeakMap<Battle, FeedRecord>();

/** A ship that is out of the fight for good: sunk, sinking or taken. A ship that got away is not. */
const lost = (s: Ship) => s.sinking > 0 || s.struck;

function recordOf(engine: Engine): FeedRecord {
  const b = engine.battle;
  let r = records.get(b);
  if (!r) {
    r = { down: new Set(), enemyFlagship: 0, ownFlagships: 0, enemyFlagships: 0, flagshipDownAt: -1, ownFlagshipLost: false, streak: 0, lastKill: -Infinity };
    for (const s of b.ships) {
      if (!s.flagship) continue;
      if (s.team === engine.team) r.ownFlagships += 1;
      else r.enemyFlagships += 1;
    }
    records.set(b, r);
  }
  return r;
}

type Callout = { key: number; hanja: string; title: string; sub: string; own: boolean; big: boolean; born: number };

/**
 * Announcements over the battle: a banner when a flagship goes down (the enemy's a triumph, the player's a blow, and
 * its commander's ability is lost with it), and a callout for a run of enemy ships lost one after another.
 * It compares the ships at each snapshot, so it reads a local battle and a server's battle the same way.
 */
export function BattleFeed({ engine, snap }: { engine: Engine; snap: GameSnapshot }) {
  const t = useT();
  const [callouts, setCallouts] = useState<Callout[]>([]);
  const counter = useRef(0);
  const battle = useRef<Battle | null>(null);

  useEffect(() => {
    const b = engine.battle;
    const r = recordOf(engine);
    const fresh: Callout[] = [];
    const first = battle.current !== b;
    battle.current = b;
    const shout = (hanja: string, title: string, sub: string, own: boolean, big: boolean) => fresh.push({ key: (counter.current += 1), hanja, title, sub, own, big, born: performance.now() });
    for (const s of b.ships) {
      if (r.down.has(s.id) || !lost(s) || s.observed === false) continue;
      r.down.add(s.id);
      // Ships already lost when the feed first looks (a rejoined online battle) are counted, not announced.
      if (first) continue;
      const enemy = s.team !== engine.team;
      if (s.flagship) {
        if (enemy) {
          if (r.flagshipDownAt < 0) r.flagshipDownAt = b.time;
          shout('擊沈', t('적 대장선 격침!'), tName(s.name), true, true);
          pushToast(t('공훈 · 적 대장선을 격침했습니다'), 'good');
        } else {
          r.ownFlagshipLost = true;
          shout('痛哭', t('아군 대장선 상실'), t('{name} · 장수의 특기를 잃었습니다', { name: tName(s.name) }), false, true);
        }
      }
      if (!enemy) continue;
      r.streak = b.time - r.lastKill <= STREAK_GAP ? r.streak + 1 : 1;
      r.lastKill = b.time;
      if (STREAK_MARKS.has(r.streak) && !s.flagship) {
        shout('連破', r.streak >= 5 ? t('파죽지세') : t('연속 격침'), t('{n}척 연속 격침', { n: r.streak }), true, false);
      }
    }
    const now = performance.now();
    setCallouts((list) => {
      const kept = list.filter((x) => now - x.born < CALLOUT_TIME * 1000);
      return fresh.length || kept.length !== list.length ? [...kept, ...fresh].slice(-2) : list;
    });
  }, [engine, snap.time]);

  useEffect(() => {
    if (!callouts.length) return;
    const id = window.setTimeout(() => setCallouts((list) => list.filter((x) => performance.now() - x.born < CALLOUT_TIME * 1000)), CALLOUT_TIME * 1000 + 50);
    return () => window.clearTimeout(id);
  }, [callouts]);

  if (!callouts.length) return null;
  return (
    <div className="feed-callouts" aria-live="polite">
      {callouts.map((x) => (
        <div key={x.key} className={`ability-banner ${x.own ? 'ability-banner--own' : 'ability-banner--foe'} ${x.big ? '' : 'feed-callout--small'}`}>
          <span className="ability-banner-hanja" lang="zh-Hant">{x.hanja}</span>
          <span className="ability-banner-text">
            <b>{x.title}</b>
            <span>{x.sub}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

type Goal = { label: string; done: boolean };

/**
 * The bonus objectives of a historical battle, judged when it ends: sink an enemy flagship, keep every flagship of
 * one's own, and win at little cost. A victory earns a medal for how many were met: gold for all three.
 */
export function BattleMedals({ engine, snap }: { engine: Engine; snap: GameSnapshot }) {
  const t = useT();
  if (snap.mode !== 'scenario') return null;
  const r = recordOf(engine);
  const allowed = Math.max(1, Math.floor(snap.ownTotal * 0.1));
  const losses = snap.ownTotal - snap.own;
  const goals: Goal[] = [];
  if (r.enemyFlagships > 0) goals.push({ label: tr('적 대장선 격침'), done: r.flagshipDownAt >= 0 });
  if (r.ownFlagships > 0) goals.push({ label: tr('아군 대장선 보전'), done: !r.ownFlagshipLost });
  goals.push({ label: tr('아군 손실 {n}척 이하', { n: allowed }), done: losses <= allowed });
  const won = snap.winner === snap.team;
  const met = goals.filter((g) => g.done).length;
  const medal = !won ? null : met === goals.length ? 'gold' : met >= goals.length - 1 && met > 0 ? 'silver' : met > 0 ? 'bronze' : null;
  const MEDAL = { gold: ['金', '금 훈장'], silver: ['銀', '은 훈장'], bronze: ['銅', '동 훈장'] } as const;
  return (
    <div className="medals">
      {medal && (
        <div className={`medal medal--${medal}`} title={t(MEDAL[medal][1])}>
          <span lang="zh-Hant">{MEDAL[medal][0]}</span>
        </div>
      )}
      <ul className="medal-goals">
        {goals.map((g) => (
          <li key={g.label} className={g.done ? 'medal-goal--done' : ''}>
            <i aria-hidden>{g.done ? '✓' : '·'}</i>
            {g.label}
          </li>
        ))}
        {medal && <li className="medal-name">{t(MEDAL[medal][1])}</li>}
      </ul>
    </div>
  );
}
