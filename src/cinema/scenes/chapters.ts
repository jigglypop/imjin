import { ARMADA_ORDER, ARMADA_QUOTES, ARMADA_SCENARIOS } from '../../sim/armada';
import { LEPANTO_ORDER, LEPANTO_QUOTES, LEPANTO_SCENARIOS, type Quote } from '../../sim/lepanto';
import type { ScenarioInfo } from '../../sim/scenarios';
import { at, commander, first, flagship, fleet } from '../subjects';
import type { CastLight, Scene } from '../types';
import { closeUp, command, home } from './shots';

/**
 * The openings of the later chapters' battles, on the 1592 grammar (establishing + title, the side's commander, the
 * reverse, the order, the fleet, the hand-off). Their commanders have no 3D figures yet, so each close-up frames his
 * flagship and his line comes with his portrait as a painted insert (cast.ts). Every line and its record is in the
 * battle's quotes (src/sim/armada.ts, src/sim/lepanto.ts) and src/cinema/SOURCES.md.
 */

const surname = (name: string) => name.split(' ').slice(-1)[0];

function chapterIntro(info: ScenarioInfo, quotes: { joseon: Quote; japan: Quote }, eyebrow: string, light: CastLight): Scene {
  const own = fleet('joseon');
  const foe = fleet('japan');
  const a = first(commander(info.joseon.name), commander(surname(info.joseon.name)), flagship('joseon'));
  const b = first(commander(info.japan.name), commander(surname(info.japan.name)), flagship('japan'));
  const say = (side: 'joseon' | 'japan', q: Quote, at: number, dur: number) => {
    const c = info[side];
    // The record says whether the line is quoted or a summary of what he did; the source carries both.
    return { kind: 'say' as const, at, dur, cast: side, side, who: c.name, role: c.title, text: q.text, source: q.source };
  };
  return {
    id: `${info.id}-intro`,
    fadeIn: 2.2,
    castLight: light,
    cast: {
      joseon: { file: info.joseon.figure, weapon: '', ship: a, facing: foe, portrait: info.joseon.portrait },
      japan: { file: info.japan.figure, weapon: '', ship: b, facing: own, portrait: info.japan.portrait },
    },
    shots: [
      { dur: 8.5, cam: { type: 'orbit', at: at(foe, { toward: own }), yaw: [0.18, 0.3], pitch: [0.035, 0.05], dist: [650, 540], lift: 12 }, fov: 30 },
      closeUp('joseon', a, 7.5, -1),
      closeUp('japan', b, 7, 1),
      command('joseon', a, 4.5),
      { dur: 7, cam: { type: 'orbit', at: at(own, { toward: foe }), yaw: [Math.PI + 0.3, Math.PI + 0.18], pitch: [0.22, 0.28], dist: [900, 1050], lift: 10 }, fov: 34 },
      home(at(own)),
    ],
    captions: [
      { kind: 'stamp', at: 0.8, dur: 6.4, when: info.date, where: info.place },
      { kind: 'title', at: 2.2, dur: 5.8, eyebrow, title: info.title, hanja: info.hanja },
      say('joseon', quotes.joseon, 9.2, 5.8),
      say('japan', quotes.japan, 16.6, 5.6),
      { kind: 'label', at: 28.4, dur: 5.6, target: at(own), text: info.forces.joseon, sub: info.joseon.name, side: 'joseon' },
      { kind: 'label', at: 28.8, dur: 5.2, target: at(b), text: info.forces.japan, sub: info.japan.name, side: 'japan' },
    ],
    cues: [
      { kind: 'hush', at: 0, depth: 0.3 },
      { kind: 'drums', at: 24, count: 1 },
      { kind: 'drums', at: 28.2, count: 4 },
      { kind: 'hush', at: 34, depth: 0 },
    ],
  };
}

const lightOf = (info: ScenarioInfo): CastLight => (info.night ? 'night' : info.sky === 'overcast' ? 'overcast' : info.sky === 'dawn' || info.sky === 'sunset' ? 'dusk' : 'day');

export const CHAPTER_INTROS: Record<string, Scene> = Object.fromEntries([
  ...ARMADA_ORDER.map((id) => [id, chapterIntro(ARMADA_SCENARIOS[id], ARMADA_QUOTES[id], '1588 · 아르마다 전쟁', lightOf(ARMADA_SCENARIOS[id]))] as const),
  ...LEPANTO_ORDER.map((id) => [id, chapterIntro(LEPANTO_SCENARIOS[id], LEPANTO_QUOTES[id], `${LEPANTO_SCENARIOS[id].date.slice(0, 4)} · 지중해 갤리선 전쟁`, lightOf(LEPANTO_SCENARIOS[id]))] as const),
]);
