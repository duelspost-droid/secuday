/* secuday — 뉴스레터 표준 포맷 (단일 소스)
 *
 * 이 파일이 뉴스레터의 "표준 포맷"을 정의한다.
 * 관리자 미리보기 / PDF 다운로드(인쇄) / (참고용) 이메일이 모두 이 포맷을 공유한다.
 *
 * 데이터 구조(versions.newsletter):
 *   { subject, intro, headlines:[{title,summary,source,link}], deep_dive:{heading,body}, tip, closing }
 *
 * 표준 섹션 순서:
 *   헤더 밴드 → 제목 → 도입 → 📰 이달의 보안 뉴스(카드) → 🔎 심층 분석 → 💡 이달의 팁 → 맺음말 → 푸터
 *
 * 노출 API: window.NewsletterTemplate
 *   - renderBody(nl)            : 본문 섹션 HTML (<article class="nl">)
 *   - documentShell(body, label): 헤더밴드+본문+푸터로 감싼 문서 HTML
 *   - buildPrintDocument(nl, m) : 인쇄(PDF)용 완전한 HTML 문서 문자열 (A4)
 *   - md / esc / safeUrl / monthLabel : 보조 함수
 */
(function () {
  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : s;
    return d.innerHTML;
  }
  function escAttr(s) {
    return esc(s).replace(/"/g, "&quot;");
  }
  function safeUrl(u) {
    return /^https?:\/\//i.test(u || "") ? u : "";
  }
  function inline(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>");
  }
  /* 경량 마크다운: 제목/목록/인용(>)/굵게/기울임 지원 */
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
    var heads = (nl.headlines || []).map(function (h) {
      var link = safeUrl(h.link);
      return '<div class="nl-card"><div class="nl-card-title">' + esc(h.title) + "</div>" +
        '<div class="nl-card-summary">' + md(h.summary) + "</div>" +
        '<div class="nl-card-source">' + esc(h.source) +
        (link ? ' · <a href="' + escAttr(link) + '" target="_blank" rel="noopener">원문 ↗</a>' : "") +
        "</div></div>";
    }).join("");
    var dd = nl.deep_dive || {};
    return '<article class="nl">' +
      '<h2 class="nl-subject">' + esc(nl.subject) + "</h2>" +
      '<div class="nl-intro">' + md(nl.intro) + "</div>" +
      (heads ? '<h3 class="nl-h">📰 이달의 보안 뉴스</h3>' + heads : "") +
      (dd.body ? '<h3 class="nl-h">🔎 ' + esc(dd.heading || "이달의 심층 분석") + "</h3>" +
        '<div class="nl-body">' + md(dd.body) + "</div>" : "") +
      (nl.tip ? '<div class="nl-tip"><strong>💡 이달의 팁</strong> ' + esc(nl.tip) + "</div>" : "") +
      (nl.closing ? '<div class="nl-closing">' + md(nl.closing) + "</div>" : "") +
      "</article>";
  }

  function documentShell(bodyHtml, label) {
    return '<div class="nl-doc">' +
      '<div class="nl-band"><div class="t">🛡 secuday · 정보보호의 날</div>' +
      '<div class="s">' + esc(label) + " · 금융권 보안 인식 뉴스레터</div></div>" +
      bodyHtml +
      '<div class="nl-foot">secuday.jbax.co.kr · 정보보호팀 — AI 자동 생성 후 출처 검증을 거친 자료입니다</div>' +
      "</div>";
  }

  /* 인쇄(PDF)용 자체 완결 CSS — 앱 style.css에 의존하지 않는다. A4 기준. */
  var DOC_CSS =
    "*{box-sizing:border-box}" +
    "body{margin:0;background:#eef1f6;color:#1f2937;font-family:'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',-apple-system,sans-serif;}" +
    ".nl-doc{max-width:720px;margin:20px auto;background:#fff;border:1px solid #dde3ec;border-radius:12px;overflow:hidden;}" +
    ".nl-band{background:#0a2a5c;color:#fff;padding:22px 32px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}" +
    ".nl-band .t{font-size:20px;font-weight:800;}" +
    ".nl-band .s{font-size:13px;color:#9db9e8;margin-top:4px;}" +
    ".nl{padding:30px 32px;line-height:1.75;}" +
    ".nl-subject{color:#1a56db;margin:0 0 14px;font-size:23px;line-height:1.4;}" +
    ".nl-intro{margin-bottom:18px;}.nl-intro p{margin:8px 0;}.nl-intro ul{margin:8px 0;padding-left:20px;}.nl-intro li{margin:4px 0;}" +
    ".nl-h{border-bottom:2px solid #dde3ec;padding-bottom:6px;margin:26px 0 12px;font-size:16px;}" +
    ".nl-card{border:1px solid #dde3ec;border-left:4px solid #1a56db;padding:14px 16px;margin:10px 0;background:#fbfcfe;break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact;}" +
    ".nl-card-title{font-weight:700;margin-bottom:6px;line-height:1.45;}" +
    ".nl-card-summary{font-size:14px;line-height:1.7;color:#374151;}.nl-card-summary p{margin:4px 0;}" +
    ".nl-card-source{font-size:12px;color:#6b7280;margin-top:8px;}.nl-card-source a{color:#1a56db;}" +
    ".nl-body{line-height:1.75;}.nl-body p{margin:8px 0;}" +
    ".nl strong{color:#0a2a5c;}" +
    ".nl-quote{border-left:3px solid #047857;background:#f0faf5;padding:8px 14px;margin:10px 0;font-size:14px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}" +
    ".nl-tip{background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px 16px;margin:20px 0;font-size:14px;line-height:1.7;break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact;}" +
    ".nl-tip strong{color:#b45309;}" +
    ".nl-closing{color:#6b7280;margin-top:18px;line-height:1.75;}" +
    ".nl-foot{background:#f4f6fa;color:#9aa3b2;font-size:12px;text-align:center;padding:18px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}" +
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

  window.NewsletterTemplate = {
    esc: esc, escAttr: escAttr, safeUrl: safeUrl, md: md, monthLabel: monthLabel,
    renderBody: renderBody, documentShell: documentShell, buildPrintDocument: buildPrintDocument,
  };
})();
