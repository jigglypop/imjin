import { useT } from '../../i18n';
import { Sheet } from './shared';
import type { FleetView, RegionView } from './types';
import './batch.css';

export function FleetOrdersPanel({ fleets, ports, selectedFleets, selectedPorts, moving, onFleet, onPort, onAll, onMove, onCancel, onClose }: {
  fleets: FleetView[]; ports: RegionView[]; selectedFleets: ReadonlySet<string>; selectedPorts: ReadonlySet<string>; moving: boolean;
  onFleet: (id: string) => void; onPort: (id: string) => void; onAll: (all: boolean) => void; onMove: () => void; onCancel: () => void; onClose: () => void;
}) {
  const t = useT();
  const pickedFleets = fleets.filter((f) => selectedFleets.has(f.id));
  const pickedPorts = ports.filter((p) => selectedPorts.has(p.id));
  const count = pickedFleets.length + pickedPorts.length;
  const ships = pickedFleets.reduce((n, f) => n + f.ships.length, 0) + pickedPorts.reduce((n, p) => n + p.garrison, 0);
  const crew = pickedFleets.reduce((n, f) => n + f.crewCount, 0) + pickedPorts.reduce((n, p) => n + p.garrisonCrew, 0);
  return <Sheet title={t('함대·수비대 일괄 이동')} onClose={onClose} className="g-batch" footer={<div className="g-actions">
    <button className="g-btn" disabled={!count} onClick={moving ? onCancel : onMove}>{t(moving ? '이동 취소' : '목적지 선택')}</button>
  </div>}>
    <div className="g-batch-summary">{t('함대 {n}개 · 함선 {ships}척 · 병력 {crew}명', { n: count, ships, crew: crew.toLocaleString() })}</div>
    <div className="g-tools"><button className="g-btn g-btn--sm" disabled={moving} onClick={() => onAll(true)}>{t('출동 가능 병력 전체 선택')}</button><button className="g-btn g-btn--sm" disabled={moving} onClick={() => onAll(false)}>{t('선택 해제')}</button></div>
    {moving && <p className="g-hint">{t('지도에서 강조된 목적지를 선택하세요. 선택한 모든 병력이 이동할 수 있는 항로만 표시됩니다.')}</p>}
    <h3 className="g-section">{t('함대')}</h3>
    <ul className="g-list">{fleets.map((f) => <li key={f.id}><label className="g-row g-batch-row">
      <input className="g-check" type="checkbox" checked={selectedFleets.has(f.id)} disabled={!f.at || !!f.transit || f.rest > 0 || moving} onChange={() => onFleet(f.id)} />
      <span className="g-row__main"><span className="g-row__title">{f.name}</span><span className="g-row__sub">{t('함선 {ships}척 · 병력 {crew}명', { ships: f.ships.length, crew: f.crewCount.toLocaleString() })}{f.rest > 0 ? ' · ' + t('정비 중') : f.transit ? ' · ' + t('항해 중') : ''}</span></span>
    </label></li>)}</ul>
    <h3 className="g-section">{t('포구 수비대')}</h3>
    <p className="g-hint">{t('출동한 수비대는 함대가 됩니다. 그 포구의 수비대는 비워지고 함선과 병력의 상태는 그대로 이어집니다.')}</p>
    <ul className="g-list">{ports.map((p) => <li key={p.id}><label className="g-row g-batch-row">
      <input className="g-check" type="checkbox" checked={selectedPorts.has(p.id)} disabled={moving} onChange={() => onPort(p.id)} />
      <span className="g-row__main"><span className="g-row__title">{p.name}</span><span className="g-row__sub">{t('함선 {ships}척 · 병력 {crew}명', { ships: p.garrison, crew: p.garrisonCrew.toLocaleString() })}</span></span>
    </label></li>)}</ul>
  </Sheet>;
}
