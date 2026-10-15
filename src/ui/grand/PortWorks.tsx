import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '../../i18n';
import { BUILDINGS, Icon, buildingDesc, buildingName, costText, goldText, num, shipArt, workArt } from './shared';
import { turnsText } from './text';
import type { BuildingKind, BuildingView, FactionId, RecruitView, RegionView, ShipClass, YardItemView } from './types';
import './works.css';

/**
 * The port's works and slipways as a settlement panel in the Total War manner: a card per building slot whose picture,
 * pips and badges tell its state at a glance, and one detail drawer under the grid for the card picked, where the
 * numbers and the one order live. A double click (or the card's corner button) orders the next level straight away.
 */

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Brings the drawer that just opened into view inside the panel's scroll, without moving the page. */
function useRevealed<T extends HTMLElement>(key: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (key == null) return;
    ref.current?.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
  }, [key]);
  return ref;
}

/**
 * Cards that changed since the last look at this port: a work that was ordered or a level that was finished gets a
 * short flourish. Switching to another port starts over, so opening a port never plays one.
 */
function useFlourish(regionId: string, items: { key: string; stamp: string }[]) {
  const seen = useRef<{ region: string; stamps: Map<string, string> } | null>(null);
  const [flash, setFlash] = useState<Map<string, number>>(new Map());
  // The signature stands for the items: a new array each render must not replay the flourish.
  const signature = items.map((i) => `${i.key}:${i.stamp}`).join('|');
  useLayoutEffect(() => {
    const before = seen.current;
    const stamps = new Map(items.map((i) => [i.key, i.stamp]));
    seen.current = { region: regionId, stamps };
    if (!before || before.region !== regionId) return;
    const changed = items.filter((i) => before.stamps.get(i.key) !== i.stamp).map((i) => i.key);
    if (!changed.length) return;
    const stamp = Date.now();
    setFlash((m) => new Map([...m, ...changed.map((k) => [k, stamp] as const)]));
    setTimeout(() => setFlash((m) => new Map([...m].filter(([, v]) => v !== stamp))), 1400);
  }, [regionId, signature]);
  return flash;
}

/** The turns a job has done, as a ring around the turns it has left. */
function Ring({ done, left, label }: { done: number; left: number; label: string }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <span className="g-ring" role="img" aria-label={label}>
      <svg viewBox="0 0 36 36" aria-hidden focusable="false">
        <circle className="g-ring__track" cx="18" cy="18" r={r} />
        <circle className="g-ring__fill" cx="18" cy="18" r={r} strokeDasharray={`${c * Math.max(0.04, Math.min(1, done))} ${c}`} />
      </svg>
      <b>{left}</b>
    </span>
  );
}

function Pips({ level, max, label }: { level: number; max: number; label: string }) {
  return (
    <span className="g-wpips" role="img" aria-label={label}>
      {Array.from({ length: max }, (_, i) => (
        <i key={i} className={i < level ? 'on' : ''} />
      ))}
    </span>
  );
}

type WorkState = 'none' | 'built' | 'rising' | 'max';
const stateOf = (b: BuildingView): WorkState => (b.upgradeLeft > 0 ? 'rising' : b.level >= b.maxLevel ? 'max' : b.level > 0 ? 'built' : 'none');

/** The level a card pictures: the one going up while it rises, the first for a work not built yet. */
const shownLevel = (b: BuildingView) => (b.upgradeLeft > 0 ? b.level + 1 : Math.max(1, b.level));

