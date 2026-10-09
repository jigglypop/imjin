import { BUILDINGS, Bar, Chip, FactionSeal, RESOURCES, SHIP_NAME, Sheet, Stat, costText, ownerName, signed } from './shared';
import type { BuildingKind, FactionId, FleetView, RegionView } from './types';

export interface RegionPanelProps {
  region: RegionView;
  /** Fleets stationed here. */
  fleets: FleetView[];
  me: FactionId;
  onClose?: () => void;
  onBuild?: (regionId: string, kind: BuildingKind) => void;
  onCancelBuild?: (regionId: string, queueId: string) => void;
  onSelectFleet?: (fleetId: string) => void;
}

const stars = (n: number) => '●'.repeat(n) + '○'.repeat(Math.max(0, 5 - n));

export function RegionPanel({ region, fleets, me, onClose, onBuild, onCancelBuild, onSelectFleet }: RegionPanelProps) {
  const own = region.owner === me;
  const queued = new Set(region.queue.map((q) => q.kind));
  const income = RESOURCES.filter((r) => region.income[r.kind]);
  return (
    <Sheet
      tone={region.owner}
      onClose={onClose}
      eyebrow={
        <span className="gk-row">
          {region.owner ? <FactionSeal faction={region.owner} size="sm" /> : <span className="gk-seal gk-seal--sm gk-seal--none">中</span>}
          {ownerName(region.owner)}
          {region.offMap ? ' 본토' : ' 영토'}
        </span>
      }
      title={
        <>
          {region.name} <span className="g-hanja">{region.hanja}</span>
        </>
      }
    >
      {region.note && <p className="g-note">{region.note}</p>}
      <div className="gk-stats gk-stats--2">
        {!region.offMap && (
          <>
            <Stat label="전략 가치">
              <span className="g-stars" aria-label={`${region.value} / 5`}>
                {stars(region.value)}
              </span>
            </Stat>
            <Stat label={`수비병 ${region.garrison} / ${region.garrisonMax}`}>
              <Bar value={region.garrison / Math.max(1, region.garrisonMax)} tone={own ? 'accent' : 'bad'} label="수비병" />
            </Stat>
          </>
        )}
        <Stat label={region.offMap ? '보급 항로 수입' : '턴당 수입'} wide>
          {income.length ? (
            <span className="gk-row gk-row--wrap">
              {income.map((r) => (
                <Chip key={r.kind}>
                  {r.glyph} {signed(region.income[r.kind]!)}
                </Chip>
              ))}
            </span>
          ) : (
            '없음'
          )}
        </Stat>
      </div>

      {!region.offMap && (
        <>
          <h3 className="g-section">시설</h3>
          <ul className="g-list">
            {region.buildings.map((b) => {
              const info = BUILDINGS[b.kind];
              const maxed = b.level >= b.maxLevel;
              const busy = queued.has(b.kind);
              const can = own && b.buildable && !maxed && !busy;
              const why = maxed ? '최대 단계' : busy ? '건설 중' : (b.blocked ?? '');
              return (
                <li key={b.kind} className="g-row">
                  <span className="g-glyph" aria-hidden>
                    {info.glyph}
                  </span>
                  <span className="g-row__main">
                    <span className="g-row__title">
                      {info.name}
                      <span className="g-pips" aria-label={`${b.level} / ${b.maxLevel}단계`}>
                        {Array.from({ length: b.maxLevel }, (_, i) => (
                          <i key={i} className={i < b.level ? 'on' : ''} />
                        ))}
                      </span>
                    </span>
                    <span className={`g-row__sub${own && !can && !maxed && !busy && b.blocked ? ' g-row__sub--warn' : ''}`}>
                      {own && !maxed && !busy ? (b.blocked && !b.buildable ? b.blocked : `${costText(b.cost)} · ${b.turns}턴`) : info.desc}
                    </span>
                  </span>
                  {own && (
                    <button type="button" className="g-btn g-btn--sm" disabled={!can} title={why} onClick={() => onBuild?.(region.id, b.kind)}>
                      {maxed ? '완료' : busy ? '진행' : b.level === 0 ? '건설' : '증축'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {region.queue.length > 0 && (
        <>
          <h3 className="g-section">건설 대기열</h3>
          <ul className="g-list">
            {region.queue.map((q) => (
              <li key={q.id} className="g-row">
                <span className="g-glyph g-glyph--accent" aria-hidden>
                  {BUILDINGS[q.kind].glyph}
                </span>
                <span className="g-row__main">
                  <span className="g-row__title">
                    {BUILDINGS[q.kind].name} {q.toLevel}단계
                  </span>
                  <span className="g-row__sub">{q.turnsLeft}턴 남음</span>
                </span>
                {own && (
                  <button type="button" className="g-btn g-btn--ghost g-btn--sm" onClick={() => onCancelBuild?.(region.id, q.id)}>
                    취소
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="g-section">주둔 함대</h3>
      {fleets.length === 0 ? (
        <p className="g-hint">이 해역에는 함대가 없습니다.</p>
      ) : (
        <ul className="g-list">
          {fleets.map((f) => (
            <li key={f.id}>
              <button type="button" className="g-row g-row--btn" onClick={() => onSelectFleet?.(f.id)}>
                <FactionSeal faction={f.faction} size="sm" />
                <span className="g-row__main">
                  <span className="g-row__title">{f.name}</span>
                  <span className="g-row__sub">
                    {summarize(f)}
                    {f.moveTo ? ' · 이동 명령' : ''}
                  </span>
                </span>
                <span className="g-chev" aria-hidden>
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function summarize(f: FleetView) {
  const counts = new Map<string, number>();
  for (const s of f.ships) counts.set(SHIP_NAME[s.kind], (counts.get(SHIP_NAME[s.kind]) ?? 0) + 1);
  return [...counts.entries()].map(([k, n]) => `${k} ${n}`).join(' · ');
}
