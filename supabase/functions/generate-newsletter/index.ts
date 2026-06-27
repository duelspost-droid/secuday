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
import { createClient } from "npm:@supabase/supabase-js@2";

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
    format: { type: "string", description: "뉴스레터 표현 포맷: comic|card|standard|onepager|infographic 중 하나(요청된 포맷을 그대로 둔다)" },
    cover_emoji: { type: "string", description: "뉴스레터 대표 이모지 1개(이달 주제 상징, 예: 🛡️ 🎣 🔐 🎭)" },
    alert: { type: "string", description: "상단 경고 배너 한 줄(이달 위협의 핵심 경고, 예: '아는 얼굴·목소리도 가짜일 수 있습니다')" },
    stats: {
      type: "array",
      description: "경각심을 주는 핵심 수치 정확히 3개(헤드라인의 실제 수치 기반: 피해액·유출 규모·과징금 등)",
      items: {
        type: "object",
        properties: {
          value: { type: "string", description: "큰 수치 (예: '6,246억 원', '3,750만 명', '58억 원')" },
          label: { type: "string", description: "수치 설명 12자 내외 (예: '역대 최대 과징금')" },
        },
        required: ["value", "label"],
        additionalProperties: false,
      },
    },
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
          emoji: { type: "string", description: "이 뉴스 주제에 어울리는 이모지 1개 (예: 🎣 🔐 🎭 💸 📵)" },
          category: { type: "string", description: "아이콘 분류 — 다음 중 하나: deepfake|voice|phishing|supplychain|insider|ransomware|vuln|dataleak|general" },
        },
        required: ["title", "summary", "source", "link", "emoji", "category"],
        additionalProperties: false,
      },
    },
    deep_dive: {
      type: "object",
      description: "이달의 심층 분석 한 꼭지",
      properties: {
        heading: { type: "string", description: "분석 소제목" },
        body: { type: "string", description: "마크다운 본문. 위협 배경 + 임직원 대응" },
        emoji: { type: "string", description: "심층 분석 주제를 상징하는 이모지 1개" },
      },
      required: ["heading", "body", "emoji"],
      additionalProperties: false,
    },
    tip: { type: "string", description: "이달의 보안 팁 한 줄(요약용)" },
    tips: { type: "array", description: "임직원 실천 보안 수칙 4~5개(각 30~45자, 명령형·구체적)", items: { type: "string" } },
    closing: { type: "string", description: "마무리 멘트 1~2문장" },
    comic: {
      type: "object",
      description: "format이 'comic'일 때 채울 4컷 만화 데이터(다른 포맷이면 생략 가능)",
      properties: {
        panels: {
          type: "array",
          description: "정확히 4컷. 서사: 상황→함정→피해→수칙(마지막 컷은 안전한 해결).",
          items: {
            type: "object",
            properties: {
              scene: { type: "string", description: "장면 키: phone-call|phone-pressure|email-phishing|link-trap|money-loss|data-leak|ransomware-lock|hacker|shield-verify|double-check 중 가장 적합한 것" },
              mood: { type: "string", description: "인물 표정: neutral|worried|shocked|relieved" },
              speaker: { type: "string", description: "말풍선 화자(예: 사칭범, 직원, 동료)" },
              speech: { type: "string", description: "말풍선 대사 한 문장(짧은 구어체)" },
              caption: { type: "string", description: "컷 하단 narration 캡션 한 문장" },
            },
            required: ["scene", "mood", "speaker", "speech", "caption"],
            additionalProperties: false,
          },
        },
      },
      required: ["panels"],
      additionalProperties: false,
    },
    infographic: {
      type: "object",
      description: "format이 'infographic'일 때 채울 시각화 데이터(다른 포맷이면 생략 가능)",
      properties: {
        donut: { type: "object", description: "핵심 비율 1개(예: 초기 침투 중 피싱 비중)", properties: { value: { type: "string", description: "예 '38%'" }, label: { type: "string", description: "도넛 안 짧은 라벨" }, caption: { type: "string", description: "도넛 아래 한 줄 설명" } }, required: ["value", "label"], additionalProperties: false },
        file_types: { type: "array", description: "악성 첨부 파일 형식 비율 1~3개(예: HTML 25%)", items: { type: "object", properties: { label: { type: "string" }, pct: { type: "string" } }, required: ["label", "pct"], additionalProperties: false } },
        note: { type: "object", description: "보조 노트 한 꼭지(예: 다크웹 유출 심화)", properties: { title: { type: "string" }, body: { type: "string" } }, required: ["title", "body"], additionalProperties: false },
        stages: { type: "array", description: "공격 단계 게이지 3개(상→하 심각도)", items: { type: "object", properties: { stage: { type: "string", description: "예 '1단계 · 초기 침투'" }, name: { type: "string", description: "예 'Phishing'" }, value: { type: "string", description: "예 '2.3'" }, max: { type: "number", description: "게이지 최대값(기본 3)" }, tone: { type: "string", description: "danger|warn|ok" }, sub: { type: "string", description: "예 '최고치'" } }, required: ["stage", "name", "value", "tone"], additionalProperties: false } },
        damage: { type: "object", description: "피해 규모 콜아웃", properties: { label: { type: "string" }, value: { type: "string", description: "예 '1조 1,330억 원'" }, note: { type: "string" } }, required: ["value"], additionalProperties: false },
      },
      required: ["donut"],
      additionalProperties: false,
    },
  },
  required: ["subject", "format", "cover_emoji", "alert", "stats", "intro", "headlines", "deep_dive", "tip", "tips", "closing"],
  additionalProperties: false,
};

