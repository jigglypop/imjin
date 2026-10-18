import { useEffect, useRef } from 'react';
import { SHIP_SPECS } from '../../sim/catalog';
import { SHORT_NAME } from '../../sim/conquest';
import type { ShipKind } from '../../sim/types';
import type { ShipAnchors, V3 } from '../../ships/anchors';
import { useLang, useT } from '../../i18n';
import { ENTRIES, GRADE_NOTE, GUN_NOTES, GUN_SOURCES } from './entries';
import { type Part, type Side } from './parts';
import { barsOf, crewOf, drawnWith, gunsOf, knots } from './specs';
import './codex.css';

// The parts of a ship's codex entry that the codex screen and the battle's close look share.

/** Romanized names for the English edition and the Latin line under the Korean title. */
const ROMAN: Record<ShipKind, string> = {
  panokseon: 'Panokseon',
  geobukseon: 'Geobukseon',
  hyeopseon: 'Hyeopseon',
  sahuseon: 'Sahuseon',
  pojakseon: 'Pojakseon',
  atakebune: 'Atakebune',
  daeantaek: 'Ō-atakebune',
  sogantaek: 'Ko-atakebune',
  sekibune: 'Sekibune',
  daegwanseon: 'Ō-sekibune',
  byeongnyangseon: 'Hyōrōsen',
  kobaya: 'Kobaya',
  mingship: 'Fuchuan',
  gwangseon: 'Guangchuan',
  haechangseon: 'Haicangchuan',
  mingsmall: 'Shachuan',
  hoseon: 'Huchuan',
  racegalleon: 'Race-built galleon',
  pinnace: 'Pinnace',
  fireship: 'Fireship',
  spgalleon: 'Galeón',
  galleass: 'Galeaza',
  urca: 'Urca',
  reale: 'La Real',
  galea: 'Galea sottile',
  vgalleass: 'Galeazza',
  sultana: 'Sultana (baştarda)',
  kadirga: 'Kadırga',
  kalyata: 'Kalyata',
  firstrate: 'First rate',
  gb74: 'Seventy-four',
  gbfrigate: 'Frigate',
  fr80: 'Vaisseau de 80',
  fr74: 'Vaisseau de 74',
  trinidad: 'Santísima Trinidad',
  es74: 'Navío de 74',
};

export const romanOf = (kind: ShipKind) => ROMAN[kind];

/** The poster title of an entry: the name large, its native script running down beside it, the navy's seal. */
export function ShipTitle({ kind, sub }: { kind: ShipKind; sub?: string }) {
  const t = useT();
  const lang = useLang();
  const entry = ENTRIES[kind];
  const faction = SHIP_SPECS[kind].faction;
  return (
    <div className={`cx-title cx-title--${faction}`}>
      <div className="cx-title-main">
        <h2>{t(SHORT_NAME[kind])}</h2>
        {lang === 'ko' && <p className="cx-title-roman" aria-hidden="true">{ROMAN[kind]}</p>}
        <p className="cx-title-role">
          {sub ? `${sub} · ` : ''}
          {t(entry.role)}
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div className="cx-stat">
      <dt>{label}</dt>
      <dd>
        <b>{value}</b>
        {unit && <small>{unit}</small>}
      </dd>
    </div>
  );
}

