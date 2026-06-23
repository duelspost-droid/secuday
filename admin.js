/* secuday — 정적 프런트엔드 (Supabase 백엔드) */
const cfg = window.SECUDAY_CONFIG;
const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

// 로그인은 비밀번호만 입력받고, 계정 이메일은 고정값을 사용한다(이메일 입력 제거).
const ADMIN_EMAIL = "duels@jbfg.com";

let current = null;        // 현재 열려 있는 자료 {id, month, current: {...버전}}
let editingId = null;      // 편집 중인 자료 id (null이면 신규)
let lastProposal = null;   // 마지막 AI 수정안
let nlDraft = null;        // 저장 전 작업 중인 뉴스레터 초안
let nlDraftSource = "ai";  // 초안 출처 (ai | manual) — 저장 시 change_source로 사용

const $ = (sel) => document.querySelector(sel);

/* ---------- 유틸 ---------- */
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

/* 속성값(value="...")에 안전하게 넣기 위해 따옴표까지 이스케이프 */
function escAttr(s) {
  return esc(s).replace(/"/g, "&quot;");
}

/* http/https 링크만 허용 (javascript: 등 차단) */
function safeUrl(u) {
  return /^https?:\/\//i.test(u || "") ? u : "";
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

/* 포스터 Storage 경로 → 공개 URL */
function posterUrl(path) {
  if (!path) return null;
  return sb.storage.from("posters").getPublicUrl(path).data.publicUrl;
}

function show(viewId) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = true));
  $(viewId).hidden = false;
}

/* ---------- 인증 ---------- */
async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  applySession(session);
  sb.auth.onAuthStateChange((_e, s) => applySession(s));
}

function applySession(session) {
  if (session) {
    $("#auth-gate").hidden = true;
    $("#app").hidden = false;
    $("#user-email").textContent = session.user.email || "";
    showList();
  } else {
    $("#app").hidden = true;
    $("#auth-gate").hidden = false;
  }
}

async function signIn(ev) {
  ev.preventDefault();
  const btn = $("#auth-btn");
  btn.disabled = true;
  $("#auth-error").hidden = true;
  const { error } = await sb.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: $("#auth-pw").value,
  });
  btn.disabled = false;
  if (error) {
    const e = $("#auth-error");
    e.textContent = "로그인 실패: " + error.message;
    e.hidden = false;
  }
  return false;
}

async function signOut() {
  await sb.auth.signOut();
}

/* 로그인한 관리자가 본인 비밀번호를 직접 변경 */
async function changePassword() {
  const pw = prompt("새 비밀번호를 입력하세요 (6자 이상):");
  if (pw === null) return;
  if (pw.length < 6) { toast("비밀번호는 6자 이상이어야 합니다.", true); return; }
  const pw2 = prompt("확인을 위해 한 번 더 입력하세요:");
  if (pw2 === null) return;
  if (pw !== pw2) { toast("두 비밀번호가 일치하지 않습니다.", true); return; }
  const { error } = await sb.auth.updateUser({ password: pw });
  if (error) { toast("변경 실패: " + error.message, true); return; }
  toast("비밀번호가 변경되었습니다. 다음 로그인부터 적용됩니다.");
}

/* ---------- 자료 조회 ---------- */
async function fetchMaterial(id) {
  const { data: m, error } = await sb.from("materials").select("*").eq("id", id).single();
  if (error) throw error;
  const { data: v, error: ve } = await sb.from("versions").select("*").eq("id", m.current_version_id).single();
  if (ve) throw ve;
  return { ...m, current: v };
}

