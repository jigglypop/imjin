import type { Engine } from '../game/Engine';
import type { ConquestSnapshot, PointDetail, PrimaryInfo } from '../state/store';
import type { CrewPlan } from '../sim/types';
import { useT } from '../i18n';
import { Icon } from './battleIcons';

const won = (n: number) => n.toLocaleString('ko-KR');

function clock(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Ticket meters and the treasury chips, under the battle balance. */
export function ConquestBar({ c }: { c: ConquestSnapshot }) {
  const t = useT();
  return (
    <div className="cq-bar">
      <div className="cq-tickets">
        <div className="cq-ticket cq-ticket--own" title={t('아군 기세')}>
          <span>
            <small>{t('기세')}</small> <b>{won(c.tickets.own)}</b> <small>{t('거점 {n}', { n: c.held.own })}</small>
          </span>
          <div className="cq-meter">
            <i style={{ width: `${(c.tickets.own / c.tickets.max) * 100}%` }} />
          </div>
        </div>
        <span className="cq-clock" title={t('남은 시간')}>
          {clock(c.timeLeft)}
        </span>
        <div className="cq-ticket cq-ticket--foe" title={t('적 기세')}>
          <span>
            <small>{t('거점 {n}', { n: c.held.foe })}</small> <b>{won(c.tickets.foe)}</b> <small>{t('기세')}</small>
          </span>
          <div className="cq-meter">
            <i style={{ width: `${(c.tickets.foe / c.tickets.max) * 100}%` }} />
          </div>
        </div>
      </div>
      <div className="cq-chips">
        <span className="cq-chip">
          <small>{t('군자금')}</small> <b>{won(c.funds)}</b> <em>{t('+{n}/분', { n: c.income })}</em>
        </span>
        <span className="cq-chip" title={t('함대 전력과 상한')}>
          <small>{t('전력')}</small> <b>{won(c.fleetValue)}</b> <em>/{won(c.cap)}</em>
        </span>
        <span className="cq-chip">
          <small>{t('함선')}</small> <b>{c.ships}</b> <em>/{c.maxShips}</em>
        </span>
      </div>
    </div>
  );
}

/** The picked capture point: holder, shore works, and the slipway for the player's own points. */
export function PointPanel({ engine, p, onClose }: { engine: Engine; p: PointDetail; onClose: () => void }) {
  const t = useT();
  const holdPct = Math.round(Math.abs(p.hold) * 100);
  return (
    <aside className="cq-point glass interactive">
      <div className="cq-point-head">
        <i className={`cq-edge cq-edge--${p.side}`} />
        <div>
          <div className="cq-point-name">{t(p.name)}</div>
          <div className="cq-point-sub">
            {p.holder}
            {p.home ? ' · ' + t('본거지') : ''}
            {p.contested ? ' · ' + t('교전 중') : ''}
            {' · ' + t('가치 {n}', { n: p.value })}
          </div>
        </div>
        <button className="cq-close" onClick={onClose} aria-label={t('닫기')}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className={`cq-hold cq-hold--${p.side}`}>
        <i style={{ width: `${holdPct}%` }} />
        <span>{t('장악 {n}%', { n: holdPct })}</span>
      </div>
      <div className="cq-label">{t('시설')}</div>
      <div className="cq-works">
        {p.buildings.map((bd, i) =>
          bd ? (
            <div key={i} className={`cq-work ${bd.progress < 1 ? 'cq-work--building' : ''}`} title={t(bd.label)}>
              <Icon name={bd.kind} size={20} />
              <span>{t(bd.label)}</span>
              <div className="cq-work-bar">
                <i style={{ width: `${(bd.progress < 1 ? bd.progress : bd.hp) * 100}%` }} />
              </div>
              {p.mine && (
                <button className="cq-x" title={t('철거 (비용 일부 환급)')} aria-label={t('{name} 철거', { name: t(bd.label) })} onClick={() => engine.issue({ type: 'demolish', point: p.id, slot: bd.slot })}>
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>
          ) : (
            <div key={i} className="cq-work cq-work--empty">
              {t('빈 터')}
            </div>
          ),
        )}
      </div>
      {p.mine && (
        <>
          <div className="cq-label">{t('건설')}</div>
          <div className="cq-buttons">
            {p.build.map((b) => (
              <button key={b.kind} className="chip cq-buy" disabled={!b.ok} title={t(b.desc)} onClick={() => engine.issue({ type: 'build', point: p.id, building: b.kind })}>
                <Icon name={b.kind} size={16} />
                {t(b.label)}
                <small>{won(b.cost)}</small>
              </button>
            ))}
          </div>
        </>
      )}
      {p.mine && p.shipyard && (
        <>
          <div className="cq-label">
            {t('함선 건조')} {p.queue.length ? '· ' + t('대기 {n}', { n: p.queue.length }) : ''}
          </div>
          <div className="cq-buttons">
            {p.recruit.map((r) => (
              <button key={r.kind} className="chip cq-buy" disabled={!r.ok} title={t('{name} · {n}초', { name: t(r.label), n: r.time })} onClick={() => engine.issue({ type: 'recruit', point: p.id, kind: r.kind })}>
                {t(r.label)}
                <small>{won(r.cost)}</small>
              </button>
            ))}
          </div>
          {p.queue.length > 0 && (
            <div className="cq-queue">
              {p.queue.map((q, i) => (
                <button key={i} className="cq-q" title={t('취소')} onClick={() => engine.issue({ type: 'cancel', point: p.id, index: i })}>
                  <span>{t(q.label)}</span>
                  <i style={{ width: `${i === 0 ? (1 - q.left / q.total) * 100 : 0}%` }} />
                  <small>{i === 0 ? t('{n}초', { n: q.left }) : t('대기')}</small>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {p.mine && !p.shipyard && <div className="cq-hint">{t('선소를 지으면 이 거점에서 함선을 건조할 수 있습니다.')}</div>}
      {!p.mine && p.side === 'foe' && <div className="cq-hint">{t('적 시설에 공격 명령을 내리면 포격합니다. 원 안에 아군만 남으면 거점을 차지합니다.')}</div>}
      {!p.mine && p.side === 'none' && <div className="cq-hint">{t('함선을 원 안으로 보내 거점을 차지합니다. 작은 함선은 절반으로 셉니다.')}</div>}
    </aside>
  );
}

/** Stations in CREW_ROLES order; the third is the small arms the ship carries. */
const ROLE_LABEL = ['노 젓기', '포격', '', '백병전'];

function emphasize(base: CrewPlan, role: number): CrewPlan {
  if (base[role] === 0) return base;
  const target = Math.min(0.85, base[role] + 0.2);
  const scale = (1 - target) / Math.max(1e-6, 1 - base[role]);
  return base.map((v, i) => (i === role ? target : v * scale)) as CrewPlan;
}

function nudge(plan: CrewPlan, base: CrewPlan, role: number, delta: number): CrewPlan {
  if (base[role] === 0) return plan;
  const target = Math.max(0.02, Math.min(0.9, plan[role] + delta));
  const rest = 1 - plan[role];
  const scale = rest > 1e-6 ? (1 - target) / rest : 0;
  return plan.map((v, i) => (i === role ? target : v * scale)) as CrewPlan;
}

/** Stations of the selected ship: who is at the oars, the guns, the bows and on deck, and the plan to move them. */
export function CrewPanel({ engine, p }: { engine: Engine; p: PrimaryInfo }) {
  const t = useT();
  const labels = ROLE_LABEL.map((l, i) => t(i === 2 ? (p.arms === 'gun' ? '조총' : '활') : l));
  const total = p.roles.reduce((a, v) => a + v, 0) || 1;
  const presets: { label: string; plan: CrewPlan }[] = [
    { label: t('균형'), plan: p.defaultPlan },
    { label: t('기동'), plan: emphasize(p.defaultPlan, 0) },
    { label: t('포격'), plan: emphasize(p.defaultPlan, 1) },
    { label: t(p.arms === 'gun' ? '사격' : '활쏘기'), plan: emphasize(p.defaultPlan, 2) },
    { label: t('백병전'), plan: emphasize(p.defaultPlan, 3) },
  ];
  const same = (a: CrewPlan, b: CrewPlan) => a.every((v, i) => Math.abs(v - b[i]!) < 0.01);
  return (
    <div className="crew-panel">
      <div className="crew-rows">
        {p.roles.map((n, i) => (
          <div key={i} className={`crew-row ${p.defaultPlan[i] === 0 ? 'crew-row--off' : ''}`}>
            <span>{labels[i]}</span>
            <div className="crew-bar">
              <i style={{ width: `${(n / total) * 100}%` }} />
              <em style={{ left: `${p.plan[i]! * 100}%` }} />
            </div>
            <small>{n}</small>
            {p.owned && p.defaultPlan[i]! > 0 && (
              <>
                <button onClick={() => engine.input.setPlan(nudge(p.plan, p.defaultPlan, i, -0.05), t('{role} 줄임', { role: labels[i]! }))}>−</button>
                <button onClick={() => engine.input.setPlan(nudge(p.plan, p.defaultPlan, i, 0.05), t('{role} 늘림', { role: labels[i]! }))}>+</button>
              </>
            )}
          </div>
        ))}
      </div>
      {p.owned && (
        <div className="crew-presets">
          {presets.map((x) => (
            <button key={x.label} className={`chip ${same(x.plan, p.plan) ? 'chip--on' : ''}`} onClick={() => engine.input.setPlan(x.plan, x.label)}>
              {x.label}
            </button>
          ))}
          <button className={`chip ${engine.cutaway ? 'chip--on' : ''}`} onClick={() => engine.toggleCutaway()} title={t('선내 보기 (F)')}>
            {t(engine.cutaway ? ['', '상갑판', '포갑판', '노갑판'][engine.cutaway]! : '선내')}
          </button>
        </div>
      )}
    </div>
  );
}
