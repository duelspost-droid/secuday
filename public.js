/* secuday 공개 메인 — 로그인 없이 자료 열람 (읽기 전용) */
const cfg = window.SECUDAY_CONFIG;
const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

let current = null;
const $ = (sel) => document.querySelector(sel);

function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("error", isError);
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.hidden = true), 3000);
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

function md(text) {
  const lines = esc(text).split("\n");
  let html = "", inList = false;
  for (const line of lines) {
    if (/^\s*[-*] /.test(line)) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${line.replace(/^\s*[-*] /, "")}</li>`;
      continue;
    }
    if (inList) { html += "</ul>"; inList = false; }
    if (/^### /.test(line)) html += `<h4>${line.slice(4)}</h4>`;
    else if (/^## /.test(line)) html += `<h3>${line.slice(3)}</h3>`;
    else if (/^# /.test(line)) html += `<h2>${line.slice(2)}</h2>`;
    else if (line.trim() === "") html += "<br>";
    else html += `<p>${line}</p>`;
  }
  if (inList) html += "</ul>";
  return html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

function posterUrl(path) {
  if (!path) return null;
  return sb.storage.from("posters").getPublicUrl(path).data.publicUrl;
}

function show(viewId) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = true));
  $(viewId).hidden = false;
}

const SOURCE_LABEL = { manual: "수동", ai: "AI", rollback: "롤백" };

/* ---------- 목록 ---------- */
async function showList() {
  show("#view-list");
  const { data: mats, error } = await sb
    .from("materials")
    .select("id, month, current_version_id, versions!materials_current_version_fk(version_no, title, theme, poster_path, created_at)")
    .order("month", { ascending: false });
  if (error) { toast(error.message, true); return; }

  $("#empty-msg").hidden = mats.length > 0;
  $("#material-cards").innerHTML = mats.map((m) => {
    const c = m.versions || {};
    return `
    <div class="card" onclick="openDetail(${m.id})">
      <div class="card-poster">${c.poster_path
        ? `<img src="${posterUrl(c.poster_path)}" alt="포스터">`
        : `<div class="no-poster">🛡️</div>`}</div>
      <div class="card-body">
        <div class="card-month">${esc(m.month)}</div>
        <div class="card-title">${esc(c.title || "(제목 없음)")}</div>
        <div class="card-meta">${esc(c.theme || "")}</div>
        <div class="card-meta">v${c.version_no ?? "-"} · ${fmtDate(c.created_at)}</div>
      </div>
    </div>`;
  }).join("");
}

/* ---------- 상세 ---------- */
async function openDetail(id) {
  const { data: m, error } = await sb.from("materials").select("*").eq("id", id).single();
  if (error) { toast(error.message, true); return; }
  const { data: v, error: ve } = await sb.from("versions").select("*").eq("id", m.current_version_id).single();
  if (ve) { toast(ve.message, true); return; }
  current = { ...m, current: v };
  renderDetail();
  show("#view-detail");
  switchTab("content");
}

function renderDetail() {
  const c = current.current;
  $("#detail-title").textContent = `${current.month} · ${c.title}`;
  $("#detail-badge").textContent = `v${c.version_no}`;
  // 뉴스레터가 있는 달만 탭 노출
  const nlTab = document.querySelector('.tab[data-tab="newsletter"]');
  if (nlTab) nlTab.hidden = !c.newsletter;
  $("#content-theme").textContent = c.theme ? `테마: ${c.theme}` : "";
  $("#content-body").innerHTML = md(c.content);
  $("#content-rules").innerHTML = (c.rules || []).map((r) => `<li>${esc(r)}</li>`).join("");
  const url = posterUrl(c.poster_path);
  $("#poster-box").innerHTML = c.poster_path
    ? (c.poster_path.endsWith(".pdf")
        ? `<a class="btn" href="${url}" target="_blank">📄 포스터 PDF 열기</a>`
        : `<img src="${url}" alt="포스터">`)
    : `<div class="no-poster big">🛡️<br><small>포스터 없음</small></div>`;
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".tabpane").forEach((p) => (p.hidden = true));
  $(`#tab-${name}`).hidden = false;
  if (name === "history") loadVersions();
  if (name === "newsletter") renderNewsletter();
}

/* ---------- 뉴스레터 (읽기 전용) ---------- */
// 표준 포맷(newsletter-template.js)으로 미리보기 + PDF 다운로드. 관리자/이메일과 동일 포맷.
function renderNewsletter() {
  const nl = current.current && current.current.newsletter;
  $("#nl-preview").innerHTML = nl
    ? NewsletterTemplate.renderNewsletterFull(nl, NewsletterTemplate.monthLabel(current.month))
    : `<div class="empty">아직 뉴스레터가 없습니다.</div>`;
}

/* 표준 포맷 A4 문서를 새 창에 열고 인쇄(PDF로 저장) */
function downloadNewsletterPdf() {
  const nl = current && current.current && current.current.newsletter;
  if (!nl) { toast("뉴스레터가 없습니다.", true); return; }
  const w = window.open("", "_blank");
  if (!w) { toast("팝업이 차단되었습니다. 팝업을 허용한 뒤 다시 시도하세요.", true); return; }
  w.document.write(NewsletterTemplate.buildPrintDocument(nl, current.month));
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch (e) { /* 사용자가 직접 인쇄 가능 */ } }, 400);
}

/* 자료 보기 — 현재 자료(제목·테마·포스터·안내·수칙)를 표준 A4 문서로 PDF 다운로드(인쇄) */
function downloadMaterialPdf() {
  if (!current) return;
  const c = current.current;
  const purl = (c.poster_path && !c.poster_path.endsWith(".pdf")) ? posterUrl(c.poster_path) : null;
  const w = window.open("", "_blank");
  if (!w) { toast("팝업이 차단되었습니다. 팝업을 허용한 뒤 다시 시도하세요.", true); return; }
  w.document.write(NewsletterTemplate.buildMaterialPrintDocument(c, current.month, purl));
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch (e) { /* 사용자가 직접 인쇄 가능 */ } }, purl ? 800 : 400);
}

/* ---------- 버전 이력 (열람만) ---------- */
async function loadVersions() {
  const { data: versions, error } = await sb
    .from("versions")
    .select("version_no, title, change_note, change_source, created_at")
    .eq("material_id", current.id)
    .order("version_no", { ascending: false });
  if (error) { toast(error.message, true); return; }
  const cur = current.current.version_no;
  $("#version-rows").innerHTML = versions.map((v) => `
    <tr class="${v.version_no === cur ? "current-row" : ""}">
      <td><strong>v${v.version_no}</strong>${v.version_no === cur ? " ●" : ""}</td>
      <td>${esc(v.title)}</td>
      <td>${esc(v.change_note)}</td>
      <td><span class="badge src-${v.change_source}">${SOURCE_LABEL[v.change_source] || v.change_source}</span></td>
      <td>${fmtDate(v.created_at)}</td>
    </tr>`).join("");
}

/* ---------- 시작 ---------- */
if (!cfg || cfg.SUPABASE_URL.includes("YOUR-PROJECT")) {
  document.body.innerHTML =
    '<p style="padding:40px;font-family:sans-serif">⚠️ config.js에 Supabase 정보를 설정하세요.</p>';
} else {
  showList();
}
