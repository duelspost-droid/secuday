// secuday — generate-webtoon
// Nano Banana(Gemini 2.5 Flash Image)로 '보안수칙 웹툰' 이미지를 생성해 Storage(posters)에 올리고 공개 URL을 반환한다.
// 생성된 URL은 뉴스레터 인포그래픽의 nl.rules_image(보안수칙 시각물)로 사용한다.
//
// 시크릿: GEMINI_API_KEY (필수)  ← Supabase 대시보드에서 등록(레포에 평문 저장 안 함)
// verify_jwt=true → 로그인 임직원(JWT) 또는 service_role(cron)만 호출.
//
// 호출:  POST /functions/v1/generate-webtoon
//   body 예) { "month":"2026-07", "prompt":"<직접 프롬프트>" }
//        또는 { "month":"2026-07", "theme":"...", "panels":[{speech,caption,scene}, ...] }
//   테스트 오버라이드(재배포 없이 조정): { "model":"gemini-2.5-flash-image", "modalities":["IMAGE"]|"omit" }
//
// return: { ok, url, path, mime, model, prompt }

import { createClient } from "npm:@supabase/supabase-js@2";

const DEFAULT_MODEL = "gemini-2.5-flash-image";
const BUCKET = "posters"; // 기존 공개 버킷 재사용(webtoon/ 하위 경로)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// 보안수칙 웹툰 프롬프트 구성: body.prompt가 있으면 그대로, 없으면 panels/theme로 조립
function buildPrompt(body: any): string {
  if (body?.prompt && String(body.prompt).trim()) return String(body.prompt).trim();
  const theme = body?.theme || "AI 딥페이크·음성복제 금융사기 예방";
  const panels = Array.isArray(body?.panels) ? body.panels.slice(0, 4) : [];
  const lines = panels.length
    ? panels.map((p: any, i: number) =>
        `패널${i + 1}: ${p.caption || p.scene || ""}` + (p.speech ? ` — 말풍선 "${p.speech}"` : ""),
      ).join("\n")
    : [
        `패널1: 노트북 영상통화 속 '대표'(딥페이크)가 송금 재촉 — 말풍선 "지금 당장 이 계좌로 송금해" / 캡션 "당장·비밀로 압박하면 일단 멈춤"`,
        `패널2: 직원이 멈칫·의심 — 말풍선 "잠깐, 평소랑 너무 달라" / 캡션 "영상통화도 약속한 인증어로 검증"`,
        `패널3: 다른 전화기로 등록된 번호에 콜백, 수상한 앱 거절 — 말풍선 "등록된 번호로 다시 확인할게요" / 캡션 "콜백으로 확인, 수상한 앱은 거절"`,
        `패널4: 정보보호팀에 신고해 차단 — 말풍선 "의심되면 정보보호팀에 바로 신고" / 캡션 "신고로 딥페이크 사기 차단"`,
      ].join("\n");
  return (
    `한국 웹툰(웹코믹) 스타일의 세로 4컷 보안수칙 만화를 그려줘. 주제: ${theme} (JB금융 임직원 대상, 정보보호의 날).\n` +
    `요구사항: 깔끔하고 현대적인 디지털 웹툰 작화, 밝고 선명한 색, 인물 표정이 분명한 컷, 세로로 4개 패널을 위에서 아래로 배치. ` +
    `각 패널에 한국어 말풍선과 하단 캡션을 또렷하고 '정확하게' 표기(맞춤법·글자 정확, 글자 깨짐 금지). 영어 텍스트와 이모지는 넣지 말 것.\n` +
    lines
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST만 허용됩니다." }, 405);

  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return json({ error: "GEMINI_API_KEY가 설정되지 않았습니다." }, 503);

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const model = body?.model || Deno.env.get("GEMINI_IMAGE_MODEL") || DEFAULT_MODEL;
  const month = body?.month || new Date().toISOString().slice(0, 7);
  const prompt = buildPrompt(body);

  // generationConfig.responseModalities: 기본 ["IMAGE"]. "omit"이면 생략(모델별 차이 대응).
  const reqBody: any = { contents: [{ parts: [{ text: prompt }] }] };
  if (body?.modalities !== "omit") {
    reqBody.generationConfig = { responseModalities: Array.isArray(body?.modalities) ? body.modalities : ["IMAGE"] };
  }

  let data: any;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reqBody) },
    );
    data = await r.json();
    if (!r.ok) return json({ error: `Gemini ${r.status}`, detail: JSON.stringify(data).slice(0, 500), model }, 502);
  } catch (e) {
    return json({ error: `Gemini 호출 실패: ${(e as any)?.message ?? e}`, model }, 502);
  }

  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const part = parts.find((p: any) => p.inlineData || p.inline_data);
  const inline = part?.inlineData || part?.inline_data;
  if (!inline?.data) {
    return json({ error: "이미지가 반환되지 않았습니다.", detail: JSON.stringify(data).slice(0, 500), model }, 502);
  }

  const mime = inline.mimeType || inline.mime_type || "image/png";
  const ext = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
  const bytes = Uint8Array.from(atob(inline.data), (c) => c.charCodeAt(0));

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const path = `webtoon/${month}-${Date.now()}.${ext}`;
  const up = await supa.storage.from(BUCKET).upload(path, new Blob([bytes], { type: mime }), {
    contentType: mime,
    upsert: true,
  });
  if (up.error) return json({ error: `업로드 실패: ${up.error.message}` }, 502);

  const url = supa.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  return json({ ok: true, url, path, mime, model, prompt });
});
