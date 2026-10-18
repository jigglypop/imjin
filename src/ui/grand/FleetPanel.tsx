import { useState } from 'react';
import { useT } from '../../i18n';
import { Bar, Chip, FactionMark, Icon, Sheet, goldText, navyName, shipName } from './shared';
import { shipsText, turnsText } from './text';
import type { CommanderView, FactionId, FleetView } from './types';
import { portraitUrl } from '../portrait';

export interface FleetPanelProps {
  fleet: FleetView;
  regionName: string;
  me: FactionId;
  /** True while the player is choosing a destination on the map. */
  moving?: boolean;
  /** Other friendly fleets in the same region this one can join. */
  mergeWith?: FleetView[];
  /** Officers the player may put in command, with the fleet each now leads (empty when free). */
  officers?: { officer: CommanderView; leads?: string }[];
  /** The ordered route as place names, with the turns it takes. */
  routeText?: string;
  gold?: number;
  onClose?: () => void;
  onMove?: (fleetId: string) => void;
  onCancelMove?: (fleetId: string) => void;
  onStop?: (fleetId: string) => void;
  onMerge?: (fleetId: string, otherId: string) => void;
  onSplit?: (fleetId: string, shipIds: string[]) => void;
  onCommander?: (fleetId: string, commanderId: string | null) => void;
  onRefit?: (fleetId: string) => void;
  onDisband?: (fleetId: string, shipIds: string[]) => void;
  /** A port's name by id, for a fleet at sea between two ports. */
  nameOf?: (regionId: string) => string;
  /** March rules: a hostile port the fleet is sent to is blockaded instead of stormed. */
  siegeOnArrival?: boolean;
  onSiegeOnArrival?: (on: boolean) => void;
  onStance?: (fleetId: string, stance: 'normal' | 'march') => void;
  onAssault?: (fleetId: string, on: boolean) => void;
}

/** March rules: the fleet's sailing this turn (distance, stance), how it ends at a hostile port, and the blockade it keeps up. */
function MarchBlock({ fleet, canMove, siegeOnArrival, onSiegeOnArrival, onStance, onAssault }: Pick<FleetPanelProps, 'fleet' | 'siegeOnArrival' | 'onSiegeOnArrival' | 'onStance' | 'onAssault'> & { canMove: boolean }) {
  const t = useT();
  const m = fleet.march!;
  const forced = m.stance === 'march';
  const siege = m.siege;
  return (
    <div className="g-march">
      <div className="g-march__row">
        <span className="g-march__label">{t('행동력')}</span>
        <b className="g-march__km">
          {t('{km}km/턴', { km: forced ? m.reach.forced : m.reach.normal })}
          {m.winter && <span className="g-march__winter" title={t('겨울: 행동력 −20% · 바다 위 보급 소모 증가')}>{t('겨울 −20%')}</span>}
        </b>
        <span className="g-level g-level--sm" role="radiogroup" aria-label={t('항해 태세')}>
          {(['normal', 'march'] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={m.stance === s} className={`g-level__opt${m.stance === s ? ' g-level__opt--on' : ''}`} disabled={(!canMove || (s === 'march' && !!m.marchBlocked)) && s !== m.stance} title={s === 'march' ? m.marchBlocked : undefined} onClick={() => m.stance !== s && onStance?.(fleet.id, s)}>
              {s === 'normal' ? t('일반') : t('강행군')}
            </button>
          ))}
        </span>
      </div>
      <p className="g-hint">
        {forced
          ? t('강행군 중에는 공격할 수 없고, 붙잡히면 지친 채 싸웁니다.')
          : t('강행군: 이번 턴 {km}km · 공격 불가', { km: m.reach.forced })}
      </p>
      {siege ? (
        <div className="g-march__siege">
          <div className="g-march__row">
            <span className="g-march__label">{t('봉쇄 중')}</span>
            <b>{t('{n}/{m}턴', { n: siege.turns, m: siege.hold })}</b>
            <Bar value={siege.turns / Math.max(1, siege.hold)} tone="warn" label={t('봉쇄 {n}/{m}', { n: siege.turns, m: siege.hold })} />
          </div>
          <p className="g-hint">{t('수입·건조 정지 · {turns} 뒤 항복', { turns: turnsText(Math.max(1, siege.hold - siege.turns)) })}</p>
          <label className="g-row g-batch-row">
            <input className="g-check" type="checkbox" checked={m.assault} onChange={(e) => onAssault?.(fleet.id, e.target.checked)} />
            <span className="g-row__main">
              <span className="g-row__title">{t('강습 명령')}</span>
              <span className="g-row__sub">{t('턴 종료 때 바로 공격합니다')}</span>
            </span>
          </label>
        </div>
      ) : (
        canMove &&
        !forced && (
          <label className="g-row g-batch-row">
            <input className="g-check" type="checkbox" checked={!!siegeOnArrival} onChange={(e) => onSiegeOnArrival?.(e.target.checked)} />
            <span className="g-row__main">
              <span className="g-row__title">{t('도착하면 봉쇄')}</span>
              <span className="g-row__sub">{t('강습하지 않고 굶겨 항복시킵니다')}</span>
            </span>
          </label>
        )
      )}
    </div>
  );
}

