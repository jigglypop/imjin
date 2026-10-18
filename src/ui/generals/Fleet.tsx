import { useState } from 'react';
import { useT } from '../../i18n';
import { generalById } from '../../meta/catalog';
import { useLocalProfile } from '../../meta/localProfile';
import {
  admiralsOf, buyShipProblem, famousOf, fleetSize, fleetValue, NATION_CHANGES, NATIONS, nationById, nationProblem, RECRUIT_PRICE, recruitProblem,
  CHAPTER_LABEL, SELLBACK, serving, shipKindsOf, shipPrice, startingFleet, type NationDef,
} from '../../meta/fleet';
import { generalMods, generalState, levelProgress, skillPointsLeft, type Profile } from '../../meta/rules';
import { treeOf } from '../../meta/talents';
import { SHORT_NAME } from '../../sim/conquest';
import { shipTier } from '../../sim/points';
import type { ShipKind } from '../../sim/types';
import { COMMANDERS } from '../../sim/grand/regions';
import { portraitUrl } from '../portrait';
import { MOD_LABEL } from './TalentTree';
import { CHAPTER_COMMANDERS } from './chapterCast';

/**
 * The account's own navy on the 제독 screen: the nation pick on first entry, the fleet overview (hulls, admirals in
 * service, the nation rule), and the admiral sheet's level and factor blocks. Rules: src/meta/fleet.ts.
 */
type T = ReturnType<typeof useT>;
const commander = (id: string) => COMMANDERS.find((c) => c.id === id) ?? CHAPTER_COMMANDERS.find((c) => c.id === id);
export const admiralName = (id: string) => commander(id)?.name ?? id;
export const admiralTitle = (id: string) => commander(id)?.title ?? '';
export const admiralPortrait = (id: string, small = true) => portraitUrl(commander(id)?.portrait ?? `portrait_${id}`, small);
const TIER_LABEL = { 1: '경선', 2: '중선', 3: '주력선', 4: '대선' } as const;

function fleetLine(t: T, ships: Partial<Record<ShipKind, number>>) {
  return (Object.entries(ships) as [ShipKind, number][]).map(([k, n]) => `${t(SHORT_NAME[k])} ×${n}`).join(' · ');
}

