create table if not exists public.campuses (
  id text primary key,
  name text not null
);

insert into public.campuses (id, name)
values ('uftb-main', 'UFTB Main Campus')
on conflict (id) do nothing;

create table if not exists public.accounts (
  id text primary key,
  name varchar(80) not null,
  email varchar(254) not null unique,
  role text not null check (role in ('user', 'staff', 'admin')),
  requested_role text not null check (requested_role in ('user', 'staff', 'admin')),
  status text not null,
  password_hash text not null,
  email_verified boolean not null default false,
  email_verified_at timestamptz,
  email_verification_token_hash text unique,
  email_verification_expires_at bigint,
  privacy_consent_at timestamptz,
  privacy_consent_version text,
  campus_id text not null references public.campuses (id),
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id text primary key,
  report_type text not null check (report_type in ('lost', 'found', 'issue')),
  title varchar(120) not null,
  category varchar(80) not null,
  place varchar(160) not null,
  report_date date,
  color varchar(40),
  description varchar(2000) not null,
  latitude double precision,
  longitude double precision,
  severity text check (severity is null or severity in ('Low', 'Medium', 'High')),
  safety_risk boolean not null default false,
  possible_duplicate boolean not null default false,
  duplicate_of text,
  status text not null,
  priority text not null check (priority in ('Low', 'Medium', 'High')),
  override_reason text,
  created_by text not null references public.accounts (id),
  campus_id text not null references public.campuses (id),
  list_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status_changed_at timestamptz,
  check ((latitude is null and longitude is null) or
    (latitude between -90 and 90 and longitude between -180 and 180))
);

create table if not exists public.report_photos (
  report_id text not null references public.reports (id) on delete cascade,
  position smallint not null check (position between 1 and 3),
  photo_url text not null,
  primary key (report_id, position),
  unique (report_id, photo_url)
);

create table if not exists public.report_votes (
  report_id text not null references public.reports (id) on delete cascade,
  user_id text not null references public.accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (report_id, user_id)
);

create table if not exists public.private_clues (
  id text primary key,
  report_id text not null references public.reports (id) on delete cascade,
  clue varchar(300) not null,
  recorded_by text references public.accounts (id) on delete set null,
  recorded_at timestamptz not null default now(),
  campus_id text not null references public.campuses (id)
);

