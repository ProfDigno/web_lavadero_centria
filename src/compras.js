const { query, withTransaction } = require("./db");
const { registrarCompraPagadaEnCaja, registrarReversionCompraEnCaja } = require("./caja-cierres");

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} debe ser un número entero mayor que cero.`);
  return number;
}

function purchaseItems(productIds, quantities, prices) {
  const ids = Array.isArray(productIds) ? productIds : [productIds];
  const counts = Array.isArray(quantities) ? quantities : [quantities];
  const amounts = Array.isArray(prices) ? prices : [prices];
  const seen = new Set();
  const items = [];
  ids.forEach((rawId, index) => {
    if (String(rawId || "").trim() === "") return;
    const productId = positiveInteger(rawId, "El producto");
    const cantidad = positiveInteger(counts[index], "La cantidad");
    const precio = Number(amounts[index]);
    if (!Number.isSafeInteger(precio) || precio < 0) throw new Error("El precio de compra debe ser un número entero no negativo.");
    if (seen.has(productId)) throw new Error("No puede repetir un producto en la misma compra.");
    seen.add(productId);
    items.push({ productId, cantidad, precio });
  });
  if (!items.length) throw new Error("Agregue al menos un producto a la compra.");
  return items;
}

async function getCompraOptions() {
  const [proveedores, formasPago, productos] = await Promise.all([
    query("select idproveedor, razon_social, ruc from proveedor where activo = true order by razon_social, idproveedor"),
    query("select idforma_pago, nombre, icono_ruta, color from formas_pago where activo = true and mostrar_despues_crear = true and es_compra = true and nombre <> 'ANULADO' order by nombre, idforma_pago"),
    query("select idproducto, codigo, nombre, precio_compra, stock_actual from producto where activo = true order by nombre, codigo, idproducto")
  ]);
  return { proveedores: proveedores.rows, formasPago: formasPago.rows, productos: productos.rows };
}

async function listarCompras({ desde = "", hasta = "", proveedor = "", condiciones = [], pagina = 1 } = {}) {
  const pageSize = 100;
  const page = Math.max(1, Number(pagina) || 1);
  const params = [];
  const filters = [];
  const add = (value) => { params.push(value); return `$${params.length}`; };
  if (desde) filters.push(`c.fecha_compra::date >= ${add(desde)}`);
  if (hasta) filters.push(`c.fecha_compra::date <= ${add(hasta)}`);
  if (proveedor) {
    const term = add(`%${proveedor}%`);
    filters.push(`(p.razon_social ilike ${term} or coalesce(p.ruc, '') ilike ${term})`);
  }
  const valid = condiciones.filter((condition) => ["CONTADO", "CREDITO"].includes(condition));
  if (valid.length) filters.push(`c.condicion in (${valid.map(add).join(", ")})`);
  const where = filters.length ? `where ${filters.join(" and ")}` : "";
  const count = await query(`select count(*)::int as total from compra c join proveedor p on p.idproveedor = c.fk_idproveedor ${where}`, params);
  const listParams = [...params, pageSize, (page - 1) * pageSize];
  const result = await query(
    `select c.idcompra, c.numero, c.fecha_compra, c.condicion, c.estado, c.total,
            p.razon_social as proveedor_nombre, fp.nombre as forma_pago, fp.color as forma_pago_color,
            count(ci.idcompra_item)::int as cantidad_items
     from compra c join proveedor p on p.idproveedor = c.fk_idproveedor
     join formas_pago fp on fp.idforma_pago = c.fk_idforma_pago
     left join compra_item ci on ci.fk_idcompra = c.idcompra
     ${where}
     group by c.idcompra, p.razon_social, fp.nombre, fp.color
     order by c.fecha_compra desc, c.idcompra desc
     limit $${listParams.length - 1} offset $${listParams.length}`,
    listParams
  );
  return { rows: result.rows, total: Number(count.rows[0]?.total || 0), page, pageSize };
}

async function obtenerCompra(id) {
  const result = await query(
    `select c.*, p.razon_social as proveedor_nombre, p.ruc as proveedor_ruc,
            fp.nombre as forma_pago, fp.color as forma_pago_color
     from compra c join proveedor p on p.idproveedor = c.fk_idproveedor
     join formas_pago fp on fp.idforma_pago = c.fk_idforma_pago where c.idcompra = $1`, [id]
  );
  const compra = result.rows[0];
  if (!compra) return null;
  const items = await query(
    `select ci.*, p.codigo, p.nombre as producto_nombre from compra_item ci
     join producto p on p.idproducto = ci.fk_idproducto
     where ci.fk_idcompra = $1 order by ci.idcompra_item`, [id]
  );
  compra.items = items.rows;
  return compra;
}

async function crearCompra({ proveedorId, formaPagoId, condicion, productIds, quantities, prices, creadoPor }) {
  const fkProveedor = positiveInteger(proveedorId, "El proveedor");
  const fkFormaPago = positiveInteger(formaPagoId, "La forma de pago");
  if (!["CONTADO", "CREDITO"].includes(condicion)) throw new Error("Seleccione una condición válida.");
  const items = purchaseItems(productIds, quantities, prices);
  return withTransaction(async (client) => {
    const [supplier, payment] = await Promise.all([
      client.query("select idproveedor from proveedor where idproveedor = $1 and activo = true", [fkProveedor]),
      client.query("select idforma_pago from formas_pago where idforma_pago = $1 and activo = true and mostrar_despues_crear = true and es_compra = true and nombre <> 'ANULADO'", [fkFormaPago])
    ]);
    if (!supplier.rows.length) throw new Error("El proveedor no está disponible.");
    if (!payment.rows.length) throw new Error("La forma de pago no está disponible.");
    const products = await client.query(
      `select idproducto from producto where idproducto = any($1::int[]) and activo = true order by idproducto for update`,
      [items.map((item) => item.productId)]
    );
    if (products.rows.length !== items.length) throw new Error("Uno de los productos no está disponible.");
    const total = items.reduce((sum, item) => sum + item.precio * item.cantidad, 0);
    if (!Number.isSafeInteger(total) || total <= 0) throw new Error("El total de la compra debe ser mayor que cero.");
    const result = await client.query(
      `insert into compra (fk_idproveedor, fk_idforma_pago, condicion, estado, total, creado_por)
       values ($1, $2, $3, $4, $5, $6) returning idcompra, numero`,
      [fkProveedor, fkFormaPago, condicion, condicion === "CONTADO" ? "PAGADO" : "PENDIENTE", total, creadoPor]
    );
    const compra = result.rows[0];
    for (const item of items) {
      await client.query(
        `insert into compra_item (fk_idcompra, fk_idproducto, precio_compra, cantidad, subtotal, creado_por)
         values ($1, $2, $3, $4, $5, $6)`,
        [compra.idcompra, item.productId, item.precio, item.cantidad, item.precio * item.cantidad, creadoPor]
      );
      await client.query(
        `update producto set stock_actual = stock_actual + $1, precio_compra = $2 where idproducto = $3`,
        [item.cantidad, item.precio, item.productId]
      );
    }
    if (condicion === "CONTADO" && !await registrarCompraPagadaEnCaja(compra.idcompra, client)) {
      throw new Error("Debe abrir una sesión de caja para registrar el pago de esta compra.");
    }
    return compra;
  });
}

async function marcarCompraPagada(id, pagadoPor) {
  await withTransaction(async (client) => {
    const result = await client.query(
      `update compra set estado = 'PAGADO', pagado_en = now(), pagado_por = $1
       where idcompra = $2 and condicion = 'CREDITO' and estado = 'PENDIENTE' returning idcompra`,
      [pagadoPor, id]
    );
    if (!result.rows.length) throw new Error("Solo se pueden pagar compras a crédito pendientes.");
    if (!await registrarCompraPagadaEnCaja(id, client)) {
      throw new Error("Debe abrir una sesión de caja para registrar el pago de esta compra.");
    }
  });
}

async function anularCompra(id, anuladoPor) {
  await withTransaction(async (client) => {
    const result = await client.query("select idcompra, estado from compra where idcompra = $1 for update", [id]);
    const compra = result.rows[0];
    if (!compra) throw new Error("La compra no existe.");
    if (compra.estado === "ANULADO") throw new Error("La compra ya está anulada.");
    const hasPayment = await client.query(
      `select exists(select 1 from caja_sesion_movimientos where fk_idcompra = $1 and tipo = 'EGRESO') as pagada`, [id]
    );
    if (hasPayment.rows[0].pagada) {
      const open = await client.query("select idcaja_sesion from caja_sesiones where estado = 'ABIERTA' limit 1", []);
      if (!open.rows.length) throw new Error("Debe abrir una sesión de caja para registrar la reversión de esta compra.");
    }
    const items = await client.query(
      `select ci.fk_idproducto, ci.cantidad from compra_item ci
       join producto p on p.idproducto = ci.fk_idproducto
       where ci.fk_idcompra = $1 order by ci.fk_idproducto for update of p`, [id]
    );
    await client.query("update compra set estado = 'ANULADO', anulado_en = now(), anulado_por = $1 where idcompra = $2", [anuladoPor, id]);
    for (const item of items.rows) {
      const previous = await client.query(
        `select ci.precio_compra from compra_item ci join compra c on c.idcompra = ci.fk_idcompra
         where ci.fk_idproducto = $1 and c.estado <> 'ANULADO'
         order by c.fecha_compra desc, c.idcompra desc limit 1`, [item.fk_idproducto]
      );
      await client.query(
        `update producto set stock_actual = stock_actual - $1,
          precio_compra = coalesce($2, precio_compra_base) where idproducto = $3`,
        [item.cantidad, previous.rows[0]?.precio_compra ?? null, item.fk_idproducto]
      );
    }
    if (hasPayment.rows[0].pagada && !await registrarReversionCompraEnCaja(id, client)) {
      throw new Error("No se pudo registrar la reversión de la compra en caja.");
    }
  });
}

module.exports = { getCompraOptions, listarCompras, obtenerCompra, crearCompra, marcarCompraPagada, anularCompra };
