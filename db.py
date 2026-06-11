"""SQLite 데이터 계층 — 정보보호의 날 자료 + 버전 관리."""
import json
import os
import sqlite3
from datetime import datetime, timezone

DB_PATH = os.path.join(os.path.dirname(__file__), "data", "secuday.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month TEXT NOT NULL UNIQUE,              -- 'YYYY-MM' (매월 1일 정보보호의 날)
    current_version_id INTEGER,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    version_no INTEGER NOT NULL,
    title TEXT NOT NULL,
    theme TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',        -- 포스터 본문/안내문 (마크다운)
    rules TEXT NOT NULL DEFAULT '[]',        -- 임직원 수칙 (JSON 배열)
    poster_path TEXT,                        -- 업로드된 포스터 파일 경로
    change_note TEXT NOT NULL DEFAULT '',
    change_source TEXT NOT NULL DEFAULT 'manual',  -- manual | ai | rollback
    created_at TEXT NOT NULL,
    UNIQUE(material_id, version_no)
);

CREATE TABLE IF NOT EXISTS ai_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    role TEXT NOT NULL,                      -- user | assistant
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""


def now():
    return datetime.now(timezone.utc).isoformat()


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with get_conn() as conn:
        conn.executescript(SCHEMA)


def version_to_dict(row):
    d = dict(row)
    d["rules"] = json.loads(d["rules"])
    return d


def list_materials():
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT m.id, m.month, m.created_at, v.id AS version_id, v.version_no,
                      v.title, v.theme, v.poster_path, v.created_at AS updated_at,
                      (SELECT COUNT(*) FROM versions WHERE material_id = m.id) AS version_count
               FROM materials m
               LEFT JOIN versions v ON v.id = m.current_version_id
               ORDER BY m.month DESC"""
        ).fetchall()
        return [dict(r) for r in rows]


def get_material(material_id):
    with get_conn() as conn:
        m = conn.execute("SELECT * FROM materials WHERE id = ?", (material_id,)).fetchone()
        if not m:
            return None
        v = conn.execute("SELECT * FROM versions WHERE id = ?", (m["current_version_id"],)).fetchone()
        out = dict(m)
        out["current"] = version_to_dict(v) if v else None
        return out


def create_material(month, title, theme, content, rules, poster_path, change_note):
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO materials (month, created_at) VALUES (?, ?)", (month, now())
        )
        material_id = cur.lastrowid
        vid = _insert_version(
            conn, material_id, 1, title, theme, content, rules,
            poster_path, change_note or "최초 등록", "manual",
        )
        conn.execute("UPDATE materials SET current_version_id = ? WHERE id = ?", (vid, material_id))
        return material_id


def add_version(material_id, title, theme, content, rules, poster_path, change_note, source="manual"):
    """모든 수정은 새 버전으로 기록된다. poster_path가 None이면 직전 포스터 유지."""
    with get_conn() as conn:
        last = conn.execute(
            "SELECT MAX(version_no) AS n FROM versions WHERE material_id = ?", (material_id,)
        ).fetchone()["n"] or 0
        if poster_path is None:
            prev = conn.execute(
                "SELECT poster_path FROM versions v JOIN materials m ON m.current_version_id = v.id WHERE m.id = ?",
                (material_id,),
            ).fetchone()
            poster_path = prev["poster_path"] if prev else None
        vid = _insert_version(
            conn, material_id, last + 1, title, theme, content, rules,
            poster_path, change_note, source,
        )
        conn.execute("UPDATE materials SET current_version_id = ? WHERE id = ?", (vid, material_id))
        return last + 1


def _insert_version(conn, material_id, version_no, title, theme, content, rules, poster_path, change_note, source):
    cur = conn.execute(
        """INSERT INTO versions
           (material_id, version_no, title, theme, content, rules, poster_path, change_note, change_source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (material_id, version_no, title, theme, content,
         json.dumps(rules, ensure_ascii=False), poster_path, change_note, source, now()),
    )
    return cur.lastrowid


def list_versions(material_id):
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT id, version_no, title, theme, change_note, change_source, poster_path, created_at
               FROM versions WHERE material_id = ? ORDER BY version_no DESC""",
            (material_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_version(material_id, version_no):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM versions WHERE material_id = ? AND version_no = ?",
            (material_id, version_no),
        ).fetchone()
        return version_to_dict(row) if row else None


def delete_material(material_id):
    with get_conn() as conn:
        conn.execute("DELETE FROM materials WHERE id = ?", (material_id,))


def add_ai_log(material_id, role, content):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO ai_logs (material_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            (material_id, role, content, now()),
        )


def list_ai_logs(material_id, limit=50):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT role, content, created_at FROM ai_logs WHERE material_id = ? ORDER BY id DESC LIMIT ?",
            (material_id, limit),
        ).fetchall()
        return [dict(r) for r in reversed(rows)]
