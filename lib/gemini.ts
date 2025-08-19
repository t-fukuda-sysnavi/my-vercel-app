const MODEL_MAIN = 'gemini-1.5-flash';
const MODEL_FALLBACK = 'gemini-1.5-flash-8b';

export async function callGemini({
  prompt, json, model = MODEL_MAIN, apiKey = process.env.GEMINI_API_KEY!,
}: { prompt: string; json: boolean; model?: string; apiKey?: string }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: json
      ? { responseMimeType: 'application/json', temperature: 0.9 }
      : { temperature: 0.8 },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
}

export async function callWithFallback(opts: { prompt: string; json: boolean }) {
  try {
    return await callGemini(opts);
  } catch {
    return await callGemini({ ...opts, model: MODEL_FALLBACK });
  }
}

export function extractJson(text: string) {
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  const t = s >= 0 && e > s ? text.slice(s, e + 1) : text;
  return JSON.parse(t);
}
