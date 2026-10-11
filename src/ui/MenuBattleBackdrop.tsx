import { useEffect, useRef, useState } from 'react';
import type { MenuBattleScene } from './menuBattleScene';

/** No engine, session or campaign is created by the decorative battle. */
export function MenuBattleBackdrop() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const connection = (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean } }).connection;
    let cancelled = false;
    let scene: MenuBattleScene | undefined;
    let timer = 0;
    let firstFrame = 0;
    let pending = false;
    let generation = 0;
    const enabled = () => !motion.matches && !connection?.saveData;
    const start = () => {
      if (cancelled || pending || scene || !enabled() || document.hidden) return;
      pending = true;
      const attempt = ++generation;
      // The title and routes paint before the 3D chunk is requested.
      firstFrame = requestAnimationFrame(() => {
        timer = window.setTimeout(async () => {
          let next: MenuBattleScene | undefined;
          try {
            if (cancelled || attempt !== generation || !enabled() || document.hidden) return;
            const { MenuBattleScene } = await import('./menuBattleScene');
            if (cancelled || attempt !== generation || !enabled() || document.hidden || !canvas.current) return;
            next = new MenuBattleScene(canvas.current, () => { if (!cancelled && attempt === generation) setReady(true); });
            scene = next;
            await next.init();
          } catch {
            // Graphics are decoration; every mode stays available on the real-rendered poster.
            next?.dispose();
            if (attempt === generation) {
              scene = undefined;
              if (!cancelled) setReady(false);
            }
          } finally {
            if (attempt === generation) pending = false;
          }
        }, 180);
      });
    };
    const change = () => {
      if (!enabled()) {
        generation++;
        pending = false;
        clearTimeout(timer);
        cancelAnimationFrame(firstFrame);
        scene?.dispose();
        scene = undefined;
        setReady(false);
      } else start();
    };
    motion.addEventListener('change', change);
    connection?.addEventListener('change', change);
    document.addEventListener('visibilitychange', start);
    start();
    return () => {
      cancelled = true;
      generation++;
      clearTimeout(timer);
      cancelAnimationFrame(firstFrame);
      motion.removeEventListener('change', change);
      connection?.removeEventListener('change', change);
      document.removeEventListener('visibilitychange', start);
      scene?.dispose();
    };
  }, []);
  return <div className={`menu-battle ${ready ? 'menu-battle--ready' : ''}`} aria-hidden="true" data-state={ready ? 'ready' : 'poster'}>
    <canvas ref={canvas} tabIndex={-1} />
  </div>;
}
