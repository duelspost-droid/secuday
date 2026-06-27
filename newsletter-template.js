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
  /* 인라인 마크다운(색 강제 없음) — 어두운 배경에서도 보이도록 굵게/기울임만 변환 */
  function inlLight(s){ return esc(s).replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/\*(.+?)\*/g,"<em>$1</em>"); }

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

  /* 섹션 제목(파란 세로바 + 텍스트) — 모든 렌더러 공용 */
  function sectionTitle(t){ return '<div style="display:flex;align-items:center;gap:8px;font-size:15px;font-weight:800;color:#0a2a5c;margin:26px 0 12px"><span style="width:4px;height:17px;border-radius:2px;background:#1a56db"></span> '+t+"</div>"; }

  /* ====== 표준형 렌더 (인라인) — '오늘의 보안 수칙'을 전면 배치 ====== */
  function renderStandard(nl, label){
    nl = nl||{};

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
    var tipsSection = tips.length ? '<div style="background:linear-gradient(135deg,#f0faf5,#eefcff);border:1px solid #c7ecd8;border-radius:14px;padding:18px 20px;margin:18px 0;break-inside:avoid">'+
      '<div style="font-size:16px;font-weight:800;color:#0f6e56;display:flex;align-items:center;gap:8px"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0f6e56" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg> 오늘의 보안 수칙</div>'+
      '<div style="font-size:12px;color:#0f6e56;opacity:.85;margin:3px 0 12px 30px">이달 꼭 지켜주세요</div>'+
      tips.map(function(t,i){ return '<div style="display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.6;color:#243244;margin:9px 0">'+CHK+' <span><b style="color:#0f6e56">'+(i+1)+'.</b> '+esc(t)+"</span></div>"; }).join("")+"</div>" : "";

    var closing = nl.closing ? '<div style="font-size:13.5px;line-height:1.75;color:#41506b;margin-top:18px;border-top:1px dashed #dce3ee;padding-top:16px">'+mdi(nl.closing)+"</div>" : "";

    var foot = '<div style="background:#0a2a5c;color:#9db9e8;font-size:11.5px;text-align:center;padding:15px"><b style="color:#fff">secuday.jbax.co.kr</b> · 정보보호팀 — 매월 1일 정보보호의 날</div>';

    return '<div style="max-width:640px;margin:0 auto;background:#fff;color:#1f2937;border-radius:14px;overflow:hidden;border:1px solid #e3e9f2;font-family:\'Apple SD Gothic Neo\',\'Malgun Gothic\',\'Noto Sans KR\',-apple-system,sans-serif">'+
      hero+alert+statStrip+
      '<div style="padding:22px 24px"><div style="font-size:14px;line-height:1.8;color:#34405a">'+mdi(nl.intro)+"</div>"+tipsSection+newsSection+flowHtml(nl)+deepSection+closing+"</div>"+
      foot+"</div>";
  }


  /* ===== 만화/카드/원페이저 렌더러 (워크플로 합성: flat-corporate 기준) ===== */
/* ===== 만화 4컷 아트 (가로 만화형 / 세로 메일첨부형 공용) =====
   캐릭터(victim/attacker) + 장면별 소품을 그리는 단일 소스. renderComic·buildEmailVertical이 함께 사용. */
