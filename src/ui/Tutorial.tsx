import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import type { Engine } from '../game/Engine';
import { isTouchDevice, isTouchOnly } from '../game/device';
import { useT } from '../i18n';
import { params } from './launch';
import { Icon } from './battleIcons';
import { TIPS } from './tips';
import './tutorial.css';

// Three pieces for new players: the first-battle coach marks (Tutorial), hover / long-press explanations for the
// controls (Tooltips, driven by `data-tip` attributes in the HUD) and the 조작법 reference (ControlsHelp, in settings).

/** True while the tour card is up, so the older bottom-left hint does not say the same thing beside it. */
export const useTour = create<{ active: boolean }>(() => ({ active: false }));

const SEEN_KEY = 'imjin.tutorial.v1';
const REPLAY_EVENT = 'imjin:tutorial';

function readSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSeen(seen: boolean) {
  try {
    if (seen) localStorage.setItem(SEEN_KEY, '1');
    else localStorage.removeItem(SEEN_KEY);
  } catch {
    // Private windows may refuse storage: the tour then simply shows again next time.
  }
}

/** The main menu's settings: the tour comes back at the start of the next battle. */
export function forgetTutorial() {
  writeSeen(false);
}

/** Test hooks (?scenario=, ?conquest=) skip the menu, and with it the tour, unless `?tutorial=1` asks for it. */
function autoStarts(): boolean {
  const flag = params.get('tutorial');
  if (flag === '1') return true;
  if (flag === '0' || params.get('hud') === '0') return false;
  if (params.get('scenario') || params.get('conquest')) return false;
  return !readSeen();
}

type Step = {
  id: string;
  title: string;
  mouse: string;
  touch: string;
  /** CSS selector of the HUD part the step points at; none means the sea itself. */
  target?: (compact: boolean) => string | null;
  /** The order tab this step shows. */
  tab?: number;
  /** Extra sentence for the fast-approach button, only when the battle has one. */
  extra?: string;
};

