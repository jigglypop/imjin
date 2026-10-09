import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { SCENARIO_ORDER, SCENARIOS, type ScenarioId } from '../sim/scenarios';
import { commanderOf, FACTION_MARK, FACTION_NAME, FACTION_SHORT, forcesOf, handicap, playableFactions } from '../sim/balance';
import type { Faction } from '../sim/types';
import { sound } from '../audio/Sound';
import { CAMPAIGN_ORDER, campaignOver, currentBattle, setMode, useCampaign } from '../campaign/campaign';
import { isPhone, isTouchOnly } from '../game/device';
import { CampaignPanel } from './CampaignPanel';
import { ErrorBoundary } from './ErrorBoundary';
import { params } from './launch';
import { StaticMap } from './StaticMap';
import { setScreen } from '../state/store';

// The 3D war-table map needs three.js and a second renderer. Phones and touch-only tablets get the flat map, so only one renderer ever exists there.
const SelectCanvas = lazy(() => import('./SelectCanvas'));
const flatMap = isPhone || isTouchOnly || params.get('map') === 'static';

const FACTION_KEY = 'imjin.faction';

function readFaction(): Faction {
  try {
    const v = localStorage.getItem(FACTION_KEY);
    return v === 'japan' || v === 'ming' ? v : 'joseon';
  } catch {
    return 'joseon';
  }
}

function saveFaction(f: Faction) {
  try {
    localStorage.setItem(FACTION_KEY, f);
  } catch {
    // storage unavailable: the choice lasts until the page reloads
  }
}

const enemyOf = (f: Faction): Faction => (f === 'japan' ? 'joseon' : 'japan');

