import { useT } from '../../i18n';
import { Bar, Chip, FACTION_INFO, FactionMark, Icon, Sheet, Stat, navyName, shipName, signed } from './shared';
import { ShipYard, WorkSlots } from './PortWorks';
import { campArt } from './campArt';
import { turnsText } from './text';
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
  onMobilize?: (regionId: string) => void;
  /** Joins the given own fleets of this port into one. */
  onMergeAll?: (fleetIds: string[]) => void;
}
/** The bird's-eye view of the port's camp at the level it has reached; nothing until the first camp stands. */
function CampView({ region }: { region: RegionView }) {
  const t = useT();
  const camp = region.buildings.find((b) => b.kind === 'camp');
  if (!camp || camp.level < 1 || !region.owner) return null;
  const level = Math.min(camp.level, camp.maxLevel);
  const rising = camp.upgradeLeft > 0;
  const art = campArt(region.id, region.owner);
  return (
    <figure className={`g-camp${rising ? ' g-camp--rising' : ''}`} data-guide="camp">
      <img
        key={`${art}-${level}`}
        className="g-camp__img"
        src={`/ui/camps/${art}-L${level}.webp`}
        alt={t('{place} 군영 {n}단계', { place: region.name, n: level })}
        width={1024}
        height={683}
        decoding="async"
      />
      <figcaption className="g-camp__cap">
        {rising ? t('{level}단계 공사 중 · {turns} 남음', { level: level + 1, turns: turnsText(camp.upgradeLeft) }) : t('군영 {n}단계', { n: level })}
      </figcaption>
    </figure>
  );
}

/**
 * March rules: a blockade lying off the port, whoever keeps it up. The port earns and builds nothing while it lasts, and
 * its garrison gives up when the turns run out.
 */
function SiegeView({ region, me }: { region: RegionView; me: FactionId }) {
  const t = useT();
  const s = region.siege!;
  const left = turnsText(Math.max(1, s.hold - s.turns));
  const ours = s.by === me;
  return (
    <div className="g-siege" style={{ ['--s' as string]: FACTION_INFO[s.by].color }}>
      <div className="g-siege__head">
        <FactionMark faction={s.by} />
        {ours ? t('우리 함대가 봉쇄 중') : t('{navy}의 봉쇄', { navy: navyName(s.by) })}
        <b>{t('{n}/{m}턴', { n: s.turns, m: s.hold })}</b>
      </div>
      <Bar value={s.turns / Math.max(1, s.hold)} tone={ours ? 'good' : 'bad'} label={t('봉쇄 {n}/{m}', { n: s.turns, m: s.hold })} />
      <p>
        {region.owner === me
          ? t('수입과 함선 건조가 멈췄고 수비대가 굶주립니다. {turns} 안에 구원 함대를 보내지 않으면 항복합니다.', { turns: left })
          : t('수입과 함선 건조가 멈췄고 수비대가 굶주립니다. {turns} 뒤에 항복합니다.', { turns: left })}
      </p>
    </div>
  );
}

export function RegionPanel({ region, fleets, me, onClose, onBuild, onCancelBuild, onRecruit, onCancelRecruit, onSelectFleet, onMobilize, onMergeAll }: RegionPanelProps) {
  const t = useT();
  const own = region.owner === me;
  const seen = region.visible || own;
  const mine = fleets.filter((f) => f.faction === me && !f.transit);
  const ready = mine.filter((f) => f.rest === 0);
  return (
    <Sheet
      tone={region.owner}
      onClose={onClose}
      eyebrow={
        <span className="gk-row">
          <FactionMark faction={region.owner} />
          {navyName(region.owner)} · {region.offMap ? t('본토 기지') : t('포구')}
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
        <p className="g-hint">{t('시야 밖입니다. 봉수대를 세우거나 가까운 포구에 함대를 두면 상황을 볼 수 있습니다.')}</p>
      ) : (
        <>
          <CampView region={region} />
          {region.siege && <SiegeView region={region} me={me} />}

          <div className="gk-stats gk-stats--2">
            <Stat label={t('수비 병력')}>{t('{n}명 승조원', { n: region.garrisonCrew.toLocaleString() })}</Stat>
            <Stat label={t('중요도')}>
              <span className="g-stars" role="img" aria-label={`${region.value} / 3`}>
                {[1, 2, 3].map((n) => (
                  <i key={n} className={n <= region.value ? 'on' : ''} />
                ))}
              </span>
            </Stat>
            <Stat label={t('수비대 {n} / {max}척', { n: region.garrison, max: region.garrisonMax })}>
              <Bar value={region.garrison / Math.max(1, region.garrisonMax)} tone={own ? 'accent' : 'bad'} label={t('수비대')} />
            </Stat>
            <Stat label={t('턴당 수입')} wide>
              <span className="gk-row gk-row--wrap">
                <Chip>
                  <Icon name="coin" size="sm" />
                  {t('은 {n}', { n: signed(region.income) })}
                </Chip>
                {region.siege && <Chip tone="warn">{t('봉쇄 · 수입 없음')}</Chip>}
                {region.unrest > 0 && <Chip tone="warn">{t('민심 불안 {turns} · 수입 절반', { turns: turnsText(region.unrest) })}</Chip>}
              </span>
            </Stat>
          </div>

          {own && onMobilize && <button className="g-btn g-btn--sm g-port-mobilize" disabled={!region.garrison} onClick={() => onMobilize(region.id)}>{t('수비대 전체 출동')}</button>}

          {region.owner && region.buildings.length + region.freeSlots > 0 && <WorkSlots region={region} own={own} onBuild={onBuild} onCancelBuild={onCancelBuild} />}

          {own && (region.recruit.length > 0 || region.yard.length > 0) && <ShipYard region={region} onRecruit={onRecruit} onCancelRecruit={onCancelRecruit} />}

          <h3 className="g-section">{t('주둔 함대')}</h3>
          {onMergeAll && mine.length > 1 && (
            <div className="g-tools">
              <button type="button" className="g-btn g-btn--sm" disabled={ready.length < 2} onClick={() => onMergeAll(ready.map((f) => f.id))}>{t('모두 합류 ({n})', { n: ready.length })}</button>
              <span className="g-hint">{ready.length < 2 ? t('정비 중인 함대는 합칠 수 없습니다. 정비가 끝난 함대가 둘 이상 필요합니다.') : ready.length < mine.length ? t('정비 중인 함대는 제외하고 합칩니다.') : t('이 포구의 함대를 하나로 합칩니다.')}</span>
            </div>
          )}
          {fleets.length === 0 ? (
            <p className="g-hint">{t('주둔 중인 함대가 없습니다.')}</p>
          ) : (
            <ul className="g-list">
              {fleets.map((f) => (
                <li key={f.id}>
                  <button type="button" className="g-row g-row--btn" onClick={() => onSelectFleet?.(f.id)}>
                    <FactionMark faction={f.faction} size="md" />
                    <span className="g-row__main">
                      <span className="g-row__title">{f.name}</span>
                      <span className="g-row__sub">
                        {summarize(f)}
                        {f.route.length ? ' · ' + t('이동 중') : ''}
                        {f.rest > 0 ? ' · ' + t('정비 {turns}', { turns: turnsText(f.rest) }) : ''}
                      </span>
                    </span>
                    <span className="g-chev" aria-hidden>
                      <Icon name="chev" />
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
  for (const s of f.ships) counts.set(shipName(s.kind), (counts.get(shipName(s.kind)) ?? 0) + 1);
  return [...counts.entries()].map(([k, n]) => `${k} ${n}`).join(' · ');
}
