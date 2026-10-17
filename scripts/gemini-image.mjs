import sharp from 'sharp';

// One image from Google's Gemini image model (GEMINI_IMAGE_MODEL in .env), as a PNG buffer: from text, or an edit of
// `image` (a PNG buffer) by the text. The art scripts use it with --provider=gemini when the OpenAI images API is out of
// reach; `aspect` is Gemini's ratio string ('1:1', '3:2', ...).
export async function geminiImage(prompt, { aspect = '1:1', image = null } = {}) {
  const base = process.env.GEMINI_API_BASE ?? 'https://generativelanguage.googleapis.com/v1beta';
  const model = process.env.GEMINI_IMAGE_MODEL;
  if (!process.env.GEMINI_API_KEY || !model) throw new Error('GEMINI_API_KEY or GEMINI_IMAGE_MODEL missing (.env)');
  const parts = [{ text: prompt }];
  if (image) parts.push({ inlineData: { mimeType: 'image/png', data: Buffer.from(image).toString('base64') } });
  const res = await fetch(`${base}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } } }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`gemini ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  const out = (json.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData?.data);
  if (!out) throw new Error(`gemini returned no image: ${JSON.stringify(json).slice(0, 400)}`);
  return sharp(Buffer.from(out.inlineData.data, 'base64')).png().toBuffer();
}

export const geminiModel = () => process.env.GEMINI_IMAGE_MODEL;
