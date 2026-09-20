create table if not exists telegram_reserva_notificaciones (
  idtelegram_reserva_notificacion serial primary key,
  fk_idreserva_lavado integer not null references reservas_lavado(idreserva_lavado) on delete cascade,
  chat_id varchar(80) not null,
  tipo varchar(20) not null
    constraint telegram_reserva_notificacion_tipo_check check (tipo in ('CONFIRMACION', 'RECORDATORIO')),
  estado varchar(20) not null default 'PENDIENTE'
    constraint telegram_reserva_notificacion_estado_check check (estado in ('PENDIENTE', 'ENVIADO', 'ERROR', 'OMITIDO')),
  intentos integer not null default 0,
  ultimo_error text,
  creado_en timestamp not null default now(),
  ultimo_intento_en timestamp,
  enviado_en timestamp,
  unique (fk_idreserva_lavado, chat_id, tipo)
);

create index if not exists telegram_reserva_notificaciones_pendientes_idx
  on telegram_reserva_notificaciones (estado, intentos, creado_en)
  where estado in ('PENDIENTE', 'ERROR');
