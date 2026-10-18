import { useEffect, useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { armorById, armorCardUrl, GENERALS, TIER_LABEL, WEAPON_KINDS, WEAPON_KIND_LABEL, weaponsFor, defaultWeapon, type MetaFaction } from '../../meta/catalog';
import { syncProfile, useLocalProfile } from '../../meta/localProfile';
import { AFFIX_RARITY_LABEL, affixById, PRIMARY_STATS, rerollCost, rollEffect, rollQuality, STAT_LABEL, type ArmorRoll } from '../../meta/affixes';
import { armorRoll, rerollProblem, generalState, learnProblem, levelProgress, skillPointsLeft, owns, skillsFor, wornArmor, wornWeapon, type Profile } from '../../meta/rules';
import { BRANCH_LABEL, TREES } from '../../sim/grand/growthData';
import { COMMANDERS } from '../../sim/grand/regions';
import { portraitUrl } from '../portrait';
import { ScreenFrame } from '../Screens';
import { GeneralModel, useGeneralModels } from './GeneralModel';
import './generals.css';

const NAVIES: { id: MetaFaction; label: string }[] = [
  { id: 'joseon', label: '조선' },
  { id: 'japan', label: '일본' },
  { id: 'ming', label: '명' },
];

const commander = (id: string) => COMMANDERS.find((c) => c.id === id);

const portraitOf = (id: string) => portraitUrl(commander(id)?.portrait ?? `portrait_${id}`, true);

/** One fixed representative figure beside the selected general's preserved account progression. */
export function GeneralsScreen() {
  const t = useT();
  const profile = useLocalProfile((s) => s.profile);
  const refused = useLocalProfile((s) => s.refused);
  const dismiss = useLocalProfile((s) => s.dismiss);
  // The profile is the account's on the server: load it (and carry this browser's own over, once) when the screen opens.
  useEffect(() => {
    void syncProfile();
  }, []);
  const [navy, setNavy] = useState<MetaFaction>('joseon');
  const roster = useMemo(() => GENERALS.filter((g) => g.faction === navy), [navy]);
  const [pick, setPick] = useState('yi');
  const general = roster.find((g) => g.id === pick) ?? roster[0]!;
  return (
    <ScreenFrame
      title="장수"
      className="gen-screen"
      actions={
        <span className="gen-purse" aria-label={t('엽전')}>
          <i aria-hidden="true" /> {profile.coins.toLocaleString()} <small>{t('엽전')}</small>
        </span>
      }
    >
      <div className="gen-tabs" role="tablist" aria-label={t('나라')}>
        {NAVIES.map((n) => (
          <button
            key={n.id}
            role="tab"
            aria-selected={navy === n.id}
            className={`gen-tab gen-tab--${n.id}${navy === n.id ? ' gen-tab--on' : ''}`}
            onClick={() => {
              setNavy(n.id);
              setPick(GENERALS.find((g) => g.faction === n.id && g.famous)?.id ?? '');
            }}
          >
            {t(n.label)}
          </button>
        ))}
      </div>
      <div className="gen-layout">
        <nav className="gen-roll" aria-label={t('장수 목록')}>
          {roster.map((g) => {
            const c = commander(g.id);
            const lv = levelProgress(generalState(profile, g.id).xp).level;
            return (
              <button key={g.id} data-general-id={g.id} className={`gen-pick${g.id === general.id ? ' gen-pick--on' : ''}`} aria-pressed={g.id === general.id} onClick={() => setPick(g.id)}>
                <img src={portraitOf(g.id)} alt="" width={48} height={48} loading="lazy" />
                <span className="gen-pick__text">
                  <b>{t(c?.name ?? g.id)}</b>
                  <span>{t(c?.title ?? '')}</span>
                </span>
                <span className="gen-pick__lv">Lv.{lv}</span>
                {skillPointsLeft(profile, g.id) > 0 && <span className="gen-pick__dot">{skillPointsLeft(profile, g.id)}</span>}
              </button>
            );
          })}
        </nav>
        <Poster id={general.id} profile={profile} />
      </div>
      {refused && (
        <button className="gen-toast" onClick={dismiss}>
          {t(refused)}
        </button>
      )}
    </ScreenFrame>
  );
}

/** The figure files of one general, `<general>__<armor>`, by armor id. */
function figuresOf(models: ReadonlySet<string> | null, id: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of models ?? []) if (file.startsWith(`${id}__`)) out.set(file.slice(id.length + 2), file);
  return out;
}

