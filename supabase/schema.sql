-- ============================================================
--  Nachhilfe-Lernraum – Datenbank-Schema für Supabase
--  Einmal komplett im Supabase SQL-Editor ausführen.
--
--  Sicherheitsmodell
--  * Lehrerin: normaler Supabase-Login (E-Mail + Passwort).
--    Sie sieht und bearbeitet nur Zeilen mit teacher_id = ihre User-ID (RLS).
--  * SchülerInnen: kein Supabase-Account. Login mit Name + PIN über die
--    Funktion student_login(). Die PIN liegt nur als bcrypt-Hash vor,
--    nach 5 Fehlversuchen ist das Profil 10 Minuten gesperrt.
--    Danach arbeiten sie mit einem zufälligen Sitzungs-Token, und alle
--    Zugriffe laufen über Funktionen, die nur die eigenen Daten liefern.
--    Die Tabellen selbst sind für nicht angemeldete Besucher gesperrt.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tabellen ----------------------------------------

create table if not exists public.students (
  id              uuid primary key default gen_random_uuid(),
  teacher_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name            text not null check (length(trim(name)) between 1 and 80),
  grade           text not null default '',
  subjects        text[] not null default '{}',
  pin_hash        text not null,
  next_appt       timestamptz,
  appt_note       text not null default '',
  failed_attempts int  not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now()
);
-- Namen müssen pro Lehrerin eindeutig sein (Groß/Klein egal), sonst ist der Login mehrdeutig
create unique index if not exists students_name_uniq on public.students (teacher_id, lower(trim(name)));

