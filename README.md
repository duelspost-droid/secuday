# secuday — 정보보호의 날 자료 관리

매월 1일 **정보보호의 날**에 임직원에게 배포하는 보안 인식 자료(포스터·안내 내용·임직원 수칙·**뉴스레터**)를
버전 관리하며 운영하는 웹 프로그램입니다. `secuday.jbax.co.kr` 서브도메인 배포를 전제로 합니다.

## 아키텍처

- **프런트엔드** — 정적 사이트, **GitHub Pages** 호스팅 (`secuday.jbax.co.kr`).
  공개 메인(읽기 전용)과 관리자(로그인 편집)가 분리되어 있습니다.
- **DB / 인증 / 스토리지** — **Supabase** (Postgres + Auth + Storage)
- **AI / 자동화** — **Supabase Edge Functions**(Deno)에서 Claude(`claude-opus-4-8`) 호출.
  `ANTHROPIC_API_KEY`는 서버 시크릿으로만 보관 → 정적 사이트에 키가 노출되지 않습니다.

```
(repo 루트 = GitHub Pages 정적 사이트)
  index.html · public.js      공개 메인 (로그인 없이 자료 열람)
  admin.html · admin.js       관리자 (로그인 후 등록·편집·버전관리·AI·뉴스레터)
  newsletter-template.js      뉴스레터 표준 포맷(단일 소스) — 미리보기·PDF·이메일 공통
  config.js                   Supabase URL / anon(publishable) key
  style.css · CNAME
supabase/
  migrations/
    0001_init.sql             테이블 + RLS + 버전관리 RPC + Storage 버킷
    0002_public_read.sql      익명(anon) 읽기 허용 (공개 메인용)
    0003_newsletter.sql       versions.newsletter(jsonb) 추가 + RPC carry-forward
  functions/
    ai-ask/                   현재 자료에 대한 AI 질의·수정안 제안
    generate-poster/          월간 A4 포스터 양식 자동 생성 (web search)
    generate-newsletter/      월간 뉴스레터 초안 생성·AI 수정 (web search)
    send-mailing/             자료를 HTML 이메일로 발송 (Resend)
  config.toml
```

## 주요 기능

- **월별 자료 관리** — 포스터 파일(이미지/PDF), 안내 내용(마크다운), 임직원 수칙
- **뉴스레터** — AI가 이달 자료를 바탕으로 임직원 보안 뉴스레터(헤드라인·심층분석·팁)를 자동 생성하고,
  관리자가 수동 폼 또는 AI 지시로 수정해 새 버전으로 저장합니다. 관리자 상세의 **‘뉴스레터’ 탭**에서 사용.
  - **표준 포맷** — 뉴스레터 레이아웃은 `newsletter-template.js` 한 곳에서 정의하며,
    관리자 미리보기·PDF·이메일이 모두 동일한 포맷을 공유합니다.
    표준 섹션 순서: 헤더밴드 → 제목 → 도입 → 📰 이달의 보안 뉴스 → 🔎 심층 분석 → 💡 이달의 팁 → 맺음말 → 푸터.
  - **PDF 다운로드** — ‘뉴스레터’ 탭의 `📄 PDF 다운로드`는 표준 A4 문서를 새 창에 열고 인쇄 다이얼로그를 띄웁니다.
    대상에서 **‘PDF로 저장’**을 선택하면 한글이 벡터로 선명하게 저장됩니다(파일명 `정보보호의날_뉴스레터_YYYY-MM`).
  - **메일 발송** — `send-mailing`은 뉴스레터가 있으면 동일한 표준 포맷으로, 없으면 기존 안내문 포맷으로 발송합니다.
  - **공개 열람** — 공개 메인 페이지에서도 뉴스레터가 있는 달은 자료 상세의 **‘뉴스레터’ 탭**에서 누구나 열람·PDF 저장할 수 있습니다(읽기 전용).
