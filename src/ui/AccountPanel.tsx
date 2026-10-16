import { useEffect, useRef, useState, type FormEvent } from 'react';
import { changePassword, clearAccountError, logIn, logOut, refreshAccount, rename, signUp, useAccount } from '../account/store';
import { NICKNAME_MAX, PASSWORD_MAX, type AccountUser } from '../account/wire';
import { sound } from '../audio/Sound';
import { useT } from '../i18n';
import { useNet } from '../net/NetClient';
import { Cross } from './icons';
import './account.css';

/** Reason and confirmation lines under a form; the store's error wins over an earlier confirmation. */
function Status({ done }: { done?: string | null }) {
  const t = useT();
  const error = useAccount((s) => s.error);
  if (error) return <p className="acc-error" role="alert">{t(error)}</p>;
  return done ? <p className="acc-done" role="status">{t(done)}</p> : null;
}

/** Log in or sign up. A guest of this browser is shown this too: signing up keeps its progress. */
function SignedOut() {
  const t = useT();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState(() => useNet.getState().name);
  const busy = useAccount((s) => s.status === 'busy');
  const signup = mode === 'signup';
  const ready = login.trim() !== '' && password !== '' && (!signup || nickname.trim() !== '');
  const edit = (set: (value: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value);
    clearAccountError();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    sound.click();
    void (signup ? signUp(login, password, nickname) : logIn(login, password));
  };
  const pick = (next: 'login' | 'signup') => {
    setMode(next);
    clearAccountError();
  };
  return (
    <form className="acc-form" onSubmit={submit} noValidate>
      <div className="acc-tabs" role="tablist" aria-label={t('계정')}>
        <button type="button" role="tab" aria-selected={!signup} className={`acc-tab ${signup ? '' : 'acc-tab--on'}`} onClick={() => pick('login')}>
          {t('로그인')}
        </button>
        <button type="button" role="tab" aria-selected={signup} className={`acc-tab ${signup ? 'acc-tab--on' : ''}`} onClick={() => pick('signup')}>
          {t('회원가입')}
        </button>
      </div>
      <input className="acc-input" name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={16} placeholder={t('아이디')} aria-label={t('아이디')} value={login} onChange={edit(setLogin)} />
      <input className="acc-input" type="password" name="password" autoComplete={signup ? 'new-password' : 'current-password'} maxLength={PASSWORD_MAX} placeholder={t('비밀번호')} aria-label={t('비밀번호')} value={password} onChange={edit(setPassword)} />
      {signup && <input className="acc-input" name="nickname" autoComplete="nickname" maxLength={NICKNAME_MAX} placeholder={t('닉네임')} aria-label={t('닉네임')} value={nickname} onChange={edit(setNickname)} />}
      <Status />
      <button type="submit" className="acc-submit" disabled={!ready || busy}>
        {signup ? t('회원가입') : t('로그인')}
      </button>
      <p className="acc-note">{t('가입 전 기록은 이 기기에만 남습니다.')}</p>
    </form>
  );
}

function NicknameForm({ user, onDone }: { user: AccountUser; onDone: () => void }) {
  const t = useT();
  const [nickname, setNickname] = useState(user.nickname);
  const busy = useAccount((s) => s.status === 'busy');
  const name = nickname.trim();
  return (
    <form
      className="acc-form acc-form--row"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await rename(nickname)) onDone();
      }}
    >
      <input className="acc-input" name="nickname" autoComplete="nickname" autoFocus maxLength={NICKNAME_MAX} placeholder={t('닉네임')} aria-label={t('닉네임')} value={nickname} onChange={(e) => { setNickname(e.target.value); clearAccountError(); }} />
      <button type="submit" className="acc-submit" disabled={busy || !name || name === user.nickname}>
        {t('저장')}
      </button>
    </form>
  );
}

function PasswordForm({ user, onDone }: { user: AccountUser; onDone: () => void }) {
  const t = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const busy = useAccount((s) => s.status === 'busy');
  return (
    <form
      className="acc-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await changePassword(current, next)) onDone();
      }}
    >
      {/* Password managers file the new password under this login. */}
      <input type="text" name="username" autoComplete="username" value={user.login ?? ''} readOnly hidden />
      <input className="acc-input" type="password" name="current-password" autoComplete="current-password" autoFocus maxLength={PASSWORD_MAX} placeholder={t('지금 비밀번호')} aria-label={t('지금 비밀번호')} value={current} onChange={(e) => { setCurrent(e.target.value); clearAccountError(); }} />
      <input className="acc-input" type="password" name="new-password" autoComplete="new-password" maxLength={PASSWORD_MAX} placeholder={t('새 비밀번호')} aria-label={t('새 비밀번호')} value={next} onChange={(e) => { setNext(e.target.value); clearAccountError(); }} />
      <button type="submit" className="acc-submit" disabled={busy || !current || !next}>
        {t('변경')}
      </button>
    </form>
  );
}

function SignedIn({ user }: { user: AccountUser }) {
  const t = useT();
  const [open, setOpen] = useState<'nickname' | 'password' | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const toggle = (which: 'nickname' | 'password') => {
    setOpen(open === which ? null : which);
    setDone(null);
    clearAccountError();
  };
  return (
    <div className="acc-me">
      <div className="acc-who">
        <b>{user.nickname}</b>
        <small>{user.login}</small>
      </div>
      <div className="acc-actions">
        <button type="button" className={`acc-chip ${open === 'nickname' ? 'acc-chip--on' : ''}`} aria-expanded={open === 'nickname'} onClick={() => toggle('nickname')}>
          {t('닉네임 변경')}
        </button>
        <button type="button" className={`acc-chip ${open === 'password' ? 'acc-chip--on' : ''}`} aria-expanded={open === 'password'} onClick={() => toggle('password')}>
          {t('비밀번호 변경')}
        </button>
      </div>
      {open === 'nickname' && <NicknameForm user={user} onDone={() => { setOpen(null); setDone('닉네임을 바꿨습니다.'); }} />}
      {open === 'password' && <PasswordForm user={user} onDone={() => { setOpen(null); setDone('비밀번호를 바꿨습니다.'); }} />}
      <Status done={done} />
      {/* Apart from the changes above it: signing out is not an edit. */}
      <div className="acc-foot">
        <button
          type="button"
          className="acc-chip"
          onClick={() => {
            sound.click();
            void logOut();
          }}
        >
          {t('로그아웃')}
        </button>
      </div>
    </div>
  );
}

/**
 * The account panel over the main menu. Signed out, and as a guest, it offers log-in and sign-up; signed in, the
 * nickname and what can be changed. Opening it fetches the server's copy, so a change made on another device shows.
 */
export function AccountPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const user = useAccount((s) => s.user);
  const box = useRef<HTMLElement | null>(null);
  useEffect(() => {
    clearAccountError();
    void refreshAccount();
    box.current?.focus();
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="acc-layer" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section ref={box} className="acc" role="dialog" aria-modal="true" aria-label={t('계정')} tabIndex={-1}>
        <button type="button" className="acc-close" aria-label={t('닫기')} onClick={onClose}>
          <Cross size={16} />
        </button>
        {user && !user.guest ? <SignedIn user={user} /> : <SignedOut />}
      </section>
    </div>
  );
}
