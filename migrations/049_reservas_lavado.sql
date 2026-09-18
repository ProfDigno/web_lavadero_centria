create table if not exists reservas_lavado (
  idreserva_lavado serial primary key,
  fk_idcliente integer not null references clientes(idcliente),
  fecha_reserva date not null,
  hora_reserva time not null,
  estado varchar(20) not null default 'PENDIENTE'
    constraint reservas_lavado_estado_check check (estado in ('PENDIENTE', 'NOTIFICADO', 'CARGADO', 'CANCELADO')),
  monto numeric(12,2) not null default 0,
  fk_idlavado integer references lavados(idlavado) on delete set null,
  fecha_creado timestamp not null default now(),
  notificado_en timestamp,
  cargado_en timestamp,
  cancelado_en timestamp,
  creado_por varchar(120) not null,
  cancelado_por varchar(120)
);

create table if not exists reserva_lavado_servicios (
  idreserva_lavado_servicio serial primary key,
  fk_idreserva_lavado integer not null references reservas_lavado(idreserva_lavado) on delete cascade,
  fk_idservicio integer not null references servicios(idservicio),
  precio numeric(12,2) not null,
  creado_por varchar(120) not null,
  unique (fk_idreserva_lavado, fk_idservicio)
);

create unique index if not exists reservas_lavado_cliente_horario_idx
  on reservas_lavado (fk_idcliente, fecha_reserva, hora_reserva)
  where estado <> 'CANCELADO';

create index if not exists reservas_lavado_fecha_idx
  on reservas_lavado (fecha_reserva, hora_reserva);

insert into usuario_roll_evento (nombre, descripcion, codigo_evento, activo, creado_por)
values ('Calendario', 'Permite crear y gestionar reservas de lavados.', 'calendario-ocultar', true, 'Sistema')
on conflict (codigo_evento) do update set nombre = excluded.nombre, descripcion = excluded.descripcion, activo = true;

insert into usuario_roll_item (fk_idusuario_roll, fk_idusuario_roll_evento, activo, creado_por)
select ur.idusuario_roll, ure.idusuario_roll_evento, true, 'Sistema'
from usuario_roll ur
join usuario_roll_evento ure on ure.codigo_evento = 'calendario-ocultar'
where ur.roll in ('ADMINISTRADOR', 'ENCARGADO')
on conflict (fk_idusuario_roll, fk_idusuario_roll_evento) do update set activo = true;

insert into usuario_roll_item (fk_idusuario_roll, fk_idusuario_roll_evento, activo, creado_por)
select ur.idusuario_roll, ure.idusuario_roll_evento, false, 'Sistema'
from usuario_roll ur
join usuario_roll_evento ure on ure.codigo_evento = 'calendario-ocultar'
where ur.roll not in ('ADMINISTRADOR', 'ENCARGADO')
on conflict (fk_idusuario_roll, fk_idusuario_roll_evento) do update set activo = false;
