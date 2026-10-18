import { useEffect, useRef, useState } from 'react';
import type { Engine } from '../game/Engine';
import type { Caption } from '../cinema/types';
import { useT } from '../i18n';
import './cinema.css';
import { portraitUrl } from './portrait';

/** Seconds a caption takes to come in and to go. */
const FADE = 0.7;
/** The film's frame, 2.39:1; the bars never take more than this share of the screen (a phone held upright). */
const ASPECT = 2.39;
const MAX_BAR = 0.13;



function opacityOf(age: number, dur: number) {
  return Math.max(0, Math.min(1, age / FADE, (dur - age) / FADE));
}

function CaptionView({ caption, age }: { caption: Caption; age: number }) {
  const t = useT();
  const style = { opacity: opacityOf(age, caption.dur) };
  switch (caption.kind) {
    case 'stamp':
      return (
        // One small neutral line at the bottom, the same in every film (owner 2026-10-18).
        <div className="film-stamp" style={style}>
          {t(caption.when)} · {t(caption.where)}
        </div>
      );
    case 'title':
      // No battle title card over the film (owner 2026-10-18): the date and place line says where we are.
      return null;
    case 'doc':
      return (
        <div className="cine-doc" style={style}>
          <div className="cine-doc-head">
            {caption.tag && <span className="cine-doc-tag">{t(caption.tag)}</span>}
            <b>{t(caption.head)}</b>
            {caption.hanja && <span className="cine-hanja">{caption.hanja}</span>}
          </div>
          <div className="cine-doc-body">{t(caption.body)}</div>
          {caption.source && <div className="cine-source">{t(caption.source)}</div>}
        </div>
      );
    case 'line':
      return (
        <div className="cine-line" style={style}>
          <img className="cine-portrait" src={portraitUrl(caption.portrait)} alt="" />
          <div>
            <div className="cine-line-who">
              <b>{t(caption.who)}</b>
              {caption.role && <span>{t(caption.role)}</span>}
            </div>
            <div className="cine-line-text">“{t(caption.text)}”</div>
            {caption.hanja && <div className="cine-hanja cine-line-hanja">{caption.hanja}</div>}
            {caption.source && <div className="cine-source">{t(caption.source)}</div>}
          </div>
        </div>
      );
    case 'card':
      return (
        <div className="cine-card" style={style}>
          <img className="cine-portrait cine-portrait--large" src={portraitUrl(caption.portrait)} alt="" />
          <div className="cine-card-name">
            <b>{t(caption.who)}</b>
            {caption.hanja && <span className="cine-hanja">{caption.hanja}</span>}
          </div>
          <div className="cine-card-role">{t(caption.role)}</div>
        </div>
      );
    case 'quote':
      return (
        <div className="cine-quote" style={style}>
          <div className="cine-quote-hanja">{caption.hanja}</div>
          <div className="cine-quote-text">{t(caption.text)}</div>
          <div className="cine-source">{t(caption.source)}</div>
        </div>
      );
    case 'say':
      return null;
    case 'label':
      return null;
  }
}

/**
 * A film subtitle for the commander on screen (owner 2026-10-18): one colour, Pretendard medium, a soft shadow, a small
 * name before the line in the same colour. Hanja, titles and records stay out of the frame (src/cinema/SOURCES.md).
 * No portrait card ever (owner 2026-10-18): without his figure the camera holds wide on his flagship and the line stands alone.
 */
function SayView({ caption, age }: { caption: Extract<Caption, { kind: 'say' }>; age: number }) {
  const t = useT();
  return (
    <div className="cine-say" style={{ opacity: opacityOf(age, caption.dur) }}>
      {caption.text ? (
        <div className="cine-say-text">
          <span className="cine-say-name">{t(caption.who)}</span>
          <span className="cine-say-line">{t(caption.text)}</span>
        </div>
      ) : (
        <div className="cine-say-text">{t(caption.who)}</div>
      )}
    </div>
  );
}

/**
 * The cinema's layer over the battle: letterbox, fades, captions, fleet labels and, during a cutscene, the hold and skip
 * controls. A cutscene owns the keyboard: Space holds it, Esc or Enter skips it, and no key reaches the battle's input.
 */
