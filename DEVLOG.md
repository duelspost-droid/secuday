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

## 2026-06-21 — 공개 페이지에도 뉴스레터 노출 (읽기 전용)

당초 v1 제외였던 "공개 메인 페이지 노출"을 반영. 관리자뿐 아니라 **공개 홈페이지에서도** 뉴스레터를 보고 PDF로 저장 가능.

- `index.html`: `newsletter-template.js` include + 읽기 전용 '뉴스레터' 탭(미리보기 + `📄 PDF 다운로드`). 탭 버튼은 기본 `hidden`.
- `public.js`: `renderNewsletter()`(표준 템플릿 위임), `downloadNewsletterPdf()`, `renderDetail()`에서 **뉴스레터가 있는 달만 탭 노출**.
- 생성/수정 UI는 없음(공개는 읽기 전용). 포맷은 관리자·PDF·이메일과 동일한 단일 소스 사용.
- 검증: `node --check public.js` 통과.

---

## 2026-06-21 — 백엔드 구현 메모

- **add_version 시그니처 변경 주의**: 인자 9개로 늘어 기존 8-인자 함수를 `drop function`으로 제거 후 재생성.
  프런트의 기존 호출(8 named-params)은 `p_newsletter` 기본값(null)으로 자연 동작 → 본문만 수정해도 뉴스레터 보존.
- **generate-newsletter는 DB에 쓰지 않음** — ai-ask의 proposal 패턴처럼 초안만 반환하고,
  저장은 인증된 클라이언트가 `add_version(p_newsletter=...)`로 수행(RLS 일관성 + 검토 후 저장 UX).

---

## 2026-06-22 — 이후 변경 이력 (전체 정리)

이 날까지 누적된 변경. PR은 모두 `main`에 머지됨(레포 정책상 직접 push 불가 → PR 방식).

