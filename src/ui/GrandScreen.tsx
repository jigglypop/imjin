import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sound } from '../audio/Sound';
import { abandonGrand, autoResolveGrand, dismissBattle, dismissReport, endGrandTurn, grandOrders, prepareGrandBattle, startGrand, useGrand } from '../campaign/grand';
import type { RegionBattle } from '../sim/grand/bridge';
import { dateLabel } from '../sim/grand/economy';
import type { BuildingKind as SimBuilding, Grand, RegionId } from '../sim/grand/types';
import type { ShipKind } from '../sim/types';
import { setScreen } from '../state/store';
import { BattlePreview } from './grand/BattlePreview';
import { BattleResult, GameOver, GrandMenu, Hub, StatusPanel, TurnSummary } from './grand/Dialogs';
import { FactionPick } from './grand/FactionPick';
import { FleetPanel } from './grand/FleetPanel';
import { GrandMap } from './grand/GrandMap';
import { RegionPanel } from './grand/RegionPanel';
import { TopBar } from './grand/TopBar';
import {
  FACTION_OPTIONS,
  fleetViews,
  logLines,
  moveTargets,
  objectiveView,
  officersFor,
  overView,
  previewView,
  regionViews,
  relationViews,
  resultView,
  routeText,
  saveView,
  scoreViews,
  treasuryView,
  turnView,
} from './grand/adapt';
import './grand/grand.css';
import { useMapInsets } from './grand/shared';
import type { FactionId } from './grand/types';

type Stage = 'hub' | 'pick' | 'map';

const toMenu = () => {
  sound.click();
  setScreen('menu');
};

/**
 * The faction campaign screen: continue or begin a war, then the strategic map with its panels. The campaign itself
 * lives in the store (campaign/grand.ts); this reads it through the adapters and gives orders through grandOrders.
 * A meeting the player decides to fight is handed to `onBattle`, which opens the 3D battle.
 */
export function GrandScreen({ onBattle }: { onBattle: (battle: RegionBattle) => void }) {
  const [stage, setStage] = useState<Stage>(() => {
    const s = useGrand.getState();
    // Coming back from a battle or an auto-resolve, the player is already in the war.
    if (!s.grand) return 'pick';
    return s.lastBattle || s.reported !== null ? 'map' : 'hub';
  });
  const grand = useGrand((s) => s.grand);

  return (
    <div className="grand">
      {stage === 'hub' && grand ? (
        <Hub
          save={saveView(grand)}
          onContinue={() => setStage('map')}
          onNew={() => {
            abandonGrand();
            setStage('pick');
          }}
          onBack={toMenu}
        />
      ) : stage === 'map' && grand ? (
        <CampaignMap g={grand} onBattle={onBattle} onNew={() => setStage('pick')} />
      ) : (
        <FactionPick
          options={FACTION_OPTIONS}
          onBack={toMenu}
          onPick={(id, level) => {
            sound.click();
            startGrand(id, level);
            setStage('map');
          }}
        />
      )}
    </div>
  );
}

