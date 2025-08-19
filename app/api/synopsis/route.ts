import { NextResponse } from 'next/server';
import { z } from 'zod';
import pRetry from 'p-retry';
import { callWithFallback } from '@/lib/gemini';
import { rate } from '@/lib/rate';

export const runtime = 'edge';

const Req = z.object({
  hero: z.string().min(1).max(50),
  stage: z.string().min(1).max(50),
  rule: z.string().min(1).max(50),
  rival: z.string().min(1).max(50),
  boss: z.string().min(1).max(50),
  minChars: z.number().int().min(200).max(800).optional(),
  maxChars: z.number().int().min(200).max(1200).optional(),
});

function cors(res: any) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  return res;
}

export async function POST(req: Request) {
  if (rate) {
    const ip = req.headers.get('x-forwarded-for') ?? 'anon';
    const { success } = await rate.limit(`synopsis:${ip}`);
    if (!success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const json = await req.json().catch(() => ({}));
  const parsed = Req.safeParse(json);
  if (!parsed.success) {
    return cors(NextResponse.json({ error: 'invalid_request' }, { status: 400 }));
  }
  const { hero, stage, rule, rival, boss, minChars = 300, maxChars = 450 } = parsed.data;

  const prompt = `
以下の設定から、日本語の「作品あらすじ」を1つ生成してください。
- 主人公: ${hero}
- 舞台: ${stage}
- 世界観ルール: ${rule}
- ライバル: ${rival}
- ボス: ${boss}

要件:
- 文字数はおおよそ${minChars}〜${maxChars}文字
- 起承転結を明確に
- 固有名詞は2〜3個まで
- 本文のみ（ヘッダーや注釈は不要）
`.trim();

  try {
    const text = await pRetry(
      () => callWithFallback({ prompt, json: false }),
      { retries: 3, factor: 2, minTimeout: 300 },
    );
    return cors(NextResponse.json({ synopsis: text || '（生成に失敗しました）' }));
  } catch {
    return cors(NextResponse.json(
      { error: 'model_overloaded', message: 'しばらくしてから再試行してください' },
      { status: 503 },
    ));
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
    },
  });
}
