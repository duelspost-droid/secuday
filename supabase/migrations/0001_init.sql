-- secuday — 정보보호의 날 자료 관리 스키마
-- 테이블: materials / versions / ai_logs
-- 모든 수정은 새 버전으로 기록 (add_version RPC), 로그인한 임직원만 접근 (RLS)

-- ---------- 테이블 ----------

create table if not exists public.materials (
    id                  bigint generated always as identity primary key,
    month               text not null unique,          -- 'YYYY-MM' (매월 1일 정보보호의 날)
    current_version_id  bigint,                         -- versions.id (FK는 아래에서 추가)
    created_at          timestamptz not null default now()
);

create table if not exists public.versions (
    id            bigint generated always as identity primary key,
    material_id   bigint not null references public.materials(id) on delete cascade,
    version_no    integer not null,
    title         text not null,
    theme         text not null default '',
    content       text not null default '',            -- 포스터 본문/안내문 (마크다운)
    rules         jsonb not null default '[]'::jsonb,   -- 임직원 수칙 배열
    poster_path   text,                                 -- Storage 내 경로 (posters 버킷)
    change_note   text not null default '',
    change_source text not null default 'manual',       -- manual | ai | rollback
    created_by    uuid default auth.uid(),
    created_at    timestamptz not null default now(),
    unique (material_id, version_no)
);

create table if not exists public.ai_logs (
    id          bigint generated always as identity primary key,
    material_id bigint not null references public.materials(id) on delete cascade,
    role        text not null,                          -- user | assistant
    content     text not null,
    created_by  uuid default auth.uid(),
    created_at  timestamptz not null default now()
);

-- materials.current_version_id → versions.id
do $$
begin
    if not exists (
        select 1 from information_schema.table_constraints
        where constraint_name = 'materials_current_version_fk'
    ) then
        alter table public.materials
            add constraint materials_current_version_fk
            foreign key (current_version_id) references public.versions(id)
            on delete set null deferrable initially deferred;
    end if;
end $$;

create index if not exists versions_material_idx on public.versions(material_id, version_no desc);
create index if not exists ai_logs_material_idx  on public.ai_logs(material_id, id);

-- ---------- 버전 생성 RPC ----------
-- 새 버전을 원자적으로 추가하고 current_version_id를 갱신한다.
-- p_poster_path가 null이면 직전 버전의 포스터를 그대로 유지한다.

create or replace function public.add_version(
    p_material_id   bigint,
    p_title         text,
    p_theme         text,
    p_content       text,
    p_rules         jsonb,
    p_poster_path   text,
    p_change_note   text,
    p_change_source text default 'manual'
) returns public.versions
language plpgsql
security invoker
as $$
declare
    v_next   integer;
    v_poster text;
    v_row    public.versions;
begin
    select coalesce(max(version_no), 0) + 1 into v_next
        from public.versions where material_id = p_material_id;

    if p_poster_path is null then
        select v.poster_path into v_poster
            from public.versions v
            join public.materials m on m.current_version_id = v.id
            where m.id = p_material_id;
    else
        v_poster := p_poster_path;
    end if;

    insert into public.versions
        (material_id, version_no, title, theme, content, rules, poster_path, change_note, change_source)
    values
        (p_material_id, v_next, p_title, coalesce(p_theme, ''), coalesce(p_content, ''),
         coalesce(p_rules, '[]'::jsonb), v_poster, coalesce(p_change_note, ''), p_change_source)
    returning * into v_row;

    update public.materials set current_version_id = v_row.id where id = p_material_id;
    return v_row;
end $$;

-- 자료 + 최초 버전(v1)을 함께 생성
create or replace function public.create_material(
    p_month       text,
    p_title       text,
    p_theme       text,
    p_content     text,
    p_rules       jsonb,
    p_poster_path text,
    p_change_note text
) returns public.materials
language plpgsql
security invoker
as $$
declare
    v_mid bigint;
    v_mat public.materials;
begin
    insert into public.materials (month) values (p_month) returning id into v_mid;
    perform public.add_version(v_mid, p_title, p_theme, p_content, p_rules,
                               p_poster_path, coalesce(nullif(p_change_note, ''), '최초 등록'), 'manual');
    select * into v_mat from public.materials where id = v_mid;
    return v_mat;
end $$;

-- 특정 버전으로 복원 (새 버전으로 기록)
create or replace function public.rollback_version(
    p_material_id bigint,
    p_version_no  integer
) returns public.versions
language plpgsql
security invoker
as $$
declare
    v_src public.versions;
begin
    select * into v_src from public.versions
        where material_id = p_material_id and version_no = p_version_no;
    if not found then
        raise exception '버전을 찾을 수 없습니다: v%', p_version_no;
    end if;
    return public.add_version(p_material_id, v_src.title, v_src.theme, v_src.content,
                              v_src.rules, v_src.poster_path,
                              format('v%s으로 되돌림', p_version_no), 'rollback');
end $$;

-- ---------- RLS ----------
-- 사내 도구: 로그인한(authenticated) 임직원에게 전체 권한, 익명은 차단.

alter table public.materials enable row level security;
alter table public.versions  enable row level security;
alter table public.ai_logs   enable row level security;

drop policy if exists materials_auth_all on public.materials;
create policy materials_auth_all on public.materials
    for all to authenticated using (true) with check (true);

drop policy if exists versions_auth_all on public.versions;
create policy versions_auth_all on public.versions
    for all to authenticated using (true) with check (true);

drop policy if exists ai_logs_auth_all on public.ai_logs;
create policy ai_logs_auth_all on public.ai_logs
    for all to authenticated using (true) with check (true);

-- ---------- Storage: posters 버킷 ----------

insert into storage.buckets (id, name, public)
values ('posters', 'posters', true)
on conflict (id) do nothing;

-- 업로드/수정/삭제는 로그인 사용자만, 읽기는 공개(포스터를 이미지로 표시)
drop policy if exists posters_auth_write on storage.objects;
create policy posters_auth_write on storage.objects
    for insert to authenticated with check (bucket_id = 'posters');

drop policy if exists posters_auth_update on storage.objects;
create policy posters_auth_update on storage.objects
    for update to authenticated using (bucket_id = 'posters');

drop policy if exists posters_auth_delete on storage.objects;
create policy posters_auth_delete on storage.objects
    for delete to authenticated using (bucket_id = 'posters');

drop policy if exists posters_public_read on storage.objects;
create policy posters_public_read on storage.objects
    for select to public using (bucket_id = 'posters');
