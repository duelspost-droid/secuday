/* secuday — 뉴스레터 표준 포맷 (단일 소스)
 *
 * 뉴스레터는 인라인 스타일 + 인라인 SVG로 렌더한다 → 관리자 미리보기 / PDF(인쇄)가 100% 동일.
 * 자료(material) PDF는 별도(documentShell + DOC_CSS) 경로를 그대로 유지한다.
 *
 * 뉴스레터 데이터(versions.newsletter):
 *   { subject, intro, alert?, cover_emoji?,
 *     stats?:[{value,label}],
 *     headlines:[{title,summary,source,link,category?,emoji?}],
 *     deep_dive:{heading,body,emoji?}, tips?:[..], tip?, closing }
 *   (alert/stats/category/tips 없으면 자동 추론·생략으로 우아하게 대체)
 *
 * 노출: window.NewsletterTemplate
 */
(function () {
  function esc(s){ var d=document.createElement("div"); d.textContent = s==null?"":s; return d.innerHTML; }
  function escAttr(s){ return esc(s).replace(/"/g,"&quot;"); }
  function safeUrl(u){ return /^https?:\/\//i.test(u||"") ? u : ""; }
  function monthLabel(m){ if(!m) return ""; var p=String(m).split("-"); return p.length<2?m:(p[0]+"년 "+Number(p[1])+"월"); }

  /* 인라인 마크다운(굵게/기울임/목록/인용) */
  function inl(s){ return esc(s).replace(/\*\*(.+?)\*\*/g,'<strong style="color:#0a2a5c">$1</strong>').replace(/\*(.+?)\*/g,"<em>$1</em>"); }
  function mdi(text){
    var raw=String(text==null?"":text).split("\n"), html="", inList=false, inQ=false, qb=[];
    function fq(){ if(inQ){ html+='<div style="border-left:3px solid #16a34a;background:#f0fdf4;border-radius:0 8px 8px 0;padding:8px 13px;margin:9px 0;font-size:13px;line-height:1.6">'+qb.join("<br>")+"</div>"; qb=[]; inQ=false; } }
    function fl(){ if(inList){ html+="</ul>"; inList=false; } }
    for(var i=0;i<raw.length;i++){ var line=raw[i]; var q=line.match(/^\s*(?:>|&gt;)\s?(.*)$/);
      if(q){ fl(); inQ=true; qb.push(inl(q[1])); continue; } fq();
      if(/^\s*[-*] /.test(line)){ if(!inList){ html+='<ul style="margin:7px 0;padding-left:18px">'; inList=true; } html+='<li style="margin:3px 0">'+inl(line.replace(/^\s*[-*] /,""))+"</li>"; continue; }
      fl(); if(line.trim()==="") continue; html+='<p style="margin:7px 0">'+inl(line)+"</p>"; }
    fq(); fl(); return html;
  }

  /* ---- 카테고리별 SVG 아이콘 ---- */
  var I = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">';
  var ICONS = {
    deepfake:   { label:"딥페이크", bg:"#f3e8ff", color:"#7c3aed", svg:I+'<path d="M3 6c5.5-2.2 12.5-2.2 18 0 0 7.5-2.5 12.5-9 14.5C5.5 18.5 3 13.5 3 6z"/><circle cx="9" cy="10.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="10.5" r="1.1" fill="currentColor" stroke="none"/><path d="M9 15c1.8 1.2 4.2 1.2 6 0"/></svg>' },
    voice:      { label:"보이스피싱", bg:"#e8f0ff", color:"#1a56db", svg:I+'<path d="M6 3h3.5l1.5 5-2.2 1.6a11 11 0 004.6 4.6L11 13l5 1.5V18a2 2 0 01-2 2A14 14 0 014 6a2 2 0 012-3z"/></svg>' },
    phishing:   { label:"피싱·스미싱", bg:"#e8f0ff", color:"#1a56db", svg:I+'<rect x="2.5" y="6" width="13" height="11" rx="2"/><path d="M3 7.5l6.5 5 6.5-5"/><path d="M19 8.5c1.8 0 1.8 3 0 3s-1.8 3 0 3"/></svg>' },
    supplychain:{ label:"공급망", bg:"#e6f6ff", color:"#0891b2", svg:I+'<path d="M10 14a4 4 0 010-5.7l2-2a4 4 0 015.7 5.7l-1 1"/><path d="M14 10a4 4 0 010 5.7l-2 2A4 4 0 016.3 12l1-1"/></svg>' },
    insider:    { label:"내부자·권한", bg:"#fff1e6", color:"#d35400", svg:I+'<circle cx="8" cy="8" r="4"/><path d="M11 11l9 9"/><path d="M17 17l2.5-2.5"/><path d="M15 15l2.5-2.5"/></svg>' },
    ransomware: { label:"랜섬웨어", bg:"#fdeaea", color:"#c0392b", svg:I+'<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/><circle cx="12" cy="15.5" r="1.3" fill="currentColor" stroke="none"/></svg>' },
    vuln:       { label:"취약점", bg:"#fdeaea", color:"#c0392b", svg:I+'<rect x="8.5" y="8" width="7" height="10" rx="3.5"/><path d="M12 4.5v3M5 9.5l3 1M19 9.5l-3 1M5 14h3M16 14h3M6.5 18.5L9 16.5M17.5 18.5L15 16.5"/></svg>' },
    dataleak:   { label:"정보유출", bg:"#e7f7ef", color:"#0f766e", svg:I+'<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3 1.4 0 2.7-.2 3.8-.5"/></svg>' },
    general:    { label:"보안 이슈", bg:"#eef2f7", color:"#5b6b86", svg:I+'<path d="M12 4l9 16H3L12 4z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/></svg>' }
  };
  var EMOJI_CAT = { "🎭":"deepfake","📞":"voice","☎️":"voice","📱":"voice","🎣":"phishing","✉️":"phishing","📧":"phishing","💬":"phishing","🔗":"supplychain","⛓️":"supplychain","🔑":"insider","👤":"insider","🔒":"ransomware","🔐":"ransomware","🦠":"ransomware","🐛":"vuln","🩹":"vuln","🕳️":"vuln","📊":"dataleak","🗄️":"dataleak","💳":"dataleak" };
  function inferCat(text){
    var t=String(text||"");
    if(/딥페이크|deepfake|합성|사칭|영상통화|화상회의/i.test(t)) return "deepfake";
    if(/보이스피싱|전화|통화|음성/i.test(t)) return "voice";
    if(/피싱|스미싱|문자|메일|이메일|링크/i.test(t)) return "phishing";
    if(/공급망|협력사|외주|벤더|위탁/i.test(t)) return "supplychain";
    if(/내부자|퇴사|권한|인증키|계정|재직/i.test(t)) return "insider";
    if(/랜섬|악성코드|멀웨어|암호화/i.test(t)) return "ransomware";
    if(/취약점|패치|cve|업데이트|제로데이/i.test(t)) return "vuln";
    if(/유출|개인정보|과징금|데이터/i.test(t)) return "dataleak";
    return "general";
  }
  function iconFor(h){
    var c=(h.category||"").toLowerCase();
    if(!ICONS[c]) c = (h.emoji&&EMOJI_CAT[h.emoji]) ? EMOJI_CAT[h.emoji] : inferCat((h.title||"")+" "+(h.summary||""));
    var ic=ICONS[c]||ICONS.general; return { key:c, label:ic.label, bg:ic.bg, color:ic.color, svg:ic.svg };
  }

  function tipsList(nl){
    var t = Array.isArray(nl.tips) ? nl.tips.map(function(x){return String(x).trim();}).filter(Boolean) : [];
    if(!t.length && nl.tip){
      var parts = String(nl.tip).split(/[①②③④⑤⑥⑦⑧⑨]/);
      if(parts.length>1) t = parts.slice(1).map(function(s){return s.replace(/^[\s.·\-—]+|[\s.·\-—]+$/g,"");}).filter(Boolean);
      else t = [String(nl.tip).replace(/^📌\s*/,"")];
    }
    return t.slice(0,6);
  }

  var CHK = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px"><circle cx="12" cy="12" r="9" stroke="#a7f3d0"/><path d="M8 12.4l2.6 2.6L16 9.6"/></svg>';
  var SHIELD = '<svg width="92" height="92" viewBox="0 0 120 120" fill="none" aria-hidden="true"><path d="M60 16l34 13v26c0 24-15 40-34 47-19-7-34-23-34-47V29l34-13z" fill="#1a56db" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><path d="M60 44v24" stroke="#fff" stroke-width="6.5" stroke-linecap="round"/><circle cx="60" cy="83" r="4.4" fill="#fff"/></svg>';
  var RINGS = '<svg width="180" height="180" viewBox="0 0 180 180" fill="none" aria-hidden="true" style="position:absolute;right:-30px;top:-26px;opacity:.5"><circle cx="120" cy="60" r="78" stroke="#fff" stroke-opacity=".10" stroke-width="2"/><circle cx="120" cy="60" r="58" stroke="#fff" stroke-opacity=".14" stroke-width="2"/><circle cx="120" cy="60" r="38" stroke="#fff" stroke-opacity=".18" stroke-width="2"/></svg>';
  var ALERTSVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" style="flex-shrink:0"><path d="M12 3.5l9.5 16.5H2.5L12 3.5z" fill="#ffd9a0" stroke="#c77800" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 10v4.2" stroke="#8a4b00" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17.4" r="1.15" fill="#8a4b00"/></svg>';
  var SHIELDOK = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 2.5V11c0 5-3 8.5-7 10-4-1.5-7-5-7-10V5.5L12 3z"/><path d="M9 12l2 2 4-4"/></svg>';

  function flowHtml(nl){
    var seen={}, items=[];
    (nl.headlines||[]).forEach(function(h){ var ic=iconFor(h); if(ic.key!=="general" && !seen[ic.key]){ seen[ic.key]=1; items.push(ic); } });
    items = items.slice(0,3);
    if(items.length<2) return "";
    var nodes = items.map(function(ic){
      return '<div style="display:flex;flex-direction:column;align-items:center;gap:5px;width:72px;text-align:center;font-size:10.5px;color:#5b6b86;font-weight:700">'+
        '<div style="width:42px;height:42px;border-radius:11px;background:'+ic.bg+';color:'+ic.color+';display:flex;align-items:center;justify-content:center">'+ic.svg+"</div>"+esc(ic.label)+"</div>";
    }).join('<span style="color:#9fb0c8;font-weight:800;font-size:16px">→</span>');
    var shield='<span style="color:#9fb0c8;font-weight:800;font-size:16px">→</span><div style="display:flex;flex-direction:column;align-items:center;gap:5px;width:72px;text-align:center;font-size:10.5px;color:#0f6e56;font-weight:800"><div style="width:46px;height:46px;border-radius:12px;background:#e7f7ef;color:#047857;display:flex;align-items:center;justify-content:center">'+SHIELDOK+'</div>한 번 더<br>확인</div>';
    return '<div style="display:flex;align-items:center;gap:8px;font-size:15px;font-weight:800;color:#0a2a5c;margin:26px 0 12px"><span style="width:4px;height:17px;border-radius:2px;background:#1a56db"></span> 🔎 한눈에 보는 공격 흐름</div>'+
      '<div style="display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;background:#f7f9fc;border:1px solid #e6ecf5;border-radius:12px;padding:14px;margin:0 0 4px">'+nodes+shield+"</div>";
  }

  /* ====== 뉴스레터 전체 렌더 (인라인) ====== */
  function renderNewsletterFull(nl, label){
    nl = nl||{};
    var sectionTitle = function(t){ return '<div style="display:flex;align-items:center;gap:8px;font-size:15px;font-weight:800;color:#0a2a5c;margin:26px 0 12px"><span style="width:4px;height:17px;border-radius:2px;background:#1a56db"></span> '+t+"</div>"; };

    var hero = '<div style="position:relative;overflow:hidden;background:linear-gradient(150deg,#0a2a5c 0%,#0c3a86 60%,#123f9e 100%);color:#fff;padding:26px 28px 30px">'+RINGS+
      '<span style="display:inline-block;font-size:11px;font-weight:800;letter-spacing:.12em;color:#bcd2ff;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.22);border-radius:999px;padding:5px 12px;position:relative">'+esc(label)+' · 정보보호의 날</span>'+
      '<div style="display:flex;align-items:center;gap:16px;position:relative;margin-top:14px">'+
        '<h1 style="flex:1;font-size:24px;line-height:1.34;font-weight:800;margin:0">'+esc(nl.subject)+"</h1>"+
        '<div style="flex-shrink:0">'+SHIELD+"</div></div></div>";

    var alert = nl.alert ? '<div style="display:flex;gap:11px;align-items:center;background:#fff4e5;border-bottom:1px solid #ffe2b8;color:#8a4b00;padding:12px 22px;font-size:13.5px;font-weight:700;line-height:1.5">'+ALERTSVG+" "+esc(nl.alert)+"</div>" : "";

    var stats = (nl.stats||[]).filter(function(s){return s&&s.value;}).slice(0,3);
    var statStrip = stats.length ? '<div style="display:grid;grid-template-columns:repeat('+stats.length+',1fr);gap:1px;background:#e7ecf4">'+
      stats.map(function(s){ return '<div style="background:#fff;padding:16px 10px;text-align:center"><div style="font-size:21px;font-weight:800;color:#c0392b;line-height:1.1">'+esc(s.value)+'</div><div style="font-size:11px;color:#5b6b86;font-weight:600;margin-top:5px;line-height:1.4">'+esc(s.label)+"</div></div>"; }).join("")+"</div>" : "";

    var heads = (nl.headlines||[]).map(function(h){
      var ic=iconFor(h), link=safeUrl(h.link);
      return '<div style="display:flex;gap:13px;border:1px solid #e6ecf5;border-radius:13px;padding:14px 15px;margin:11px 0;box-shadow:0 2px 9px rgba(10,42,92,.05)">'+
        '<div style="flex-shrink:0;width:46px;height:46px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:'+ic.bg+';color:'+ic.color+'">'+ic.svg+"</div>"+
        '<div style="min-width:0"><h3 style="font-size:14.5px;font-weight:800;line-height:1.4;margin:1px 0 5px;color:#1f2937">'+esc(h.title)+"</h3>"+
        '<div style="font-size:13px;line-height:1.65;color:#41506b">'+mdi(h.summary)+"</div>"+
        ((h.source||link)?'<div style="margin-top:8px">'+(h.source?'<span style="font-size:11px;color:#5b6b86;font-weight:600;background:#eef2f7;border-radius:999px;padding:3px 9px">'+esc(h.source)+"</span>":"")+(link?' <a href="'+escAttr(link)+'" target="_blank" rel="noopener" style="font-size:12px;font-weight:700;color:#1a56db;text-decoration:none;margin-left:6px">원문 ↗</a>':"")+"</div>":"")+
        "</div></div>";
    }).join("");
    var newsSection = heads ? sectionTitle("📰 이달의 보안 뉴스")+heads : "";

    var dd = nl.deep_dive||{};
    var deepSection = dd.body ? sectionTitle((esc(dd.emoji||"🧩"))+" "+esc(dd.heading||"이달의 심층 분석"))+'<div style="font-size:13.5px;line-height:1.8;color:#34405a">'+mdi(dd.body)+"</div>" : "";

    var tips = tipsList(nl);
    var tipsSection = tips.length ? '<div style="background:linear-gradient(135deg,#f0faf5,#eefcff);border:1px solid #c7ecd8;border-radius:14px;padding:16px 18px;margin:18px 0">'+
      '<div style="font-size:14px;font-weight:800;color:#0f6e56;margin-bottom:10px;display:flex;align-items:center;gap:7px"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0f6e56" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg> 오늘의 보안 수칙</div>'+
      tips.map(function(t){ return '<div style="display:flex;gap:10px;align-items:flex-start;font-size:13.5px;line-height:1.55;color:#243244;margin:9px 0">'+CHK+" "+esc(t)+"</div>"; }).join("")+"</div>" : "";

    var closing = nl.closing ? '<div style="font-size:13.5px;line-height:1.75;color:#41506b;margin-top:18px;border-top:1px dashed #dce3ee;padding-top:16px">'+mdi(nl.closing)+"</div>" : "";

    var foot = '<div style="background:#0a2a5c;color:#9db9e8;font-size:11.5px;text-align:center;padding:15px"><b style="color:#fff">secuday.jbax.co.kr</b> · 정보보호팀 — 매월 1일 정보보호의 날</div>';

    return '<div style="max-width:640px;margin:0 auto;background:#fff;color:#1f2937;border-radius:14px;overflow:hidden;border:1px solid #e3e9f2;font-family:\'Apple SD Gothic Neo\',\'Malgun Gothic\',\'Noto Sans KR\',-apple-system,sans-serif">'+
      hero+alert+statStrip+
      '<div style="padding:22px 24px"><div style="font-size:14px;line-height:1.8;color:#34405a">'+mdi(nl.intro)+"</div>"+newsSection+flowHtml(nl)+deepSection+tipsSection+closing+"</div>"+
      foot+"</div>";
  }

  /* 인쇄(PDF)용 — 뉴스레터 */
  var PRINT_BASE_CSS =
    "*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
    "body{margin:0;background:#eef1f6;padding:18px 0;font-family:'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',-apple-system,sans-serif}" +
    "@page{size:A4;margin:10mm}@media print{body{background:#fff;padding:0}}";
  function buildPrintDocument(nl, monthStr){
    var label=monthLabel(monthStr), title="정보보호의날_뉴스레터_"+(monthStr||"");
    return "<!DOCTYPE html><html lang=\"ko\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>"+esc(title)+"</title><style>"+PRINT_BASE_CSS+"</style></head><body>"+renderNewsletterFull(nl,label)+"</body></html>";
  }

  /* ====== 자료(material) — 기존 경로 유지 ====== */
  function documentShell(bodyHtml, label, subtitle, foot){
    subtitle = subtitle || "금융권 보안 인식 뉴스레터";
    foot = foot || "secuday.jbax.co.kr · 정보보호팀";
    return '<div class="nl-doc"><div class="nl-band"><div class="t">🛡 secuday · 정보보호의 날</div><div class="s">'+esc(label)+" · "+esc(subtitle)+"</div></div>"+bodyHtml+'<div class="nl-foot">'+esc(foot)+"</div></div>";
  }
  function renderMaterialBody(mat, posterUrl){
    mat = mat||{};
    var rules=(mat.rules||[]).map(function(r){return "<li>"+esc(r)+"</li>";}).join("");
    return '<article class="nl"><div class="nl-cover"><div class="nl-cover-emoji">🛡️</div><h2 class="nl-subject">'+esc(mat.title)+"</h2>"+
      (mat.theme?'<div class="nl-cover-tag">'+esc(mat.theme)+"</div>":"")+"</div>"+
      (posterUrl?'<div class="mat-poster"><img src="'+escAttr(posterUrl)+'" alt="포스터"></div>':"")+
      (mat.content?'<h3 class="nl-h"><span class="nl-h-ico">📋</span> 안내 내용</h3><div class="nl-body">'+mdi(mat.content)+"</div>":"")+
      (rules?'<h3 class="nl-h"><span class="nl-h-ico">✅</span> 임직원 수칙</h3><ol class="mat-rules">'+rules+"</ol>":"")+"</article>";
  }
  var DOC_CSS =
    "*{box-sizing:border-box}body{margin:0;background:#eef1f6;color:#1f2937;font-family:'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',-apple-system,sans-serif}" +
    ".nl-doc{max-width:720px;margin:20px auto;background:#fff;border:1px solid #dde3ec;border-radius:14px;overflow:hidden}" +
    ".nl-band{background:#0a2a5c;color:#fff;padding:22px 32px;-webkit-print-color-adjust:exact;print-color-adjust:exact}.nl-band .t{font-size:20px;font-weight:800}.nl-band .s{font-size:13px;color:#9db9e8;margin-top:4px}" +
    ".nl{padding:28px 30px;line-height:1.75}.nl-cover{text-align:center;background:linear-gradient(135deg,#eef4ff,#e7fbff);border:1px solid #e3ebf7;border-radius:16px;padding:26px 22px;margin-bottom:22px;-webkit-print-color-adjust:exact;print-color-adjust:exact}.nl-cover-emoji{font-size:46px;line-height:1;margin-bottom:10px}.nl-cover-tag{display:inline-block;margin-top:10px;font-size:12px;font-weight:700;color:#1a56db;background:#e8efff;border-radius:999px;padding:4px 12px}" +
    ".nl-subject{color:#0a2a5c;margin:0;font-size:22px;line-height:1.42;font-weight:800}" +
    ".nl-h{display:flex;align-items:center;gap:9px;font-size:16px;font-weight:800;color:#0a2a5c;margin:28px 0 12px}.nl-h-ico{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9px;background:#eef2ff;font-size:16px;flex-shrink:0}" +
    ".nl-body{line-height:1.8}.nl-body p{margin:8px 0}.nl-body strong{color:#0a2a5c}" +
    ".mat-poster{text-align:center;margin:16px 0}.mat-poster img{max-width:100%;border:1px solid #dde3ec;border-radius:10px;break-inside:avoid}.mat-rules{margin:6px 0;padding-left:22px}.mat-rules li{margin:6px 0;line-height:1.7}" +
    ".nl-foot{background:#f4f6fa;color:#9aa3b2;font-size:12px;text-align:center;padding:18px;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
    "@page{size:A4;margin:12mm}@media print{body{background:#fff}.nl-doc{border:none;border-radius:0;margin:0;max-width:none}}";
  function buildMaterialPrintDocument(mat, monthStr, posterUrl){
    var label=monthLabel(monthStr), title="정보보호의날_자료_"+(monthStr||"");
    return "<!DOCTYPE html><html lang=\"ko\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>"+esc(title)+"</title><style>"+DOC_CSS+"</style></head><body>"+documentShell(renderMaterialBody(mat,posterUrl),label,"금융권 보안 인식 자료","secuday.jbax.co.kr · 정보보호팀")+"</body></html>";
  }

  window.NewsletterTemplate = {
    esc:esc, escAttr:escAttr, safeUrl:safeUrl, md:mdi, monthLabel:monthLabel,
    renderNewsletterFull:renderNewsletterFull, buildPrintDocument:buildPrintDocument,
    documentShell:documentShell, renderMaterialBody:renderMaterialBody, buildMaterialPrintDocument:buildMaterialPrintDocument,
  };
})();