/* ---------- 목록 ---------- */
async function showList() {
  show("#view-list");
  // 자료 + 현재 버전 조인
  const { data: mats, error } = await sb
    .from("materials")
    .select("id, month, created_at, current_version_id, versions!materials_current_version_fk(version_no, title, theme, poster_path, created_at)")
    .order("month", { ascending: false });
  if (error) { toast(error.message, true); return; }

  // 각 자료의 버전 개수
  const cards = await Promise.all(mats.map(async (m) => {
    const cur = m.versions || {};
    const { count } = await sb.from("versions").select("id", { count: "exact", head: true }).eq("material_id", m.id);
    return { ...m, cur, version_count: count ?? 0 };
  }));

  $("#empty-msg").hidden = cards.length > 0;
  $("#material-cards").innerHTML = cards.map((m) => `
    <div class="card" onclick="openDetail(${m.id})">
      <div class="card-poster">${m.cur.poster_path
        ? `<img src="${posterUrl(m.cur.poster_path)}" alt="포스터">`
        : `<div class="no-poster">🛡️</div>`}</div>
      <div class="card-body">
        <div class="card-month">${esc(m.month)}</div>
        <div class="card-title">${esc(m.cur.title || "(제목 없음)")}</div>
        <div class="card-meta">${esc(m.cur.theme || "")}</div>
        <div class="card-meta">v${m.cur.version_no ?? "-"} · 버전 ${m.version_count}개 · ${fmtDate(m.cur.created_at)}</div>
      </div>
    </div>`).join("");
}

/* ---------- 등록/편집 폼 ---------- */
function showCreate() {
  editingId = null;
  $("#form-title").textContent = "새 자료 등록";
  const f = $("#material-form");
  f.reset();
  f.month.disabled = false;
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  f.month.value = d.toISOString().slice(0, 7);
  show("#view-form");
}

/* generate-poster 함수로 월간 자료(내용+A4 포스터)를 AI 자동 생성 → 새 버전으로 저장 */
async function generateMaterial() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  const month = prompt("AI로 자동 생성할 대상 월 (YYYY-MM):", d.toISOString().slice(0, 7));
  if (!month) return;
  if (!/^\d{4}-\d{2}$/.test(month.trim())) { toast("YYYY-MM 형식으로 입력하세요.", true); return; }
  const m = month.trim();
  const btn = $("#gen-btn");
  const prev = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "생성 중…"; }
  toast("AI가 내용·포스터를 생성 중입니다… 웹검색 포함 1~2분 걸립니다.");
  try {
    const { data, error } = await sb.functions.invoke("generate-poster", { body: { month: m } });
    if (error) throw error;
    if (data && data.error) throw new Error(data.error);
    toast(`${m} 자료가 생성되었습니다.`);
    const { data: mat } = await sb.from("materials").select("id").eq("month", m).maybeSingle();
    if (mat && mat.id) openDetail(mat.id); else showList();
  } catch (e) {
    toast(e.message || "자동 생성 중 오류가 발생했습니다.", true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = prev; }
  }
}

function showEdit() {
  if (!current) return;
  editingId = current.id;
  $("#form-title").textContent = `자료 편집 — ${current.month} (저장하면 새 버전이 생성됩니다)`;
  const f = $("#material-form");
  const c = current.current;
  f.month.value = current.month;
  f.month.disabled = true;
  f.title.value = c.title;
  f.theme.value = c.theme;
  f.content.value = c.content;
  f.rules.value = (c.rules || []).join("\n");
  f.change_note.value = "";
  f.poster.value = "";
  show("#view-form");
}

function cancelForm() {
  if (editingId) openDetail(editingId);
  else showList();
}

/* 포스터 파일을 Storage에 업로드하고 경로 반환 */
async function uploadPoster(file) {
  if (!file) return null;
  const ext = file.name.split(".").pop().toLowerCase();
  const path = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const { error } = await sb.storage.from("posters").upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}

async function submitForm(ev) {
  ev.preventDefault();
  const f = $("#material-form");
  const btn = $("#form-submit");
  btn.disabled = true;
  try {
    const rules = f.rules.value.split("\n").map((s) => s.trim()).filter(Boolean);
    const poster = f.poster.files[0] ? await uploadPoster(f.poster.files[0]) : null;

    if (editingId) {
      const { data, error } = await sb.rpc("add_version", {
        p_material_id: editingId,
        p_title: f.title.value.trim(),
        p_theme: f.theme.value.trim(),
        p_content: f.content.value,
        p_rules: rules,
        p_poster_path: poster,
        p_change_note: f.change_note.value.trim() || "내용 수정",
        p_change_source: "manual",
      });
      if (error) throw error;
      toast(`v${data.version_no} 버전으로 저장되었습니다.`);
      openDetail(editingId);
    } else {
      const { data, error } = await sb.rpc("create_material", {
        p_month: f.month.value,
        p_title: f.title.value.trim(),
        p_theme: f.theme.value.trim(),
        p_content: f.content.value,
        p_rules: rules,
        p_poster_path: poster,
        p_change_note: f.change_note.value.trim(),
      });
      if (error) throw error;
      toast("자료가 등록되었습니다.");
      openDetail(data.id);
    }
  } catch (e) {
    toast(e.message || "저장 중 오류가 발생했습니다.", true);
  } finally {
    btn.disabled = false;
  }
  return false;
}

