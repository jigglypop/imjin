import { useState, type ReactNode } from 'react';
import { sound } from '../audio/Sound';
import { isIOS } from '../game/device';
import { EQUIPMENT_LABEL, equipment, forceWebGL, saveEquipmentSetting, saveWebgpuOptIn, webgpuOptIn, type EquipmentSetting } from '../game/quality';
import { setScreen, type Screen } from '../state/store';
import { Backdrop } from './Backdrop';
import { ControlsHelp } from './Tutorial';

const go = (screen: Screen) => () => {
  sound.click();
  setScreen(screen);
};

/** Header with a back button to the menu, for every screen below the main menu. */
export function ScreenFrame({ title, children, actions, className = '' }: { title: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`screen ${className}`}>
      <Backdrop kind="menu" calm />
      <header className="screen-top">
        <button className="back-btn" onClick={go('menu')} aria-label="메뉴로">
          <span aria-hidden>‹</span> 메뉴
        </button>
        <h1 className="screen-title">{title}</h1>
        {actions && <div className="screen-actions">{actions}</div>}
      </header>
      <div className="screen-body">{children}</div>
    </section>
  );
}

const MODES: { screen: Screen; art: string; icon: string; title: string; desc: string; brief: string }[] = [
  { screen: 'select', art: 'mode_history', icon: '史', title: '역사 전투', desc: '명량, 한산도 등 아홉 해전을 그날의 바다에서 치른다. 진영을 골라 지휘하고, 1592 전역으로도 이어 간다.', brief: '아홉 해전을 그날의 바다에서' },
  { screen: 'faction', art: 'mode_campaign', icon: '覇', title: '진영 전역', desc: '조선, 명, 일본 가운데 한 진영을 골라 바다와 포구를 넓혀 가는 전략 전역.', brief: '한 진영을 골라 바다를 넓힌다' },
  { screen: 'skirmish', art: 'mode_skirmish', icon: '爭', title: '쟁탈전', desc: '포구를 차지해 적의 기세를 꺾는 거점 점령전. 함대를 직접 편성해 출진한다.', brief: '포구를 차지하는 거점 점령전' },
  { screen: 'online', art: 'mode_online', icon: '對', title: '온라인 대전', desc: '다른 사람과 같은 바다에서 겨룬다. 방을 열거나 열린 방에 들어간다.', brief: '다른 사람과 같은 바다에서' },
];

export function MainMenu() {
  return (
    <section className="screen menu">
      <Backdrop kind="menu" />
      <header className="screen-top">
        <button className="back-btn" onClick={go('settings')}>
          설정
        </button>
      </header>
      <div className="menu-inner">
        <div className="wordmark">
          <div className="wordmark-hanja">壬辰海戰</div>
          <div className="wordmark-ko">임진 해전</div>
          <div className="wordmark-sub">1592 · 조선 수군의 바다</div>
        </div>
        <div>
          <div className="mode-grid">
            {MODES.map((m) => (
              <button key={m.screen} className="mode-card" onClick={go(m.screen)}>
                <img
                  className="mode-art"
                  src={`/ui/art/${m.art}.webp`}
                  srcSet={`/ui/art/${m.art}_sm.webp 600w, /ui/art/${m.art}.webp 1200w`}
                  sizes="(max-width: 700px) 100vw, 520px"
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <span className="mode-icon" aria-hidden>
                  {m.icon}
                </span>
                <span className="mode-title">{m.title}</span>
                <span className="mode-desc">
                  <span className="long">{m.desc}</span>
                  <span className="brief">{m.brief}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const EQUIPMENT_CHOICES: EquipmentSetting[] = ['auto', 'high', 'medium', 'low'];

export function SettingsScreen() {
  const [muted, setMuted] = useState(sound.muted);
  const choose = (next: EquipmentSetting) => {
    if (next === equipment.setting) return;
    saveEquipmentSetting(next);
    const url = new URL(location.href);
    url.searchParams.delete('q');
    location.assign(url.toString());
  };
  // WebGL2 is the default on iOS, where it is the path that has been tested. WebGPU there is an experiment.
  const chooseBackend = (webgpu: boolean) => {
    if (webgpu === webgpuOptIn()) return;
    saveWebgpuOptIn(webgpu);
    const url = new URL(location.href);
    url.searchParams.delete('webgl');
    location.assign(url.toString());
  };
  return (
    <ScreenFrame title="설정">
      <div className="settings-page glass">
        <div>
          <div className="settings-label">소리</div>
          <div className="chips">
            <button
              className={`chip ${!muted ? 'chip--on' : ''}`}
              onClick={() => {
                sound.setMuted(!muted);
                setMuted(!muted);
              }}
            >
              {muted ? '소리 꺼짐' : '소리 켜짐'}
            </button>
          </div>
        </div>
        <div>
          <div className="settings-label">
            설비 등급 <small>{EQUIPMENT_LABEL[equipment.setting]} · 바꾸면 페이지를 다시 불러옵니다</small>
          </div>
          <div className="chips">
            {EQUIPMENT_CHOICES.map((k) => (
              <button key={k} className={`chip ${equipment.setting === k ? 'chip--on' : ''}`} onClick={() => choose(k)}>
                {EQUIPMENT_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="settings-hint">자동은 기기에 맞춰 고릅니다. 화면이 끊기거나 꺼진다면 폰급으로 낮추십시오.</div>
        </div>
        {isIOS && (
          <div>
            <div className="settings-label">
              그래픽 방식 <small>{forceWebGL ? 'WebGL2' : 'WebGPU'} · 바꾸면 페이지를 다시 불러옵니다</small>
            </div>
            <div className="chips">
              <button className={`chip ${webgpuOptIn() ? 'chip--on' : ''}`} onClick={() => chooseBackend(!webgpuOptIn())}>
                WebGPU 사용 (실험)
              </button>
            </div>
            <div className="settings-hint">기본은 WebGL2입니다. WebGPU는 아직 이 기기에서 충분히 시험되지 않았습니다. 전투가 시작되지 않으면 끄십시오.</div>
          </div>
        )}
        <ControlsHelp open />
        <div className="settings-hint">전투 중의 화질·하늘·파도는 전투 화면의 설정에서 바꿉니다.</div>
      </div>
    </ScreenFrame>
  );
}
