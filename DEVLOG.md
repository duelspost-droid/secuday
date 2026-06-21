# DEVLOG — 뉴스레터(Newsletter) 신기능

> 정보보호의 날 자료에 **AI 자동 생성 뉴스레터**와 **그 뉴스레터를 수정하는 기능**을 추가하는 작업 기록.
> 작업 브랜치: `feature/newsletter`

---

## 2026-06-21 — 설계 결정

### 목표
1. **뉴스레터 자동 생성** — AI가 해당 월 자료를 바탕으로 임직원 보안 뉴스레터를 알아서 작성한다.
2. **뉴스레터 수정** — 생성된 뉴스레터를 관리자가 수동/AI로 고쳐 새 버전으로 저장한다.

### 핵심 결정 — 기존 버전관리에 통합 (별도 테이블 X)
뉴스레터를 별도 테이블·별도 버전체계로 만들지 않고, 기존 `versions` 행에
**`newsletter` (jsonb) 필드**를 추가하는 방식을 택했다.

- **이유**: 이 앱의 정체성이 "모든 수정 = 새 버전". 뉴스레터를 버전 행의 한 필드로 두면
  **편집·버전 이력·diff·롤백** 기능을 그대로 재사용한다 (= 요청하신 "수정 기능 가져오기").
- 포스터(`poster_path`)와 동일하게, `add_version` 호출 시 `p_newsletter`가 null이면
  직전 버전의 뉴스레터를 **carry-forward** 한다. 뉴스레터만 바꾸거나 본문만 바꿔도 서로 보존됨.
- 월(자료)당 하나의 현재 뉴스레터가 자연스럽게 유지된다.

### 데이터 구조 (newsletter jsonb)
```jsonc
{
  "subject":  "메일/뉴스레터 제목",
  "intro":    "도입 인사말 (마크다운)",
  "headlines": [                         // 이달의 보안 뉴스 카드 (2~4건)
    { "title": "...", "summary": "...", "source": "매체/시기", "link": "https://..." }
  ],
  "deep_dive": { "heading": "이달의 심층 분석", "body": "마크다운 본문" },
  "tip":      "이달의 보안 팁/퀴즈",
  "closing":  "마무리 멘트"
}
```

### 구성 요소
| 영역 | 변경 |
|---|---|
| DB | `0003_newsletter.sql` — `versions.newsletter` 추가 + RPC 3종 갱신(carry-forward) |
| Edge Function | `generate-newsletter` — 초안 생성(web search) + AI 수정(instruction+current). DB 미기록, 초안 JSON 반환(검토 후 클라가 add_version으로 저장) |
| 관리자 UI | 상세에 "뉴스레터" 탭: 자동 생성 → 미리보기 → 수동/AI 수정 → 새 버전 저장 |
| 설정 | `config.toml`에 `generate-newsletter` 등록(verify_jwt) |

### 의도적으로 v1 범위에서 제외 (후속)
- 공개 메인 페이지(index/public.js)에 뉴스레터 노출 — 후속.
- `send-mailing`이 평문 content 대신 뉴스레터로 발송 — 후속(기존 동작 변경 방지).

### 진행 상태
- [x] 설계 확정 / DEVLOG 시작
- [x] 0003 마이그레이션 — `versions.newsletter` 추가, `add_version`/`create_material`/`rollback_version`에 carry-forward 반영
- [x] generate-newsletter 함수 — 생성(web search)/수정(instruction+current) 2모드, 초안 JSON 반환
- [x] config.toml — `generate-newsletter` verify_jwt 등록
- [x] 관리자 UI(생성/보기) — 상세에 "뉴스레터" 탭 추가, 미리보기 렌더
- [x] 관리자 UI(수정) — 수동 폼(헤드라인 가변행) + AI 수정(instruction) → 초안 → 새 버전 저장
- [x] 정합성 점검(구문) — admin.js/public.js `node --check` 통과, Edge Function 3종 타입스트립 구문 통과
- [x] README 갱신 — 실제 루트 구조·4개 함수·뉴스레터·0003 마이그레이션 반영, DEVLOG 링크 추가

---

## 2026-06-21 — 관리자 UI & 검증

- **탭 구성**: 자료 보기 / **뉴스레터** / 버전 이력 / AI 질의.
- **버튼 3개**: `✨ AI 자동 생성`(web search), `🤖 AI로 수정`(지시문), `✏️ 수동 편집`(폼).
- **저장 흐름**: 생성·수정은 모두 `nlDraft`(미저장 초안)로 들어가고, 미리보기 검토 후
  `새 버전으로 저장` → `add_version(p_newsletter, p_change_source)`. 출처(ai/manual) 자동 기록.
- **보안**: 헤드라인 링크는 `safeUrl()`로 http/https만 허용, 속성값은 `escAttr()`로 이스케이프.
- **검증**: `node --check` 로 admin.js/public.js 통과. Deno 미설치라 Edge Function은
  Node 타입스트립 구문 검사로 확인(런타임 검증은 배포 후 필요 — 아래 배포 메모 참고).

### 배포 시 필요한 작업 (로컬에서 끝나지 않는 부분)
1. `supabase db push` (0003 적용) — PostgREST 스키마 캐시 자동 갱신.
2. `supabase functions deploy generate-newsletter`.
3. 시크릿 `ANTHROPIC_API_KEY`는 기존에 설정돼 있으면 재사용.

---

## 2026-06-21 — 배치 1회 실행 (샘플 생성)

