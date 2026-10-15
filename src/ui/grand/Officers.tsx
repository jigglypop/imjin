import { useEffect, useState, type ReactNode } from 'react';
import { useT } from '../../i18n';
import type { AbilityIcon } from '../../sim/grand/officerData';
import { Icon, Modal, goldText, toneStyle } from './shared';
import type { BranchView, CandidateView, EffectLine, OfferView, OfficerView, PromoteView, SeatsView, SkillNodeView, TraitView } from './officersAdapt';
import type { FactionId } from './types';
import './officers.css';

/**
 * The officers' screens of the faction campaign: the characters panel (인물), the character sheet with its skill tree,
 * the recruits (등용), the men raised from the ranks (발탁), the recommendation cards (천거) and the fleet panel's
 * lieutenant seats. Prop-driven like the rest of the kit; the views come from officersAdapt.ts.
 */

const ABILITY_PATHS: Record<AbilityIcon, string> = {
  wing: 'M3 14c4-1 6-4 9-8 3 4 5 7 9 8M6 16c2 2 4 3 6 3s4-1 6-3M12 6v13',
  cannon: 'M3 16h11l5-4.5M5 16a2.5 2.5 0 1 0 5 0M17 9l3-2M19.5 12.5H22',
  wave: 'M3 10c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0',
  sword: 'M14.5 4H20v5.5L9 20.5 6.5 18zM5 14l5 5M4 20l2-2',
  shield: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6zM12 8v8M9 11h6',
  fire: 'M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z',
  eye: 'M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  smoke: 'M6 16a3 3 0 0 1 0-6 4 4 0 0 1 7-2 3.5 3.5 0 0 1 5 3 2.5 2.5 0 0 1 0 5zM8 20h8',
  hammer: 'M14 4l6 6-3 3-6-6zM12 9l-8 8 3 3 8-8',
  scroll: 'M7 4h11v14a2 2 0 0 1-2 2H6M7 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2M10 8h5M10 12h5',
  flag: 'M6.5 21V4M6.5 5h11l-3 3.5 3 3.5h-11',
  anchor: 'M12 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4M12 7.5V20M8 11h8M5 14c0 4 3 6 7 6s7-2 7-6',
  coin: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM9.5 9.5h5v5h-5z',
  star: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z',
};

export function AbilityGlyph({ icon, size = 22 }: { icon: AbilityIcon; size?: number }) {
  return (
    <svg className="go-glyph" viewBox="0 0 24 24" width={size} height={size} aria-hidden focusable="false">
      <path d={ABILITY_PATHS[icon]} />
    </svg>
  );
}

const portraitSrc = (p: string) => `/ui/portraits/${p}.jpg`;

/** A portrait in a brass frame; `size` is its edge in px. */
export function Portrait({ src, size, faction, glow, className = '' }: { src: string; size: number; faction: FactionId; glow?: boolean; className?: string }) {
  return (
    <span className={`go-frame${glow ? ' go-frame--glow' : ''} ${className}`} style={{ width: size, height: size, ...toneStyle(faction) }}>
      <img src={portraitSrc(src)} alt="" width={size} height={size} draggable={false} loading="lazy" />
    </span>
  );
}

function Effects({ lines }: { lines: EffectLine[] }) {
  if (!lines.length) return null;
  return (
    <span className="go-effects">
      {lines.map((l) => (
        <span key={l.key} className={`go-effect${l.good ? '' : ' go-effect--bad'}`}>
          {l.text}
        </span>
      ))}
    </span>
  );
}

export function TraitChip({ trait, open, onToggle }: { trait: TraitView; open?: boolean; onToggle?: () => void }) {
  return (
    <button type="button" className={`go-trait${trait.good ? '' : ' go-trait--bad'}${open ? ' go-trait--open' : ''}`} title={`${trait.desc} ${trait.effects.map((e) => e.text).join(', ')}`} onClick={onToggle} aria-expanded={open}>
      <span className="go-trait__hanja">{trait.hanja}</span>
      {trait.name}
    </button>
  );
}

function XpBar({ o }: { o: OfficerView }) {
  const t = useT();
  return (
    <span className="go-xp" role="img" aria-label={o.next === null ? t('최고 계급') : t('경험 {xp}/{next}', { xp: o.xp, next: o.next })}>
      <span className="go-xp__fill" style={{ width: `${o.progress * 100}%` }} />
    </span>
  );
}