/**
 * The selected general as one complete figure in one armor (armor and helmet are part of the model), with the
 * selected weapon put in his right fist. Armors without a figure yet are not offered.
 */
function GeneralFigure({ id, profile }: { id: string; profile: Profile }) {
  const t = useT();
  const models = useGeneralModels();
  const equip = useLocalProfile((s) => s.equip);
  const figures = figuresOf(models, id);
  const worn = wornArmor(profile, id)?.id;
  const [preview, setPreview] = useState<string | null>(null);
  const armorId = [preview, worn].find((a) => a && figures.has(a)) ?? figures.keys().next().value;
  const file = armorId ? figures.get(armorId) : undefined;
  const files = useMemo(() => (file ? [file] : null), [file]);
  const held = wornWeapon(profile, id);
  const weapon = SWORD_ONLY.has(id) && held && held.kind !== 'sword' ? defaultWeapon(GENERALS.find((g) => g.id === id)!.faction) : held;
  return (
    <>
      <section className="gen-representative" aria-label={t('장수 모습')} data-model-id={file ?? id}>
        {file ? <GeneralModel files={files} weapon={weapon} /> : (
          <div className={`gen-model gen-representative__placeholder ${models ? 'gen-model--failed' : 'gen-model--loading'}`}>
            {models ? <img className="gen-representative__portrait" src={portraitOf(id)} alt="" /> : <span className="gen-model__wait" aria-hidden="true" />}
            <p className="gen-representative__status" role="status">{t(models ? '이 장수의 3D 모습은 준비 중입니다.' : '장수 모델을 불러오는 중입니다.')}</p>
          </div>
        )}
      </section>
      {figures.size > 0 && (
        <section className="gen-weapons" aria-label={t('갑옷')}>
          <h3>{t('갑옷')}</h3>
          <div className="gen-weapons__choices">
            {[...figures.keys()].map((a) => {
              const def = armorById(a);
              const mine = owns(profile, a);
              return (
                <button key={a} data-armor-id={a} className="gen-weapon" aria-pressed={armorId === a} title={mine ? rollSummary(t, def?.line ?? '', armorRoll(profile, a)) : t('아직 가지지 않은 갑옷입니다')} onClick={() => { setPreview(a); if (mine) equip(id, a); }}>
                  <img src={armorCardUrl(a, true)} alt="" loading="lazy" width={54} height={54} />
                  <b>{t(def?.name ?? a)}</b>
                </button>
              );
            })}
          </div>
        </section>
      )}
      {worn && <ArmorStats armorId={worn} profile={profile} />}
      {file && <WeaponSelection id={id} profile={profile} />}
    </>
  );
}

type T = ReturnType<typeof useT>;
const MOD_LABEL: Record<string, string> = { reload: '장전 속도', accuracy: '명중률', speed: '항속', turn: '선회', fire: '화공', melee: '백병', defense: '방어', morale: '사기' };
const pct = (f: number) => `+${(Math.round((f - 1) * 1000) / 10).toString()}%`;
const effectLine = (t: T, roll: ArmorRoll) => Object.entries(rollEffect(roll)).map(([k, v]) => `${t(MOD_LABEL[k]!)} ${pct(v!)}`).join(' · ');

