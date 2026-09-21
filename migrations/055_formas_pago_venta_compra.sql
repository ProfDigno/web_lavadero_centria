do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'formas_pago' and column_name = 'es_venta') then
    alter table formas_pago add column es_venta boolean not null default true;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'formas_pago' and column_name = 'es_compra') then
    alter table formas_pago add column es_compra boolean not null default true;
  end if;
end
$$;

update formas_pago set es_venta = true where es_venta is null;
update formas_pago set es_compra = true where es_compra is null;

create index if not exists formas_pago_venta_idx on formas_pago (activo, mostrar_despues_crear, es_venta);
create index if not exists formas_pago_compra_idx on formas_pago (activo, mostrar_despues_crear, es_compra);