/** First entry: the account picks the one navy it will raise, from every chapter's navies. */
export function NationPick() {
  const t = useT();
  const choose = useLocalProfile((s) => s.chooseNation);
  const [pick, setPick] = useState<NationDef['id'] | null>(null);
  const chosen = nationById(pick);
  const chapters = [...new Set(NATIONS.map((n) => n.chapter))];
  return (
    <section className="fleet-pick" aria-label={t('나라 고르기')}>
      <header className="fleet-pick__head">
        <h2>{t('섬길 나라를 고르세요')}</h2>
        <p>{t('계정마다 한 나라의 수군을 키웁니다. 고른 나라의 이름난 제독과 첫 함대가 합류하고, 다른 제독과 함선은 엽전으로 늘립니다.')}</p>
      </header>
      {chapters.map((ch) => (
        <div key={ch} className="fleet-pick__chapter">
          <h3 className="fleet-pick__chapter-title">{t(CHAPTER_LABEL[ch])}</h3>
          <div className="fleet-pick__cards" role="radiogroup" aria-label={t(CHAPTER_LABEL[ch])}>
            {NATIONS.filter((n) => n.chapter === ch).map((n) => {
              const ships = startingFleet(n.id);
              const start = famousOf(n.id);
              const later = admiralsOf(n.id).filter((id) => !start.includes(id));
              return (
                <button key={n.id} role="radio" aria-checked={pick === n.id} data-nation={n.id} className={`fleet-nation fleet-nation--${n.id}${pick === n.id ? ' fleet-nation--on' : ''}`} onClick={() => setPick(n.id)}>
                  <span className="fleet-nation__top">
                    <i className={`emblem emblem--${n.id}`} aria-hidden="true" />
                    <span>
                      <b>{t(n.name)}</b>
                      <small>{n.hanja}</small>
                    </span>
                  </span>
                  <span className="fleet-nation__line">{t(n.line)}</span>
                  <span className="fleet-nation__label">{t('처음부터 합류 {n}', { n: start.length })}</span>
                  <span className="fleet-nation__faces">
                    {start.map((id) => (
                      <span key={id} className="fleet-face">
                        <img src={admiralPortrait(id)} alt="" width={52} height={52} loading="lazy" />
                        <small>{t(admiralName(id))}</small>
                      </span>
                    ))}
                  </span>
                  {later.length > 0 && <>
                    <span className="fleet-nation__label fleet-nation__label--later">{t('나중에 맞이하는 제독 {n}', { n: later.length })}</span>
                    <span className="fleet-nation__faces fleet-nation__faces--later">
                      {later.map((id) => (
                        <span key={id} className="fleet-face fleet-face--later">
                          <img src={admiralPortrait(id)} alt="" width={40} height={40} loading="lazy" />
                          <small>{t(admiralName(id))}</small>
                        </span>
                      ))}
                    </span>
                  </>}
                  <span className="fleet-nation__label">{t('첫 함대 {n}척', { n: Object.values(ships).reduce((a, b) => a + (b ?? 0), 0) })}</span>
                  <span className="fleet-nation__ships">{fleetLine(t, ships)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <footer className="fleet-pick__foot">
        <p>{t('나라는 나중에 한 번만 바꿀 수 있습니다. 바꾸면 함선은 값의 절반을 돌려받고, 제독의 레벨은 그대로 남지만 함께 싸우지 않습니다.')}</p>
        <button className="fleet-cta" disabled={!chosen} onClick={() => chosen && choose(chosen.id)}>
          {chosen ? t('{name}으로 시작', { name: t(chosen.name) }) : t('나라를 고르세요')}
        </button>
      </footer>
    </section>
  );
}

/** The navy at a glance: hulls by kind with building, the admirals in service, and the nation rule. */
export function FleetView({ profile, onAdmiral }: { profile: Profile; onAdmiral: (id: string) => void }) {
  const t = useT();
  const buyShip = useLocalProfile((s) => s.buyShip);
  const nation = nationById(profile.nation)!;
  const roster = admiralsOf(nation.id);
  const mine = serving(profile);
  const kinds = shipKindsOf(nation.id);
  return (
    <div className="fleet" data-nation={nation.id}>
      <section className={`fleet-banner fleet-banner--${nation.id}`}>
        <i className={`emblem emblem--${nation.id}`} aria-hidden="true" />
        <div className="fleet-banner__name">
          <h2>{t(nation.name)} <small>{nation.hanja}</small></h2>
          <p>{t(nation.line)}</p>
        </div>
        <dl className="fleet-stats">
          <div><dt>{t('제독')}</dt><dd>{mine.length}<small>/{roster.length}</small></dd></div>
          <div><dt>{t('함선')}</dt><dd>{fleetSize(profile)}<small>{t('척')}</small></dd></div>
          <div><dt>{t('함대 가치')}</dt><dd>{fleetValue(profile).toLocaleString()}</dd></div>
          <div><dt>{t('전적')}</dt><dd>{profile.stats.wins}<small>{t('{w}승 / {b}전', { w: '', b: profile.stats.battles }).trim()}</small></dd></div>
        </dl>
      </section>

      <section className="fleet-section" aria-label={t('보유 함선')}>
        <header><h3>{t('보유 함선')}</h3><p>{t('쟁탈전에서 이 나라로 싸우면 보유한 척수까지만 출전시킬 수 있습니다. 역사 전투와 온라인 대전은 정해진 함대로 싸웁니다.')}</p></header>
        <div className="fleet-ships">
          {kinds.map((k) => {
            const n = profile.ships[k] ?? 0;
            const why = buyShipProblem(profile, k, 1);
            return (
              <article key={k} className={`fleet-ship${n ? '' : ' fleet-ship--none'}`} data-ship-kind={k}>
                <div className="fleet-ship__top">
                  <b>{t(SHORT_NAME[k])}</b>
                  <small>{t(TIER_LABEL[shipTier(k)])}</small>
                </div>
                <div className="fleet-ship__count"><span>{n}</span><small>{t('척')}</small></div>
                <button className="fleet-build" disabled={!!why} title={why ? t(why) : undefined} onClick={() => buyShip(k, 1)}>
                  {t('건조')} <small>{t('{n} 엽전', { n: shipPrice(k).toLocaleString() })}</small>
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="fleet-section" aria-label={t('휘하 제독')}>
        <header><h3>{t('휘하 제독')}</h3><p>{t('이름난 제독은 처음부터 함께합니다. 다른 제독은 {n} 엽전에 맞이합니다.', { n: RECRUIT_PRICE.toLocaleString() })}</p></header>
        <div className="fleet-admirals">
          {roster.map((id) => {
            const on = mine.includes(id);
            return (
              <button key={id} className={`fleet-admiral${on ? '' : ' fleet-admiral--locked'}`} data-general-id={id} onClick={() => onAdmiral(id)}>
                <img src={admiralPortrait(id)} alt="" width={56} height={56} loading="lazy" />
                <b>{t(admiralName(id))}</b>
                <small>{on ? `Lv.${levelProgress(generalState(profile, id).xp).level}` : t('미합류')}</small>
              </button>
            );
          })}
        </div>
      </section>

      <NationChange profile={profile} />
    </div>
  );
}

function NationChange({ profile }: { profile: Profile }) {
  const t = useT();
  const choose = useLocalProfile((s) => s.chooseNation);
  const [armed, setArmed] = useState<string | null>(null);
  const left = Math.max(0, NATION_CHANGES - profile.nationChanges);
  const refund = Math.floor(fleetValue(profile) * SELLBACK);
  return (
    <section className="fleet-section fleet-change" aria-label={t('나라 바꾸기')}>
      <header>
        <h3>{t('나라 바꾸기')}</h3>
        <p>{left > 0
          ? t('한 번만 바꿀 수 있습니다. 함선은 값의 절반({n} 엽전)을 돌려받고, 지금 제독들은 레벨을 지닌 채 물러납니다.', { n: refund.toLocaleString() })
          : t('이미 나라를 바꾸었습니다. 이제 바꿀 수 없습니다.')}</p>
      </header>
      {left > 0 && (
        <div className="fleet-change__choices">
          {NATIONS.filter((n) => n.id !== profile.nation).map((n) => {
            const why = nationProblem(profile, n.id);
            return (
              <button key={n.id} className={`fleet-change__btn${armed === n.id ? ' fleet-change__btn--armed' : ''}`} disabled={!!why} onBlur={() => setArmed(null)} onClick={() => { if (armed === n.id) { choose(n.id); setArmed(null); } else setArmed(n.id); }}>
                <i className={`emblem emblem--${n.id}`} aria-hidden="true" /> {armed === n.id ? t('정말 바꿀까요?') : t(n.name)}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** An admiral of the navy not yet in service: who he is and what taking him on costs. */
export function RecruitCard({ id, profile }: { id: string; profile: Profile }) {
  const t = useT();
  const recruit = useLocalProfile((s) => s.recruit);
  const tree = treeOf(id);
  const why = recruitProblem(profile, id);
  const xp = generalState(profile, id).xp;
  return (
    <article className="adm-recruit" data-general-id={id}>
      <img src={admiralPortrait(id, false)} alt="" width={160} height={160} />
      <div>
        <span className="adm-head__title">{t(admiralTitle(id))}</span>
        <h2 className="adm-head__name">{t(admiralName(id))} {tree && <small>{tree.hanja}</small>}</h2>
        {tree && (
          <section className="gen-trait">
            <span>{t('고유 특성')}</span>
            <b>{t(tree.trait.label)}</b>
            <p>{t(tree.trait.text)}</p>
          </section>
        )}
        {xp > 0 && <p className="adm-recruit__note">{t('전에 쌓은 경험(Lv.{n})은 맞이하면 그대로 이어집니다.', { n: levelProgress(xp).level })}</p>}
        <button className="fleet-cta" disabled={!!why} title={why ? t(why) : undefined} onClick={() => recruit(id)}>
          {t('제독으로 맞이하기')} <small>{t('{n} 엽전', { n: RECRUIT_PRICE.toLocaleString() })}</small>
        </button>
        {why && why !== '엽전이 모자랍니다' && <p className="adm-recruit__note">{t(why)}</p>}
      </div>
    </article>
  );
}

const MOD_ORDER = ['reload', 'accuracy', 'fire', 'speed', 'turn', 'melee', 'defense', 'morale'] as const;
const signed = (x: number) => `${x >= 0 ? '+' : '−'}${Math.round(Math.abs(x) * 1000) / 10}%`;

/** The admiral sheet's head: name, level with its experience bar, points to spend, and the factors his ships get. */
export function AdmiralHead({ id, profile }: { id: string; profile: Profile }) {
  const t = useT();
  const tree = treeOf(id);
  const prog = levelProgress(generalState(profile, id).xp);
  const left = skillPointsLeft(profile, id);
  const mods = generalMods(profile, id);
  const pct = prog.need === null ? 100 : Math.round((prog.into / prog.need) * 100);
  const famous = generalById(id)?.famous;
  return (
    <header className="adm-head">
      <div className="adm-head__id">
        <span className="adm-head__title">{t(admiralTitle(id))}{famous && <em>{t('이름난 제독')}</em>}</span>
        <h2 className="adm-head__name">{t(admiralName(id))} {tree && <small>{tree.hanja}</small>}</h2>
      </div>
      <div className="adm-level">
        <div className="adm-level__badge" aria-label={`Lv.${prog.level}`}>
          <small>Lv</small>
          <b>{prog.level}</b>
        </div>
        <div className="adm-level__track">
          <div className="adm-level__row">
            <span>{t('경험치')}</span>
            <span>{prog.need === null ? t('최고 레벨') : `${prog.into.toLocaleString()} / ${prog.need.toLocaleString()}`}</span>
          </div>
          <div className="adm-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>
          <div className="adm-level__row adm-level__row--sub">
            <span>{prog.need === null ? '' : t('다음 레벨까지 {n}', { n: (prog.need - prog.into).toLocaleString() })}</span>
            <span className={left > 0 ? 'adm-points adm-points--on' : 'adm-points'}>{t('재능 점수 {n}', { n: left })}</span>
          </div>
        </div>
      </div>
      <ul className="adm-stats" aria-label={t('함대에 주는 능력')}>
        {MOD_ORDER.map((k) => {
          const v = mods[k] - 1;
          return (
            <li key={k} className={Math.abs(v) < 1e-6 ? 'adm-stat adm-stat--zero' : v < 0 ? 'adm-stat adm-stat--neg' : 'adm-stat'}>
              <span>{t(MOD_LABEL[k]!)}</span>
              <b>{signed(v)}</b>
            </li>
          );
        })}
      </ul>
    </header>
  );
}