const STEPS: Step[] = [
  {
    id: 'select',
    title: '함대 고르기',
    mouse: '아래 장수 패를 누르거나 바다의 함선을 클릭해 고릅니다. Shift+클릭으로 더하고, 끌어서 사각형을 그리면 여러 척을 한꺼번에 고를 수 있습니다.',
    touch: '아래 장수 패나 바다의 함선을 탭해 고릅니다. 오른쪽의 박스를 켜면 한 손가락으로 끌어 여러 척을 한꺼번에 고를 수 있습니다.',
    target: () => '.cards .card',
  },
  {
    id: 'move',
    title: '이동',
    mouse: '함선을 고른 뒤 빈 바다를 우클릭하면 그곳으로 이동합니다. 여러 척이면 줄을 맞춰 도착합니다.',
    touch: '함선을 고른 뒤 빈 바다를 탭하면 그곳으로 이동합니다. 여러 척이면 줄을 맞춰 도착합니다.',
  },
  {
    id: 'attack',
    title: '공격',
    mouse: '적 함선을 우클릭하면 그 함선을 공격합니다. 쟁탈전에서는 적 거점의 시설도 같은 방법으로 포격합니다.',
    touch: '적 함선을 탭하면 그 함선을 공격합니다. 쟁탈전에서는 적 거점의 시설도 같은 방법으로 포격합니다.',
  },
  {
    id: 'form',
    title: '진형',
    tab: 0,
    mouse: '학익진, 일자진, 장사진, 첨자진으로 함대를 적을 향해 세웁니다. 자유교전은 모든 명령을 풀고 함선이 알아서 싸우게 합니다. 아이콘에 마우스를 올리면 설명이 나옵니다.',
    touch: '학익진, 일자진, 장사진, 첨자진으로 함대를 적을 향해 세웁니다. 자유교전은 모든 명령을 풀고 함선이 알아서 싸우게 합니다. 아이콘을 길게 누르면 설명이 나옵니다.',
    target: () => '.orders',
  },
  {
    id: 'gun',
    title: '포격',
    tab: 1,
    mouse: '좌현·우현 일제 사격, 사격 중지, 탄종 변경, 측면 정렬을 지시합니다. 포는 함선의 옆면에 있으므로 적에게 측면을 돌려야 쏠 수 있습니다.',
    touch: '좌현·우현 일제 사격, 사격 중지, 탄종 변경, 측면 정렬을 지시합니다. 포는 함선의 옆면에 있으므로 적에게 측면을 돌려야 쏠 수 있습니다.',
    target: () => '.orders',
  },
  {
    id: 'move-tab',
    title: '기동',
    tab: 2,
    mouse: '전속, 반속, 저속으로 속도를 제한하고, 정지하고, 밤에는 등불을 켜고 끕니다. 단축키는 5·6·7, H, L입니다.',
    touch: '전속, 반속, 저속으로 속도를 제한하고, 정지하고, 밤에는 등불을 켜고 끕니다.',
    target: () => '.orders',
  },
  {
    id: 'tactic',
    title: '전술',
    tab: 3,
    mouse: '원거리 포격, 근접 포격, 들이받기, 백병전 돌입, 백병전 방어로 함선이 적을 상대하는 방식을 정합니다. 함선을 고른 뒤 누릅니다.',
    touch: '원거리 포격, 근접 포격, 들이받기, 백병전 돌입, 백병전 방어로 함선이 적을 상대하는 방식을 정합니다. 함선을 고른 뒤 누릅니다.',
    target: () => '.orders',
  },
  {
    id: 'speed',
    title: '배속',
    mouse: '일시정지 버튼으로 멈추고, 배속 버튼으로 전투 속도를 바꿉니다.',
    touch: '일시정지 버튼으로 멈추고, 배속 버튼을 누를 때마다 전투 속도가 바뀝니다.',
    extra: '빠른 접근 버튼은 적과 처음 마주칠 때까지 시간을 빠르게 돌립니다.',
    target: (compact) => (compact ? '.dock' : '.speed'),
  },
  {
    id: 'camera',
    title: '카메라',
    mouse: '휠로 확대·축소, WASD로 이동, Q·E로 회전, 휠 버튼이나 Alt+끌기로 시점을 돌립니다. C는 연출 카메라, O는 선택한 함선 추적입니다.',
    touch: '한 손가락으로 끌어 이동하고, 두 손가락을 벌려 확대하고, 돌려서 회전하고, 위아래로 밀어 기울입니다. 추적은 선택한 함선을 따라갑니다.',
    target: () => (isTouchDevice ? '.touch-bar' : null),
  },
];

/** The union of every element the selector matches, or null when none is on screen. */
function rectOf(selector: string | null | undefined): DOMRect | null {
  if (!selector) return null;
  let box: DOMRect | null = null;
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    box = box ? new DOMRect(Math.min(box.left, r.left), Math.min(box.top, r.top), Math.max(box.right, r.right) - Math.min(box.left, r.left), Math.max(box.bottom, r.bottom) - Math.min(box.top, r.top)) : r;
  }
  return box;
}

const click = (selector: string, index = 0) => document.querySelectorAll<HTMLElement>(selector)[index]?.click();

/** Brings the order panel into view (a folded phone sheet, a collapsed grid) and picks a tab. Returns what it opened. */
function showOrders(tab: number, opened: { sheet: boolean }) {
  if (document.querySelector('.bottom--folded')) {
    click('.dock-fold');
    opened.sheet = true;
  }
  if (document.querySelector('.orders--collapsed')) click('.orders-fold');
  click('.orders-tab', tab);
}

type Place = { ring: DOMRect | null; style: React.CSSProperties };

const overlaps = (a: { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }, pad = 6) =>
  a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;

/** The HUD parts a card must not cover unless it is pointing at them: tool buttons, the ship panel, cards, the minimap. */
const KEEP_CLEAR = '.touch-bar, .detail, .minimap, .hint, .cards, .orders, .dock, .hud-menu, .balance';

