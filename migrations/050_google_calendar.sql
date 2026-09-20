do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'reservas_lavado' and column_name = 'google_event_id') then
    alter table reservas_lavado add column google_event_id varchar(255);
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'reservas_lavado' and column_name = 'google_sync_status') then
    alter table reservas_lavado add column google_sync_status varchar(20) not null default 'PENDIENTE';
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'reservas_lavado' and column_name = 'google_synced_at') then
    alter table reservas_lavado add column google_synced_at timestamp;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'reservas_lavado' and column_name = 'google_sync_error') then
    alter table reservas_lavado add column google_sync_error text;
  end if;
end $$;

create index if not exists reservas_lavado_google_event_idx
  on reservas_lavado (google_event_id);

create table if not exists google_calendar_config (
  id integer primary key default 1 check (id = 1),
  refresh_token_encrypted text,
  account_email varchar(320),
  calendar_id varchar(255),
  calendar_name varchar(255) not null default 'Lavadero',
  reminder_minutes integer not null default 60 check (reminder_minutes between 0 and 40320),
  sync_enabled boolean not null default true,
  connected_at timestamp,
  updated_at timestamp not null default now()
);

insert into google_calendar_config (id, calendar_name, reminder_minutes)
values (1, 'Lavadero', 60)
on conflict (id) do nothing;

insert into usuario_roll_evento (nombre, descripcion, codigo_evento, activo, creado_por)
values ('Google Calendar', 'Permite configurar la sincronizacion de reservas con Google Calendar.', 'google_calendar-ocultar', true, 'Sistema')
on conflict (codigo_evento) do update set nombre = excluded.nombre, descripcion = excluded.descripcion, activo = true;