function PointsBadge({ n }: { n: number }) {
  const t = useT();
  if (n <= 0) return null;
  return (
    <span className="go-points" title={t('남은 기술 점수 {n}', { n })}>
      +{n}
    </span>
  );
}

/** One officer as a card in the characters panel. */
function OfficerCard({ o, onOpen }: { o: OfficerView; onOpen: (id: string) => void }) {
  const t = useT();
  return (
    <button type="button" className={`go-card go-card--${o.post.kind}`} style={toneStyle(o.faction)} onClick={() => onOpen(o.id)}>
      <Portrait src={o.portrait} size={64} faction={o.faction} glow={o.points > 0} />
      <span className="go-card__main">
        <span className="go-card__name">
          {o.name}
          {o.hanja && <span className="go-card__hanja">{o.hanja}</span>}
        </span>
        <span className="go-card__rank">
          {o.rank} · {t('Lv.{n}', { n: o.level })}
          {o.ability && (
            <span className="go-card__ability" title={o.ability.name}>
              <AbilityGlyph icon={o.ability.icon} size={14} />
            </span>
          )}
        </span>
        <XpBar o={o} />
        <span className="go-card__traits">
          {o.traits.slice(0, 3).map((tr) => (
            <span key={tr.id} className={`go-mini${tr.good ? '' : ' go-mini--bad'}`}>
              {tr.name}
            </span>
          ))}
          {o.traits.length > 3 && <span className="go-mini">+{o.traits.length - 3}</span>}
        </span>
        <span className={`go-card__post go-post--${o.post.kind}`}>{o.post.text}</span>
      </span>
      <PointsBadge n={o.points} />
    </button>
  );
}

function Stats({ o }: { o: OfficerView }) {
  const t = useT();
  const names: [string, string][] = [['統率', t('지휘')], ['戰術', t('전술')], ['軍政', t('군정')]];
  return (
    <div className="go-stats">
      {names.map(([h, n], i) => (
        <div key={h} className="go-stat">
          <span className="go-stat__label">
            <b>{h}</b> {n}
          </span>
          <span className="go-stat__bar">
            <span style={{ width: `${o.stats[i]! * 10}%` }} />
          </span>
          <span className="go-stat__val">{o.stats[i]}</span>
        </div>
      ))}
    </div>
  );
}

function CandidateCard({ c, gold, onHire, onOpen }: { c: CandidateView; gold: number; onHire: (id: string) => void; onOpen?: (c: CandidateView) => void }) {
  const t = useT();
  const o = c.officer;
  return (
    <article className="go-recruit" style={toneStyle(o.faction)}>
      <button type="button" className="go-recruit__face" onClick={() => onOpen?.(c)} aria-label={o.name}>
        <Portrait src={o.portrait} size={96} faction={o.faction} glow={o.named} />
      </button>
      <div className="go-recruit__body">
        <div className="go-card__name">
          {o.name}
          {o.hanja && <span className="go-card__hanja">{o.hanja}</span>}
        </div>
        <div className="go-card__rank">
          {o.title ?? o.rank} · {t('Lv.{n}', { n: o.level })}
        </div>
        <Stats o={o} />
        <div className="go-card__traits">
          {o.traits.map((tr) => (
            <span key={tr.id} className={`go-mini${tr.good ? '' : ' go-mini--bad'}`} title={tr.desc}>
              {tr.name}
            </span>
          ))}
        </div>
        {o.ability && (
          <div className="go-recruit__ability">
            <AbilityGlyph icon={o.ability.icon} size={16} /> {o.ability.name}
          </div>
        )}
        <p className="go-recruit__bio">{o.bio}</p>
        <div className="go-recruit__foot">
          <span className="go-recruit__where">{c.left === null ? c.place : t('{place} · {n}턴 남음', { place: c.place, n: c.left })}</span>
          <button type="button" className="g-btn g-btn--primary g-btn--sm" disabled={gold < c.cost} onClick={() => onHire(c.id)}>
            {t('등용 · {gold}', { gold: goldText(c.cost) })}
          </button>
        </div>
      </div>
    </article>
  );
}

