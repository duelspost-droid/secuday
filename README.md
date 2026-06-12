# secuday — 정보보호의 날 자료 관리

매월 1일 **정보보호의 날**에 임직원에게 배포하는 보안 인식 자료(포스터·안내 내용·임직원 수칙)를
버전 관리하며 운영하는 웹 프로그램입니다. `secuday.jbax.co.kr` 서브도메인 배포를 전제로 합니다.

## 아키텍처

- **프런트엔드** — 정적 SPA, **GitHub Pages** 호스팅 (`secuday.jbax.co.kr`)
- **DB / 인증 / 스토리지** — **Supabase** (Postgres + Auth + Storage)
- **AI 질의** — **Supabase Edge Function**(`ai-ask`)에서 Claude(`claude-opus-4-8`) 호출.
  `ANTHROPIC_API_KEY`는 서버 시크릿으로만 보관 → 정적 사이트에 키가 노출되지 않음

```
web/                       GitHub Pages 정적 사이트
  index.html · app.js · style.css · config.js · CNAME
supabase/
  migrations/0001_init.sql   테이블 + RLS + 버전관리 RPC + Storage 버킷
  functions/ai-ask/index.ts  AI 질의 Edge Function (Deno)
  config.toml
legacy_flask/              기존 Flask 단독 버전 (참고용 보관)
```

## 주요 기능

- **월별 자료 관리** — 포스터 파일(이미지/PDF), 안내 내용(마크다운), 임직원 수칙
- **버전 관리** — 모든 수정은 새 버전으로 기록 (수동 / AI / 롤백 구분)
  - 버전 이력 조회, 두 버전 간 diff 비교, 이전 버전으로 복원
- **AI 질의** — 자료에 대해 질문하거나 수정을 요청하면 Claude가 수정안을 제안,
  검토 후 새 버전으로 적용
- **접근 제어** — Supabase Auth 로그인(임직원 이메일)한 사용자만 열람·편집 (RLS)

## 데이터 모델

| 테이블 | 설명 |
|---|---|
| `materials` | 월별 자료 (month, current_version_id) |
| `versions` | 모든 버전 (title, theme, content, rules(jsonb), poster_path, change_source) |
| `ai_logs` | 자료별 AI 대화 이력 |

버전 생성은 RPC 함수로 원자적 처리: `create_material`, `add_version`, `rollback_version`.

---

## 배포 절차

### 1. Supabase 설정

기존 Supabase 프로젝트에 스키마·함수·시크릿을 적용합니다.

**(A) CLI 사용 (권장)**

```sh
cd secuday
supabase login                       # 액세스 토큰 입력 (직접)
supabase link --project-ref <ref>    # 대시보드 URL의 프로젝트 ref
supabase db push                     # migrations/0001_init.sql 적용
supabase functions deploy ai-ask     # Edge Function 배포
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   # Claude API 키
```

**(B) 대시보드 사용**

- SQL Editor → `supabase/migrations/0001_init.sql` 내용 붙여넣고 실행
- Edge Functions → `ai-ask` 생성 후 `functions/ai-ask/index.ts` 내용 붙여넣기
- Edge Functions → Secrets → `ANTHROPIC_API_KEY` 추가

**(C) 임직원 계정 추가** — Authentication → Users → Add user (이메일/비밀번호)

### 2. 프런트엔드 설정

`web/config.js`에 Supabase 접속 정보 입력 (Project Settings → API):

```js
window.SECUDAY_CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJ...",   // anon key (공개 가능, RLS로 보호)
};
```

### 3. GitHub Pages 배포

secuday 전용 저장소를 만들고 `web/` 내용을 푸시한 뒤 Pages를 켭니다.

```sh
# 새 repo 생성 후
git remote add origin https://github.com/<계정>/secuday.git
git push -u origin main
```

- GitHub repo → Settings → Pages → Source: `main` 브랜치 / `/web` (또는 root)
- `web/CNAME` 파일이 `secuday.jbax.co.kr`로 커스텀 도메인을 지정합니다

### 4. DNS 연결 (가비아)

`dns.gabia.com` → jbax.co.kr DNS 설정 → 레코드 추가:

```
타입: CNAME   호스트: secuday   값: <계정>.github.io.   TTL: 600
```

기존 `lunch`, `www` 레코드와 동일한 GitHub Pages 패턴입니다.

### 5. 로컬 개발

```sh
cd secuday/web
python3 -m http.server 5235      # http://127.0.0.1:5235
```

`config.js`에 실제 Supabase 값이 들어 있어야 로그인·데이터 조회가 동작합니다.

## 백업

데이터는 Supabase에 있습니다. 대시보드 또는 `supabase db dump`로 백업하세요.
포스터 파일은 Storage `posters` 버킷에 보관됩니다.
