"""secuday — 매월 1일 정보보호의 날 자료 관리 (secuday.jbax.co.kr)."""
import difflib
import json
import os
import re
import time
import uuid

from flask import Flask, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename

import ai
import db

BASE_DIR = os.path.dirname(__file__)
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".pdf"}
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")

app = Flask(__name__, static_folder="static", static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024  # 20MB

db.init_db()


def err(msg, status=400):
    return jsonify({"error": msg}), status


def save_poster(file):
    """포스터 파일 저장. 파일이 없으면 None 반환."""
    if not file or not file.filename:
        return None
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXT:
        raise ValueError(f"허용되지 않는 파일 형식입니다: {ext}")
    name = f"{int(time.time())}_{uuid.uuid4().hex[:8]}_{secure_filename(file.filename)}"
    file.save(os.path.join(UPLOAD_DIR, name))
    return name


def parse_form(form):
    rules = json.loads(form.get("rules") or "[]")
    if not isinstance(rules, list):
        raise ValueError("rules는 문자열 배열이어야 합니다.")
    return {
        "title": (form.get("title") or "").strip(),
        "theme": (form.get("theme") or "").strip(),
        "content": form.get("content") or "",
        "rules": [str(r).strip() for r in rules if str(r).strip()],
        "change_note": (form.get("change_note") or "").strip(),
    }


@app.get("/")
def index():
    return send_from_directory("static", "index.html")


@app.get("/uploads/<path:name>")
def uploads(name):
    return send_from_directory(UPLOAD_DIR, name)


# ---------- 자료 ----------

@app.get("/api/materials")
def api_list():
    return jsonify(db.list_materials())


@app.post("/api/materials")
def api_create():
    try:
        f = parse_form(request.form)
        month = (request.form.get("month") or "").strip()
        if not MONTH_RE.match(month):
            return err("month는 YYYY-MM 형식이어야 합니다.")
        if not f["title"]:
            return err("제목을 입력해 주세요.")
        poster = save_poster(request.files.get("poster"))
        mid = db.create_material(month, f["title"], f["theme"], f["content"],
                                 f["rules"], poster, f["change_note"])
    except ValueError as e:
        return err(str(e))
    except db.sqlite3.IntegrityError:
        return err(f"{month} 자료가 이미 존재합니다.", 409)
    return jsonify(db.get_material(mid)), 201


@app.get("/api/materials/<int:mid>")
def api_get(mid):
    m = db.get_material(mid)
    return jsonify(m) if m else err("자료를 찾을 수 없습니다.", 404)


@app.put("/api/materials/<int:mid>")
def api_update(mid):
    if not db.get_material(mid):
        return err("자료를 찾을 수 없습니다.", 404)
    try:
        f = parse_form(request.form)
        if not f["title"]:
            return err("제목을 입력해 주세요.")
        poster = save_poster(request.files.get("poster"))  # None이면 기존 포스터 유지
        vno = db.add_version(mid, f["title"], f["theme"], f["content"], f["rules"],
                             poster, f["change_note"] or "내용 수정", "manual")
    except ValueError as e:
        return err(str(e))
    out = db.get_material(mid)
    out["new_version_no"] = vno
    return jsonify(out)


@app.delete("/api/materials/<int:mid>")
def api_delete(mid):
    if not db.get_material(mid):
        return err("자료를 찾을 수 없습니다.", 404)
    db.delete_material(mid)
    return jsonify({"ok": True})


# ---------- 버전 ----------

@app.get("/api/materials/<int:mid>/versions")
def api_versions(mid):
    return jsonify(db.list_versions(mid))


@app.get("/api/materials/<int:mid>/versions/<int:vno>")
def api_version(mid, vno):
    v = db.get_version(mid, vno)
    return jsonify(v) if v else err("버전을 찾을 수 없습니다.", 404)


@app.post("/api/materials/<int:mid>/rollback/<int:vno>")
def api_rollback(mid, vno):
    v = db.get_version(mid, vno)
    if not v:
        return err("버전을 찾을 수 없습니다.", 404)
    new_no = db.add_version(mid, v["title"], v["theme"], v["content"], v["rules"],
                            v["poster_path"], f"v{vno}으로 되돌림", "rollback")
    out = db.get_material(mid)
    out["new_version_no"] = new_no
    return jsonify(out)


@app.get("/api/materials/<int:mid>/diff")
def api_diff(mid):
    """두 버전을 텍스트로 펼쳐 라인 단위 diff를 반환."""
    try:
        a = db.get_version(mid, int(request.args.get("from", 0)))
        b = db.get_version(mid, int(request.args.get("to", 0)))
    except ValueError:
        return err("from/to 버전 번호가 올바르지 않습니다.")
    if not a or not b:
        return err("버전을 찾을 수 없습니다.", 404)

    def flat(v):
        lines = [f"제목: {v['title']}", f"테마: {v['theme']}", "", "[내용]"]
        lines += v["content"].splitlines()
        lines += ["", "[임직원 수칙]"] + [f"- {r}" for r in v["rules"]]
        return lines

    diff = []
    for line in difflib.unified_diff(flat(a), flat(b),
                                     fromfile=f"v{a['version_no']}",
                                     tofile=f"v{b['version_no']}", lineterm=""):
        diff.append(line)
    return jsonify({"from": a["version_no"], "to": b["version_no"], "diff": diff})


# ---------- AI 질의 ----------

@app.get("/api/materials/<int:mid>/ai/history")
def api_ai_history(mid):
    return jsonify(db.list_ai_logs(mid))


@app.post("/api/materials/<int:mid>/ai")
def api_ai_ask(mid):
    m = db.get_material(mid)
    if not m:
        return err("자료를 찾을 수 없습니다.", 404)
    body = request.get_json(silent=True) or {}
    message = (body.get("message") or "").strip()
    if not message:
        return err("질의 내용을 입력해 주세요.")
    history = db.list_ai_logs(mid)
    try:
        result = ai.ask(m, history, message)
    except RuntimeError as e:
        return err(str(e), 503)
    except Exception as e:
        return err(f"AI 질의 중 오류가 발생했습니다: {e}", 502)
    db.add_ai_log(mid, "user", message)
    db.add_ai_log(mid, "assistant", result["reply"])
    return jsonify(result)


@app.post("/api/materials/<int:mid>/ai/apply")
def api_ai_apply(mid):
    """AI 수정안을 검토 후 새 버전으로 적용."""
    if not db.get_material(mid):
        return err("자료를 찾을 수 없습니다.", 404)
    body = request.get_json(silent=True) or {}
    p = body.get("proposal") or {}
    if not p.get("title"):
        return err("적용할 수정안이 없습니다.")
    note = (body.get("change_note") or "AI 수정안 적용").strip()
    vno = db.add_version(mid, p["title"], p.get("theme", ""), p.get("content", ""),
                         p.get("rules", []), None, note, "ai")
    out = db.get_material(mid)
    out["new_version_no"] = vno
    return jsonify(out)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5234))
    app.run(host="127.0.0.1", port=port, debug=False)