/**
 * Puts the card beside its target without leaving the screen: above a bottom target, below a top one, left of an edge
 * strip. A spot that would cover another part of the HUD is skipped for the next free one.
 */
function place(target: DOMRect | null, width: number, height: number, barBottom: number): Place {
  const vw = innerWidth;
  const vh = innerHeight;
  // A short landscape phone keeps its right-hand tool column free.
  const edge = vh < 500 && isTouchDevice ? 72 : 8;
  const clampX = (x: number) => Math.max(8, Math.min(vw - width - edge, x));
  const clampY = (y: number) => Math.max(8, Math.min(vh - height - 8, y));
  const phone = vw < 700 && vw < vh;
  let ring: DOMRect | null = null;
  const spots: { left: number; top: number }[] = [];
  if (!target) {
    // Out on the sea: left of centre and under the score panel, so neither the panel nor the controls are covered.
    const top = Math.max(barBottom + 12, vh * 0.38 - height / 2);
    spots.push({ left: phone ? (vw - width) / 2 : vw * 0.3 - width / 2, top });
  } else {
    const left = Math.max(0, target.left);
    const top = Math.max(0, target.top);
    ring = new DOMRect(left, top, Math.min(vw, target.right) - left, Math.min(vh, target.bottom) - top);
    const cx = ring.left + ring.width / 2 - width / 2;
    if (ring.height > ring.width && ring.width < width / 2 && ring.left > vw / 2) {
      spots.push({ left: ring.left - width - 18, top: ring.top });
    } else {
      const below = ring.bottom + 12;
      const above = ring.top - height - 12;
      const lowTarget = ring.top + ring.height / 2 > vh / 2;
      // The phone's bottom sheet stacks the speed dock and the cards above the orders: a card above the target would hide them.
      if (phone && lowTarget) spots.push({ left: cx, top: barBottom + 12 });
      else if (lowTarget) spots.push({ left: cx, top: above });
      else spots.push({ left: cx, top: below });
    }
  }
  // Fallbacks along the top of the sea, then the middle of either side.
  spots.push({ left: 8, top: barBottom + 12 }, { left: (vw - width) / 2, top: barBottom + 12 }, { left: vw - width - edge, top: barBottom + 12 }, { left: 8, top: vh * 0.34 }, { left: vw - width - edge, top: vh * 0.34 });
  const clear: DOMRect[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(KEEP_CLEAR)) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    // The target itself, and anything holding it, may sit under the ring.
    if (ring && overlaps(r, ring, 0)) continue;
    clear.push(r);
  }
  const fits = (x: number, y: number) => {
    const card = { left: x, top: y, right: x + width, bottom: y + height };
    return !clear.some((r) => overlaps(card, r)) && !(ring && overlaps(card, ring, 8));
  };
  for (const spot of spots) {
    const left = clampX(spot.left);
    const top = clampY(spot.top);
    if (fits(left, top)) return { ring, style: { width, left, top } };
  }
  const first = spots[0]!;
  return { ring, style: { width, left: clampX(first.left), top: clampY(first.top) } };
}

