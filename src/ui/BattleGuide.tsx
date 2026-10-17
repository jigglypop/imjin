import { useEffect, useState } from 'react';
import type { Engine } from '../game/Engine';
import { useT } from '../i18n';
import { useUi } from '../state/store';
import { SCENARIOS, type ScenarioId } from '../sim/scenarios';
import { GUIDES, guidedFaction } from './guideText';
import { Icon } from './battleIcons';
import { params } from './launch';
import { useTour } from './Tutorial';
import './tutorial.css';

/** How long each of the three hints stays up, so the whole sequence covers the first half minute of play. */
const STEP_MS = 10000;

const seenKey = (id: string) => `imjin.guide.v1.${id}`;

function readSeen(id: string): boolean {
  try {
    return localStorage.getItem(seenKey(id)) === '1';
  } catch {
    return false;
  }
}

function writeSeen(id: string) {
  try {
    localStorage.setItem(seenKey(id), '1');
  } catch {
    // Private windows may refuse storage: the hints then show again next time.
  }
}

/**
 * The battle's goal and three hints for the first half minute, once per battle per device. It waits for the coach-mark
 * tour (the first battle ever) to be read, goes away on its own after the third hint or when closed, and is not shown
 * online or for a side other than Joseon's, where the hints would be wrong.
 */
export function BattleGuide({ engine }: { engine: Engine }) {
  const t = useT();
  const id = useUi((s) => s.snapshot?.scenario.id);
  const mode = useUi((s) => s.snapshot?.mode);
  const faction = useUi((s) => s.snapshot?.faction);
  const tour = useTour((s) => s.active);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const eligible =
    !!id && id in GUIDES && mode === 'scenario' && guidedFaction(faction) && !engine.remote && !engine.campaign && params.get('guide') !== '0' && params.get('hud') !== '0';
  const showing = eligible && !done && !tour && !readSeen(id);
  useEffect(() => {
    if (!showing) return;
    const timer = window.setTimeout(() => {
      if (step >= 2) {
        writeSeen(id);
        setDone(true);
      } else setStep(step + 1);
    }, STEP_MS);
    return () => window.clearTimeout(timer);
  }, [showing, step, id]);
  if (!showing) return null;
  const guide = GUIDES[id as ScenarioId];
  const close = () => {
    writeSeen(id);
    setDone(true);
  };
  return (
    <div className="guide glass interactive" role="status" key={id}>
      <div className="guide-head">
        <b>{t('목표')}</b>
        <span className="guide-dots" aria-hidden="true">
          {guide.hints.map((_, i) => (
            <i key={i} className={i === step ? 'on' : ''} />
          ))}
        </span>
        <button className="hint-x" onClick={close} aria-label={t('안내 닫기')}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <p className="guide-goal">{t(guide.goal)}</p>
      <p className="guide-hint" key={step}>
        {t(guide.hints[step])}
      </p>
      <span className="guide-name">{t(SCENARIOS[id as ScenarioId].title)}</span>
    </div>
  );
}
