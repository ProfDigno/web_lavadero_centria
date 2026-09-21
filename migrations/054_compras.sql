create sequence if not exists compra_numero_seq;

create table if not exists proveedor (
  idproveedor serial primary key,
  razon_social varchar(150) not null,
  ruc varchar(40),
  direccion varchar(220),
  telefono varchar(80),
  activo boolean not null default true,
  fecha_creado timestamp not null default now(),
  creado_por varchar(120) not null default 'Sistema'
);

create table if not exists compra (
  idcompra serial primary key,
  numero varchar(60) not null unique default ('C-' || nextval('compra_numero_seq')::text),
  fecha_compra timestamp not null default now(),
  fk_idproveedor integer not null references proveedor(idproveedor) on delete restrict,
  fk_idforma_pago integer not null references formas_pago(idforma_pago) on delete restrict,
  condicion varchar(20) not null check (condicion in ('CONTADO', 'CREDITO')),
  estado varchar(20) not null check (estado in ('PENDIENTE', 'PAGADO', 'ANULADO')),
  total integer not null check (total > 0),
  fecha_creado timestamp not null default now(),
  creado_por varchar(120) not null default 'Sistema',
  pagado_en timestamp,
  pagado_por varchar(120),
  anulado_en timestamp,
  anulado_por varchar(120),
  constraint compra_condicion_estado_check check (
    (condicion = 'CONTADO' and estado in ('PAGADO', 'ANULADO'))
    or (condicion = 'CREDITO' and estado in ('PENDIENTE', 'PAGADO', 'ANULADO'))
  )
);

create table if not exists compra_item (
  idcompra_item serial primary key,
  fk_idcompra integer not null references compra(idcompra) on delete cascade,
  fk_idproducto integer not null references producto(idproducto) on delete restrict,
  precio_compra integer not null check (precio_compra >= 0),
  cantidad integer not null check (cantidad > 0),
  subtotal integer not null check (subtotal >= 0),
  fecha_creado timestamp not null default now(),
  creado_por varchar(120) not null default 'Sistema',
  constraint compra_item_producto_unique unique (fk_idcompra, fk_idproducto)
);

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'producto' and column_name = 'precio_compra_base') then
    alter table producto add column precio_compra_base integer;
  end if;
end
$$;
update producto set precio_compra_base = precio_compra where precio_compra_base is null;
alter table producto alter column precio_compra_base set not null;
alter table producto alter column precio_compra_base set default 0;
alter table producto drop constraint if exists producto_stock_actual_check;

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'caja_sesion_movimientos' and column_name = 'fk_idcompra') then
    alter table caja_sesion_movimientos add column fk_idcompra integer references compra(idcompra) on delete restrict;
  end if;
end
$$;
alter table caja_sesion_movimientos
  drop constraint if exists caja_sesion_movimientos_origen_check,
  drop constraint if exists caja_sesion_movimientos_un_origen_check,
  drop constraint if exists caja_sesion_movimientos_origen_tipo_check;
alter table caja_sesion_movimientos
  add constraint caja_sesion_movimientos_origen_check
    check (origen in ('LAVADO', 'CREDITO', 'GASTO', 'VALE', 'VENTA', 'COMPRA')),
  add constraint caja_sesion_movimientos_un_origen_check
    check (
      (case when fk_idlavado is not null then 1 else 0 end
       + case when fk_idgrupo_cliente_creditos is not null then 1 else 0 end
       + case when fk_idgasto is not null then 1 else 0 end
       + case when fk_idvales_personal is not null then 1 else 0 end
       + case when fk_idventa is not null then 1 else 0 end
       + case when fk_idcompra is not null then 1 else 0 end) = 1
    ),
  add constraint caja_sesion_movimientos_origen_tipo_check
    check (
      (origen = 'LAVADO' and tipo = 'INGRESO' and fk_idlavado is not null)
      or (origen = 'CREDITO' and tipo = 'INGRESO' and fk_idgrupo_cliente_creditos is not null)
      or (origen = 'GASTO' and tipo = 'EGRESO' and fk_idgasto is not null)
      or (origen = 'VALE' and tipo = 'EGRESO' and fk_idvales_personal is not null)
      or (origen = 'VENTA' and tipo in ('INGRESO', 'EGRESO') and fk_idventa is not null)
      or (origen = 'COMPRA' and tipo in ('INGRESO', 'EGRESO') and fk_idcompra is not null)
    );

create index if not exists compra_fecha_idx on compra(fecha_compra);
create index if not exists compra_proveedor_idx on compra(fk_idproveedor);
create index if not exists compra_item_producto_idx on compra_item(fk_idproducto);
create index if not exists caja_sesion_movimientos_compra_idx on caja_sesion_movimientos(fk_idcompra);
create unique index if not exists caja_sesion_movimientos_compra_tipo_unique_idx
  on caja_sesion_movimientos(fk_idcompra, tipo) where fk_idcompra is not null;

insert into usuario_roll_evento (nombre, descripcion, codigo_evento, activo, creado_por)
values
  ('OCULTAR PROVEEDORES', 'Permite mostrar u ocultar proveedores.', 'proveedor-ocultar', true, 'Sistema'),
  ('OCULTAR COMPRAS', 'Permite mostrar u ocultar compras.', 'compra-ocultar', true, 'Sistema'),
  ('OCULTAR ANALISIS DE COMPRAS', 'Permite mostrar u ocultar el análisis de compras.', 'AnalisisCompra-ocultar', true, 'Sistema')
on conflict (codigo_evento) do nothing;

insert into usuario_roll_item (fk_idusuario_roll, fk_idusuario_roll_evento, activo, creado_por)
select ur.idusuario_roll, ure.idusuario_roll_evento, true, 'Sistema'
from usuario_roll ur cross join usuario_roll_evento ure
where ur.activo = true
  and ure.codigo_evento in ('proveedor-ocultar', 'compra-ocultar', 'AnalisisCompra-ocultar')
on conflict (fk_idusuario_roll, fk_idusuario_roll_evento) do nothing;