- **PDF 다운로드** (PR #2): 자료 보기 탭에 `📄 PDF 다운로드`(`downloadMaterialPdf`) + 뉴스레터 탭 PDF. 브라우저 인쇄→'PDF로 저장'(A4, 한글 벡터).
- **표준 템플릿 단일화 + 뉴스레터 디자인 개편** (PR #3, #7): `newsletter-template.js`가 미리보기·PDF 공통 포맷의 단일 소스.
  최종은 **인라인 스타일/인라인 SVG** 렌더(`renderNewsletterFull`) → 미리보기=PDF 100% 동일. 히어로(방패 SVG)·경고배너(alert)·대형 수치(stats)·헤드라인 카테고리 SVG 아이콘·공격 흐름 다이어그램·보안 수칙 체크리스트.
  아이콘은 `category`(deepfake|voice|phishing|supplychain|insider|ransomware|vuln|dataleak|general) → 없으면 이모지/키워드로 자동 추론. 자료(material) PDF는 별도 `documentShell`+`DOC_CSS` 경로 유지.
- **generate-newsletter 스키마/프롬프트 보강**: `cover_emoji`, `alert`, `stats[{value,label}]×3`, `headlines[].emoji/category`, `tips[]` 추가 → AI가 풀버전 자동 생성. **함수는 대시보드 "Deploy a new function → Via Editor"로 같은 이름 재배포(업서트)** 해야 반영됨(레포 머지로는 Edge Function이 자동 배포되지 않음).
- **관리자 로그인 간소화** (PR #4): 이메일 입력 제거 → **비밀번호만** 입력. `admin.js`에 `ADMIN_EMAIL` 고정값 + `signInWithPassword`. 비밀번호는 Supabase `auth.users`에 bcrypt로 저장(문서엔 미기재). 분실 시 대시보드에서 매직링크 로그인 → '비밀번호 변경'으로 재설정. (필요 시 SQL `update auth.users set encrypted_password = crypt('<새비번>', gen_salt('bf'))` 도 가능)
- **모바일 반응형** (PR #5, #6): topbar/detail-head `flex-wrap` 항상 줄바꿈 + 모바일 부제 숨김·버튼 축소·탭/테이블 가로 스크롤·로그인 카드 `min(340px,92vw)`.
- **가비아 DNS**: `jbax.co.kr` apex에 A 레코드 4개(185.199.108~111.153) 추가 → apex 정상 해석. (단 apex/www는 jbax-www가 점유 → 아래 도메인 메모 참고)

### 운영 메모 (다른 PC에서 꼭 알아야 할 것)
- **Supabase**: project ref `nrdapzgtibbusvoaceuh`. SQL/함수 배포는 대시보드(로그인 필요). 시크릿 `ANTHROPIC_API_KEY` 설정됨, `RESEND_API_KEY` 미설정(메일 발송 보류).
- **관리자 로그인**: `secuday.jbax.co.kr/admin.html` → 비밀번호만 입력(이메일 없음). 계정 이메일은 `admin.js`에 코드 고정. **비밀번호 값은 문서에 적지 않음**(정보보호팀 별도 보관).
- **배포**: 프런트는 GitHub Pages(`main` push→자동). 단 secuday는 직접 push가 막혀 **PR 생성→머지**로. Edge Function 변경 시 **대시보드 Via Editor 재배포** 별도 필요.
- **도메인**: secuday=secuday.jbax.co.kr, 공식 랜딩=jbax-home(github.io/jbax-home), `jbax.co.kr`/www=jbax-www(플레이그라운드).
- **함수 직접 호출 테스트**: `POST …/functions/v1/generate-newsletter` (apikey+Authorization = config.js의 publishable key, body `{"month":"YYYY-MM"}`).

### 다른 PC에서 이어가기
```sh
git clone https://github.com/duelspost-droid/secuday.git
git clone https://github.com/duelspost-droid/jbax-home.git
git clone https://github.com/duelspost-droid/jbax-www.git
# 로컬 미리보기:  cd secuday && python -m http.server 5235  (또는 node 정적서버)
```
- 관련 레포 모두 GitHub `duelspost-droid` 계정. 추가 비밀키 불필요(config.js의 publishable key만 공개로 사용, RLS 보호).
- `samples/`에 생성 예시(2026-07, 2026-08) 보관.

## 2026-06-23 — 포스터 자동 생성 UI 연동 (PR #9)

- 배포돼 있으나 호출 UI가 없던 **`generate-poster`** Edge Function을 관리자 상단바 **`✨ AI 자동 생성`** 버튼(`admin.html #gen-btn`)에 연결.
- `admin.js generateMaterial()`: 대상 월(YYYY-MM, 기본=다음 달) 입력 → `sb.functions.invoke("generate-poster", {body:{month}})` → 함수가 웹검색으로 이달의 테마·안내문·수칙 + **A4 포스터 SVG**를 생성해 `posters` 버킷 업로드 후 `create_material`/`add_version`(있으면)으로 **새 버전 저장** → 생성된 자료를 자동으로 열어줌. 로딩 상태 표시(1~2분 소요).
- 새 버전으로 기록되므로 기존 버전은 이력에 보존(비파괴). 함수·`ANTHROPIC_API_KEY`는 이미 배포/설정돼 있어 **추가 배포 불필요**(프런트만 PR 머지로 반영).
- 참고로 0004 `recipients`(메일링 명단) 테이블은 추가됐으나 아직 **명단 관리 UI·발송 버튼 미구현**, `RESEND_API_KEY` 미설정 → 메일 발송은 다음 작업.

## 2026-06-23 — 뉴스레터 멀티포맷 + SVG 4컷 만화

공개 페이지를 **뉴스레터 단일 화면**으로 통합하고, 뉴스레터를 **4개 포맷 선택형**으로 확장. '오늘의 보안 수칙'을 전 포맷 전면에 배치.

- **포맷 4종**(`newsletter.format`): `comic`(💬 만화형·SVG 4컷+말풍선), `card`(🃏 카드/인포그래픽), `standard`(🛡️ 표준형 고도화), `onepager`(📄 한장 요약). `newsletter-template.js`에 `renderNewsletterFull` 디스패처 + `renderComic/renderCard/renderOnepager/renderStandard`. 전부 인라인 style + **코드로 그린 인라인 SVG**(미리보기=PDF 동일).
  - 만화: `scene`(phone-call/phone-pressure/money-loss/shield-verify 등) + `mood`(neutral/worried/shocked/relieved)로 캐릭터·표정·소품·말풍선을 코드로 렌더. 서사 상황→함정→피해→수칙(마지막 컷 초록 안전).
  - 렌더러는 멀티에이전트 워크플로(3개 창작방향 → 심사 → 합성, best=flat-corporate)로 생성 후 통합·DOM/스크린샷 검증.
- **generate-newsletter**: 요청 `format` 수용 + `comic.panels` 스키마(comic이면 필수) + 포맷별 프롬프트. 응답에 `format` 강제 주입. ⚠️ **대시보드 재배포 필요**(Edge Function은 머지로 자동배포 안 됨).
- **관리자 UI**: 툴바 포맷 셀렉터 + 생성/AI수정에 format 전달. 수동편집에 포맷·**오늘의 보안수칙(tips)**·**만화 4컷**(scene/mood/화자/대사/캡션) 편집 추가. 폼에 없는 필드(stats/alert/cover_emoji)는 병합 보존.
- **공개 페이지**: 자료보기 탭·버전이력 탭 제거 → 뉴스레터 단일 화면. 포스터는 하단 흡수, 뉴스레터 없으면 자료(테마·본문·수칙)로 폴백.
- **send-mailing(이메일)**: '오늘의 보안 수칙' 강조 블록 + 만화 4컷(이메일 안전 버전: 번호+화자+대사+캡션). ⚠️ **대시보드 재배포 필요**.
- 데이터 호환: 기존 뉴스레터(format 없음)는 표준형으로 렌더(디스패처 폴백).

## 2026-06-24 — NotebookLM 연계(리서치+오디오) · 7월호 게시

- **7월호 만화 게시**(materials 2026-07, 현재 v5): 가족 사칭 메신저피싱 4컷 만화를 DB에 게시 → secuday.jbax.co.kr 공개. (만화/카드/표준/원페이저 중 comic)
- **NotebookLM 소스 리서치 → 만화 반영**: [notebooklm-source-2026-07.md](notebooklm-source-2026-07.md)(소스 팩) + ASEC 기사(2026.5)를 NotebookLM 노트북에 넣어, 출처 각주가 달린 팩트체크·4컷 스크립트 확보. 결과를 7월호에 surgical 반영(v5):
  - intro에 "최근 금융권 공격의 38%가 피싱"(ASEC), tips에 악성 첨부(HTML·PDF·XLS) 경고, stats/headlines에 ASEC 수치·기사 추가.
  - 참고: 만화 렌더러는 intro·alert·tips·4컷만 노출(stats/headlines/deep_dive는 card/standard/onepager에서 노출).
- **NotebookLM 오디오 오버뷰**: 한국어 "해커는 시스템보다 당신의 심리를 노린다"(15:41) 생성·다운로드(`Downloads/audio-2026-07.m4a`, 약 28MB).
- **오디오 플레이어(휴면)**: 공개 상세 상단에 `newsletter.audio_url`이 있을 때만 뜨는 웹 전용 `<audio>` 플레이어 추가(`index.html #audio-section` + `public.js renderDetail` + `style.css .audio-*`, PR #13). PDF/인쇄엔 미포함.
  - ⚠️ **이번 배포에서 오디오 파일은 제외**: 28MB 호스팅이 자동화 불가(브라우저 업로드 툴 10MB 한도, ffmpeg 부재, 공개 버킷 생성은 안전장치 차단). `audio_url` 미설정 → 플레이어 휴면.
  - **추후 활성화법**: 공개 `posters` 버킷에 `audio-2026-07.m4a` 업로드 → 해당 월 버전의 `newsletter.audio_url`을 `https://nrdapzgtibbusvoaceuh.supabase.co/storage/v1/object/public/posters/audio-2026-07.m4a`로 채우면 플레이어 표시.

## 2026-06-24 — 인포그래픽 포맷(5번째) + 월간 배치 자동화

- **인포그래픽 포맷**(`newsletter.format = "infographic"`): NotebookLM 인포그래픽 스타일을 코드 SVG로 재현. `newsletter-template.js`에 `renderInfographic` + 디스패처 케이스. 구성: 헤더 → 위협분석(도넛 % + 악성첨부 형식 + 보조노트) → 공격단계 반원 게이지(danger→warn→ok, value/max로 호 계산) → 현장대응(피해액 콜아웃 + 수칙). 데이터 없으면 stats/tips로 우아하게 폴백. 전부 인라인 style/SVG(미리보기=PDF). 포맷 5종이 됨(만화/카드/표준/원페이저/인포그래픽).
- **데이터 모델**: `newsletter.infographic = { donut{value,label,caption}, file_types[{label,pct}], note{title,body}, stages[{stage,name,value,max,tone,sub}], damage{label,value,note} }`.
- **generate-newsletter**: format에 `infographic` 추가 + `infographic` 스키마/프롬프트(요청 시 필수) + **배치 저장(save) 모드** — `body.save=true`면 서비스롤로 해당 월에 `add_version`(없으면 `create_material`)으로 직접 저장. ⚠️ **대시보드 재배포 필요**.
- **관리자**: 포맷 셀렉터(툴바·수동편집)에 📊 인포그래픽 추가(카드 라벨 정리).
- **월간 배치 자동화**(GitHub Actions): `.github/workflows/monthly-newsletter.yml` — 매월 25일(09:00 KST) 다음 달 호를 `format=infographic, save=true`로 생성·저장(검토 후 1일 발송). `workflow_dispatch`로 수동 실행/월·포맷 지정 가능. 키는 공개 publishable key 사용(repo Secret `SUPABASE_ANON_KEY`로 덮어쓰기 가능).
  - ⚠️ **전제**: 실제 생성은 Supabase `ANTHROPIC_API_KEY` 크레딧 필요(현재 부족 → 자동화는 세팅 완료, 충전 시 동작). 동작 확인은 Actions 탭의 수동 실행으로.
