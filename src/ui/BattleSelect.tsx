import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { PerspectiveCamera, Vector2, WebGPURenderer } from 'three/webgpu';
import { SCENARIO_ORDER, SCENARIOS, type ScenarioId } from '../sim/scenarios';
import { commanderOf, FACTION_MARK, FACTION_NAME, FACTION_SHORT, forcesOf, handicap, playableFactions } from '../sim/balance';
import type { Faction } from '../sim/types';
import { SelectScene } from '../select/SelectScene';
import { sound } from '../audio/Sound';
import { CAMPAIGN_ORDER, campaignOver, currentBattle, setMode, useCampaign } from '../campaign/campaign';
import { CampaignPanel } from './CampaignPanel';
import { equipment } from '../game/quality';
import { ConquestSetupPanel } from './ConquestSetup';
import type { ConquestSetup } from '../game/Engine';

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

async function createRenderer(props: { canvas: HTMLCanvasElement | OffscreenCanvas }) {
  const renderer = new WebGPURenderer({ canvas: props.canvas as HTMLCanvasElement, antialias: equipment.select.antialias, powerPreference: 'high-performance' });
  await renderer.init();
  return renderer;
}

function SelectView({ id, side, sceneRef, markers }: { id: ScenarioId; side: Faction; sceneRef: React.MutableRefObject<SelectScene | null>; markers: React.MutableRefObject<Map<ScenarioId, HTMLDivElement>> }) {
  const gl = useThree((s) => s.gl) as unknown as WebGPURenderer;
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const tmp = useRef(new Vector2());

  useEffect(() => {
    const scene = new SelectScene(gl, camera, equipment.select.mapSegments);
    sceneRef.current = scene;
    scene.setForces(id, side);
    void scene.init(id);
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera]);

  useEffect(() => {
    sceneRef.current?.focus(id);
  }, [id, sceneRef]);

  useEffect(() => {
    sceneRef.current?.setForces(id, side);
  }, [id, side, sceneRef]);

  useFrame((_, dt) => {
    const scene = sceneRef.current;
    if (!scene?.ready) return;
    scene.update(Math.min(dt, 0.05));
    scene.render();
    for (const sid of SCENARIO_ORDER) {
      const el = markers.current.get(sid);
      if (!el) continue;
      const visible = scene.project(sid, size.width, size.height, tmp.current);
      const { x, y } = tmp.current;
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.style.opacity = visible ? '1' : '0';
      el.style.pointerEvents = visible ? 'auto' : 'none';
    }
  }, 1);

  return null;
}

type View = 'history' | 'conquest' | 'online';