export function Tutorial({ engine, compact }: { engine: Engine; compact: boolean }) {
  const t = useT();
  const [step, setStep] = useState<number | null>(null);
  const [placed, setPlaced] = useState<Place>({ ring: null, style: {} });
  const opened = useRef({ sheet: false });
  // The battle waits while the tour is read: a first-time player should not lose ships to the clock. A pause the
  // player made themselves is left alone, and so is a multiplayer battle, which cannot be paused.
  const paused = useRef(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const touch = isTouchDevice;

  // A multiplayer battle has no speed control, so that step is left out.
  const steps = STEPS.filter((s) => !(s.id === 'speed' && engine.remote));

  const release = useCallback(() => {
    if (!paused.current) return;
    paused.current = false;
    engine.paused = false;
    engine.publish(true);
  }, [engine]);

  const start = useCallback(() => {
    writeSeen(true);
    opened.current.sheet = false;
    if (!engine.remote && !engine.paused) {
      paused.current = true;
      engine.paused = true;
      engine.publish(true);
    }
    useTour.setState({ active: true });
    setStep(0);
  }, [engine]);

  useEffect(() => {
    let timer = 0;
    if (autoStarts()) timer = window.setTimeout(start, 1400);
    const replay = () => start();
    window.addEventListener(REPLAY_EVENT, replay);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(REPLAY_EVENT, replay);
      useTour.setState({ active: false });
    };
  }, [start]);

  const current = step === null ? null : steps[step];
  const hasSkip = !!document.querySelector('.speed-skip');

  // Follow the target: the HUD reflows when the selection changes, the phone turns or the window resizes.
  useLayoutEffect(() => {
    if (!current) return;
    if (current.tab !== undefined) showOrders(current.tab, opened.current);
    const measure = () => {
      let width = Math.min(compact && innerHeight < 500 ? 300 : 340, innerWidth - 16);
      const target = rectOf(current.target?.(compact));
      // The tool column on the right stays visible: a card that is not about it gets narrower instead of covering it.
      const tools = rectOf('.touch-bar');
      if (tools && tools.left > innerWidth / 2 && !(target && target.left >= tools.left - 4)) width = Math.min(width, Math.max(220, tools.left - 16));
      const next = place(target, width, cardRef.current?.offsetHeight ?? 170, document.querySelector('.hud .balance')?.getBoundingClientRect().bottom ?? 0);
      setPlaced((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    measure();
    // The card's height is known only after it has rendered this step's text.
    const frame = requestAnimationFrame(measure);
    const id = window.setInterval(measure, 250);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(id);
      window.removeEventListener('resize', measure);
    };
  }, [current, compact]);

  const close = useCallback(() => {
    // The phone sheet was folded away by the player's own default: put it back.
    if (opened.current.sheet && !document.querySelector('.bottom--folded')) click('.dock-fold');
    opened.current.sheet = false;
    click('.orders-tab', 0);
    release();
    useTour.setState({ active: false });
    setStep(null);
  }, [release]);

  if (!current || step === null) return null;
  const last = step === steps.length - 1;
  const ring = placed.ring;
  return (
    <>
      {ring && <div className="tour-ring" style={{ left: ring.left - 6, top: ring.top - 6, width: ring.width + 12, height: ring.height + 12 }} />}
      <div ref={cardRef} className="tour-card" role="dialog" aria-label={t('조작 안내')} style={placed.style}>
        <div className="tour-head">
          <span className="tour-count">
            {step + 1} / {steps.length}
          </span>
          <button className="tour-x" onClick={close} aria-label={t('안내 닫기')}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="tour-title">{t(current.title)}</div>
        <p className="tour-text">
          {t(touch ? current.touch : current.mouse)}
          {current.extra && hasSkip ? ` ${t(current.extra)}` : ''}
        </p>
        <div className="tour-nav">
          <button className="tour-btn" onClick={close}>
            {t('건너뛰기')}
          </button>
          <span className="tour-spacer" />
          {step > 0 && (
            <button className="tour-btn" onClick={() => setStep(step - 1)}>
              {t('이전')}
            </button>
          )}
          <button className="tour-btn tour-btn--go" onClick={() => (last ? close() : setStep(step + 1))}>
            {t(last ? '시작하기' : '다음')}
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- tooltips

type Shown = { id: string; rect: DOMRect; key: string; touch: boolean };

const HOVER_MS = 380;
const PRESS_MS = 420;
const PRESS_SLOP = 10;

/** Explains any element marked `data-tip`: after a short hover with a mouse, after a long press with a finger. */
export function Tooltips() {
  const t = useT();
  const [shown, setShown] = useState<Shown | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    let timer = 0;
    let hideTimer = 0;
    let startX = 0;
    let startY = 0;
    let longPressed = false;
    let anchor: HTMLElement | null = null;
    // The control the pointer pressed: its explanation stays shut until the pointer has left it, so a click that
    // reshuffles the HUD under a resting mouse does not bring the tooltip back.
    let pressed: HTMLElement | null = null;
    const find = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('[data-tip]') : null);
    const hide = () => {
      window.clearTimeout(timer);
      window.clearTimeout(hideTimer);
      anchor = null;
      setShown(null);
    };
    const show = (el: HTMLElement, fromTouch: boolean) => {
      const id = el.dataset.tip!;
      if (!TIPS[id]) return;
      anchor = el;
      setShown({ id, rect: el.getBoundingClientRect(), key: el.querySelector('kbd')?.textContent ?? '', touch: fromTouch });
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const el = find(e.target);
      window.clearTimeout(timer);
      if (!el) {
        setShown(null);
        return;
      }
      if (el === pressed) return;
      timer = window.setTimeout(() => show(el, false), HOVER_MS);
    };
    // The pointer left the control, or the control itself went away (a card that was removed, a screen that closed).
    const onOut = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const from = find(e.target);
      if (from && from !== find(e.relatedTarget)) {
        hide();
        if (from === pressed) pressed = null;
      }
    };
    const watch = window.setInterval(() => {
      if (anchor && !anchor.isConnected) hide();
    }, 300);
    const onDown = (e: PointerEvent) => {
      longPressed = false; // a fresh touch never inherits a stale long-press
      if (e.pointerType === 'mouse') {
        pressed = find(e.target);
        hide();
        return;
      }
      hide();
      const el = find(e.target);
      if (!el) return;
      startX = e.clientX;
      startY = e.clientY;
      timer = window.setTimeout(() => {
        longPressed = true;
        show(el, true);
      }, PRESS_MS);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || !timer) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > PRESS_SLOP) window.clearTimeout(timer);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      window.clearTimeout(timer);
      if (longPressed) hideTimer = window.setTimeout(() => setShown(null), 3800);
    };
    // The finger that opened the explanation must not also press the button.
    const onClick = (e: MouseEvent) => {
      if (!longPressed) return;
      longPressed = false;
      e.preventDefault();
      e.stopPropagation();
    };
    const onMenu = (e: Event) => {
      if (find(e.target)) e.preventDefault();
    };
    const clearFlag = () => {
      window.setTimeout(() => (longPressed = false), 450);
    };
    // iOS can end a touch with pointercancel instead of pointerup; do not leave the click swallower armed.
    const onCancel = () => {
      longPressed = false;
      hide();
    };

    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointerup', clearFlag);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('click', onClick, true);
    document.addEventListener('contextmenu', onMenu);
    document.addEventListener('scroll', hide, true);
    return () => {
      hide();
      window.clearInterval(watch);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointerup', clearFlag);
      document.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('contextmenu', onMenu);
      document.removeEventListener('scroll', hide, true);
    };
  }, []);

  // Above the control when there is room (the order bar sits at the bottom), else below; kept inside the screen.
  useLayoutEffect(() => {
    if (!shown) return;
    const width = Math.min(268, innerWidth - 16);
    const left = Math.max(8, Math.min(innerWidth - width - 8, shown.rect.left + shown.rect.width / 2 - width / 2));
    const room = shown.rect.top;
    setStyle(room > 150 ? { width, left, bottom: innerHeight - shown.rect.top + 10 } : { width, left, top: shown.rect.bottom + 10 });
  }, [shown]);

  if (!shown) return null;
  const tip = TIPS[shown.id]!;
  const key = isTouchOnly ? '' : shown.key;
  return (
    <div className="tip" role="tooltip" style={style}>
      <div className="tip-title">
        {t(tip.title)}
        {key && <kbd>{key}</kbd>}
      </div>
      <p>{t(tip.what)}</p>
      <p className="tip-when">
        <b>{t('언제')}</b> {t(tip.when)}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- reference and replay (settings)

const KEYS: { title: string; rows: [string, string][] }[] = [
  {
    title: '선택',
    rows: [
      ['클릭', '함선 선택'],
      ['Shift+클릭', '선택에 더하기 · 빼기'],
      ['끌기', '사각형으로 여러 척 선택'],
      ['Tab', '다음 함선'],
      ['Esc', '선택 풀기'],
    ],
  },
  {
    title: '명령',
    rows: [
      ['우클릭', '바다는 이동, 적 함선은 공격'],
      ['1 2 3 4', '학익진 · 일자진 · 장사진 · 첨자진'],
      ['G', '자유교전'],
      ['Z / X', '좌현 · 우현 일제 사격'],
      ['Y', '사격 중지 · 자유 사격'],
      ['T', '탄종 변경'],
      ['U', '측면 정렬'],
      ['5 6 7', '전속 · 반속 · 저속'],
      ['H', '정지'],
      ['L', '등불 켜기 · 끄기'],
      ['K J N B', '원거리 · 근접 · 들이받기 · 백병전 돌입'],
      ['P', '백병전 방어'],
    ],
  },
  {
    title: '카메라와 화면',
    rows: [
      ['휠', '확대 · 축소'],
      ['W A S D', '시점 이동 (방향키도 됩니다)'],
      ['Q / E', '시점 회전'],
      ['R / F', '시점 기울임'],
      ['휠 버튼 · Alt+끌기', '시점 돌리기'],
      ['C', '연출 카메라'],
      ['V', '연출 슬로모션'],
      ['O', '선택한 함선 추적'],
      ['F', '선내 단면 (누를 때마다 층이 바뀝니다)'],
      ['I', '이름표 켜기 · 끄기'],
      ['Space', '일시정지'],
      ['M', '소리 켜기 · 끄기'],
    ],
  },
];

const GESTURES: [string, string][] = [
  ['탭', '함선 선택 · 빈 바다는 이동 · 적 함선은 공격'],
  ['한 손가락 끌기', '시점 이동 (박스를 켜면 사각형 선택)'],
  ['두 손가락 벌리기·모으기', '확대 · 축소'],
  ['두 손가락 돌리기', '시점 회전'],
  ['두 손가락 위아래로 밀기', '시점 기울임'],
  ['장수 패 두 번 탭', '그 부대로 카메라 이동'],
  ['함선 두 번 탭', '그 함선 따라가기'],
  ['아이콘 길게 누르기', '명령 설명 보기'],
];

function Rows({ rows }: { rows: [string, string][] }) {
  const t = useT();
  return (
    <dl className="ctl-rows">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{t(k)}</dt>
          <dd>{t(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The 조작법 reference and the replay button. In a battle `onReplay` closes the settings sheet and the tour starts at
 * once; on the settings screen the tour is armed for the next battle.
 */
export function ControlsHelp({ onReplay, open }: { onReplay?: () => void; open?: boolean }) {
  const t = useT();
  const [armed, setArmed] = useState(false);
  const replay = () => {
    if (onReplay) {
      onReplay();
      window.dispatchEvent(new Event(REPLAY_EVENT));
    } else {
      forgetTutorial();
      setArmed(true);
    }
  };
  return (
    <div className="ctl">
      <details className="ctl-help" open={open}>
        <summary>{t('조작법')}</summary>
        <div className="ctl-body">
          {isTouchDevice && (
            <section>
              <h3>{t('터치')}</h3>
              <Rows rows={GESTURES} />
            </section>
          )}
          {!isTouchOnly &&
            KEYS.map((g) => (
              <section key={g.title}>
                <h3>{t(g.title)}</h3>
                <Rows rows={g.rows} />
              </section>
            ))}
        </div>
      </details>
      <button className="chip" onClick={replay} disabled={armed}>
        {t(armed ? '다음 전투에서 다시 안내합니다' : '조작 안내 다시 보기')}
      </button>
    </div>
  );
}