/** One line per owned piece for the armor button's tooltip: its stats, abilities and total factors. */
function rollSummary(t: T, line: string, roll: ArmorRoll | null): string {
  if (!roll) return t(line);
  const stats = PRIMARY_STATS.map((k) => `${t(STAT_LABEL[k])} ${roll.stats[k]}`).join(' · ');
  const abilities = roll.affixes.map((a) => t(affixById(a.id)?.label ?? a.id)).join(', ');
  return [t(line), stats, abilities, effectLine(t, roll)].filter(Boolean).join('\n');
}

/** The worn armor's rolled primary stats and special abilities, coloured by how good the roll is, with a reforge button. */
function ArmorStats({ armorId, profile }: { armorId: string; profile: Profile }) {
  const t = useT();
  const reroll = useLocalProfile((s) => s.reroll);
  const def = armorById(armorId);
  const roll = armorRoll(profile, armorId);
  if (!def) return null;
  if (!roll) return (
    <section className="gen-armor-roll gen-armor-roll--basic" aria-label={t('갑옷 능력치')}>
      <h3>{t(def.name)} <small>{t(TIER_LABEL[def.tier])}</small></h3>
      <p className="gen-armor-roll__none">{t('기본 갑옷에는 능력치가 붙지 않습니다.')}</p>
    </section>
  );
  const q = rollQuality(def, roll);
  const grade = q >= 0.8 ? 'epic' : q >= 0.55 ? 'rare' : 'common';
  const why = rerollProblem(profile, armorId);
  return (
    <section className={`gen-armor-roll gen-armor-roll--${def.tier} gen-armor-roll--q-${grade}`} aria-label={t('갑옷 능력치')} data-armor-roll={armorId}>
      <h3>{t(def.name)} <small>{t(TIER_LABEL[def.tier])}</small></h3>
      <div className="gen-armor-roll__stats">
        {PRIMARY_STATS.map((k) => (
          <span key={k} className={roll.stats[k] ? '' : 'gen-armor-roll__zero'}><b>{roll.stats[k]}</b>{t(STAT_LABEL[k])}</span>
        ))}
      </div>
      {roll.affixes.length > 0 && (
        <ul className="gen-armor-roll__affixes">
          {roll.affixes.map((a) => {
            const af = affixById(a.id);
            return (
              <li key={a.id} className={`gen-affix gen-affix--${af?.rarity ?? 'common'}`} title={af ? t(af.text) : undefined}>
                <b>{t(af?.label ?? a.id)}</b>
                <small>{Object.entries(a.values).map(([k, v]) => `${t(MOD_LABEL[k]!)} ${pct(1 + v!)}`).join(' · ')}</small>
                <i>{t(AFFIX_RARITY_LABEL[af?.rarity ?? 'common'])}</i>
              </li>
            );
          })}
        </ul>
      )}
      <p className="gen-armor-roll__total">{effectLine(t, roll)}</p>
      <button className="gen-armor-roll__reroll" disabled={!!why} title={why ? t(why) : undefined} onClick={() => reroll(armorId)}>
        {t('다시 벼리기')} <small>{t('{n} 엽전', { n: rerollCost(def).toLocaleString() })}</small>
      </button>
    </section>
  );
}

/**
 * Figures remade with the weapon-kind motion sets whose spear and bow sets wait for the new weapon models and grip
 * rules: only their swords can be chosen for now (the other kinds show, disabled).
 */
const SWORD_ONLY = new Set(['yi', 'wakisaka', 'chenlin', 'won']);

