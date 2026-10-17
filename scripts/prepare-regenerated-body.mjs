// Only the newly generated Meshy body supplies geometry. Older files supply animation curves only.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { io } from './lib/figure.mjs';
import { retargetGeneralMotion } from './lib/new-general-motion.mjs';
import { groundGeneralMotions } from './lib/ground-general-motion.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORK = resolve('F:/codex-work/imjin-regeneration-fit');
mkdirSync(WORK, { recursive: true });
const source = join(ROOT, 'assets-src/generals-regeneration-2026-10-17/raw/body-rig/rigged_character_glb_url.glb');
const sha256 = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const doc = await io.read(source);
const skin = doc.getRoot().listSkins()[0];
const head = skin.listJoints().find(n => n.getName() === 'Head');
if (!head) throw new Error('No head joint');
const pivot = new Vector3(...head.getWorldTranslation());
const changed = [];
for (const node of doc.getRoot().listNodes().filter(n => n.getMesh() && n.getSkin())) {
  // Meshy stores metre POSITIONs but leaves a .01 mesh transform; its inverse binds compensate that transform.
  // Actual bind-space geometry must use the skin product, not the mesh node transform alone.
  const world = new Matrix4().fromArray(skin.listJoints()[0].getWorldMatrix())
    .multiply(new Matrix4().fromArray(skin.getInverseBindMatrices().getElement(0, [])));
  const inverse = world.clone().invert();
  for (const primitive of node.getMesh().listPrimitives()) {
    const position = primitive.getAttribute('POSITION');
    let count = 0;
    for (let i = 0; i < position.getCount(); i++) {
      const point = new Vector3(...position.getElement(i, [])).applyMatrix4(world);
      const blend = Math.max(0, Math.min(1, (point.y - (pivot.y - .045)) / .065));
      const smooth = blend * blend * (3 - 2 * blend);
      if (!smooth) continue;
      // The neck smoothly meets the smaller skull; no cut/graft, old facial patch, or reversed face.
      point.sub(pivot).multiplyScalar(1 - .10 * smooth).add(pivot).applyMatrix4(inverse);
      position.setElement(i, point.toArray()); count++;
    }
    changed.push({ node: node.getName(), vertices: count, total: position.getCount() });
  }
}
if (!changed.some(item => item.vertices > 1000)) throw new Error('Head reduction did not affect the actual head geometry');
const motionsPath = join(ROOT, 'assets-src/generals-3d-2026-10-16/motions.glb');
const comboPath = join(ROOT, 'assets-src/generals-3d-2026-10-16/anim-v2/yi_joseon_dujeong.glb');
const motions = await io.read(motionsPath);
const combo = await io.read(comboPath);
for (const animation of doc.getRoot().listAnimations()) animation.dispose();
const results = [];
for (const [sourceDoc, clip, name] of [
  [motions, 'Idle_11', 'idle'],
  [combo, 'Triple_Combo_Attack', 'slash'],
  [motions, 'Sword_Parry', 'parry'],
  [motions, 'Sword_Shout', 'command'],
]) results.push(retargetGeneralMotion(doc, sourceDoc, { clip, name, rootMotion: name === 'idle' ? 'in-place' : 'bounded', maxTravel: .25, replace: true }));
const groundContact = groundGeneralMotions(doc, { clips: ['idle', 'slash', 'parry', 'command'] });
let hands = { status: 'not-yet-corrected' };
if (existsSync(join(ROOT, 'scripts/lib/close-general-hands.mjs'))) {
  const { closeGeneralHands } = await import('./lib/close-general-hands.mjs');
  hands = closeGeneralHands(doc);
}
// A rigid helmet has its own forward frame; never inherit the provider head joint's arbitrary rest axes.
const helmetAt = new Vector3(pivot.x, pivot.y + .145, pivot.z + .006);
const helmetWorld = new Matrix4().makeTranslation(...helmetAt.toArray());
const helmetLocal = new Matrix4().fromArray(head.getWorldMatrix()).invert().multiply(helmetWorld);
const ht = new Vector3(), hq = new Quaternion(), hs = new Vector3();
helmetLocal.decompose(ht, hq, hs);
head.addChild(doc.createNode('socket_helmet_brow').setTranslation(ht.toArray()).setRotation(hq.toArray()).setScale(hs.toArray()));
for (const scene of doc.getRoot().listScenes()) scene.setExtras({ ...scene.getExtras(), frontAxis: '+Z', generation: 'meshy-7.1-new-pilot', headScale: .90 });
const output = join(WORK, 'body_yi.glb');
await io.write(output, doc);
const report = {
  schema: 'imjin.regenerated-body-preparation.v1', source: { path: source, sha256: sha256(source) },
  geometryFromNewGenerationOnly: true, headScale: .90, headPivot: pivot.toArray(), helmetAt: helmetAt.toArray(), changed, hands,
  motionGeometryReused: false, motionSources: [motionsPath, comboPath].map(path => ({ path, sha256: sha256(path) })),
  motions: results.map(result => result.report), groundContact, output: { path: output, sha256: sha256(output) }, runtimeAccepted: false,
};
writeFileSync(join(WORK, 'body-preparation.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, headScale: .90, hands, animations: doc.getRoot().listAnimations().map(a => a.getName()) }));