/* ---------- 상세 ---------- */
async function openDetail(id) {
  try {
    current = await fetchMaterial(id);
  } catch (e) { toast(e.message, true); return; }
  lastProposal = null;
  nlDraft = null;
  $("#proposal-box").hidden = true;
  renderDetail();
  show("#view-detail");
  switchTab("content");
}

function renderDetail() {
  const c = current.current;
  $("#detail-title").textContent = `${current.month} · ${c.title}`;
  $("#detail-badge").textContent = `v${c.version_no}`;
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
  if (name === "ai") loadAiHistory();
  if (name === "newsletter") renderNewsletter();
}

/* ---------- 버전 이력 ---------- */
const SOURCE_LABEL = { manual: "수동", ai: "AI", rollback: "롤백" };

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
      <td>${v.version_no !== cur
        ? `<button class="btn small" onclick="rollback(${v.version_no})">이 버전으로 복원</button>` : ""}</td>
    </tr>`).join("");

  const opts = versions.map((v) => `<option value="${v.version_no}">v${v.version_no}</option>`).join("");
  $("#diff-from").innerHTML = opts;
  $("#diff-to").innerHTML = opts;
  if (versions.length >= 2) $("#diff-from").value = versions[1].version_no;
  $("#diff-output").hidden = true;
}

async function rollback(vno) {
  if (!confirm(`v${vno} 내용으로 복원할까요? (새 버전으로 기록됩니다)`)) return;
  const { data, error } = await sb.rpc("rollback_version", {
    p_material_id: current.id, p_version_no: vno,
  });
  if (error) { toast(error.message, true); return; }
  toast(`v${vno} 내용이 v${data.version_no}로 복원되었습니다.`);
  current = await fetchMaterial(current.id);
  renderDetail();
  loadVersions();
}

/* 버전 본문을 텍스트로 펼쳐 클라이언트에서 diff */
function flatVersion(v) {
  const lines = [`제목: ${v.title}`, `테마: ${v.theme}`, "", "[내용]"];
  lines.push(...(v.content || "").split("\n"));
  lines.push("", "[임직원 수칙]", ...(v.rules || []).map((r) => `- ${r}`));
  return lines;
}

/* 간단한 LCS 기반 unified diff */
function unifiedDiff(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push(" " + a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push("-" + a[i]); i++; }
    else { out.push("+" + b[j]); j++; }
  }
  while (i < n) out.push("-" + a[i++]);
  while (j < m) out.push("+" + b[j++]);
  return out;
}

async function loadDiff() {
  const from = +$("#diff-from").value, to = +$("#diff-to").value;
  const { data, error } = await sb.from("versions")
    .select("version_no, title, theme, content, rules")
    .eq("material_id", current.id).in("version_no", [from, to]);
  if (error) { toast(error.message, true); return; }
  const a = data.find((v) => v.version_no === from);
  const b = data.find((v) => v.version_no === to);
  if (!a || !b) { toast("버전을 찾을 수 없습니다.", true); return; }

  const lines = [`--- v${from}`, `+++ v${to}`, ...unifiedDiff(flatVersion(a), flatVersion(b))];
  const pre = $("#diff-output");
  pre.hidden = false;
  pre.innerHTML = lines.map((line) => {
    const cls = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "";
    return `<span class="${cls}">${esc(line)}</span>`;
  }).join("\n");
}

async function deleteMaterial() {
  if (!confirm(`${current.month} 자료와 모든 버전 이력을 삭제할까요?`)) return;
  const { error } = await sb.from("materials").delete().eq("id", current.id);
  if (error) { toast(error.message, true); return; }
  toast("삭제되었습니다.");
  showList();
}

/* ---------- AI 질의 ---------- */
async function loadAiHistory() {
  const { data: logs, error } = await sb.from("ai_logs")
    .select("role, content, created_at")
    .eq("material_id", current.id)
    .order("id", { ascending: true });
  if (error) { toast(error.message, true); return; }
  const box = $("#chat-log");
  box.innerHTML = logs.length
    ? logs.map((l) => `<div class="msg ${l.role}">${md(l.content)}</div>`).join("")
    : `<div class="empty">아직 대화가 없습니다.</div>`;
  box.scrollTop = box.scrollHeight;
}

async function sendAi(ev) {
  ev.preventDefault();
  const input = $("#ai-message");
  const message = input.value.trim();
  if (!message) return false;

  const box = $("#chat-log");
  box.insertAdjacentHTML("beforeend", `<div class="msg user">${esc(message)}</div>`);
  box.insertAdjacentHTML("beforeend", `<div class="msg assistant pending" id="pending">생각 중…</div>`);
  box.scrollTop = box.scrollHeight;
  input.value = "";
  $("#ai-send").disabled = true;

  try {
    // 최근 대화 이력 불러오기 (컨텍스트용)
    const { data: history } = await sb.from("ai_logs")
      .select("role, content").eq("material_id", current.id).order("id", { ascending: true });

    // Edge Function 호출 (Authorization 헤더는 supabase-js가 자동 첨부)
    const { data: out, error } = await sb.functions.invoke("ai-ask", {
      body: { material: current, history: history || [], message },
    });
    if (error) throw error;
    if (out.error) throw new Error(out.error);

    $("#pending").outerHTML = `<div class="msg assistant">${md(out.reply)}</div>`;

    // 대화 로그 저장
    await sb.from("ai_logs").insert([
      { material_id: current.id, role: "user", content: message },
      { material_id: current.id, role: "assistant", content: out.reply },
    ]);

    if (out.proposal) showProposal(out.proposal);
  } catch (e) {
    $("#pending").outerHTML = `<div class="msg assistant error">⚠️ ${esc(e.message || e)}</div>`;
  } finally {
    $("#ai-send").disabled = false;
    box.scrollTop = box.scrollHeight;
  }
  return false;
}

function showProposal(p) {
  lastProposal = p;
  $("#proposal-preview").innerHTML = `
    <p><strong>제목:</strong> ${esc(p.title)}</p>
    <p><strong>테마:</strong> ${esc(p.theme)}</p>
    <div class="proposal-content">${md(p.content)}</div>
    <p><strong>임직원 수칙:</strong></p>
    <ol>${p.rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ol>`;
  $("#proposal-box").hidden = false;
}

function dismissProposal() {
  $("#proposal-box").hidden = true;
  lastProposal = null;
}

async function applyProposal() {
  if (!lastProposal) return;
  const note = prompt("버전 이력에 남길 변경 메모:", "AI 수정안 적용") ?? "AI 수정안 적용";
  const { data, error } = await sb.rpc("add_version", {
    p_material_id: current.id,
    p_title: lastProposal.title,
    p_theme: lastProposal.theme || "",
    p_content: lastProposal.content || "",
    p_rules: lastProposal.rules || [],
    p_poster_path: null,
    p_change_note: note,
    p_change_source: "ai",
  });
  if (error) { toast(error.message, true); return; }
  toast(`AI 수정안이 v${data.version_no}로 적용되었습니다.`);
  current = await fetchMaterial(current.id);
  renderDetail();
  dismissProposal();
}

/* ---------- 뉴스레터 ---------- */
// 뉴스레터는 versions.newsletter(jsonb)에 저장되며, 수정 시 새 버전으로 기록된다.
// nlDraft = 저장 전 작업 중인 초안. null이면 현재 저장된 뉴스레터를 표시.

function currentNewsletter() {
  return (current && current.current && current.current.newsletter) || null;
}

function renderNewsletter() {
  $("#nl-edit").hidden = true;
  const saved = currentNewsletter();
  const draft = nlDraft;
  const showNl = draft || saved;

  $("#nl-draft-actions").hidden = !draft;
  $("#nl-status").textContent = draft
    ? "⚠️ 저장되지 않은 초안입니다. 검토 후 ‘새 버전으로 저장’을 누르세요."
    : (saved ? `현재 뉴스레터 (v${current.current.version_no} 기준)` : "");

  $("#nl-preview").innerHTML = showNl
    ? renderNewsletterHTML(showNl)
    : `<div class="empty">아직 뉴스레터가 없습니다. ‘AI 자동 생성’으로 시작하세요.</div>`;
}

// 미리보기는 표준 템플릿(newsletter-template.js)에 위임 — PDF와 동일(인라인 SVG) 포맷.
function renderNewsletterHTML(nl) {
  return NewsletterTemplate.renderNewsletterFull(
    nl,
    NewsletterTemplate.monthLabel(current && current.month),
  );
}

/* 현재 뉴스레터(초안 우선)를 표준 포맷 A4 문서로 열고 인쇄(PDF로 저장) */
function downloadNewsletterPdf() {
  if (!current) return;
  const nl = nlDraft || currentNewsletter();
  if (!nl) { toast("먼저 뉴스레터를 생성/저장하세요.", true); return; }
  const w = window.open("", "_blank");
  if (!w) { toast("팝업이 차단되었습니다. 팝업을 허용한 뒤 다시 시도하세요.", true); return; }
  w.document.write(NewsletterTemplate.buildPrintDocument(nl, current.month));
  w.document.close();
  w.focus();
  // 렌더 완료 후 인쇄 다이얼로그(대상: 'PDF로 저장')
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
  // 포스터 이미지 로드 시간을 고려해 약간 지연 후 인쇄
  setTimeout(() => { try { w.print(); } catch (e) { /* 사용자가 직접 인쇄 가능 */ } }, purl ? 800 : 400);
}

/* AI 자동 생성 (web search 포함) */
async function generateNewsletter() {
  if (!current) return;
  const btn = $("#nl-generate");
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = "생성 중… (웹 검색, 최대 1분)";
  try {
    const { data, error } = await sb.functions.invoke("generate-newsletter", {
      body: { month: current.month, material: current },
    });
    if (error) throw error;
    if (data.error) throw new Error(data.error);
    nlDraft = data.newsletter;
    nlDraftSource = "ai";
    renderNewsletter();
    toast("뉴스레터 초안이 생성되었습니다. 검토 후 저장하세요.");
  } catch (e) {
    toast(e.message || "생성 중 오류가 발생했습니다.", true);
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

/* AI로 수정 — 현재 초안(또는 저장된 뉴스레터)을 지시대로 고침 */
async function aiEditNewsletter() {
  if (!current) return;
  const base = nlDraft || currentNewsletter();
  if (!base) { toast("먼저 뉴스레터를 생성하세요.", true); return; }
  const instruction = prompt(
    "AI에게 수정 요청을 입력하세요:\n예) 톤을 더 친근하게 / 랜섬웨어 헤드라인 추가 / 팁을 퀴즈 형식으로");
  if (!instruction || !instruction.trim()) return;
  toast("AI가 수정 중…");
  try {
    const { data, error } = await sb.functions.invoke("generate-newsletter", {
      body: { month: current.month, material: current, current: base, instruction },
    });
    if (error) throw error;
    if (data.error) throw new Error(data.error);
    nlDraft = data.newsletter;
    nlDraftSource = "ai";
    renderNewsletter();
    toast("AI 수정안이 적용되었습니다. 검토 후 저장하세요.");
  } catch (e) {
    toast(e.message || "AI 수정 중 오류가 발생했습니다.", true);
  }
}

/* 수동 편집 폼 */
function editNewsletter() {
  if (!current) return;
  const base = nlDraft || currentNewsletter() ||
    { subject: "", intro: "", headlines: [], deep_dive: { heading: "", body: "" }, tip: "", closing: "" };
  $("#nl-preview").innerHTML = "";
  $("#nl-status").textContent = "";
  $("#nl-draft-actions").hidden = true;
  renderNewsletterForm(base);
  $("#nl-edit").hidden = false;
}

function headlineRowHTML(h) {
  h = h || { title: "", summary: "", source: "", link: "" };
  return `<div class="nl-head-row">
    <input class="nlh-title" type="text" placeholder="헤드라인" value="${escAttr(h.title)}">
    <textarea class="nlh-summary" rows="2" placeholder="요약·시사점">${esc(h.summary)}</textarea>
    <div class="row">
      <input class="nlh-source" type="text" placeholder="출처(매체+시기)" value="${escAttr(h.source)}">
      <input class="nlh-link" type="text" placeholder="원문 URL(선택)" value="${escAttr(h.link)}">
    </div>
    <button type="button" class="btn small danger" onclick="this.closest('.nl-head-row').remove()">행 삭제</button>
  </div>`;
}

function addHeadlineRow() {
  $("#nlf-headlines").insertAdjacentHTML("beforeend", headlineRowHTML());
}

function renderNewsletterForm(nl) {
  const dd = nl.deep_dive || {};
  $("#nl-form-fields").innerHTML = `
    <label>제목 <input id="nlf-subject" type="text" value="${escAttr(nl.subject)}"></label>
    <label>도입 인사말 (마크다운) <textarea id="nlf-intro" rows="3">${esc(nl.intro)}</textarea></label>
    <div class="nl-heads-head">
      <span>이달의 보안 뉴스</span>
      <button type="button" class="btn small" onclick="addHeadlineRow()">+ 헤드라인 추가</button>
    </div>
    <div id="nlf-headlines"></div>
    <label>심층 분석 소제목 <input id="nlf-dd-heading" type="text" value="${escAttr(dd.heading)}"></label>
    <label>심층 분석 본문 (마크다운) <textarea id="nlf-dd-body" rows="5">${esc(dd.body)}</textarea></label>
    <label>이달의 팁 <input id="nlf-tip" type="text" value="${escAttr(nl.tip)}"></label>
    <label>마무리 멘트 <textarea id="nlf-closing" rows="2">${esc(nl.closing)}</textarea></label>`;
  const cont = $("#nlf-headlines");
  (nl.headlines || []).forEach((h) => cont.insertAdjacentHTML("beforeend", headlineRowHTML(h)));
}

function collectNewsletterForm() {
  const heads = [...document.querySelectorAll("#nlf-headlines .nl-head-row")].map((r) => ({
    title: r.querySelector(".nlh-title").value.trim(),
    summary: r.querySelector(".nlh-summary").value.trim(),
    source: r.querySelector(".nlh-source").value.trim(),
    link: r.querySelector(".nlh-link").value.trim(),
  })).filter((h) => h.title || h.summary);
  return {
    subject: $("#nlf-subject").value.trim(),
    intro: $("#nlf-intro").value,
    headlines: heads,
    deep_dive: { heading: $("#nlf-dd-heading").value.trim(), body: $("#nlf-dd-body").value },
    tip: $("#nlf-tip").value.trim(),
    closing: $("#nlf-closing").value,
  };
}

function applyNewsletterForm() {
  nlDraft = collectNewsletterForm();
  nlDraftSource = "manual";
  $("#nl-edit").hidden = true;
  renderNewsletter();
}

function cancelNewsletterForm() {
  $("#nl-edit").hidden = true;
  renderNewsletter();
}

function discardNewsletterDraft() {
  nlDraft = null;
  renderNewsletter();
}

/* 초안을 새 버전으로 저장 (포스터/본문/수칙은 carry-forward) */
async function saveNewsletter() {
  if (!nlDraft || !current) return;
  const note = prompt("버전 이력에 남길 변경 메모:", "뉴스레터 수정") ?? "뉴스레터 수정";
  const c = current.current;
  try {
    const { data, error } = await sb.rpc("add_version", {
      p_material_id: current.id,
      p_title: c.title,
      p_theme: c.theme,
      p_content: c.content,
      p_rules: c.rules || [],
      p_poster_path: null,        // null → 직전 포스터 유지
      p_change_note: note,
      p_change_source: nlDraftSource,
      p_newsletter: nlDraft,
    });
    if (error) throw error;
    nlDraft = null;
    current = await fetchMaterial(current.id);
    renderDetail();
    renderNewsletter();
    toast(`뉴스레터가 v${data.version_no}로 저장되었습니다.`);
  } catch (e) {
    toast(e.message || "저장 중 오류가 발생했습니다.", true);
  }
}

/* ---------- 시작 ---------- */
if (!cfg || cfg.SUPABASE_URL.includes("YOUR-PROJECT")) {
  document.body.innerHTML =
    '<p style="padding:40px;font-family:sans-serif">⚠️ web/config.js에 Supabase URL과 anon key를 설정하세요.</p>';
} else {
  initAuth();
}
