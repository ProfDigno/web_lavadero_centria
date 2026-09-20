do $$
begin
  if to_regclass('public.google_calendar_config') is not null then
    update google_calendar_config
    set refresh_token_encrypted = null,
        account_email = null,
        calendar_id = null,
        sync_enabled = false,
        updated_at = now()
    where google_calendar_config.id = 1;
  end if;
end $$;

update usuario_roll_evento
set activo = false,
    descripcion = 'Integracion con Google Calendar retirada; las reservas notifican por Telegram.'
where codigo_evento = 'google_calendar-ocultar';

update usuario_roll_item
set activo = false
where fk_idusuario_roll_evento in (
  select idusuario_roll_evento
  from usuario_roll_evento
  where codigo_evento = 'google_calendar-ocultar'
);