function WorkCard({
  b,
  faction,
  own,
  selected,
  flash,
  small,
  controls,
  onSelect,
  onQuick,
}: {
  b: BuildingView;
  faction: FactionId;
  own: boolean;
  selected: boolean;
  flash?: boolean;
  small?: boolean;
  controls?: string;
  onSelect: () => void;
  onQuick?: () => void;
}) {
  const t = useT();
  const state = stateOf(b);
  const can = own && b.buildable && (state === 'none' || state === 'built');
  const locked = own && !b.buildable && !b.short && (state === 'none' || state === 'built');
  const levelText = t('{level} / {max}단계', { level: b.level, max: b.maxLevel });
  const status =
    state === 'rising'
      ? t('{level}단계 공사 중 · {turns} 남음', { level: b.level + 1, turns: turnsText(b.upgradeLeft) })
      : state === 'max'
        ? t('최고 단계')
        : state === 'none'
          ? t('미건설')
          : levelText;
  const cls = [
    'g-wcard',
    `g-wcard--${state}`,
    can && 'g-wcard--can',
    locked && 'g-wcard--locked',
    own && b.short && state !== 'rising' && state !== 'max' && 'g-wcard--short',
    selected && 'g-wcard--on',
    flash && 'g-wcard--flash',
    small && 'g-wcard--small',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls}>
      <button
        type="button"
        className="g-wcard__main"
        aria-pressed={selected}
        aria-controls={controls}
        aria-label={`${buildingName(b.kind)} · ${status}`}
        onClick={onSelect}
        onDoubleClick={can && onQuick ? onQuick : undefined}
      >
        <img className="g-wcard__art" src={workArt(faction, b.kind, shownLevel(b))} alt="" width={384} height={384} loading="lazy" decoding="async" draggable={false} />
        <span className="g-wcard__shade" aria-hidden />
        <span className="g-wcard__glyph" aria-hidden>
          <Icon name={BUILDINGS[b.kind].icon} size="sm" />
        </span>
        {state === 'rising' && <Ring done={b.upgradeTotal ? 1 - b.upgradeLeft / b.upgradeTotal : 0} left={b.upgradeLeft} label={status} />}
        {locked && (
          <span className="g-wcard__badge g-wcard__badge--lock" aria-hidden>
            <Icon name="lock" size="sm" />
          </span>
        )}
        {own && b.short && (state === 'none' || state === 'built') && (
          <span className="g-wcard__badge g-wcard__badge--coin" aria-hidden>
            <Icon name="coin" size="sm" />
          </span>
        )}
        {state === 'max' && <span className="g-wcard__crown" aria-hidden />}
        <span className="g-wcard__foot">
          <span className="g-wcard__name">{buildingName(b.kind)}</span>
          <Pips level={b.level} max={b.maxLevel} label={levelText} />
        </span>
      </button>
      {can && onQuick && !small && (
        <button type="button" className="g-wcard__quick" aria-label={t('{work} {action} · {cost}', { work: buildingName(b.kind), action: b.level ? t('증축') : t('건설'), cost: costText(b.cost) })} title={b.level ? t('증축') : t('건설')} onClick={onQuick}>
          <Icon name={b.level ? 'up' : 'plus'} size="sm" />
        </button>
      )}
    </div>
  );
}

/** An open plot: the pick of works to raise on it. */
function PlotCard({ selected, own, controls, onSelect }: { selected: boolean; own: boolean; controls?: string; onSelect: () => void }) {
  const t = useT();
  return (
    <div className={`g-wcard g-wcard--plot${selected ? ' g-wcard--on' : ''}`}>
      <button type="button" className="g-wcard__main" aria-pressed={selected} aria-controls={controls} disabled={!own} aria-label={own ? t('빈 부지 · 건설할 시설 고르기') : t('빈 부지')} onClick={onSelect}>
        <span className="g-wcard__plus" aria-hidden>
          <Icon name="plus" />
        </span>
        <span className="g-wcard__foot">
          <span className="g-wcard__name">{t('빈 부지')}</span>
        </span>
      </button>
    </div>
  );
}

/** The cost and the turns of an order, as two chips. */
function Price({ gold, turns, short }: { gold: string; turns: number; short?: boolean }) {
  return (
    <span className="g-wprice">
      <span className={`g-wprice__chip${short ? ' g-wprice__chip--short' : ''}`}>
        <Icon name="coin" size="sm" />
        {gold}
      </span>
      <span className="g-wprice__chip">
        <Icon name="clock" size="sm" />
        {turnsText(turns)}
      </span>
    </span>
  );
}

