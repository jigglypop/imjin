// Draws the 1805 flags (geometric, from their statutory patterns) into the building atlas cache.
// node scripts/draw-1805-flags.mjs assets-src/textures-buildings/england, then ship-textures.mjs compose --set=buildings --faction=england
import sharp from 'sharp';
const dir = process.argv[2];
const S = 1024;
// Union Flag of 1801 (2:1 pattern squeezed into a square cell, as the other banners are): St George over the
// counterchanged saltires of St Andrew and St Patrick.
const B = '#012169', R = '#C8102E', W = '#FFFFFF';
const union = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 60 30" preserveAspectRatio="none">
<clipPath id="t"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z"/></clipPath>
<path d="M0,0 v30 h60 v-30 z" fill="${B}"/>
<path d="M0,0 L60,30 M60,0 L0,30" stroke="${W}" stroke-width="6"/>
<path d="M0,0 L60,30 M60,0 L0,30" clip-path="url(#t)" stroke="${R}" stroke-width="4"/>
<path d="M30,0 v30 M0,15 h60" stroke="${W}" stroke-width="10"/>
<path d="M30,0 v30 M0,15 h60" stroke="${R}" stroke-width="6"/></svg>`;
// French tricolour (1794 pattern): blue, white, red in equal vertical bands.
const tricolour = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><rect width="342" height="${S}" fill="#002654"/><rect x="341" width="342" height="${S}" fill="#fff"/><rect x="682" width="342" height="${S}" fill="#CE1126"/></svg>`;
// Spanish naval ensign of 1785: red, yellow (double width), red; the arms of Castile and Leon simplified to a crowned
// oval of two quarters near the hoist.
const spain = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><rect width="${S}" height="${S}" fill="#AA151B"/><rect y="256" width="${S}" height="512" fill="#F1BF00"/>
<g transform="translate(330,512)"><ellipse rx="95" ry="120" fill="#fff" stroke="#7a5a10" stroke-width="10"/>
<path d="M-95,0 A95,120 0 0 1 0,-120 V0 Z" fill="#AA151B"/><path d="M95,0 A95,120 0 0 1 0,120 V0 Z" fill="#AA151B"/>
<rect x="-62" y="-80" width="40" height="46" fill="#F1BF00"/><rect x="22" y="34" width="40" height="46" fill="#F1BF00"/>
<path d="M-90,-150 h180 l-15,-40 l-25,22 l-25,-35 l-25,35 l-25,-35 l-25,35 l-25,-22 z" fill="#F1BF00" stroke="#7a5a10" stroke-width="6"/></g></svg>`;
for (const [name, svg] of [['union1801', union], ['tricolour', tricolour], ['spain1785', spain]]) {
  await sharp(Buffer.from(svg)).resize(S, S).png().toFile(`${dir}/flags__${name}_1.png`);
}
