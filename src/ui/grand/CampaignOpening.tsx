import { useEffect, useRef, useState } from 'react';
import { sound } from '../../audio/Sound';
import { markOpeningSeen, openingLength, type CampaignOpening as Opening, type MapEye } from '../../cinema/campaignOpenings';
import { useT } from '../../i18n';
import { flatMap } from '../siteMap';
import { project } from './projection';
import type { CameraState } from './worldCamera';
import '../film.css';

/**
 * A campaign's opening over its own 3D map (src/cinema/campaignOpenings.ts): the map's camera follows the shots, the
 * panels step aside, and each shot stamps its date and place (--font-title) with one short line (--font-cine); the last
 * holds the whole theatre under the closing title. Click, tap, Esc or Enter skips. Music and sound only. On a flat map
 * (phones) the captions play over the dimmed map.
 */

const FADE = 0.8;
const fade = (age: number, dur: number) => Math.max(0, Math.min(1, age / FADE, (dur - age) / FADE));
const smooth = (k: number) => k * k * (3 - 2 * k);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

type Eye = { u: number; v: number; distance: number; yaw: number; pitch: number };
const eye = (e: MapEye): Eye => ({ ...project(e.lon, e.lat), distance: e.dist, yaw: e.yaw, pitch: e.pitch });
const between = (a: Eye, b: Eye, k: number): CameraState => ({
  u: a.u + (b.u - a.u) * k,
  v: a.v + (b.v - a.v) * k,
  distance: a.distance * (b.distance / a.distance) ** k,
  yaw: a.yaw + wrap(b.yaw - a.yaw) * k,
  pitch: a.pitch + (b.pitch - a.pitch) * k,
});
/** The closing title: the whole theatre from high in the south. */
const WIDE: Eye = { u: 0.5, v: 0.52, distance: 1.05, yaw: 0, pitch: 0.62 };

export function CampaignOpening({ opening, film, onDone }: { opening: Opening; film: { current: ((now: number) => CameraState | null) | null }; onDone: () => void }) {
  const t = useT();
  const length = openingLength(opening);
  const [clock, setClock] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;
  // The film waits (in black) for the 3D world, a few seconds at most; a flat map (phones) never brings one.
  const [ready, setReady] = useState(() => flatMap || !!window.__map);
  useEffect(() => {
    if (ready) return;
    const begun = performance.now();
    const id = window.setInterval(() => {
      if (window.__map || performance.now() - begun > 6000) setReady(true);
    }, 150);
    return () => window.clearInterval(id);
  }, [ready]);
  useEffect(() => {
    document.body.classList.add('g-filming');
    return () => document.body.classList.remove('g-filming');
  }, []);
  useEffect(() => {
    if (!ready) return;
    const start = performance.now();
    const shots = opening.shots.map((s) => ({ ...s, a: eye(s.from), b: eye(s.to) }));
    const last = shots[shots.length - 1]!;
    film.current = (now) => {
      let s = (now - start) / 1000;
      for (const shot of shots) {
        if (s < shot.dur) return between(shot.a, shot.b, smooth(s / shot.dur));
        s -= shot.dur;
      }
      return between(last.b, WIDE, smooth(Math.min(1, s / opening.title.dur)));
    };
    let raf = 0;
    let over = false;
    let cue = -1;
    const finish = () => {
      if (over) return;
      over = true;
      film.current = null;
      markOpeningSeen(opening.theatre);
      done.current();
    };
    const tick = (now: number) => {
      const s = (now - start) / 1000;
      setClock(s);
      // A low sound under each new place; the war's own cue under the title.
      let acc = 0;
      let at = opening.shots.length;
      for (let i = 0; i < opening.shots.length; i++) {
        if (s < acc + opening.shots[i]!.dur) { at = i; break; }
        acc += opening.shots[i]!.dur;
      }
      if (at !== cue) {
        cue = at;
        sound.campaign(at === opening.shots.length ? 'battle' : at === 0 ? 'event' : 'endTurn');
      }
      if (s >= length) finish();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        finish();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => {
      over = true;
      film.current = null;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', key, true);
    };
  }, [opening, film, length, ready]);

  let acc = 0;
  let shotAge = 0;
  let shot: Opening['shots'][number] | null = null;
  for (const s of opening.shots) {
    if (clock < acc + s.dur) { shot = s; shotAge = clock - acc; break; }
    acc += s.dur;
  }
  const titleAge = clock - acc;
  const black = !ready ? 1 : Math.max(0, 1 - clock / 1.4, (clock - (length - 1)) / 1);
  const skip = () => {
    film.current = null;
    markOpeningSeen(opening.theatre);
    document.body.classList.remove('g-filming');
    done.current();
  };
  return (
    <div className="film film--opening g-opening" onClick={skip} role="presentation">
      <div className="film-bar film-bar--top" />
      <div className="film-bar film-bar--bottom" />
      {shot && (shot.when || shot.where) && (
        <div className="opening-stamp" key={`s${acc}`} style={{ opacity: fade(shotAge, shot.dur) }}>
          {shot.when && <div className="opening-stamp-when">{t(shot.when)}</div>}
          {shot.where && <div className="opening-stamp-where">{t(shot.where)}</div>}
        </div>
      )}
      {shot?.line && shotAge > 0.9 && (
        <div className="opening-line" key={`l${acc}`} style={{ opacity: fade(shotAge - 0.9, shot.dur - 0.9) }}>
          <div className="opening-line-text">{t(shot.line)}</div>
          {shot.source && <div className="film-say-source">{t(shot.source)}</div>}
        </div>
      )}
      {!shot && titleAge > 0.6 && (
        <div className="opening-title" style={{ opacity: fade(titleAge - 0.6, opening.title.dur - 0.6) }}>
          <div className="opening-title-eyebrow">MOONWAKE · {t(opening.title.eyebrow)}</div>
          <div className="opening-title-main">{t(opening.title.title)}</div>
          {opening.title.hanja && <div className="opening-title-hanja">{opening.title.hanja}</div>}
          {opening.title.sub && <div className="opening-title-sub">{t(opening.title.sub)}</div>}
          {opening.title.source && <div className="film-say-source">{t(opening.title.source)}</div>}
        </div>
      )}
      <div className="film-black" style={{ opacity: Math.min(1, black) }} />
      <button className="film-skip" onClick={(e) => { e.stopPropagation(); skip(); }}>{t('건너뛰기')} <kbd>Esc</kbd></button>
    </div>
  );
}