export function FleetPanel({
  fleet,
  regionName,
  me,
  moving,
  mergeWith = [],
  officers = [],
  routeText,
  gold = 0,
  onClose,
  onMove,
  onCancelMove,
  onStop,
  onMerge,
  onSplit,
  onCommander,
  onRefit,
  onDisband,
  nameOf,
  siegeOnArrival,
  onSiegeOnArrival,
  onStance,
  onAssault,
}: FleetPanelProps) {
  const t = useT();
  const own = fleet.faction === me;
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [sure, setSure] = useState(false);
  const toggle = (id: string) => {
    setSure(false);
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const where = fleet.transit ? t('항해 중') : regionName;
  const docked = fleet.at !== null;
  // A fleet keeps at least one ship, so splitting everything off is not offered.
  const canSplit = own && docked && picked.size > 0 && picked.size < fleet.ships.length;
  // Under the march rules a fleet at sea can be sent on, or turned back.
  const canMove = own && (docked || !!fleet.march) && fleet.rest === 0;
  const sea = fleet.transit && nameOf ? { from: nameOf(fleet.transit.from), to: nameOf(fleet.transit.to) } : null;
  const avg = (pick: (s: FleetView['ships'][number]) => number) => fleet.ships.reduce((a, s) => a + pick(s), 0) / Math.max(1, fleet.ships.length);

  return (
    <Sheet
      tone={fleet.faction}
      onClose={onClose}
      eyebrow={
        <span className="gk-row">
          <FactionMark faction={fleet.faction} />
          {navyName(fleet.faction)} · {where}
        </span>
      }
      title={fleet.name}
      footer={
        own ? (
          <div className="g-actions">
            {moving ? (
              <button type="button" className="g-btn g-btn--ghost" onClick={() => onCancelMove?.(fleet.id)}>
                {t('이동 취소')}
              </button>
            ) : (
              <button type="button" className="g-btn g-btn--primary" data-guide="move" disabled={!canMove} onClick={() => onMove?.(fleet.id)}>
                {t('이동')}
              </button>
            )}
            <button type="button" className="g-btn" disabled={!docked || mergeWith.length === 0} aria-expanded={merging} onClick={() => setMerging((m) => !m)}>
              {t('합류')}
            </button>
            <button
              type="button"
              className="g-btn"
              disabled={!canSplit}
              onClick={() => {
                onSplit?.(fleet.id, [...picked]);
                setPicked(new Set());
              }}
            >
              {picked.size > 0 ? t('분할 ({n})', { n: picked.size }) : t('분할')}
            </button>
          </div>
        ) : undefined
      }
    >
      {moving ? (
        <p className="g-banner">{fleet.march ? t('고리가 있는 포구를 고르세요. 포구에 올리면 턴별 항로가 보입니다.') : t('강조된 포구를 고르세요. 적 포구는 공격합니다.')}</p>
      ) : (
        own &&
        canMove && (
          <p className="g-hint">
            {fleet.march
              ? t('고리 색: 초록 이번 턴 · 노랑 다음 턴 · 주황 그 뒤')
              : t('강조된 적 포구를 누르면 바로 공격합니다.')}
          </p>
        )
      )}
      {fleet.transit &&
        (fleet.march && sea ? (
          <p className="g-hint">
            {fleet.route.length
              ? t('{from|과/와} {to} 사이 바다 위입니다. 다음 턴에 계속 갑니다.', sea)
              : t('{from|과/와} {to} 사이에 멈춰 있습니다. 새 목적지를 고르세요.', sea)}
          </p>
        ) : (
          <p className="g-hint">{t('{turns} 뒤 도착합니다.', { turns: turnsText(fleet.transit.left) })}</p>
        ))}
      {fleet.rest > 0 && !fleet.transit && <p className="g-hint">{t('전투 후 정비 중 · {turns} 뒤 출항', { turns: turnsText(fleet.rest) })}</p>}
      {routeText && !moving && (
        <p className="g-note g-route">
          <b>{t('항로')}</b> {routeText}
          {own && (
            <button type="button" className="g-btn g-btn--ghost g-btn--sm" onClick={() => onStop?.(fleet.id)}>
              {t('이동 명령 취소')}
            </button>
          )}
        </p>
      )}
      {own && fleet.march && <MarchBlock fleet={fleet} canMove={canMove} siegeOnArrival={siegeOnArrival} onSiegeOnArrival={onSiegeOnArrival} onStance={onStance} onAssault={onAssault} />}
      <div className="gk-stats gk-stats--2">
        <div className="gk-stat"><span className="gk-stat__label">{t('병력')}</span><span className="gk-stat__value">{t('{n}명 승조원', { n: fleet.crewCount.toLocaleString() })}</span></div>
        <div className="gk-stat">
          <span className="gk-stat__label">{t('함선')}</span>
          <span className="gk-stat__value">{shipsText(fleet.ships.length)}</span>
        </div>
        <div className="gk-stat">
          <span className="gk-stat__label">{t('평균 선체')}</span>
          <span className="gk-stat__value">{Math.round(avg((s) => s.hull) * 100)}%</span>
        </div>
        <div className="gk-stat">
          <span className="gk-stat__label">{t('보급')}</span>
          <span className="gk-stat__value">{Math.round(avg((s) => s.supply) * 100)}%</span>
        </div>
      </div>

      {fleet.commander ? (
        <div className="g-leader">
          <img src={portraitUrl(fleet.commander.portrait, true)} alt="" width={44} height={44} />
          <span className="g-row__main">
            <span className="g-row__title">{fleet.commander.name}</span>
            <span className="g-row__sub">
              {fleet.commander.title} · Lv.{fleet.commander.level}
            </span>
          </span>
          {own && docked && officers.length > 0 && (
            <button type="button" className="g-btn g-btn--sm" aria-expanded={choosing} onClick={() => setChoosing((c) => !c)}>
              {t('교체')}
            </button>
          )}
        </div>
      ) : (
        own &&
        docked &&
        officers.length > 0 && (
          <button type="button" className="g-btn g-btn--sm g-leader-add" aria-expanded={choosing} onClick={() => setChoosing((c) => !c)}>
            {t('지휘관 임명')}
          </button>
        )
      )}
      {choosing && (
        <div className="g-merge">
          {officers.map(({ officer, leads }) => (
            <button
              key={officer.id}
              type="button"
              className="g-row g-row--btn"
              onClick={() => {
                onCommander?.(fleet.id, officer.id);
                setChoosing(false);
              }}
            >
              <img className="g-avatar" src={portraitUrl(officer.portrait, true)} alt="" width={34} height={34} />
              <span className="g-row__main">
                <span className="g-row__title">
                  {officer.name} <span className="g-row__kind">Lv.{officer.level}</span>
                </span>
                <span className="g-row__sub">{leads ? t('{fleet} 지휘 중', { fleet: leads }) : officer.title}</span>
              </span>
              <span className="g-chev" aria-hidden>
                <Icon name="chev" />
              </span>
            </button>
          ))}
          {fleet.commander && (
            <button
              type="button"
              className="g-btn g-btn--ghost g-btn--sm"
              onClick={() => {
                onCommander?.(fleet.id, null);
                setChoosing(false);
              }}
            >
              {t('지휘관 해임')}
            </button>
          )}
        </div>
      )}

      {merging && mergeWith.length > 0 && (
        <div className="g-merge">
          <div className="g-section">{t('합류할 함대')}</div>
          {mergeWith.map((o) => (
            <button
              key={o.id}
              type="button"
              className="g-row g-row--btn"
              onClick={() => {
                onMerge?.(fleet.id, o.id);
                setMerging(false);
              }}
            >
              <span className="g-row__main">
                <span className="g-row__title">{o.name}</span>
                <span className="g-row__sub">
                  {t('함선 {n}척 · 합류하면 {total}척', { n: o.ships.length, total: fleet.ships.length + o.ships.length })}
                </span>
              </span>
              <span className="g-chev" aria-hidden>
                <Icon name="chev" />
              </span>
            </button>
          ))}
        </div>
      )}

      {own && docked && fleet.refit > 0 && (
        <div className="g-tools">
          <button type="button" className="g-btn g-btn--sm" disabled={gold < fleet.refit} onClick={() => onRefit?.(fleet.id)}>
            {t('정비 {price}', { price: goldText(fleet.refit) })}
          </button>
          <Chip>{t('선체·승조원 완전 회복')}</Chip>
        </div>
      )}

      <h3 className="g-section">{t('함선')} {own && <span className="g-section__hint">{t('분할·해체할 함선을 고르세요')}</span>}</h3>
      <ul className="g-list">
        {fleet.ships.map((s) => (
          <li key={s.id}>
            <label className={`g-row g-ship${picked.has(s.id) ? ' g-ship--on' : ''}`}>
              {own && docked && <input type="checkbox" className="g-check" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />}
              <span className="g-row__main">
                <span className="g-row__title">
                  {s.name ?? shipName(s.kind)}
                  {s.name && <span className="g-row__kind">{shipName(s.kind)}</span>}
                </span>
                <span className="g-meter">
                  <span className="g-meter__label">{t('선체')}</span>
                  <Bar value={s.hull} label={t('선체 {n}%', { n: Math.round(s.hull * 100) })} />
                  <span className="g-meter__num">{Math.round(s.hull * 100)}</span>
                </span>
                <span className="g-meter">
                  <span className="g-meter__label">{t('승조원')}</span>
                  <Bar value={s.crew} label={t('승조원 {n}%', { n: Math.round(s.crew * 100) })} />
                  <span className="g-meter__num">{Math.round(s.crew * 100)}</span>
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {own && docked && picked.size > 0 && (
        <div className="g-tools">
          {sure ? (
            <button
              type="button"
              className="g-btn g-btn--sm g-btn--danger"
              onClick={() => {
                onDisband?.(fleet.id, [...picked]);
                setPicked(new Set());
                setSure(false);
              }}
            >
              {t('해체 확인 ({n}척)', { n: picked.size })}
            </button>
          ) : (
            <button type="button" className="g-btn g-btn--sm" onClick={() => setSure(true)}>
              {t('해체 ({n}척)', { n: picked.size })}
            </button>
          )}
          <Chip>{t('건조비 20% 환급')}</Chip>
        </div>
      )}
    </Sheet>
  );
}
