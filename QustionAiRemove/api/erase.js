// Vercel 서버 함수: 사진(JPEG) 받기 → Gemini로 필기 제거 → 이미지 돌려주기
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-image';
const PROMPT =
  'This is a photo of a workbook page. Remove ALL handwriting: pen and pencil marks, underlines, circles, ' +
  'check marks, answers written by a person and scribbles. Keep every printed character, number, symbol, ' +
  'figure, table and the layout exactly as in the original; do not re-typeset, rewrite or alter any printed content. ' +
  'Fill erased areas with the clean paper background. Keep the same framing and aspect ratio. Output only the edited image.';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('POST only');
  let sent = '';
  try { sent = decodeURIComponent(req.headers['x-passcode'] || ''); } catch (e) {}
  if (process.env.APP_PASSCODE && sent !== process.env.APP_PASSCODE)
    return res.status(401).send('unauthorized');
  if (!process.env.GEMINI_API_KEY) return res.status(500).send('GEMINI_API_KEY not set');
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const input = Buffer.concat(chunks);
    if (!input.length) return res.status(400).send('empty');

    const body = JSON.stringify({
      contents: [{ parts: [
        { text: PROMPT },
        { inlineData: { mimeType: 'image/jpeg', data: input.toString('base64') } },
      ] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    });

    let out = null, lastErr = '';
    for (let t = 0; t < 3 && !out; t++) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY }, body }
      );
      if (r.ok) {
        const j = await r.json();
        const parts = j.candidates?.[0]?.content?.parts || [];
        const p = parts.find(x => x.inlineData || x.inline_data);
        const d = p && (p.inlineData || p.inline_data);
        if (d && d.data) out = d; else lastErr = 'no image returned';
      } else {
        lastErr = r.status + ' ' + (await r.text()).slice(0, 300);
        if (![429, 500, 503].includes(r.status)) break;
      }
      if (!out) await new Promise(s => setTimeout(s, 1500 * (t + 1)));
    }
    if (!out) return res.status(502).send('AI failed: ' + lastErr);
    res.setHeader('Content-Type', out.mimeType || out.mime_type || 'image/png');
    res.status(200).send(Buffer.from(out.data, 'base64'));
  } catch (e) {
    res.status(500).send('server error: ' + (e && e.message));
  }
};
