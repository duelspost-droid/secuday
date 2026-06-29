# 뉴스레터 월간 백엔드 자동화 (검토 초안 + 하이브리드 만화)

매월 백엔드가 자동으로 **이번 달 뉴스레터 "검토 초안"** 을 생성·스테이징한다.
관리자가 검토 후 발행하므로, 검토 없이 공개되지 않는다.

## 동작 개요
1. **pg_cron** (매월 1일 00:00 UTC = 09:00 KST) → `net.http_post` 로 `generate-newsletter` 함수 호출 `{ format:"infographic", save:"draft" }`.
2. 함수가 **Claude(opus) + 웹검색**으로 뉴스레터(통계·기사·맥락·수칙 + 보안수칙 4컷 만화)를 생성.
3. 결과를 **`newsletter_drafts`** 테이블에 스테이징(versions/current 미변경 → **공개 페이지 노출 안 됨**).
4. 관리자: 콘솔 → 뉴스레터 탭 → **📥 자동 초안 불러오기** → 검토/수정 → **새 버전으로 저장**(=발행, 버전 이력에 기록).

## 보안수칙 만화 = 하이브리드
- **백엔드 자동**: `comic.panels`(코드 SVG 4컷, 한글 100% 정확) — 초안에 항상 포함, 인포그래픽 보안수칙 섹션에 렌더.
- **NotebookLM 손그림**: 무인 자동 불가(비공식 CLI·Google 인터랙티브 로그인·일일 할당량). 원하는 달만 관리자가 수동 교체 — `🖼️ 이미지 버전 추가` 또는 `nl.rules_image`(rules_image가 있으면 코드 만화보다 우선).

## 배포 절차
> 배포는 명시 승인 후. 프론트는 PR 머지, 백엔드는 대시보드/SQL 에디터 수동(레포에 service_role 평문 저장 안 함).

1. **프론트(PR 머지)** — `newsletter-template.js`(코드 만화 렌더), `admin.html`/`admin.js`(자동 초안 불러오기). 머지 → GitHub Pages 반영.
2. **마이그레이션** — `supabase/migrations/0005_newsletter_auto.sql` 적용.
   - `supabase db push` 또는 Supabase 대시보드 **SQL Editor**에 붙여넣기 실행.
   - `newsletter_drafts` 테이블 + `pg_cron`/`pg_net` 확장 + 월간 cron 잡 생성.
3. **Vault 시크릿 등록** (SQL Editor에서 1회, 키는 본인이 직접 입력):
   ```sql
   select vault.create_secret('https://nrdapzgtibbusvoaceuh.supabase.co', 'secuday_fn_base');
   select vault.create_secret('<SERVICE_ROLE_KEY>', 'secuday_service_role');
   ```
   - 이미 있으면 `select vault.update_secret((select id from vault.secrets where name='secuday_service_role'), '<KEY>');`
   - service_role 키는 대시보드 → Project Settings → API 에서 복사. **레포·코드에 남기지 말 것.**
4. **Edge Function 배포** — `generate-newsletter`(초안 모드 + 인포그래픽 만화).
   - 대시보드 **Edge Functions → generate-newsletter → Code** 탭에 `index.ts` 반영, 또는 `supabase functions deploy generate-newsletter`.
   - 시크릿 `ANTHROPIC_API_KEY` 기존 그대로 필요.

## 배포 후 검증
- 수동 1회 호출(관리자 JWT 또는 service_role)로 즉시 확인:
  ```bash
  curl -s -X POST 'https://nrdapzgtibbusvoaceuh.supabase.co/functions/v1/generate-newsletter' \
    -H 'Authorization: Bearer <SERVICE_ROLE>' -H 'Content-Type: application/json' \
    -d '{"month":"2026-07","format":"infographic","save":"draft"}'
  # → { ok:true, draft:true, ... }
  ```
- `select month, format, created_at from public.newsletter_drafts;` 로 행 확인.
- `select jobname, schedule, active from cron.job where jobname='secuday-monthly-newsletter-draft';` 로 스케줄 확인.
- 관리자 콘솔 뉴스레터 탭에서 `📥 자동 초안 불러오기` 동작 확인(버튼의 ● 표시 = 초안 있음).

## 운영 메모
- 스케줄 변경: `select cron.schedule('secuday-monthly-newsletter-draft', '<cron식>', $$ ... $$);` 재실행.
- 비용: 월 1회 Claude 호출(웹검색 최대 3회). 할당량 부담 없음.
- 초안은 월당 1개(같은 달 재실행 시 덮어씀). 발행은 항상 관리자 검토 후.
