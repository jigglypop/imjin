import { useState } from 'react';
import { Bar, FactionSeal, SHIP_NAME, Sheet, ownerName } from './shared';
import type { FactionId, FleetView } from './types';

export interface FleetPanelProps {
  fleet: FleetView;
  regionName: string;
  me: FactionId;
  /** True while the player is choosing a destination on the map. */
  moving?: boolean;
  /** Other friendly fleets in the same region this one can join. */
  mergeWith?: FleetView[];
  onClose?: () => void;
  onMove?: (fleetId: string) => void;
  onCancelMove?: (fleetId: string) => void;
  onMerge?: (fleetId: string, otherId: string) => void;
  onSplit?: (fleetId: string, shipIds: string[]) => void;
}

export function FleetPanel({ fleet, regionName, me, moving, mergeWith = [], onClose, onMove, onCancelMove, onMerge, onSplit }: FleetPanelProps) {
  const own = fleet.faction === me;
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // A fleet keeps at least one ship, so splitting everything off is not offered.
  const canSplit = own && picked.size > 0 && picked.size < fleet.ships.length;
  const avgHull = fleet.ships.reduce((a, s) => a + s.hull, 0) / Math.max(1, fleet.ships.length);

  return (
    <Sheet
      tone={fleet.faction}
      onClose={onClose}
      eyebrow={
        <span className="gk-row">
          <FactionSeal faction={fleet.faction} size="sm" />
          {ownerName(fleet.faction)} 함대 · {regionName}
        </span>
      }
      title={fleet.name}
      footer={
        own ? (
          <div className="g-actions">
            {moving ? (
              <button type="button" className="g-btn g-btn--ghost" onClick={() => onCancelMove?.(fleet.id)}>
                이동 취소
              </button>
            ) : (
              <button type="button" className="g-btn g-btn--primary" onClick={() => onMove?.(fleet.id)}>
                이동
              </button>
            )}
            <button type="button" className="g-btn" disabled={mergeWith.length === 0} aria-expanded={merging} onClick={() => setMerging((m) => !m)}>
              합류
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
              {picked.size > 0 ? `분할 (${picked.size})` : '분할'}
            </button>
          </div>
        ) : undefined
      }
    >
      {moving && <p className="g-banner">지도에서 강조된 해역을 눌러 목적지를 정하세요.</p>}
      {fleet.moveTo && !moving && <p className="g-hint">이동 명령이 내려져 있습니다. 턴을 마치면 출항합니다.</p>}
      <div className="gk-stats gk-stats--2">
        <div className="gk-stat">
          <span className="gk-stat__label">함선</span>
          <span className="gk-stat__value">{fleet.ships.length}척</span>
        </div>
        <div className="gk-stat">
          <span className="gk-stat__label">평균 선체</span>
          <span className="gk-stat__value">{Math.round(avgHull * 100)}%</span>
        </div>
      </div>

      {merging && mergeWith.length > 0 && (
        <div className="g-merge">
          <div className="g-section">합류할 함대</div>
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
                  함선 {o.ships.length}척과 합쳐 {fleet.ships.length + o.ships.length}척
                </span>
              </span>
              <span className="g-chev" aria-hidden>
                ›
              </span>
            </button>
          ))}
        </div>
      )}

      <h3 className="g-section">함선 {own && <span className="g-section__hint">분할할 배를 고르세요</span>}</h3>
      <ul className="g-list">
        {fleet.ships.map((s) => (
          <li key={s.id}>
            <label className={`g-row g-ship${picked.has(s.id) ? ' g-ship--on' : ''}`}>
              {own && <input type="checkbox" className="g-check" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />}
              <span className="g-row__main">
                <span className="g-row__title">
                  {s.name ?? SHIP_NAME[s.kind]}
                  {s.name && <span className="g-row__kind">{SHIP_NAME[s.kind]}</span>}
                </span>
                <span className="g-meter">
                  <span className="g-meter__label">선체</span>
                  <Bar value={s.hull} label={`선체 ${Math.round(s.hull * 100)}%`} />
                  <span className="g-meter__num">{Math.round(s.hull * 100)}</span>
                </span>
                <span className="g-meter">
                  <span className="g-meter__label">승조원</span>
                  <Bar value={s.crew} label={`승조원 ${Math.round(s.crew * 100)}%`} />
                  <span className="g-meter__num">{Math.round(s.crew * 100)}</span>
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
