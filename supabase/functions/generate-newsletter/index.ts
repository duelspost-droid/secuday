// secuday — 뉴스레터(Newsletter) 생성/수정 Edge Function
// 두 가지 모드로 동작하며, 어느 쪽이든 "초안 JSON"만 반환한다(DB에 직접 쓰지 않음).
// 관리자가 미리보기로 검토한 뒤 add_version(p_newsletter)으로 새 버전에 저장한다.
//
//   1) 생성  : body { month, material }            → web search로 최신 위협 반영 초안 작성
//   2) 수정  : body { month, material, current, instruction }
//                                                   → 기존 뉴스레터(current)를 instruction대로 수정
//
// 호출(테스트): POST /functions/v1/generate-newsletter
// 시크릿: ANTHROPIC_API_KEY (필수)
// verify_jwt=true 라 로그인한 임직원(Authorization: Bearer)만 호출 가능.

import Anthropic from "npm:@anthropic-ai/sdk@0.65.0";

const MODEL = "claude-opus-4-8";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// ---- 뉴스레터 구조 스키마 (Claude structured output) ----
const SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string", description: "뉴스레터/메일 제목 (예: '[정보보호의 날] 7월 — 휴가철 노린 스미싱 주의')" },
    intro: { type: "string", description: "도입 인사말(마크다운). 임직원 공지에 어울리는 1~2문단" },
    headlines: {
      type: "array",
      description: "이달의 보안 뉴스 카드 2~4건. 실제 보도된 사례 기반",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "뉴스 헤드라인(한 줄)" },
          summary: { type: "string", description: "핵심 요약 2~3문장과 우리 회사 관점 시사점" },
          source: { type: "string", description: "출처(매체명+시기, 예: '보안뉴스 2026.6')" },
          link: { type: "string", description: "원문 URL. 없으면 빈 문자열" },
        },
        required: ["title", "summary", "source", "link"],
        additionalProperties: false,
      },
    },
    deep_dive: {
      type: "object",
      description: "이달의 심층 분석 한 꼭지",
      properties: {
        heading: { type: "string", description: "분석 소제목" },
        body: { type: "string", description: "마크다운 본문. 위협 배경 + 임직원 대응" },
      },
      required: ["heading", "body"],
      additionalProperties: false,
    },
    tip: { type: "string", description: "이달의 보안 팁 또는 한 줄 퀴즈(실천 가능한 것)" },
    closing: { type: "string", description: "마무리 멘트 1~2문장" },
  },
  required: ["subject", "intro", "headlines", "deep_dive", "tip", "closing"],
  additionalProperties: false,
};

const SYSTEM_PROMPT =
  "당신은 금융회사 정보보호팀의 보안 인식(Security Awareness) 뉴스레터 편집자입니다. " +
  "회사는 매월 1일을 '정보보호의 날'로 지정하고 임직원에게 보안 인식 뉴스레터를 발송합니다. " +
  "임직원이 끝까지 읽도록 간결하고 명확하며 약간 친근한 한국어로, 실천 가능한 정보 중심으로 작성하세요. " +
  "보이스피싱, 스미싱, 랜섬웨어, 내부정보 유출, 공급망 공격, AI 딥페이크 등 최근 금융권 이슈를 반영합니다.";

function materialContext(material: any, monthLabel: string) {
  const cur = material?.current || {};
  return (
    `[이번 달 자료]\n` +
    `대상 월: ${monthLabel} (매월 1일 정보보호의 날)\n` +
    `제목: ${cur.title ?? ""}\n` +
    `테마: ${cur.theme ?? ""}\n` +
    `안내 내용:\n${cur.content ?? ""}\n\n` +
    `임직원 수칙:\n` +
    ((cur.rules || []).map((r: string) => `- ${r}`).join("\n") || "(없음)")
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST만 허용됩니다." }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다." }, 503);

  let body: { month?: string; material?: any; current?: any; instruction?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "잘못된 요청 형식입니다." }, 400);
  }

  const now = new Date();
  const month = body.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [yy, mm] = month.split("-");
  const monthLabel = `${yy}년 ${Number(mm)}월`;
  const isEdit = !!(body.current && body.instruction?.trim());

  const ctx = materialContext(body.material, monthLabel);

  // 모드별 프롬프트/도구 구성
  let userMessage: string;
  let tools: any[] | undefined;
  if (isEdit) {
    userMessage =
      `${ctx}\n\n[현재 뉴스레터(JSON)]\n${JSON.stringify(body.current, null, 2)}\n\n` +
      `[수정 요청]\n${body.instruction!.trim()}\n\n` +
      `위 뉴스레터를 요청대로 수정해 전체 뉴스레터를 다시 작성하세요. ` +
      `요청과 무관한 부분은 그대로 유지하세요.`;
  } else {
    userMessage =
      `${ctx}\n\n` +
      `${monthLabel} 정보보호의 날 임직원 보안 뉴스레터를 작성하세요. ` +
      `위 '이번 달 자료'의 테마를 중심에 두되, 최신 금융권 보안 위협을 web search로 보강해 ` +
      `실제 보도 사례 기반의 헤드라인 2~4건과 심층 분석 한 꼭지, 이달의 팁을 채우세요.`;
    tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }];
  }

  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      ...(tools ? { tools } : {}),
      messages: [{ role: "user", content: userMessage }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    } as any);
    const textBlock = (resp.content as any[]).find((b) => b.type === "text");
    const newsletter = JSON.parse(textBlock.text);
    return json({ ok: true, month, newsletter });
  } catch (e) {
    return json({ error: `뉴스레터 생성 실패: ${(e as any)?.message ?? e}` }, 502);
  }
});