/** The nine historical battles: pick a battle on the map, pick a side, and sail. The 1592 campaign is a secondary mode here. */
export function HistoryScreen({ initial, onStart }: { initial: ScenarioId; onStart: (id: ScenarioId, campaign: boolean, faction: Faction) => void }) {
  const mode = useCampaign((st) => st.mode);
  const campaign = useCampaign((st) => st.campaign);
  const [camp, setCamp] = useState(false);
  const [side, setSideRaw] = useState<Faction>(readFaction);
  const inCampaign = mode === 'campaign' && !!campaign;
  const current = campaign ? currentBattle(campaign) : 'okpo';
  const [id, setIdRaw] = useState<ScenarioId>(inCampaign ? current : initial);
  // Bumped by every pick, so choosing the battle already selected still flies the 3D camera back to its site.
  const [look, setLook] = useState(0);
  const setId = (next: ScenarioId) => {
    if (next !== id) sound.click();
    setIdRaw(next);
    setLook((n) => n + 1);
  };
  const s = SCENARIOS[id];
  const record = (sid: ScenarioId) => campaign?.history.filter((h) => h.id === sid).at(-1);
  const locked = (sid: ScenarioId) => inCampaign && !!campaign && CAMPAIGN_ORDER.indexOf(sid) > campaign.step;
  const playable = !inCampaign || (!!campaign && !campaignOver(campaign) && id === current);
  const factions = playableFactions(id);
  const effective: Faction = inCampaign ? 'joseon' : factions.includes(side) ? side : 'joseon';
  const ownSide: Faction = effective === 'japan' ? 'joseon' : effective;
  const setSide = (f: Faction) => {
    sound.click();
    setSideRaw(f);
    saveFaction(f);
  };
  const switchMode = (next: 'free' | 'campaign') => {
    sound.click();
    setMode(next);
    if (next === 'campaign') setIdRaw(currentBattle(useCampaign.getState().campaign!));
  };
  // The brief scrolls inside its card: fade its bottom edge while there is more below, so a cut line reads as "scroll".
  const briefRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const measure = useCallback(() => {
    const el = briefRef.current;
    if (el) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 6);
  }, []);
  useEffect(() => {
    const el = briefRef.current;
    if (!el) return;
    el.scrollTop = 0;
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    if (el.firstElementChild) watch.observe(el.firstElementChild);
    return () => watch.disconnect();
  }, [id, inCampaign, effective, measure]);
  const flat = <StaticMap id={id} onSelect={setId} />;
  return (
    <section className="screen hs">
      <div className="hs-map">
        {flatMap ? (
          flat
        ) : (
          <ErrorBoundary fallback={flat}>
            <Suspense fallback={null}>
              <SelectCanvas id={id} look={look} side={effective} onSelect={setId} />
            </Suspense>
          </ErrorBoundary>
        )}
        <div className="hs-vignette" />
      </div>
      <div className="hs-top">
        <header className="screen-top">
          <button
            className="back-btn"
            onClick={() => {
              sound.click();
              setScreen('menu');
            }}
            aria-label="메뉴로"
          >
            <span aria-hidden>‹</span> 메뉴
          </button>
          <h1 className="screen-title">역사 전투</h1>
          <div className="screen-actions">
            <div className="seg" role="tablist">
              <button className={mode === 'free' ? 'on' : ''} onClick={() => switchMode('free')}>
                자유 전투
              </button>
              <button className={mode === 'campaign' ? 'on' : ''} onClick={() => switchMode('campaign')}>
                전역 · 1592
              </button>
            </div>
          </div>
        </header>
        <div className="hs-tabs">
          {SCENARIO_ORDER.map((sid) => (
            <button key={sid} className={`hs-tab ${sid === id ? 'hs-tab--on' : ''} ${locked(sid) ? 'hs-tab--locked' : ''}`} disabled={locked(sid)} onClick={() => setId(sid)}>
              {inCampaign && record(sid) && <span className={`tab-seal ${record(sid)!.win ? '' : 'tab-seal--loss'}`}>{record(sid)!.win ? '勝' : '敗'}</span>}
              {SCENARIOS[sid].title}
              <small>{SCENARIOS[sid].date.slice(0, 4)}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="hs-brief glass">
        <div className="hs-brief-wrap">
          <div className="hs-brief-scroll" ref={briefRef} data-more={more} onScroll={measure}>
            <h2>
              {s.title}
              <span className="hanja">{s.hanja}</span>
            </h2>
            <div className="select-date">
              {s.date} · {s.place}
            </div>
            <div className="select-brief-head">
              <span>
                난이도 <b>{handicap(id, effective).difficulty}</b>
              </span>
              <span>{s.season}</span>
              {s.night && <span className="night-tag">야간 전투</span>}
            </div>
            {!inCampaign && (
              <div className="select-sides">
                {factions.map((f) => (
                  <button key={f} className={`side-btn ${f === effective ? 'side-btn--on' : ''}`} onClick={() => setSide(f)}>
                    <i className={`emblem emblem--${f}`}>{FACTION_MARK[f]}</i>
                    <span>
                      <b>{FACTION_SHORT[f]}</b>
                      <small>{commanderOf(id, f).name}</small>
                    </span>
                  </button>
                ))}
                <span className="side-vs">
                  대적 <b>{commanderOf(id, enemyOf(effective)).name}</b>
                </span>
              </div>
            )}
            <p className="select-cmd">
              조선 <b>{s.joseon.name}</b> <small>{s.joseon.title}</small> · 일본 <b>{s.japan.name}</b> <small>{s.japan.title}</small>
            </p>
            <p>{s.summary}</p>
            <div className="select-forces">
              <div className="select-force">
                <i className={`force-dot force-dot--${ownSide}`} />
                {FACTION_NAME[ownSide].replace(' 수군', '')} — {forcesOf(id, ownSide)}
              </div>
              <div className="select-force">
                <i className="force-dot force-dot--japan" />
                일본 — {s.forces.japan}
              </div>
            </div>
          </div>
          {more && (
            <button type="button" className="hs-more" onClick={() => briefRef.current?.scrollBy({ top: 140, behavior: 'smooth' })}>
              더 보기 <span aria-hidden>⌄</span>
            </button>
          )}
        </div>
        <div className="hs-foot">
          <div className="select-foot">
            <span className="select-result">{inCampaign && campaign ? `전역 ${Math.min(campaign.step + 1, CAMPAIGN_ORDER.length)}/${CAMPAIGN_ORDER.length} · 함대 ${campaign.squads.reduce((n, q) => n + q.ships.length, 0)}척` : `역사 기록 · ${s.result}`}</span>
            {inCampaign && (
              <button className="chip" onClick={() => setCamp(true)}>
                군영 · 정비
              </button>
            )}
            <button className="ink-btn" disabled={!playable} onClick={() => onStart(id, inCampaign, effective)}>
              {inCampaign && campaign && campaignOver(campaign) ? '전역 완료' : '전투 개시'}
            </button>
          </div>
        </div>
      </div>
      {camp && campaign && <CampaignPanel campaign={campaign} onClose={() => setCamp(false)} />}
    </section>
  );
}
