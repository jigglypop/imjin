import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useAccount } from '../account/store';
import { sound } from '../audio/Sound';
import { isIOS } from '../game/device';
import { cameraFeel, FEEL_CHOICES, FEEL_LABEL, type CameraFeel } from '../camera/feel';
import { EQUIPMENT_LABEL, equipment, forceWebGL, saveEquipmentSetting, saveWebgpuOptIn, webgpuOptIn, type EquipmentSetting } from '../game/quality';
import { setLang, useLang, useT, type Lang } from '../i18n';
import { prefetchScreen } from '../router';
import { setScreen, type Screen } from '../state/store';
import { AccountPanel } from './AccountPanel';
import { Backdrop } from './Backdrop';
import { ChevronLeft, Person, Sliders, Speaker, SpeakerOff } from './icons';
import { CodexIcon } from './codex/icons';
import { ControlsHelp } from './Tutorial';
import { MenuBattleBackdrop } from './MenuBattleBackdrop';
import './menu-cinematic.css';

const go = (screen: Screen) => () => {
  sound.click();
  setScreen(screen);
};

/** A mode button starts downloading its screen as soon as it is pointed at, focused or pressed. */
const mode = (screen: Screen) => {
  const prefetch = () => prefetchScreen(screen);
  return { onPointerEnter: prefetch, onFocus: prefetch, onPointerDown: prefetch, onClick: go(screen) };
};

/** Header with a back button to the menu, for every screen below the main menu. Without children it is the empty frame shown while a screen's code downloads. */
export function ScreenFrame({ title, children, actions, className = '' }: { title: string; children?: ReactNode; actions?: ReactNode; className?: string }) {
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
  { screen: 'faction', art: 'mode_campaign', title: '캠페인', desc: '조선, 명, 일본 중 한 나라를 골라 남해안의 포구를 차례로 차지합니다.', brief: '한 나라로 남해안 점령' },
  { screen: 'skirmish', art: 'mode_skirmish', title: '쟁탈전', desc: '거점을 차지해 적의 기세를 꺾는 전투입니다. 함대를 직접 꾸려 출전합니다.', brief: '거점을 차지하는 함대전' },
  { screen: 'online', art: 'mode_online', title: '온라인 대전', desc: '다른 플레이어와 실시간으로 겨룹니다.', brief: '실시간 대전' },
];

/** The poster's billing block: the war's commanders, set like a film's cast under the buttons. */
const BILLING: { side: string; names: string[] }[] = [
  { side: '조선', names: ['이순신', '원균', '이억기', '권준'] },
  { side: '명', names: ['진린', '등자룡'] },
  { side: '일본', names: ['와키자카 야스하루', '구키 요시타카', '구루시마 미치후사'] },
];

export function MainMenu() {
  const t = useT();
  const lang = useLang();
  const title = t('임진왜란');
  const user = useAccount((s) => s.user);
  const [account, setAccount] = useState(false);
  const accountButton = useRef<HTMLButtonElement | null>(null);
  const closeAccount = useCallback(() => {
    setAccount(false);
    accountButton.current?.focus();
  }, []);
  return (
    <section className="screen menu menu--cinematic">
      <Backdrop kind="menu" cinematic />
      <MenuBattleBackdrop />
      <div className="menu-shade" aria-hidden="true" />
      <header className="screen-top menu-masthead">
        <button className="back-btn" data-mode="codex" {...mode('codex')}>
          <CodexIcon name="book" /> {t('함선 도감')}
        </button>
        <button className="back-btn" onClick={go('settings')}>
          <Sliders /> {t('설정')}
        </button>
        {/* A guest is shown as signed out: it signs up from here to keep its progress. */}
        <button
          ref={accountButton}
          className="back-btn menu-account"
          aria-haspopup="dialog"
          aria-expanded={account}
          onClick={() => {
            sound.click();
            setAccount(true);
          }}
        >
          <Person /> <span className="menu-account-name">{user && !user.guest ? user.nickname : t('로그인')}</span>
        </button>
      </header>
      <div className="menu-inner">
        {/* A film poster's title lockup: the tagline above, the title, the years between hairlines. Every part is
            sized from the title's --t, so the lockup scales as one piece. */}
        <div className={`wordmark wordmark--${lang}`}>
          <p className="wordmark-tagline">{t('나라를 지킨 바다')}</p>
          {lang === 'ko' ? (
            <div className="menu-title-lockup">
              <span className="wordmark-hanja" aria-hidden="true">壬辰倭亂</span>
              <h1 className="wordmark-title wordmark-title--poster">{title}</h1>
              <span className="menu-seal" aria-hidden="true">海<br />戰</span>
            </div>
          ) : (
            <h1 className="wordmark-title wordmark-title--roman" aria-label={title}>
              <span className="wordmark-the" aria-hidden="true">The</span>
              <span className="wordmark-name" aria-hidden="true">Imjin War</span>
            </h1>
          )}
          <div className="wordmark-dates" aria-hidden="true"><i /><span>1592 — 1598</span><i /></div>
          {lang === 'en' && <div className="wordmark-mark" aria-hidden="true"><span>壬辰倭亂</span><b>임진왜란</b></div>}
        </div>
        <div className="menu-play">
          <button className="menu-primary" data-mode="faction" {...mode('faction')}>
            <span className="menu-primary-copy"><strong>{t('캠페인')}</strong><small>{t('한 나라로 남해안 점령')}</small></span>
            <span className="menu-arrow" aria-hidden="true">↗</span>
          </button>
          <nav className="menu-modes" aria-label={t('전투 선택')}>
            {MODES.filter(m=>m.screen!=='faction').map(m=><button key={m.screen} data-mode={m.screen} {...mode(m.screen)}><span>{t(m.title)}</span><span className="menu-mode-arrow" aria-hidden="true">↗</span></button>)}
          </nav>
        </div>
      </div>
      <footer className={`menu-billing menu-billing--${lang}`} aria-hidden="true">
        {BILLING.map((group) => <span key={group.side}><b>{t(group.side)}</b>{group.names.map((name) => t(name)).join(' · ')}</span>)}
      </footer>
      {account && <AccountPanel onClose={closeAccount} />}
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
  const [feel, setFeel] = useState<CameraFeel>(cameraFeel.get());
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
                    // Stored for the next visit; the router moves the address to the other edition (/settings, /en/settings).
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
          <Row title={t('카메라 흔들림')} hint={t('발포하고 폭발할 때 화면이 떨리고 늘었다 줄어드는 정도입니다. 큰 해전에서 어지러우면 줄이거나 끄세요.')}>
            <div className="seg seg--set" role="radiogroup" aria-label={t('카메라 흔들림')}>
              {FEEL_CHOICES.map((k) => (
                <button
                  key={k}
                  role="radio"
                  aria-checked={feel === k}
                  className={feel === k ? 'on' : ''}
                  onClick={() => {
                    sound.click();
                    cameraFeel.set(k);
                    setFeel(k);
                  }}
                >
                  {t(FEEL_LABEL[k])}
                </button>
              ))}
            </div>
          </Row>
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
