import { useEffect, useRef, useState } from 'react';
import type { Engine } from '../game/Engine';
import { SKY_PRESETS, type SkyPresetName } from '../render/sky';
import type { SeaStateName } from '../ocean/waves';
import { useUi, type SquadronInfo } from '../state/store';

const SEA_LABELS: Record<SeaStateName, string> = { calm: '잔잔', moderate: '보통', rough: '거침' };
const ACTIVITY: Record<string, string> = {
  idle: '대기',
  moving: '이동',
  engaging: '포격',
  boarding: '백병전',
  sinking: '침몰',
  struck: '전투 불능',
  charging: '돌격',
  evading: '거리 유지',
  anchored: '정박',
  fleeing: '도주',
  aground: '좌초',
};

function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function Stat({ label, value, tone, text }: { label: string; value: number; tone: 'hull' | 'crew' | 'fire'; text: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <div className={`stat-bar stat-bar--${tone}`}>
        <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
      </div>
      <b>{text}</b>
    </div>
  );
}

function Card({ sq, onClick, onDouble }: { sq: SquadronInfo; onClick: (e: React.MouseEvent) => void; onDouble: () => void }) {
  return (
    <button className={`card ${sq.selected ? 'card--selected' : ''} ${sq.alive === 0 ? 'card--dead' : ''}`} onClick={onClick} onDoubleClick={onDouble} title={`${sq.name} · ${sq.commander}`}>
      <img src={`/ui/cards/${sq.card}.jpg`} alt="" />
      <div className="card-name">{sq.name}</div>
      <div className="card-flags">
        {sq.burning > 0 && <div className="card-flag card-flag--fire">火</div>}
        {sq.boarding > 0 && <div className="card-flag card-flag--melee">戰</div>}
      </div>
      <div className="card-foot">
        <div className="card-count">
          {sq.alive}
          <small>/{sq.total}</small>
        </div>
        <div className="card-bar">
          <i style={{ width: `${sq.hull * 100}%` }} />
        </div>
      </div>
    </button>
  );
}