배포 함수는 미배포/무자격증명이라, 함수와 동일한 모델·스키마로 **로컬에서 배치를 1회 실행**해 실제 결과물을 생성.
멀티에이전트 워크플로(웹 리서치 → 적대적 출처검증 → 작성 → 최종점검)로 품질을 끌어올림.

- **대상**: 2026년 7월 정보보호의 날 뉴스레터
- **결과**: 후보 헤드라인 12건 → 출처 검증 통과 12건 → 헤드라인 4건 + 심층분석 + 팁으로 구성, 최종점검 8건 보정
- **테마**: "보이는 게 다가 아니다 — 신뢰를 노린 공격(딥페이크·공급망·내부자), 한 번 더 확인"
- **출처(검증됨)**: 딥페이크 송금(다음/뉴스1), 코리안 리크스 공급망 랜섬웨어(Bitdefender), 쿠팡 6,246억 과징금(파이낸셜뉴스), 롯데카드 유출(경향신문) 등
- **산출물**:
  - `samples/newsletter-2026-07.json` — 앱 `versions.newsletter` 구조 그대로(저장/임포트용)
  - `samples/newsletter-2026-07.html` — 스탠드얼론 미리보기(브랜드 양식)
  - 인라인 미리보기는 채팅에 렌더링

### 발견 — md() 인용구(blockquote) 미지원 (후속 개선거리)
AI가 본문 실천 팁을 `> ✅ 실천:` 형태(마크다운 인용)로 작성하는데, 앱의 경량 `md()`
(admin.js·public.js·send-mailing)는 `>`/`&gt;`를 처리하지 못해 화면에 `&gt;`가 그대로 노출됨.
샘플 렌더에는 인용 콜아웃(초록 좌측 바)을 추가해 정상 표시되도록 했음.
→ **제안**: 앱 `md()`에 한 줄짜리 blockquote 처리를 추가하면 생성물 표현력이 좋아짐. (미적용, 사용자 확인 후 반영)

---

## 2026-06-21 — 표준 포맷 단일화 + PDF 다운로드

매달 반복 생산을 전제로, 흩어져 있던 뉴스레터 포맷을 **단일 템플릿으로 고정**하고 PDF 저장을 추가.

### 핵심 결정
- **표준 포맷 = `newsletter-template.js` (단일 소스)**. 관리자 미리보기·PDF·이메일이 전부 이 모듈을 기준 삼음.
  - `renderBody(nl)` 본문 섹션 / `documentShell(body,label)` 헤더밴드+푸터 / `buildPrintDocument(nl,month)` 인쇄용 A4 문서.
  - 표준 섹션 순서: 헤더밴드 → 제목 → 도입 → 📰 보안 뉴스(카드) → 🔎 심층 분석 → 💡 이달의 팁 → 맺음말 → 푸터.
  - md에 **blockquote(`>`) 지원 내장** → 앞서 발견한 `&gt;` 노출 이슈 해소.
- **PDF = 브라우저 인쇄→PDF 저장** 채택. 새 창에 표준 A4 문서를 써서 `window.print()` 호출.
  - 라이브러리 래스터화(html2canvas) 대비 한글이 **벡터로 선명**, 표준 포맷 그대로 보장.
  - 인쇄 시 색 유지(`print-color-adjust:exact`), 카드/팁 `break-inside:avoid`, 파일명 `정보보호의날_뉴스레터_YYYY-MM`.

### 변경 파일
| 파일 | 변경 |
|---|---|
| `newsletter-template.js` | **신규** — 표준 포맷 단일 소스 |
| `admin.html` | 모듈 include + `📄 PDF 다운로드` 버튼 |
| `admin.js` | 미리보기를 템플릿에 위임, `downloadNewsletterPdf()` 추가 |
| `style.css` | `.nl-doc/.nl-band/.nl-foot/.nl-quote` 추가, `.nl` 조정(셸이 테두리 담당) |
| `supabase/functions/send-mailing/index.ts` | newsletter 있으면 표준 포맷으로 발송(없으면 기존 content 폴백), 제목=subject, md blockquote 지원 |

### 검증
- `node --check`: newsletter-template.js / admin.js / send-mailing 통과.
- 템플릿 렌더 테스트(샘플 JSON): 헤더밴드·푸터·인용 콜아웃 3·헤드라인 카드 4·원문 링크·`@page`(A4)·PDF 제목 정상, `undefined` 없음.
- 런타임(실제 인쇄 다이얼로그)은 브라우저에서 최종 확인 필요.

### 진행 상태(2차)
- [x] 표준 템플릿 모듈
- [x] PDF 다운로드(버튼+인쇄)
- [x] 스타일 표준화
- [x] send-mailing 표준 포맷 적용
- [x] 문서/검증

---

## 2026-06-21 — 백엔드 구현 메모

- **add_version 시그니처 변경 주의**: 인자 9개로 늘어 기존 8-인자 함수를 `drop function`으로 제거 후 재생성.
  프런트의 기존 호출(8 named-params)은 `p_newsletter` 기본값(null)으로 자연 동작 → 본문만 수정해도 뉴스레터 보존.
- **generate-newsletter는 DB에 쓰지 않음** — ai-ask의 proposal 패턴처럼 초안만 반환하고,
  저장은 인증된 클라이언트가 `add_version(p_newsletter=...)`로 수행(RLS 일관성 + 검토 후 저장 UX).
