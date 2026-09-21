const test = require("node:test");
const assert = require("node:assert/strict");

test("compras actualizan stock, precio y caja; la anulación revierte incluso con stock negativo", { skip: process.env.RUN_DB_TESTS !== "1" }, async (t) => {
  const db = require("../src/db");
  const client = await db.pool.connect();
  const originalTransaction = db.withTransaction;
  try {
    await client.query("begin");
    const fixture = await client.query(
      `select (select idproducto from producto where activo = true order by idproducto limit 1) as producto,
              (select idforma_pago from formas_pago where activo = true and mostrar_despues_crear = true and es_compra = true and nombre <> 'ANULADO' order by idforma_pago limit 1) as pago,
              (select idusuario from usuarios order by idusuario limit 1) as usuario`
    );
    const { producto, pago, usuario } = fixture.rows[0];
    if (!producto || !pago || !usuario) {
      t.skip("Se necesita un producto, una forma de pago y un usuario en la base local.");
      return;
    }
    const before = (await client.query("select stock_actual, precio_compra from producto where idproducto = $1", [producto])).rows[0];
    const supplier = await client.query(
      "insert into proveedor (razon_social, creado_por) values ('PRUEBA TRANSACCIONAL', 'Test') returning idproveedor"
    );
    const supplierId = supplier.rows[0].idproveedor;
    const open = await client.query("select idcaja_sesion from caja_sesiones where estado = 'ABIERTA' limit 1");
    let savepoint = 0;
    db.withTransaction = async (work) => {
      const name = `compra_test_${++savepoint}`;
      await client.query(`savepoint ${name}`);
      try {
        const value = await work(client);
        await client.query(`release savepoint ${name}`);
        return value;
      } catch (error) {
        await client.query(`rollback to savepoint ${name}`);
        await client.query(`release savepoint ${name}`);
        throw error;
      }
    };
    delete require.cache[require.resolve("../src/compras")];
    const { crearCompra, marcarCompraPagada, anularCompra } = require("../src/compras");
    const base = Number(before.precio_compra);
    const common = {
      proveedorId: supplierId, formaPagoId: pago, productIds: [producto], creadoPor: "Test"
    };
    const first = await crearCompra({ ...common, condicion: "CREDITO", quantities: [2], prices: [base + 11] });
    assert.equal((await client.query("select stock_actual from producto where idproducto = $1", [producto])).rows[0].stock_actual, before.stock_actual + 2);
    assert.equal((await client.query("select count(*)::int as n from caja_sesion_movimientos where fk_idcompra = $1", [first.idcompra])).rows[0].n, 0);
    if (!open.rows.length) {
      await assert.rejects(marcarCompraPagada(first.idcompra, "Test"), /abrir una sesión de caja/);
      assert.equal((await client.query("select estado from compra where idcompra = $1", [first.idcompra])).rows[0].estado, "PENDIENTE");
      await client.query("insert into caja_sesiones (abierta_por, creado_por) values ($1, 'Test')", [usuario]);
    }
    await marcarCompraPagada(first.idcompra, "Test");
    assert.equal((await client.query("select tipo from caja_sesion_movimientos where fk_idcompra = $1", [first.idcompra])).rows[0].tipo, "EGRESO");

    const second = await crearCompra({ ...common, condicion: "CONTADO", quantities: [3], prices: [base + 22] });
    assert.equal((await client.query("select precio_compra from producto where idproducto = $1", [producto])).rows[0].precio_compra, base + 22);
    await client.query("update producto set stock_actual = 0 where idproducto = $1", [producto]);
    await anularCompra(second.idcompra, "Test");
    const afterSecond = (await client.query("select stock_actual, precio_compra from producto where idproducto = $1", [producto])).rows[0];
    assert.equal(afterSecond.stock_actual, -3);
    assert.equal(afterSecond.precio_compra, base + 11);
    assert.deepEqual(
      (await client.query("select tipo from caja_sesion_movimientos where fk_idcompra = $1 order by tipo", [second.idcompra])).rows.map((row) => row.tipo),
      ["EGRESO", "INGRESO"]
    );
    await anularCompra(first.idcompra, "Test");
    assert.equal((await client.query("select stock_actual from producto where idproducto = $1", [producto])).rows[0].stock_actual, -5);
    assert.deepEqual(
      (await client.query("select tipo from caja_sesion_movimientos where fk_idcompra = $1 order by tipo", [first.idcompra])).rows.map((row) => row.tipo),
      ["EGRESO", "INGRESO"]
    );
  } finally {
    await client.query("rollback");
    client.release();
    db.withTransaction = originalTransaction;
    delete require.cache[require.resolve("../src/compras")];
    await db.pool.end();
  }
});
