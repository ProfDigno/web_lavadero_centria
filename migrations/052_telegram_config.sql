create table if not exists telegram_config (
  idtelegram_config integer primary key default 1 check (idtelegram_config = 1),
  nombre_bot varchar(120) not null default 'Lavadero Centria',
  bot_token text,
  pin_universal varchar(32),
  activo boolean not null default true,
  reminder_minutes integer not null default 60 check (reminder_minutes between 1 and 1440),
  timezone varchar(80) not null default 'America/Asuncion',
  actualizado_en timestamp not null default now(),
  actualizado_por varchar(120) not null default 'Sistema'
);

insert into telegram_config (idtelegram_config)
values (1)
on conflict (idtelegram_config) do nothing;

insert into usuario_roll_evento (nombre, descripcion, codigo_evento, activo, creado_por)
values ('Configuración Telegram', 'Permite configurar Telegram y administrar sus celulares autorizados.', 'telegram_config-ocultar', true, 'Sistema')
on conflict (codigo_evento) do update set nombre = excluded.nombre, descripcion = excluded.descripcion, activo = true;

insert into usuario_roll_item (fk_idusuario_roll, fk_idusuario_roll_evento, activo, creado_por)
select ur.idusuario_roll, ure.idusuario_roll_evento, true, 'Sistema'
from usuario_roll ur
join usuario_roll_evento ure on ure.codigo_evento = 'telegram_config-ocultar'
where ur.roll = 'ADMINISTRADOR'
on conflict (fk_idusuario_roll, fk_idusuario_roll_evento) do update set activo = true;

insert into usuario_roll_item (fk_idusuario_roll, fk_idusuario_roll_evento, activo, creado_por)
select ur.idusuario_roll, ure.idusuario_roll_evento, false, 'Sistema'
from usuario_roll ur
join usuario_roll_evento ure on ure.codigo_evento = 'telegram_config-ocultar'
where ur.roll <> 'ADMINISTRADOR'
on conflict (fk_idusuario_roll, fk_idusuario_roll_evento) do update set activo = false;
