import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { syncProfile, useLocalProfile } from '../../meta/localProfile';
import { nationById } from '../../meta/fleet';
import { BUILDING_IDS, buildingLevel, type BuildingId } from '../../meta/portDefs';
import type { Profile } from '../../meta/rules';
import type { Faction } from '../../sim/types';
import type { PortView } from '../../port/harbourTerrain';
import { ScreenFrame } from '../Screens';
import { NationPick } from '../generals/Fleet';
import '../generals/generals.css';
import '../generals/fleet.css';
import './port.css';

export const portViewOf = (p: Profile): PortView => ({
  nation: p.nation as Faction,
  port: Object.fromEntries(BUILDING_IDS.map((id) => [id, buildingLevel(p.port, id)])) as Record<BuildingId, number>,
  ships: p.ships,
});

/**
 * /port: the nation pick on first entry; once the account serves a navy the harbour is staged on the battle engine
 * (Engine.setPort, the same renderer, terrain, sea and post-processing as a battle) with PortOverlay on top.
 */
export function PortScreen({ onPort }: { onPort: (view: PortView) => void }) {
  const t = useT();
  const profile = useLocalProfile((s) => s.profile);
  const [synced, setSynced] = useState(false);
  useEffect(() => {
    let live = true;
    void syncProfile().finally(() => { if (live) setSynced(true); });
    return () => { live = false; };
  }, []);
  const nation = nationById(profile.nation);
  useEffect(() => {
    if (synced && nation) onPort(portViewOf(useLocalProfile.getState().profile));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [synced, nation?.id]);
  return (
    <ScreenFrame
      title="본진"
      className="port-screen"
      actions={
        <span className="gen-purse" aria-label={t('엽전')}>
          <i aria-hidden="true" /> {profile.coins.toLocaleString()} <small>{t('엽전')}</small>
        </span>
      }
    >
      {synced && !nation ? <NationPick /> : <div className="fleet-wait" role="status" />}
    </ScreenFrame>
  );
}
