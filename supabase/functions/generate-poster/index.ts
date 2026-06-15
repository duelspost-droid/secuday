// secuday — 월간 보안 인식 양식(A4) 자동 생성 Edge Function
// Claude(web search)로 최신 금융권 정보보호 위협 + 관련 기사 발췌/시사점을 조사하고,
// A4 문서형 SVG(기사 발췌 → 그림 → 임직원 수칙)를 만들어 Storage에 올린 뒤 자료로 등록한다.
//
// 호출(테스트):  POST /functions/v1/generate-poster   body: { "month": "2026-07" }
// 매월 1일 자동 실행은 pg_cron에서 이 함수를 호출하도록 설정한다(2단계).

import Anthropic from "npm:@anthropic-ai/sdk@0.65.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = "claude-opus-4-8";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// ---- 양식 콘텐츠 스키마 (Claude structured output) ----
const SCHEMA = {
  type: "object",
  properties: {
    theme: { type: "string", description: "이번 달 핵심 주제 (짧게, 예: 'AI 딥페이크 사칭 사기')" },
    article_excerpt: { type: "string", description: "최신 보안 기사 원본에서 발췌한 핵심 문장(2~3문장, 실제 보도 내용 기반)" },
    article_source: { type: "string", description: "발췌 출처 (매체명 + 시기, 예: '보안뉴스 2026.6')" },
    implication: { type: "string", description: "이 기사가 우리 회사에 주는 시사점(1~2문장)" },
    illustration_emoji: { type: "string", description: "주제를 표현하는 대표 이모지 1개 (예: 🎭, 🎣, 🔐)" },
    illustration_caption: { type: "string", description: "그림 아래 한 줄 설명(20자 내외)" },
    rules: { type: "array", items: { type: "string" }, description: "임직원 실천 수칙 4개 (각 30자 내외, 명령형)" },
    content: { type: "string", description: "메인 페이지용 상세 안내(마크다운). 위협 배경 + 대응 방법" },
  },
  required: ["theme", "article_excerpt", "article_source", "implication", "illustration_emoji", "illustration_caption", "rules", "content"],
  additionalProperties: false,
};

