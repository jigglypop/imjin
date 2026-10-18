---
name: generals-cast
description: Make, fix or review a commander (장수) 3D figure or a commander weapon for /generals — concepts, Tripo model, Meshy rig/motions, pack, review gate, live. Use for ANY generals 3D work; it holds the owner's settled rules so nobody re-tries rejected approaches.
---

# Commander figures (장수 3D)

Script: `scripts/generals-cast.mjs` (steps concept | model | rig | motion | pack | live). Sources and provenance: `assets-src/generals-cast-2026-10-17/<general>__<armor>/`, ledger `ledger.json`, checklist `progress.md`, review sheets `review/`. Runtime: `src/ui/generals/GeneralModel.tsx`, `GeneralsScreen.tsx`, list `public/models/generals/index.json`.

## Settled pipeline — do exactly this
1. **Armor turnaround first**: armor only, front/back/left/right, transparent background (gpt-image-2.5).
2. **Character turnaround**: front/back/left/right with the armor sheet + a face close-up as references, so the armor is identical in all four views.
   - 45° A-pose (NOT T-pose), legs slightly apart, weapon hand a CLOSED fist with a hollow grip channel, other hand relaxed fist, no weapon in the image.
   - Athletic film-hero build: broad shoulders, deep chest, flat stomach, cinched waist, armor fitted to the body. Reject any view whose waist is wider than the chest from the side.
   - Each general gets an individual face: historical age, face shape, nose, brows, beard style/length, wrinkles. Never one shared face template.
   - Looks reference 명량(2014)/한산(2022)/노량(2023), 불멸의 이순신; taiga dramas for Japan; Ming phoenix-wing helmets.
   - Left/right views must not be swapped: a swap gives Tripo a face on the back of the head.
   - Transparent cutout, no halo, no ground shadow. Inspect on magenta.
3. **Tripo** `multiview_to_model`, newest version, geometry and texture "detailed", PBR, all 4 views. Make 2 candidates for famous generals and pick the better face and silhouette.
4. **Meshy rig + Meshy library actions, unedited.**
   - **Standing only (owner 2026-10-17)**: ONE clip, `idle_sword` = 251 Idle 11, pure (`KIND_ACTIONS`). No command, attack, spear or bow clips; the screen shows no 지휘/검술 buttons. `scripts/generals-idle-only.mjs --key=… --from=<anim glb with Idle_11 on the same rig task>` reduces an existing pack to it (rig checked by joint rest pose).
   - Use the robe set for any coat reaching below the knee.
5. **Pack**:
   - Restore the original 4k maps (the rig output is 2k).
   - LOD0 = the full rigged mesh (it goes on the card). LOD1 and LOD2 are meshoptimizer-decimated, for medium and low tiers only.
   - NO pose corrections of any kind (no --headup, --posture, wrist offsets): pure Meshy clips only (owner 2026-10-17).
   - Fix eyes to dark brown (`--eyes`).
   - Write grip sockets from the fist geometry (`socket_grip_right` / `socket_grip_left`).
6. **Review gate**: one sheet per general into `review/`, then wait for the lead's approval before `live`. The sheet has:
   - front, side and back views
   - face close-up
   - posture: idle at 3 frames from front, side and 3/4, at eye height
   - the idle's frames with the faction swords held as the screen holds them (grip shift + idleBlade)
   - a hand close-up of the idle grip, and `node scripts/test-idle-blade.mjs` all clear (in `npm test`)

## Weapon rules
- Weapon files: metres, +Y along the blade or shaft, grip at the origin.
- Curved blades (hwando, katana, tachi, dao, nodachi):
  - the edge is on the fingers' side, toward the target, and leads every slash;
  - the spine (mune) is on the thumb/forearm side;
  - the guard sits against the index finger and the pommel at the pinky.
  - In idle with the point down, the edge faces forward. "역날" (reversed edge) is a fail.
