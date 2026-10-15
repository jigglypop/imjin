import { useEffect, useMemo, useRef, useState } from 'react';
import { SHIP_SPECS } from '../../sim/catalog';
import { SHORT_NAME } from '../../sim/conquest';
import { FACTION_NAME } from '../../sim/balance';
import type { ShipKind } from '../../sim/types';
import { SKY_PRESETS } from '../../render/sky';
import type { SeaStateName } from '../../ocean/waves';
import { variantCount } from '../../ships/anchors';
import { sound } from '../../audio/Sound';
import { useT } from '../../i18n';
import { setScreen } from '../../state/store';
import { ChevronLeft } from '../icons';
import { useCompactLayout } from '../useCompactLayout';
import { CODEX_SEAS, CODEX_SKIES, CodexScene, type CodexSky } from './CodexScene';
import { History, PartCaption, PartList, PartMarkers, ShipTitle, SpecSheet, type MarkerView } from './Dossier';
import { NAVIES, NAVY_SEAL } from './entries';
import { CodexIcon, type CodexIconName } from './icons';
import { anchorsOf, deckViews, partsOf } from './parts';
import { gunsOf } from './specs';

declare global {
  interface Window {
    /** The codex's 3D scene while the screen is open, for the screenshot and probe scripts. */
    __codex?: CodexScene;
  }
}

type Tab = 'specs' | 'history' | 'parts';
const TABS: { id: Tab; label: string }[] = [
  { id: 'specs', label: '제원' },
  { id: 'history', label: '역사' },
  { id: 'parts', label: '부위' },
];
const SEA_LABEL: Record<SeaStateName, string> = { calm: '잔잔', moderate: '보통', rough: '거침' };
/** What the cutaway button says at each step. */
const CUT_LABEL = ['선내', '상갑판', '포갑판', '노갑판'];
/** At most this many ships stand in the size comparison. */
const LINEUP_MAX = 4;

const ALL_KINDS: ShipKind[] = NAVIES.flatMap((n) => n.kinds);

/** The ship the address names (/ships#geobukseon), or the panokseon. */
function kindFromHash(): ShipKind {
  const named = decodeURIComponent(location.hash.slice(1));
  return (ALL_KINDS as string[]).includes(named) ? (named as ShipKind) : 'panokseon';
}

/** The comparison a kind opens with: it beside the panokseon and the two Japanese warships it fought. */
function lineupFor(kind: ShipKind): ShipKind[] {
  return [...new Set<ShipKind>([kind, 'panokseon', 'atakebune', 'sekibune'])].slice(0, 3);
}

function DockButton({ icon, label, on, onClick, hint }: { icon: CodexIconName; label: string; on?: boolean; onClick: () => void; hint: string }) {
  return (
    <button className={`cx-dock-btn ${on ? 'on' : ''}`} aria-pressed={on} onClick={onClick} title={hint}>
      <CodexIcon name={icon} />
      <span>{label}</span>
    </button>
  );
}

/** Names and sizes over the ships of the comparison, and a bracket along each waterline. */
function LineupLabels({ scene, kinds, frames }: { scene: CodexScene; kinds: ShipKind[]; frames: MarkerView['subscribe'] }) {
  const t = useT();
  const tags = useRef<(HTMLDivElement | null)[]>([]);
  const bars = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    const top = { x: 0, y: 0 };
    const bow = { x: 0, y: 0 };
    const stern = { x: 0, y: 0 };
    return frames(() => {
      scene.shown.forEach((ship, i) => {
        const tag = tags.current[i];
        const bar = bars.current[i];
        if (!tag || !bar) return;
        const L = ship.length / 2;
        const ok = scene.project(i, [0, ship.height + 1.5, 0], top) && scene.project(i, [L, 0, 0], bow) && scene.project(i, [-L, 0, 0], stern);
        tag.style.visibility = bar.style.visibility = ok ? '' : 'hidden';
        tag.style.transform = `translate(${top.x.toFixed(1)}px, ${top.y.toFixed(1)}px)`;
        const dx = bow.x - stern.x;
        const dy = bow.y - stern.y;
        bar.style.width = `${Math.hypot(dx, dy).toFixed(1)}px`;
        bar.style.transform = `translate(${stern.x.toFixed(1)}px, ${(stern.y + 10).toFixed(1)}px) rotate(${Math.atan2(dy, dx).toFixed(4)}rad)`;
      });
    });
  }, [scene, kinds, frames]);
  return (
    <div className="cx-lineup-labels">
      {kinds.map((kind, i) => (
        <div key={`${kind}-${i}`}>
          <div
            className="cx-lineup-tag"
            ref={(el) => {
              tags.current[i] = el;
            }}
            style={{ visibility: 'hidden' }}
          >
            <div>
              <b>{t(SHORT_NAME[kind])}</b>
              <span>{t('길이 {l}m · 높이 {h}m', { l: SHIP_SPECS[kind].length, h: SHIP_SPECS[kind].height })}</span>
            </div>
          </div>
          <div
            className="cx-lineup-bar"
            ref={(el) => {
              bars.current[i] = el;
            }}
            style={{ visibility: 'hidden' }}
          />
        </div>
      ))}
    </div>
  );
}

