import { NextResponse } from 'next/server';
import pRetry from 'p-retry';
import { callWithFallback, extractJson } from '@/lib/gemini';
import { rate } from '@/lib/rate';

export const runtime = 'edge';

const cacheKey = 'options_v1';
let memo: any | null = null; let memoAt = 0;

function okJson(data: any) {
  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 's-maxage=21600, stale-while-revalidate=600', // 6h
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function GET(req: Request) {
  // レート制限（Edge）
  if (rate) {
    const ip = req.headers.get('x-forwarded-for') ?? 'anon';
    const { success } = await rate.limit(`options:${ip}`);
    if (!success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  // メモリキャッシュ（6h）
  if (memo && Date.now() - memoAt < 6 * 3600 * 1000) return okJson(memo);

  const prompt = `
あなたはクリエイティブなゲーム作家です。
5カテゴリの候補を日本語のJSONのみで返してください（説明禁止）。
{
  "heroes": ["..."],
  "stages": ["..."],
  "rules":  ["..."],
  "rivals": ["..."],
  "bosses": ["..."]
}
制約: 各5〜8件/重複なし/1件12〜20文字/ユーモア×ファンタジーのバランス/少しネットスラング入れる/「w」は禁止/毎回全部思考を変え新しい候補にする
`.trim();

  try {
    const raw = await pRetry(() => callWithFallback({ prompt, json: true }), { retries: 3, factor: 2, minTimeout: 300 });
    let data = extractJson(raw);
    const norm = (v: any) => Array.isArray(v) ? v.map(String).filter(Boolean) : [];
    data = {
      heroes: norm(data.heroes),
      stages: norm(data.stages),
      rules:  norm(data.rules),
      rivals: norm(data.rivals),
      bosses: norm(data.bosses),
    };
    if (!data.heroes.length) throw new Error('empty');

    memo = data; memoAt = Date.now();
    return okJson(data);
  } catch(e) {
    const fallback = {
      heroes: [e],
      stages: ['空に浮かぶ都市', '夜だけ光る図書館', '巨大パンケーキの島'],
      rules:  ['感情で魔法が変わる', '時間が逆に流れる', '音を立てると物が動く'],
      rivals: ['冷徹な剣士', 'お菓子を盗む忍者リス', '異世界の自分'],
      bosses: ['時を止める王', '巨大な樹木の怪物', 'カレーを愛するドラゴン'],
    };
    return okJson(fallback);
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
    },
  });
}
