-- secuday — 뉴스레터(Newsletter) 기능
-- versions에 newsletter(jsonb) 필드를 추가한다.
-- 포스터(poster_path)와 동일하게 add_version 호출 시 p_newsletter가 null이면
-- 직전 버전의 뉴스레터를 그대로 유지(carry-forward)한다.
-- → 뉴스레터가 기존 버전관리(편집/이력/diff/롤백) 위에서 그대로 동작한다.

-- ---------- 컬럼 추가 ----------
alter table public.versions
    add column if not exists newsletter jsonb;   -- null = 뉴스레터 없음 / 직전 버전 유지

-- ---------- add_version 재정의 (p_newsletter 추가) ----------
-- 인자 개수가 바뀌므로 기존 시그니처를 먼저 제거한다(오버로드 충돌 방지).
drop function if exists public.add_version(bigint, text, text, text, jsonb, text, text, text);

create or replace function public.add_version(
    p_material_id   bigint,
    p_title         text,
    p_theme         text,
    p_content       text,
    p_rules         jsonb,
    p_poster_path   text,
    p_change_note   text,
    p_change_source text default 'manual',
    p_newsletter    jsonb default null
) returns public.versions
language plpgsql
security invoker
as $$
declare
    v_next       integer;
    v_poster     text;
    v_newsletter jsonb;
    v_row        public.versions;
begin
    select coalesce(max(version_no), 0) + 1 into v_next
        from public.versions where material_id = p_material_id;

    -- 포스터: null이면 직전(현재) 버전 값 유지
    if p_poster_path is null then
        select v.poster_path into v_poster
            from public.versions v
            join public.materials m on m.current_version_id = v.id
            where m.id = p_material_id;
    else
        v_poster := p_poster_path;
    end if;

    -- 뉴스레터: null이면 직전(현재) 버전 값 유지
    if p_newsletter is null then
        select v.newsletter into v_newsletter
            from public.versions v
            join public.materials m on m.current_version_id = v.id
            where m.id = p_material_id;
    else
        v_newsletter := p_newsletter;
    end if;

    insert into public.versions
        (material_id, version_no, title, theme, content, rules, poster_path, newsletter, change_note, change_source)
    values
        (p_material_id, v_next, p_title, coalesce(p_theme, ''), coalesce(p_content, ''),
         coalesce(p_rules, '[]'::jsonb), v_poster, v_newsletter, coalesce(p_change_note, ''), p_change_source)
    returning * into v_row;

    update public.materials set current_version_id = v_row.id where id = p_material_id;
    return v_row;
end $$;

-- ---------- create_material 재정의 (p_newsletter 전달) ----------
drop function if exists public.create_material(text, text, text, text, jsonb, text, text);

create or replace function public.create_material(
    p_month       text,
    p_title       text,
    p_theme       text,
    p_content     text,
    p_rules       jsonb,
    p_poster_path text,
    p_change_note text,
    p_newsletter  jsonb default null
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
                               p_poster_path, coalesce(nullif(p_change_note, ''), '최초 등록'),
                               'manual', p_newsletter);
    select * into v_mat from public.materials where id = v_mid;
    return v_mat;
end $$;

-- ---------- rollback_version: 뉴스레터도 함께 복원 ----------
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
                              format('v%s으로 되돌림', p_version_no), 'rollback', v_src.newsletter);
end $$;