- The hilt passes through the fist and never sits inside the sleeve.
- Grip (owner 2026-10-17): the fist sits on the hilt just under the guard, never at the pommel end. The sword files carry their origin near the pommel, so `holdWeapon` slides every sword down its blade by `swordGripShift` (guard = widest slice of the lower half, fist centre 5.5 cm under it).
- Idle sword: the body clip stays pure; only the HELD weapon turns at runtime (`hangSword` with `src/ui/generals/idleBlade.ts`): blade down, out to the sword side and a little forward, edge forward, the whole blade outside the body. Check: `scripts/test-idle-blade.mjs` — every idle frame, every indexed figure × its faction's swords, blade (guard to tip) ≥ 5 cm from every body vertex except the sword hand. Weapon orientation fixes are allowed; body offsets are not.
- Side view of the idle: chosen by clip (251 Idle 11: weight shift 0.06, tilt ≤ 1.5°). The bind of the current bodies leans back 5.6° (Tripo mesh, joints placed correctly — `review/bind_skeleton_overlay.jpg`); owner deciding.
- Command and attack clips: REMOVED by the owner 2026-10-17 (standing only). Tried and rejected on the way: 412 victory, 290 Wave One Hand, text-to-motion forward point (swift and prime), 29 Call Gesture, 240 Thrust Slash; attacks 241/242/92/97/219.
- Spears: the tip points forward/up, never back.
- Bows: in the left hand, upright beside the body while standing (`aimBow` rest).

## Metric note (2026-10-17)
`scripts/lib/deform.mjs` `pose()` had a parent-matrix bug; every score taken before the fix is invalid — always re-score with the fixed version before deciding. Separate armor pieces were piloted: a separate helmet on the Head bone works; rigid cuirass/pauldron/tasset pieces fail (arms and legs pierce them, thin Tripo shells) — keep fused armored bodies.

## Rejected — never do again
- Command and attack motions on the generals screen (owner 2026-10-17: standing only). Do not fetch or pack them.
- The fist at the pommel end of a sword (origin grip) — the hilt is gripped just under the guard.
- Pose corrections or offsets of any kind (`--posture`, `--headup`, wrist turns, any constant bone offset on any clip) — owner 2026-10-17. Pure Meshy clips only.
- ANY Blender weight post-processing (rigid plate weights, weight smoothing, corrective weights) — owner forbade it 2026-10-17. Crumpling is solved by choosing clips with the deformation metric, not by editing weights.
- T-pose bind: shrugged shoulders.
- Custom retargeting or skin-weight painting.
- Tripo's own rig and presets.
- Meshy-only generation for faces, and Tripo plus Meshy retexture hybrids.
- Blender decimate before rigging: cracks the face UVs.
- Decimating LOD0: smears the face.
- `--slim` vertex pinching: narrows the cuirass.
- Stiff "차렷" idles and slouched idles.
- Chin-up gaze, and ANY constant pose correction (--headup, --posture, wrist offsets): owner banned all corrections 2026-10-17.
- Spine pitch Spine01:3,Spine02:4,neck:4: leans the side view backward.
- Idle sword crossing in front of the legs (right hand to left foot).
- Command 240 Thrust Slash (squat, arms out like a T): not a forward point.
- Shipping anything not verified in renders the reviewer has looked at.
- Sword attached straight from the socket frame: the files carry the edge on -X, the socket's finger side is +X, so it showed 역날. `holdWeapon` turns it half a turn about the blade (`EDGE_TO_FINGERS`); `test-generals-model.mjs` asserts it.

## Hard rules
- Zero tolerance: any flaw means redo that step before going live. Live means `index.json` only after approval.
- Never double-submit a provider task: poll the job files first. Keep the ledger up to date.
- Check API balances. Meshy rigs need Meshy credits, so finish concept and Tripo work while waiting.
- No commit or push from generation work. Deploys go through a clean worktree on origin/main containing only these files.
- After a general goes live (and for rejected candidates immediately), archive its sources with `npm run assets -- archive <folder>` (concepts, raw/rig/anim GLBs, candidates; .json/.md stay local) — never keep generation binaries on the local disk. Bring one back with `npm run assets -- archive-pull "<glob>"`. Never put generation sources in assets.json (`push`): CI pulls all of it on every deploy.