export function Hud({ engine, onBack }: { engine: Engine; onBack: () => void }) {
  const snap = useUi((s) => s.snapshot);
  const toasts = useUi((s) => s.toasts);
  const box = useUi((s) => s.box);
  const [showSettings, setShowSettings] = useState(false);
  const minimapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    engine.minimap.mount(minimapRef.current);
  }, [engine, snap?.scenario.id]);

  if (!snap) return null;
  const own = snap.squadrons.filter((s) => s.team === 'joseon');
  const selectedSquad = own.find((s) => s.selected);
  const p = snap.primary;
  return (
    <div className="hud">
      <div className="hud-title">
        <div className="hud-title-main brush">{snap.scenario.title}</div>
        <div className="hud-title-sub">
          {snap.scenario.date} · {snap.scenario.place}
        </div>
        <div className="hud-menu">
          <button className="mini-btn" onClick={onBack}>
            전투 선택
          </button>
          <button className="mini-btn" onClick={() => setShowSettings((v) => !v)}>
            설정
          </button>
        </div>
      </div>

      <div className="balance">
        <img className="balance-emblem" src="/ui/emblems/joseon.png" alt="조선" />
        <div className="balance-center">
          <div className="balance-row">
            <span>
              조선 수군 <b>{snap.joseon}</b>
              <small>/{snap.joseonTotal}</small>
            </span>
            <span className="balance-time">
              {formatTime(snap.time)}
              <span className="fps">{snap.fps}fps</span>
            </span>
            <span>
              <b>{snap.japan}</b>
              <small>/{snap.japanTotal}</small> 일본 수군
            </span>
          </div>
          <div className="balance-bar">
            <div className="balance-fill" style={{ width: `${snap.balance * 100}%` }} />
          </div>
        </div>
        <img className="balance-emblem" src="/ui/emblems/japan.png" alt="일본" />
      </div>

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast paper toast--${t.tone}`}>
            <span className="seal">{t.tone === 'good' ? '勝' : t.tone === 'bad' ? '敗' : '令'}</span>
            {t.text}
          </div>
        ))}
      </div>

      {showSettings && (
        <aside className="settings">
          <div className="settings-body paper">
            <div>
              <div className="settings-label">하늘</div>
              <div className="chips">
                {(Object.keys(SKY_PRESETS) as SkyPresetName[]).map((k) => (
                  <button key={k} className={`chip ${snap.sky === k ? 'chip--on' : ''}`} onClick={() => void engine.setSky(k)}>
                    {SKY_PRESETS[k].label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="settings-label">파도</div>
              <div className="chips">
                {(Object.keys(SEA_LABELS) as SeaStateName[]).map((k) => (
                  <button key={k} className={`chip ${snap.sea === k ? 'chip--on' : ''}`} onClick={() => engine.setSea(k)}>
                    {SEA_LABELS[k]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="settings-label">소리 · 카메라</div>
              <div className="chips">
                <button
                  className={`chip ${!snap.muted ? 'chip--on' : ''}`}
                  onClick={() => {
                    engine.sound.setMuted(!engine.sound.muted);
                    engine.publish(true);
                  }}
                >
                  소리
                </button>
                <button
                  className={`chip ${snap.cinematic ? 'chip--on' : ''}`}
                  onClick={() => {
                    engine.rts.cinematic = !engine.rts.cinematic;
                    engine.publish(true);
                  }}
                >
                  관전 카메라
                </button>
                <button className="chip" onClick={() => engine.restart()}>
                  다시 시작
                </button>
              </div>
            </div>
          </div>
        </aside>
      )}

      {box && <div className="select-box" style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />}

      <div className="bottom">
        <div className="minimap" ref={minimapRef} />
        <div className="detail paper interactive">
          {p ? (
            <>
              <img className="detail-portrait" src={`/ui/portraits/${selectedSquad?.portrait ?? 'portrait_admiral'}.jpg`} alt="" />
              <div className="detail-body">
                <div className="detail-name">{p.name}</div>
                <div className="detail-sub">
                  {p.kind} · {ACTIVITY[p.activity] ?? p.activity}
                  {snap.selectedCount > 1 ? ` · ${snap.selectedCount}척 선택` : ''}
                </div>
                <Stat label="선체" value={p.hull} tone="hull" text={`${Math.round(p.hull * 100)}%`} />
                <Stat label="병력" value={p.crew / p.maxCrew} tone="crew" text={`${p.crew}`} />
                {p.fire > 0.02 && <Stat label="화재" value={p.fire} tone="fire" text={`${Math.round(p.fire * 100)}%`} />}
                {p.guns.length > 0 && (
                  <div className="guns">
                    {p.guns
                      .filter((g) => g.side !== 1)
                      .slice(0, 8)
                      .map((g, i) => (
                        <div key={i} className={`gun ${g.stage >= 4 ? 'gun--ready' : ''}`}>
                          <span>{g.label.replace('총통', '')}</span>
                          <div className="gun-track">
                            <i style={{ width: `${((g.stage + g.progress) / 6) * 100}%` }} />
                            <span>{g.stageName}</span>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="detail-empty">
              <div className="detail-name">함대 지휘</div>
              <div>아래 부대 패를 누르거나 배를 클릭해 선택하세요.</div>
              <div>우클릭 이동 · 적함 우클릭 공격 · 휠 확대 · WASD 이동</div>
            </div>
          )}
        </div>
        <div className="cards">
          {own.map((sq) => (
            <Card key={sq.id} sq={sq} onClick={(e) => engine.selectSquadron(sq.id, e.shiftKey)} onDouble={() => engine.focusSquadron(sq.id)} />
          ))}
        </div>
        <div className="orders paper interactive">
          <div className="orders-grid">
            <button className="order" onClick={() => engine.input.formation('crane')}>
              <span className="order-icon">鶴</span>
              학익진 <kbd>1</kbd>
            </button>
            <button className="order" onClick={() => engine.input.formation('line')}>
              <span className="order-icon">一</span>
              일자진 <kbd>2</kbd>
            </button>
            <button className="order" onClick={() => engine.input.auto()}>
              <span className="order-icon">戰</span>
              자유교전 <kbd>G</kbd>
            </button>
            <button className="order" onClick={() => engine.input.hold()} disabled={!snap.selectedCount}>
              <span className="order-icon">止</span>
              정지 <kbd>H</kbd>
            </button>
          </div>
          <div className="speed">
            <button
              className={snap.paused ? 'on' : ''}
              onClick={() => {
                engine.paused = !engine.paused;
                engine.publish(true);
              }}
            >
              {snap.paused ? '▶' : '❚❚'}
            </button>
            {[1, 2, 4].map((s) => (
              <button
                key={s}
                className={!snap.paused && snap.speed === s ? 'on' : ''}
                onClick={() => {
                  engine.speed = s;
                  engine.paused = false;
                  engine.publish(true);
                }}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
      </div>

      {snap.winner && (
        <div className={`result paper result--${snap.winner}`}>
          <div className="result-title">{snap.winner === 'joseon' ? '大捷' : '敗戰'}</div>
          <div className="result-sub">{snap.winner === 'joseon' ? `${snap.scenario.title} — 승리` : '조선 수군 패전'}</div>
          <div className="result-stats">
            적선 격파 {snap.japanTotal - snap.japan - snap.escaped}척 · 도주 {snap.escaped}척 · 아군 손실 {snap.joseonTotal - snap.joseon}척
          </div>
          <button className="ink-btn" onClick={onBack}>
            전투 선택
          </button>
        </div>
      )}
    </div>
  );
}
