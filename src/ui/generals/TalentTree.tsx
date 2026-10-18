import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { generalById, isImjin } from '../../meta/catalog';
import { useLocalProfile } from '../../meta/localProfile';
import { generalMods, generalState, keystoneOf, learnProblem, levelProgress, MAX_LEVEL, respecCost, respecProblem, skillPointsLeft, talentPoints, type Profile } from '../../meta/rules';
import { BRANCH_LABEL, branchesOf, MILESTONES, nodeAdds, resonates, TIER_GATE, spentIn, talentsFor, traitKeys, type ModKey, type TalentNode } from '../../meta/talents';

export const MOD_LABEL: Record<string, string> = { reload: '장전 속도', accuracy: '명중률', speed: '항속', turn: '선회', fire: '화공', melee: '백병', defense: '방어', morale: '사기' };
const signed = (x: number) => `${x >= 0 ? '+' : '−'}${Math.round(Math.abs(x) * 1000) / 10}%`;
const MOD_ORDER: ModKey[] = ['reload', 'accuracy', 'fire', 'speed', 'turn', 'melee', 'defense', 'morale'];

type NodeState = 'have' | 'part' | 'open' | 'lock' | 'shut';

/** The level track: every milestone on the way to MAX_LEVEL, lit once reached. */
function Milestones({ level }: { level: number }) {
  const t = useT();
  return (
    <ol className="tal-miles" aria-label={t('성장 이정표')}>
      <i className="tal-miles__bar" style={{ width: `${((level - 1) / (MAX_LEVEL - 1)) * 100}%` }} aria-hidden="true" />
      {MILESTONES.map((m) => (
        <li key={m.level} className={`tal-mile${level >= m.level ? ' tal-mile--on' : ''}`} style={{ left: `${((m.level - 1) / (MAX_LEVEL - 1)) * 100}%` }} title={`${t(m.label)}: ${t(m.text)}`}>
          <b>{m.level}</b>
          <span>{t(m.label)}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * A general's talent tree: three branch columns of five tiers with their links, his 비기 under them, the milestones
 * on the level track, and a card for the picked node with what the next rank would change before it is learned.
 */
export function TalentTree({ id, profile }: { id: string; profile: Profile }) {
  const t = useT();
  const learn = useLocalProfile((s) => s.learn);
  const respec = useLocalProfile((s) => s.respec);
  const nodes = useMemo(() => talentsFor(id), [id]);
  const branches = useMemo(() => branchesOf(id), [id]);
  const talents = generalState(profile, id).talents;
  const prog = levelProgress(generalState(profile, id).xp);
  const left = skillPointsLeft(profile, id);
  const keystone = keystoneOf(profile, id);
  const [pick, setPick] = useState<string | null>(null);
  const picked = nodes.find((n) => n.id === pick) ?? null;
  const res = new Set(traitKeys(id));

  const stateOf = (n: TalentNode): NodeState => {
    const r = talents[n.id] ?? 0;
    if (r >= n.ranks) return 'have';
    if (n.keystone && keystone && keystone.id !== n.id) return 'shut';
    if (!learnProblem(profile, id, n.id)) return r > 0 ? 'part' : 'open';
    return r > 0 ? 'part' : 'lock';
  };

  // 1592 generals read their talents in hanja; the other chapters' in the first syllables of the Korean name.
  const imjin = isImjin(generalById(id)?.faction ?? '');
  const glyph = (n: TalentNode) => (imjin && /[一-鿿]/.test(n.hanja) ? n.hanja.slice(0, n.branch === 'mastery' ? 3 : 2) : t(n.label).replace(/\s/g, '').slice(0, n.branch === 'mastery' ? 4 : 2));
  const nodeButton = (n: TalentNode) => {
    const st = stateOf(n);
    const r = talents[n.id] ?? 0;
    return (
      <button
        key={n.id}
        data-talent={n.id}
        className={`tal-node tal-node--${st}${n.keystone ? ' tal-node--key' : ''}${n.branch === 'mastery' ? ' tal-node--mastery' : ''}${resonates(id, n) ? ' tal-node--res' : ''}${pick === n.id ? ' tal-node--pick' : ''}`}
        style={n.branch === 'mastery' ? undefined : { gridColumn: n.col + 1, gridRow: n.tier }}
        aria-pressed={pick === n.id}
        aria-label={`${t(n.label)} ${r}/${n.ranks}`}
        onClick={() => setPick(n.id)}
      >
        <span className="tal-node__glyph" aria-hidden="true">{glyph(n)}</span>
        <span className="tal-node__name">{t(n.label)}</span>
        <span className="tal-node__rank">{r}/{n.ranks}</span>
      </button>
    );
  };

  return (
    <section className="tal" aria-label={t('재능')} data-general-tree={id}>
      <header className="tal-head">
        <div>
          <b className="tal-head__points">{left}</b>
          <span>{t('남은 재능 점수')} <small>/ {talentPoints(profile, id)}</small></span>
        </div>
        <RespecButton id={id} profile={profile} onRespec={() => { respec(id); setPick(null); }} />
      </header>
      <Milestones level={prog.level} />
      <div className="tal-branches">
        {branches.map((b) => {
          const spent = spentIn(talents, b);
          const list = nodes.filter((n) => n.branch === b);
          return (
            <div key={b} className={`tal-branch tal-branch--${b}`}>
              <h3>{t(BRANCH_LABEL[b])} <small>{spent}{t('점')}</small></h3>
              <div className="tal-grid">
                <svg className="tal-links" viewBox="0 0 3 5" preserveAspectRatio="none" aria-hidden="true">
                  {list.flatMap((a) => list.filter((z) => z.tier === a.tier + 1).map((z) => {
                    const lit = (talents[a.id] ?? 0) > 0 && (talents[z.id] ?? 0) > 0;
                    const open = spent >= TIER_GATE[z.tier];
                    return <line key={`${a.id}-${z.id}`} x1={a.col + 0.5} y1={a.tier - 0.5} x2={z.col + 0.5} y2={z.tier - 0.5} className={lit ? 'tal-link--lit' : open ? 'tal-link--open' : ''} vectorEffect="non-scaling-stroke" />;
                  }))}
                </svg>
                {list.map(nodeButton)}
                {([2, 3, 4, 5] as const).map((tier) => spent < TIER_GATE[tier] && (
                  <span key={tier} className="tal-gate" style={{ gridRow: tier }} aria-hidden="true">{TIER_GATE[tier]}{t('점')}</span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="tal-crown">{nodes.filter((n) => n.branch === 'mastery').map(nodeButton)}</div>
      {picked ? (
        <NodeCard id={id} node={picked} profile={profile} resonance={res} onLearn={() => learn(id, picked.id)} />
      ) : (
        <p className="tal-hint">{t('재능을 눌러 효과를 미리 보고 익히세요. 가지마다 점수를 쓰면 다음 단이 열리고, 10레벨에는 세 가지 중 하나의 핵심 재능을 고릅니다.')} {t('같은 능력을 올리는 재능은 공명해 50% 더 강해집니다')}</p>
      )}
    </section>
  );
}

function RespecButton({ id, profile, onRespec }: { id: string; profile: Profile; onRespec: () => void }) {
  const t = useT();
  const [armed, setArmed] = useState(false);
  const why = respecProblem(profile, id);
  const cost = respecCost(profile, id);
  return (
    <button className={`tal-respec${armed ? ' tal-respec--armed' : ''}`} disabled={!!why} title={why ? t(why) : undefined} onClick={() => { if (armed) { onRespec(); setArmed(false); } else setArmed(true); }} onBlur={() => setArmed(false)}>
      {armed ? t('정말 되돌릴까요?') : t('재능 초기화')} <small>{cost === 0 ? t('첫 번째 무료') : t('{n} 엽전', { n: cost.toLocaleString() })}</small>
    </button>
  );
}

/** The picked node: its ranks, what one rank adds (resonance marked), why it is shut, and the general's factors before and after. */
function NodeCard({ id, node, profile, resonance, onLearn }: { id: string; node: TalentNode; profile: Profile; resonance: Set<ModKey>; onLearn: () => void }) {
  const t = useT();
  const talents = generalState(profile, id).talents;
  const r = talents[node.id] ?? 0;
  const why = learnProblem(profile, id, node.id);
  const one = nodeAdds(id, node, 1);
  const now = generalMods(profile, id);
  const next = r < node.ranks ? generalMods(profile, id, { ...talents, [node.id]: r + 1 }) : null;
  const changed = next ? MOD_ORDER.filter((k) => Math.abs(next[k] - now[k]) > 1e-9) : [];
  return (
    <article className={`tal-card${node.keystone ? ' tal-card--key' : ''}`} aria-live="polite">
      <header>
        <span className="tal-card__kind">{t(node.keystone ? '핵심 재능' : node.branch === 'mastery' ? '비기' : `${BRANCH_LABEL[node.branch as keyof typeof BRANCH_LABEL]} ${node.tier}단`)}</span>
        <h4>{t(node.label)} {(isImjin(generalById(id)?.faction ?? '') || !/[一-鿿]/.test(node.hanja)) && <small>{node.hanja}</small>}</h4>
        <span className="tal-card__rank">{r} / {node.ranks}</span>
      </header>
      <p className="tal-card__line">{t(node.line)}</p>
      <ul className="tal-card__per">
        {(Object.entries(one) as [ModKey, number][]).map(([k, v]) => (
          <li key={k} className={v < 0 ? 'tal-neg' : resonance.has(k) && node.branch !== 'mastery' ? 'tal-res' : ''}>
            {t(MOD_LABEL[k]!)} {signed(v)}{node.ranks > 1 ? ` ${t('/ 단계')}` : ''}{v > 0 && resonance.has(k) && node.branch !== 'mastery' ? <em> {t('공명')}</em> : null}
          </li>
        ))}
      </ul>
      {next && changed.length > 0 && (
        <div className="tal-card__preview">
          <span>{t('익히면')}</span>
          {changed.map((k) => (
            <span key={k} className={next[k] < now[k] ? 'tal-neg' : ''}>{t(MOD_LABEL[k]!)} {signed(now[k] - 1)} → <b>{signed(next[k] - 1)}</b></span>
          ))}
        </div>
      )}
      {node.keystone && <p className="tal-card__note">{t('핵심 재능은 세 가지 중 하나만 익힐 수 있습니다. 바꾸려면 재능을 초기화하세요.')}</p>}
      <button className="tal-card__learn" disabled={!!why} onClick={onLearn}>{why ? t(why) : r > 0 ? t('한 단계 더 익히기') : t('익히기')}</button>
    </article>
  );
}