const SYSTEM_PROMPT =
  "당신은 금융회사 정보보호팀의 보안 인식(Security Awareness) 뉴스레터 편집자입니다. " +
  "회사는 매월 1일을 '정보보호의 날'로 지정하고 임직원에게 보안 인식 뉴스레터를 발송합니다. " +
  "임직원이 끝까지 읽도록 간결하고 명확하며 약간 친근한 한국어로, 실천 가능한 정보 중심으로 작성하세요. " +
  "보이스피싱, 스미싱, 랜섬웨어, 내부정보 유출, 공급망 공격, AI 딥페이크 등 최근 금융권 이슈를 반영합니다. " +
  "시각적 가독성을 위해 cover_emoji·각 headline.emoji·deep_dive.emoji를 주제에 어울리게 채웁니다(항목당 1개). " +
  "각 headline.category는 deepfake|voice|phishing|supplychain|insider|ransomware|vuln|dataleak|general 중 가장 맞는 것을 고릅니다. " +
  "alert는 한 줄 경고 배너, stats는 헤드라인의 실제 수치 3개(피해액·유출 규모·과징금 등 임팩트 있는 숫자), tips는 임직원이 바로 실천할 보안 수칙 4~5개로 채웁니다. " +
  "tips(오늘의 보안 수칙)는 어느 포맷에서나 핵심이므로 가장 명확하고 실천 가능하게 작성합니다.";

