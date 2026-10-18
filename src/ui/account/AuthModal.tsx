import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { clearAccountError, fieldOfCode, logIn, signUp, signUpProblems, useAccount, type AuthField } from '../../account/store';
import { NICKNAME_MAX, PASSWORD_MAX } from '../../account/wire';
import { sound } from '../../audio/Sound';
import { useT } from '../../i18n';
import { useNet } from '../../net/NetClient';
import { Cross } from '../icons';
import { useDialogKeys } from './focusTrap';
import './authModal.css';

export type AuthMode = 'login' | 'signup';

function Eye({ open }: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {!open && <path d="M4 20 20 4" />}
    </svg>
  );
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string | null; hint?: string; children: ReactNode }) {
  const t = useT();
  return (
    <div className={`auth-field ${error ? 'auth-field--bad' : ''}`}>
      <label className="auth-label" htmlFor={id}>
        {t(label)}
      </label>
      {children}
      {error ? (
        <p className="auth-msg auth-msg--bad" id={`${id}-msg`} role="alert">
          {t(error)}
        </p>
      ) : hint ? (
        <p className="auth-msg" id={`${id}-msg`}>
          {t(hint)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The log-in / sign-up dialog. A guest of this browser that signs up keeps its id and progress (the server upgrades it
 * in place). Fields are checked as they are left and again on submit, with the same rules the server applies.
 */
export function AuthModal({ onClose, initialMode = 'login', guest = false }: { onClose: () => void; initialMode?: AuthMode; guest?: boolean }) {
  const t = useT();
  const uid = useId();
  const box = useRef<HTMLElement | null>(null);
  const first = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [nickname, setNickname] = useState(() => useNet.getState().name);
  const [shown, setShown] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<AuthField | 'confirm', boolean>>>({});
  const busy = useAccount((s) => s.status === 'busy');
  const error = useAccount((s) => s.error);
  const errorCode = useAccount((s) => s.errorCode);
  const signup = mode === 'signup';

  useDialogKeys(box, onClose);
  useEffect(() => {
    clearAccountError();
    first.current?.focus();
  }, [mode]);

  const problems = signup ? signUpProblems(login, password, nickname) : {};
  const mismatch = signup && confirm !== password ? '비밀번호가 서로 다릅니다.' : null;
  const serverField = errorCode ? fieldOfCode(errorCode) : null;
  const fieldError = (field: AuthField): string | null => (serverField === field ? error : touched[field] ? (problems[field] ?? null) : null);
  const formError = error && !serverField ? error : null;
  const filled = login.trim() !== '' && password !== '' && (!signup || (nickname.trim() !== '' && confirm !== ''));

  const edit = (set: (value: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value);
    if (useAccount.getState().error) clearAccountError();
  };
  const leave = (field: AuthField | 'confirm') => () => setTouched((was) => (was[field] ? was : { ...was, [field]: true }));
  const pick = (next: AuthMode) => {
    if (next === mode) return;
    sound.click();
    setMode(next);
    setTouched({});
    setConfirm('');
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (signup) {
      setTouched({ login: true, password: true, nickname: true, confirm: true });
      if (Object.keys(problems).length || mismatch) return;
    }
    if (!filled) return;
    sound.click();
    const ok = signup ? await signUp(login, password, nickname) : await logIn(login, password);
    if (ok) onClose();
  };

  const ids = { login: `${uid}-login`, password: `${uid}-password`, confirm: `${uid}-confirm`, nickname: `${uid}-nickname` };
  const described = (id: string, bad: boolean | string | null | undefined, hint?: boolean) => ({ 'aria-invalid': bad ? true : undefined, 'aria-describedby': bad || hint ? `${id}-msg` : undefined });
  const loginError = fieldError('login');
  const passwordError = fieldError('password');
  const nicknameError = fieldError('nickname');
  const confirmError = touched.confirm ? mismatch : null;
  const title = signup ? '회원가입' : '로그인';

  return (
    <div className="auth-layer" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section ref={box} className="auth" role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`} aria-busy={busy}>
        <button type="button" className="auth-close" aria-label={t('닫기')} onClick={onClose}>
          <Cross size={16} />
        </button>
        <h2 className="auth-title" id={`${uid}-title`}>
          {t(title)}
        </h2>
        <div className="auth-tabs" role="tablist" aria-label={t('계정')}>
          {(['login', 'signup'] as const).map((tab) => (
            <button key={tab} type="button" role="tab" id={`${uid}-tab-${tab}`} aria-selected={mode === tab} aria-controls={`${uid}-form`} className={`auth-tab ${mode === tab ? 'auth-tab--on' : ''}`} onClick={() => pick(tab)}>
              {t(tab === 'login' ? '로그인' : '회원가입')}
            </button>
          ))}
        </div>
        {guest && signup && <p className="auth-lead">{t('가입하면 지금까지의 진행이 이 계정에 그대로 이어집니다.')}</p>}
        <form id={`${uid}-form`} className="auth-form" role="tabpanel" aria-labelledby={`${uid}-tab-${mode}`} onSubmit={submit} noValidate>
          <Field id={ids.login} label="아이디" error={loginError} hint={signup ? '영문 소문자·숫자·_ 4~16자' : undefined}>
            <input ref={first} id={ids.login} className="auth-input" name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={16} enterKeyHint="next" value={login} onChange={edit(setLogin)} onBlur={leave('login')} {...described(ids.login, loginError, signup)} />
          </Field>
          <Field id={ids.password} label="비밀번호" error={passwordError} hint={signup ? '8자 이상, 아이디·흔한 비밀번호 제외' : undefined}>
            <div className="auth-pass">
              <input id={ids.password} className="auth-input" type={shown ? 'text' : 'password'} name="password" autoComplete={signup ? 'new-password' : 'current-password'} autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={PASSWORD_MAX} enterKeyHint={signup ? 'next' : 'go'} value={password} onChange={edit(setPassword)} onBlur={leave('password')} {...described(ids.password, passwordError, signup)} />
              <button type="button" className="auth-eye" aria-label={t(shown ? '비밀번호 숨기기' : '비밀번호 보기')} aria-pressed={shown} aria-controls={ids.password} onClick={() => setShown(!shown)}>
                <Eye open={shown} />
              </button>
            </div>
          </Field>
          {signup && (
            <Field id={ids.confirm} label="비밀번호 확인" error={confirmError}>
              <input id={ids.confirm} className="auth-input" type={shown ? 'text' : 'password'} name="confirm-password" autoComplete="new-password" maxLength={PASSWORD_MAX} enterKeyHint="next" value={confirm} onChange={(e) => setConfirm(e.target.value)} onBlur={leave('confirm')} {...described(ids.confirm, confirmError)} />
            </Field>
          )}
          {signup && (
            <Field id={ids.nickname} label="닉네임" error={nicknameError} hint="1~16자, 다른 플레이어에게 보이는 이름">
              <input id={ids.nickname} className="auth-input" name="nickname" autoComplete="nickname" maxLength={NICKNAME_MAX} enterKeyHint="go" value={nickname} onChange={edit(setNickname)} onBlur={leave('nickname')} {...described(ids.nickname, nicknameError, true)} />
            </Field>
          )}
          {formError && (
            <p className="auth-msg auth-msg--bad auth-msg--form" role="alert">
              {t(formError)}
            </p>
          )}
          <button type="submit" className="auth-submit" disabled={busy || !filled}>
            {busy && <span className="auth-spin" aria-hidden="true" />}
            {t(busy ? (signup ? '가입하는 중…' : '로그인하는 중…') : title)}
          </button>
          <p className="auth-switch">
            {t(signup ? '이미 계정이 있나요?' : '계정이 없나요?')}{' '}
            <button type="button" className="auth-link" onClick={() => pick(signup ? 'login' : 'signup')}>
              {t(signup ? '로그인' : '회원가입')}
            </button>
          </p>
          {!signup && <p className="auth-note">{t('가입 전 기록은 이 기기에만 남습니다.')}</p>}
        </form>
      </section>
    </div>
  );
}
