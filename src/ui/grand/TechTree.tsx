import { useT } from '../../i18n';
import { Icon, Modal, num } from './shared';
import './growth.css';
import { turnsText } from './text';
import type { FactionId, TechNodeView, TechTreeView } from './types';

export interface TechTreeProps {
  me: FactionId;
  tree: TechTreeView;
  gold: number;
  canOrder: boolean;
  onResearch: (techId: string) => void;
  onCancel: () => void;
  onClose: () => void;
}

/** Size of a card on the board and the gaps between them, in CSS pixels; the lines between cards are drawn to match. */
const W = 264;
const H = 140;
const GX = 76;
const GY = 22;

/**
 * 기술: the navy's tech tree as a board of cards from left to right, each column standing on the one before it, with the
 * lines from a tech to those it opens. One research runs at a time; its silver is paid when it starts. On a phone in
 * portrait the board is a list in the same order.
 */
export function TechTree({ me, tree, gold, canOrder, onResearch, onCancel, onClose }: TechTreeProps) {
  const t = useT();
  const at = (n: TechNodeView) => ({ x: n.col * (W + GX), y: n.row * (H + GY) });
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const width = tree.cols * W + (tree.cols - 1) * GX;
  const height = tree.rows * H + (tree.rows - 1) * GY;
  const ordered = [...tree.nodes].sort((a, b) => a.col - b.col || a.row - b.row);
  return (
    <Modal label={t('기술')} eyebrow={t('캠페인')} title={t('기술 연구')} onClose={onClose} tone={me} className="g-modal--wide g-tech">
      <div className="g-tech__status">
        {tree.doing ? (
          <>
            <span className="g-tech__now">
              {t('연구 중')} <b>{tree.doing.label}</b> · {t('{turns} 남음', { turns: turnsText(tree.doing.left) })}
            </span>
            <span className="g-tech__bar" aria-hidden>
              <span style={{ width: `${((tree.doing.total - tree.doing.left) / tree.doing.total) * 100}%` }} />
            </span>
            <button type="button" className="g-btn g-btn--sm g-btn--ghost" disabled={!canOrder} onClick={onCancel}>
              {t('연구 취소')}
            </button>
          </>
        ) : (
          <span className="g-tech__now">{t('진행 중인 연구가 없습니다. 연구할 기술을 고르세요.')}</span>
        )}
        <span className="g-tech__gold">
          <Icon name="coin" size="sm" /> {num(gold)}
        </span>
      </div>
      <div className="g-tech__scroll">
        <div className="g-tech__board" style={{ width, height }}>
          <svg className="g-tech__lines" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
            {tree.nodes.flatMap((n) =>
              n.needs.map((id) => {
                const from = byId.get(id);
                if (!from) return null;
                const a = at(from);
                const b = at(n);
                const x0 = a.x + W;
                const y0 = a.y + H / 2;
                const x1 = b.x;
                const y1 = b.y + H / 2;
                const mid = (x0 + x1) / 2;
                const lit = from.state === 'done';
                return <path key={`${id}-${n.id}`} className={lit ? 'g-tech__line g-tech__line--lit' : 'g-tech__line'} d={`M${x0} ${y0}C${mid} ${y0} ${mid} ${y1} ${x1} ${y1}`} />;
              }),
            )}
          </svg>
          {ordered.map((n) => {
            const p = at(n);
            return (
              <div key={n.id} className={`g-tech__card g-tech__card--${n.state}`} style={{ left: p.x, top: p.y, width: W, height: H }}>
                <div className="g-tech__head">
                  <b>{n.label}</b>
                  <span className="g-tech__state">{n.state === 'done' ? t('완료') : n.state === 'doing' ? t('{turns} 남음', { turns: turnsText(n.left ?? 0) }) : t('{gold}냥 · {turns}', { gold: n.gold, turns: turnsText(n.turns) })}</span>
                </div>
                <p className="g-tech__text">{n.text}</p>
                {n.state === 'open' && (
                  <button type="button" className="g-btn g-btn--sm g-btn--primary g-tech__go" disabled={!canOrder || !!n.reason} title={n.reason} onClick={() => onResearch(n.id)}>
                    {n.reason ?? t('연구')}
                  </button>
                )}
                {n.state === 'locked' && n.reason && <em className="g-tech__why">{n.reason}</em>}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