create table if not exists public.claims (
  id text primary key,
  report_id text not null references public.reports (id) on delete cascade,
  claimant_id text not null references public.accounts (id),
  detail varchar(300) not null,
  attempt_no integer not null check (attempt_no > 0),
  trust_level text not null,
  status text not null,
  consent_at timestamptz,
  consent_version text,
  additional_consent_at timestamptz,
  additional_consent_version text,
  reopened boolean not null default false,
  reopened_at timestamptz,
  reopened_by text references public.accounts (id) on delete set null,
  reviewed_by text references public.accounts (id) on delete set null,
  reviewed_at timestamptz,
  campus_id text not null references public.campuses (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.notifications (
  id text primary key,
  user_id text not null references public.accounts (id) on delete cascade,
  message text not null,
  ref_id text references public.reports (id) on delete set null,
  is_read boolean not null default false,
  campus_id text not null references public.campuses (id),
  created_at timestamptz not null default now()
);

create table if not exists public.maintenance_tasks (
  id text primary key,
  report_id text not null references public.reports (id) on delete cascade,
  assignee_id text not null references public.accounts (id),
  task_text varchar(300) not null,
  status text not null,
  campus_id text not null references public.campuses (id),
  assigned_at timestamptz not null default now(),
  updated_at timestamptz,
  completed_at timestamptz
);

create table if not exists public.report_history (
  report_id text not null references public.reports (id) on delete cascade,
  entry_order integer not null check (entry_order >= 0),
  entry text not null,
  primary key (report_id, entry_order)
);

create table if not exists public.password_resets (
  token_hash text primary key,
  account_id text not null references public.accounts (id) on delete cascade,
  expires_at bigint not null
);

create index if not exists reports_campus_status_idx on public.reports (campus_id, status);
create index if not exists reports_creator_created_idx on public.reports (created_by, created_at desc);
create index if not exists claims_report_status_idx on public.claims (report_id, status);
create index if not exists tasks_assignee_status_idx on public.maintenance_tasks (assignee_id, status);
create index if not exists notifications_user_read_created_idx on public.notifications (user_id, is_read, created_at desc);

create or replace function public.get_losttrack_state()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select jsonb_build_object(
    'accounts', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', a.id,
        'name', a.name,
        'email', a.email,
        'role', a.role,
        'requestedRole', a.requested_role,
        'status', a.status,
        'passwordHash', a.password_hash,
        'emailVerified', a.email_verified,
        'emailVerifiedAt', a.email_verified_at,
        'emailVerificationTokenHash', a.email_verification_token_hash,
        'emailVerificationExpiresAt', a.email_verification_expires_at,
        'privacyConsentAt', a.privacy_consent_at,
        'privacyConsentVersion', a.privacy_consent_version,
        'campusId', a.campus_id,
        'createdAt', a.created_at
      )) order by a.created_at, a.id)
      from public.accounts a
    ), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', r.id,
        'type', r.report_type,
        'title', r.title,
        'category', r.category,
        'place', r.place,
        'date', to_char(r.report_date, 'YYYY-MM-DD'),
        'color', r.color,
        'text', r.description,
        'latitude', r.latitude,
        'longitude', r.longitude,
        'severity', r.severity,
        'safetyRisk', r.safety_risk,
        'possibleDuplicate', r.possible_duplicate,
        'duplicateOf', r.duplicate_of,
        'status', r.status,
        'priority', r.priority,
        'overrideReason', r.override_reason,
        'createdBy', r.created_by,
        'createdAt', r.created_at,
        'updatedAt', r.updated_at,
        'statusChangedAt', r.status_changed_at,
        'campusId', r.campus_id,
        'votes', (select count(*) from public.report_votes v where v.report_id = r.id),
        'votedBy', coalesce((
          select jsonb_agg(v.user_id order by v.user_id)
          from public.report_votes v where v.report_id = r.id
        ), '[]'::jsonb),
        'photos', coalesce((
          select jsonb_agg(p.photo_url order by p.position)
          from public.report_photos p where p.report_id = r.id
        ), '[]'::jsonb),
        'history', coalesce((
          select jsonb_agg(h.entry order by h.entry_order)
          from public.report_history h where h.report_id = r.id
        ), '[]'::jsonb)
      )) order by r.list_order, r.created_at desc)
      from public.reports r
    ), '[]'::jsonb),
    'claims', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', c.id,
        'reportId', c.report_id,
        'claimantId', c.claimant_id,
        'detail', c.detail,
        'attemptNo', c.attempt_no,
        'trustLevel', c.trust_level,
        'status', c.status,
        'consentAt', c.consent_at,
        'consentVersion', c.consent_version,
        'additionalConsentAt', c.additional_consent_at,
        'additionalConsentVersion', c.additional_consent_version,
        'reopened', c.reopened,
        'reopenedAt', c.reopened_at,
        'reopenedBy', c.reopened_by,
        'reviewedBy', c.reviewed_by,
        'reviewedAt', c.reviewed_at,
        'campusId', c.campus_id,
        'createdAt', c.created_at,
        'updatedAt', c.updated_at
      )) order by c.created_at, c.attempt_no)
      from public.claims c
    ), '[]'::jsonb),
    'privateClues', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', p.id,
        'reportId', p.report_id,
        'clue', p.clue,
        'recordedBy', p.recorded_by,
        'recordedAt', p.recorded_at,
        'campusId', p.campus_id
      )) order by p.recorded_at, p.id)
      from public.private_clues p
    ), '[]'::jsonb),
    'notifications', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', n.id,
        'userId', n.user_id,
        'text', n.message,
        'refId', n.ref_id,
        'read', n.is_read,
        'campusId', n.campus_id,
        'createdAt', n.created_at
      )) order by n.created_at, n.id)
      from public.notifications n
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', t.id,
        'reportId', t.report_id,
        'assignee', a.name,
        'assigneeEmail', a.email,
        'text', t.task_text,
        'status', t.status,
        'campusId', t.campus_id,
        'assignedAt', t.assigned_at,
        'updatedAt', t.updated_at,
        'completedAt', t.completed_at
      )) order by t.assigned_at, t.id)
      from public.maintenance_tasks t
      join public.accounts a on a.id = t.assignee_id
    ), '[]'::jsonb),
    'passwordResets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tokenHash', p.token_hash,
        'accountId', p.account_id,
        'expiresAt', p.expires_at
      ) order by p.expires_at)
      from public.password_resets p
    ), '[]'::jsonb)
  );