var CMC_NAVY="#0a2a5c", CMC_BLUE="#1a56db", CMC_DANGER="#c0392b", CMC_SAFE="#16a34a", CMC_WARN="#c77800";
function comicFace(mood){
  var eyes, mouth, brow="";
  if(mood==="worried"){
    eyes='<circle cx="-7" cy="0" r="2.6" fill="#1f2937"/><circle cx="7" cy="0" r="2.6" fill="#1f2937"/>';
    brow='<path d="M -12 -7 L -3 -5 M 12 -7 L 3 -5" stroke="#1f2937" stroke-width="1.9" stroke-linecap="round" fill="none"/>';
    mouth='<path d="M -6 11 Q 0 7 6 11" stroke="#1f2937" stroke-width="2" fill="none" stroke-linecap="round"/>';
  } else if(mood==="shocked"){
    eyes='<circle cx="-7" cy="0" r="3.4" fill="#fff" stroke="#1f2937" stroke-width="1.6"/><circle cx="-7" cy="0" r="1.5" fill="#1f2937"/><circle cx="7" cy="0" r="3.4" fill="#fff" stroke="#1f2937" stroke-width="1.6"/><circle cx="7" cy="0" r="1.5" fill="#1f2937"/>';
    brow='<path d="M -12 -9 L -3 -10 M 12 -9 L 3 -10" stroke="#1f2937" stroke-width="1.6" stroke-linecap="round" fill="none"/>';
    mouth='<ellipse cx="0" cy="11" rx="4" ry="5" fill="#7f1d1d"/>';
  } else if(mood==="relieved"){
    eyes='<path d="M -10 0 Q -7 -4 -4 0" stroke="#1f2937" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M 4 0 Q 7 -4 10 0" stroke="#1f2937" stroke-width="2" fill="none" stroke-linecap="round"/>';
    mouth='<path d="M -7 9 Q 0 16 7 9" stroke="#1f2937" stroke-width="2.2" fill="none" stroke-linecap="round"/>';
  } else if(mood==="sinister"){
    eyes='<path d="M -11 -2 L -3 1 M 11 -2 L 3 1" stroke="#1f2937" stroke-width="2" stroke-linecap="round" fill="none"/><circle cx="-7" cy="1" r="2" fill="#1f2937"/><circle cx="7" cy="1" r="2" fill="#1f2937"/>';
    mouth='<path d="M -7 11 Q 0 8 7 12" stroke="#1f2937" stroke-width="2" fill="none" stroke-linecap="round"/>';
  } else {
    eyes='<circle cx="-7" cy="0" r="2.6" fill="#1f2937"/><circle cx="7" cy="0" r="2.6" fill="#1f2937"/>';
    mouth='<path d="M -6 10 L 6 10" stroke="#1f2937" stroke-width="2" fill="none" stroke-linecap="round"/>';
  }
  return brow+eyes+mouth;
}
function comicVictim(x,y,bodyColor,mood,scale){
  scale=scale||1;
  return '<g transform="translate('+x+','+y+') scale('+scale+')">'+
    '<rect x="-26" y="34" width="52" height="40" rx="14" fill="'+bodyColor+'"/>'+
    '<circle cx="0" cy="8" r="24" fill="#f7d9b8"/>'+
    '<path d="M -24 2 Q 0 -28 24 2 Q 18 -10 0 -12 Q -18 -10 -24 2 Z" fill="'+CMC_NAVY+'"/>'+
    '<g transform="translate(0,8)">'+comicFace(mood)+'</g>'+
  '</g>';
}
function comicAttacker(x,y,mood,scale){
  scale=scale||1;
  return '<g transform="translate('+x+','+y+') scale('+scale+')">'+
    '<path d="M -30 74 Q -30 30 0 26 Q 30 30 30 74 Z" fill="#111827"/>'+
    '<circle cx="0" cy="8" r="23" fill="#d9b48f"/>'+
    '<path d="M -28 8 Q -30 -24 0 -26 Q 30 -24 28 8 Q 22 -6 0 -8 Q -22 -6 -28 8 Z" fill="#1f2937"/>'+
    '<path d="M -28 8 Q -30 -26 0 -28 Q 30 -26 28 8 L 30 26 Q 14 14 0 14 Q -14 14 -30 26 Z" fill="#111827" opacity="0.9"/>'+
    '<g transform="translate(0,9)">'+comicFace(mood||"sinister")+'</g>'+
  '</g>';
}
function comicSceneSVG(scene, mood){
  var NAVY=CMC_NAVY, BLUE=CMC_BLUE, DANGER=CMC_DANGER, SAFE=CMC_SAFE, WARN=CMC_WARN;
  var safe = (scene==="shield-verify" || scene==="double-check" || mood==="relieved");
  var bg = safe ? "#eafaf0" : (mood==="shocked" ? "#fdecea" : (mood==="worried" ? "#fff4e6" : "#eef3fb"));
  var head='<svg viewBox="0 0 200 150" width="100%" height="150" xmlns="http://www.w3.org/2000/svg" style="display:block;">'+
           '<rect x="0" y="0" width="200" height="150" rx="10" fill="'+bg+'"/>';
  var foot='</svg>';
  var art="";
  if(scene==="phone-call"){
    art = comicAttacker(52,56,"sinister",0.9)+
      '<g transform="translate(150,55)">'+
        '<rect x="-16" y="-26" width="32" height="56" rx="7" fill="'+NAVY+'"/>'+
        '<rect x="-12" y="-20" width="24" height="40" rx="3" fill="#cfe0ff"/>'+
        '<circle cx="0" cy="25" r="2.5" fill="#cfe0ff"/>'+
        '<g stroke="'+DANGER+'" stroke-width="2.4" fill="none" stroke-linecap="round">'+
          '<path d="M 22 -22 Q 30 -18 30 -10"/><path d="M 26 -30 Q 40 -24 40 -10"/>'+
        '</g>'+
      '</g>';
  } else if(scene==="phone-pressure"){
    art = comicVictim(70,52,BLUE,mood,1)+
      '<g transform="translate(150,55)">'+
        '<rect x="-16" y="-26" width="32" height="56" rx="7" fill="'+DANGER+'"/>'+
        '<rect x="-12" y="-20" width="24" height="40" rx="3" fill="#ffe1dc"/>'+
        '<text x="0" y="6" font-family="sans-serif" font-size="20" font-weight="700" fill="'+DANGER+'" text-anchor="middle">!</text>'+
      '</g>'+
      '<g stroke="'+WARN+'" stroke-width="2.4" fill="none" stroke-linecap="round" transform="translate(112,40)">'+
        '<path d="M 0 0 L 12 -6"/><path d="M 0 8 L 12 8"/><path d="M 0 16 L 12 22"/>'+
      '</g>';
  } else if(scene==="money-loss"){
    art = comicVictim(64,55,BLUE,mood,1)+
      '<g transform="translate(150,70)">'+
        '<rect x="-22" y="-14" width="44" height="28" rx="5" fill="#f7d4cf" stroke="'+DANGER+'" stroke-width="2"/>'+
        '<circle cx="0" cy="0" r="9" fill="#fff" stroke="'+DANGER+'" stroke-width="2"/>'+
        '<text x="0" y="5" font-family="sans-serif" font-size="12" font-weight="700" fill="'+DANGER+'" text-anchor="middle">&#8361;</text>'+
      '</g>'+
      '<g stroke="'+DANGER+'" stroke-width="2.6" fill="none" stroke-linecap="round" transform="translate(104,46)">'+
        '<path d="M 0 0 L 22 -6"/><path d="M 2 10 L 24 6"/><path d="M 0 20 L 22 18"/>'+
      '</g>'+
      '<text x="150" y="120" font-family="sans-serif" font-size="11" font-weight="700" fill="'+DANGER+'" text-anchor="middle">&#8722;&#51060;&#52404;&#50756;&#47308;</text>';
  } else if(scene==="email-phishing" || scene==="link-trap"){
    art = comicVictim(58,55,BLUE,mood,1)+
      '<g transform="translate(140,60)">'+
        '<rect x="-26" y="-18" width="52" height="36" rx="5" fill="#fff" stroke="'+NAVY+'" stroke-width="2"/>'+
        '<path d="M -26 -16 L 0 4 L 26 -16" fill="none" stroke="'+NAVY+'" stroke-width="2"/>'+
        '<circle cx="20" cy="14" r="11" fill="'+DANGER+'"/>'+
        '<path d="M 16 14 L 24 14 M 22 14 L 19 11 M 22 14 L 19 17" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'+
      '</g>';
  } else if(scene==="data-leak"){
    art = '<g transform="translate(100,70)">'+
        '<rect x="-30" y="-22" width="60" height="44" rx="6" fill="'+NAVY+'"/>'+
        '<rect x="-22" y="-14" width="44" height="6" rx="3" fill="#cfe0ff"/>'+
        '<rect x="-22" y="-2" width="32" height="6" rx="3" fill="#cfe0ff"/>'+
        '<g transform="translate(34,18)"><path d="M 0 0 Q 14 4 14 18" stroke="'+DANGER+'" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="14" cy="18" r="4" fill="'+DANGER+'"/></g>'+
      '</g>';
  } else if(scene==="ransomware-lock"){
    art = '<g transform="translate(100,68)">'+
        '<rect x="-24" y="-6" width="48" height="40" rx="6" fill="'+DANGER+'"/>'+
        '<path d="M -14 -6 V -16 a14 14 0 0 1 28 0 V -6" fill="none" stroke="'+NAVY+'" stroke-width="5"/>'+
        '<circle cx="0" cy="12" r="5" fill="#fff"/><rect x="-2.5" y="12" width="5" height="11" fill="#fff"/>'+
      '</g>';
  } else if(scene==="hacker"){
    art = comicAttacker(100,52,"sinister",1.05)+
      '<g stroke="#111827" stroke-width="2" fill="none" stroke-linecap="round" transform="translate(150,46)">'+
        '<path d="M 0 0 L 14 -5"/><path d="M 0 9 L 14 9"/><path d="M 0 18 L 14 23"/>'+
      '</g>';
  } else if(scene==="double-check"){
    art = comicVictim(64,55,BLUE,mood,1)+
      '<g transform="translate(150,60)">'+
        '<circle cx="0" cy="0" r="22" fill="#fff" stroke="'+SAFE+'" stroke-width="3"/>'+
        '<path d="M -10 1 L -3 9 L 12 -8" stroke="'+SAFE+'" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'+
      '</g>';
  } else {
    art = comicVictim(58,55,SAFE,mood,1)+
      '<g transform="translate(146,62)">'+
        '<path d="M 0 -28 L 26 -18 V 6 Q 26 26 0 36 Q -26 26 -26 6 V -18 Z" fill="'+SAFE+'"/>'+
        '<path d="M -11 2 L -3 12 L 13 -8" stroke="#fff" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'+
      '</g>';
  }
  return head+art+foot;
}
/* 한 컷 카드(번호 배지 + 장면 + 화자 + 말풍선 + 캡션) — 가로/세로 공용 */
function comicPanelCard(p, k){
  p = p||{};
  var INK="#1f2937", MUT="#6b7280", LINE="#e5e7eb";
  var circled=["①","②","③","④","⑤","⑥"];
  var v=function(x){ return (x===null||x===undefined)?"":String(x); };
  var sc=v(p.scene)||"shield-verify", md=v(p.mood)||"neutral";
  var isSafe=(sc==="shield-verify"||sc==="double-check"||md==="relieved"||k===3);
  var accent=isSafe?CMC_SAFE:(k===2?CMC_DANGER:(k===1?CMC_WARN:CMC_BLUE));
  var bubbleBg=isSafe?"#eafaf0":"#f3f6fc";
  var bubbleBorder=isSafe?"#bfe8cd":"#dbe5f5";
  return '<div style="flex:1 1 calc(50% - 7px);min-width:240px;box-sizing:border-box;border:1px solid '+LINE+';border-radius:14px;overflow:hidden;background:#fff;break-inside:avoid;position:relative;">'+
    '<div style="position:absolute;top:8px;left:8px;z-index:2;width:30px;height:30px;border-radius:50%;background:'+accent+';color:#fff;font-size:16px;font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.25);">'+(circled[k]||(k+1))+'</div>'+
    comicSceneSVG(sc,md)+
    '<div style="padding:12px 12px 4px 12px;">'+
      (v(p.speaker)?'<div style="font-size:11px;font-weight:800;color:'+accent+';margin-bottom:5px;">'+esc(v(p.speaker))+'</div>':'')+
      '<div style="position:relative;background:'+bubbleBg+';border:1px solid '+bubbleBorder+';border-radius:12px;padding:10px 12px;font-size:13.5px;line-height:1.5;color:'+INK+';">'+
        '<span style="position:absolute;top:-7px;left:16px;width:12px;height:12px;background:'+bubbleBg+';border-left:1px solid '+bubbleBorder+';border-top:1px solid '+bubbleBorder+';transform:rotate(45deg);"></span>'+
        esc(v(p.speech))+
      '</div>'+
    '</div>'+
    (v(p.caption)?'<div style="padding:8px 12px 12px 12px;font-size:12px;color:'+MUT+';border-top:1px dashed '+LINE+';margin-top:8px;">'+esc(v(p.caption))+'</div>':'<div style="height:6px;"></div>')+
  '</div>';
}