function WeaponSelection({ id, profile }: { id: string; profile: Profile }) {
  const t = useT();
  const equipWeapon = useLocalProfile((s) => s.equipWeapon);
  const general = GENERALS.find((g) => g.id === id)!;
  const choices = weaponsFor(general);
  const selected = wornWeapon(profile, id);
  return (
    <section className="gen-weapons" aria-label={t('무기')}>
      <h3>{t('무기')}</h3>
      {WEAPON_KINDS.map((kind) => (
        <div key={kind} className="gen-weapons__kind" role="group" aria-label={t(WEAPON_KIND_LABEL[kind])}>
          <span>{t(WEAPON_KIND_LABEL[kind])}</span>
          <div className="gen-weapons__choices">
            {choices.filter((w) => w.kind === kind).map((w) => (
              <button key={w.id} data-weapon-id={w.id} className="gen-weapon" aria-pressed={selected?.id === w.id} disabled={SWORD_ONLY.has(id) && kind !== 'sword'} title={t(SWORD_ONLY.has(id) && kind !== 'sword' ? '이 장수의 창술·궁술 동작은 준비 중입니다' : w.line)} onClick={() => equipWeapon(id, w.id)}>
                <img src={`${import.meta.env.BASE_URL}ui/weapons/${w.id}.webp`} alt="" loading="lazy" width={54} height={54} />
                <b>{t(w.name)}</b>
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function Poster({ id, profile }: { id: string; profile: Profile }) {
  const t = useT();
  const learnStep = useLocalProfile((s) => s.learn);
  const c = commander(id);
  const tree = TREES[id];
  const prog = levelProgress(generalState(profile, id).xp);
  const points = skillPointsLeft(profile, id);
  const learned = generalState(profile, id).skills;
  const steps = skillsFor(id);
  return (
    <article className="gen-poster" data-general-id={id}>
      <div className="gen-figure-column">
        <GeneralFigure key={id} id={id} profile={profile} />
      </div>
      <div className="gen-growth">
        <div className="gen-poster__id">
          <span className="gen-poster__section">{t('장수 성장')}</span>
          <span className="gen-poster__title">{t(c?.title ?? '')}</span>
          <h2>{t(c?.name ?? id)} {tree && <small>{tree.hanja}</small>}</h2>
          <div className="gen-level">
            <b>Lv.{prog.level}</b>
            <span>{prog.need === null ? t('최고 레벨') : `${prog.into} / ${prog.need}`}</span>
          </div>
          <div className="gen-bar">
            <i style={{ width: `${prog.need === null ? 100 : Math.round((prog.into / prog.need) * 100)}%` }} />
          </div>
          {points > 0 && <span className="gen-points">{t('재능 점수 {n}', { n: points })}</span>}
        </div>
      {tree && (
        <section className="gen-trait">
          <span>{t('고유 특성')}</span>
          <b>{t(tree.trait.label)}</b>
          <p>{t(tree.trait.text)}</p>
        </section>
      )}
      {tree && (
        <section className="gen-tree" aria-label={t('재능')}>
          {tree.branches.map((branch) => (
            <div key={branch} className="gen-branch">
              <h3>{t(BRANCH_LABEL[branch])}</h3>
              {steps
                .filter((s) => s.branch === branch)
                .map((s) => {
                  const have = learned.includes(s.id);
                  const why = have ? null : learnProblem(profile, id, s.id);
                  return (
                    <button key={s.id} className={`gen-step${have ? ' gen-step--have' : why ? '' : ' gen-step--open'}`} disabled={have || !!why} title={why ? t(why) : undefined} onClick={() => learnStep(id, s.id)}>
                      <b>{t(s.label)}</b>
                      <small>{t(s.text)}</small>
                    </button>
                  );
                })}
            </div>
          ))}
          {steps
            .filter((s) => s.branch === 'mastery')
            .map((s) => {
              const have = learned.includes(s.id);
              const why = have ? null : learnProblem(profile, id, s.id);
              return (
                <button key={s.id} className={`gen-step gen-step--mastery${have ? ' gen-step--have' : why ? '' : ' gen-step--open'}`} disabled={have || !!why} title={why ? t(why) : undefined} onClick={() => learnStep(id, s.id)}>
                  <b>{t('비기')}: {t(s.label)}</b>
                  <small>{t(s.text)}</small>
                </button>
              );
            })}
        </section>
      )}
      </div>
    </article>
  );
}
