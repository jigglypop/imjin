import { useT } from '../../i18n';
import { Sheet } from './shared';
import type { FleetView, RegionView } from './types';
import './batch.css';

/** A fleet that can be picked: docked in a port and done refitting. */
export const forceReady = (f: FleetView) => !!f.at && !f.transit && f.rest === 0;

export function FleetOrdersPanel({ fleets, ports, selectedFleets, selectedPorts, mergeOnArrival, noRoute, onFleet, onPort, onAll, onMergeOnArrival, onMergeAll, onClose }: {
  fleets: FleetView[]; ports: RegionView[]; selectedFleets: ReadonlySet<string>; selectedPorts: ReadonlySet<string>; mergeOnArrival: boolean;
  /** Something is picked but no region can be reached by all of it. */
  noRoute: boolean;
  onFleet: (id: string) => void; onPort: (id: string) => void; onAll: (all: boolean) => void; onMergeOnArrival: (on: boolean) => void; onMergeAll: () => void; onClose: () => void;
}) {
  const t = useT();
  const pickedFleets = fleets.filter((f) => selectedFleets.has(f.id));
  const pickedPorts = ports.filter((p) => selectedPorts.has(p.id));
  const count = pickedFleets.length + pickedPorts.length;
  const ships = pickedFleets.reduce((n, f) => n + f.ships.length, 0) + pickedPorts.reduce((n, p) => n + p.garrison, 0);
  const crew = pickedFleets.reduce((n, f) => n + f.crewCount, 0) + pickedPorts.reduce((n, p) => n + p.garrisonCrew, 0);
  // Only fleets that lie in the same port can join, so count how many of the picked ones share a port with another.
  const perPort = new Map<string, number>();
  for (const f of pickedFleets) perPort.set(f.at!, (perPort.get(f.at!) ?? 0) + 1);
  const joinable = pickedFleets.filter((f) => (perPort.get(f.at!) ?? 0) > 1).length;
  return <Sheet title={t('함대·수비대 일괄 이동')} onClose={onClose} className="g-batch" footer={<div className="g-actions">
    <button className="g-btn g-btn--primary" disabled={!joinable} title={joinable ? undefined : t('같은 포구의 함대를 둘 이상 고르세요')} onClick={onMergeAll}>{t('모두 합류')}{joinable ? ` (${joinable})` : ''}</button>
    <button className="g-btn" disabled={!count} onClick={() => onAll(false)}>{t('선택 해제')}</button>
  </div>}>
    <div className="g-batch-summary">{t('함대 {n}개 · 함선 {ships}척 · 병력 {crew}명', { n: count, ships, crew: crew.toLocaleString() })}</div>
    <div className="g-tools"><button className="g-btn g-btn--sm" onClick={() => onAll(true)}>{t('출동 가능 병력 전체 선택')}</button></div>
    <p className="g-hint">{!count ? t('출동할 병력을 고르세요. 지도의 함대 표지로도 고릅니다.') : noRoute ? t('함께 갈 목적지가 없습니다. 선택을 줄이세요.') : t('강조된 포구를 누르면 바로 출동합니다.')}</p>
    <label className="g-row g-batch-row"><input className="g-check" type="checkbox" checked={mergeOnArrival} onChange={(e) => onMergeOnArrival(e.target.checked)} /><span className="g-row__main"><span className="g-row__title">{t('도착하면 합류')}</span><span className="g-row__sub">{t('도착한 병력을 한 함대로 합칩니다')}</span></span></label>
    <h3 className="g-section">{t('함대')}</h3>
    <ul className="g-list">{fleets.map((f) => <li key={f.id}><label className="g-row g-batch-row">
      <input className="g-check" type="checkbox" checked={selectedFleets.has(f.id)} disabled={!forceReady(f)} onChange={() => onFleet(f.id)} />
      <span className="g-row__main"><span className="g-row__title">{f.name}</span><span className="g-row__sub">{t('함선 {ships}척 · 병력 {crew}명', { ships: f.ships.length, crew: f.crewCount.toLocaleString() })}{f.rest > 0 ? ' · ' + t('정비 중') : f.transit ? ' · ' + t('항해 중') : ''}</span></span>
    </label></li>)}</ul>
    <h3 className="g-section">{t('포구 수비대')}</h3>
    <p className="g-hint">{t('출동한 수비대는 함대가 되고 포구는 비워집니다.')}</p>
    <ul className="g-list">{ports.map((p) => <li key={p.id}><label className="g-row g-batch-row">
      <input className="g-check" type="checkbox" checked={selectedPorts.has(p.id)} onChange={() => onPort(p.id)} />
      <span className="g-row__main"><span className="g-row__title">{p.name}</span><span className="g-row__sub">{t('함선 {ships}척 · 병력 {crew}명', { ships: p.garrison, crew: p.garrisonCrew.toLocaleString() })}</span></span>
    </label></li>)}</ul>
  </Sheet>;
}
