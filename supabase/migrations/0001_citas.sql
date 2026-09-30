-- supabase/migrations/0001_citas.sql
--
-- Diseño de seguridad importante: esta tabla NO tiene una política de RLS que
-- permita SELECT con la anon key. Solo la Edge Function (que usa la
-- SERVICE ROLE KEY, nunca expuesta al navegador) puede leerla. Así, aunque
-- alguien inspeccione el código del kiosco, no puede descargar el listado
-- completo de pacientes y citas — la única forma de consultar es cédula por
-- cédula, a través de la función.

create table if not exists public.citas (
  id bigint generated always as identity primary key,
  doc text not null,
  nombre text not null,
  fecha date not null default current_date,
  hora time not null,
  tipo text not null default 'consulta',
  profesional text not null,
  sede text not null,
  piso text not null,
  consultorio text not null,
  creado_en timestamptz not null default now()
);

create index if not exists citas_doc_idx on public.citas (doc);

alter table public.citas enable row level security;
-- Sin políticas de SELECT/INSERT/UPDATE para anon ni authenticated:
-- por diseño, nadie puede leer esta tabla salvo la service role key.

-- Tabla de auditoría: qué cédulas se consultaron y si se encontró cita.
-- Útil para medir uso real del kiosco sin guardar el contenido de la respuesta.
create table if not exists public.consultas_kiosco (
  id bigint generated always as identity primary key,
  doc text not null,
  encontrada boolean not null,
  hora_consulta timestamptz not null default now()
);

alter table public.consultas_kiosco enable row level security;
-- Igual que arriba: solo la Edge Function (service role) escribe aquí.

-- Datos de ejemplo para probar de inmediato. Bórrelos antes de producción,
-- o cargue la agenda real con su propio script/ETL desde el sistema de citas.
insert into public.citas (doc, nombre, fecha, hora, tipo, profesional, sede, piso, consultorio) values
  ('16254789', 'Jorge Ramírez Ocampo', current_date, '10:30', 'consulta', 'Dra. Elena Vargas', 'Sede Granada', '3', '302'),
  ('31478652', 'Carmen Rosa Valencia', current_date, '09:15', 'oct', 'Tecnólogo Andrés Mora', 'Sede Granada', '2', '205'),
  ('6312905',  'Gustavo Peláez Ruiz', current_date, '08:00', 'postoperatorio', 'Dr. Hernán Cifuentes', 'Sede Granada', '1', '108'),
  ('29845113', 'Blanca Inés Motoa', current_date, '14:00', 'cirugia', 'Dr. Hernán Cifuentes', 'Sede 5', '4', 'Sala 2'),
  ('1144203876','Laura Sofía Muñoz', current_date, '11:45', 'optometria', 'Opt. Claudia Bermúdez', 'Sede 2', '1', '104')
on conflict do nothing;