type Tab = 'roster' | 'recruit' | 'ranks';
const TAB_LABEL = { roster: '인물', recruit: '등용', ranks: '발탁' };

export interface OfficersPanelProps {
  me: FactionId;
  roster: OfficerView[];
  candidates: CandidateView[];
  promotes: PromoteView[];
  gold: number;
  promoteCost: number;
  canOrder: boolean;
  onOpen: (id: string) => void;
  onHire: (candidateId: string) => void;
  onPromote: (fleetId: string, shipId: string) => void;
  onClose: () => void;
}

/** The characters panel (인물): every officer of the player's navy, the camps' recruits and the veterans fit for a commission. */
export function OfficersPanel({ me, roster, candidates, promotes, gold, promoteCost, canOrder, onOpen, onHire, onPromote, onClose }: OfficersPanelProps) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('roster');
  const [filter, setFilter] = useState<'all' | 'posted' | 'free'>('all');
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [onClose]);
  const shown = roster.filter((o) => filter === 'all' || (filter === 'posted' ? o.post.kind === 'commander' || o.post.kind === 'lieutenant' : o.post.kind === 'pool' || o.post.kind === 'wounded' || o.post.kind === 'captive'));
  const points = roster.reduce((n, o) => n + o.points, 0);
  const counts = { roster: roster.length, recruit: candidates.length, ranks: promotes.length };
  const tabs = (Object.keys(TAB_LABEL) as Tab[]).map((id) => [id, t(TAB_LABEL[id]), counts[id]] as const);
  return (
    <div className="g-scrim go-scrim" role="presentation" onClick={onClose}>
      <section className="g-glass g-modal go-window" role="dialog" aria-modal="true" aria-label={t('인물')} style={toneStyle(me)} onClick={(e) => e.stopPropagation()}>
        <header className="go-window__head">
          <div className="go-window__titles">
            <span className="go-window__seal" aria-hidden>
              人物
            </span>
            <div>
              <h2 className="g-sheet__title">{t('인물')}</h2>
              <div className="g-sheet__eyebrow">{points > 0 ? t('군관 {n}명 · 남은 기술 점수 {p}', { n: roster.length, p: points }) : t('군관 {n}명', { n: roster.length })}</div>
            </div>
          </div>
          <button type="button" className="g-icon-btn" aria-label={t('닫기')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <nav className="go-tabs" role="tablist">
          {tabs.map(([id, label, n]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`go-tab${tab === id ? ' go-tab--on' : ''}`} onClick={() => setTab(id)}>
              {label}
              <span className="go-tab__n">{n}</span>
            </button>
          ))}
        </nav>
        <div className="go-window__body">
          {tab === 'roster' && (
            <>
              <div className="go-filters" role="radiogroup" aria-label={t('보기')}>
                {(['all', 'posted', 'free'] as const).map((f) => (
                  <button key={f} type="button" role="radio" aria-checked={filter === f} className={`gk-chip go-filter${filter === f ? ' go-filter--on' : ''}`} onClick={() => setFilter(f)}>
                    {f === 'all' ? t('전체') : f === 'posted' ? t('함대 배속') : t('대기·부상')}
                  </button>
                ))}
              </div>
              <div className="go-grid">
                {shown.map((o) => (
                  <OfficerCard key={o.id} o={o} onOpen={onOpen} />
                ))}
              </div>
            </>
          )}
          {tab === 'recruit' && (
            <>
              <p className="g-hint">{t('군영이 있는 포구에 인재가 찾아옵니다. 몇 턴마다 새 사람이 오고, 오래 기다린 사람은 떠납니다. 역사 인물은 때가 되면 나타납니다.')}</p>
              {candidates.length ? (
                <div className="go-recruits">
                  {candidates.map((c) => (
                    <CandidateCard key={c.id} c={c} gold={canOrder ? gold : -1} onHire={onHire} />
                  ))}
                </div>
              ) : (
                <p className="go-empty">{t('지금은 등용할 인물이 없습니다. 군영을 지으면 사람이 찾아옵니다.')}</p>
              )}
            </>
          )}
          {tab === 'ranks' && (
            <>
              <p className="g-hint">{t('적선을 {n}척 이상 격침한 함선의 군관을 병사 가운데서 발탁해 새 장수로 세웁니다. 함선의 전공 절반을 가지고 갑니다.', { n: 3 })}</p>
              {promotes.length ? (
                <ul className="go-ranks">
                  {promotes.map((p) => (
                    <li key={p.shipId} className="go-rank-row">
                      <span className="go-rank-row__kills" title={t('격침')}>
                        {p.kills}
                      </span>
                      <span className="g-row__main">
                        <span className="g-row__title">{p.ship}</span>
                        <span className="g-row__sub">{t('{fleet} · {place} · 발탁하면 Lv.{n}', { fleet: p.fleet, place: p.place, n: p.level })}</span>
                      </span>
                      <button type="button" className="g-btn g-btn--sm" disabled={!canOrder || gold < promoteCost} onClick={() => onPromote(p.fleetId, p.shipId)}>
                        {t('발탁 · {gold}', { gold: goldText(promoteCost) })}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="go-empty">{t('아직 발탁할 만한 공을 세운 함선이 없습니다.')}</p>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

// --- The character sheet -----------------------------------------------------------------------------------------

/** Positions of a tier's nodes across a branch column, in percent. */
const xsOf = (n: number) => (n === 1 ? [50] : [26, 74]);

function BranchColumn({ b, picked, burst, onPick }: { b: BranchView; picked: string | null; burst: string | null; onPick: (n: SkillNodeView) => void }) {
  const tiers = [1, 2, 3, 4, 5].map((tier) => b.nodes.filter((n) => n.tier === tier));
  const pos = new Map<string, { x: number; y: number }>();
  tiers.forEach((row, i) => xsOf(row.length).forEach((x, j) => pos.set(row[j]!.id, { x, y: 10 + i * 20 })));
  const lines: { a: SkillNodeView; b: SkillNodeView }[] = [];
  for (let i = 1; i < tiers.length; i += 1) for (const a of tiers[i - 1]!) for (const c of tiers[i]!) lines.push({ a, b: c });
  return (
    <div className={`go-branch go-branch--${b.id}`}>
      <div className="go-branch__head">
        <span className="go-branch__hanja">{b.hanja}</span>
        <span className="go-branch__name">{b.name}</span>
        <span className="go-branch__desc">{b.desc}</span>
      </div>
      <div className="go-branch__tree">
        <svg className="go-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {lines.map(({ a, b: c }) => {
            const p = pos.get(a.id)!;
            const q = pos.get(c.id)!;
            const lit = a.state === 'taken' && c.state === 'taken';
            const path = a.state === 'taken' && c.state === 'open';
            return <line key={a.id + c.id} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className={lit ? 'go-link go-link--lit' : path ? 'go-link go-link--path' : 'go-link'} vectorEffect="non-scaling-stroke" />;
          })}
        </svg>
        {b.nodes.map((n) => {
          const p = pos.get(n.id)!;
          return (
            <button
              key={n.id}
              type="button"
              className={`go-node go-node--${n.state}${picked === n.id ? ' go-node--picked' : ''}${burst === n.id ? ' go-node--burst' : ''}`}
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
              title={`${n.name}: ${n.desc} ${n.effects.map((e) => e.text).join(', ')}${n.reason ? ` (${n.reason})` : ''}`}
              aria-pressed={picked === n.id}
              onClick={() => onPick(n)}
            >
              <span className="go-node__disc">{n.hanja}</span>
              <span className="go-node__name">{n.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface CharacterSheetProps {
  officer: OfficerView;
  tree: BranchView[];
  own: boolean;
  canOrder: boolean;
  /** Shows the promotion banner once: the officer has risen since the player last opened his sheet. */
  celebrate?: boolean;
  onSpend: (skillId: string) => boolean;
  onClose: () => void;
}

/** One officer: a big framed portrait, his story, stats, traits and ability, and the skill tree he spends his points on. */
export function CharacterSheet({ officer: o, tree, own, canOrder, celebrate, onSpend, onClose }: CharacterSheetProps) {
  const t = useT();
  const [picked, setPicked] = useState<string | null>(null);
  const [burst, setBurst] = useState<string | null>(null);
  const [trait, setTrait] = useState<string | null>(null);
  const [banner, setBanner] = useState(!!celebrate);
  // Esc closes the sheet alone, not the characters panel under it: this listener runs first and stops the key there.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onClose();
    };
    addEventListener('keydown', on, true);
    return () => removeEventListener('keydown', on, true);
  }, [onClose]);
  useEffect(() => {
    if (!burst) return;
    const id = setTimeout(() => setBurst(null), 1200);
    return () => clearTimeout(id);
  }, [burst]);
  useEffect(() => {
    if (!banner) return;
    const id = setTimeout(() => setBanner(false), 2600);
    return () => clearTimeout(id);
  }, [banner]);
  const node = tree.flatMap((b) => b.nodes).find((n) => n.id === picked);
  const shownTrait = o.traits.find((x) => x.id === trait);
  const spend = () => {
    if (!node || node.state !== 'open') return;
    if (onSpend(node.id)) {
      setBurst(node.id);
      setPicked(null);
    }
  };
  return (
    <div className="g-scrim go-scrim" role="presentation" onClick={onClose}>
      <section className="g-glass g-modal go-window go-sheet" role="dialog" aria-modal="true" aria-label={o.name} style={toneStyle(o.faction)} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="g-icon-btn go-sheet__close" aria-label={t('닫기')} onClick={onClose}>
          <Icon name="close" />
        </button>
        {banner && (
          <div className="go-promoted" role="status">
            <span className="go-promoted__rays" aria-hidden />
            <span className="go-promoted__kicker">{t('승진')}</span>
            <b>
              {o.rank} <span className="go-promoted__hanja">{o.rankHanja}</span>
            </b>
            <span>{t('Lv.{n} · 기술 점수 +1', { n: o.level })}</span>
          </div>
        )}
        <div className="go-sheet__grid">
          <aside className="go-hero">
            <div className="go-hero__frame">
              <span className="go-corner go-corner--tl" aria-hidden />
              <span className="go-corner go-corner--tr" aria-hidden />
              <span className="go-corner go-corner--bl" aria-hidden />
              <span className="go-corner go-corner--br" aria-hidden />
              <img src={portraitSrc(o.portrait)} alt="" draggable={false} />
              <span className="go-hero__plaque">
                <span className="go-hero__rank">
                  {o.rankHanja} · {o.rank}
                </span>
                <span className="go-hero__lv">{o.level}</span>
              </span>
            </div>
            <h2 className="go-hero__name">
              {o.name}
              {o.hanja && <span className="go-hero__hanja">{o.hanja}</span>}
            </h2>
            <div className="go-hero__title">
              {o.title ? `${o.title} · ` : ''}
              {o.post.text}
            </div>
            <div className="go-hero__xp">
              <XpBar o={o} />
              <span>{o.next === null ? t('최고 계급') : t('경험 {xp}/{next}', { xp: o.xp, next: o.next })}</span>
            </div>
            {o.bio && <p className="go-hero__bio">{o.bio}</p>}
            <Stats o={o} />
            {o.traits.length > 0 && (
              <div className="go-hero__traits">
                {o.traits.map((tr) => (
                  <TraitChip key={tr.id} trait={tr} open={trait === tr.id} onToggle={() => setTrait((x) => (x === tr.id ? null : tr.id))} />
                ))}
              </div>
            )}
            {shownTrait && (
              <p className="go-trait-detail">
                <b>{shownTrait.name}</b> {shownTrait.desc} <Effects lines={shownTrait.effects} />
              </p>
            )}
            {o.ability && (
              <div className="go-ability">
                <span className="go-ability__icon">
                  <AbilityGlyph icon={o.ability.icon} size={26} />
                </span>
                <div className="go-ability__body">
                  <div className="go-ability__kicker">{t('특수능력')}</div>
                  <div className="go-ability__name">
                    {o.ability.name} <span className="go-ability__hanja">{o.ability.hanja}</span>
                  </div>
                  <p className="go-ability__line">{o.ability.line}</p>
                  <Effects lines={o.ability.effects} />
                  {o.ability.ships && <div className="go-effect">{o.ability.ships}</div>}
                  {o.ability.battle && (
                    <div className="go-ability__battle">
                      <b>{t('해전: {name}', { name: o.ability.battle.name })}</b> {o.ability.battle.desc} <span className="go-ability__note">{t('함대를 지휘할 때만 해전에 씁니다. 부관일 때는 쓰지 않습니다.')}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            {o.effects.length > 0 && (
              <div className="go-hero__sum">
                <span className="go-hero__sum-title">{t('지휘하는 함대에 주는 효과')}</span>
                <Effects lines={o.effects} />
                <span className="go-hero__sum-note">{t('부관 자리 {n} · 부관으로 있으면 효과의 절반', { n: o.seats })}</span>
              </div>
            )}
          </aside>
          <div className="go-treebox">
            <div className="go-treebox__head">
              <span className="go-treebox__title">{t('기술')}</span>
              <span className={`go-treebox__pts${o.points > 0 ? ' go-treebox__pts--on' : ''}`}>{t('남은 점수 {n}', { n: o.points })}</span>
            </div>
            <div className="go-tree">
              {tree.map((b) => (
                <BranchColumn key={b.id} b={b} picked={picked} burst={burst} onPick={(n) => setPicked(n.id)} />
              ))}
            </div>
            <div className={`go-pick${node ? ' go-pick--on' : ''}`}>
              {node ? (
                <>
                  <span className="go-pick__disc">{node.hanja}</span>
                  <span className="go-pick__body">
                    <b>{node.name}</b> <span className="go-pick__tier">{t('{n}단계', { n: node.tier })}</span>
                    <span className="go-pick__desc">{node.desc}</span>
                    <Effects lines={node.effects} />
                    {node.reason && <span className="go-pick__why">{node.reason}</span>}
                  </span>
                  {own && node.state === 'open' && (
                    <button type="button" className="g-btn g-btn--primary go-pick__go" disabled={!canOrder} onClick={spend}>
                      {t('익히기')}
                    </button>
                  )}
                  {node.state === 'taken' && <span className="go-pick__done">{t('익힘')}</span>}
                </>
              ) : (
                <span className="g-hint">{t('기술을 눌러 효과를 보고 점수를 씁니다. 빛나는 기술은 지금 익힐 수 있습니다.')}</span>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// --- Cards and the fleet panel's seats ---------------------------------------------------------------------------

export interface OfferCardProps {
  offer: OfferView;
  gold: number;
  onAnswer: (accept: boolean) => void;
}

/** A recommendation (천거), or the court's question about trusting an officer, as a card with two answers. */
export function OfferCard({ offer, gold, onAnswer }: OfferCardProps) {
  const t = useT();
  const o = offer.officer;
  const trust = offer.kind === 'trust';
  const title = trust ? t('유성룡의 천거') : t('{name}의 천거', { name: offer.by?.name ?? t('조정') });
  const body: ReactNode = trust ? (
    <p className="g-event__text">{t('서애 유성룡이 정읍현감이던 이순신을 전라좌수사로 천거했습니다. 조정에는 파격적인 승진을 못마땅히 여기는 목소리도 있습니다. 그에게 얼마나 힘을 실어 주겠습니까?')}</p>
  ) : (
    <p className="g-event__text">{t('{by|이/가} {name|을/를} 천거합니다. {bio}', { by: offer.by?.name ?? t('조정'), name: o.name, bio: o.bio })}</p>
  );
  return (
    <Modal label={title} eyebrow={t('천거 · 인물')} title={title} tone={o.faction}>
      <div className="go-offer">
        {offer.by && !trust && (
          <span className="go-offer__by">
            <Portrait src={offer.by.portrait} size={48} faction={offer.by.faction} />
          </span>
        )}
        <Portrait src={o.portrait} size={120} faction={o.faction} glow />
        <div className="go-offer__who">
          <div className="go-card__name">
            {o.name}
            {o.hanja && <span className="go-card__hanja">{o.hanja}</span>}
          </div>
          <div className="go-card__rank">
            {o.title ?? o.rank} · {t('Lv.{n}', { n: o.level })}
          </div>
          <div className="go-card__traits">
            {o.traits.map((tr) => (
              <span key={tr.id} className={`go-mini${tr.good ? '' : ' go-mini--bad'}`} title={tr.desc}>
                {tr.name}
              </span>
            ))}
          </div>
          {o.ability && (
            <div className="go-recruit__ability">
              <AbilityGlyph icon={o.ability.icon} size={16} /> {o.ability.name} <span className="go-ability__hanja">{o.ability.hanja}</span>
            </div>
          )}
        </div>
      </div>
      {body}
      <div className="g-event__choices">
        <button type="button" className="g-choice" disabled={!trust && gold < (offer.cost ?? 0)} onClick={() => onAnswer(true)}>
          <b>{trust ? t('이순신을 믿고 맡긴다') : t('등용한다')}</b>
          <span>{trust ? t('이순신 경험 +150 · 특성 조정의 신임') : t('은 {gold} (천거로 반값)', { gold: goldText(offer.cost ?? 0) })}</span>
        </button>
        <button type="button" className="g-choice" onClick={() => onAnswer(false)}>
          <b>{trust ? t('조정의 신중론을 따른다') : t('사양한다')}</b>
          <span>{trust ? t('은 +150냥') : o.named ? t('군영에서 제값에 등용할 수 있습니다') : t('그는 다른 곳으로 떠납니다')}</span>
        </button>
      </div>
    </Modal>
  );
}

export interface LieutenantSeatsProps {
  seats: SeatsView;
  own: boolean;
  docked: boolean;
  onAdd: (officerId: string) => void;
  onRemove: (officerId: string) => void;
  onOpen: (officerId: string) => void;
}

/** The fleet panel's lieutenant seats (부관): who sits in them, empty seats to fill and the seats a higher rank would open. */
export function LieutenantSeats({ seats, own, docked, onAdd, onRemove, onOpen }: LieutenantSeatsProps) {
  const t = useT();
  const [choosing, setChoosing] = useState(false);
  if (!seats.hasCommander && !seats.lieutenants.length) return null;
  const empty = Math.max(0, seats.seats - seats.lieutenants.length);
  const locked = Math.max(0, 3 - seats.seats);
  return (
    <div className="go-seats">
      <div className="g-section">{t('부관 {n}/{m}', { n: seats.lieutenants.length, m: seats.seats })}</div>
      <div className="go-seats__row">
        {seats.lieutenants.map((o) => (
          <div key={o.id} className="go-seat go-seat--filled" style={toneStyle(o.faction)}>
            <button type="button" className="go-seat__face" onClick={() => onOpen(o.id)} title={o.name}>
              <Portrait src={o.portrait} size={44} faction={o.faction} glow={o.points > 0} />
              <span className="go-seat__name">{o.name}</span>
              <span className="go-seat__rank">{t('Lv.{n}', { n: o.level })}</span>
            </button>
            {own && docked && (
              <button type="button" className="go-seat__x" aria-label={t('{name} 내리기', { name: o.name })} onClick={() => onRemove(o.id)}>
                <Icon name="close" size="sm" />
              </button>
            )}
          </div>
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <button key={`e${i}`} type="button" className="go-seat go-seat--empty" disabled={!own || !docked || !seats.free.length} aria-expanded={choosing} onClick={() => setChoosing((c) => !c)}>
            <Icon name="plus" />
            <span>{t('부관 임명')}</span>
          </button>
        ))}
        {Array.from({ length: locked }, (_, i) => (
          <span key={`l${i}`} className="go-seat go-seat--locked" title={t('지휘관의 계급이 오르면 부관 자리가 늘어납니다')}>
            <span aria-hidden>鎖</span>
            <span>{t('계급 필요')}</span>
          </span>
        ))}
      </div>
      {choosing && empty > 0 && (
        <div className="g-merge">
          {seats.free.map((o) => (
            <button
              key={o.id}
              type="button"
              className="g-row g-row--btn"
              onClick={() => {
                onAdd(o.id);
                setChoosing(false);
              }}
            >
              <img className="g-avatar" src={portraitSrc(o.portrait)} alt="" width={34} height={34} />
              <span className="g-row__main">
                <span className="g-row__title">
                  {o.name} <span className="g-row__kind">{t('Lv.{n}', { n: o.level })}</span>
                </span>
                <span className="g-row__sub">
                  {o.post.text}
                  {o.traits.length ? ` · ${o.traits.map((x) => x.name).join(', ')}` : ''}
                </span>
              </span>
              <span className="g-chev" aria-hidden>
                <Icon name="chev" />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