function renderComic(nl, label){
  nl = nl || {};
  var NAVY="#0a2a5c", BLUE="#1a56db", DANGER="#c0392b", SAFE="#16a34a", WARN="#c77800";
  var INK="#1f2937", MUT="#6b7280", LINE="#e5e7eb", PAPER="#ffffff";
  function val(v){ return (v===null||v===undefined)?"":String(v); }

  /* 캐릭터·장면·한 컷 카드는 모듈 공용(comicFace/comicVictim/comicAttacker/comicSceneSVG/comicPanelCard) 사용 */

  var SHIELDMARK='<svg viewBox="0 0 48 56" width="40" height="46" xmlns="http://www.w3.org/2000/svg" style="display:block;">'+
    '<path d="M24 2 L44 10 V28 Q44 46 24 54 Q4 46 4 28 V10 Z" fill="#ffffff" opacity="0.16"/>'+
    '<path d="M24 9 L38 14 V28 Q38 41 24 47 Q10 41 10 28 V14 Z" fill="#ffffff"/>'+
    '<path d="M17 28 L22 34 L32 21" stroke="'+NAVY+'" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'+
  '</svg>';

  var subject = esc(val(nl.subject)||"정보보호 뉴스레터");
  var lbl = esc(val(label));
  var tips = tipsList(nl)||[];
  var heroTip = tips.length? tips[0] : "의심스러우면 멈추고 직접 확인하세요";
  var restTips = tips.slice(1,6);

  var panels = (nl.comic && nl.comic.panels && nl.comic.panels.length)? nl.comic.panels.slice(0,4) : null;
  if(!panels){
    var scenes=["phone-call","link-trap","money-loss","shield-verify"];
    var moods=["sinister","worried","shocked","relieved"];
    var speakers=["사칭범","사칭범","피해 직원","안전"];
    var caps=["이렇게 시작됩니다","이런 함정에 빠집니다","피해는 순식간입니다","오늘의 수칙으로 막습니다"];
    var speeches=[
      "공공기관을 사칭해 접근합니다.",
      tips[1]||tips[0]||"출처 불명 링크와 앱 설치를 유도합니다.",
      "돈은 순식간에 빠져나갑니다.",
      tips[0]||"끊고, 직접, 공식 번호로 확인하세요."
    ];
    panels=[];
    for(var i=0;i<4;i++){
      panels.push({scene:scenes[i],mood:moods[i],speaker:speakers[i],speech:speeches[i],caption:caps[i]});
    }
  }
  while(panels.length<4){ panels.push({scene:"shield-verify",mood:"relieved",speaker:"안전",speech:tips[0]||"끊고, 직접, 확인!",caption:"오늘의 수칙으로 막습니다"}); }

  var html='<div style="max-width:640px;margin:0 auto;background:'+PAPER+';border-radius:18px;overflow:hidden;font-family:\'Malgun Gothic\',\'Apple SD Gothic Neo\',sans-serif;color:'+INK+';box-shadow:0 1px 3px rgba(0,0,0,0.08);">';

  html+='<div style="background:linear-gradient(135deg,'+NAVY+' 0%,#123a7a 100%);padding:22px 24px;color:#fff;break-inside:avoid;">'+
    '<div style="display:flex;align-items:center;gap:14px;">'+
      '<div style="flex:0 0 auto;">'+SHIELDMARK+'</div>'+
      '<div style="flex:1 1 auto;min-width:0;">'+
        (lbl?'<div style="font-size:12px;letter-spacing:1px;color:#9db8e8;font-weight:700;margin-bottom:4px;">'+lbl+'</div>':'')+
        '<div style="font-size:19px;font-weight:800;line-height:1.35;">'+subject+'</div>'+
      '</div>'+
    '</div>'+
  '</div>';

  html+='<div style="padding:20px 24px 6px 24px;">'+
    '<div style="background:linear-gradient(135deg,#eff5ff 0%,#e3edff 100%);border:1px solid #cfe0ff;border-radius:16px;padding:18px 18px 16px 18px;break-inside:avoid;">'+
      '<div style="display:inline-block;background:'+BLUE+';color:#fff;font-size:12px;font-weight:800;padding:5px 12px;border-radius:999px;letter-spacing:0.5px;">오늘의 보안수칙</div>'+
      '<div style="display:flex;align-items:center;gap:14px;margin-top:14px;">'+
        '<div style="flex:0 0 auto;width:46px;height:46px;border-radius:12px;background:'+NAVY+';display:flex;align-items:center;justify-content:center;">'+
          '<svg viewBox="0 0 24 24" width="26" height="26" xmlns="http://www.w3.org/2000/svg"><path d="M12 2 L20 5 V12 Q20 19 12 22 Q4 19 4 12 V5 Z" fill="#fff"/><path d="M8.5 12 L11 14.5 L16 9" stroke="'+NAVY+'" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'+
        '</div>'+
        '<div style="flex:1 1 auto;font-size:19px;font-weight:800;color:'+NAVY+';line-height:1.4;">'+esc(heroTip)+'</div>'+
      '</div>';
  if(restTips.length){
    html+='<div style="margin-top:14px;border-top:1px dashed #b9d0f7;padding-top:12px;">';
    for(var t=0;t<restTips.length;t++){
      html+='<div style="display:flex;align-items:flex-start;gap:9px;margin-bottom:8px;">'+
        '<svg viewBox="0 0 20 20" width="18" height="18" style="flex:0 0 auto;margin-top:1px;" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="9" fill="'+SAFE+'"/><path d="M6 10 L9 13 L14.5 7" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'+
        '<div style="font-size:14px;line-height:1.5;color:'+INK+';">'+esc(restTips[t])+'</div>'+
      '</div>';
    }
    html+='</div>';
  }
  html+='</div></div>';

  if(val(nl.intro)){
    html+='<div style="padding:8px 24px 0 24px;font-size:14px;line-height:1.6;color:'+MUT+';">'+mdi(val(nl.intro))+'</div>';
  }

  html+='<div style="padding:16px 24px 4px 24px;">'+sectionTitle("4컷 시나리오: 상황·함정·피해·수칙")+'</div>';
  html+='<div style="padding:4px 24px 8px 24px;display:flex;flex-wrap:wrap;gap:14px;">';
  for(var k=0;k<panels.length;k++){ html+=comicPanelCard(panels[k],k); }
  html+='</div>';

  if(val(nl.alert)){
    html+='<div style="padding:8px 24px;break-inside:avoid;">'+
      '<div style="display:flex;align-items:center;gap:12px;background:#fdecea;border:1px solid #f3c0ba;border-left:5px solid '+DANGER+';border-radius:10px;padding:13px 15px;">'+
        '<svg viewBox="0 0 24 24" width="24" height="24" style="flex:0 0 auto;" xmlns="http://www.w3.org/2000/svg"><path d="M12 3 L22 20 H2 Z" fill="'+DANGER+'"/><rect x="11" y="9" width="2" height="6" rx="1" fill="#fff"/><circle cx="12" cy="17" r="1.3" fill="#fff"/></svg>'+
        '<div style="font-size:13.5px;font-weight:700;color:'+DANGER+';line-height:1.45;">'+esc(val(nl.alert))+'</div>'+
      '</div>'+
    '</div>';
  }

  if(val(nl.closing)){
    html+='<div style="padding:6px 24px 24px 24px;">'+
      '<div style="background:'+NAVY+';color:#fff;border-radius:12px;padding:14px 16px;font-size:13.5px;line-height:1.55;break-inside:avoid;">'+inlLight(val(nl.closing))+'</div>'+
    '</div>';
  }

  html+='</div>';
  return html;
}

