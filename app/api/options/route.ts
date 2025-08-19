import { NextResponse } from 'next/server';
import pRetry from 'p-retry';
import { callWithFallback, extractJson } from '@/lib/gemini';
import { rate } from '@/lib/rate';

export const runtime = 'edge';

const cacheKey = 'options_v1';
let memo: any | null = null;
let memoAt = 0;

function okJson(data: any, cache = true) {
  return NextResponse.json(data, {
    headers: {
      ...(cache
        ? { 'Cache-Control': 's-maxage=21600, stale-while-revalidate=600' } // 6h
        : { 'Cache-Control': 'no-store' }),
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function fallbackData() {
  return {
    heroes: ['未来から来た配達員', '記憶を失った猫探偵', '銀髪の錬金術師'],
    stages: ['空に浮かぶ都市', '夜だけ光る図書館', '巨大パンケーキの島'],
    rules:  ['感情で魔法が変わる', '時間が逆に流れる', '音を立てると物が動く'],
    rivals: ['冷徹な剣士', 'お菓子を盗む忍者リス', '異世界の自分'],
    bosses: ['時を止める王', '巨大な樹木の怪物', 'カレーを愛するドラゴン'],
  };
}

export async function GET(req: Request) {
  // 0) まずキー確認（ここで null/空なら即フォールバック）
  const key = process.env.GEMINI_API_KEY ?? '';
  if (!key) {
    console.warn('[options] GEMINI_API_KEY is missing');
    return okJson(fallbackData(), false);
  }

  // 1) レート制限（任意）
  if (rate) {
    const ip = req.headers.get('x-forwarded-for') ?? 'anon';
    const { success } = await rate.limit(`options:${ip}`);
    if (!success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  // 2) メモリキャッシュ（6h）
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
制約: 各5〜8件/重複なし/1件12〜20文字/ユーモア×ファンタジーのバランス
`.trim();

  try {
    // 3) リトライ時に「何が失敗したのか」をログする
    const raw = await pRetry(
      () => callWithFallback({ prompt, json: true }),
      {
        retries: 3,
        factor: 2,
        minTimeout: 300,
        onFailedAttempt: (e) => {
          // ここに本当のエラー内容が入る
          // @ts-ignore - edge log
          console.warn('[options] retry failed:', e.message, {
            attemptNumber: e.attemptNumber,
            retriesLeft: e.retriesLeft,
          });
        },
      },
    );

    // 4) JSONパースは安全に
    let data: any;
    try {
      data = extractJson(raw);
    } catch (e) {
      console.warn('[options] JSON parse failed, raw:', raw.slice(0, 200));
      return okJson(fallbackData(), false);
    }

    const norm = (v: any) => Array.isArray(v) ? v.map(String).filter(Boolean) : [];
    data = {
      heroes: norm(data.heroes),
      stages: norm(data.stages),
      rules:  norm(data.rules),
      rivals: norm(data.rivals),
      bosses: norm(data.bosses),
    };
    if (!data.heroes.length) {
      console.warn('[options] empty result from model');
      return okJson(fallbackData(), false);
    }

    memo = data;
    memoAt = Date.now();
    return okJson(data);
  } catch (e: any) {
    // p-retryの最終例外（RetryError）をここで受ける
    console.error('[options] final failure:', e?.message ?? e);
    return okJson(fallbackData(), false); // 失敗してもUIは動かす
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
