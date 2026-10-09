// Shared by the perf probes: lets a battle run on past the approach and puts the camera among the fighting.
/** Waits for the approach fast-forward to end at first contact. */
export async function waitForContact(page, seconds = 120) {
  const t0 = Date.now();
  while (Date.now() - t0 < seconds * 1000 && (await page.evaluate(() => window.__engine.fastForward || window.__engine.autoFast))) await page.waitForTimeout(500);
}

/** Runs the battle at 32x for a while so that what follows starts in the thick of it. */
export async function fightFor(page, seconds) {
  await page.evaluate(() => {
    window.__engine.speed = 32;
  });
  await page.waitForTimeout(seconds * 1000);
}

/** Looks at the ship with the most enemies close by (preferring one that is grappled) and stays there, so the view does not jump when it sinks. */
export async function followFight(page, distance = 140) {
  return page.evaluate((dist) => {
    const e = window.__engine;
    const live = e.battle.ships.filter((s) => s.alive && s.sinking <= 0);
    let best = null;
    let bestScore = -1;
    for (const a of live) {
      let near = 0;
      for (const b of live) if (b.team !== a.team && (a.x - b.x) ** 2 + (a.z - b.z) ** 2 < 250 * 250) near += 1;
      const score = near + (a.grappledWith ? 100 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    if (!best) return null;
    e.rts.setPose({ tx: best.x, tz: best.z, yaw: 0.8, pitch: 0.5, distance: dist });
    return { id: best.id, enemiesNear: bestScore };
  }, distance);
}