function esc(s: string) {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// 한글 글자수 기준 줄바꿈
function wrapText(text: string, max: number): string[] {
  const out: string[] = [];
  for (const para of (text ?? "").split("\n")) {
    let line = "";
    for (const ch of para) {
      line += ch;
      if (line.length >= max) { out.push(line); line = ""; }
    }
    out.push(line);
  }
  return out;
}

// ---- A4 문서형 SVG 양식 ----
function buildSvg(
  c: { theme: string; article_excerpt: string; article_source: string; implication: string; illustration_emoji: string; illustration_caption: string; rules: string[] },
  monthLabel: string,
) {
  const W = 595, H = 842;
  const FONT = "'Apple SD Gothic Neo','Noto Sans KR',sans-serif";
  const parts: string[] = [];
  const T = (x: number, y: number, s: string, size: number, fill: string, opts = "") =>
    `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-family="${FONT}" ${opts}>${esc(s)}</text>`;
  // 여러 줄 텍스트 → 다음 y 반환
  const block = (x: number, y: number, lines: string[], size: number, fill: string, lh: number, opts = "") => {
    lines.forEach((ln, i) => parts.push(T(x, y + i * lh, ln, size, fill, opts)));
    return y + lines.length * lh;
  };

  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  // 헤더 바
  parts.push(`<rect x="0" y="0" width="${W}" height="78" fill="#0a2a5c"/>`);
  parts.push(T(34, 40, "🛡 secuday · 정보보호의 날", 21, "#ffffff", 'font-weight="700"'));
  parts.push(T(34, 63, "매월 1일, 금융권 보안 인식 자료", 13, "#9db9e8"));
  parts.push(T(W - 34, 48, monthLabel, 22, "#ffd166", 'text-anchor="end" font-weight="800"'));

  // 주제 타이틀
  let y = 120;
  y = block(34, y, wrapText(c.theme, 22), 26, "#0a2a5c", 34, 'font-weight="800"') + 6;
  parts.push(`<line x1="34" y1="${y}" x2="${W - 34}" y2="${y}" stroke="#dde3ec" stroke-width="1.5"/>`);
  y += 34;

  // 섹션 1 — 이달의 보안 이슈 (기사 발췌)
  parts.push(`<rect x="34" y="${y - 18}" width="150" height="26" rx="13" fill="#1a56db"/>`);
  parts.push(T(46, y, "📰 이달의 보안 이슈", 14, "#ffffff", 'font-weight="700"'));
  y += 24;
  const exLines = wrapText(c.article_excerpt, 32);
  const boxH = exLines.length * 24 + 28;
  parts.push(`<rect x="34" y="${y}" width="${W - 68}" height="${boxH}" rx="10" fill="#f1f4f9"/>`);
  parts.push(`<rect x="34" y="${y}" width="5" height="${boxH}" rx="2" fill="#1a56db"/>`);
  let ty = y + 28;
  ty = block(52, ty, exLines, 15, "#28324a", 24, 'font-style="italic"');
  y += boxH + 4;
  y = block(W - 34, y + 14, [`— ${c.article_source}`], 12, "#8a93a6", 16, 'text-anchor="end"') + 6;
  y = block(34, y + 6, wrapText("💡 시사점  " + c.implication, 36), 14, "#0a2a5c", 22, 'font-weight="600"') + 22;

  // 섹션 2 — 그림
  parts.push(`<rect x="34" y="${y - 18}" width="120" height="26" rx="13" fill="#7c3aed"/>`);
  parts.push(T(46, y, "🔎 한눈에 보기", 14, "#ffffff", 'font-weight="700"'));
  y += 16;
  parts.push(`<rect x="34" y="${y}" width="${W - 68}" height="150" rx="10" fill="#faf7ff" stroke="#e7ddff" stroke-width="1.5"/>`);
  parts.push(T(W / 2, y + 92, c.illustration_emoji, 70, "#000", 'text-anchor="middle"'));
  parts.push(T(W / 2, y + 132, c.illustration_caption, 16, "#5b3da8", 'text-anchor="middle" font-weight="600"'));
  y += 150 + 30;

  // 섹션 3 — 임직원 수칙
  parts.push(`<rect x="34" y="${y - 18}" width="150" height="26" rx="13" fill="#047857"/>`);
  parts.push(T(46, y, "✅ 임직원 보안 수칙", 14, "#ffffff", 'font-weight="700"'));
  y += 20;
  const rulesBoxTop = y;
  let ry = y + 30;
  c.rules.slice(0, 4).forEach((r) => {
    const lines = wrapText(r, 40);
    parts.push(T(54, ry, "✓", 16, "#047857", 'font-weight="800"'));
    ry = block(74, ry, lines, 15, "#1f2937", 23) + 8;
  });
  const rulesBoxH = ry - rulesBoxTop;
  parts.splice(parts.length - (c.rules.slice(0, 4).reduce((n, r) => n + wrapText(r, 40).length, 0) + c.rules.slice(0, 4).length * 1), 0,
    `<rect x="34" y="${rulesBoxTop}" width="${W - 68}" height="${rulesBoxH}" rx="10" fill="#f0faf5"/>`);

  // 푸터
  parts.push(T(W / 2, H - 26, "secuday.jbax.co.kr · 정보보호팀 — 본 자료는 자동 생성되었습니다", 12, "#9aa3b2", 'text-anchor="middle"'));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST만 허용됩니다." }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY가 설정되지 않았습니다." }, 503);

  const body = await req.json().catch(() => ({}));
  const now = new Date();
  const month: string = body.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [yy, mm] = month.split("-");
  const monthLabel = `${yy}년 ${Number(mm)}월`;

  let content: any;
  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system:
        "당신은 금융회사 정보보호팀의 보안 인식 캠페인 담당자입니다. " +
        "최신(가능하면 해당 월 기준) 금융권 정보보호 위협을 web search로 조사해, " +
        "임직원 대상 '정보보호의 날' A4 안내 양식에 들어갈 콘텐츠를 한국어로 작성합니다. " +
        "실제 보도된 기사·사례를 근거로 발췌문과 출처를 만들고, 회사 관점의 시사점과 실천 수칙을 작성하세요. " +
        "보이스피싱, 스미싱, 랜섬웨어, 내부정보 유출, 공급망 공격, AI 딥페이크 등 최근 이슈를 반영하세요.",
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 } as any],
      messages: [{
        role: "user",
        content: `${monthLabel} 금융권 정보보호의 날 안내 양식 콘텐츠를 만들어 주세요. ` +
          `최신 금융권 보안 위협 한 가지를 핵심 주제로 잡고, 실제 기사 발췌·출처·시사점·임직원 수칙을 작성하세요.`,
      }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    } as any);
    const textBlock = (resp.content as any[]).find((b) => b.type === "text");
    content = JSON.parse(textBlock.text);
  } catch (e) {
    return json({ error: `콘텐츠 생성 실패: ${(e as any)?.message ?? e}` }, 502);
  }

  const svg = buildSvg(content, monthLabel);
  const posterPath = `auto_${month}_${Date.now()}.svg`;

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const up = await supabase.storage.from("posters").upload(posterPath, new Blob([svg], { type: "image/svg+xml" }), {
    contentType: "image/svg+xml", upsert: true,
  });
  if (up.error) return json({ error: `양식 업로드 실패: ${up.error.message}` }, 502);

  const title = `${Number(mm)}월 정보보호의 날 — ${content.theme}`;
  const { data: existing } = await supabase.from("materials").select("id").eq("month", month).maybeSingle();

  let result;
  if (existing) {
    result = await supabase.rpc("add_version", {
      p_material_id: existing.id, p_title: title, p_theme: content.theme, p_content: content.content,
      p_rules: content.rules, p_poster_path: posterPath, p_change_note: "자동 생성(월간 갱신)", p_change_source: "ai",
    });
  } else {
    result = await supabase.rpc("create_material", {
      p_month: month, p_title: title, p_theme: content.theme, p_content: content.content,
      p_rules: content.rules, p_poster_path: posterPath, p_change_note: "자동 생성",
    });
  }
  if (result.error) return json({ error: `자료 등록 실패: ${result.error.message}` }, 502);

  return json({ ok: true, month, title, theme: content.theme, poster_path: posterPath });
});