// 포맷별 작성 가이드 (요청 포맷에 따라 강조점이 달라진다)
const FORMAT_GUIDE: Record<string, string> = {
  comic: "4컷 만화 중심. comic.panels를 정확히 4컷(상황→함정→피해→수칙)으로 반드시 채우고, 대사(speech)·캡션(caption)은 짧고 쉬운 구어체로. 각 컷 scene/mood를 위협에 맞게 고르고, 마지막 컷은 '오늘의 보안 수칙'으로 안전하게 마무리한다.",
  card: "수칙 카드/인포그래픽 중심. tips를 또렷한 실천 카드로, stats(숫자)를 인상적으로 제시한다. 문장은 짧게.",
  standard: "표준 뉴스레터. 헤드라인·심층분석·수칙을 충실히 담되 가독성을 우선한다.",
  onepager: "A4 한 장 요약. tips(핵심 수칙)와 한 줄 경고 중심으로 매우 간결하게. 심층분석은 짧게 압축한다.",
  infographic: "데이터 시각화 인포그래픽. infographic.donut(핵심 비율 %), file_types(악성 첨부 형식 %), note(다크웹 등 보조 사실), stages(공격 단계 3개·심각도 danger→warn→ok), damage(피해 규모)를 실제 수치로 채운다. tips(행동 수칙)도 간결히. 모든 수치는 소스/웹검색 근거.",
};

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

  let body: { month?: string; material?: any; current?: any; instruction?: string; format?: string; save?: boolean };
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
  const ALLOWED_FORMATS = ["comic", "card", "standard", "onepager", "infographic"];
  let fmt = body.format || (body.current && body.current.format) || "standard";
  if (!ALLOWED_FORMATS.includes(fmt)) fmt = "standard";

  // 배치(save) 모드: 서비스롤로 직접 저장한다. 컨텍스트가 없으면 해당 월 현재 버전을 가져온다.
  const save = body.save === true;
  const supa = save ? createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!) : null;
  if (save && supa && !body.material) {
    const { data: m } = await supa.from("materials").select("id, current_version_id").eq("month", month).maybeSingle();
    if (m?.current_version_id) {
      const { data: ver } = await supa.from("versions").select("*").eq("id", m.current_version_id).single();
      if (ver) body.material = { current: ver };
    }
  }

  const ctx = materialContext(body.material, monthLabel);

  // 모드별 프롬프트/도구 구성
  let userMessage: string;
  let tools: any[] | undefined;
  if (isEdit) {
    userMessage =
      `${ctx}\n\n[현재 뉴스레터(JSON)]\n${JSON.stringify(body.current, null, 2)}\n\n` +
      `[수정 요청]\n${body.instruction!.trim()}\n\n` +
      `[표현 포맷] ${fmt} — ${FORMAT_GUIDE[fmt]}\n` +
      `위 뉴스레터를 요청대로 수정해 전체 뉴스레터를 다시 작성하세요. ` +
      `요청과 무관한 부분은 그대로 유지하고, format은 '${fmt}'로 유지하세요.` +
      (fmt === "comic" ? ` comic.panels(4컷)도 유지/보강하세요.` : "");
  } else {
    userMessage =
      `${ctx}\n\n` +
      `[표현 포맷] ${fmt} — ${FORMAT_GUIDE[fmt]}\n` +
      `${monthLabel} 정보보호의 날 임직원 보안 뉴스레터를 작성하세요. ` +
      `위 '이번 달 자료'의 테마를 중심에 두되, 최신 금융권 보안 위협을 web search로 보강해 ` +
      `실제 보도 사례 기반의 헤드라인 2~4건과 심층 분석 한 꼭지, 이달의 팁을 채우세요. ` +
      `format은 반드시 '${fmt}'로 설정하세요.`;
    tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }];
  }

  // 요청 포맷이 comic이면 comic 데이터를 필수로 강제한다
  const schema = JSON.parse(JSON.stringify(SCHEMA));
  if (fmt === "comic" && !schema.required.includes("comic")) schema.required.push("comic");
  if (fmt === "infographic" && !schema.required.includes("infographic")) schema.required.push("infographic");

  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      ...(tools ? { tools } : {}),
      messages: [{ role: "user", content: userMessage }],
      output_config: { format: { type: "json_schema", schema } },
    } as any);
    const textBlock = (resp.content as any[]).find((b) => b.type === "text");
    const newsletter = JSON.parse(textBlock.text);
    newsletter.format = fmt; // 모델이 빠뜨려도 요청 포맷으로 고정

    // 배치(save) 모드: 새 버전으로 저장(없으면 자료 생성)
    if (save && supa) {
      const title = newsletter.subject || `${Number(mm)}월 정보보호의 날`;
      const { data: mat } = await supa.from("materials").select("id, current_version_id").eq("month", month).maybeSingle();
      if (mat?.id) {
        const { data: cur } = await supa.from("versions").select("*").eq("id", mat.current_version_id).single();
        const r = await supa.rpc("add_version", {
          p_material_id: mat.id, p_title: title, p_theme: cur?.theme ?? "", p_content: cur?.content ?? "",
          p_rules: cur?.rules ?? [], p_poster_path: null, p_change_note: `자동 배치 생성(${fmt})`, p_change_source: "ai", p_newsletter: newsletter,
        });
        if (r.error) return json({ error: `저장 실패: ${r.error.message}` }, 502);
      } else {
        const r = await supa.rpc("create_material", {
          p_month: month, p_title: title, p_theme: "(자동 생성)", p_content: newsletter.intro ?? "",
          p_rules: newsletter.tips ?? [], p_poster_path: null, p_change_note: `자동 배치 생성(${fmt})`, p_newsletter: newsletter,
        });
        if (r.error) return json({ error: `자료 생성 실패: ${r.error.message}` }, 502);
      }
      return json({ ok: true, month, saved: true, format: fmt, subject: newsletter.subject });
    }
    return json({ ok: true, month, newsletter });
  } catch (e) {
    return json({ error: `뉴스레터 생성 실패: ${(e as any)?.message ?? e}` }, 502);
  }
});