function renderCard(nl, label){
  nl = nl || {};
  var NAVY="#0a2a5c", BLUE="#1a56db", DANGER="#c0392b", SAFE="#16a34a", WARN="#c77800";
  var INK="#1f2937", MUT="#6b7280", LINE="#e5e7eb", PAPER="#ffffff";
  function val(v){ return (v===null||v===undefined)?"":String(v); }

  function picto(i){
    var c=BLUE;
    var s='<svg viewBox="0 0 24 24" width="26" height="26" xmlns="http://www.w3.org/2000/svg">';
    var glyphs=[
      '<path d="M4 14 Q12 6 20 14 L18 18 Q15 16 15 14 Q12 13 9 14 Q9 16 6 18 Z" fill="'+c+'"/><path d="M5 6 L19 20" stroke="'+DANGER+'" stroke-width="2" stroke-linecap="round"/>',
      '<rect x="6" y="4" width="12" height="16" rx="2" fill="'+c+'"/><circle cx="18" cy="12" r="6" fill="#fff"/><circle cx="18" cy="12" r="6" fill="none" stroke="'+DANGER+'" stroke-width="2"/><path d="M14 8 L22 16 M22 8 L14 16" stroke="'+DANGER+'" stroke-width="2" stroke-linecap="round"/>',
      '<circle cx="9" cy="12" r="4" fill="none" stroke="'+c+'" stroke-width="2"/><path d="M12.5 12 H20 M17 12 V16 M20 12 V15" stroke="'+c+'" stroke-width="2" fill="none" stroke-linecap="round"/>',
      '<path d="M9 13 a3 3 0 0 1 0-4 l2-2 a3 3 0 0 1 4 4 l-1 1" fill="none" stroke="'+c+'" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="9.5" fill="none" stroke="'+DANGER+'" stroke-width="2"/><path d="M5.5 5.5 L18.5 18.5" stroke="'+DANGER+'" stroke-width="2" stroke-linecap="round"/>',
      '<path d="M12 3 L19 5.5 V12 Q19 17.5 12 21 Q5 17.5 5 12 V5.5 Z" fill="none" stroke="'+c+'" stroke-width="2" stroke-linejoin="round"/><path d="M9 12 L11 14 L15 9.5" stroke="'+c+'" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
      '<path d="M3 12 Q12 5 21 12 Q12 19 3 12 Z" fill="none" stroke="'+c+'" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="'+c+'"/>'
    ];
    return s+(glyphs[i%glyphs.length])+'</svg>';
  }

  var subject=esc(val(nl.subject)||"정보보호 뉴스레터");
  var lbl=esc(val(label));
  var tips=tipsList(nl)||[];

  var SHIELDMARK='<svg viewBox="0 0 48 56" width="40" height="46" xmlns="http://www.w3.org/2000/svg" style="display:block;">'+
    '<path d="M24 2 L44 10 V28 Q44 46 24 54 Q4 46 4 28 V10 Z" fill="#ffffff" opacity="0.16"/>'+
    '<path d="M24 9 L38 14 V28 Q38 41 24 47 Q10 41 10 28 V14 Z" fill="#ffffff"/>'+
    '<path d="M17 28 L22 34 L32 21" stroke="'+NAVY+'" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'+
  '</svg>';

  var html='<div style="max-width:640px;margin:0 auto;background:'+PAPER+';border-radius:18px;overflow:hidden;font-family:\'Malgun Gothic\',\'Apple SD Gothic Neo\',sans-serif;color:'+INK+';box-shadow:0 1px 3px rgba(0,0,0,0.08);">';

  html+='<div style="background:linear-gradient(135deg,'+NAVY+' 0%,#123a7a 100%);padding:22px 24px;color:#fff;break-inside:avoid;">'+
    '<div style="display:flex;align-items:center;gap:14px;">'+
      '<div style="flex:0 0 auto;">'+SHIELDMARK+'</div>'+
      '<div style="flex:1 1 auto;min-width:0;">'+
        (lbl?'<div style="font-size:12px;letter-spacing:1px;color:#9db8e8;font-weight:700;margin-bottom:4px;">'+lbl+'</div>':'')+
        '<div style="font-size:19px;font-weight:800;line-height:1.35;">'+subject+'</div>'+
      '</div>'+
    '</div>'+
  '</div>';

  if(val(nl.intro)){
    html+='<div style="padding:18px 24px 0 24px;font-size:14px;line-height:1.6;color:'+MUT+';">'+mdi(val(nl.intro))+'</div>';
  }

  if(tips.length){
    html+='<div style="padding:18px 24px 4px 24px;">'+sectionTitle("오늘의 보안수칙")+'</div>';
    html+='<div style="padding:4px 24px 8px 24px;">';
    for(var i=0;i<tips.length;i++){
      var isHero=(i===0);
      html+='<div style="display:flex;align-items:center;gap:14px;border:1px solid '+(isHero?'#cfe0ff':LINE)+';background:'+(isHero?'linear-gradient(135deg,#eff5ff,#e3edff)':'#fff')+';border-radius:14px;padding:'+(isHero?'16px':'13px 14px')+';margin-bottom:10px;break-inside:avoid;">'+
        '<div style="flex:0 0 auto;width:'+(isHero?'52px':'42px')+';height:'+(isHero?'52px':'42px')+';border-radius:12px;background:'+(isHero?NAVY:'#eef3fb')+';color:'+(isHero?'#fff':BLUE)+';display:flex;align-items:center;justify-content:center;font-size:'+(isHero?'24px':'19px')+';font-weight:800;">'+(i+1)+'</div>'+
        '<div style="flex:1 1 auto;font-size:'+(isHero?'18px':'14.5px')+';font-weight:'+(isHero?'800':'600')+';line-height:1.45;color:'+(isHero?NAVY:INK)+';">'+esc(tips[i])+'</div>'+
        '<div style="flex:0 0 auto;">'+picto(i)+'</div>'+
      '</div>';
    }
    html+='</div>';
  }

  if(nl.stats && nl.stats.length){
    var hasStat=false; for(var sc0=0;sc0<nl.stats.length;sc0++){ if(nl.stats[sc0]&&(val(nl.stats[sc0].value)||val(nl.stats[sc0].label))){hasStat=true;break;} }
    if(hasStat){
      html+='<div style="padding:10px 24px 4px 24px;">'+sectionTitle("숫자로 보는 위험")+'</div>';
      html+='<div style="padding:4px 24px 8px 24px;display:flex;flex-wrap:wrap;gap:12px;">';
      for(var s=0;s<nl.stats.length;s++){
        var st=nl.stats[s];
        if(!st || !(val(st.value)||val(st.label))) continue;
        html+='<div style="flex:1 1 calc(33.33% - 8px);min-width:150px;box-sizing:border-box;background:'+NAVY+';border-radius:14px;padding:16px 14px;text-align:center;break-inside:avoid;">'+
          '<div style="font-size:22px;font-weight:800;color:#fff;line-height:1.2;">'+esc(val(st.value))+'</div>'+
          '<div style="font-size:12px;color:#9db8e8;margin-top:6px;line-height:1.3;">'+esc(val(st.label))+'</div>'+
        '</div>';
      }
      html+='</div>';
    }
  }

  if(val(nl.alert)){
    html+='<div style="padding:8px 24px;break-inside:avoid;">'+
      '<div style="display:flex;align-items:center;gap:12px;background:#fdecea;border:1px solid #f3c0ba;border-left:5px solid '+DANGER+';border-radius:10px;padding:13px 15px;">'+
        '<svg viewBox="0 0 24 24" width="24" height="24" style="flex:0 0 auto;" xmlns="http://www.w3.org/2000/svg"><path d="M12 3 L22 20 H2 Z" fill="'+DANGER+'"/><rect x="11" y="9" width="2" height="6" rx="1" fill="#fff"/><circle cx="12" cy="17" r="1.3" fill="#fff"/></svg>'+
        '<div style="font-size:13.5px;font-weight:700;color:'+DANGER+';line-height:1.45;">'+esc(val(nl.alert))+'</div>'+
      '</div>'+
    '</div>';
  }

  if(nl.headlines && nl.headlines.length){
    var hasHead=false; for(var hc=0;hc<nl.headlines.length;hc++){ if(nl.headlines[hc]&&val(nl.headlines[hc].title)){hasHead=true;break;} }
    if(hasHead){
      html+='<div style="padding:10px 24px 4px 24px;">'+sectionTitle("이달의 보안 뉴스")+'</div>';
      html+='<div style="padding:4px 24px 8px 24px;">';
      for(var h=0;h<nl.headlines.length;h++){
        var hd=nl.headlines[h]; if(!hd||!val(hd.title)) continue;
        var ic=iconFor(val(hd.title));
        var link=hd.link?safeUrl(hd.link):"";
        html+='<div style="display:flex;gap:12px;border:1px solid '+LINE+';border-radius:12px;padding:13px 14px;margin-bottom:10px;break-inside:avoid;">'+
          '<div style="flex:0 0 auto;width:38px;height:38px;border-radius:10px;background:'+((ic&&ic.bg)?ic.bg:'#eef3fb')+';display:flex;align-items:center;justify-content:center;color:'+((ic&&ic.color)?ic.color:BLUE)+';">'+((ic&&ic.svg)?ic.svg:'')+'</div>'+
          '<div style="flex:1 1 auto;min-width:0;">'+
            '<div style="font-size:14.5px;font-weight:700;color:'+NAVY+';line-height:1.4;">'+esc(val(hd.title))+'</div>'+
            (val(hd.summary)?'<div style="font-size:13px;color:'+MUT+';line-height:1.5;margin-top:4px;">'+mdi(val(hd.summary))+'</div>':'')+
            ((val(hd.source)||link)?'<div style="font-size:11px;color:#9aa3af;margin-top:6px;">'+(val(hd.source)?esc(val(hd.source)):"")+(link?' &middot; <a href="'+escAttr(link)+'" style="color:'+BLUE+';text-decoration:none;">기사 보기</a>':"")+'</div>':"")+
          '</div>'+
        '</div>';
      }
      html+='</div>';
    }
  }

  var dd=nl.deep_dive;
  if(dd && (val(dd.heading)||val(dd.body))){
    html+='<div style="padding:8px 24px;break-inside:avoid;">'+
      '<div style="background:linear-gradient(135deg,#fff7ed,#fffbf5);border-left:5px solid '+WARN+';border-radius:12px;padding:14px 16px;">'+
        (val(dd.heading)?'<div style="font-size:15px;font-weight:800;color:'+WARN+';margin-bottom:7px;">'+esc(val(dd.heading))+'</div>':'')+
        (val(dd.body)?'<div style="font-size:13px;line-height:1.6;color:'+INK+';">'+mdi(val(dd.body))+'</div>':'')+
      '</div>'+
    '</div>';
  }

  if(val(nl.closing)){
    html+='<div style="padding:6px 24px 24px 24px;">'+
      '<div style="background:'+NAVY+';color:#fff;border-radius:12px;padding:14px 16px;font-size:13.5px;line-height:1.55;break-inside:avoid;">'+inlLight(val(nl.closing))+'</div>'+
    '</div>';
  }

  html+='</div>';
  return html;
}

