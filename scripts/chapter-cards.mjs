// Squadron portrait cards of the later chapters' ships, in the painterly style of the four 1592 cards
// (scripts/ai-assets.mjs card_*): gpt-image, 1024x1536 raws in assets-src/cards-chapters-2026-10-17/, cut to the
// 240x320 public/ui/cards/card_<kind>.jpg the squadron cards use. An existing raw is not generated again unless --force.
//   node scripts/chapter-cards.mjs [--only=reale,galea] [--force] [--convert] [--provider=gemini]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ENV = [join(ROOT, '.env'), 'C:/dev/imjin/.env'].find((p) => existsSync(p));
if (ENV) process.loadEnvFile(ENV);
const SRC = join(ROOT, 'assets-src', 'cards-chapters-2026-10-17');
const OUT = join(ROOT, 'public', 'ui', 'cards');
const PROV = join(SRC, 'provenance.json');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
const MODEL = args.model ?? 'gpt-image-2.5-sunburst';

// The 1592 cards' style line (scripts/ai-assets.mjs), with the palette kept and the subject changed per ship.
const STYLE = 'Painterly concept art card illustration, seen from a low dramatic angle, sailing through dark waves under cannon smoke. Muted ink-wash palette of deep teal, charcoal and ochre with gold and vermilion accents, visible brush strokes, aged silk texture, cinematic lighting, historically accurate rigging and flags, no text, no border, no frame.';
const CARDS = {
  racegalleon: 'An English race-built galleon of 1588 like the Ark Royal: a long low sleek hull with low castles, four masts with square sails painted with the red St George cross, green-and-white painted upper works.',
  spgalleon: 'A high-charged Spanish Armada galleon of 1588 like the San Martín: towering fore and stern castles, square sails with the red Cross of Burgundy, red and gold painted upper works.',
  galleass: 'A Neapolitan galleass of the Spanish Armada, 1588: a long galley hull with banks of oars, a high round bow castle with heavy guns, three lateen sails, red and black paint.',
  pinnace: 'A small fast English pinnace of 1588 with two masts of square sails and a St George flag, racing through spray.',
  fireship: 'An English fireship of 1588 at night, a small merchant ship burning from stem to stern with sails ablaze, drifting down on the wind.',
  urca: 'A round-bellied Baltic urca store ship of the Spanish Armada, 1588, broad and slow with square sails.',
  reale: 'La Real, the great flagship galley of Don John of Austria at Lepanto in 1571: a long low galley with thirty oars a side, a richly carved and gilded red-and-gold poop under an awning, the blue Holy League banner with a crucifix on the main lateen mast.',
  galea: 'A Venetian war galley (galea sottile) of 1571 rowing hard, long and low, red paint, a centre-line bow gun on the bow platform, lateen sails furled, the red banner of the Lion of Saint Mark.',
  vgalleass: 'A Venetian galleass at Lepanto in 1571: a heavy galley-built gun ship with a round bow castle firing a broadside of guns, oars out, three lateen masts, the Lion of Saint Mark banner.',
  sultana: 'The Sultana, Ali Pasha\'s Ottoman flagship galley at Lepanto in 1571: a long galley with a gilded poop under a green awning, the great green banner with a gold double-bladed sword, janissaries in tall white caps on deck (no star on any flag, crescents only).',
  kadirga: 'An Ottoman kadırga war galley of 1571 rowing fast, long and low, red and green paint, a lateen sail striped red and white, red flags with white crescents (no stars), archers in turbans on the bow.',
  kalyata: 'A small fast Ottoman corsair galiot (kalyata) of 1571 with one lateen mast and a single bank of oars, a red flag with a white crescent (no star), skimming low over the waves.',
  firstrate: 'HMS Victory at Trafalgar in 1805: a three-decker first-rate ship of the line, black hull with three yellow ochre bands along the rows of gun ports (the Nelson chequer) and black port lids, three masts under full square sails, the white ensign at the stern and the St George flag of a vice-admiral at the fore.',
  gb74: 'A British 74-gun ship of the line of 1805 (like HMS Bellerophon): two gun decks, black hull with two yellow ochre bands along the gun ports and black port lids, three masts of square sails, a white ensign, firing a broadside.',
  gbfrigate: 'A British 36-gun frigate of 1805 (like HMS Euryalus) under full sail, a single gun deck with a yellow ochre band and black port lids, signal flags flying from the mizzen, heeling in the wind.',
  fr80: 'The French 80-gun flagship Bucentaure at Trafalgar in 1805: two gun decks, black hull with a red-brown band along the gun ports, three masts of square sails, the French tricolour ensign at the stern.',
  fr74: 'The French 74-gun ship Redoutable at Trafalgar in 1805: two gun decks, black hull with a dull yellow band, musketeers in the fighting tops, the French tricolour ensign, wreathed in cannon smoke.',
  trinidad: 'The Spanish four-decker Santisima Trinidad of 1805, the largest warship in the world: four rows of gun ports on a dark red hull with black bands, three masts of square sails, the red and yellow Spanish naval ensign of 1785 at the stern.',
  es74: 'A Spanish 74-gun ship of the line of 1805 (like the San Juan Nepomuceno): two gun decks, black hull with dark red bands along the gun ports, three masts of square sails, the red and yellow Spanish naval ensign of 1785.',
};

mkdirSync(SRC, { recursive: true });
mkdirSync(OUT, { recursive: true });
const prov = existsSync(PROV) ? JSON.parse(readFileSync(PROV, 'utf8')) : { tool: 'scripts/chapter-cards.mjs', model: MODEL, size: '1024x1536', quality: 'high', style: STYLE, cards: {} };
const only = args.only ? args.only.split(',') : Object.keys(CARDS);
for (const kind of only) {
  const raw = join(SRC, `${kind}.webp`);
  if (args.convert !== 'true' && (args.force === 'true' || !existsSync(raw))) {
    const prompt = `${CARDS[kind]} ${STYLE}`;
    if (args.provider === 'gemini') {
      // Gemini's image model when the OpenAI images API is out of reach (scripts/gemini-image.mjs).
      const { geminiImage, geminiModel } = await import('./gemini-image.mjs');
      try {
        await sharp(await geminiImage(prompt, { aspect: '2:3' })).webp({ quality: 92 }).toFile(raw);
        prov.cards[kind] = { prompt, at: new Date().toISOString(), tool: 'gemini', model: geminiModel(), estimatedCostUsd: 0.04 };
        writeFileSync(PROV, JSON.stringify(prov, null, 2) + '\n');
        console.log('made', kind);
      } catch (err) { console.error(kind, String(err)); }
    } else {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt, size: '1024x1536', quality: 'high', n: 1, output_format: 'png' }),
    });
    const j = await res.json();
    if (!res.ok) { console.error(kind, res.status, j.error?.message); continue; }
    await sharp(Buffer.from(j.data[0].b64_json, 'base64')).webp({ quality: 92 }).toFile(raw);
    prov.cards[kind] = { prompt, at: new Date().toISOString(), estimatedCostUsd: 0.25 };
    writeFileSync(PROV, JSON.stringify(prov, null, 2) + '\n');
    console.log('made', kind);
    }
  }
  if (existsSync(raw)) await sharp(raw).resize(240, 320, { fit: 'cover' }).jpeg({ quality: 82, mozjpeg: true }).toFile(join(OUT, `card_${kind}.jpg`));
}
