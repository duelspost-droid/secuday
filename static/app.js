/* secuday 프런트엔드 */
let materials = [];
let current = null;        // 현재 열려 있는 자료 (GET /api/materials/:id 응답)
let editingId = null;      // 편집 중인 자료 id (null이면 신규 등록)
let lastProposal = null;   // 마지막 AI 수정안

const $ = (sel) => document.querySelector(sel);

async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("error", isError);
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.hidden = true), 3000);
}

function show(viewId) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = true));
  $(viewId).hidden = false;
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

/* 아주 단순한 마크다운 렌더링 (제목/굵게/목록/줄바꿈) */
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

/* ---------- 목록 ---------- */
async function showList() {
  show("#view-list");
  materials = await api("/api/materials");
  const box = $("#material-cards");
  $("#empty-msg").hidden = materials.length > 0;
  box.innerHTML = materials.map((m) => `
    <div class="card" onclick="openDetail(${m.id})">
      <div class="card-poster">${m.poster_path
        ? `<img src="/uploads/${esc(m.poster_path)}" alt="포스터">`
        : `<div class="no-poster">🛡️</div>`}</div>
      <div class="card-body">
        <div class="card-month">${esc(m.month)}</div>
        <div class="card-title">${esc(m.title || "(제목 없음)")}</div>
        <div class="card-meta">${esc(m.theme || "")}</div>
        <div class="card-meta">v${m.version_no ?? "-"} · 버전 ${m.version_count}개 · ${fmtDate(m.updated_at)}</div>
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
  // 기본값: 다음 달
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  f.month.value = d.toISOString().slice(0, 7);
  show("#view-form");
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
  f.rules.value = c.rules.join("\n");
  f.change_note.value = "";
  f.poster.value = "";
  show("#view-form");
}

function cancelForm() {
  if (editingId) openDetail(editingId);
  else showList();
}

async function submitForm(ev) {
  ev.preventDefault();
  const f = $("#material-form");
  const fd = new FormData();
  fd.append("month", f.month.value);
  fd.append("title", f.title.value);
  fd.append("theme", f.theme.value);
  fd.append("content", f.content.value);
  fd.append("rules", JSON.stringify(f.rules.value.split("\n").map((s) => s.trim()).filter(Boolean)));
  fd.append("change_note", f.change_note.value);
  if (f.poster.files[0]) fd.append("poster", f.poster.files[0]);

  try {
    if (editingId) {
      const out = await api(`/api/materials/${editingId}`, { method: "PUT", body: fd });
      toast(`v${out.new_version_no} 버전으로 저장되었습니다.`);
      openDetail(editingId);
    } else {
      const out = await api("/api/materials", { method: "POST", body: fd });
      toast("자료가 등록되었습니다.");
      openDetail(out.id);
    }
  } catch (e) {
    toast(e.message, true);
  }
  return false;
}

/* ---------- 상세 ---------- */
async function openDetail(id) {
  current = await api(`/api/materials/${id}`);
  lastProposal = null;
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
  $("#content-rules").innerHTML = c.rules.map((r) => `<li>${esc(r)}</li>`).join("");
  $("#poster-box").innerHTML = c.poster_path
    ? (c.poster_path.endsWith(".pdf")
        ? `<a class="btn" href="/uploads/${esc(c.poster_path)}" target="_blank">📄 포스터 PDF 열기</a>`
        : `<img src="/uploads/${esc(c.poster_path)}" alt="포스터">`)
    : `<div class="no-poster big">🛡️<br><small>포스터 없음</small></div>`;
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".tabpane").forEach((p) => (p.hidden = true));
  $(`#tab-${name}`).hidden = false;
  if (name === "history") loadVersions();
  if (name === "ai") loadAiHistory();
}

/* ---------- 버전 이력 ---------- */
const SOURCE_LABEL = { manual: "수동", ai: "AI", rollback: "롤백" };

async function loadVersions() {
  const versions = await api(`/api/materials/${current.id}/versions`);
  $("#version-rows").innerHTML = versions.map((v) => `
    <tr class="${v.version_no === current.current.version_no ? "current-row" : ""}">
      <td><strong>v${v.version_no}</strong>${v.version_no === current.current.version_no ? " ●" : ""}</td>
      <td>${esc(v.title)}</td>
      <td>${esc(v.change_note)}</td>
      <td><span class="badge src-${v.change_source}">${SOURCE_LABEL[v.change_source] || v.change_source}</span></td>
      <td>${fmtDate(v.created_at)}</td>
      <td>${v.version_no !== current.current.version_no
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
  const out = await api(`/api/materials/${current.id}/rollback/${vno}`, { method: "POST" });
  toast(`v${vno} 내용이 v${out.new_version_no}로 복원되었습니다.`);
  current = out;
  renderDetail();
  loadVersions();
}

async function loadDiff() {
  const from = $("#diff-from").value, to = $("#diff-to").value;
  const out = await api(`/api/materials/${current.id}/diff?from=${from}&to=${to}`);
  const pre = $("#diff-output");
  pre.hidden = false;
  pre.innerHTML = out.diff.map((line) => {
    const cls = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : line.startsWith("@@") ? "hunk" : "";
    return `<span class="${cls}">${esc(line)}</span>`;
  }).join("\n") || "(차이가 없습니다)";
}

async function deleteMaterial() {
  if (!confirm(`${current.month} 자료와 모든 버전 이력을 삭제할까요?`)) return;
  await api(`/api/materials/${current.id}`, { method: "DELETE" });
  toast("삭제되었습니다.");
  showList();
}

/* ---------- AI 질의 ---------- */
async function loadAiHistory() {
  const logs = await api(`/api/materials/${current.id}/ai/history`);
  const box = $("#chat-log");
  box.innerHTML = logs.map((l) =>
    `<div class="msg ${l.role}">${md(l.content)}</div>`).join("")
    || `<div class="empty">아직 대화가 없습니다.</div>`;
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
    const out = await api(`/api/materials/${current.id}/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    $("#pending").outerHTML = `<div class="msg assistant">${md(out.reply)}</div>`;
    if (out.proposal) showProposal(out.proposal);
  } catch (e) {
    $("#pending").outerHTML = `<div class="msg assistant error">⚠️ ${esc(e.message)}</div>`;
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
  try {
    const out = await api(`/api/materials/${current.id}/ai/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposal: lastProposal, change_note: note }),
    });
    toast(`AI 수정안이 v${out.new_version_no}로 적용되었습니다.`);
    current = out;
    renderDetail();
    dismissProposal();
  } catch (e) {
    toast(e.message, true);
  }
}

showList();
