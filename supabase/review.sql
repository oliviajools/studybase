-- ============================================================
--  Erweiterung: Stunden aufnehmen, transkribieren, auswerten
--  Einmal im Supabase SQL-Editor ausführen (nach schema.sql).
--  Kann gefahrlos mehrfach ausgeführt werden.
-- ============================================================

-- Einverständnis zur Aufnahme (bei Minderjährigen: Eltern) pro SchülerIn
alter table public.students add column if not exists recording_consent boolean not null default false;

-- Auswertung pro Stunde
alter table public.lessons add column if not exists transcript       text    not null default '';
alter table public.lessons add column if not exists review_status    text    not null default 'none'
  check (review_status in ('none','recording','transcribing','analyzing','done','error'));
alter table public.lessons add column if not exists review_error     text    not null default '';
alter table public.lessons add column if not exists summary          text    not null default '';   -- für SchülerIn (nach Freigabe)
alter table public.lessons add column if not exists practice         jsonb   not null default '[]'; -- Übungsempfehlungen (nach Freigabe)
alter table public.lessons add column if not exists review           jsonb;                          -- nur Lehrerin: Stärken, Schwachstellen …
alter table public.lessons add column if not exists review_published boolean not null default false;
alter table public.lessons add column if not exists duration_sec     int     not null default 0;

-- Lehrerin darf die neue Spalte lesen
grant select (recording_consent) on public.students to authenticated;

-- Schüler-Ansicht: Zusammenfassung + Übungen nur, wenn freigegeben.
-- Transkript und Schwachstellen-Analyse verlassen die Datenbank für SchülerInnen nie.
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
                from (select id, title, description, subject, due, resource_id, done, done_at from public.homework where student_id = v_sid) h), '[]'),
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

-- Transkript-Abschnitt anhängen (atomar, damit parallele Abschnitte nichts überschreiben)
create or replace function public.teacher_append_transcript(p_lesson uuid, p_text text, p_seconds int)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.lessons
     set transcript   = case when transcript = '' then p_text else transcript || E'\n' || p_text end,
         duration_sec = duration_sec + greatest(coalesce(p_seconds,0),0)
   where id = p_lesson and teacher_id = auth.uid();
$$;
revoke all on function public.teacher_append_transcript(uuid,text,int) from public, anon;
grant execute on function public.teacher_append_transcript(uuid,text,int) to authenticated;

-- Supabase neu laden lassen, damit die API die neuen Spalten sofort kennt
notify pgrst, 'reload schema';