/** The lineup's figures side by side. */
function LineupTable({ kinds }: { kinds: ShipKind[] }) {
  const t = useT();
  const rows: { label: string; value: (k: ShipKind) => string }[] = [
    { label: '길이', value: (k) => `${SHIP_SPECS[k].length}m` },
    { label: '너비', value: (k) => `${SHIP_SPECS[k].beam}m` },
    { label: '높이', value: (k) => `${SHIP_SPECS[k].height}m` },
    { label: '갑판 높이', value: (k) => `${SHIP_SPECS[k].deck}m` },
    { label: '승조원', value: (k) => t('{n}명', { n: SHIP_SPECS[k].crew }) },
    { label: '화포', value: (k) => t('{n}문', { n: gunsOf(k).reduce((n, g) => n + g.count, 0) }) },
  ];
  return (
    <table className="cx-table">
      <thead>
        <tr>
          <th />
          {kinds.map((k, i) => (
            <th key={`${k}-${i}`}>{t(SHORT_NAME[k])}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <th>{t(r.label)}</th>
            {kinds.map((k, i) => (
              <td key={`${k}-${i}`}>{r.value(k)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * 함선 도감: every ship kind of the game on the game's own sea, to turn around, step aboard and read about. The ship
 * the address names is shown first (/ships#atakebune); picking another rewrites the address in place.
 */
export function CodexScreen() {
  const t = useT();
  const compact = useCompactLayout();
  const [kind, setKindRaw] = useState<ShipKind>(kindFromHash);
  const [variant, setVariant] = useState(0);
  const [tab, setTab] = useState<Tab>('specs');
  const [part, setPart] = useState<string | null>(null);
  const [lineup, setLineup] = useState<ShipKind[] | null>(null);
  const [deck, setDeck] = useState<number | null>(null);
  const [cut, setCut] = useState(0);
  const [spin, setSpin] = useState(true);
  const [pins, setPins] = useState(true);
  const [sky, setSky] = useState<CodexSky>('afternoon');
  const [sea, setSea] = useState<SeaStateName>('calm');
  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [busy, setBusy] = useState(true);
  const [sheet, setSheet] = useState(false);
  const [sceneOpen, setSceneOpen] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const rosterRef = useRef<HTMLElement>(null);
  const dossierRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<CodexScene | null>(null);
  const viewRef = useRef<CodexScene | null>(null);
  const started = useRef<Promise<void> | null>(null);
  const listeners = useRef(new Set<() => void>());

  const kinds = useMemo(() => lineup ?? [kind], [lineup, kind]);
  const parts = useMemo(() => partsOf(kind, variant), [kind, variant]);
  const anchors = useMemo(() => anchorsOf(kind, variant), [kind, variant]);
  const decks = useMemo(() => deckViews(kind, variant), [kind, variant]);
  const forms = variantCount(kind);

  const frames = useMemo<MarkerView['subscribe']>(
    () => (fn) => {
      listeners.current.add(fn);
      return () => listeners.current.delete(fn);
    },
    [],
  );
  const markerView = useMemo<MarkerView | null>(
    () =>
      scene && {
        subscribe: frames,
        project: (local, out) => scene.project(0, local, out),
        facing: () => scene.facing(0),
      },
    [scene, frames],
  );

  /** Tells the scene where the panels sit, so the ship is framed in the open water between them. */
  const measure = () => {
    const view = viewRef.current;
    const root = rootRef.current?.getBoundingClientRect();
    // A panel that is not laid out (hidden, or not mounted yet) takes no room.
    const box = (el: HTMLElement | null) => {
      const r = el?.getBoundingClientRect();
      return r && r.width > 0 && r.height > 0 ? r : null;
    };
    const top = box(headerRef.current);
    const roster = box(rosterRef.current);
    const dossier = box(dossierRef.current);
    const dock = box(dockRef.current);
    if (!view || !root) return;
    let left = 0;
    let right = 0;
    let over = top ? top.bottom - root.top : 0;
    let under = dock ? root.bottom - dock.top : 0;
    // A panel taller than it is wide stands at a side; otherwise it is a strip across the top or a sheet at the bottom.
    if (roster && roster.height > roster.width) left = roster.right - root.left;
    else if (roster) over = Math.max(over, roster.bottom - root.top);
    if (dossier && dossier.height > dossier.width) right = root.right - dossier.left;
    else if (dossier) under = Math.max(under, root.bottom - dossier.top);
    view.setInsets(left, right, over, under);
  };
  const measureRef = useRef(measure);
  measureRef.current = measure;

  // The renderer, the sea and the sky, once for the screen.
  useEffect(() => {
    const view = new CodexScene(canvas.current!);
    viewRef.current = view;
    view.onFrame = () => {
      for (const fn of listeners.current) fn();
    };
    window.__codex = view;
    measureRef.current();
    const watch = new ResizeObserver(() => measureRef.current());
    for (const el of [rootRef.current, rosterRef.current, dossierRef.current, dockRef.current]) if (el) watch.observe(el);
    started.current = view.init(sky, sea);
    started.current.then(
      () => setScene(view),
      (err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error(err);
        setPhase('failed');
      },
    );
    return () => {
      watch.disconnect();
      viewRef.current = null;
      if (window.__codex === view) delete window.__codex;
      window.__ready = false;
      view.dispose();
    };
    // The first sky and sea only; later picks go through setSky and setSea.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The ships on screen.
  const lineupKey = kinds.join(',');
  useEffect(() => {
    if (!scene) return;
    let live = true;
    setBusy(true);
    scene.show(kinds, variant).then(
      (shown) => {
        if (!live || !shown) return;
        setBusy(false);
        setPhase('ready');
        window.__ready = true;
      },
      (err: unknown) => {
        if (!live) return;
        console.error(err);
        setBusy(false);
        setPhase('failed');
      },
    );
    return () => {
      live = false;
    };
    // kinds is keyed by its contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, lineupKey, variant]);

  useEffect(() => {
    if (scene) scene.orbit.autoRotate = spin;
  }, [scene, spin]);
  useEffect(() => {
    scene?.setCutaway(lineup ? 0 : cut);
  }, [scene, cut, lineup]);
  useEffect(() => {
    if (!scene || phase !== 'ready') return;
    scene.enterDeck(lineup ? null : deck);
  }, [scene, deck, lineup, phase, lineupKey]);
  useEffect(() => {
    scene?.setSea(sea);
  }, [scene, sea]);
  useEffect(() => {
    if (scene) void scene.setSky(sky).catch((err: unknown) => console.error(err));
  }, [scene, sky]);

  // The address names the ship on screen, without a history entry per ship.
  useEffect(() => {
    if (location.hash.slice(1) !== kind) history.replaceState(history.state, '', `${location.pathname}${location.search}#${kind}`);
  }, [kind]);

  const pick = (next: ShipKind) => {
    if (next === kind && !lineup) return;
    sound.click();
    setKindRaw(next);
    setVariant(0);
    setPart(null);
    setDeck(null);
    setCut(0);
    if (lineup) setLineup((l) => (l ? [next, ...l.filter((k) => k !== next)].slice(0, Math.max(2, l.length)) : l));
  };
  const step = (by: number) => pick(ALL_KINDS[(ALL_KINDS.indexOf(kind) + by + ALL_KINDS.length) % ALL_KINDS.length]!);
  const choosePart = (id: string) => {
    sound.click();
    const next = id === part ? null : id;
    setPart(next);
    const p = parts.find((q) => q.id === next);
    if (p && scene && deck === null && !lineup) {
      const at = p.at(anchors, scene.facing(0));
      if (at) scene.focus(0, at);
    }
  };
  const toggleCompare = () => {
    sound.click();
    setPart(null);
    setDeck(null);
    setLineup((l) => (l ? null : lineupFor(kind)));
  };
  const cycleDeck = () => {
    sound.click();
    setPart(null);
    setDeck((d) => (d === null ? 0 : d + 1 < decks.length ? d + 1 : null));
  };
  const cycleCut = () => {
    sound.click();
    setCut((c) => (c + 1) % CUT_LABEL.length);
  };
  const resetView = () => {
    sound.click();
    setDeck(null);
    setPart(null);
    scene?.frame();
  };

  // Keys: arrows turn, +/- come closer, [ and ] step through the ships, and a letter for each control of the dock.
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keys.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (e.ctrlKey || e.metaKey || e.altKey || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName ?? '')) return;
    const o = scene?.orbit;
    switch (e.code) {
      case 'ArrowLeft':
        o?.rotate(-0.12, 0);
        break;
      case 'ArrowRight':
        o?.rotate(0.12, 0);
        break;
      case 'ArrowUp':
        o?.rotate(0, 0.06);
        break;
      case 'ArrowDown':
        o?.rotate(0, -0.06);
        break;
      case 'Equal':
      case 'NumpadAdd':
        o?.zoom(0.85);
        break;
      case 'Minus':
      case 'NumpadSubtract':
        o?.zoom(1 / 0.85);
        break;
      case 'BracketLeft':
        step(-1);
        break;
      case 'BracketRight':
        step(1);
        break;
      case 'Space':
        setSpin((s) => !s);
        break;
      case 'KeyL':
        setPins((p) => !p);
        break;
      case 'KeyD':
        if (!lineup) cycleDeck();
        break;
      case 'KeyX':
        if (!lineup) cycleCut();
        break;
      case 'KeyC':
        toggleCompare();
        break;
      case 'KeyR':
        resetView();
        break;
      case 'Escape':
        if (deck !== null) setDeck(null);
        else if (lineup) setLineup(null);
        else if (part) setPart(null);
        else return;
        break;
      default:
        return;
    }
    e.preventDefault();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const back = () => {
    sound.click();
    setScreen('menu');
  };
  const faction = SHIP_SPECS[kind].faction;
  const deckLabel = deck === null ? '갑판' : decks[deck]?.label ?? '갑판';
  const showPins = pins && !lineup && deck === null && cut === 0 && phase === 'ready' && !!markerView;

  return (
    <section ref={rootRef} className={`screen codex codex--${faction} ${lineup ? 'codex--lineup' : ''} ${sheet ? 'codex--sheet' : ''}`}>
      <div className="cx-stage">
        <canvas ref={canvas} className={`cx-canvas ${phase === 'ready' ? 'cx-canvas--on' : ''}`} />
        {showPins && <PartMarkers parts={parts} anchors={anchors} view={markerView!} selected={part} onSelect={choosePart} />}
        {lineup && scene && phase === 'ready' && <LineupLabels scene={scene} kinds={kinds} frames={frames} />}
        <div className="cx-shade" aria-hidden="true" />
        {phase === 'failed' && <p className="cx-failed">{t('이 기기에서는 3D 함선을 열 수 없습니다. 제원과 역사는 그대로 볼 수 있습니다.')}</p>}
        {phase === 'loading' && (
          <div className="cx-veil" aria-hidden="true">
            <span>{t('함선을 띄우는 중')}</span>
          </div>
        )}
        {busy && phase === 'ready' && <div className="cx-busy" aria-hidden="true" />}
      </div>

      <header ref={headerRef} className="screen-top cx-top">
        <button className="back-btn" onClick={back}>
          <ChevronLeft /> {t('뒤로')}
        </button>
        <h1 className="screen-title cx-heading">
          {t('함선 도감')}
          <small aria-hidden="true">艦船圖鑑</small>
        </h1>
        {compact && (
          <button className={`cx-scene-btn ${sceneOpen ? 'on' : ''}`} aria-expanded={sceneOpen} onClick={() => setSceneOpen((o) => !o)}>
            {t('하늘 · 파도')}
          </button>
        )}
        <div className="cx-scene" role="group" aria-label={t('장면')} hidden={compact && !sceneOpen}>
          <div className="cx-seg" role="radiogroup" aria-label={t('하늘')}>
            {CODEX_SKIES.map((s) => (
              <button key={s} role="radio" aria-checked={sky === s} className={sky === s ? 'on' : ''} onClick={() => setSky(s)}>
                {t(SKY_PRESETS[s].label)}
              </button>
            ))}
          </div>
          <div className="cx-seg" role="radiogroup" aria-label={t('파도')}>
            {CODEX_SEAS.map((s) => (
              <button key={s} role="radio" aria-checked={sea === s} className={sea === s ? 'on' : ''} onClick={() => setSea(s)}>
                {t(SEA_LABEL[s])}
              </button>
            ))}
          </div>
        </div>
      </header>

      <nav ref={rosterRef} className="cx-roster" aria-label={t('함선 목록')}>
        {NAVIES.map((navy) => (
          <div key={navy.faction} className={`cx-navy cx-navy--${navy.faction}`}>
            <h2>
              <i aria-hidden="true">{NAVY_SEAL[navy.faction]}</i>
              {t(FACTION_NAME[navy.faction])}
            </h2>
            <ul>
              {navy.kinds.map((k) => (
                <li key={k}>
                  <button className={kinds.includes(k) ? 'on' : ''} aria-current={k === kind ? 'true' : undefined} onClick={() => pick(k)}>
                    {t(SHORT_NAME[k])}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <aside className="cx-dossier" ref={dossierRef}>
        <div className="cx-dossier-head">
          <ShipTitle kind={kind} />
          {compact && (
            <button className="cx-sheet-toggle" onClick={() => setSheet((s) => !s)} aria-expanded={sheet} aria-label={t(sheet ? '설명 접기' : '설명 펼치기')}>
              <CodexIcon name={sheet ? 'next' : 'prev'} />
            </button>
          )}
        </div>
        {forms > 1 && !lineup && (
          <div className="cx-forms" role="radiogroup" aria-label={t('형태')}>
            <span>{t('형태')}</span>
            {Array.from({ length: forms }, (_, i) => (
              <button key={i} role="radio" aria-checked={variant === i} className={variant === i ? 'on' : ''} onClick={() => setVariant(i)}>
                {i + 1}
              </button>
            ))}
          </div>
        )}
        {lineup ? (
          <div className="cx-body">
            <p className="cx-lede">{t('실제 크기 그대로 나란히 띄웠습니다. 목록에서 고른 배가 맨 앞에 섭니다.')}</p>
            <LineupTable kinds={lineup} />
          </div>
        ) : (
          <>
            <div className="cx-tabs" role="tablist">
              {TABS.map((x) => (
                <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'on' : ''} onClick={() => setTab(x.id)}>
                  {t(x.label)}
                </button>
              ))}
            </div>
            <div className="cx-body" role="tabpanel">
              {tab === 'specs' && <SpecSheet kind={kind} />}
              {tab === 'history' && <History kind={kind} />}
              {tab === 'parts' && <PartList parts={parts} selected={part} onSelect={choosePart} />}
            </div>
          </>
        )}
      </aside>

      {lineup && (
        <div className="cx-lineup" role="group" aria-label={t('크기 비교')}>
          {lineup.map((k, i) => (
            <span key={`${k}-${i}`} className="cx-chip">
              {t(SHORT_NAME[k])}
              {lineup.length > 2 && (
                <button aria-label={t('{name} 빼기', { name: t(SHORT_NAME[k]) })} onClick={() => setLineup(lineup.filter((_, j) => j !== i))}>
                  ×
                </button>
              )}
            </span>
          ))}
          {lineup.length < LINEUP_MAX && (
            <select
              className="cx-add"
              value=""
              aria-label={t('함선 더하기')}
              onChange={(e) => {
                const next = e.target.value as ShipKind;
                if (next) setLineup([...lineup, next]);
              }}
            >
              <option value="">{t('+ 함선 더하기')}</option>
              {NAVIES.map((navy) => (
                <optgroup key={navy.faction} label={t(FACTION_NAME[navy.faction])}>
                  {navy.kinds
                    .filter((k) => !lineup.includes(k))
                    .map((k) => (
                      <option key={k} value={k}>
                        {t(SHORT_NAME[k])}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          )}
        </div>
      )}

      {pins && !lineup && deck === null && <PartCaption parts={parts} selected={part} onClose={() => setPart(null)} />}

      <div ref={dockRef} className="cx-dock" role="toolbar" aria-label={t('보기')}>
        <button className="cx-dock-btn cx-dock-step" onClick={() => step(-1)} title={t('이전 함선 · [')} aria-label={t('이전 함선')}>
          <CodexIcon name="prev" />
        </button>
        <DockButton icon="spin" label={t('회전')} on={spin} onClick={() => setSpin(!spin)} hint={t('천천히 돌려 보기 · Space')} />
        {!lineup && <DockButton icon="pins" label={t('부위')} on={pins} onClick={() => setPins(!pins)} hint={t('부위 이름 표시 · L')} />}
        {!lineup && <DockButton icon="deck" label={t(deckLabel)} on={deck !== null} onClick={cycleDeck} hint={t('갑판에 서서 보기 · D')} />}
        {!lineup && <DockButton icon="cut" label={t(CUT_LABEL[cut]!)} on={cut > 0} onClick={cycleCut} hint={t('선체를 잘라 갑판 보기 · X')} />}
        <DockButton icon="compare" label={t('크기 비교')} on={!!lineup} onClick={toggleCompare} hint={t('다른 함선과 실제 크기 비교 · C')} />
        <DockButton icon="reset" label={t('처음 시점')} onClick={resetView} hint={t('처음 시점으로 · R')} />
        <button className="cx-dock-btn cx-dock-step" onClick={() => step(1)} title={t('다음 함선 · ]')} aria-label={t('다음 함선')}>
          <CodexIcon name="next" />
        </button>
      </div>
    </section>
  );
}