function CampaignMap({ g, onBattle, onNew }: { g: Grand; onBattle: (battle: RegionBattle) => void; onNew: () => void }) {
  const lastBattle = useGrand((s) => s.lastBattle);
  const reported = useGrand((s) => s.reported);
  const me: FactionId = g.player ?? 'joseon';
  const [regionId, setRegionId] = useState<string | null>(null);
  const [fleetId, setFleetId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [status, setStatus] = useState(false);
  const [menu, setMenu] = useState(false);
  const [previewHidden, setPreviewHidden] = useState(false);
  const [overSeen, setOverSeen] = useState(false);
  const toastTimer = useRef(0);

  const regions = useMemo(() => regionViews(g), [g]);
  const fleets = useMemo(() => fleetViews(g), [g]);
  const region = regions.find((r) => r.id === regionId) ?? null;
  const fleet = fleets.find((f) => f.id === fleetId) ?? null;
  const simFleet = g.fleets.find((f) => f.id === fleetId);
  const insets = useMapInsets(!!(region || fleet));
  const targets = useMemo(() => (moving && simFleet ? moveTargets(g, simFleet) : undefined), [moving, simFleet, g]);
  const pending = g.phase === 'battles' ? g.pending[0] : undefined;
  const preview = useMemo(() => (pending ? previewView(g, pending.id) : null), [g, pending]);
  const over = g.phase === 'over' ? overView(g) : null;

  const say = useCallback((text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const flyTo = (id: string) => setFocus((f) => ({ id, nonce: (f?.nonce ?? 0) + 1 }));
  const report = (res: { ok: true; note?: string } | { ok: false; reason: string }, done?: string) => {
    say(res.ok ? (done ?? res.note ?? '명령을 내렸다') : res.reason);
    return res.ok;
  };

  const selectRegion = (id: string) => {
    if (moving && fleet) {
      if (targets && !targets.includes(id as RegionId)) {
        say('그 곳으로 가는 안전한 물길이 없습니다');
        return;
      }
      const res = grandOrders.move(fleet.id, id as RegionId);
      if (res.ok) {
        const dest = regions.find((r) => r.id === id)!;
        const hostile = dest.owner !== null && dest.owner !== me;
        say(`${fleet.name}: ${dest.name}${hostile ? ' 공격' : '(으)로 출항'} 명령 · ${res.note ?? ''}`);
        setMoving(false);
      } else say(res.reason);
      return;
    }
    setRegionId(id);
    setFleetId(null);
    flyTo(id);
  };

  const selectFleet = (id: string) => {
    const f = fleets.find((x) => x.id === id);
    if (!f) return;
    setFleetId(id);
    setMoving(false);
    const place = f.at ?? f.transit?.from;
    setRegionId(place ?? null);
    if (place) flyTo(place);
  };

  const closePanels = () => {
    setRegionId(null);
    setFleetId(null);
    setMoving(false);
  };

  const endTurn = () => {
    if (g.phase === 'battles') {
      setPreviewHidden(false);
      return;
    }
    sound.click();
    closePanels();
    setToast(null);
    setPreviewHidden(false);
    endGrandTurn();
  };

  const fight = () => {
    if (!pending) return;
    const rb = prepareGrandBattle(pending.id);
    if (rb) onBattle(rb);
  };

  const gold = Math.round(g.factions[me].gold);
  const here = region ? fleets.filter((f) => f.at === region.id) : [];
  const mergeWith = fleet && fleet.at ? fleets.filter((f) => f.at === fleet.at && f.faction === fleet.faction && f.id !== fleet.id) : [];

  return (
    <>
      <GrandMap
        regions={regions}
        fleets={fleets}
        me={me}
        selectedRegionId={regionId}
        selectedFleetId={fleetId}
        moveTargets={targets}
        insets={insets}
        focus={focus}
        onSelectRegion={selectRegion}
        onSelectFleet={selectFleet}
        onBackground={() => {
          if (!moving) closePanels();
        }}
      />
      <TopBar
        turn={turnView(g)}
        treasury={treasuryView(g)}
        onEndTurn={endTurn}
        onMenu={() => setMenu(true)}
        onStatus={() => setStatus(true)}
        busy={g.phase === 'over'}
        endLabel={g.phase === 'battles' ? `전투 ${g.pending.length}건` : '턴 종료'}
      />
      <div className="g-dock">
        {fleet ? (
          <FleetPanel
            key={fleet.id + fleet.ships.length}
            fleet={fleet}
            regionName={regions.find((r) => r.id === fleet.at)?.name ?? ''}
            me={me}
            moving={moving}
            mergeWith={mergeWith}
            officers={fleet.faction === me ? officersFor(g, fleet.id) : []}
            routeText={simFleet ? routeText(g, simFleet) : undefined}
            gold={gold}
            onClose={closePanels}
            onMove={() => setMoving(true)}
            onCancelMove={() => setMoving(false)}
            onStop={(id) => report(grandOrders.stop(id), '명령을 거두었다')}
            onMerge={(keep, other) => report(grandOrders.merge(keep, other), '함대를 합쳤다')}
            onSplit={(id, ships) => {
              const res = grandOrders.split(id, ships);
              if (res.ok && res.note) setFleetId(res.note);
              report(res, '분견대를 편성했다');
            }}
            onCommander={(id, cmd) => report(grandOrders.commander(id, cmd), cmd ? '장수를 임명했다' : '장수를 해임했다')}
            onRefit={(id) => report(grandOrders.refit(id), '정비를 마쳤다')}
            onDisband={(id, ships) => {
              let sold = 0;
              for (const s of ships) {
                const res = grandOrders.disband(id, s);
                if (!res.ok) {
                  say(res.reason);
                  break;
                }
                sold += 1;
              }
              if (sold) say(`${sold}척을 해체했다`);
              if (!useGrand.getState().grand?.fleets.some((f) => f.id === id)) closePanels();
            }}
          />
        ) : region ? (
          <RegionPanel
            region={region}
            fleets={here}
            me={me}
            onClose={closePanels}
            onBuild={(id, kind) => report(grandOrders.build(id as RegionId, kind as SimBuilding))}
            onCancelBuild={(id, kind) => report(grandOrders.cancelBuild(id as RegionId, kind as SimBuilding), '공사를 취소하고 값을 돌려받았다')}
            onRecruit={(id, kind) => report(grandOrders.recruit(id as RegionId, kind as ShipKind))}
            onCancelRecruit={(id, item) => report(grandOrders.cancelRecruit(id as RegionId, item), '주문을 취소하고 값을 돌려받았다')}
            onSelectFleet={selectFleet}
          />
        ) : null}
      </div>

      {toast && (
        <div className="g-glass g-toast" role="status">
          {toast}
        </div>
      )}

      {preview && !previewHidden && !lastBattle && (
        <BattlePreview
          battle={{ ...preview, notes: [...(preview.notes ?? []), ...(g.pending.length > 1 ? [`이 달에 치를 전투가 ${g.pending.length}건 있습니다`] : [])] }}
          cancelLabel="나중에"
          onCancel={() => setPreviewHidden(true)}
          onFight={fight}
          onAuto={() => {
            sound.click();
            autoResolveGrand(pending!.id);
          }}
        />
      )}
      {lastBattle && <BattleResult result={resultView(lastBattle)} onClose={dismissBattle} />}
      {!lastBattle && reported !== null && !over && g.phase === 'orders' && (
        <TurnSummary date={dateLabel(reported)} lines={logLines(g, reported)} gold={gold} onClose={dismissReport} />
      )}
      {!lastBattle && over && !overSeen && (
        <GameOver
          over={over}
          me={me}
          onView={() => setOverSeen(true)}
          onNew={() => {
            abandonGrand();
            onNew();
          }}
          onMenu={toMenu}
        />
      )}
      {status && (
        <StatusPanel
          me={me}
          objective={objectiveView(g)}
          scores={scoreViews(g)}
          relations={relationViews(g)}
          log={logLines(g)}
          canOrder={g.phase === 'orders'}
          onAlliance={(other) => report(grandOrders.alliance(me, other))}
          onWar={(other) => report(grandOrders.declareWar(me, other), '동맹을 깼다')}
          onClose={() => setStatus(false)}
        />
      )}
      {menu && (
        <GrandMenu
          onClose={() => setMenu(false)}
          onStatus={() => {
            setMenu(false);
            setStatus(true);
          }}
          onLeave={toMenu}
          onAbandon={() => {
            abandonGrand();
            setMenu(false);
            onNew();
          }}
        />
      )}
    </>
  );
}
