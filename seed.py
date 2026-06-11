"""샘플 데이터 시드 — 2026-06 정보보호의 날 자료."""
import os

import db

POSTER_SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
  <rect width="600" height="800" fill="#0f2a5c"/>
  <rect x="30" y="30" width="540" height="740" fill="none" stroke="#4f7fd9" stroke-width="3" rx="16"/>
  <text x="300" y="120" text-anchor="middle" fill="#9db9e8" font-size="26" font-family="sans-serif">매월 1일은 정보보호의 날</text>
  <text x="300" y="260" text-anchor="middle" font-size="110">🎣</text>
  <text x="300" y="380" text-anchor="middle" fill="#ffffff" font-size="44" font-weight="bold" font-family="sans-serif">피싱 메일,</text>
  <text x="300" y="440" text-anchor="middle" fill="#ffd166" font-size="44" font-weight="bold" font-family="sans-serif">한 번 더 의심하세요</text>
  <text x="300" y="540" text-anchor="middle" fill="#c8d6ef" font-size="22" font-family="sans-serif">클릭하기 전에 발신자를 확인하고</text>
  <text x="300" y="575" text-anchor="middle" fill="#c8d6ef" font-size="22" font-family="sans-serif">의심스러우면 정보보호팀에 신고하세요</text>
  <text x="300" y="720" text-anchor="middle" fill="#6f8fc4" font-size="18" font-family="sans-serif">JBAX 정보보호팀 · secuday.jbax.co.kr</text>
</svg>"""

CONTENT = """## 이달의 주제: 피싱 메일 주의

최근 임직원을 사칭하거나 급여명세서·택배 안내를 가장한 피싱 메일이 증가하고 있습니다.
피싱 메일은 클릭 한 번으로 계정 탈취와 내부 정보 유출로 이어질 수 있습니다.

### 이런 메일을 조심하세요
- 긴급한 조치를 요구하며 링크 클릭을 유도하는 메일
- 발신자 표시 이름은 익숙하지만 실제 주소가 다른 메일
- 압축파일(.zip), 실행파일(.exe) 첨부 메일

### 의심 메일을 받았다면
1. 링크와 첨부파일을 열지 않습니다.
2. 메일 상단의 [의심 메일 신고] 버튼 또는 정보보호팀(security@jbax.co.kr)으로 신고합니다.
3. 이미 클릭했다면 즉시 비밀번호를 변경하고 정보보호팀에 알립니다."""

RULES = [
    "메일을 열기 전에 발신자 주소를 끝까지 확인한다.",
    "출처가 불분명한 링크와 첨부파일은 클릭하지 않는다.",
    "긴급·협박성 문구로 행동을 재촉하는 메일은 일단 의심한다.",
    "의심 메일은 삭제하지 말고 정보보호팀에 신고한다.",
    "회사 계정 비밀번호는 외부 사이트에서 재사용하지 않는다.",
]


def run():
    db.init_db()
    if db.list_materials():
        print("이미 데이터가 있어 시드를 건너뜁니다.")
        return
    poster_name = "sample_poster_2026-06.svg"
    upload_dir = os.path.join(os.path.dirname(__file__), "uploads")
    os.makedirs(upload_dir, exist_ok=True)
    with open(os.path.join(upload_dir, poster_name), "w", encoding="utf-8") as f:
        f.write(POSTER_SVG)
    mid = db.create_material(
        month="2026-06",
        title="6월 정보보호의 날 — 피싱 메일, 한 번 더 의심하세요",
        theme="피싱 메일 주의",
        content=CONTENT,
        rules=RULES,
        poster_path=poster_name,
        change_note="최초 등록 (샘플 데이터)",
    )
    print(f"샘플 자료 생성 완료 (id={mid}, month=2026-06)")


if __name__ == "__main__":
    run()
