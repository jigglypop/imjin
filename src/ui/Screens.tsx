import { useState, type ReactNode } from 'react';
import { sound } from '../audio/Sound';
import { isIOS } from '../game/device';
import { EQUIPMENT_LABEL, equipment, forceWebGL, saveEquipmentSetting, saveWebgpuOptIn, webgpuOptIn, type EquipmentSetting } from '../game/quality';
import { setLang, useLang, useT, type Lang } from '../i18n';
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
  const t = useT();
  return (
    <section className={`screen ${className}`}>
      <Backdrop kind="menu" calm />
      <header className="screen-top">
        <button className="back-btn" onClick={go('menu')}>
          <ChevronLeft /> {t('뒤로')}
        </button>
        <h1 className="screen-title">{t(title)}</h1>
        {actions && <div className="screen-actions">{actions}</div>}
      </header>
      <div className="screen-body">{children}</div>
    </section>
  );
}

const MODES: { screen: Screen; art: string; title: string; desc: string; brief: string }[] = [
  { screen: 'select', art: 'mode_history', title: '역사 전투', desc: '명량, 한산도 등 임진왜란 해전 아홉 곳을 직접 지휘합니다.', brief: '명량, 한산도 등 아홉 해전' },
  { screen: 'faction', art: 'mode_campaign', title: '진영 전역', desc: '조선, 명, 일본 중 한 나라를 골라 남해안의 포구를 차례로 차지합니다.', brief: '한 나라로 남해안 점령' },
  { screen: 'skirmish', art: 'mode_skirmish', title: '쟁탈전', desc: '거점을 차지해 적의 기세를 꺾는 전투입니다. 함대를 직접 꾸려 출전합니다.', brief: '거점을 차지하는 함대전' },
  { screen: 'online', art: 'mode_online', title: '온라인 대전', desc: '다른 플레이어와 실시간으로 겨룹니다.', brief: '실시간 대전' },
];

export function MainMenu() {
  const t = useT();
  return (
    <section className="screen menu">
      <Backdrop kind="menu" />
      <header className="screen-top">
        <button className="back-btn" onClick={go('settings')}>
          <Sliders /> {t('설정')}
        </button>
      </header>
      <div className="menu-inner">
        <div className="wordmark">
          <div className="wordmark-hanja">壬辰海戰</div>
          <div className="wordmark-ko">{t('임진 해전')}</div>
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
                <span className="mode-title">{t(m.title)}</span>
                <span className="mode-desc">
                  <span className="long">{t(m.desc)}</span>
                  <span className="brief">{t(m.brief)}</span>
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
const LANGUAGES: { lang: Lang; label: string }[] = [
  { lang: 'ko', label: '한국어' },
  { lang: 'en', label: 'English' },
];

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
  const t = useT();
  const lang = useLang();
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
          <h2>{t('언어 · Language')}</h2>
          <Row title={t('표시 언어')} hint={t('바로 적용되고 저장됩니다.')}>
            <div className="seg seg--set" role="radiogroup" aria-label={t('언어 · Language')}>
              {LANGUAGES.map((l) => (
                <button
                  key={l.lang}
                  role="radio"
                  aria-checked={lang === l.lang}
                  className={lang === l.lang ? 'on' : ''}
                  onClick={() => {
                    if (lang === l.lang) return;
                    sound.click();
                    setLang(l.lang);
                  }}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </Row>
        </section>
        <section className="set-group glass">
          <h2>{t('소리')}</h2>
          <Row title={muted ? t('소리 꺼짐') : t('소리 켜짐')} hint={t('효과음과 음악을 함께 켜고 끕니다.')}>
            <span className="set-state" aria-hidden>
              {muted ? <SpeakerOff size={20} /> : <Speaker size={20} />}
            </span>
            <Switch
              on={!muted}
              label={t('소리')}
              onChange={() => {
                sound.setMuted(!muted);
                setMuted(!muted);
              }}
            />
          </Row>
          <Row title={music ? t('배경음악 켜짐') : t('배경음악 꺼짐')} hint={t('낮은 바람 소리와 먼 북소리입니다. 효과음은 그대로 들립니다.')}>
            <Switch
              on={music}
              label={t('배경음악')}
              onChange={() => {
                sound.setMusic(!music);
                setMusic(!music);
              }}
            />
          </Row>
        </section>
        <section className="set-group glass">
          <h2>{t('화면')}</h2>
          <Row title={t('기기 등급')} hint={t('현재 {name}. 바꾸면 페이지를 다시 불러옵니다.', { name: t(EQUIPMENT_LABEL[equipment.setting]) })}>
            <div className="seg seg--set" role="radiogroup" aria-label={t('기기 등급')}>
              {EQUIPMENT_CHOICES.map((k) => (
                <button key={k} role="radio" aria-checked={equipment.setting === k} className={equipment.setting === k ? 'on' : ''} onClick={() => choose(k)}>
                  {t(EQUIPMENT_LABEL[k])}
                </button>
              ))}
            </div>
          </Row>
          <p className="settings-hint">{t('자동은 기기에 맞춰 고릅니다. 화면이 끊기거나 꺼지면 스마트폰으로 바꿔 보는 것이 좋습니다.')}</p>
          {isIOS && (
            <>
              <Row title={t('WebGPU 사용 (실험)')} hint={t('현재 {name}. 바꾸면 페이지를 다시 불러옵니다.', { name: forceWebGL ? 'WebGL2' : 'WebGPU' })}>
                <Switch on={webgpuOptIn()} label={t('WebGPU 사용')} onChange={() => chooseBackend(!webgpuOptIn())} />
              </Row>
              <p className="settings-hint">{t('기본은 WebGL2입니다. WebGPU는 이 기기에서 충분히 시험되지 않았습니다. 전투가 시작되지 않으면 끄는 것이 좋습니다.')}</p>
            </>
          )}
          <p className="settings-hint">{t('전투 중에는 전투 화면의 설정에서 화질, 하늘, 파도를 바꿀 수 있습니다.')}</p>
        </section>
        <section className="set-group set-group--help glass">
          <ControlsHelp open />
        </section>
      </div>
    </ScreenFrame>
  );
}
