-- 공개 메인 페이지용: 익명(anon) 사용자도 자료/버전을 읽을 수 있게 허용한다.
-- 쓰기(insert/update/delete)는 여전히 로그인(authenticated) 사용자만 가능.
-- ai_logs(관리자 AI 대화)는 공개하지 않는다.

drop policy if exists materials_public_read on public.materials;
create policy materials_public_read on public.materials
    for select to anon using (true);

drop policy if exists versions_public_read on public.versions;
create policy versions_public_read on public.versions
    for select to anon using (true);

-- (storage.objects의 posters 공개 읽기 정책은 0001에서 이미 public으로 생성됨)
