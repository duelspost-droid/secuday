-- secuday — 뉴스레터 월간 자동 초안(백엔드 자동화)
-- 매월 pg_cron이 generate-newsletter 함수를 호출 → "검토 초안"을 newsletter_drafts에 스테이징.
-- 초안은 versions/current_version_id를 건드리지 않으므로 공개 페이지에 노출되지 않는다.
-- 관리자가 검토 후 관리자 화면에서 불러와 add_version으로 발행한다(= 정상 버전·이력에 기록).
--
-- 보안수칙 시각물(하이브리드):
--   · 백엔드 자동 = comic.panels(코드 SVG 4컷, 한글 정확) — 이 초안에 포함됨
--   · NotebookLM 손그림(rules_image)은 무인 자동 불가 → 원하는 달만 관리자가 수동 교체

-- ---------- 1) 자동 초안 스테이징 테이블 ----------
create table if not exists public.newsletter_drafts (
    month       text primary key,                 -- 'YYYY-MM' (월당 1개, 최신으로 덮어씀)
    newsletter  jsonb not null,                   -- 생성된 뉴스레터(JSON)
    format      text not null default 'infographic',
    source      text not null default 'cron',     -- cron | manual
    note        text not null default '',
    created_at  timestamptz not null default now()
);

alter table public.newsletter_drafts enable row level security;

-- 읽기: 로그인한 임직원(관리자 콘솔)만. 쓰기/갱신은 service_role(Edge Function)이 RLS 우회로 수행.
drop policy if exists "drafts read for authenticated" on public.newsletter_drafts;
create policy "drafts read for authenticated"
    on public.newsletter_drafts for select
    to authenticated using (true);

-- 관리자가 채택 후 초안을 지울 수 있게(선택). 발행은 add_version으로 하고 초안은 정리.
drop policy if exists "drafts delete for authenticated" on public.newsletter_drafts;
create policy "drafts delete for authenticated"
    on public.newsletter_drafts for delete
    to authenticated using (true);

-- ---------- 2) 스케줄러 확장 ----------
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------- 3) 월간 cron (매월 1일 00:00 UTC = 09:00 KST) ----------
-- 함수 호출에 필요한 비밀은 Vault에서 읽는다(레포에 평문 저장하지 않음).
--   · secuday_fn_base       = 'https://<ref>.supabase.co'
--   · secuday_service_role  = service_role 키
-- ↓ Vault 시크릿은 배포 시 SQL 에디터에서 1회 등록(아래 배포 가이드 참고). 등록 전에는 cron이 떠도 호출만 실패한다.

-- 기존 동일 잡 제거 후 재등록(idempotent)
select cron.unschedule('secuday-monthly-newsletter-draft')
    where exists (select 1 from cron.job where jobname = 'secuday-monthly-newsletter-draft');

select cron.schedule(
    'secuday-monthly-newsletter-draft',
    '0 0 1 * *',
    $cron$
    select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'secuday_fn_base')
               || '/functions/v1/generate-newsletter',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'secuday_service_role')
        ),
        body := jsonb_build_object('format', 'infographic', 'save', 'draft'),
        timeout_milliseconds := 120000
    );
    $cron$
);
