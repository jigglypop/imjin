import { abs, dot, floor, fract, mix, mx_noise_float, normalLocal, positionGeometry, select, sin, smoothstep, step, time, vec3, float } from 'three/tsl';

/**
 * Film-prop weathering for the procedural ships: what a navy that has been at sea all summer looks like next to the
 * clean atlas. Everything is driven by the position on the ship (positionGeometry, so it stays put as the hull rocks),
 * the surface class, the baked soot amount and the height above the waterline. `detail` off drops the fine noise for
 * phones.
 */

const hash = (x: any) => fract(sin(x.mul(12.9898).add(78.233)).mul(43758.5453));
const luma = (c: any) => dot(c, vec3(0.299, 0.587, 0.114));
const desat = (c: any, keep: number) => mix(vec3(luma(c)), c, float(keep));
const oneMinus = (x: any) => float(1).sub(x);

export type WeatherIn = {
  /** Atlas colour times vertex tint (baked AO already in it). */
  color: any;
  /** Surface class: 0 wood, 1 sail cloth, 2 metal, 3 lacquer, 4 banner, 5 ember (glows, see emberGlow). */
  surf: any;
  soot: any;
  /** Height above the waterline in ship space, m. */
  shipY: any;
  rough: any;
  detail: boolean;
};

export function weather({ color, surf, soot, shipY, rough, detail }: WeatherIn): { color: any; rough: any } {
  const P: any = positionGeometry;
  const N: any = normalLocal;
  const isSail = surf.equal(1);
  const isMetal = surf.equal(2);
  const isGloss = surf.equal(3);
  const isBanner = surf.equal(4);

  const n1 = mx_noise_float(P.mul(1.6)).mul(0.5).add(0.5);
  const n2 = detail ? mx_noise_float(P.mul(7.3)).mul(0.5).add(0.5) : n1;
  // Distance along the surface's horizontal direction: x on the sides and roofs, z on the bow and stern.
  const run = select(abs(N.x).greaterThan(abs(N.z)), P.z, P.x);
  // Long vertical streaks: tannin and rust running down from nails and fittings.
  const streak = detail ? mx_noise_float(vec3(run.mul(2.3), P.y.mul(0.2), P.x.mul(0.1).add(P.z.mul(0.1)))).mul(0.5).add(0.5) : n1;

  // Planks: every board a little lighter, darker, warmer or greyer than its neighbours, butt joints staggered.
  const flat = abs(N.y).greaterThan(0.7);
  const row = floor(select(flat, P.z, P.y).mul(4));
  const butt = floor(run.add(hash(row).mul(3)).mul(0.42));
  const pv = hash(row.mul(7.13).add(butt.mul(3.71)));
  const plank = mix(vec3(0.72, 0.68, 0.64), vec3(1.16, 1.07, 0.95), pv);
  const bleach = smoothstep(0.35, 0.8, n1).mul(smoothstep(1.2, 4, shipY)).mul(0.4);
  // Weathered pine and oak: the atlas wood is dark, so it is lifted and warmed toward a grey-brown (never red).
  let wood: any = desat(color, 0.6).mul(vec3(1.5, 1.34, 1.12)).mul(plank).mul(mix(float(0.8), float(1.06), streak));
  wood = mix(wood, vec3(luma(wood).mul(1.25).add(0.03)), bleach);

  // Lacquer: worn to a deep red-brown or sooty black, chipped to bare wood, hazed with salt.
  const wear = n2.mul(0.55).add(n1.mul(0.45));
  // Phones skip the fine noise, so chips and rust would only show as big soft blotches there: leave them out.
  const chips = detail ? smoothstep(0.68, 0.73, wear) : float(0);
  const haze = smoothstep(0.45, 0.9, n1.mul(0.6).add(streak.mul(0.4)));
  // Worn lacquer reads as dark weathered timber, not black plastic: lifted, and kept out of the reds.
  let lac: any = desat(color, 0.7).mul(vec3(1.4, 1.28, 1.14));
  lac = mix(lac, vec3(0.13, 0.095, 0.07).mul(n2.mul(0.5).add(0.75)), chips.mul(0.75));
  lac = mix(lac, vec3(luma(lac).add(0.1)).mul(vec3(0.9, 0.92, 0.95)), haze.mul(detail ? 0.22 : 0.08).mul(oneMinus(smoothstep(0.05, 0.3, luma(lac)).mul(0.6))));

  // Metal: darkened, with orange-brown rust where the streaks are strong.
  const rust = smoothstep(0.58, 0.82, streak.mul(0.65).add(n2.mul(0.35)));
  let met: any = desat(color, 0.7).mul(0.72);
  met = mix(met, vec3(0.2, 0.1, 0.055).mul(n2.mul(0.6).add(0.7)), rust.mul(detail ? 0.7 : 0.25));

  // Sails: dirty hemp, tide-stained streaks, patches of newer or older cloth.
  const stain = smoothstep(0.52, 0.85, streak);
  const patch = step(0.9, hash(floor(P.z.mul(0.85)).mul(13.1).add(floor(P.y.mul(1.1)).mul(5.7)).add(floor(P.x.mul(0.8)).mul(2.3))));
  let sail: any = desat(color, 0.62).mul(vec3(0.9, 0.86, 0.8));
  sail = mix(sail, sail.mul(vec3(0.62, 0.52, 0.4)), stain.mul(0.6));
  sail = mix(sail, sail.mul(vec3(0.78, 0.74, 0.66)), patch.mul(0.5));

  // Banners keep their colours, a little faded and dirty.
  const banner: any = desat(color, 0.64).mul(0.84).mul(mix(float(1), float(0.72), stain.mul(0.5)));

  let out: any = select(isGloss, lac, select(isMetal, met, select(isSail, sail, select(isBanner, banner, select(surf.equal(5), color, wood)))));

  // Soot around the guns: a patchy scorch rather than a smooth gradient.
  const scorch = smoothstep(0.1, 0.75, soot.add(n2.sub(0.5).mul(0.7))).mul(soot.mul(1.4).min(1));
  out = mix(out, out.mul(vec3(0.2, 0.18, 0.17)), scorch.mul(0.85));

  // Waterline: a tar-dark band, slime and weed at the water, a pale tide line, wet timber above fading out by a metre.
  const h = shipY.add(n1.sub(0.5).mul(0.3));
  const tar = oneMinus(smoothstep(0.28, 0.5, h));
  out = mix(out, vec3(0.05, 0.042, 0.034).mul(luma(out).mul(2).add(0.6)), tar.mul(0.78));
  const wetK = oneMinus(smoothstep(0.4, 1.15, h));
  out = out.mul(mix(float(1), float(0.84), wetK.mul(oneMinus(tar))));
  const tide = smoothstep(0.5, 0.6, h).mul(oneMinus(smoothstep(0.66, 0.8, h))).mul(n2);
  out = mix(out, vec3(luma(out).add(0.22)), tide.mul(0.22));
  const slime = smoothstep(-0.6, -0.1, h).mul(oneMinus(smoothstep(0.05, 0.4, h))).mul(n2.mul(0.7).add(0.3));
  out = mix(out, vec3(0.05, 0.075, 0.035).mul(n2.add(0.6)), slime.mul(0.5));
  out = mix(out, vec3(0.04, 0.06, 0.03).mul(n2.add(0.5)), oneMinus(smoothstep(-0.9, -0.1, h)).mul(0.85));

  // Roughness: lacquer dulls where it is chipped, wet timber and tar shine, soot is matt.
  let r: any = select(isGloss, rough.mul(0.9).max(0.4).add(chips.mul(0.35)), select(isMetal, rough.mul(0.85).add(rust.mul(0.2)), rough));
  r = mix(r, float(0.32), wetK.mul(0.55));
  r = mix(r, float(0.9), scorch.mul(0.7));
  return { color: out, rough: r };
}

/** Light given off by ember surfaces (the dragon's throat and eyes): a slow flicker, brighter deeper in. */
export function emberGlow(surf: any, tint: any) {
  const P: any = positionGeometry;
  const flicker = mx_noise_float(vec3(P.x.mul(1.1), P.y.mul(1.1), P.z.mul(1.1)).add(vec3(0, 0, time.mul(1.7)))).mul(0.5).add(0.5);
  return select(surf.equal(5), tint.mul(flicker.mul(0.9).add(0.7)).mul(1.2), vec3(0));
}
