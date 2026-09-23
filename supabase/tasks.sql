-- ============================================================
--  Erweiterung: Übungsaufgaben aus den Schwachstellen
--  Einmal im Supabase SQL-Editor ausführen (nach review.sql).
--  Kann gefahrlos mehrfach ausgeführt werden.
-- ============================================================

-- Pro SchülerIn: Übungen bei Freigabe automatisch als Hausaufgabe stellen?
alter table public.students add column if not exists auto_homework boolean not null default false;

-- Hausaufgaben können jetzt fertige Aufgaben mit Lösungen enthalten
alter table public.homework add column if not exists exercises  jsonb not null default '[]';
alter table public.homework add column if not exists weakness   text  not null default '';
alter table public.homework add column if not exists from_lesson uuid references public.lessons(id) on delete set null;

grant select (auto_homework) on public.students to authenticated;

-- Schüler-Ansicht: Aufgaben und Bezug mitliefern
create or replace function public.student_dashboard(p_token uuid)
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare v_sid uuid; v json;
begin
  v_sid := public._student_from_token(p_token);
  if v_sid is null then return json_build_object('ok', false, 'error', 'session'); end if;
  select json_build_object(
    'ok', true,
    'student', (select json_build_object('id', id, 'name', name, 'grade', grade, 'subjects', subjects,
                                         'next_appt', next_appt, 'appt_note', appt_note)
                from public.students where id = v_sid),
    'lessons', coalesce((select json_agg(l order by l.date desc, l.created_at desc)
                from (select id, date, subject, topic, notes, created_at,
                             case when review_published then summary  else '' end   as summary,
                             case when review_published then practice else '[]'::jsonb end as practice
                        from public.lessons where student_id = v_sid) l), '[]'),
    'homework', coalesce((select json_agg(h order by h.done, h.due nulls last)
                from (select id, title, description, subject, due, resource_id, done, done_at, exercises, weakness
                        from public.homework where student_id = v_sid) h), '[]'),
    'questions', coalesce((select json_agg(q order by q.asked_at desc)
                from (select id, subject, text, asked_at, answer, answered_at, seen from public.questions where student_id = v_sid) q), '[]'),
    'resources', coalesce((select json_agg(r order by r.created_at desc)
                from (select r.id, r.title, r.url, r.kind, r.subject, r.note, r.created_at
                        from public.resources r join public.students s on s.id = v_sid
                       where r.teacher_id = s.teacher_id
                         and (cardinality(r.student_ids) = 0 or v_sid = any(r.student_ids))) r), '[]')
  ) into v;
  return v;
end $$;
revoke all on function public.student_dashboard(uuid) from public;
grant execute on function public.student_dashboard(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
