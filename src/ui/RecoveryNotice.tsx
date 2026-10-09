import { useEffect } from 'react';

/** Shown after the previous battle's page was killed for memory: the new one runs on the lightest settings. */
export function RecoveryNotice({ onResume, onClose }: { onResume?: () => void; onClose: () => void }) {
  useEffect(() => {
    const id = window.setTimeout(onClose, 12000);
    return () => window.clearTimeout(id);
  }, [onClose]);
  return (
    <div className="recovery glass" role="status">
      <p>메모리가 부족해 이전 전투가 종료되었습니다. 이번에는 가벼운 설정으로 실행합니다.</p>
      <div className="recovery-actions">
        {onResume && (
          <button className="ink-btn" onClick={onResume}>
            전투 다시 시작
          </button>
        )}
        <button className="chip" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