export function CinemaOverlay({ engine }: { engine: Engine }) {
  const t = useT();
  const cinema = engine.cinema;
  const [, setFrame] = useState(0);
  const barTop = useRef<HTMLDivElement>(null);
  const barBottom = useRef<HTMLDivElement>(null);
  const black = useRef<HTMLDivElement>(null);
  const progress = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<Caption, HTMLDivElement>());
  // Captions and controls re-render every frame while anything is showing; the bars, fades and labels are moved here
  // directly, so an idle battle costs one cheap callback a frame.
  useEffect(() => {
    let id = 0;
    let shown = false;
    const tick = () => {
      id = requestAnimationFrame(tick);
      const h = window.innerHeight;
      const w = window.innerWidth;
      const bar = Math.min(h * MAX_BAR, Math.max(0, (h - w / ASPECT) / 2), h * MAX_BAR) * cinema.letterbox;
      if (barTop.current) barTop.current.style.height = `${bar}px`;
      if (barBottom.current) barBottom.current.style.height = `${bar}px`;
      document.documentElement.style.setProperty('--cine-bar', `${bar}px`);
      if (black.current) black.current.style.opacity = String(cinema.black);
      const p = cinema.progress;
      if (progress.current) progress.current.style.transform = `scaleX(${p ? p.t / p.length : 0})`;
      for (const [caption, el] of labels.current) {
        if (caption.kind !== 'label') continue;
        const at = cinema.screenOf(caption.target, w, h);
        el.style.display = at ? '' : 'none';
        // A tag hangs above its fleet: it is held under the top bar rather than drawn on it.
        if (at) el.style.transform = `translate(${at.x}px, ${Math.max(at.y, bar + 84)}px)`;
      }
      const active = cinema.captions().length > 0 || cinema.covering || cinema.letterbox > 0.01;
      if (active || shown) setFrame((n) => n + 1);
      shown = active;
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [cinema]);

  const covering = cinema.covering;
  const filming = cinema.filming;
  useEffect(() => {
    const app = document.querySelector('.app');
    app?.classList.toggle('app--cinema', covering || filming);
    return () => app?.classList.remove('app--cinema');
  }, [covering, filming]);

  useEffect(() => {
    if (!covering) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (e.type !== 'keydown' || e.repeat) return;
      if (e.code === 'Space') cinema.togglePause();
      else if (e.code === 'Escape' || e.code === 'Enter') cinema.skip();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    };
  }, [covering, cinema]);

  const captions = cinema.captions();
  const live = new Set(captions.map((c) => c.caption));
  for (const c of labels.current.keys()) if (!live.has(c)) labels.current.delete(c);
  const online = !!engine.remote;

  return (
    <div
      className={`cine${covering ? ' cine--covering' : ''}`}
      aria-live="polite"
      onClick={(e) => {
        // A click or a tap on the film skips it (the buttons handle their own).
        if (covering && !(e.target as HTMLElement).closest('button')) cinema.skip();
      }}
    >
      <div className="cine-bar cine-bar--top" ref={barTop} />
      <div className="cine-bar cine-bar--bottom" ref={barBottom} />
      <div className="cine-black" ref={black} />
      {captions
        .filter((c) => c.caption.kind === 'label')
        .map(({ caption, age }) =>
          caption.kind === 'label' ? (
            <div
              key={`${caption.at}${caption.text}`}
              className="cine-label"
              style={{ opacity: opacityOf(age, caption.dur) }}
              ref={(el) => {
                if (el) labels.current.set(caption, el);
              }}
            >
              <div className="cine-label-tag">
                <b>{t(caption.text)}</b>
                {caption.sub && <span>{t(caption.sub)}</span>}
              </div>
            </div>
          ) : null,
        )}
      {captions
        .filter((c) => c.caption.kind === 'stamp')
        .map(({ caption, age }) => (
          <CaptionView key={`stamp${caption.at}`} caption={caption} age={age} />
        ))}
      <div className="cine-lower">
        {captions
          .filter((c) => c.caption.kind === 'doc' || c.caption.kind === 'line')
          .map(({ caption, age }) => (
            <CaptionView key={`${caption.kind}${caption.at}`} caption={caption} age={age} />
          ))}
      </div>
      {captions.map(({ caption, age }) =>
        caption.kind === 'say' ? <SayView key={`say${caption.at}`} caption={caption} age={age} /> : null,
      )}
      {captions
        .filter((c) => c.caption.kind === 'title' || c.caption.kind === 'quote' || c.caption.kind === 'card')
        .map(({ caption, age }) => (
          <CaptionView key={`${caption.kind}${caption.at}`} caption={caption} age={age} />
        ))}
      {covering && (
        <div className="cine-controls">
          {!online && (
            <button className="cine-button" onClick={() => cinema.togglePause()}>
              {t(cinema.held ? '계속' : '일시정지')} <kbd>Space</kbd>
            </button>
          )}
          <button className="cine-button" onClick={() => cinema.skip()}>
            {t('건너뛰기')} <kbd>Esc</kbd>
          </button>
        </div>
      )}
      {filming && (
        <div className="cine-controls cine-controls--doc">
          <span className="cine-doc-mark">{t('다큐멘터리 모드')}</span>
          <button className="cine-button" onClick={() => cinema.takeCommand()}>
            {t('직접 지휘')} <kbd>C</kbd>
          </button>
        </div>
      )}
      {covering && (
        <div className="cine-progress">
          <div ref={progress} />
        </div>
      )}
      {covering && cinema.held && <div className="cine-held">{t('일시정지')}</div>}
    </div>
  );
}
