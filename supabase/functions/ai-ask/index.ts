// secuday — AI 질의 Edge Function
// 클라이언트가 현재 자료 + 대화이력 + 질문을 보내면 Claude에 질의하고
// { reply, proposal } 을 반환한다. ANTHROPIC_API_KEY는 서버 시크릿으로만 보관된다.
//
// 배포:  supabase functions deploy ai-ask
// 시크릿: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// verify_jwt 가 기본 활성이라 로그인한(Authorization: Bearer <access_token>) 요청만 통과한다.

import Anthropic from "npm:@anthropic-ai/sdk@0.65.0";

const MODEL = "claude-opus-4-8";

const SYSTEM_PROMPT = `당신은 기업 정보보호팀의 보안 인식(Security Awareness) 콘텐츠 전문가입니다.
이 회사는 매월 1일을 '정보보호의 날'로 지정하고, 임직원에게 보안 인식 제고를 위한
포스터 문구·안내 내용·임직원 수칙을 배포합니다.

사용자는 현재 작성 중인 자료에 대해 질문하거나 수정을 요청합니다.

규칙:
- 질문에는 reply 필드에 한국어로 답합니다.
- 사용자가 내용 수정/보완/개선을 요청한 경우에만 proposal 필드에 수정된 전체 자료를 담습니다.
  (단순 질문이면 proposal은 null로 둡니다.)
- proposal을 만들 때는 기존 자료를 기반으로 요청된 부분만 수정하고, 나머지는 유지합니다.
- content는 마크다운 형식, rules는 임직원이 바로 실천할 수 있는 명령형 문장 목록으로 작성합니다.
- 문체는 임직원 공지에 적합한 간결하고 명확한 한국어를 사용합니다.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description: "사용자 질의에 대한 한국어 답변. 수정안을 만든 경우 무엇을 바꿨는지 요약.",
    },
    proposal: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          properties: {
            title: { type: "string" },
            theme: { type: "string" },
            content: { type: "string" },
            rules: { type: "array", items: { type: "string" } },
          },
          required: ["title", "theme", "content", "rules"],
          additionalProperties: false,
        },
      ],
      description: "수정 요청일 때만 수정된 전체 자료. 단순 질문이면 null.",
    },
  },
  required: ["reply", "proposal"],
  additionalProperties: false,
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST만 허용됩니다." }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json({ error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다." }, 503);
  }

  let payload: { material?: any; history?: any[]; message?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "잘못된 요청 형식입니다." }, 400);
  }

  const { material, history = [], message } = payload;
  if (!material?.current || !message?.trim()) {
    return json({ error: "material과 message가 필요합니다." }, 400);
  }

  const cur = material.current;
  const context =
    `[현재 자료]\n` +
    `대상 월: ${material.month} (매월 1일 정보보호의 날)\n` +
    `제목: ${cur.title}\n` +
    `테마: ${cur.theme}\n` +
    `내용:\n${cur.content}\n\n` +
    `임직원 수칙:\n` +
    (cur.rules || []).map((r: string) => `- ${r}`).join("\n");

  const messages: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: context },
    { role: "assistant", content: "자료를 확인했습니다. 질문이나 수정 요청을 말씀해 주세요." },
  ];
  for (const log of history.slice(-10)) {
    if (log?.role && log?.content) messages.push({ role: log.role, content: log.content });
  }
  messages.push({ role: "user", content: message });

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      messages,
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    } as any);
    const textBlock = (response.content as any[]).find((b) => b.type === "text");
    const result = JSON.parse(textBlock.text);
    return json(result);
  } catch (e) {
    return json({ error: `AI 질의 중 오류가 발생했습니다: ${e?.message ?? e}` }, 502);
  }
});