/** The game's figures for a kind: size, crew by station, guns and the handling bars. */
export function SpecSheet({ kind }: { kind: ShipKind }) {
  const t = useT();
  const spec = SHIP_SPECS[kind];
  const crew = crewOf(kind);
  const guns = gunsOf(kind);
  const alias = drawnWith(kind);
  const stations = ['노 젓기', '포격', spec.arms === 'gun' ? '조총' : '활', '백병전'];
  return (
    <div className="cx-sheet">
      <dl className="cx-stats">
        <Stat label={t('길이')} value={spec.length} unit="m" />
        <Stat label={t('너비')} value={spec.beam} unit="m" />
        <Stat label={t('높이')} value={spec.height} unit="m" />
        <Stat label={t('최고 속력')} value={knots(spec.maxSpeed)} unit={t('노트')} />
      </dl>
      <section className="cx-block">
        <h3>
          {t('승조원')} <b>{t('{n}명', { n: spec.crew })}</b>
        </h3>
        <ul className="cx-crew">
          {crew.map((n, i) =>
            n > 0 ? (
              <li key={i}>
                <span>{t(stations[i]!)}</span>
                <b>{n}</b>
              </li>
            ) : null,
          )}
        </ul>
      </section>
      <section className="cx-block">
        <h3>{t('화포')}</h3>
        {guns.length ? (
          <ul className="cx-guns">
            {guns.map((g) => (
              <li key={g.gun}>
                <div className="cx-gun-head">
                  <b>{t(g.label)}</b>
                  <span>
                    {t('{n}문', { n: g.count })}
                    {g.bow ? ` · ${t('뱃머리 포함')}` : ''}
                  </span>
                </div>
                <p>{t(GUN_NOTES[g.gun])}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="cx-muted">{t('화포를 싣지 않았습니다.')}</p>
        )}
        <p className="cx-arms">{t(spec.arms === 'gun' ? '개인 화기: 조총' : '개인 화기: 활')}</p>
      </section>
      <section className="cx-block">
        <h3>{t('함선 비교')}</h3>
        <ul className="cx-bars">
          {barsOf(kind).map((bar) => (
            <li key={bar.label}>
              <span>{t(bar.label)}</span>
              <i>
                <i style={{ width: `${Math.round(Math.max(0.03, bar.value) * 100)}%` }} />
              </i>
            </li>
          ))}
        </ul>
      </section>
      <p className="cx-note">
        {t('게임의 제원입니다. 역사 전투 기준이며, 쟁탈전과 캠페인에서는 균형을 위해 일부 값이 다릅니다.')}
        {alias && ` ${t('게임에서는 {model} 모델을 {scale}% 크기로 그립니다.', { model: t(alias.model), scale: alias.scale })}`}
      </p>
    </div>
  );
}

/** What the record says: the story, the recorded facts, the sources and how firm they are. */
export function History({ kind }: { kind: ShipKind }) {
  const t = useT();
  const entry = ENTRIES[kind];
  const armed = SHIP_SPECS[kind].batteries.length > 0;
  return (
    <div className="cx-history">
      <p className="cx-era">{t(entry.era)}</p>
      <p className="cx-story">{t(entry.story)}</p>
      {entry.facts.length > 0 && (
        <ul className="cx-facts">
          {entry.facts.map((f) => (
            <li key={f}>{t(f)}</li>
          ))}
        </ul>
      )}
      <div className={`cx-grade cx-grade--${entry.grade}`}>
        <b>{t('자료 신뢰도 {grade}', { grade: entry.grade })}</b>
        <span>{t(GRADE_NOTE[entry.grade])}</span>
      </div>
      <section className="cx-sources">
        <h3>{t('사료와 참고 문헌')}</h3>
        {entry.sources.length ? (
          <ol>
            {[...entry.sources, ...(armed ? GUN_SOURCES : [])].map((s) => (
              <li key={s}>{t(s)}</li>
            ))}
          </ol>
        ) : (
          <p className="cx-muted">{t('이 배의 모습을 전하는 사료는 확인되지 않았습니다.')}</p>
        )}
      </section>
    </div>
  );
}

/** The labelled parts as a numbered list; picking one shows it on the ship. */
export function PartList({ parts, selected, onSelect }: { parts: Part[]; selected: string | null; onSelect: (id: string) => void }) {
  const t = useT();
  return (
    <ol className="cx-parts">
      {parts.map((p, i) => (
        <li key={p.id}>
          <button className={p.id === selected ? 'on' : ''} aria-pressed={p.id === selected} onClick={() => onSelect(p.id)}>
            <i>{i + 1}</i>
            <span>
              <b>{t(p.label)}</b>
              <small>{t(p.note)}</small>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** What a marker layer needs from the view it sits on: frame ticks, projection and the side facing the camera. */
export type MarkerView = {
  subscribe(frame: () => void): () => void;
  project(local: V3, out: { x: number; y: number }): boolean;
  facing(): Side;
};

/**
 * Numbered pins over the parts of a ship. Moved straight in the DOM every frame, so React renders them only when the
 * ship or the selection changes. A part on both sides is pinned on the side facing the camera.
 */
export function PartMarkers({ parts, anchors, view, selected, onSelect }: { parts: Part[]; anchors: ShipAnchors; view: MarkerView; selected: string | null; onSelect: (id: string) => void }) {
  const t = useT();
  const pins = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    const at = { x: 0, y: 0 };
    return view.subscribe(() => {
      const side = view.facing();
      for (const p of parts) {
        const el = pins.current.get(p.id);
        if (!el) continue;
        const local = p.at(anchors, side);
        const shown = !!local && view.project(local, at);
        el.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`;
        el.style.visibility = shown ? '' : 'hidden';
      }
    });
  }, [parts, anchors, view]);
  return (
    <div className="cx-pins">
      {parts.map((p, i) => (
        <button
          key={p.id}
          ref={(el) => {
            if (el) pins.current.set(p.id, el);
            else pins.current.delete(p.id);
          }}
          className={`cx-pin ${p.id === selected ? 'cx-pin--on' : ''}`}
          style={{ visibility: 'hidden' }}
          aria-pressed={p.id === selected}
          onClick={() => onSelect(p.id)}
        >
          <i>{i + 1}</i>
          <span>{t(p.label)}</span>
        </button>
      ))}
    </div>
  );
}

/** The note of the picked part, set like a film subtitle under the ship. */
export function PartCaption({ parts, selected, onClose }: { parts: Part[]; selected: string | null; onClose: () => void }) {
  const t = useT();
  const index = parts.findIndex((p) => p.id === selected);
  const part = parts[index];
  if (!part) return null;
  return (
    <div className="cx-caption" role="status">
      <b>
        <i>{index + 1}</i>
        {t(part.label)}
      </b>
      <p>{t(part.note)}</p>
      <button className="cx-caption-close" onClick={onClose} aria-label={t('닫기')}>
        ×
      </button>
    </div>
  );
}
