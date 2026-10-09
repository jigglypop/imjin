import { useState, type ReactNode } from 'react';
import { sound } from '../audio/Sound';
import { isIOS } from '../game/device';
import { EQUIPMENT_LABEL, equipment, forceWebGL, saveEquipmentSetting, saveWebgpuOptIn, webgpuOptIn, type EquipmentSetting } from '../game/quality';
import { setScreen, type Screen } from '../state/store';
import { Backdrop } from './Backdrop';
import { ChevronLeft, Sliders, Speaker, SpeakerOff } from './icons';
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
        <button className="back-btn" onClick={go('menu')}>
          <ChevronLeft /> 뒤로
        </button>
        <h1 className="screen-title">{title}</h1>
        {actions && <div className="screen-actions">{actions}</div>}
      </header>
      <div className="screen-body">{children}</div>
    </section>
  );
}

const MODES: { screen: Screen; art: string; title: string; desc: string; brief: string }[] = [
  { screen: 'select', art: 'mode_history', title: '역사 전투', desc: '명량·한산도 등 임진왜란의 해전 아홉 개를 직접 지휘합니다.', brief: '명량·한산도 등 아홉 해전' },
  { screen: 'faction', art: 'mode_campaign', title: '진영 전역', desc: '조선·명·일본 중 한 나라를 골라 남해안의 포구를 차지해 나갑니다.', brief: '한 나라를 골라 남해안을 차지' },
  { screen: 'skirmish', art: 'mode_skirmish', title: '쟁탈전', desc: '거점을 차지해 적의 기세를 꺾는 전투입니다. 함대를 직접 꾸려 출전합니다.', brief: '거점을 차지하는 함대전' },
  { screen: 'online', art: 'mode_online', title: '온라인 대전', desc: '다른 플레이어와 실시간으로 겨룹니다.', brief: '실시간 대전' },
];

export function MainMenu() {
  return (
    <section className="screen menu">
      <Backdrop kind="menu" />
      <header className="screen-top">
        <button className="back-btn" onClick={go('settings')}>
          <Sliders /> 설정
        </button>
      </header>
      <div className="menu-inner">
        <div className="wordmark">
          <div className="wordmark-hanja">壬辰海戰</div>
          <div className="wordmark-ko">임진 해전</div>
          <div className="wordmark-sub">임진왜란 해전 전략</div>
        </div>
        <div>
          <div className="mode-grid">
            {MODES.map((m) => (
              <button key={m.screen} className="mode-card" onClick={go(m.screen)}>
                <img
                  className="mode-art"
                  src={`/ui/art/${m.art}_sm.webp`}
                  srcSet={`/ui/art/${m.art}_sm.webp 600w, /ui/art/${m.art}.webp 1200w`}
                  sizes="132px"
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
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
const QUALITY_LABEL: Record<EquipmentSetting, string> = { auto: '자동', high: '높음', medium: '보통', low: '낮음' };

function Switch({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'switch--on' : ''}`} onClick={onChange}>
      <i />
    </button>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-text">
        <b>{title}</b>
        {hint && <small>{hint}</small>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

export function SettingsScreen() {
  const [muted, setMuted] = useState(sound.muted);
  const [music, setMusic] = useState(sound.musicOn);
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
      <div className="settings-page">
        <section className="set-group glass">
          <h2>소리</h2>
          <Row title={muted ? '소리 꺼짐' : '소리 켜짐'} hint="효과음과 음악을 함께 켜고 끕니다.">
            <span className="set-state" aria-hidden>
              {muted ? <SpeakerOff size={20} /> : <Speaker size={20} />}
            </span>
            <Switch
              on={!muted}
              label="소리"
              onChange={() => {
                sound.setMuted(!muted);
                setMuted(!muted);
              }}
            />
          </Row>
          <Row title={music ? '배경음악 켜짐' : '배경음악 꺼짐'} hint="낮은 바람 소리와 먼 북소리입니다. 효과음은 그대로 들립니다.">
            <Switch
              on={music}
              label="배경음악"
              onChange={() => {
                sound.setMusic(!music);
                setMusic(!music);
              }}
            />
          </Row>
        </section>
        <section className="set-group glass">
          <h2>화면</h2>
          <Row title="그래픽 품질" hint={`현재 ${EQUIPMENT_LABEL[equipment.setting]}. 바꾸면 페이지를 다시 불러옵니다.`}>
            <div className="seg seg--set" role="radiogroup" aria-label="그래픽 품질">
              {EQUIPMENT_CHOICES.map((k) => (
                <button key={k} role="radio" aria-checked={equipment.setting === k} className={equipment.setting === k ? 'on' : ''} onClick={() => choose(k)}>
                  {QUALITY_LABEL[k]}
                </button>
              ))}
            </div>
          </Row>
          <p className="settings-hint">자동은 기기에 맞춰 고릅니다. 높음은 PC, 보통은 태블릿, 낮음은 스마트폰에 맞춘 설정입니다. 화면이 끊기거나 꺼지면 낮음을 선택하세요.</p>
          {isIOS && (
            <>
              <Row title="WebGPU 사용 (실험)" hint={`현재 ${forceWebGL ? 'WebGL2' : 'WebGPU'}. 바꾸면 페이지를 다시 불러옵니다.`}>
                <Switch on={webgpuOptIn()} label="WebGPU 사용" onChange={() => chooseBackend(!webgpuOptIn())} />
              </Row>
              <p className="settings-hint">기본은 WebGL2입니다. WebGPU는 이 기기에서 충분히 시험되지 않았습니다. 전투가 시작되지 않으면 끄세요.</p>
            </>
          )}
          <p className="settings-hint">전투 중에는 전투 화면의 설정에서 화질, 하늘, 파도를 바꿀 수 있습니다.</p>
        </section>
        <section className="set-group set-group--help glass">
          <ControlsHelp open />
        </section>
      </div>
    </ScreenFrame>
  );
}
