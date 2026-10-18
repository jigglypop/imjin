import { useEffect, useState } from 'react';
import { useAssetProgress } from './assetProgress';
import './assetBar.css';

/**
 * A 2 px line along the top edge while 3D assets stream in behind a usable screen (the menu scene, /generals, a
 * chapter switch). It shows only once a download has run for a moment, so a cached load never flickers it, and it
 * stands aside while a battle's loading page shows its own bar.
 */
export function AssetBar() {
  const { active, progress } = useAssetProgress();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      const t = window.setTimeout(() => setShown(false), 250);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setShown(true), 300);
    return () => window.clearTimeout(t);
  }, [active]);
  // The battle's loading page (Loading.tsx) has a bar of its own.
  const on = shown && !document.querySelector('.loading[role=status]');
  return (
    <div className={`asset-bar${on ? ' asset-bar--on' : ''}`} role="progressbar" aria-hidden={!on} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
      <div className="asset-bar-fill" style={{ transform: `scaleX(${Math.max(0.04, progress)})` }} />
    </div>
  );
}