function Drawer({ id, art, eyebrow, title, onClose, children, footer, reveal }: { id: string; art: string; eyebrow: ReactNode; title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; reveal: unknown }) {
  const t = useT();
  const ref = useRevealed<HTMLElement>(reveal);
  return (
    <section ref={ref} id={id} className="g-wdetail" aria-label={typeof title === 'string' ? title : undefined}>
      <div className="g-wdetail__hero">
        <img key={art} className="g-wdetail__art" src={art} alt="" width={384} height={384} decoding="async" draggable={false} />
        <div className="g-wdetail__titles">
          <span className="g-wdetail__eyebrow">{eyebrow}</span>
          <h4 className="g-wdetail__title">{title}</h4>
        </div>
        <button type="button" className="g-icon-btn g-wdetail__close" aria-label={t('닫기')} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="g-wdetail__body">{children}</div>
      {footer && <div className="g-wdetail__foot">{footer}</div>}
    </section>
  );
}

function WorkDetail({ id, b, faction, own, onBuild, onCancel, onClose }: { id: string; b: BuildingView; faction: FactionId; own: boolean; onBuild: () => void; onCancel?: () => void; onClose: () => void }) {
  const t = useT();
  const state = stateOf(b);
  const next = b.level + 1;
  const art = workArt(faction, b.kind, state === 'max' ? b.level : next);
  const hasNext = state !== 'max';
  const why = own && state !== 'rising' && state !== 'max' ? b.blocked : undefined;
  return (
    <Drawer
      id={id}
      reveal={b.kind}
      art={art}
      onClose={onClose}
      eyebrow={b.level === 0 ? t('미건설') : state === 'max' ? t('최고 단계') : t('{level} / {max}단계', { level: b.level, max: b.maxLevel })}
      title={buildingName(b.kind)}
      footer={
        own &&
        (state === 'rising' ? (
          <>
            <span className="g-wdetail__progress">
              <Ring done={b.upgradeTotal ? 1 - b.upgradeLeft / b.upgradeTotal : 0} left={b.upgradeLeft} label={t('{turns} 남음', { turns: turnsText(b.upgradeLeft) })} />
              <span>
                {t('{level}단계 공사 중', { level: next })}
                <small>{t('{turns} 남음', { turns: turnsText(b.upgradeLeft) })}</small>
              </span>
            </span>
            {onCancel && (
              <button type="button" className="g-btn g-btn--sm" onClick={onCancel}>
                {t('취소')}
              </button>
            )}
          </>
        ) : state === 'max' ? null : (
          <>
            <Price gold={costText(b.cost)} turns={b.turns} short={b.short} />
            <button type="button" className="g-btn g-btn--primary g-wdetail__go" disabled={!b.buildable} onClick={onBuild}>
              <Icon name={b.level ? 'up' : 'plus'} size="sm" />
              {b.level ? t('{level}단계 증축', { level: next }) : t('건설')}
            </button>
          </>
        ))
      }
    >
      <p className="g-wdetail__role">{buildingDesc(b.kind)}</p>
      {b.effects.length > 0 && (
        <table className="g-wfx">
          <thead>
            <tr>
              <th scope="col">
                <span className="g-sr">{t('효과')}</span>
              </th>
              <th scope="col">{b.level ? t('현재 {level}단계', { level: b.level }) : t('현재')}</th>
              {hasNext && <th scope="col">{t('{level}단계', { level: next })}</th>}
            </tr>
          </thead>
          <tbody>
            {b.effects.map((e) => (
              <tr key={e.label}>
                <th scope="row">{e.label}</th>
                <td>{e.now}</td>
                {hasNext && <td className={e.next !== e.now ? 'g-wfx__up' : ''}>{e.next ?? '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hasNext && b.opens.length > 0 && (
        <div className="g-wopens">
          <span className="g-wopens__label">{t('{level}단계에서 열림', { level: next })}</span>
          {b.opens.map((o) => (
            <span key={o} className="g-wopens__chip">
              {o}
            </span>
          ))}
        </div>
      )}
      {why && (
        <p className="g-wdetail__why" role="note">
          <Icon name={b.short ? 'coin' : 'lock'} size="sm" />
          {why}
        </p>
      )}
    </Drawer>
  );
}

type Pick = { plot: true; kind?: BuildingKind } | { plot: false; kind: BuildingKind } | null;

export function WorkSlots({ region, own, onBuild, onCancelBuild }: { region: RegionView; own: boolean; onBuild?: (regionId: string, kind: BuildingKind) => void; onCancelBuild?: (regionId: string, kind: BuildingKind) => void }) {
  const t = useT();
  const faction = region.owner!;
  const [pick, setPick] = useState<Pick>(null);
  useEffect(() => setPick(null), [region.id]);
  const placed = region.buildings.filter((b) => b.level > 0 || b.upgradeLeft > 0);
  const options = own ? region.buildings.filter((b) => b.level === 0 && b.upgradeLeft === 0) : [];
  const plots = region.freeSlots;
  const flash = useFlourish(region.id, placed.map((b) => ({ key: b.kind, stamp: `${b.level}/${b.upgradeLeft > 0}` })));
  const drawerId = `g-wdetail-${region.id}`;
  const build = (kind: BuildingKind) => onBuild?.(region.id, kind);
  // An order leaves its card picked, so the drawer shows the work going up (a work ordered on a plot becomes that card).
  const order = (kind: BuildingKind) => {
    build(kind);
    setPick({ plot: false, kind });
  };
  const chosen = pick && !pick.plot ? placed.find((b) => b.kind === pick.kind) : undefined;
  const plotPick = pick?.plot ? options.find((b) => b.kind === pick.kind) ?? options.find((b) => b.buildable) ?? options[0] : undefined;
  const total = placed.length + plots;
  return (
    <div className="g-works" data-guide="build">
      <h3 className="g-section">
        {t('시설')} <span className="g-section__hint">{t('부지 {used} / {total}', { used: placed.length, total })}</span>
      </h3>
      <div className="g-wgrid" role="group" aria-label={t('시설')}>
        {placed.map((b) => (
          <WorkCard
            key={b.kind}
            b={b}
            faction={faction}
            own={own}
            controls={drawerId}
            selected={!!pick && !pick.plot && pick.kind === b.kind}
            flash={flash.has(b.kind)}
            onSelect={() => setPick((p) => (p && !p.plot && p.kind === b.kind ? null : { plot: false, kind: b.kind }))}
            onQuick={() => order(b.kind)}
          />
        ))}
        {Array.from({ length: plots }, (_, i) => (
          <PlotCard key={`plot-${i}`} own={own && options.length > 0} controls={drawerId} selected={!!pick?.plot && i === 0} onSelect={() => setPick((p) => (p?.plot ? null : { plot: true }))} />
        ))}
      </div>
      {chosen && <WorkDetail id={drawerId} b={chosen} faction={faction} own={own} onBuild={() => build(chosen.kind)} onCancel={region.works.find((w) => w.kind === chosen.kind)?.cancelable ? () => onCancelBuild?.(region.id, chosen.kind) : undefined} onClose={() => setPick(null)} />}
      {pick?.plot && plotPick && (
        <div className="g-wpick">
          <div className="g-wpick__head">{t('빈 부지에 지을 시설')}</div>
          <div className="g-wpick__row" role="group" aria-label={t('빈 부지에 지을 시설')}>
            {options.map((b) => (
              <WorkCard key={b.kind} small b={b} faction={faction} own={own} controls={drawerId} selected={plotPick.kind === b.kind} onSelect={() => setPick({ plot: true, kind: b.kind })} onQuick={() => order(b.kind)} />
            ))}
          </div>
          <WorkDetail id={drawerId} b={plotPick} faction={faction} own={own} onBuild={() => order(plotPick.kind)} onClose={() => setPick(null)} />
        </div>
      )}
    </div>
  );
}

// --- Ships -----------------------------------------------------------------------------------------------------

function ShipCard({ r, selected, controls, onSelect, onQuick }: { r: RecruitView; selected: boolean; controls: string; onSelect: () => void; onQuick: () => void }) {
  const t = useT();
  const locked = !!r.blocked && !r.short;
  const cls = ['g-wcard', 'g-wcard--ship', !r.blocked && 'g-wcard--can', locked && 'g-wcard--locked', r.short && 'g-wcard--short', selected && 'g-wcard--on'].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <button type="button" className="g-wcard__main" aria-pressed={selected} aria-controls={controls} aria-label={`${r.name} · ${r.blocked ?? t('{cost} · {turns}', { cost: goldText(r.cost), turns: turnsText(r.turns) })}`} onClick={onSelect} onDoubleClick={r.blocked ? undefined : onQuick}>
        <img className="g-wcard__art" src={shipArt(r.kind)} alt="" width={384} height={384} loading="lazy" decoding="async" draggable={false} />
        <span className="g-wcard__shade" aria-hidden />
        {locked && (
          <span className="g-wcard__badge g-wcard__badge--lock" aria-hidden>
            <Icon name="lock" size="sm" />
          </span>
        )}
        <span className="g-wcard__foot">
          <span className="g-wcard__name">{r.name}</span>
          <span className={`g-wcard__cost${r.short ? ' g-wcard__cost--short' : ''}`}>
            <Icon name="coin" size="sm" />
            {num(r.cost)}
          </span>
        </span>
      </button>
      {!r.blocked && (
        <button type="button" className="g-wcard__quick" aria-label={t('{ship} 건조 · {cost}', { ship: r.name, cost: goldText(r.cost) })} title={t('건조')} onClick={onQuick}>
          <Icon name="plus" size="sm" />
        </button>
      )}
    </div>
  );
}

/** A stat with a bar against the best of the ships on offer here. */
function StatBar({ label, value, best, text }: { label: string; value: number; best: number; text: string }) {
  return (
    <div className="g-sstat">
      <span className="g-sstat__label">{label}</span>
      <span className="g-sstat__bar" aria-hidden>
        <i style={{ width: `${Math.max(4, Math.min(100, (value / Math.max(1e-6, best)) * 100))}%` }} />
      </span>
      <b className="g-sstat__value">{text}</b>
    </div>
  );
}

function YardSlot({ q, idle, flash, onCancel }: { q: YardItemView; idle: boolean; flash: boolean; onCancel?: () => void }) {
  const t = useT();
  const label = idle ? t('선소 없음 · 대기 중') : t('{turns} 뒤 완성', { turns: turnsText(q.turnsLeft) });
  return (
    <li className={`g-yslot${idle ? ' g-yslot--idle' : ''}${flash ? ' g-yslot--flash' : ''}`}>
      <img className="g-yslot__art" src={shipArt(q.kind)} alt="" width={384} height={384} loading="lazy" decoding="async" draggable={false} />
      <span className="g-yslot__shade" aria-hidden />
      <Ring done={q.total ? 1 - q.turnsLeft / q.total : 0} left={q.turnsLeft} label={`${q.name} · ${label}`} />
      <span className="g-yslot__name">{q.name}</span>
      {onCancel && (
        <button type="button" className="g-yslot__cancel" aria-label={t('{ship} 주문 취소', { ship: q.name })} title={t('취소')} onClick={onCancel}>
          <Icon name="close" size="sm" />
        </button>
      )}
    </li>
  );
}

export function ShipYard({ region, onRecruit, onCancelRecruit }: { region: RegionView; onRecruit?: (regionId: string, kind: ShipClass) => void; onCancelRecruit?: (regionId: string, itemId: string) => void }) {
  const t = useT();
  const [pick, setPick] = useState<ShipClass | null>(null);
  useEffect(() => setPick(null), [region.id]);
  const flash = useFlourish(region.id, region.yard.map((q) => ({ key: q.id, stamp: '' })));
  const chosen = region.recruit.find((r) => r.kind === pick);
  const drawerId = `g-sdetail-${region.id}`;
  const best = (f: (r: RecruitView) => number) => Math.max(...region.recruit.map(f));
  const recruit = (kind: ShipClass) => onRecruit?.(region.id, kind);
  // A quick order (the corner button or a double click) leaves the ship picked, like an order from its drawer.
  const quick = (kind: ShipClass) => {
    recruit(kind);
    setPick(kind);
  };
  const empty = Math.max(0, region.yardSlots - region.yard.length);
  return (
    <div className="g-yard">
      <h3 className="g-section">
        {t('함선 건조')} <span className="g-section__hint">{region.yardIdle ? t('선소가 완공되어야 건조가 시작됩니다') : region.yardSlots ? t('건조 칸 {n} / {max}', { n: region.yard.length, max: region.yardSlots }) : t('주문 즉시 은이 차감됩니다')}</span>
      </h3>
      {region.yard.length > 0 && (
        <ul className="g-yslots" aria-label={t('건조 중인 함선')}>
          {region.yard.map((q) => (
            <YardSlot key={q.id} q={q} idle={region.yardIdle} flash={flash.has(q.id)} onCancel={q.cancelable ? () => onCancelRecruit?.(region.id, q.id) : undefined} />
          ))}
          {empty > 0 && (
            <li className="g-yslot g-yslot--free">
              <span>{t('빈 칸 {n}', { n: empty })}</span>
            </li>
          )}
        </ul>
      )}
      {region.recruit.length > 0 && (
        <div className="g-wgrid g-wgrid--ships" role="group" aria-label={t('함선 건조')}>
          {region.recruit.map((r) => (
            <ShipCard key={r.kind} r={r} controls={drawerId} selected={pick === r.kind} onSelect={() => setPick((p) => (p === r.kind ? null : r.kind))} onQuick={() => quick(r.kind)} />
          ))}
        </div>
      )}
      {chosen && (
        <Drawer
          id={drawerId}
          reveal={chosen.kind}
          art={shipArt(chosen.kind)}
          onClose={() => setPick(null)}
          eyebrow={t('함선')}
          title={chosen.name}
          footer={
            <>
              <Price gold={goldText(num(chosen.cost))} turns={chosen.turns} short={chosen.short} />
              <button type="button" className="g-btn g-btn--primary g-wdetail__go" disabled={!!chosen.blocked} onClick={() => recruit(chosen.kind)}>
                <Icon name="plus" size="sm" />
                {t('건조')}
              </button>
            </>
          }
        >
          <div className="g-sstats">
            <StatBar label={t('선체')} value={chosen.stats.hull} best={best((r) => r.stats.hull)} text={num(chosen.stats.hull)} />
            <StatBar label={t('승조원')} value={chosen.stats.crew} best={best((r) => r.stats.crew)} text={num(chosen.stats.crew)} />
            <StatBar label={t('화포')} value={chosen.stats.guns} best={best((r) => r.stats.guns)} text={t('{n}문', { n: chosen.stats.guns })} />
            <StatBar label={t('속력')} value={chosen.stats.knots} best={best((r) => r.stats.knots)} text={t('{n}노트', { n: chosen.stats.knots })} />
            <StatBar label={t('전투력')} value={chosen.stats.power} best={best((r) => r.stats.power)} text={num(chosen.stats.power)} />
          </div>
          {chosen.blocked && (
            <p className="g-wdetail__why" role="note">
              <Icon name={chosen.short ? 'coin' : 'lock'} size="sm" />
              {chosen.blocked}
            </p>
          )}
        </Drawer>
      )}
    </div>
  );
}
