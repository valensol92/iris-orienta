-- Agenda de cirugías programadas (se alimenta a diario desde el Excel, ver admin.html).
-- Solo se guardan los campos que se le muestran al paciente.
create table if not exists public.cirugias (
  id bigint generated always as identity primary key,
  documento text not null,
  fecha date not null,
  hora time not null,
  tipo_cirugia text not null,
  cups text not null default '',
  cirujano text not null,
  sede text not null default 'Sede Granada',
  cargado_en timestamptz not null default now(),
  unique (documento, fecha, hora, cups)
);
create index if not exists cirugias_documento_idx on public.cirugias (documento);
create index if not exists cirugias_cargado_idx on public.cirugias (cargado_en);
alter table public.cirugias enable row level security;
-- Sin políticas: solo la service role (Edge Functions) puede leer o escribir.

-- Correos del personal autorizado para cargar el Excel.
create table if not exists public.personal_autorizado (email text primary key);
alter table public.personal_autorizado enable row level security;

-- Borrado de datos con más de 7 días desde su carga.
create or replace function public.purgar_cirugias_antiguas() returns integer
language sql security definer set search_path = public as $$
  with d as (delete from public.cirugias where cargado_en < now() - interval '7 days' returning 1)
  select count(*)::int from d;
$$;
revoke all on function public.purgar_cirugias_antiguas() from public, anon, authenticated;
grant execute on function public.purgar_cirugias_antiguas() to service_role;

do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('purgar-cirugias', '0 8 * * *', 'select public.purgar_cirugias_antiguas()');
exception when others then
  raise notice 'pg_cron no disponible: el borrado se hará en cada carga';
end $$;
