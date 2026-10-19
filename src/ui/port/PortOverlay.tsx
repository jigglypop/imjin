import { useEffect } from 'react';
import { useT } from '../../i18n';
import { useLocalProfile } from '../../meta/localProfile';
import { buyShipProblem, nationById, shipKindsOf } from '../../meta/fleet';
import { shipCost, shipyardNeeded, upgradeCost, upgradeProblem } from '../../meta/port';
import { BUILDING_IDS, BUILDINGS, buildingLevel } from '../../meta/portDefs';
import { MAX_SHIPS_PER_KIND } from '../../meta/rules';
import { SHORT_NAME } from '../../sim/conquest';
import type { ShipKind } from '../../sim/types';
import type { Engine } from '../../game/Engine';
import { ChevronLeft } from '../icons';
import { portViewOf } from './PortScreen';
import '../generals/generals.css';
import './port.css';

function Pips({ level, max }: { level: number; max: number }) {
  return (
    <span className="port-pips" aria-hidden="true">
      {Array.from({ length: max }, (_, i) => <i key={i} className={i < level ? 'on' : ''} />)}
    </span>
  );
}

/** The 본진 panels over the staged harbour: the buildings (the tech tree) and the shop. Rules: src/meta/port.ts. */
export function PortOverlay({ engine, onBack }: { engine: Engine; onBack: () => void }) {
  const t = useT();
  const profile = useLocalProfile((s) => s.profile);
  const refused = useLocalProfile((s) => s.refused);
  const build = useLocalProfile((s) => s.build);
  const buyShip = useLocalProfile((s) => s.buyShip);
  useEffect(() => {
    if (profile.nation) engine.updatePort(portViewOf(profile));
  }, [engine, profile]);
  const nation = nationById(profile.nation);
  if (!nation) return null;
  return (
    <section className="port-overlay">
      <header className="screen-top">
        <button className="back-btn" onClick={onBack}>
          <ChevronLeft /> {t('뒤로')}
        </button>
        <h1 className="screen-title">{t('본진')}</h1>
        <div className="screen-actions">
          <span className="gen-purse" aria-label={t('엽전')}>
            <i aria-hidden="true" /> {profile.coins.toLocaleString()} <small>{t('엽전')}</small>
          </span>
        </div>
      </header>
      <div className="port-body">
        <aside className="port-panel port-panel--works" aria-label={t('건물')}>
          <header className="port-panel__head">
            <div>
              <h2>{t('{name} 본진', { name: t(nation.name) })}</h2>
              <p>{t('역사 전투와 캠페인에서 이기면 엽전을 받습니다. 별이 많을수록, 많이 격침할수록 더 받습니다.')}</p>
            </div>
          </header>
          <ul className="port-works">
            {BUILDING_IDS.map((id) => {
              const b = BUILDINGS[id];
              const level = buildingLevel(profile.port, id);
              const cost = upgradeCost(profile, id);
              const why = upgradeProblem(profile, id);
              return (
                <li key={id} className="port-work" data-building={id}>
                  <div className="port-work__name">
                    <b>{t(b.name)}</b> <small>{b.hanja}</small>
                    <Pips level={level} max={b.max} />
                  </div>
                  <p className="port-work__line">{t(b.line)}</p>
                  {cost === null ? (
                    <span className="port-work__max">{t('최고 레벨')}</span>
                  ) : (
                    <button className="port-btn" disabled={!!why} title={why ? t(why) : undefined} onClick={() => build(id)}>
                      {level === 0 ? t('짓기') : t('{n}레벨로 올리기', { n: level + 1 })} <small>{t('{n} 엽전', { n: cost.toLocaleString() })}</small>
                    </button>
                  )}
                  {why && cost !== null && why !== '엽전이 모자랍니다' && <small className="port-work__why">{t(why)}</small>}
                </li>
              );
            })}
          </ul>
        </aside>
        <aside className="port-panel port-panel--shop" aria-label={t('함선 상점')}>
          <header className="port-panel__head">
            <div>
              <h2>{t('함선 상점')}</h2>
              <p>{t('지은 배는 병기창 부두에 정박합니다.')}</p>
            </div>
          </header>
          <ul className="port-shop">
            {shipKindsOf(nation.id).map((k: ShipKind) => {
              const owned = profile.ships[k] ?? 0;
              const why = buyShipProblem(profile, k, 1);
              const need = shipyardNeeded(nation.id, k);
              const locked = need > buildingLevel(profile.port, 'shipyard');
              return (
                <li key={k} className={`port-ship${locked ? ' port-ship--locked' : ''}`} data-kind={k}>
                  <span className="port-ship__name">
                    <b>{t(SHORT_NAME[k])}</b>
                    <small>{t('보유 {n}/{max}', { n: owned, max: MAX_SHIPS_PER_KIND })}</small>
                  </span>
                  {locked ? (
                    <span className="port-ship__lock">{t('조선소 {n}레벨', { n: need })}</span>
                  ) : (
                    <button className="port-btn" disabled={!!why} title={why ? t(why) : undefined} onClick={() => buyShip(k, 1)}>
                      {t('건조')} <small>{t('{n} 엽전', { n: shipCost(profile, k).toLocaleString() })}</small>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {refused && <p className="port-refused" role="alert">{t(refused)}</p>}
        </aside>
      </div>
    </section>
  );
}
