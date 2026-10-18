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
   - Clips: idle 252 (Idle 12; stance under review), command 29 (Call Gesture; owner wants a period-plausible command instead, under review), sword attack **242 Charged Slash** for both the sword and robe sets (lead 2026-10-17), archery 227 (under review).
   - A body that scores over 0.3 on 242 gets 97 Left Slash or 219 Right-hand Sword Slash, whichever scores lowest; if all three exceed 0.3 it stays off index.json.
   - Swap a clip on a packed figure with `node scripts/generals-swap-clip.mjs --key=<key> --from=<meshy anim glb> --clip=<name> --as=attack_sword` (copies channels by joint name from the same Meshy rig task; unedited).
5. **Pack**:
   - Restore the original 4k maps (the rig output is 2k).
   - LOD0 = the full rigged mesh (it goes on the card). LOD1 and LOD2 are meshoptimizer-decimated, for medium and low tiers only.
   - `--headup=4 --posture=Spine01:1,Spine02:2,neck:2,RightHand:30:y --commandfrom=command_bow` (lead's tuning 2026-10-17; tune per general on the posture sheet).
   - Fix eyes to dark brown (`--eyes`).
   - Write grip sockets from the fist geometry (`socket_grip_right` / `socket_grip_left`).
6. **Deformation metric** (`scripts/lib/deform.mjs`, `node scripts/generals-cast.mjs deform --id=<id>`): skins EVERY frame at 30 fps on the CPU.
   - score = max(crush/0.05, collapse/0.03, pierce/0.04 m): crush = share of upper-arm/forearm vertices whose distance to the bone left 0.55x..1.8x of bind; collapse = arm triangles under 25% of bind area; pierce = forearm/hand inside the torso hull.
   - **Promotion threshold 0.3 on every clip the figure shows**; clip choice must pass it on the candidate bodies. Stance (idle): pelvis tilt < 3 deg, weight shift < 0.15 of foot spacing.
7. **Review gate**: one sheet per general into `review/`, then wait for the lead's approval before `live`. Sheets show each clip's metric-WORST 4 frames (front + 3/4), never fixed fractions. The sheet has:
   - front, side and back views
   - face close-up
   - posture: idle at 3 frames from front, side and 3/4, at eye height
   - every clip's extreme frames with the weapon
   - a hand close-up for every clip, aimed at the socket from 25 cm outside the sleeve

## Weapon rules
- Weapon files: metres, +Y along the blade or shaft, grip at the origin.
- Curved blades (hwando, katana, tachi, dao, nodachi):
  - the edge is on the fingers' side, toward the target, and leads every slash;
  - the spine (mune) is on the thumb/forearm side;
  - the guard sits against the index finger and the pommel at the pinky.
  - In idle with the point down, the edge faces forward. "역날" (reversed edge) is a fail.
- The hilt passes through the fist and never sits inside the sleeve.
- Idle sword hangs at the right side, OUTSIDE the right leg, point down and slightly forward; never diagonally across the legs. Set with a constant idle-only wrist turn in pack (`--posture=…,RightHand:30:y`; axes x pitch / y yaw / z roll in body space), tuned on the front view.
- Side view of the idle: ear, shoulder, hip and ankle on one vertical line, no backward lean (lead's tuning 2026-10-17: `Spine01:1,Spine02:2,neck:2`, `--headup=4`).
- Command (command_sword) is the sword arm thrust/pointed straight FORWARD. 240 Thrust Slash is rejected (deep squat, arms spread); it is 29 Call Gesture played with the sword in hand (lead 2026-10-17): pack `--commandfrom=command_bow` copies that clip to command_sword (102/242/101 compared in `review/yi_command_candidates.jpg`, not chosen).
- Spears: the tip points forward/up, never back.
- Bows: in the left hand; the bow hand stays down in command.

## Rejected — never do again
- ANY Blender weight post-processing (rigid plate weights, weight smoothing, corrective weights) — owner forbade it 2026-10-17. Crumpling is solved by choosing clips with the deformation metric, not by editing weights.
- T-pose bind: shrugged shoulders.
- Custom retargeting or skin-weight painting.
- Tripo's own rig and presets.
- Meshy-only generation for faces, and Tripo plus Meshy retexture hybrids.
- Blender decimate before rigging: cracks the face UVs.
- Decimating LOD0: smears the face.
- `--slim` vertex pinching: narrows the cuirass.
- Stiff "차렷" idles and slouched idles.
- Chin-up gaze (headup above about 5°).
- Spine pitch Spine01:3,Spine02:4,neck:4: leans the side view backward.
- Idle sword crossing in front of the legs (right hand to left foot).
- Command 240 Thrust Slash (squat, arms out like a T): not a forward point.
- Shipping anything not verified in renders the reviewer has looked at.
- Sword attack 241 Weapon Combo 2 (worst 0.78 on jeongun; visible crumple on yi at t3.17) and 92 Double Combo Attack (2.57 jeongun, 3.05 chenlin): arm crumple. Also failing: 4 Attack 2.88, 105 Triple Combo 2.94, 202 Weapon Combo 1 1.75, 221 Charged Upward 1.77.
- Review sheets at fixed clip fractions: they miss the worst frames.
- Sword attached straight from the socket frame: the files carry the edge on -X, the socket's finger side is +X, so it showed 역날. `holdWeapon` turns it half a turn about the blade (`EDGE_TO_FINGERS`); `test-generals-model.mjs` asserts it.

## Hard rules
- Zero tolerance: any flaw means redo that step before going live. Live means `index.json` only after approval.
- Never double-submit a provider task: poll the job files first. Keep the ledger up to date.
- Check API balances. Meshy rigs need Meshy credits, so finish concept and Tripo work while waiting.
- No commit or push from generation work. Deploys go through a clean worktree on origin/main containing only these files.
- After a general goes live (and for rejected candidates immediately), archive its sources with `npm run assets -- archive <folder>` (concepts, raw/rig/anim GLBs, candidates; .json/.md stay local) — never keep generation binaries on the local disk. Bring one back with `npm run assets -- archive-pull "<glob>"`. Never put generation sources in assets.json (`push`): CI pulls all of it on every deploy.
