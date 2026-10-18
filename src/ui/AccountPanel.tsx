import { useEffect, useRef, useState } from 'react';
import { changePassword, clearAccountError, logOut, logOutEverywhere, refreshAccount, rename, useAccount } from '../account/store';
import { NICKNAME_MAX, PASSWORD_MAX, type AccountUser } from '../account/wire';
import { sound } from '../audio/Sound';
import { useT } from '../i18n';
import { AuthModal } from './account/AuthModal';
import { useDialogKeys } from './account/focusTrap';
import { Cross } from './icons';
import './account.css';

/** Reason and confirmation lines under a form; the store's error wins over an earlier confirmation. */
function Status({ done }: { done?: string | null }) {
  const t = useT();
  const error = useAccount((s) => s.error);
  if (error) return <p className="acc-error" role="alert">{t(error)}</p>;
  return done ? <p className="acc-done" role="status">{t(done)}</p> : null;
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
        <button
          type="button"
          className="acc-chip"
          onClick={() => {
            sound.click();
            if (window.confirm(t('모든 기기에서 로그아웃할까요? 이 기기도 로그아웃됩니다.'))) void logOutEverywhere();
          }}
        >
          {t('모든 기기에서 로그아웃')}
        </button>
      </div>
    </div>
  );
}

/**
 * The account entry over the main menu. Signed out, and as a guest, it is the log-in / sign-up dialog (a guest that
 * signs up keeps its progress); signed in, the nickname and what can be changed. Opening it fetches the server's copy,
 * so a change made on another device shows.
 */
export function AccountPanel({ onClose }: { onClose: () => void }) {
  const user = useAccount((s) => s.user);
  useEffect(() => {
    clearAccountError();
    void refreshAccount();
  }, []);
  if (!user || user.guest) return <AuthModal onClose={onClose} guest={!!user?.guest} />;
  return <SignedInPanel user={user} onClose={onClose} />;
}

function SignedInPanel({ user, onClose }: { user: AccountUser; onClose: () => void }) {
  const t = useT();
  const box = useRef<HTMLElement | null>(null);
  useDialogKeys(box, onClose);
  useEffect(() => box.current?.focus(), []);
  return (
    <div className="acc-layer" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section ref={box} className="acc" role="dialog" aria-modal="true" aria-label={t('계정')} tabIndex={-1}>
        <button type="button" className="acc-close" aria-label={t('닫기')} onClick={onClose}>
          <Cross size={16} />
        </button>
        <SignedIn user={user} />
      </section>
    </div>
  );
}
