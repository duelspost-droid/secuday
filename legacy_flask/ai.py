"""Claude API 연동 — 자료에 대한 질의 및 수정안 생성."""
import json
import os

import anthropic

MODEL = "claude-opus-4-8"

SYSTEM_PROMPT = """당신은 기업 정보보호팀의 보안 인식(Security Awareness) 콘텐츠 전문가입니다.
이 회사는 매월 1일을 '정보보호의 날'로 지정하고, 임직원에게 보안 인식 제고를 위한
포스터 문구·안내 내용·임직원 수칙을 배포합니다.

사용자는 현재 작성 중인 자료에 대해 질문하거나 수정을 요청합니다.

규칙:
- 질문에는 reply 필드에 한국어로 답합니다.
- 사용자가 내용 수정/보완/개선을 요청한 경우에만 proposal 필드에 수정된 전체 자료를 담습니다.
  (단순 질문이면 proposal은 null로 둡니다.)
- proposal을 만들 때는 기존 자료를 기반으로 요청된 부분만 수정하고, 나머지는 유지합니다.
- content는 마크다운 형식, rules는 임직원이 바로 실천할 수 있는 명령형 문장 목록으로 작성합니다.
- 문체는 임직원 공지에 적합한 간결하고 명확한 한국어를 사용합니다."""

OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "reply": {
            "type": "string",
            "description": "사용자 질의에 대한 한국어 답변. 수정안을 만든 경우 무엇을 바꿨는지 요약.",
        },
        "proposal": {
            "anyOf": [
                {"type": "null"},
                {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "theme": {"type": "string"},
                        "content": {"type": "string"},
                        "rules": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["title", "theme", "content", "rules"],
                    "additionalProperties": False,
                },
            ],
            "description": "수정 요청일 때만 수정된 전체 자료. 단순 질문이면 null.",
        },
    },
    "required": ["reply", "proposal"],
    "additionalProperties": False,
}


def _client():
    has_key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")
    has_profile = os.path.isdir(os.path.expanduser("~/.config/anthropic/credentials"))
    if not (has_key or has_profile):
        raise RuntimeError(
            "Claude API 인증 정보가 없습니다. ANTHROPIC_API_KEY 환경변수를 설정한 뒤 서버를 재시작하세요."
        )
    return anthropic.Anthropic()  # ANTHROPIC_API_KEY / AUTH_TOKEN / ant 프로필 자동 인식


def ask(material, history, user_message):
    """현재 자료 + 대화 이력 + 질의를 Claude에 보내 답변/수정안을 받는다.

    Returns: {"reply": str, "proposal": dict | None}
    """
    cur = material["current"]
    context = (
        f"[현재 자료]\n"
        f"대상 월: {material['month']} (매월 1일 정보보호의 날)\n"
        f"제목: {cur['title']}\n"
        f"테마: {cur['theme']}\n"
        f"내용:\n{cur['content']}\n\n"
        f"임직원 수칙:\n" + "\n".join(f"- {r}" for r in cur["rules"])
    )

    messages = [{"role": "user", "content": context}]
    messages.append({"role": "assistant", "content": "자료를 확인했습니다. 질문이나 수정 요청을 말씀해 주세요."})
    for log in history[-10:]:
        messages.append({"role": log["role"], "content": log["content"]})
    messages.append({"role": "user", "content": user_message})

    response = _client().messages.create(
        model=MODEL,
        max_tokens=16000,
        thinking={"type": "adaptive"},
        system=SYSTEM_PROMPT,
        messages=messages,
        output_config={"format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
    )
    text = next(b.text for b in response.content if b.type == "text")
    return json.loads(text)