$function$;

create or replace function public.replace_losttrack_state(p_state jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if p_state is null or jsonb_typeof(p_state) is distinct from 'object' then
    raise exception 'LostTrack state must be a JSON object';
  end if;

  delete from public.notifications;
  delete from public.report_history;
  delete from public.report_votes;
  delete from public.report_photos;
  delete from public.private_clues;
  delete from public.claims;
  delete from public.maintenance_tasks;
  delete from public.reports;
  delete from public.password_resets;
  delete from public.accounts;

  insert into public.campuses (id, name)
  select distinct campus_id, campus_id
  from (
    select value ->> 'campusId' as campus_id from jsonb_array_elements(coalesce(p_state -> 'accounts', '[]'::jsonb)) as e(value)
    union all
    select value ->> 'campusId' from jsonb_array_elements(coalesce(p_state -> 'reports', '[]'::jsonb)) as e(value)
    union all
    select value ->> 'campusId' from jsonb_array_elements(coalesce(p_state -> 'claims', '[]'::jsonb)) as e(value)
    union all
    select value ->> 'campusId' from jsonb_array_elements(coalesce(p_state -> 'privateClues', '[]'::jsonb)) as e(value)
    union all
    select value ->> 'campusId' from jsonb_array_elements(coalesce(p_state -> 'notifications', '[]'::jsonb)) as e(value)
    union all
    select value ->> 'campusId' from jsonb_array_elements(coalesce(p_state -> 'tasks', '[]'::jsonb)) as e(value)
  ) as campuses_to_add
  where campus_id is not null and campus_id <> ''
  on conflict (id) do nothing;

  insert into public.accounts (
    id, name, email, role, requested_role, status, password_hash,
    email_verified, email_verified_at, email_verification_token_hash,
    email_verification_expires_at, privacy_consent_at, privacy_consent_version,
    campus_id, created_at
  )
  select
    a.id, a.name, a.email, a.role, coalesce(a."requestedRole", a.role),
    coalesce(a.status, 'active'), a."passwordHash",
    coalesce(a."emailVerified", false), nullif(a."emailVerifiedAt", '')::timestamptz,
    a."emailVerificationTokenHash", nullif(a."emailVerificationExpiresAt", '')::bigint,
    nullif(a."privacyConsentAt", '')::timestamptz, a."privacyConsentVersion",
    coalesce(nullif(a."campusId", ''), 'uftb-main'),
    coalesce(nullif(a."createdAt", '')::timestamptz, now())
  from jsonb_to_recordset(coalesce(p_state -> 'accounts', '[]'::jsonb)) as a(
    id text, name text, email text, role text, "requestedRole" text, status text,
    "passwordHash" text, "emailVerified" boolean, "emailVerifiedAt" text,
    "emailVerificationTokenHash" text, "emailVerificationExpiresAt" text,
    "privacyConsentAt" text, "privacyConsentVersion" text, "campusId" text, "createdAt" text
  );

  insert into public.reports (
    id, report_type, title, category, place, report_date, color, description,
    latitude, longitude, severity, safety_risk, possible_duplicate, duplicate_of,
    status, priority, override_reason, created_by, campus_id, list_order,
    created_at, updated_at, status_changed_at
  )
  select
    r.id, r.type, r.title, r.category, r.place, nullif(r.date, '')::date,
    r.color, r."text", r.latitude, r.longitude, r.severity,
    coalesce(r."safetyRisk", false), coalesce(r."possibleDuplicate", false),
    r."duplicateOf", coalesce(r.status, case when r.type = 'found' then 'Found' else 'Open' end),
    coalesce(r.priority, 'Medium'), r."overrideReason", r."createdBy",
    coalesce(nullif(r."campusId", ''), 'uftb-main'), (e.ordinality - 1)::integer,
    coalesce(nullif(r."createdAt", '')::timestamptz, now()),
    coalesce(nullif(r."updatedAt", '')::timestamptz, now()),
    nullif(r."statusChangedAt", '')::timestamptz
  from jsonb_array_elements(coalesce(p_state -> 'reports', '[]'::jsonb))
    with ordinality as e(value, ordinality)
  cross join lateral jsonb_to_record(e.value) as r(
    id text, type text, title text, category text, place text, date text, color text,
    "text" text, latitude double precision, longitude double precision,
    severity text, "safetyRisk" boolean, "possibleDuplicate" boolean, "duplicateOf" text,
    status text, priority text, "overrideReason" text, "createdBy" text, "campusId" text,
    "createdAt" text, "updatedAt" text, "statusChangedAt" text
  );

  insert into public.report_photos (report_id, position, photo_url)
  select r.id, p.ordinality::smallint, p.photo_url
  from jsonb_to_recordset(coalesce(p_state -> 'reports', '[]'::jsonb)) as r(id text, photos jsonb)
  cross join lateral jsonb_array_elements_text(coalesce(r.photos, '[]'::jsonb))
    with ordinality as p(photo_url, ordinality);

  insert into public.report_votes (report_id, user_id)
  select r.id, v.user_id
  from jsonb_to_recordset(coalesce(p_state -> 'reports', '[]'::jsonb)) as r(id text, "votedBy" jsonb)
  cross join lateral jsonb_array_elements_text(coalesce(r."votedBy", '[]'::jsonb)) as v(user_id)
  join public.accounts a on a.id = v.user_id
  on conflict (report_id, user_id) do nothing;

  insert into public.private_clues (id, report_id, clue, recorded_by, recorded_at, campus_id)
  select
    coalesce(c.id, c."reportId" || ':' || e.ordinality::text),
    c."reportId", c.clue, a.id,
    coalesce(nullif(c."recordedAt", '')::timestamptz, now()),
    coalesce(nullif(c."campusId", ''), 'uftb-main')
  from jsonb_array_elements(coalesce(p_state -> 'privateClues', '[]'::jsonb))
    with ordinality as e(value, ordinality)
  cross join lateral jsonb_to_record(e.value) as c(
    id text, "reportId" text, clue text, "recordedBy" text, "recordedAt" text, "campusId" text
  )
  left join public.accounts a on a.id = c."recordedBy";

  insert into public.claims (
    id, report_id, claimant_id, detail, attempt_no, trust_level, status,
    consent_at, consent_version, additional_consent_at, additional_consent_version,
    reopened, reopened_at, reopened_by, reviewed_by, reviewed_at, campus_id,
    created_at, updated_at
  )
  select
    c.id, c."reportId", c."claimantId", c.detail, coalesce(c."attemptNo", 1),
    coalesce(c."trustLevel", 'Basic'), coalesce(c.status, 'Pending review'),
    nullif(c."consentAt", '')::timestamptz, c."consentVersion",
    nullif(c."additionalConsentAt", '')::timestamptz, c."additionalConsentVersion",
    coalesce(c.reopened, false), nullif(c."reopenedAt", '')::timestamptz,
    c."reopenedBy", c."reviewedBy", nullif(c."reviewedAt", '')::timestamptz,
    coalesce(nullif(c."campusId", ''), 'uftb-main'),
    coalesce(nullif(c."createdAt", '')::timestamptz, now()),
    nullif(c."updatedAt", '')::timestamptz
  from jsonb_to_recordset(coalesce(p_state -> 'claims', '[]'::jsonb)) as c(
    id text, "reportId" text, "claimantId" text, detail text, "attemptNo" integer,
    "trustLevel" text, status text, "consentAt" text, "consentVersion" text,
    "additionalConsentAt" text, "additionalConsentVersion" text, reopened boolean,
    "reopenedAt" text, "reopenedBy" text, "reviewedBy" text, "reviewedAt" text,
    "campusId" text, "createdAt" text, "updatedAt" text
  );

  insert into public.notifications (id, user_id, message, ref_id, is_read, campus_id, created_at)
  select
    n.id, n."userId", n."text", n."refId", coalesce(n.read, false),
    coalesce(nullif(n."campusId", ''), 'uftb-main'),
    coalesce(nullif(n."createdAt", '')::timestamptz, now())
  from jsonb_to_recordset(coalesce(p_state -> 'notifications', '[]'::jsonb)) as n(
    id text, "userId" text, "text" text, "refId" text, read boolean,
    "campusId" text, "createdAt" text
  );

  insert into public.maintenance_tasks (
    id, report_id, assignee_id, task_text, status, campus_id,
    assigned_at, updated_at, completed_at
  )
  select
    t.id, t."reportId", a.id, left(coalesce(t.text, ''), 300),
    coalesce(t.status, 'Assigned'), coalesce(nullif(t."campusId", ''), 'uftb-main'),
    coalesce(nullif(t."assignedAt", '')::timestamptz, now()),
    nullif(t."updatedAt", '')::timestamptz,
    nullif(t."completedAt", '')::timestamptz
  from jsonb_to_recordset(coalesce(p_state -> 'tasks', '[]'::jsonb)) as t(
    id text, "reportId" text, "assigneeEmail" text, "text" text, status text,
    "campusId" text, "assignedAt" text, "updatedAt" text, "completedAt" text
  )
  join public.accounts a on a.email = t."assigneeEmail";

  insert into public.report_history (report_id, entry_order, entry)
  select r.id, (h.ordinality - 1)::integer, h.entry
  from jsonb_to_recordset(coalesce(p_state -> 'reports', '[]'::jsonb)) as r(id text, history jsonb)
  cross join lateral jsonb_array_elements_text(coalesce(r.history, '[]'::jsonb))
    with ordinality as h(entry, ordinality);

  insert into public.password_resets (token_hash, account_id, expires_at)
  select p."tokenHash", p."accountId", p."expiresAt"
  from jsonb_to_recordset(coalesce(p_state -> 'passwordResets', '[]'::jsonb)) as p(
    "tokenHash" text, "accountId" text, "expiresAt" bigint
  );
end;
$function$;

alter table public.campuses enable row level security;
alter table public.accounts enable row level security;
alter table public.reports enable row level security;
alter table public.report_photos enable row level security;
alter table public.report_votes enable row level security;
alter table public.private_clues enable row level security;
alter table public.claims enable row level security;
alter table public.notifications enable row level security;
alter table public.maintenance_tasks enable row level security;
alter table public.report_history enable row level security;
alter table public.password_resets enable row level security;

revoke all on table public.campuses, public.accounts, public.reports, public.report_photos,
  public.report_votes, public.private_clues, public.claims, public.notifications,
  public.maintenance_tasks, public.report_history, public.password_resets
from anon, authenticated;
grant all on table public.campuses, public.accounts, public.reports, public.report_photos,
  public.report_votes, public.private_clues, public.claims, public.notifications,
  public.maintenance_tasks, public.report_history, public.password_resets
to service_role;

revoke all on function public.get_losttrack_state() from public, anon, authenticated;
revoke all on function public.replace_losttrack_state(jsonb) from public, anon, authenticated;
grant execute on function public.get_losttrack_state() to service_role;
grant execute on function public.replace_losttrack_state(jsonb) to service_role;

do $migration$
declare
  legacy_state jsonb;
begin
  if to_regclass('public.losttrack_state') is not null then
    execute 'select data from public.losttrack_state where id = 1' into legacy_state;
    if legacy_state is not null then
      perform public.replace_losttrack_state(legacy_state);
    end if;
  end if;
end;
$migration$;

drop table if exists public.losttrack_state;
