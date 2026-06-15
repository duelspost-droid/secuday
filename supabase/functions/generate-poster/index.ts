// secuday — 월간 포스터 자동 생성 Edge Function
// Claude(web search)로 최신 금융권 정보보호 위협을 조사해 이번 달 포스터 콘텐츠를 만들고,
// SVG 포스터를 조립해 Storage에 올린 뒤 자료(materials/versions)로 등록한다.
//
// 호출(테스트):  POST /functions/v1/generate-poster   body: { "month": "2026-07" }  (month 생략 시 이번 달)
// 매월 1일 자동 실행은 pg_cron에서 이 함수를 호출하도록 설정한다(2단계).
//
// 사용 시크릿: ANTHROPIC_API_KEY (이미 등록), SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (기본 제공)

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

// ---- 포스터 콘텐츠 스키마 (Claude structured output) ----
const SCHEMA = {
  type: "object",
  properties: {
    theme: { type: "string", description: "이번 달 핵심 주제 (짧게, 예: 'AI 보이스피싱')" },
    headline: { type: "string", description: "포스터 대표 문구. 한 줄당 12자 내외, 최대 2줄. 줄바꿈은 \\n" },
    message: { type: "string", description: "헤드라인을 뒷받침하는 한 문장(40자 내외)" },
    rules: { type: "array", items: { type: "string" }, description: "임직원 실천 수칙 3개 (각 25자 내외, 명령형)" },
    content: { type: "string", description: "메인 페이지용 상세 안내 (마크다운). 위협 배경 + 대응 방법 포함" },
  },
  required: ["theme", "headline", "message", "rules", "content"],
  additionalProperties: false,
};

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---- SVG 포스터 템플릿 ----
function buildSvg(c: { theme: string; headline: string; message: string; rules: string[] }, monthLabel: string) {
  const headlineLines = c.headline.split("\n").slice(0, 2);
  const headlineSvg = headlineLines
    .map((line, i) => `<text x="300" y="${360 + i * 64}" text-anchor="middle" fill="#ffd166" font-size="50" font-weight="800" font-family="'Apple SD Gothic Neo','Noto Sans KR',sans-serif">${esc(line)}</text>`)
    .join("\n  ");
  const rulesSvg = c.rules.slice(0, 3)
    .map((r, i) => `<text x="90" y="${600 + i * 46}" fill="#dbe7ff" font-size="22" font-family="'Apple SD Gothic Neo','Noto Sans KR',sans-serif">✓ ${esc(r)}</text>`)
    .join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0a1f47"/>
      <stop offset="1" stop-color="#12366f"/>
    </linearGradient>
  </defs>
  <rect width="600" height="800" fill="url(#bg)"/>
  <rect x="28" y="28" width="544" height="744" fill="none" stroke="#4f7fd9" stroke-width="2.5" rx="18"/>
  <text x="300" y="110" text-anchor="middle" fill="#9db9e8" font-size="22" font-family="'Apple SD Gothic Neo','Noto Sans KR',sans-serif">🛡️ 매월 1일 · 정보보호의 날</text>
  <text x="300" y="150" text-anchor="middle" fill="#ffffff" font-size="30" font-weight="700" font-family="'Apple SD Gothic Neo','Noto Sans KR',sans-serif">${esc(monthLabel)}</text>
  <text x="300" y="235" text-anchor="middle" font-size="92">🏦</text>
  <text x="300" y="290" text-anchor="middle" fill="#9db9e8" font-size="24" font-family="'Apple SD Gothic Neo','Noto Sans KR',sans-serif">금융권 보안 위협 주의</text>
  ${headlineSvg}
  <text x="300" y="470" text-anchor="middle" fill="#c8d6ef" font-size="22" font-family="'Apple SD Gothic Neo','Noto Sans KR',sans-serif">${esc(c.message)}</text>
  <rect x="60" y="555" width="480" height="170" fill="#ffffff10" rx="12"/>
  <text x="90" y="588" fill="#ffd166" font-size="20" font-weight="700" font-family="'Apple SD Gothic Neo','Noto Sans KR',sans-serif">임직원 실천 수칙</text>
  ${rulesSvg}
  <text x="300" y="760" text-anchor="middle" fill="#6f8fc4" font-size="16" font-family="'Apple SD Gothic Neo','Noto Sans KR',sans-serif">secuday.jbax.co.kr · 정보보호팀</text>
</svg>`;
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

  // 1) Claude로 최신 금융권 위협 기반 포스터 콘텐츠 생성 (web search)
  let content: any;
  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system:
        "당신은 금융회사 정보보호팀의 보안 인식 캠페인 전문가입니다. " +
        "최신(가능하면 해당 월 기준) 금융권 정보보호 위협 동향을 조사해, " +
        "임직원 대상 '정보보호의 날' 포스터에 쓸 콘텐츠를 한국어로 작성합니다. " +
        "실제로 최근 이슈가 되는 위협(보이스피싱, 스미싱, 랜섬웨어, 내부정보 유출, 공급망 공격, 딥페이크 등)을 반영하세요.",
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 } as any],
      messages: [{
        role: "user",
        content: `${monthLabel} 금융권 정보보호의 날 포스터 콘텐츠를 만들어 주세요. ` +
          `최신 금융권 보안 위협을 한 가지 핵심 주제로 잡고, 포스터 문구와 임직원 수칙을 작성하세요.`,
      }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    } as any);
    const textBlock = (resp.content as any[]).find((b) => b.type === "text");
    content = JSON.parse(textBlock.text);
  } catch (e) {
    return json({ error: `포스터 콘텐츠 생성 실패: ${(e as any)?.message ?? e}` }, 502);
  }

  // 2) SVG 포스터 조립
  const svg = buildSvg(content, monthLabel);
  const posterPath = `auto_${month}_${Date.now()}.svg`;

  // 3) Storage 업로드 + 4) 자료 등록 (service_role)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const up = await supabase.storage.from("posters").upload(posterPath, new Blob([svg], { type: "image/svg+xml" }), {
    contentType: "image/svg+xml",
    upsert: true,
  });
  if (up.error) return json({ error: `포스터 업로드 실패: ${up.error.message}` }, 502);

  const title = `${Number(mm)}월 정보보호의 날 — ${content.theme}`;
  // 같은 month 자료가 있으면 새 버전으로 업데이트, 없으면 신규 생성
  const { data: existing } = await supabase.from("materials").select("id").eq("month", month).maybeSingle();

  let result;
  if (existing) {
    const r = await supabase.rpc("add_version", {
      p_material_id: existing.id,
      p_title: title, p_theme: content.theme, p_content: content.content,
      p_rules: content.rules, p_poster_path: posterPath,
      p_change_note: "자동 생성(월간 갱신)", p_change_source: "ai",
    });
    result = r;
  } else {
    const r = await supabase.rpc("create_material", {
      p_month: month, p_title: title, p_theme: content.theme, p_content: content.content,
      p_rules: content.rules, p_poster_path: posterPath, p_change_note: "자동 생성",
    });
    result = r;
  }
  if (result.error) return json({ error: `자료 등록 실패: ${result.error.message}` }, 502);

  return json({ ok: true, month, title, theme: content.theme, poster_path: posterPath });
});
