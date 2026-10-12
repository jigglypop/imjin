import type { Battle } from '../sim/battle';
import type { Command } from '../sim/commands';
import type { Conquest } from '../sim/conquest';
import { planWorks, worksReserve, type WorkOrder } from '../sim/strategy';

/** Sim seconds between two plans. */
export const AUTO_BUILD_PERIOD = 2;

/**
 * The player's "자동 건설" switch: every few sim seconds it asks the works planner for the next camp, shipyard, battery,
 * dock, granary, beacon or upgrade and sends it as an ordinary command. Nothing here changes the conquest, so a local
 * battle and a multiplayer one behave alike and the server judges every order. It orders at most one work per plan: the
 * client's copy of an online conquest only catches up with a snapshot, and a second plan from stale funds would repeat
 * the first. That is 0.5 messages a second against the server's budget of 60.
 */
export class AutoBuild {
  private next = 0;

  reset() {
    this.next = 0;
  }

  /** The work ordered this call, if any. The treasury keeps the price of the navy's main ship, so recruiting is never starved. */
  tick(b: Battle, c: Conquest, slot: number, issue: (cmd: Command) => unknown): WorkOrder | null {
    if (b.time < this.next) return null;
    this.next = b.time + AUTO_BUILD_PERIOD;
    if (b.ended) return null;
    const order = planWorks(b, c, slot, { keep: worksReserve(c, slot), eager: true });
    if (order) issue(order);
    return order;
  }
}
