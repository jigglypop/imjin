import {
  BUILD,
  LEVEL_XP,
  SKILLS,
  buildShip,
  repairAll,
  repairCost,
  resetCampaign,
  spendSkill,
  type Campaign,
  type SkillKey,
} from '../campaign/campaign';
import { sound } from '../audio/Sound';
import { KIND_HANJA } from './kinds';
import type { ShipKind } from '../sim/types';

function Bar({ value, tone }: { value: number; tone: 'hull' | 'crew' | 'supply' }) {
  return (
    <div className={`camp-bar camp-bar--${tone}`}>
      <i style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  );
}

export function CampaignPanel({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const cost = repairCost(campaign);
  const r = campaign.resources;
  const click = (fn: () => void) => () => {
    sound.click();
    fn();
  };
  const totals = campaign.squads.reduce((acc, sq) => acc + sq.ships.length, 0);
  return (
    <div className="camp-backdrop" onClick={onClose}>
      <div className="camp glass" onClick={(e) => e.stopPropagation()}>
        <div className="camp-head">
          <div className="camp-title">軍營 · 군영</div>
          <div className="camp-res">
            <span>
              군량 <b>{Math.floor(r.grain)}</b>
            </span>
            <span>
              화약 <b>{Math.floor(r.powder)}</b>
            </span>
            <span>
              목재 <b>{Math.floor(r.timber)}</b>
            </span>
            <span>
              공훈 <b>{Math.floor(r.merit)}</b>
            </span>
          </div>
          <button className="mini-btn" onClick={click(onClose)}>
            닫기
          </button>
        </div>
        <div className="camp-body">
          <section className="camp-fleet">
            <div className="camp-section-title">함대 · {totals}척</div>
            <div className="camp-actions">
              <button className="chip" onClick={click(() => repairAll('hull'))} disabled={cost.timber === 0}>
                선체 수리 <small>목재 {cost.timber}</small>
              </button>
              <button className="chip" onClick={click(() => repairAll('crew'))} disabled={cost.grain === 0}>
                병력 충원 <small>군량 {cost.grain}</small>
              </button>
              <button className="chip" onClick={click(() => repairAll('supply'))} disabled={cost.powder === 0}>
                탄약 보급 <small>화약 {cost.powder}</small>
              </button>
            </div>
            <div className="camp-build">
              {(Object.keys(BUILD) as ShipKind[]).map((kind) => {
                const b = BUILD[kind]!;
                const locked = campaign.step < b.unlock;
                const afford = r.timber >= b.timber && r.powder >= b.powder && r.grain >= b.grain;
                return (
                  <button key={kind} className="chip" disabled={locked || !afford} onClick={click(() => buildShip(kind, campaign.squads[0]?.id ?? ''))} title={locked ? '아직 건조할 수 없다' : ''}>
                    {b.label} 건조{' '}
                    <small>
                      목{b.timber} · 화{b.powder} · 량{b.grain}
                    </small>
                  </button>
                );
              })}
            </div>
            <div className="camp-squads">
              {campaign.squads.map((sq) => {
                const cmd = campaign.commanders.find((c) => c.id === sq.commanderId);
                return (
                  <div key={sq.id} className="camp-squad">
                    <div className="camp-squad-head">
                      <img src={`/ui/portraits/${cmd?.portrait ?? 'portrait_admiral'}.jpg`} alt="" />
                      <div>
                        <b>{sq.name}</b>
                        <small>
                          {cmd?.name} · {sq.ships.length}척
                        </small>
                      </div>
                    </div>
                    <div className="camp-ships">
                      {sq.ships.map((s) => (
                        <div key={s.id} className="camp-ship" title={`${s.name} · 격파 ${s.kills}`}>
                          <span className="camp-kind">{KIND_HANJA[s.kind]}</span>
                          <Bar value={s.hull} tone="hull" />
                          <Bar value={s.crew} tone="crew" />
                          <Bar value={s.supply} tone="supply" />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
          <section className="camp-cmds">
            <div className="camp-section-title">장수</div>
            {campaign.commanders
              .filter((c) => c.alive)
              .map((c) => {
                const next = LEVEL_XP[c.level] ?? c.xp;
                const prev = LEVEL_XP[c.level - 1] ?? 0;
                return (
                  <div key={c.id} className="camp-cmd">
                    <img src={`/ui/portraits/${c.portrait}.jpg`} alt="" />
                    <div className="camp-cmd-body">
                      <div className="camp-cmd-name">
                        <b>{c.name}</b> <small>{c.title}</small>
                        <span className="camp-level">Lv.{c.level}</span>
                        {c.points > 0 && <span className="camp-points">+{c.points}</span>}
                      </div>
                      <div className="camp-xp">
                        <i style={{ width: `${Math.min(1, (c.xp - prev) / Math.max(1, next - prev)) * 100}%` }} />
                      </div>
                      <div className="camp-skills">
                        {(Object.keys(SKILLS) as SkillKey[]).map((k) => (
                          <button key={k} className={`camp-skill ${c.skills[k] ? 'camp-skill--on' : ''}`} disabled={c.points <= 0 || c.skills[k] >= 5} onClick={click(() => spendSkill(c.id, k))} title={`${SKILLS[k].label} — ${SKILLS[k].desc}`}>
                            <span>{SKILLS[k].hanja}</span>
                            {c.skills[k]}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            <div className="camp-section-title">일지</div>
            <div className="camp-log">
              {campaign.log.slice(0, 8).map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
            <button
              className="chip camp-reset"
              onClick={click(() => {
                if (confirm('전역을 처음부터 다시 시작합니까?')) resetCampaign();
              })}
            >
              전역 새로 시작
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
