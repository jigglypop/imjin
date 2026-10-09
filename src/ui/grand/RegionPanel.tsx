import { BUILDINGS, Bar, Chip, FactionSeal, SHIP_NAME, Sheet, Stat, costText, goldText, ownerName, signed } from './shared';
import type { BuildingKind, FactionId, FleetView, RegionView, ShipClass } from './types';

export interface RegionPanelProps {
  region: RegionView;
  /** Fleets stationed here that the player can see. */
  fleets: FleetView[];
  me: FactionId;
  onClose?: () => void;
  onBuild?: (regionId: string, kind: BuildingKind) => void;
  onCancelBuild?: (regionId: string, kind: BuildingKind) => void;
  onRecruit?: (regionId: string, kind: ShipClass) => void;
  onCancelRecruit?: (regionId: string, itemId: string) => void;
  onSelectFleet?: (fleetId: string) => void;
}

const stars = (n: number) => '●'.repeat(n) + '○'.repeat(Math.max(0, 3 - n));

export function RegionPanel({ region, fleets, me, onClose, onBuild, onCancelBuild, onRecruit, onCancelRecruit, onSelectFleet }: RegionPanelProps) {
  const own = region.owner === me;
  const seen = region.visible || own;
  const building = new Set(region.works.map((w) => w.kind));
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
      {!seen ? (
        <p className="g-hint">시야 밖입니다. 봉수대를 세우거나 가까운 포구에 함대를 두면 그곳의 사정이 보입니다.</p>
      ) : (
        <>
          <div className="gk-stats gk-stats--2">
            <Stat label="전략 가치">
              <span className="g-stars" aria-label={`${region.value} / 3`}>
                {stars(region.value)}
              </span>
            </Stat>
            <Stat label={`수비대 ${region.garrison} / ${region.garrisonMax}척`}>
              <Bar value={region.garrison / Math.max(1, region.garrisonMax)} tone={own ? 'accent' : 'bad'} label="수비대" />
            </Stat>
            <Stat label="턴당 수입" wide>
              <span className="gk-row gk-row--wrap">
                <Chip>銀 {signed(region.income)}</Chip>
                {region.unrest > 0 && <Chip tone="warn">민심 불안 {region.unrest}턴 · 수입 절반</Chip>}
              </span>
            </Stat>
          </div>

          <h3 className="g-section">
            시설 <span className="g-section__hint">남은 터 {region.freeSlots}</span>
          </h3>
          <ul className="g-list">
            {region.buildings.map((b) => {
              const info = BUILDINGS[b.kind];
              const maxed = b.level >= b.maxLevel;
              const busy = building.has(b.kind);
              const can = own && b.buildable && !maxed && !busy;
              const why = maxed ? '최고 단계' : busy ? '공사 중' : (b.blocked ?? '');
              const showCost = own && !maxed && !busy;
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
                    <span className={`g-row__sub${showCost && b.blocked ? ' g-row__sub--warn' : ''}`}>
                      {showCost ? (b.blocked ? b.blocked : `${costText(b.cost)} · ${b.turns}턴`) : busy ? `${b.level + 1}단계 공사 중 · ${b.upgradeLeft}턴` : info.desc}
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

          {region.works.length > 0 && (
            <>
              <h3 className="g-section">공사 중</h3>
              <ul className="g-list">
                {region.works.map((q) => (
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
                    {own && q.cancelable && (
                      <button type="button" className="g-btn g-btn--ghost g-btn--sm" onClick={() => onCancelBuild?.(region.id, q.kind)}>
                        취소
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {own && (region.recruit.length > 0 || region.yard.length > 0) && (
            <>
              <h3 className="g-section">
                함선 건조 <span className="g-section__hint">{region.yardIdle ? '선소가 서야 일을 시작합니다' : '발주하면 은을 바로 냅니다'}</span>
              </h3>
              {region.yard.length > 0 && (
                <ul className="g-list g-list--tight">
                  {region.yard.map((q) => (
                    <li key={q.id} className="g-row">
                      <span className="g-row__main">
                        <span className="g-row__title">{q.name}</span>
                        <span className="g-row__sub">{region.yardIdle ? '선소 없음 · 대기' : `${q.turnsLeft}턴 뒤 진수`}</span>
                      </span>
                      {q.cancelable && (
                        <button type="button" className="g-btn g-btn--ghost g-btn--sm" onClick={() => onCancelRecruit?.(region.id, q.id)}>
                          취소
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <ul className="g-list">
                {region.recruit.map((r) => (
                  <li key={r.kind} className="g-row">
                    <span className="g-row__main">
                      <span className="g-row__title">{r.name}</span>
                      <span className={`g-row__sub${r.blocked ? ' g-row__sub--warn' : ''}`}>{r.blocked ?? `${goldText(r.cost)} · ${r.turns}턴`}</span>
                    </span>
                    <button type="button" className="g-btn g-btn--sm" disabled={!!r.blocked} title={r.blocked} onClick={() => onRecruit?.(region.id, r.kind)}>
                      발주
                    </button>
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
                        {f.route.length ? ' · 이동 명령' : ''}
                        {f.rest > 0 ? ` · 정비 ${f.rest}턴` : ''}
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
        </>
      )}
    </Sheet>
  );
}

function summarize(f: FleetView) {
  const counts = new Map<string, number>();
  for (const s of f.ships) counts.set(SHIP_NAME[s.kind], (counts.get(SHIP_NAME[s.kind]) ?? 0) + 1);
  return [...counts.entries()].map(([k, n]) => `${k} ${n}`).join(' · ');
}
