-- 메일링 수신자(임직원) 명단. send-mailing 함수가 active=true 인 수신자에게 발송한다.
-- 관리자(authenticated)만 관리, 공개 노출하지 않는다.

create table if not exists public.recipients (
    id          bigint generated always as identity primary key,
    email       text not null unique,
    name        text not null default '',
    active      boolean not null default true,
    created_at  timestamptz not null default now()
);

alter table public.recipients enable row level security;

drop policy if exists recipients_auth_all on public.recipients;
create policy recipients_auth_all on public.recipients
    for all to authenticated using (true) with check (true);
