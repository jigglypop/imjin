import { useEffect, useRef, useState } from 'react';
import { INTRO_TIMING, introLength, markIntroduced, NAVY_LABEL, type IntroView } from '../cinema/commanderIntros';
import { useT } from '../i18n';
import { portraitUrl } from './portrait';

/**
 * A commander's short opening (src/cinema/commanderIntros.ts): letterbox, a fade from black, his name and title in
 * --font-title, then his lines as film subtitles in --font-cine. Over his live figure (the generals stage drives the
 * camera, GeneralModel.tsx) or, for a commander without one, over his portrait as a painted insert in sea fog. Click,
 * tap, Esc or Enter skips. No voices: the subtitles are the only words.
 */

const FADE = 0.7;
const fade = (age: number, dur: number) => Math.max(0, Math.min(1, age / FADE, (dur - age) / FADE));

/** The film's clock in seconds, from mount; `onDone` once it passes `length` or the viewer skips. */
export function useFilmClock(length: number, onDone: () => void) {
  const [t, setT] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    let over = false;
    const finish = () => {
      if (over) return;
      over = true;
      done.current();
    };
    const tick = (now: number) => {
      const s = (now - start) / 1000;
      setT(s);
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
    document.body.classList.add('film-on');
    return () => {
      document.body.classList.remove('film-on');
      over = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', key, true);
    };
  }, [length]);
  return t;
}

/** Letterbox, black, the name card and the lines at film time `t`. */
export function FilmCaptions({ intro, t, onSkip }: { intro: IntroView; t: number; onSkip: () => void }) {
  const tr = useT();
  const length = introLength(intro);
  const { nameAt, nameDur, firstLine, lineDur } = INTRO_TIMING;
  const black = Math.max(0, 1 - t / 1.1, (t - (length - 0.8)) / 0.8);
  const nameAge = t - nameAt;
  return (
    <div className={`film film--${intro.faction}`} onClick={onSkip} role="presentation">
      <div className="film-bar film-bar--top" />
      <div className="film-bar film-bar--bottom" />
      <div className="film-black" style={{ opacity: Math.min(1, black) }} />
      {nameAge > 0 && nameAge < nameDur && (
        <div className="film-name" style={{ opacity: fade(nameAge, nameDur) }}>
          <div className="film-name-eyebrow">{tr(NAVY_LABEL[intro.faction])} · {intro.year}</div>
          <div className="film-name-main">{tr(intro.name)}</div>
          <div className="film-name-title">{tr(intro.title)}</div>
        </div>
      )}
      {intro.lines.map((line, i) => {
        const age = t - (firstLine + i * lineDur);
        if (age < 0 || age > lineDur) return null;
        return (
          <div key={i} className="film-say" style={{ opacity: fade(age, lineDur) }}>
            <div className="film-say-who">{tr(intro.name)}</div>
            <div className="film-say-text">{tr(line.text)}</div>
            {line.hanja && <div className="film-say-hanja">{line.hanja}</div>}
            <div className="film-say-source">
              {tr(line.source)}
              {line.note && ` · ${tr('기록에 따른 대사')}`}
            </div>
          </div>
        );
      })}
      <button className="film-skip" onClick={onSkip}>{tr('건너뛰기')}</button>
    </div>
  );
}

/** The opening of a commander with no 3D figure yet: his portrait in sea fog, a slow push-in. Fills the window. */
export function PortraitFilm({ intro, onDone }: { intro: IntroView; onDone: () => void }) {
  const t = useFilmClock(introLength(intro), onDone);
  useEffect(() => markIntroduced(intro.id), [intro.id]);
  const k = Math.min(1, t / introLength(intro));
  return (
    <div className="film-screen film-screen--portrait">
      <div className="film-fog" />
      <img className="film-portrait" src={portraitUrl(intro.portrait, true)} alt="" style={{ transform: `translate(-50%, -50%) scale(${1.04 + k * 0.1}) translateX(${(0.5 - k) * 1.5}%)` }} />
      <div className="film-fog film-fog--front" />
      <FilmCaptions intro={intro} t={t} onSkip={onDone} />
    </div>
  );
}
