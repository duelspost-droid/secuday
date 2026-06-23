// secuday — 월간 보안 인식 자료 메일링 Edge Function
// 지정한 월(또는 최신) 자료를 HTML 이메일로 임직원에게 발송한다. (Resend 사용)
//
// 호출: POST /functions/v1/send-mailing
//   body: { "month": "2026-07", "to": ["a@x.com","b@x.com"] }   // to 생략 시 recipients 테이블 사용(있으면)
//
// 시크릿: RESEND_API_KEY (필수), MAIL_FROM (선택, 기본 "secuday <onboarding@resend.dev>")
//         SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (기본 제공)
//
// 발신 도메인을 Resend에서 인증하면 MAIL_FROM 을 "secuday <noreply@jbax.co.kr>" 로 바꾸세요.
// 도메인 인증 전에는 onboarding@resend.dev 로, 본인(가입) 이메일에게만 발송됩니다.

import { createClient } from "npm:@supabase/supabase-js@2";

const SITE = "https://secuday.jbax.co.kr";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

function esc(s: string) {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function mdToHtml(text: string) {
  return esc(text)
    .split("\n")
    .map((l) => {
      if (/^### /.test(l)) return `<h4 style="margin:14px 0 4px">${l.slice(4)}</h4>`;
      if (/^## /.test(l)) return `<h3 style="margin:16px 0 6px;color:#0a2a5c">${l.slice(3)}</h3>`;
      if (/^# /.test(l)) return `<h2 style="margin:18px 0 8px;color:#0a2a5c">${l.slice(2)}</h2>`;
      if (/^\s*(?:>|&gt;)\s?/.test(l)) return `<blockquote style="border-left:3px solid #047857;background:#f0faf5;padding:8px 14px;margin:10px 0">${l.replace(/^\s*(?:>|&gt;)\s?/, "")}</blockquote>`;
      if (/^\s*[-*] /.test(l)) return `<li>${l.replace(/^\s*[-*] /, "")}</li>`;
      if (l.trim() === "") return "<br>";
      return `<p style="margin:8px 0;line-height:1.7">${l}</p>`;
    })
    .join("")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

/* 표준 뉴스레터 포맷 이메일 (versions.newsletter 기반) — 관리자 미리보기/PDF와 동일한 섹션 구성 */
function buildNewsletterEmail(nl: any, monthLabel: string) {
  const link = (u: string) => (/^https?:\/\//i.test(u || "") ? u : "");
  const heads = (nl.headlines || []).map((h: any) => {
    const url = link(h.link);
    return `<div style="border:1px solid #dde3ec;border-left:4px solid #1a56db;padding:12px 16px;margin:10px 0;background:#fbfcfe">
      <div style="font-weight:700;margin-bottom:6px;line-height:1.45">${esc(h.title)}</div>
      <div style="font-size:14px;line-height:1.7;color:#374151">${mdToHtml(h.summary)}</div>
      <div style="font-size:12px;color:#6b7280;margin-top:8px">${esc(h.source)}${url ? ` · <a href="${url}" style="color:#1a56db">원문 ↗</a>` : ""}</div>
    </div>`;
  }).join("");
  const dd = nl.deep_dive || {};
  const tips = Array.isArray(nl.tips) ? nl.tips.filter(Boolean) : [];
  const tipsBlock = tips.length ? `<div style="background:#f0faf5;border:1px solid #bbe6cf;border-radius:12px;padding:16px 18px;margin:22px 0">
      <div style="font-weight:800;color:#0f6e56;margin-bottom:10px;font-size:15px">✅ 오늘의 보안 수칙</div>
      ${tips.map((t: string) => `<div style="display:flex;gap:8px;margin:7px 0;font-size:14px;line-height:1.6"><span style="color:#16a34a;font-weight:800">✔</span><span>${esc(t)}</span></div>`).join("")}
    </div>` : "";
  const panels = (nl.comic && Array.isArray(nl.comic.panels)) ? nl.comic.panels : [];
  const numerals = ["①", "②", "③", "④", "⑤", "⑥"];
  const comicBlock = panels.length ? `<h3 style="border-bottom:2px solid #dde3ec;padding-bottom:6px;margin:26px 0 12px;color:#0a2a5c">💬 4컷으로 보는 이달의 위협</h3>
      ${panels.map((p: any, i: number) => `<div style="border:1px solid #dde3ec;border-radius:10px;padding:12px 14px;margin:10px 0;background:#fbfcfe">
        <div style="font-size:12px;color:#1a56db;font-weight:800">${numerals[i] || (i + 1)} ${esc(p.caption || "")}</div>
        ${p.speech ? `<div style="margin-top:6px;font-size:14px;line-height:1.6"><b>${esc(p.speaker || "")}</b> &ldquo;${esc(p.speech)}&rdquo;</div>` : ""}
      </div>`).join("")}` : "";
  return `<!DOCTYPE html><html lang="ko"><body style="margin:0;background:#f4f6fa;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#1f2937">
  <div style="max-width:640px;margin:0 auto;background:#fff">
    <div style="background:#0a2a5c;color:#fff;padding:22px 28px">
      <div style="font-size:20px;font-weight:800">🛡 secuday · 정보보호의 날</div>
      <div style="font-size:13px;color:#9db9e8;margin-top:4px">${esc(monthLabel)} · 금융권 보안 인식 뉴스레터</div>
    </div>
    <div style="padding:28px">
      <h1 style="font-size:22px;color:#1a56db;margin:0 0 14px;line-height:1.4">${esc(nl.subject)}</h1>
      <div style="font-size:15px;line-height:1.75">${mdToHtml(nl.intro)}</div>
      ${tipsBlock}
      ${comicBlock}
      ${heads ? `<h3 style="border-bottom:2px solid #dde3ec;padding-bottom:6px;margin:26px 0 12px;color:#0a2a5c">📰 이달의 보안 뉴스</h3>${heads}` : ""}
      ${dd.body ? `<h3 style="border-bottom:2px solid #dde3ec;padding-bottom:6px;margin:26px 0 12px;color:#0a2a5c">🔎 ${esc(dd.heading || "이달의 심층 분석")}</h3><div style="font-size:15px;line-height:1.75">${mdToHtml(dd.body)}</div>` : ""}
      ${nl.tip ? `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px 16px;margin:20px 0;font-size:14px;line-height:1.7"><strong style="color:#b45309">💡 이달의 팁</strong> ${esc(nl.tip)}</div>` : ""}
      ${nl.closing ? `<div style="color:#6b7280;margin-top:18px;line-height:1.75">${mdToHtml(nl.closing)}</div>` : ""}
      <div style="text-align:center;margin:26px 0">
        <a href="${SITE}" style="background:#1a56db;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:700;display:inline-block">전체 자료 보기 →</a>
      </div>
    </div>
    <div style="background:#f4f6fa;color:#9aa3b2;font-size:12px;text-align:center;padding:18px">
      secuday.jbax.co.kr · 정보보호팀<br>본 메일은 정보보호의 날 보안 인식 캠페인의 일환으로 발송되었습니다.
    </div>
  </div></body></html>`;
}

function buildEmail(v: any, monthLabel: string, posterUrl: string | null) {
  const rules = (v.rules || []).map((r: string) =>
    `<li style="margin:6px 0;line-height:1.6">${esc(r)}</li>`).join("");
  return `<!DOCTYPE html><html lang="ko"><body style="margin:0;background:#f4f6fa;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#1f2937">
  <div style="max-width:640px;margin:0 auto;background:#fff">
    <div style="background:#0a2a5c;color:#fff;padding:22px 28px">
      <div style="font-size:20px;font-weight:800">🛡 secuday · 정보보호의 날</div>
      <div style="font-size:13px;color:#9db9e8;margin-top:4px">${esc(monthLabel)} · 금융권 보안 인식 안내</div>
    </div>
    <div style="padding:28px">
      <div style="display:inline-block;background:#eef2ff;color:#1a56db;font-weight:700;font-size:13px;padding:4px 12px;border-radius:999px">이달의 주제</div>
      <h1 style="font-size:22px;color:#0a2a5c;margin:12px 0 18px">${esc(v.theme)}</h1>
      ${posterUrl ? `<div style="text-align:center;margin:18px 0"><img src="${posterUrl}" alt="포스터" width="320" style="max-width:100%;border:1px solid #dde3ec;border-radius:8px"></div>` : ""}
      <div style="font-size:15px">${mdToHtml(v.content)}</div>
      <div style="background:#f0faf5;border-radius:10px;padding:16px 20px;margin:22px 0">
        <div style="font-weight:700;color:#047857;margin-bottom:8px">✅ 임직원 보안 수칙</div>
        <ul style="margin:0;padding-left:20px">${rules}</ul>
      </div>
      <div style="text-align:center;margin:26px 0">
        <a href="${SITE}" style="background:#1a56db;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:700;display:inline-block">전체 자료 보기 →</a>
      </div>
    </div>
    <div style="background:#f4f6fa;color:#9aa3b2;font-size:12px;text-align:center;padding:18px">
      secuday.jbax.co.kr · 정보보호팀<br>본 메일은 정보보호의 날 보안 인식 캠페인의 일환으로 발송되었습니다.
    </div>
  </div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST만 허용됩니다." }, 405);

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return json({ error: "RESEND_API_KEY가 설정되지 않았습니다. Resend에서 발급해 시크릿에 추가하세요." }, 503);
  const from = Deno.env.get("MAIL_FROM") || "secuday <onboarding@resend.dev>";

  const body = await req.json().catch(() => ({}));
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // 대상 자료 선택 (month 지정 또는 최신)
  let mq = supabase.from("materials").select("id, month, current_version_id").order("month", { ascending: false }).limit(1);
  if (body.month) mq = supabase.from("materials").select("id, month, current_version_id").eq("month", body.month).limit(1);
  const { data: mats, error: me } = await mq;
  if (me || !mats?.length) return json({ error: "발송할 자료를 찾을 수 없습니다." }, 404);
  const mat = mats[0];
  const { data: v, error: ve } = await supabase.from("versions").select("*").eq("id", mat.current_version_id).single();
  if (ve) return json({ error: ve.message }, 502);

  // 수신자: body.to 우선, 없으면 recipients 테이블(있으면)
  let recipients: string[] = Array.isArray(body.to) ? body.to : [];
  if (!recipients.length) {
    const { data: rs } = await supabase.from("recipients").select("email").eq("active", true);
    recipients = (rs || []).map((r: any) => r.email);
  }
  if (!recipients.length) return json({ error: "수신자가 없습니다. body.to 배열을 넣거나 recipients 테이블을 채우세요." }, 400);

  const [yy, mm] = mat.month.split("-");
  const monthLabel = `${yy}년 ${Number(mm)}월`;
  const posterUrl = v.poster_path
    ? supabase.storage.from("posters").getPublicUrl(v.poster_path).data.publicUrl
    : null;
  // 뉴스레터가 있으면 표준 뉴스레터 포맷으로, 없으면 기존 안내문 포맷으로 발송
  const nl = v.newsletter && v.newsletter.subject ? v.newsletter : null;
  const html = nl ? buildNewsletterEmail(nl, monthLabel) : buildEmail(v, monthLabel, posterUrl);
  const subject = nl ? nl.subject : `[정보보호의 날] ${monthLabel} — ${v.theme}`;

  // Resend 발송 (수신자별 개별 발송, 서로 주소 노출 안 됨)
  const results: any[] = [];
  for (const to of recipients) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html }),
    });
    const r = await res.json().catch(() => ({}));
    results.push({ to, ok: res.ok, id: r.id, error: res.ok ? undefined : (r.message || r.error || res.status) });
  }
  const sent = results.filter((r) => r.ok).length;
  return json({ ok: true, month: mat.month, subject, sent, total: recipients.length, results });
});
