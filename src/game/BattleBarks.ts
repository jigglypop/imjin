import type { Battle } from '../sim/battle';
import type { BattleEvent, Ship, Team } from '../sim/types';
import type { ScenarioId } from '../sim/scenarios';
import { BATTLE_LINES, type BattleLine, type LineTrigger } from '../cinema/battleLines';

/** Seconds a line stays on screen, and the least between two lines. */
export const BARK_SHOW = 6.5;
const BARK_GAP = 9;
/** Seconds of play before the opening order. */
const START_AFTER = 12;
/** Moments that may come again in a long fight, and the least seconds of play between two of them. */
const REPEATS: ReadonlySet<LineTrigger> = new Set(['foeFlagHit', 'ownFlagHit', 'foeRout']);
const REPEAT_AFTER = 75;
/** Enemy crews that must break before the commander calls the rout. */
const ROUT_CALL = 2;

/**
 * The commanders' lines during a historical battle, as subtitles at the bottom of the screen (Total War style): an
 * order early on, a word at first contact, a cheer when the enemy flagship is struck, and so on to the end. Only the
 * player's side speaks. Each moment speaks once; lines that come too close together wait their turn.
 * Presentation only: it reads the battle and its events, never changes them.
 */
export class BattleBarks {
  /** The line on screen and the real time (seconds) it appeared. */
  current: { line: BattleLine; at: number } | null = null;
  private lines: BattleLine[] = [];
  private readonly said = new Set<LineTrigger>();
  /** Play time a repeatable moment last spoke, and the line it used. */
  private readonly saidAt = new Map<LineTrigger, { t: number; line: BattleLine }>();
  private readonly routed = new Set<number>();
  private readonly queue: BattleLine[] = [];
  private playTime = 0;
  private lastShown = -100;
  private foeFlag: { id: number; hull: number } | null = null;
  private team: Team = 'joseon';

  reset(scenario: ScenarioId | null, team: Team) {
    this.lines = (scenario && BATTLE_LINES[scenario]) || [];
    this.said.clear();
    this.saidAt.clear();
    this.routed.clear();
    this.queue.length = 0;
    this.current = null;
    this.playTime = 0;
    this.lastShown = -100;
    this.foeFlag = null;
    this.team = team;
  }

  private say(on: LineTrigger) {
    const last = this.saidAt.get(on);
    if (REPEATS.has(on) ? !!last && this.playTime - last.t < REPEAT_AFTER : this.said.has(on)) return;
    if (this.queue.some((l) => l.on === on)) return;
    this.said.add(on);
    let options = this.lines.filter((l) => l.on === on && l.team === this.team);
    if (!options.length) return;
    // A moment that comes again says something else when it can.
    if (last && options.length > 1) options = options.filter((l) => l !== last.line);
    const line = options[Math.floor(Math.random() * options.length)]!;
    if (REPEATS.has(on)) this.saidAt.set(on, { t: this.playTime, line });
    this.queue.push(line);
  }

  /** Battle events of this frame: leaders lost, flagships struck, enemy crews breaking. */
  onEvents(events: BattleEvent[], b: Battle) {
    if (!this.lines.length) return;
    for (const e of events) {
      if (e.type === 'leader') {
        const s = b.get(e.ship);
        if (s) this.say(s.team === this.team ? 'ownLeaderLost' : 'foeLeaderLost');
      } else if (e.type === 'leaderHit' && e.flagship) {
        const s = b.get(e.ship);
        if (s) this.say(s.team === this.team ? 'ownFlagHit' : 'foeFlagHit');
      } else if (e.type === 'morale' && e.state === 'routing') {
        const s = b.get(e.ship);
        if (s && s.team !== this.team) {
          this.routed.add(s.id);
          if (this.routed.size >= ROUT_CALL) {
            this.say('foeRout');
            this.routed.clear();
          }
        }
      } else if (e.type === 'gun' && !this.said.has('contact')) {
        // The opening order comes before the first shot even when the guns open early.
        this.say('start');
        this.say('contact');
      }
    }
  }

  /** Per frame with the real time step; `playing` is false while paused or while a cutscene covers the battle. */
  update(b: Battle, dt: number, playing: boolean, now: number) {
    if (!this.lines.length) return;
    if (this.current && now - this.current.at > BARK_SHOW) this.current = null;
    if (!playing) return;
    this.playTime += dt;
    if (this.playTime > START_AFTER) this.say('start');
    const enemy: Team = this.team === 'joseon' ? 'japan' : 'joseon';
    // The enemy flagship: the first one afloat, watched for fresh damage.
    if (!this.foeFlag || !b.isActive(b.get(this.foeFlag.id))) {
      const f = b.ships.find((s: Ship) => s.team === enemy && s.flagship && b.isActive(s));
      this.foeFlag = f ? { id: f.id, hull: f.hull } : null;
    } else {
      const f = b.get(this.foeFlag.id)!;
      if (f.hull < this.foeFlag.hull - f.spec.hull * 0.03) this.say('foeFlagHit');
      this.foeFlag.hull = Math.min(this.foeFlag.hull, f.hull);
    }
    const ownLeft = b.teamCount(this.team) / Math.max(1, b.initial[this.team]);
    const foeLeft = b.teamCount(enemy) / Math.max(1, b.initial[enemy]);
    if (ownLeft < 0.6) this.say('ownLosses');
    if (foeLeft < 0.4) this.say('climax');
    if (b.ended) this.say(b.winner === this.team ? 'won' : 'lost');
    if (!this.current && this.queue.length && now - this.lastShown > BARK_GAP) {
      this.current = { line: this.queue.shift()!, at: now };
      this.lastShown = now;
    }
  }
}
