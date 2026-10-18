// A quiet wardrobe pose authored from the character's own bind transforms. No provider calls or geometry changes.
// The Tripo preset idle rotates this figure's feet by more than 130 degrees from bind; it is not suitable for fit review.
import { Quaternion, Vector3 } from 'three';

export function setWardrobeIdle(doc) {
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  if (!skin) throw new Error('A wardrobe stance requires the body skeleton.');
  const joints = skin.listJoints();
  const byName = new Map(joints.map((joint) => [joint.getName(), joint]));
  const rotations = new Map(joints.map((joint) => [joint, joint.getRotation()]));
  for (const [name, degrees] of [['L_Upperarm', -70], ['R_Upperarm', 70]]) {
    const joint = byName.get(name);
    if (!joint) throw new Error(`A wardrobe stance requires ${name}.`);
    const parent = joint.getParentNode();
    const above = parent ? new Quaternion(...parent.getWorldRotation()).normalize() : new Quaternion();
    const world = new Quaternion(...joint.getWorldRotation()).normalize();
    const lowered = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), degrees * Math.PI / 180).multiply(world);
    rotations.set(joint, above.invert().multiply(lowered).normalize().toArray());
  }
  for (const clip of root.listAnimations()) if (clip.getName().toLowerCase().includes('idle')) clip.dispose();
  const buffer = root.listBuffers()[0] ?? doc.createBuffer();
  const times = doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0, 4])).setBuffer(buffer);
  const idle = doc.createAnimation('idle');
  function channel(joint, path, values) {
    const output = doc.createAccessor().setType(path === 'rotation' ? 'VEC4' : 'VEC3')
      .setArray(new Float32Array([...values, ...values])).setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(times).setOutput(output).setInterpolation('LINEAR');
    idle.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(joint).setTargetPath(path).setSampler(sampler));
  }
  for (const joint of joints) {
    // Keeping all rest channels ensures a completed slash settles into this pose without displaced hips or twisted soles.
    channel(joint, 'translation', joint.getTranslation());
    channel(joint, 'rotation', rotations.get(joint));
    channel(joint, 'scale', joint.getScale());
  }
  return { source: 'body bind transforms', durationSeconds: 4, loweredShouldersDegrees: 70, joints: joints.length };
}
