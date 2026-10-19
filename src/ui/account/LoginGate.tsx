import { useState, type ReactNode } from 'react';
import { useAccount } from '../../account/store';
import { useT } from '../../i18n';
import { ScreenFrame } from '../Screens';
import { AuthModal } from './AuthModal';

/**
 * The account's own navy (제독, 본진) is kept on the server with its coins and rewards: those screens open only for a
 * signed-in player. A guest or a signed-out browser sees why, and the log-in.
 */
export function LoginGate({ title, children }: { title: string; children: ReactNode }) {
  const t = useT();
  const user = useAccount((s) => s.user);
  const [open, setOpen] = useState(false);
  if (user && !user.guest) return <>{children}</>;
  return (
    <ScreenFrame title={title} className="login-gate">
      <div style={{ maxWidth: 420, margin: '12vh auto 0', padding: 24, textAlign: 'center' }} className="glass">
        <p style={{ fontSize: 17, fontWeight: 600, margin: '0 0 8px' }}>{t('로그인이 필요합니다')}</p>
        <p style={{ fontSize: 14, opacity: 0.75, margin: '0 0 20px', lineHeight: 1.55 }}>
          {t('제독, 진영, 본진과 전투 보상은 계정에 저장됩니다. 로그인하면 역사 전투와 캠페인 보상이 쌓입니다.')}
        </p>
        <button type="button" className="g-btn g-btn--primary g-btn--lg" onClick={() => setOpen(true)}>
          {t('로그인')}
        </button>
      </div>
      {open && <AuthModal onClose={() => setOpen(false)} guest={!!user?.guest} />}
    </ScreenFrame>
  );
}