export function BattleSelect({
  initial,
  onStart,
  onConquest,
  onlinePanel,
}: {
  initial: ScenarioId;
  onStart: (id: ScenarioId, campaign: boolean, faction: Faction) => void;
  onConquest: (setup: ConquestSetup) => void;
  onlinePanel?: React.ReactNode;
}) {
  const mode = useCampaign((st) => st.mode);
  const campaign = useCampaign((st) => st.campaign);
  const [camp, setCamp] = useState(false);
  const [view, setView] = useState<View>('history');
  const [side, setSideRaw] = useState<Faction>(readFaction);
  const inCampaign = mode === 'campaign' && !!campaign;
  const current = campaign ? currentBattle(campaign) : 'okpo';
  const [id, setIdRaw] = useState<ScenarioId>(inCampaign ? current : initial);
  const setId = (next: ScenarioId) => {
    if (next !== id) sound.click();
    setIdRaw(next);
  };
  const sceneRef = useRef<SelectScene | null>(null);
  const markers = useRef(new Map<ScenarioId, HTMLDivElement>());
  const s = SCENARIOS[id];
  const record = (sid: ScenarioId) => campaign?.history.filter((h) => h.id === sid).at(-1);
  const locked = (sid: ScenarioId) => inCampaign && !!campaign && CAMPAIGN_ORDER.indexOf(sid) > campaign.step;
  const playable = !inCampaign || (!!campaign && !campaignOver(campaign) && id === current);
  const factions = playableFactions(id);
  const effective: Faction = inCampaign ? 'joseon' : factions.includes(side) ? side : 'joseon';
  const setSide = (f: Faction) => {
    sound.click();
    setSideRaw(f);
    saveFaction(f);
  };
  const switchMode = (next: 'free' | 'campaign') => {
    sound.click();
    setView('history');
    setMode(next);
    if (next === 'campaign') setIdRaw(currentBattle(useCampaign.getState().campaign!));
  };
  const switchView = (next: View) => {
    sound.click();
    setView(next);
  };
  const enemyOf = (f: Faction): Faction => (f === 'japan' ? 'joseon' : 'japan');
  return (
    <div className="select">
      <Canvas className="select-canvas" gl={createRenderer as never} camera={{ fov: 34, near: 0.05, far: 600, position: [0, 40, 40] }} dpr={Math.min(window.devicePixelRatio, equipment.select.dprCap)} frameloop="always">
        <SelectView id={id} side={effective} sceneRef={sceneRef} markers={markers} />
      </Canvas>
      <div className="select-grain" />
      <div className="select-markers" style={{ display: view === 'history' ? '' : 'none' }}>
        {SCENARIO_ORDER.map((sid) => (
          <div
            key={sid}
            ref={(el) => {
              if (el) markers.current.set(sid, el);
              else markers.current.delete(sid);
            }}
            className={`marker ${sid === id ? 'marker--on' : ''} ${SCENARIOS[sid].night ? 'marker--night' : ''}`}
            onClick={() => setId(sid)}
          >
            <i />
            <span>{SCENARIOS[sid].title.replace(' 해전', '').replace(' 대첩', '')}</span>
          </div>
        ))}
      </div>
      <div className="select-top">
        <div className="select-heading">壬辰海戰</div>
        {(view === 'history' ? SCENARIO_ORDER : []).map((sid) => (
          <button key={sid} className={`select-tab ${sid === id ? 'select-tab--on' : ''} ${locked(sid) ? 'select-tab--locked' : ''}`} disabled={locked(sid)} onClick={() => setId(sid)}>
            {inCampaign && record(sid) && <span className={`tab-seal ${record(sid)!.win ? '' : 'tab-seal--loss'}`}>{record(sid)!.win ? '勝' : '敗'}</span>}
            {SCENARIOS[sid].title}
            <small>{SCENARIOS[sid].date.slice(0, 4)}</small>
          </button>
        ))}
        <div className="mode-switch">
          <button className={view === 'history' && mode === 'free' ? 'on' : ''} onClick={() => switchMode('free')}>
            자유 전투
          </button>
          <button className={view === 'history' && mode === 'campaign' ? 'on' : ''} onClick={() => switchMode('campaign')}>
            전역 · 1592
          </button>
          <button className={view === 'conquest' ? 'on' : ''} onClick={() => switchView('conquest')}>
            쟁탈전
          </button>
          <button className={view === 'online' ? 'on' : ''} onClick={() => switchView('online')}>
            대전
          </button>
        </div>
      </div>
      {view === 'conquest' && <ConquestSetupPanel onStart={onConquest} />}
      {view === 'online' && onlinePanel}
      {view === 'history' && (
      <>
      <div className="select-head">
        <div className="select-title brush">{s.title}</div>
        <div className="select-hanja">{s.hanja}</div>
        <div className="select-date">
          {s.date} · {s.place}
        </div>
      </div>
      <div className="select-brief paper">
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
            <i className="force-dot force-dot--joseon" />
            {FACTION_NAME[effective === 'japan' ? 'joseon' : effective].replace(' 수군', '')} — {forcesOf(id, effective === 'japan' ? 'joseon' : effective)}
          </div>
          <div className="select-force">
            <i className="force-dot force-dot--japan" />
            일본 — {s.forces.japan}
          </div>
        </div>
        <div className="select-foot">
          <span className="select-result">{inCampaign && campaign ? `전역 ${Math.min(campaign.step + 1, CAMPAIGN_ORDER.length)}/${CAMPAIGN_ORDER.length} · 함대 ${campaign.squads.reduce((n, q) => n + q.ships.length, 0)}척` : `역사 기록 · ${s.result}`}</span>
          {inCampaign && (
            <button className="mini-btn" onClick={() => setCamp(true)}>
              군영 · 정비
            </button>
          )}
          <button className="ink-btn" disabled={!playable} onClick={() => onStart(id, inCampaign, effective)}>
            {inCampaign && campaign && campaignOver(campaign) ? '전역 완료' : '전투 개시'}
          </button>
        </div>
      </div>
      </>
      )}
      {camp && campaign && <CampaignPanel campaign={campaign} onClose={() => setCamp(false)} />}
    </div>
  );
}
