import { REGIONS, REGION_ORDER } from './regions';
import { findRoute, fleetById, mintId, passable } from './world';
import type { Fleet, Grand, GrandFaction, RegionId, Result } from './types';
import { fail, ok } from './types';
import { marchRoute, marching } from './march';

type Plan = { fleet?: Fleet; port?: RegionId; path: RegionId[]; turns: number };
type Planned = { ok: true; plans: Plan[] } | Extract<Result, { ok: false }>;

/** Validate the entire dispatch before changing any route or moving a garrison aboard. */
function planDispatch(g: Grand, fleetIds: readonly string[], portIds: readonly RegionId[], dest: RegionId, faction: GrandFaction): Planned {
  if (g.phase !== 'orders') return fail('지금은 명령을 내릴 수 없습니다');
  if (!REGIONS[dest] || !g.regions[dest]) return fail('해당 포구가 없습니다');
  const fleets = [...new Set(fleetIds)], ports = [...new Set(portIds)];
  if (!fleets.length && !ports.length) return fail('이동할 함대나 수비대를 선택하세요');
  const plans: Plan[] = [];
  for (const id of fleets) {
    const fleet = fleetById(g, id);
    if (!fleet) return fail('해당 함대가 없습니다');
    if (fleet.faction !== faction) return fail('우리 진영의 것이 아닙니다');
    if (fleet.rest > 0) return fail('전투 후 정비 중입니다');
    if (marching(g)) {
      const route = marchRoute(g, fleet, dest);
      if (!route) return fail('그곳으로 가는 안전한 항로가 없습니다');
      if (fleet.stance === 'march' && !passable(g, faction, dest)) return fail('강행군 중에는 공격할 수 없습니다');
      plans.push({ fleet, path: route.path, turns: route.turns });
      continue;
    }
    if (!fleet.at || fleet.transit) return fail('항해 중인 함대는 항로를 바꿀 수 없습니다');
    const route = findRoute(g, faction, fleet.at, dest);
    if (!route) return fail('그곳으로 가는 안전한 항로가 없습니다');
    plans.push({ fleet, ...route });
  }
  for (const port of ports) {
    const region = g.regions[port];
    if (!region) return fail('해당 포구가 없습니다');
    if (region.owner !== faction) return fail('우리 진영의 것이 아닙니다');
    if (!region.garrison.length) return fail('출동할 수비대가 없습니다');
    // The guard boats sail at their own pace once aboard: plan their way as the fleet they will become.
    const route = marching(g)
      ? marchRoute(g, { id: '', faction, name: '', commanderId: null, ships: region.garrison, at: port, transit: null, route: [], from: port, rest: 0 }, dest)
      : findRoute(g, faction, port, dest);
    if (!route) return fail('그곳으로 가는 안전한 항로가 없습니다');
    plans.push({ port, ...route });
  }
  return { ok: true, plans };
}

/** Every selected fleet and port must be able to reach the destination. */
export function dispatchTargets(g: Grand, fleets: readonly string[], ports: readonly RegionId[], faction: GrandFaction): RegionId[] {
  return REGION_ORDER.filter((id) => planDispatch(g, fleets, ports, id, faction).ok);
}

export function orderDispatch(g: Grand, fleets: readonly string[], ports: readonly RegionId[], dest: RegionId, faction: GrandFaction): Result {
  const planned = planDispatch(g, fleets, ports, dest, faction);
  if (!planned.ok) return planned;
  for (const p of planned.plans) {
    if (p.fleet) {
      p.fleet.route = [...p.path];
      p.fleet.besieging = false;
      continue;
    }
    const port = p.port!;
    const region = g.regions[port];
    const fleet: Fleet = { id: mintId(g, 'f'), faction, name: `${REGIONS[port].name} 출동 함대`, commanderId: null, ships: region.garrison, at: port, transit: null, route: [...p.path], from: port, rest: 0 }; // i18n-ignore: place-derived name translated by tName
    region.garrison = [];
    g.fleets.push(fleet);
  }
  return ok('{n}개 함대의 이동 명령을 내렸습니다', { n: planned.plans.length });
}

/** Port defence is transferred, preserving the exact hull ids, crews, supplies and casualties. */
export function orderMobilize(g: Grand, port: RegionId, faction: GrandFaction): Result {
  const result = orderDispatch(g, [], [port], port, faction);
  return result.ok ? ok(g.fleets[g.fleets.length - 1]!.id) : result;
}
