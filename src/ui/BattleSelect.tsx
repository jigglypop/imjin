import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { PerspectiveCamera, Vector2, WebGPURenderer } from 'three/webgpu';
import { SCENARIO_ORDER, SCENARIOS, type ScenarioId } from '../sim/scenarios';
import { SelectScene } from '../select/SelectScene';
import { sound } from '../audio/Sound';

async function createRenderer(props: { canvas: HTMLCanvasElement | OffscreenCanvas }) {
  const renderer = new WebGPURenderer({ canvas: props.canvas as HTMLCanvasElement, antialias: true, powerPreference: 'high-performance' });
  await renderer.init();
  return renderer;
}

function SelectView({ id, sceneRef, markers }: { id: ScenarioId; sceneRef: React.MutableRefObject<SelectScene | null>; markers: React.MutableRefObject<Map<ScenarioId, HTMLDivElement>> }) {
  const gl = useThree((s) => s.gl) as unknown as WebGPURenderer;
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const tmp = useRef(new Vector2());
  const idRef = useRef(id);
  idRef.current = id;

  useEffect(() => {
    const scene = new SelectScene(gl, camera);
    sceneRef.current = scene;
    void scene.init(id).then(() => scene.setVisible('left', SCENARIOS[id].joseon.figure === 'fig_yi'));
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera]);

  useEffect(() => {
    sceneRef.current?.focus(id);
    sceneRef.current?.setVisible('left', SCENARIOS[id].joseon.figure === 'fig_yi');
  }, [id, sceneRef]);

  useFrame((_, dt) => {
    const scene = sceneRef.current;
    if (!scene?.ready) return;
    const rect = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    };
    const cards = [rect('.portrait-card--left'), rect('.portrait-card--right')];
    scene.setCards(cards[0]!, cards[1]!, size.width, size.height);
    scene.update(Math.min(dt, 0.05));
    scene.render();
    for (const sid of SCENARIO_ORDER) {
      const el = markers.current.get(sid);
      if (!el) continue;
      const visible = scene.project(sid, size.width, size.height, tmp.current);
      const { x, y } = tmp.current;
      const covered = sid !== idRef.current && cards.some((r) => r && x > r.left && x < r.left + r.width && y > r.top && y < r.top + r.height);
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.style.opacity = visible && !covered ? '1' : '0';
      el.style.pointerEvents = visible && !covered ? 'auto' : 'none';
    }
  }, 1);

  return null;
}

export function BattleSelect({ initial, onStart }: { initial: ScenarioId; onStart: (id: ScenarioId) => void }) {
  const [id, setIdRaw] = useState<ScenarioId>(initial);
  const setId = (next: ScenarioId) => {
    if (next !== id) sound.click();
    setIdRaw(next);
  };
  const sceneRef = useRef<SelectScene | null>(null);
  const markers = useRef(new Map<ScenarioId, HTMLDivElement>());
  const s = SCENARIOS[id];
  const yiIn3d = s.joseon.figure === 'fig_yi';
  return (
    <div className="select">
      <Canvas className="select-canvas" gl={createRenderer as never} camera={{ fov: 34, near: 0.05, far: 600, position: [0, 40, 40] }} dpr={Math.min(window.devicePixelRatio, 1.75)} frameloop="always">
        <SelectView id={id} sceneRef={sceneRef} markers={markers} />
      </Canvas>
      <div className="select-grain" />
      <div className="select-markers">
        {SCENARIO_ORDER.map((sid) => (
          <div
            key={sid}
            ref={(el) => {
              if (el) markers.current.set(sid, el);
              else markers.current.delete(sid);
            }}
            className={`marker ${sid === id ? 'marker--on' : ''} ${SCENARIOS[sid].night ? 'marker--night' : ''}`}
            onClick={() => setId(sid)}
          >
            <i />
            <span>{SCENARIOS[sid].title.replace(' 해전', '').replace(' 대첩', '')}</span>
          </div>
        ))}
      </div>
      <div className="select-top">
        <div className="select-heading">壬辰海戰</div>
        {SCENARIO_ORDER.map((sid) => (
          <button key={sid} className={`select-tab ${sid === id ? 'select-tab--on' : ''}`} onClick={() => setId(sid)}>
            {SCENARIOS[sid].title}
            <small>{SCENARIOS[sid].date.slice(0, 4)}</small>
          </button>
        ))}
      </div>
      <div className="select-head">
        <div className="select-title brush">{s.title}</div>
        <div className="select-hanja">{s.hanja}</div>
        <div className="select-date">
          {s.date} · {s.place}
        </div>
      </div>
      <div className={`portrait-card portrait-card--left ${yiIn3d ? '' : 'portrait-card--flat'}`}>
        {!yiIn3d && <img src={`/ui/figures/${s.joseon.figure}.webp`} alt={s.joseon.name} />}
        <div className="portrait-plate">
          <span className="seal">{s.joseon.banner.slice(0, 1)}</span>
          <div>
            <b>{s.joseon.name}</b>
            <small>{s.joseon.title}</small>
          </div>
        </div>
      </div>
      <div className="portrait-card portrait-card--right">
        <div className="portrait-plate portrait-plate--right">
          <div>
            <b>{s.japan.name}</b>
            <small>{s.japan.title}</small>
          </div>
          <span className="seal seal--ink">{s.japan.banner.slice(0, 1)}</span>
        </div>
      </div>
      <div className="select-brief paper">
        <div className="select-brief-head">
          <span>
            난이도 <b>{s.difficulty}</b>
          </span>
          <span>{s.season}</span>
          {s.night && <span className="night-tag">야간 전투</span>}
        </div>
        <p>{s.summary}</p>
        <div className="select-forces">
          <div className="select-force">
            <i className="force-dot force-dot--joseon" />
            조선{id === 'noryang' ? '·명' : ''} — {s.forces.joseon}
          </div>
          <div className="select-force">
            <i className="force-dot force-dot--japan" />
            일본 — {s.forces.japan}
          </div>
        </div>
        <div className="select-foot">
          <span className="select-result">역사 기록 · {s.result}</span>
          <button className="ink-btn" onClick={() => onStart(id)}>
            전투 개시
          </button>
        </div>
      </div>
    </div>
  );
}
