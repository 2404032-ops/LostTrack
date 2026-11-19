create table if not exists public.losttrack_state (
  id smallint primary key check (id = 1),
  data jsonb not null
);

alter table public.losttrack_state enable row level security;
revoke all on table public.losttrack_state from anon, authenticated;
grant all on table public.losttrack_state to service_role;