create table if not exists public.lessons (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  date        date not null default current_date,
  subject     text not null,
  topic       text not null,
  notes       text not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.resources (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null,
  url         text not null check (url ~* '^https?://'),
  kind        text not null default 'link' check (kind in ('video','aufgabe','link')),
  subject     text not null,
  note        text not null default '',
  student_ids uuid[] not null default '{}',   -- leer = für alle SchülerInnen
  created_at  timestamptz not null default now()
);

create table if not exists public.homework (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  title       text not null,
  description text not null default '',
  subject     text not null,
  due         date,
  resource_id uuid references public.resources(id) on delete set null,
  done        boolean not null default false,
  done_at     timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.questions (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references auth.users(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  subject     text not null,
  text        text not null check (length(text) between 1 and 4000),
  asked_at    timestamptz not null default now(),
  answer      text not null default '',
  answered_at timestamptz,
  seen        boolean not null default false
);

create table if not exists public.student_sessions (
  token       uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '60 days'
);

create index if not exists lessons_student_idx   on public.lessons(student_id);
create index if not exists homework_student_idx  on public.homework(student_id);
create index if not exists questions_student_idx on public.questions(student_id);

-- ---------- Row Level Security (Lehrerin) --------------------

alter table public.students         enable row level security;
alter table public.lessons          enable row level security;
alter table public.resources        enable row level security;
alter table public.homework         enable row level security;
alter table public.questions        enable row level security;
alter table public.student_sessions enable row level security;  -- keine Policy = niemand direkt

do $$
declare t text;
begin
  foreach t in array array['students','lessons','resources','homework','questions'] loop
    execute format('drop policy if exists teacher_all on public.%I', t);
    execute format(
      'create policy teacher_all on public.%I for all to authenticated
         using (teacher_id = auth.uid()) with check (teacher_id = auth.uid())', t);
  end loop;
end $$;

-- Die PIN-Hashes und Sperr-Felder soll auch die Lehrerin-App nicht auslesen
revoke select on public.students from anon, authenticated;
grant  select (id, teacher_id, name, grade, subjects, next_appt, appt_note, created_at)
  on public.students to authenticated;
revoke all on public.students, public.lessons, public.resources, public.homework,
              public.questions, public.student_sessions from anon;

-- ---------- Hilfsfunktion: Token -> Schüler-ID ----------------

create or replace function public._student_from_token(p_token uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select s.student_id from public.student_sessions s
  where s.token = p_token and s.expires_at > now()
$$;
revoke all on function public._student_from_token(uuid) from public, anon, authenticated;

-- ---------- Funktionen für die Lehrerin ----------------------

-- SchülerIn anlegen (PIN wird serverseitig gehasht)
create or replace function public.teacher_create_student(
  p_name text, p_grade text, p_subjects text[], p_pin text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_pin !~ '^\d{4,6}$' then raise exception 'pin_format'; end if;
  insert into public.students (teacher_id, name, grade, subjects, pin_hash)
  values (auth.uid(), trim(p_name), coalesce(p_grade,''), coalesce(p_subjects,'{}'),
          crypt(p_pin, gen_salt('bf')))
  returning id into v_id;
  return v_id;
end $$;

-- PIN neu setzen (entsperrt auch und meldet alte Sitzungen ab)
create or replace function public.teacher_set_pin(p_student uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_pin !~ '^\d{4,6}$' then raise exception 'pin_format'; end if;
  update public.students
     set pin_hash = crypt(p_pin, gen_salt('bf')), failed_attempts = 0, locked_until = null
   where id = p_student and teacher_id = auth.uid();
  if not found then raise exception 'not_found'; end if;
  delete from public.student_sessions where student_id = p_student;
end $$;

revoke all on function public.teacher_create_student(text,text,text[],text) from public, anon;
revoke all on function public.teacher_set_pin(uuid,text) from public, anon;
grant execute on function public.teacher_create_student(text,text,text[],text) to authenticated;
grant execute on function public.teacher_set_pin(uuid,text) to authenticated;

-- ---------- Funktionen für SchülerInnen ----------------------

-- Login mit Name + PIN -> Sitzungs-Token
create or replace function public.student_login(p_name text, p_pin text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare s public.students; v_token uuid; v_count int;
begin
  select count(*) into v_count from public.students where lower(trim(name)) = lower(trim(p_name));
  if v_count <> 1 then
    perform pg_sleep(0.5);
    return json_build_object('ok', false, 'error', case when v_count = 0 then 'unknown' else 'ambiguous' end);
  end if;
  select * into s from public.students where lower(trim(name)) = lower(trim(p_name)) for update;
  if s.locked_until is not null and s.locked_until > now() then
    return json_build_object('ok', false, 'error', 'locked', 'until', s.locked_until);
  end if;
  if s.pin_hash <> crypt(p_pin, s.pin_hash) then
    update public.students
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5 then now() + interval '10 minutes' end
     where id = s.id;
    perform pg_sleep(0.5);
    return json_build_object('ok', false, 'error', 'wrong_pin');
  end if;
  update public.students set failed_attempts = 0, locked_until = null where id = s.id;
  delete from public.student_sessions where student_id = s.id and expires_at < now();
  insert into public.student_sessions (student_id) values (s.id) returning token into v_token;
  return json_build_object('ok', true, 'token', v_token);
end $$;

create or replace function public.student_logout(p_token uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.student_sessions where token = p_token
$$;

-- Alles, was die Schüler-Ansicht braucht, in einem Aufruf
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
                from (select id, date, subject, topic, notes, created_at from public.lessons where student_id = v_sid) l), '[]'),
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

create or replace function public.student_toggle_homework(p_token uuid, p_homework uuid, p_done boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_sid uuid;
begin
  v_sid := public._student_from_token(p_token);
  if v_sid is null then return false; end if;
  update public.homework set done = p_done, done_at = case when p_done then now() end
   where id = p_homework and student_id = v_sid;
  return found;
end $$;

create or replace function public.student_ask(p_token uuid, p_subject text, p_text text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_sid uuid; v_teacher uuid;
begin
  v_sid := public._student_from_token(p_token);
  if v_sid is null then return false; end if;
  if length(trim(p_text)) = 0 or length(p_text) > 4000 then return false; end if;
  -- einfache Bremse gegen Spam: max. 20 Fragen pro Tag
  if (select count(*) from public.questions where student_id = v_sid and asked_at > now() - interval '1 day') >= 20 then
    return false;
  end if;
  select teacher_id into v_teacher from public.students where id = v_sid;
  insert into public.questions (teacher_id, student_id, subject, text)
  values (v_teacher, v_sid, left(p_subject, 40), trim(p_text));
  return true;
end $$;

create or replace function public.student_mark_seen(p_token uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_sid uuid;
begin
  v_sid := public._student_from_token(p_token);
  if v_sid is null then return; end if;
  update public.questions set seen = true where student_id = v_sid and answer <> '' and not seen;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.student_login(text,text)',
    'public.student_logout(uuid)',
    'public.student_dashboard(uuid)',
    'public.student_toggle_homework(uuid,uuid,boolean)',
    'public.student_ask(uuid,text,text)',
    'public.student_mark_seen(uuid)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;