- **버전 관리** — 모든 수정은 새 버전으로 기록 (수동 / AI / 롤백 구분)
  - 버전 이력 조회, 두 버전 간 diff 비교, 이전 버전으로 복원
  - 포스터·뉴스레터는 변경하지 않으면 직전 버전 값을 그대로 이어받습니다(carry-forward)
- **AI 질의** — 자료에 대해 질문하거나 수정을 요청하면 Claude가 수정안을 제안, 검토 후 새 버전으로 적용
- **접근 제어** — 읽기는 공개, 쓰기/편집은 Supabase Auth 로그인(임직원)만 (RLS)

## 데이터 모델

| 테이블 | 설명 |
|---|---|
| `materials` | 월별 자료 (`month`, `current_version_id`) |
| `versions` | 모든 버전 (`title`, `theme`, `content`, `rules`(jsonb), `poster_path`, **`newsletter`(jsonb)**, `change_source`) |
| `ai_logs` | 자료별 AI 대화 이력 |

버전 생성은 RPC 함수로 원자적 처리: `create_material`, `add_version`, `rollback_version`.
`add_version`은 `p_poster_path`·`p_newsletter`가 null이면 직전 버전 값을 유지합니다.

---

## 배포 절차

### 1. Supabase 설정

기존 Supabase 프로젝트에 스키마·함수·시크릿을 적용합니다.

**(A) CLI 사용 (권장)**

```sh
cd secuday
supabase login                          # 액세스 토큰 입력
supabase link --project-ref <ref>       # 대시보드 URL의 프로젝트 ref
supabase db push                        # migrations/*.sql 적용 (0001~0003)
supabase functions deploy ai-ask
supabase functions deploy generate-poster
supabase functions deploy generate-newsletter
supabase functions deploy send-mailing
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   # Claude API 키 (ai-ask/generate-*)
supabase secrets set RESEND_API_KEY=re_...          # 메일 발송 (send-mailing)
```

**(B) 대시보드 사용**

- SQL Editor → `supabase/migrations/`의 `0001`→`0002`→`0003` 순서대로 붙여넣고 실행
- Edge Functions → 각 함수 생성 후 `functions/<이름>/index.ts` 내용 붙여넣기
- Edge Functions → Secrets → `ANTHROPIC_API_KEY`(필수), `RESEND_API_KEY`(메일용) 추가

**(C) 임직원 계정 추가** — Authentication → Users → Add user (이메일/비밀번호)

> 모든 함수는 `config.toml`에서 `verify_jwt = true` → 로그인한 임직원(또는 service_role)만 호출됩니다.

### 2. 프런트엔드 설정

루트 `config.js`에 Supabase 접속 정보 입력 (Project Settings → API):

```js
window.SECUDAY_CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_...",   // anon/publishable key (공개 가능, RLS로 보호)
};
```

### 3. GitHub Pages 배포

```sh
git push origin main
```

- GitHub repo → Settings → Pages → Source: `main` 브랜치 / `/ (root)`
- 루트 `CNAME` 파일이 `secuday.jbax.co.kr`로 커스텀 도메인을 지정합니다

### 4. DNS 연결 (가비아)

`dns.gabia.com` → jbax.co.kr DNS 설정 → 레코드 추가:

```
타입: CNAME   호스트: secuday   값: <계정>.github.io.   TTL: 600
```

기존 `lunch`, `www` 레코드와 동일한 GitHub Pages 패턴입니다.

### 5. 로컬 개발

```sh
cd secuday
python -m http.server 5235       # http://127.0.0.1:5235  (admin.html / index.html)
```

`config.js`에 실제 Supabase 값이 들어 있어야 로그인·데이터 조회가 동작합니다.

## 백업

데이터는 Supabase에 있습니다. 대시보드 또는 `supabase db dump`로 백업하세요.
포스터 파일은 Storage `posters` 버킷에 보관됩니다.

---

신기능(뉴스레터) 작업 기록은 [`DEVLOG.md`](DEVLOG.md)를 참고하세요.