function renderOnepager(nl, label){
  nl = nl || {};
  var NAVY="#0a2a5c", BLUE="#1a56db", DANGER="#c0392b", SAFE="#16a34a", WARN="#c77800";
  var INK="#1f2937", MUT="#6b7280", LINE="#e5e7eb", PAPER="#ffffff";
  function val(v){ return (v===null||v===undefined)?"":String(v); }

  var subject=esc(val(nl.subject)||"정보보호 뉴스레터");
  var lbl=esc(val(label));
  var tips=tipsList(nl)||[];
  var heroTip=tips.length?tips[0]:"의심스러우면 멈추고 직접 확인하세요";
  var restTips=tips.slice(1,6);

  var SHIELDMARK='<svg viewBox="0 0 40 48" width="32" height="38" xmlns="http://www.w3.org/2000/svg" style="display:block;">'+
    '<path d="M20 8 L32 12 V24 Q32 35 20 40 Q8 35 8 24 V12 Z" fill="#ffffff"/>'+
    '<path d="M14 24 L18 29 L27 18" stroke="'+NAVY+'" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'+
  '</svg>';

  function tinyChk(){
    return '<svg viewBox="0 0 20 20" width="18" height="18" style="flex:0 0 auto;margin-top:1px;" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="9" fill="'+SAFE+'"/><path d="M6 10 L9 13 L14.5 7" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  var html='<div style="max-width:640px;margin:0 auto;background:'+PAPER+';border-radius:16px;overflow:hidden;font-family:\'Malgun Gothic\',\'Apple SD Gothic Neo\',sans-serif;color:'+INK+';box-shadow:0 1px 3px rgba(0,0,0,0.08);break-inside:avoid;">';

  html+='<div style="background:linear-gradient(135deg,'+NAVY+' 0%,#123a7a 100%);padding:16px 20px;color:#fff;display:flex;align-items:center;gap:12px;break-inside:avoid;">'+
    '<div style="flex:0 0 auto;">'+SHIELDMARK+'</div>'+
    '<div style="flex:1 1 auto;min-width:0;">'+
      (lbl?'<div style="font-size:11px;letter-spacing:1px;color:#9db8e8;font-weight:700;">'+lbl+'</div>':'')+
      '<div style="font-size:16px;font-weight:800;line-height:1.3;">'+subject+'</div>'+
    '</div>'+
  '</div>';

  html+='<div style="padding:14px 20px 6px 20px;">'+
    '<div style="background:linear-gradient(135deg,#eff5ff,#e3edff);border:1px solid #cfe0ff;border-radius:12px;padding:14px;display:flex;align-items:center;gap:12px;break-inside:avoid;">'+
      '<div style="flex:0 0 auto;width:40px;height:40px;border-radius:10px;background:'+NAVY+';display:flex;align-items:center;justify-content:center;">'+
        '<svg viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg"><path d="M12 2 L20 5 V12 Q20 19 12 22 Q4 19 4 12 V5 Z" fill="#fff"/><path d="M8.5 12 L11 14.5 L16 9" stroke="'+NAVY+'" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'+
      '</div>'+
      '<div style="flex:1 1 auto;"><div style="font-size:10px;font-weight:800;color:'+BLUE+';letter-spacing:0.5px;">오늘의 보안수칙</div>'+
      '<div style="font-size:16px;font-weight:800;color:'+NAVY+';line-height:1.35;margin-top:2px;">'+esc(heroTip)+'</div></div>'+
    '</div>'+
  '</div>';

  if(restTips.length){
    html+='<div style="padding:4px 20px;display:flex;flex-wrap:wrap;gap:7px 16px;break-inside:avoid;">';
    for(var i=0;i<restTips.length;i++){
      html+='<div style="flex:1 1 calc(50% - 8px);min-width:220px;display:flex;align-items:flex-start;gap:8px;">'+
        tinyChk()+'<div style="font-size:13px;line-height:1.45;color:'+INK+';">'+esc(restTips[i])+'</div>'+
      '</div>';
    }
    html+='</div>';
  }

  if(nl.stats && nl.stats.length){
    var any=false;
    var row='<div style="padding:8px 20px 4px 20px;display:flex;gap:8px;break-inside:avoid;">';
    for(var s=0;s<nl.stats.length;s++){
      var st=nl.stats[s]; if(!st||!(val(st.value)||val(st.label))) continue;
      any=true;
      row+='<div style="flex:1 1 0;background:#f3f6fc;border:1px solid #e2eafb;border-radius:10px;padding:10px 8px;text-align:center;">'+
        '<div style="font-size:16px;font-weight:800;color:'+NAVY+';line-height:1.2;">'+esc(val(st.value))+'</div>'+
        '<div style="font-size:10.5px;color:'+MUT+';margin-top:3px;">'+esc(val(st.label))+'</div>'+
      '</div>';
    }
    row+='</div>';
    if(any) html+=row;
  }

  if(val(nl.alert)){
    html+='<div style="padding:6px 20px;break-inside:avoid;">'+
      '<div style="display:flex;align-items:center;gap:10px;background:#fdecea;border-left:4px solid '+DANGER+';border-radius:8px;padding:10px 12px;">'+
        '<svg viewBox="0 0 24 24" width="20" height="20" style="flex:0 0 auto;" xmlns="http://www.w3.org/2000/svg"><path d="M12 3 L22 20 H2 Z" fill="'+DANGER+'"/><rect x="11" y="9" width="2" height="6" rx="1" fill="#fff"/><circle cx="12" cy="17" r="1.3" fill="#fff"/></svg>'+
        '<div style="font-size:12.5px;font-weight:700;color:'+DANGER+';line-height:1.4;">'+esc(val(nl.alert))+'</div>'+
      '</div>'+
    '</div>';
  }

  if(nl.headlines && nl.headlines.length){
    var hh=''; var anyH=false;
    hh+='<div style="padding:6px 20px;break-inside:avoid;"><div style="font-size:12px;font-weight:800;color:'+NAVY+';margin-bottom:6px;">이달의 보안 뉴스</div>';
    for(var h=0;h<nl.headlines.length;h++){
      var hd=nl.headlines[h]; if(!hd||!val(hd.title)) continue; anyH=true;
      hh+='<div style="display:flex;gap:7px;align-items:flex-start;margin-bottom:5px;font-size:11.5px;line-height:1.4;color:'+INK+';">'+
        '<span style="flex:0 0 auto;color:'+BLUE+';font-weight:800;">&middot;</span>'+
        '<span><b style="color:'+NAVY+';">'+esc(val(hd.title))+'</b>'+(val(hd.source)?' <span style="color:'+MUT+';">('+esc(val(hd.source))+')</span>':'')+'</span>'+
      '</div>';
    }
    hh+='</div>';
    if(anyH) html+=hh;
  }

  if(val(nl.closing)){
    html+='<div style="padding:6px 20px 16px 20px;break-inside:avoid;">'+
      '<div style="font-size:12.5px;color:'+MUT+';line-height:1.5;text-align:center;border-top:1px dashed '+LINE+';padding-top:12px;">'+inlLight(val(nl.closing))+'</div>'+
    '</div>';
  } else {
    html+='<div style="height:12px;"></div>';
  }

  html+='</div>';
  return html;
}

  /* ====== 인포그래픽형 렌더 (NotebookLM 스타일·코드 SVG) ====== */
  function renderInfographic(nl, label){
    nl = nl || {};
    var ig = nl.infographic || {};
    var v = function(x){ return x==null?"":String(x); };
    var TONE = { danger:"#c0392b", warn:"#c77800", ok:"#16a34a", blue:"#1a56db", navy:"#0a2a5c" };
    function sec(t){ return '<div style="font-size:14px;font-weight:800;color:#0a2a5c;display:flex;align-items:center;gap:7px;margin-bottom:12px"><span style="width:4px;height:16px;background:#1a56db;border-radius:2px"></span>'+esc(t)+"</div>"; }
    function gauge(value, max, color){
      var f = Math.max(0, Math.min(1, (parseFloat(value)||0)/(parseFloat(max)||3)));
      var ang = Math.PI*(1-f);
      var ex = (60 + 48*Math.cos(ang)).toFixed(1), ey = (60 - 48*Math.sin(ang)).toFixed(1);
      return '<svg viewBox="0 0 120 70" width="108" height="62"><path d="M12 60 A48 48 0 0 1 108 60" fill="none" stroke="#eef1f6" stroke-width="11" stroke-linecap="round"/>'+
        '<path d="M12 60 A48 48 0 0 1 '+ex+" "+ey+'" fill="none" stroke="'+color+'" stroke-width="11" stroke-linecap="round"/>'+
        '<text x="60" y="56" font-size="22" font-weight="900" fill="'+color+'" text-anchor="middle">'+esc(v(value))+"</text></svg>";
    }

    var head = '<div style="padding:22px 26px 18px;border-bottom:3px solid #1a56db">'+
      '<div style="font-size:12px;font-weight:800;color:#1a56db;letter-spacing:.5px">🛡️ '+esc(label)+' · 정보보호의 날</div>'+
      '<div style="font-size:22px;font-weight:900;color:#0a2a5c;line-height:1.25;margin-top:6px">'+esc(nl.subject||"이달의 보안 인포그래픽")+"</div>"+
      (nl.intro?'<div style="font-size:13px;color:#6b7280;line-height:1.55;margin-top:6px">'+mdi(nl.intro)+"</div>":"")+"</div>";

    var donut="", files="", note="";
    if(ig.donut && ig.donut.value){
      var dv=Math.max(0,Math.min(100,parseFloat(ig.donut.value)||0)), circ=289, dash=(dv/100*circ).toFixed(1);
      donut='<div style="flex:1 1 150px;min-width:150px;text-align:center"><svg viewBox="0 0 120 120" width="116" height="116"><circle cx="60" cy="60" r="46" fill="none" stroke="#eef1f6" stroke-width="15"/><circle cx="60" cy="60" r="46" fill="none" stroke="#e8602c" stroke-width="15" stroke-linecap="round" stroke-dasharray="'+dash+" "+circ+'" transform="rotate(-90 60 60)"/><text x="60" y="58" font-size="29" font-weight="900" fill="#c0392b" text-anchor="middle">'+esc(ig.donut.value)+'</text><text x="60" y="77" font-size="10" fill="#6b7280" text-anchor="middle">'+esc(ig.donut.label||"")+"</text></svg>"+(ig.donut.caption?'<div style="font-size:12px;color:#44506b;font-weight:600;margin-top:2px;line-height:1.4">'+esc(ig.donut.caption)+"</div>":"")+"</div>";
    }
    var ft=(ig.file_types||[]).filter(function(x){return x&&x.label;});
    if(ft.length){
      files='<div style="flex:1 1 150px;min-width:150px"><div style="font-size:12px;font-weight:700;color:#44506b;margin-bottom:8px">악성 첨부 파일 형식</div><div style="display:flex;gap:10px">'+
        ft.slice(0,3).map(function(x,i){var c=i===0?"#c77800":"#c0392b",bg=i===0?"#fff4e6":"#fdecea",bd=i===0?"#f0d49a":"#f3c0ba";return '<div style="flex:1;text-align:center;background:'+bg+";border:1px solid "+bd+';border-radius:10px;padding:10px 4px"><div style="font-size:11px;font-weight:800;color:'+c+'">'+esc(x.label)+'</div><div style="font-size:20px;font-weight:900;color:#0a2a5c">'+esc(x.pct||"")+"</div></div>";}).join("")+"</div></div>";
    }
    if(ig.note && (ig.note.title||ig.note.body)){
      note='<div style="flex:1 1 150px;min-width:150px"><div style="font-size:12px;font-weight:800;color:#0a2a5c;margin-bottom:6px">'+esc(ig.note.title||"")+'</div><div style="font-size:11.5px;color:#6b7280;line-height:1.5">'+esc(ig.note.body||"")+"</div></div>";
    }
    var threatRow="";
    if(donut||files||note){ threatRow='<div style="padding:18px 26px 6px">'+sec("위협 분석 · 이달의 공격 트렌드")+'<div style="display:flex;flex-wrap:wrap;gap:14px">'+donut+files+note+"</div></div>"; }
    else { var st=(nl.stats||[]).filter(function(s){return s&&s.value;}).slice(0,3); if(st.length){ threatRow='<div style="padding:18px 26px 6px">'+sec("핵심 지표")+'<div style="display:flex;gap:12px">'+st.map(function(s){return '<div style="flex:1;text-align:center;background:#fafbfd;border:1px solid #eef1f6;border-radius:12px;padding:14px 8px"><div style="font-size:22px;font-weight:900;color:#c0392b">'+esc(s.value)+'</div><div style="font-size:11px;color:#6b7280;margin-top:4px">'+esc(s.label||"")+"</div></div>";}).join("")+"</div></div>"; } }

    var stages=(ig.stages||[]).filter(function(s){return s&&(s.name||s.value);}), stageRow="";
    if(stages.length){ stageRow='<div style="padding:14px 26px 6px">'+sec("공격 단계")+'<div style="display:flex;gap:10px">'+
      stages.slice(0,3).map(function(s){var c=TONE[s.tone]||"#1a56db";return '<div style="flex:1;background:#fafbfd;border:1px solid #eef1f6;border-radius:12px;padding:12px 8px;text-align:center"><div style="font-size:11px;font-weight:700;color:#6b7280">'+esc(s.stage||"")+'</div><div style="font-size:13px;font-weight:800;color:'+c+';margin:3px 0 4px">'+esc(s.name||"")+"</div>"+gauge(s.value,s.max||3,c)+'<div style="font-size:10px;color:#9aa3b2">'+esc(s.sub||"")+"</div></div>";}).join("")+"</div></div>"; }

    var tips=tipsList(nl);
    var dmg=(ig.damage && ig.damage.value)?'<div style="flex:1 1 180px;min-width:180px;background:linear-gradient(135deg,#0a2a5c,#123a7a);color:#fff;border-radius:12px;padding:14px 16px;break-inside:avoid"><div style="font-size:12px;color:#9db8e8;font-weight:700">'+esc(ig.damage.label||"피해 규모")+'</div><div style="font-size:24px;font-weight:900;line-height:1.1;margin:4px 0">'+esc(ig.damage.value)+"</div>"+(ig.damage.note?'<div style="font-size:11.5px;color:#cfe0ff">'+esc(ig.damage.note)+"</div>":"")+"</div>":"";
    var CK='<svg viewBox="0 0 28 28" width="26" height="26" style="flex:0 0 auto"><circle cx="14" cy="14" r="13" fill="#e7f7ee"/><path d="M9 14 L12.5 17.5 L20 10" stroke="#16a34a" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var tipItems=tips.length?'<div style="flex:2 1 280px;min-width:260px">'+tips.slice(0,5).map(function(t){return '<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px">'+CK+'<div style="font-size:12.5px;line-height:1.45">'+esc(t)+"</div></div>";}).join("")+"</div>":"";
    var actionRow=(dmg||tipItems)?'<div style="padding:14px 26px 8px">'+sec("현장 대응 · 오늘의 보안수칙")+'<div style="display:flex;flex-wrap:wrap;gap:12px">'+dmg+tipItems+"</div></div>":"";

    var foot='<div style="background:#f4f6fa;color:#8a93a3;font-size:11px;text-align:center;padding:11px;margin-top:8px">secuday.jbax.co.kr · 정보보호팀 — 매월 1일 정보보호의 날</div>';
    return '<div style="max-width:680px;margin:0 auto;background:#fff;color:#1f2937;border-radius:16px;overflow:hidden;border:1px solid #e3e9f2;font-family:\'Apple SD Gothic Neo\',\'Malgun Gothic\',\'Noto Sans KR\',-apple-system,sans-serif">'+head+threatRow+stageRow+actionRow+foot+"</div>";
  }

  /* 포맷 디스패처: nl.format → 해당 렌더러(함수 없으면 표준형으로 안전 폴백) */
  function renderNewsletterFull(nl, label){
    nl = nl || {};
    var f = nl.format;
    if (f === "comic" && typeof renderComic === "function") return renderComic(nl, label);
    if (f === "card" && typeof renderCard === "function") return renderCard(nl, label);
    if (f === "onepager" && typeof renderOnepager === "function") return renderOnepager(nl, label);
    if (f === "infographic" && typeof renderInfographic === "function") return renderInfographic(nl, label);
    return renderStandard(nl, label);
  }

  /* ====== 만화로 보는 보안수칙 (수칙 → 만화풍 카드, 코드 SVG) — 공개 페이지 섹션용 ====== */
  function rulesSceneSpec(t){
    if(/신고|112/.test(t)) return "report";
    if(/신분증|계좌|비밀번호|사진|개인정보/.test(t)) return "noinfo";
    if(/링크|앱|첨부|설치|클릭|URL/i.test(t)) return "nolink";
    if(/의심|신호|수상|사칭|이상/.test(t)) return "suspect";
    if(/전화|통화|확인|유선|직접/.test(t)) return "verify";
    return "general";
  }
  function rulesScene(k){
    var V={
      verify:{bg:"#eef3fb",badge:"#1a56db",chip:["✓ 이렇게","#e7f7ee","#0f7a43","#b7e6cb"],svg:'<g transform="translate(56,70)"><ellipse cx="0" cy="44" rx="26" ry="19" fill="#1a56db"/><circle cx="0" cy="4" r="22" fill="#f7d9b8"/><path d="M-22 -2 Q0 -28 22 -2 Q16 -13 0 -15 Q-16 -13 -22 -2 Z" fill="#0a2a5c"/><circle cx="-7" cy="2" r="2.4" fill="#1f2937"/><circle cx="7" cy="2" r="2.4" fill="#1f2937"/><path d="M-6 11 Q0 15 6 11" stroke="#1f2937" stroke-width="2" fill="none" stroke-linecap="round"/></g><g transform="translate(150,48)"><rect x="-18" y="-26" width="36" height="56" rx="7" fill="#0a2a5c"/><rect x="-14" y="-20" width="28" height="40" rx="3" fill="#cfe0ff"/><circle cx="0" cy="-2" r="9" fill="#fff"/><text x="0" y="2" font-size="11" font-weight="800" fill="#c0392b" text-anchor="middle">₩</text></g><g transform="translate(196,96)"><circle cx="0" cy="0" r="17" fill="#16a34a"/><path d="M-7 0 L-2 6 L8 -6" stroke="#fff" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>'},
      noinfo:{bg:"#fdecea",badge:"#c0392b",chip:["✕ 금지","#fdecea","#a3271c","#f3c0ba"],svg:'<g transform="translate(95,70)"><rect x="-50" y="-30" width="100" height="60" rx="8" fill="#fff" stroke="#0a2a5c" stroke-width="2.5"/><rect x="-40" y="-18" width="26" height="30" rx="4" fill="#cfe0ff"/><circle cx="-27" cy="-6" r="6" fill="#9db8e8"/><path d="M-37 10 Q-27 2 -17 10" fill="#9db8e8"/><rect x="-6" y="-16" width="46" height="6" rx="3" fill="#dbe5f5"/><rect x="-6" y="-4" width="46" height="6" rx="3" fill="#dbe5f5"/><rect x="-6" y="8" width="30" height="6" rx="3" fill="#dbe5f5"/></g><g transform="translate(150,70)"><circle cx="0" cy="0" r="40" fill="none" stroke="#c0392b" stroke-width="7" opacity=".9"/><path d="M-28 -28 L28 28" stroke="#c0392b" stroke-width="7" stroke-linecap="round"/></g>'},
      nolink:{bg:"#fff4e6",badge:"#c0392b",chip:["✕ 금지","#fdecea","#a3271c","#f3c0ba"],svg:'<g transform="translate(92,66)"><rect x="-52" y="-30" width="104" height="50" rx="12" fill="#fff" stroke="#c77800" stroke-width="2.5"/><path d="M-30 20 L-30 34 L-14 20 Z" fill="#fff" stroke="#c77800" stroke-width="2.5"/><g transform="translate(-18,-6)"><ellipse cx="-7" cy="0" rx="9" ry="6" fill="none" stroke="#1a56db" stroke-width="3"/><ellipse cx="7" cy="0" rx="9" ry="6" fill="none" stroke="#1a56db" stroke-width="3"/></g><rect x="14" y="-16" width="26" height="22" rx="3" fill="#eef3fb" stroke="#1a56db" stroke-width="2"/><path d="M30 -16 L40 -16 L40 -6 Z" fill="#fff" stroke="#1a56db" stroke-width="2"/></g><g transform="translate(168,86)"><circle cx="0" cy="0" r="30" fill="none" stroke="#c0392b" stroke-width="6"/><path d="M-21 -21 L21 21" stroke="#c0392b" stroke-width="6" stroke-linecap="round"/></g>'},
      suspect:{bg:"#fff4e6",badge:"#c77800",chip:["⚠ 의심","#fdf2e0","#8a5a08","#f0d49a"],svg:'<g transform="translate(60,66)"><ellipse cx="0" cy="44" rx="26" ry="19" fill="#1a56db"/><circle cx="0" cy="4" r="22" fill="#f7d9b8"/><path d="M-22 -2 Q0 -28 22 -2 Q16 -13 0 -15 Q-16 -13 -22 -2 Z" fill="#0a2a5c"/><path d="M-12 -3 L-3 -1 M12 -3 L3 -1" stroke="#1f2937" stroke-width="1.9" stroke-linecap="round"/><circle cx="-7" cy="3" r="2.4" fill="#1f2937"/><circle cx="7" cy="3" r="2.4" fill="#1f2937"/><path d="M-6 13 Q0 9 6 13" stroke="#1f2937" stroke-width="2" fill="none" stroke-linecap="round"/></g><g transform="translate(150,50)"><rect x="-8" y="0" width="86" height="40" rx="11" fill="#fff" stroke="#c77800" stroke-width="2"/><path d="M0 36 L0 50 L16 38 Z" fill="#fff" stroke="#c77800" stroke-width="2"/><text x="35" y="25" font-size="12" font-weight="700" fill="#5f5e5a" text-anchor="middle">전화가 안 돼?</text></g><g transform="translate(196,104)"><path d="M0 -16 L16 14 H-16 Z" fill="#c77800"/><rect x="-2" y="-6" width="4" height="11" rx="2" fill="#fff"/><circle cx="0" cy="9" r="2" fill="#fff"/></g>'},
      report:{bg:"#eafaf0",badge:"#16a34a",chip:["✓ 즉시","#e7f7ee","#0f7a43","#b7e6cb"],svg:'<g transform="translate(52,74)"><ellipse cx="0" cy="42" rx="25" ry="18" fill="#16a34a"/><circle cx="0" cy="2" r="21" fill="#f7d9b8"/><path d="M-21 -3 Q0 -27 21 -3 Q15 -13 0 -15 Q-15 -13 -21 -3 Z" fill="#0a2a5c"/><path d="M-10 0 Q-7 -4 -4 0 M4 0 Q7 -4 10 0" stroke="#1f2937" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M-6 9 Q0 15 6 9" stroke="#1f2937" stroke-width="2.2" fill="none" stroke-linecap="round"/></g><g transform="translate(128,66)"><rect x="-22" y="-34" width="44" height="68" rx="9" fill="#0a2a5c"/><rect x="-17" y="-27" width="34" height="50" rx="3" fill="#eafaf0"/><text x="0" y="3" font-size="20" font-weight="800" fill="#16a34a" text-anchor="middle">112</text></g><g transform="translate(196,70)"><path d="M0 -30 L26 -19 V5 Q26 26 0 37 Q-26 26 -26 5 V-19 Z" fill="#16a34a"/><path d="M-12 2 L-3 12 L14 -9" stroke="#fff" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>'},
      general:{bg:"#eef3fb",badge:"#1a56db",chip:["✓ 수칙","#e7f7ee","#0f7a43","#b7e6cb"],svg:'<g transform="translate(120,70)"><path d="M0 -34 L30 -22 V6 Q30 30 0 42 Q-30 30 -30 6 V-22 Z" fill="#1a56db"/><path d="M-13 4 L-4 14 L15 -10" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>'}
    };
    return V[k]||V.general;
  }
  function renderRulesComic(tips, label){
    tips = (tips||[]).map(function(x){return String(x).trim();}).filter(Boolean).slice(0,6);
    if(!tips.length) return "";
    var NUM=["①","②","③","④","⑤","⑥"];
    var cards = tips.map(function(t,i){
      var s=rulesScene(rulesSceneSpec(t));
      return '<div style="flex:1 1 calc(50% - 7px);min-width:260px;box-sizing:border-box;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;background:#fff;break-inside:avoid">'+
        '<div style="position:relative">'+
          '<div style="position:absolute;top:8px;left:8px;width:28px;height:28px;border-radius:50%;background:'+s.badge+';color:#fff;font-size:15px;font-weight:800;display:flex;align-items:center;justify-content:center">'+(NUM[i]||(i+1))+'</div>'+
          '<div style="position:absolute;top:10px;right:10px;background:'+s.chip[1]+';color:'+s.chip[2]+';font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;border:1px solid '+s.chip[3]+'">'+s.chip[0]+'</div>'+
          '<svg viewBox="0 0 240 140" width="100%" height="130" style="display:block;background:'+s.bg+'">'+s.svg+'</svg>'+
        '</div>'+
        '<div style="padding:12px 14px;font-size:14px;line-height:1.5;font-weight:600;color:#1f2937">'+esc(t)+'</div>'+
      '</div>';
    }).join("");
    return '<div style="max-width:680px;margin:0 auto"><div style="font-size:15px;font-weight:800;color:#0a2a5c;display:flex;align-items:center;gap:8px;margin:0 0 12px"><span style="width:4px;height:17px;border-radius:2px;background:#1a56db"></span>🛡️ 만화로 보는 보안수칙'+(label?' <span style="font-size:12px;font-weight:600;color:#8a93a3">· '+esc(label)+'</span>':'')+'</div><div style="display:flex;flex-wrap:wrap;gap:14px">'+cards+'</div></div>';
  }

  /* ====== 세로형(메일 첨부용) 인포그래픽 — 통계+4컷+수칙 한 장 포트레이트 ======
     4컷 만화는 가로 만화형과 동일한 그림체(comicPanelCard)를 그대로 사용한다. */
  function buildEmailVertical(nl, label){
    nl = nl||{};
    var ig = nl.infographic||{};
    var cards=[];
    if(ig.donut && ig.donut.value){ var dv=Math.max(0,Math.min(100,parseFloat(ig.donut.value)||0)), dash=(dv/100*214).toFixed(1);
      cards.push('<div style="flex:1;text-align:center;padding:18px 8px;border-right:1px solid #eef1f6"><svg viewBox="0 0 90 90" width="76" height="76"><circle cx="45" cy="45" r="34" fill="none" stroke="#eef1f6" stroke-width="12"/><circle cx="45" cy="45" r="34" fill="none" stroke="#e8602c" stroke-width="12" stroke-linecap="round" stroke-dasharray="'+dash+' 214" transform="rotate(-90 45 45)"/><text x="45" y="51" font-size="21" font-weight="900" fill="#c0392b" text-anchor="middle">'+esc(ig.donut.value)+'</text></svg><div style="font-size:12px;color:#44506b;font-weight:700;margin-top:2px">'+esc(ig.donut.caption||ig.donut.label||"")+"</div></div>"); }
    var st=(nl.stats||[]).filter(function(s){return s&&s.value;});
    if(!st.length && ig.damage && ig.damage.value) st=[{value:ig.damage.value, label:ig.damage.note||ig.damage.label||""}];
    if(ig.donut){ var dn=parseFloat(ig.donut.value); if(!isNaN(dn)) st=st.filter(function(s){ var sv=parseFloat(s.value); return isNaN(sv)||Math.round(sv)!==Math.round(dn); }); }
    var take=st.slice(0, cards.length?2:3);
    take.forEach(function(s,idx){ var lastNoBorder=(idx===take.length-1); cards.push('<div style="flex:1;text-align:center;padding:22px 8px;'+(lastNoBorder?"":"border-right:1px solid #eef1f6")+'"><div style="font-size:22px;font-weight:900;color:'+(idx===0&&!ig.donut?"#c0392b":"#0a2a5c")+';line-height:1.1">'+esc(s.value)+'</div><div style="font-size:12px;color:#6b7280;font-weight:600;margin-top:6px">'+esc(s.label||"")+"</div></div>"); });
    var statsRow = cards.length?'<div style="display:flex;border-bottom:1px solid #eef1f6">'+cards.join("")+"</div>":"";

    var panels=(nl.comic && nl.comic.panels && nl.comic.panels.length)?nl.comic.panels:[];
    var comicSec = panels.length?'<div style="padding:16px 24px 8px"><div style="font-size:16px;font-weight:800;color:#0a2a5c;display:flex;align-items:center;gap:8px;margin-bottom:14px"><span style="width:5px;height:18px;border-radius:2px;background:#1a56db"></span>4컷으로 보는 이달의 위협</div><div style="display:flex;flex-wrap:wrap;gap:14px">'+panels.slice(0,4).map(comicPanelCard).join("")+"</div></div>":"";

    var tips=tipsList(nl);
    var tipsSec = tips.length?'<div style="padding:14px 24px 8px"><div style="font-size:16px;font-weight:800;color:#0f6e56;display:flex;align-items:center;gap:8px;margin-bottom:10px"><span style="width:5px;height:18px;border-radius:2px;background:#16a34a"></span>✅ 오늘의 보안수칙</div><div style="background:linear-gradient(135deg,#f0faf5,#eefcff);border:1px solid #c7ecd8;border-radius:14px;padding:14px 18px">'+tips.map(function(t,i){return '<div style="display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.5;color:#243244;margin:7px 0"><b style="color:#0f6e56">'+(i+1)+'.</b> '+esc(t)+"</div>";}).join("")+"</div></div>":"";

    var alert = nl.alert?'<div style="padding:6px 24px 16px"><div style="display:flex;align-items:center;gap:12px;background:#fdecea;border:1px solid #f3c0ba;border-left:5px solid #c0392b;border-radius:10px;padding:13px 15px"><svg viewBox="0 0 24 24" width="24" height="24" style="flex:0 0 auto"><path d="M12 3 L22 20 H2 Z" fill="#c0392b"/><rect x="11" y="9" width="2" height="6" rx="1" fill="#fff"/><circle cx="12" cy="17" r="1.3" fill="#fff"/></svg><div style="font-size:13.5px;font-weight:700;color:#c0392b;line-height:1.45">'+esc(nl.alert)+"</div></div></div>":"";

    var header='<div style="background:linear-gradient(135deg,#0a2a5c,#123a7a);color:#fff;padding:26px 28px"><div style="font-size:13px;font-weight:800;color:#9db8e8;letter-spacing:.5px">🛡️ '+esc(label)+' · 정보보호의 날</div><div style="font-size:24px;font-weight:900;line-height:1.3;margin-top:8px">'+esc(nl.subject||"이달의 보안 브리핑")+"</div>"+(nl.intro?'<div style="font-size:14px;color:#cfe0ff;line-height:1.55;margin-top:10px">'+esc(String(nl.intro).replace(/\*\*/g,""))+"</div>":"")+"</div>";
    var foot='<div style="background:#0a2a5c;color:#9db9e8;font-size:12px;text-align:center;padding:14px">🛡️ secuday · 정보보호팀 — 매월 1일 정보보호의 날 · 신고 국번없이 112</div>';

    return '<div style="width:680px;max-width:100%;margin:0 auto;background:#fff;color:#1f2937;border-radius:18px;overflow:hidden;border:1px solid #e3e9f2;font-family:\'Apple SD Gothic Neo\',\'Malgun Gothic\',\'Noto Sans KR\',-apple-system,sans-serif">'+header+statsRow+comicSec+tipsSec+alert+foot+"</div>";
  }
  var EV_PRINT_CSS = "*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{margin:0;background:#eef1f6;padding:16px 0;font-family:'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',-apple-system,sans-serif}@page{size:A4 portrait;margin:8mm}@media print{body{background:#fff;padding:0}}";
  function buildEmailVerticalDocument(nl, monthStr){
    var label=monthLabel(monthStr), title="정보보호의날_세로_"+(monthStr||"");
    return "<!DOCTYPE html><html lang=\"ko\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>"+esc(title)+"</title><style>"+EV_PRINT_CSS+"</style></head><body>"+buildEmailVertical(nl,label)+"</body></html>";
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
    renderNewsletterFull:renderNewsletterFull, buildPrintDocument:buildPrintDocument, renderRulesComic:renderRulesComic,
    buildEmailVertical:buildEmailVertical, buildEmailVerticalDocument:buildEmailVerticalDocument,
    documentShell:documentShell, renderMaterialBody:renderMaterialBody, buildMaterialPrintDocument:buildMaterialPrintDocument,
  };
})();
