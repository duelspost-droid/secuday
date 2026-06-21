/* secuday — 뉴스레터 표준 포맷 (단일 소스)
 *
 * 이 파일이 뉴스레터의 "표준 포맷"을 정의한다.
 * 관리자 미리보기 / PDF 다운로드(인쇄) / (참고용) 이메일이 모두 이 포맷을 공유한다.
 *
 * 데이터 구조(versions.newsletter):
 *   { subject, intro, cover_emoji?,
 *     headlines:[{title,summary,source,link,emoji?}],
 *     deep_dive:{heading,body,emoji?}, tip, closing }
 *   (emoji/cover_emoji는 선택 — 없으면 번호 배지·기본 아이콘으로 대체)
 *
 * 표준 섹션 순서:
 *   헤더 밴드 → 커버(큰 이모지+제목) → 도입 → 📰 이달의 보안 뉴스(카드) → 🔎 심층 분석 → 💡 이달의 팁 → 맺음말 → 푸터
 *
 * 노출 API: window.NewsletterTemplate
 */
(function () {
  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : s;
    return d.innerHTML;
  }
  function escAttr(s) { return esc(s).replace(/"/g, "&quot;"); }
  function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : ""; }
  function inline(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>");
  }
  /* 경량 마크다운: 제목/목록/인용(>)/굵게/기울임 */
  function md(text) {
    var raw = String(text == null ? "" : text).split("\n");
    var html = "", inList = false, inQ = false, qb = [];
    function fq() { if (inQ) { html += '<blockquote class="nl-quote">' + qb.join("<br>") + "</blockquote>"; qb = []; inQ = false; } }
    function fl() { if (inList) { html += "</ul>"; inList = false; } }
    for (var i = 0; i < raw.length; i++) {
      var line = raw[i];
      var q = line.match(/^\s*(?:>|&gt;)\s?(.*)$/);
      if (q) { fl(); inQ = true; qb.push(inline(q[1])); continue; }
      fq();
      if (/^\s*[-*] /.test(line)) {
        if (!inList) { html += "<ul>"; inList = true; }
        html += "<li>" + inline(line.replace(/^\s*[-*] /, "")) + "</li>";
        continue;
      }
      fl();
      if (/^### /.test(line)) html += "<h4>" + inline(line.slice(4)) + "</h4>";
      else if (/^## /.test(line)) html += "<h3>" + inline(line.slice(3)) + "</h3>";
      else if (/^# /.test(line)) html += "<h2>" + inline(line.slice(2)) + "</h2>";
      else if (line.trim() === "") continue;
      else html += "<p>" + inline(line) + "</p>";
    }
    fq(); fl();
    return html;
  }
  function monthLabel(monthStr) {
    if (!monthStr) return "";
    var p = String(monthStr).split("-");
    if (p.length < 2) return monthStr;
    return p[0] + "년 " + Number(p[1]) + "월";
  }

  function renderBody(nl) {
    nl = nl || {};
    var cover = esc(nl.cover_emoji || "🛡️");
    var heads = (nl.headlines || []).map(function (h, i) {
      var link = safeUrl(h.link);
      var badge = h.emoji ? esc(h.emoji) : ("0" + (i + 1)).slice(-2);
      var badgeCls = h.emoji ? "nl-badge nl-badge-emoji" : "nl-badge";
      return '<div class="nl-card">' +
        '<div class="nl-card-top"><span class="' + badgeCls + '">' + badge + "</span>" +
        '<div class="nl-card-title">' + esc(h.title) + "</div></div>" +
        '<div class="nl-card-summary">' + md(h.summary) + "</div>" +
        (h.source || link ?
          '<div class="nl-card-source">' +
          (h.source ? '<span class="nl-pill">' + esc(h.source) + "</span>" : "") +
          (link ? '<a class="nl-card-link" href="' + escAttr(link) + '" target="_blank" rel="noopener">원문 ↗</a>' : "") +
          "</div>" : "") +
        "</div>";
    }).join("");
    var dd = nl.deep_dive || {};
    var ddIco = esc(dd.emoji || "🔎");
    return '<article class="nl">' +
      '<div class="nl-cover"><div class="nl-cover-emoji">' + cover + "</div>" +
      '<h2 class="nl-subject">' + esc(nl.subject) + "</h2></div>" +
      '<div class="nl-intro">' + md(nl.intro) + "</div>" +
      (heads ? '<h3 class="nl-h"><span class="nl-h-ico">📰</span> 이달의 보안 뉴스</h3>' + heads : "") +
      (dd.body ? '<h3 class="nl-h"><span class="nl-h-ico">' + ddIco + "</span> " + esc(dd.heading || "이달의 심층 분석") + "</h3>" +
        '<div class="nl-body">' + md(dd.body) + "</div>" : "") +
      (nl.tip ? '<div class="nl-tip"><div class="nl-tip-ico">💡</div><div class="nl-tip-body">' +
        '<div class="nl-tip-label">이달의 팁</div><div>' + esc(nl.tip) + "</div></div></div>" : "") +
      (nl.closing ? '<div class="nl-closing">' + md(nl.closing) + "</div>" : "") +
      "</article>";
  }

  function documentShell(bodyHtml, label, subtitle, foot) {
    subtitle = subtitle || "금융권 보안 인식 뉴스레터";
    foot = foot || "secuday.jbax.co.kr · 정보보호팀 — AI 자동 생성 후 출처 검증을 거친 자료입니다";
    return '<div class="nl-doc">' +
      '<div class="nl-band"><div class="t">🛡 secuday · 정보보호의 날</div>' +
      '<div class="s">' + esc(label) + " · " + esc(subtitle) + "</div></div>" +
      bodyHtml +
      '<div class="nl-foot">' + esc(foot) + "</div>" +
      "</div>";
  }

  /* 월별 자료(material) 본문 — 자료 보기 PDF용 */
  function renderMaterialBody(mat, posterUrl) {
    mat = mat || {};
    var rules = (mat.rules || []).map(function (r) { return "<li>" + esc(r) + "</li>"; }).join("");
    return '<article class="nl">' +
      '<div class="nl-cover"><div class="nl-cover-emoji">🛡️</div>' +
      '<h2 class="nl-subject">' + esc(mat.title) + "</h2>" +
      (mat.theme ? '<div class="nl-cover-tag">' + esc(mat.theme) + "</div>" : "") + "</div>" +
      (posterUrl ? '<div class="mat-poster"><img src="' + escAttr(posterUrl) + '" alt="포스터"></div>' : "") +
      (mat.content ? '<h3 class="nl-h"><span class="nl-h-ico">📋</span> 안내 내용</h3><div class="nl-body">' + md(mat.content) + "</div>" : "") +
      (rules ? '<h3 class="nl-h"><span class="nl-h-ico">✅</span> 임직원 수칙</h3><ol class="mat-rules">' + rules + "</ol>" : "") +
      "</article>";
  }

  /* 인쇄(PDF)용 자체 완결 CSS — A4 기준 */
  var DOC_CSS =
    "*{box-sizing:border-box}" +
    "body{margin:0;background:#eef1f6;color:#1f2937;font-family:'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',-apple-system,sans-serif;}" +
    ".nl-doc{max-width:720px;margin:20px auto;background:#fff;border:1px solid #dde3ec;border-radius:14px;overflow:hidden;}" +
    ".nl-band{background:#0a2a5c;color:#fff;padding:22px 32px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}" +
    ".nl-band .t{font-size:20px;font-weight:800;}" +
    ".nl-band .s{font-size:13px;color:#9db9e8;margin-top:4px;}" +
    ".nl{padding:28px 30px;line-height:1.75;}" +
    ".nl-cover{text-align:center;background:linear-gradient(135deg,#eef4ff,#e7fbff);border:1px solid #e3ebf7;border-radius:16px;padding:26px 22px;margin-bottom:22px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}" +
    ".nl-cover-emoji{font-size:46px;line-height:1;margin-bottom:10px;}" +
    ".nl-cover-tag{display:inline-block;margin-top:10px;font-size:12px;font-weight:700;color:#1a56db;background:#e8efff;border-radius:999px;padding:4px 12px;}" +
    ".nl-subject{color:#0a2a5c;margin:0;font-size:22px;line-height:1.42;font-weight:800;}" +
    ".nl-intro{margin:0 0 22px;}.nl-intro p{margin:8px 0;}.nl-intro ul{margin:8px 0;padding-left:20px;}.nl-intro li{margin:4px 0;}" +
    ".nl-h{display:flex;align-items:center;gap:9px;font-size:16px;font-weight:800;color:#0a2a5c;margin:28px 0 12px;}" +
    ".nl-h-ico{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9px;background:#eef2ff;font-size:16px;flex-shrink:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;}" +
    ".nl-card{border:1px solid #e6ecf5;border-radius:13px;padding:15px 17px;margin:11px 0;background:#fff;box-shadow:0 2px 10px rgba(10,42,92,.05);break-inside:avoid;}" +
    ".nl-card-top{display:flex;align-items:center;gap:11px;margin-bottom:8px;}" +
    ".nl-badge{flex-shrink:0;width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#1a56db,#0a2a5c);color:#fff;font-weight:800;font-size:15px;display:flex;align-items:center;justify-content:center;-webkit-print-color-adjust:exact;print-color-adjust:exact;}" +
    ".nl-badge-emoji{background:#eef2ff;font-size:18px;}" +
    ".nl-card-title{font-weight:800;line-height:1.42;color:#1f2937;}" +
    ".nl-card-summary{font-size:14px;line-height:1.75;color:#3b4759;}.nl-card-summary p{margin:5px 0;}" +
    ".nl-card-source{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:11px;}" +
    ".nl-pill{font-size:11px;font-weight:700;color:#5b6b86;background:#eef2f7;border-radius:999px;padding:3px 10px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}" +
    ".nl-card-link{font-size:12px;font-weight:700;color:#1a56db;text-decoration:none;}" +
    ".nl-body{line-height:1.8;}.nl-body p{margin:9px 0;}" +
    ".nl strong{color:#0a2a5c;}" +
    ".nl-quote{border-left:3px solid #16a34a;background:#f0fdf4;border-radius:0 8px 8px 0;padding:10px 14px;margin:10px 0;font-size:14px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}" +
    ".nl-tip{display:flex;gap:14px;align-items:flex-start;background:linear-gradient(135deg,#fff7ed,#fffbeb);border:1px solid #fde4b8;border-radius:14px;padding:16px 18px;margin:22px 0;break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact;}" +
    ".nl-tip-ico{font-size:28px;line-height:1;flex-shrink:0;}" +
    ".nl-tip-label{font-weight:800;color:#b45309;margin-bottom:3px;}" +
    ".nl-tip-body{font-size:14px;line-height:1.7;color:#5a4327;}" +
    ".nl-closing{color:#6b7280;margin-top:20px;line-height:1.75;font-size:14px;}" +
    ".nl-foot{background:#f4f6fa;color:#9aa3b2;font-size:12px;text-align:center;padding:18px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}" +
    ".mat-poster{text-align:center;margin:16px 0;}" +
    ".mat-poster img{max-width:100%;border:1px solid #dde3ec;border-radius:10px;break-inside:avoid;}" +
    ".mat-rules{margin:6px 0;padding-left:22px;}.mat-rules li{margin:6px 0;line-height:1.7;}" +
    "@page{size:A4;margin:12mm;}" +
    "@media print{body{background:#fff;}.nl-doc{border:none;border-radius:0;margin:0;max-width:none;}}";

  function buildPrintDocument(nl, monthStr) {
    var label = monthLabel(monthStr);
    var title = "정보보호의날_뉴스레터_" + (monthStr || "");
    return "<!DOCTYPE html><html lang=\"ko\"><head><meta charset=\"UTF-8\">" +
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">" +
      "<title>" + esc(title) + "</title><style>" + DOC_CSS + "</style></head><body>" +
      documentShell(renderBody(nl), label) +
      "</body></html>";
  }

  function buildMaterialPrintDocument(mat, monthStr, posterUrl) {
    var label = monthLabel(monthStr);
    var title = "정보보호의날_자료_" + (monthStr || "");
    return "<!DOCTYPE html><html lang=\"ko\"><head><meta charset=\"UTF-8\">" +
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">" +
      "<title>" + esc(title) + "</title><style>" + DOC_CSS + "</style></head><body>" +
      documentShell(renderMaterialBody(mat, posterUrl), label, "금융권 보안 인식 자료", "secuday.jbax.co.kr · 정보보호팀") +
      "</body></html>";
  }

  window.NewsletterTemplate = {
    esc: esc, escAttr: escAttr, safeUrl: safeUrl, md: md, monthLabel: monthLabel,
    renderBody: renderBody, documentShell: documentShell, buildPrintDocument: buildPrintDocument,
    renderMaterialBody: renderMaterialBody, buildMaterialPrintDocument: buildMaterialPrintDocument,
  };
})();
