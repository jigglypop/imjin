import { Component, type ReactNode } from 'react';
import { setFatal } from '../state/store';
import { Home, Notice, Retry } from './icons';

/** Catches render and async renderer failures below it. With `fallback` it swaps in that content, otherwise it reports a fatal notice. */
export class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
    if (!this.props.fallback) setFatal(String(error instanceof Error ? error.message : error));
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return this.props.fallback ?? null;
  }
}

/** The same page at the lowest equipment tier on the WebGL2 path, for devices that cannot start the default renderer. */
function lowQualityUrl() {
  const url = new URL(location.href);
  url.searchParams.set('q', 'low');
  url.searchParams.set('webgl', '1');
  return url.toString();
}

export function FatalNotice({ message, onMenu }: { message: string; onMenu: () => void }) {
  return (
    <div className="fatal">
      <div className="notice glass" role="alert">
        <span className="notice-icon">
          <Notice size={28} />
        </span>
        <h2>화면을 시작하지 못했습니다</h2>
        <p>이 기기에서 전투 화면을 열 수 없습니다. 낮은 품질 설정으로 다시 시도하면 대부분 해결됩니다.</p>
        <p className="notice-detail">{message}</p>
        <div className="fatal-actions">
          <a className="ink-btn" href={lowQualityUrl()}>
            낮은 품질로 다시 시도
          </a>
          <button className="chip" onClick={() => location.reload()}>
            <Retry /> 새로고침
          </button>
          <button className="chip" onClick={onMenu}>
            <Home /> 메뉴로
          </button>
        </div>
      </div>
    </div>
  );
}
