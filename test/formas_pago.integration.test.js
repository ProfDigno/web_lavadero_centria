const test = require("node:test");
const assert = require("node:assert/strict");

test("es_venta y es_compra separan los selectores de formas de pago", { skip: process.env.RUN_DB_TESTS !== "1" }, async (t) => {
  const { pool } = require("../src/db");
  const client = await pool.connect();
  try {
    await client.query("begin");
    const base = await client.query(
      `select idforma_pago from formas_pago
       where activo = true and mostrar_despues_crear = true and es_venta = true and es_compra = true
         and nombre <> 'ANULADO' order by idforma_pago limit 1`
    );
    if (!base.rows.length) {
      t.skip("Se necesita una forma de pago activa para la prueba.");
      return;
    }
    const id = base.rows[0].idforma_pago;
    const original = (await client.query(
      "select mostrar_despues_crear, es_venta, es_compra from formas_pago where idforma_pago = $1", [id]
    )).rows[0];
    const visible = async () => (await client.query(
      `select idforma_pago from formas_pago
       where idforma_pago = $1 and activo = true and mostrar_despues_crear = true
         and nombre <> 'ANULADO' and es_venta = true`, [id]
    )).rows.length;
    const compraVisible = async () => (await client.query(
      `select idforma_pago from formas_pago
       where idforma_pago = $1 and activo = true and mostrar_despues_crear = true
         and nombre <> 'ANULADO' and es_compra = true`, [id]
    )).rows.length;
    assert.equal(await visible(), 1);
    assert.equal(await compraVisible(), 1);
    await client.query("update formas_pago set es_venta = false where idforma_pago = $1", [id]);
    const afterVenta = (await client.query(
      "select mostrar_despues_crear, es_venta, es_compra from formas_pago where idforma_pago = $1", [id]
    )).rows[0];
    assert.equal(afterVenta.es_venta, false);
    assert.equal(afterVenta.es_compra, original.es_compra);
    assert.equal(afterVenta.mostrar_despues_crear, original.mostrar_despues_crear);
    assert.equal(await visible(), 0);
    assert.equal(await compraVisible(), 1);
    await client.query("update formas_pago set es_venta = true, es_compra = false where idforma_pago = $1", [id]);
    const afterCompra = (await client.query(
      "select mostrar_despues_crear, es_venta, es_compra from formas_pago where idforma_pago = $1", [id]
    )).rows[0];
    assert.equal(afterCompra.es_venta, true);
    assert.equal(afterCompra.es_compra, false);
    assert.equal(afterCompra.mostrar_despues_crear, original.mostrar_despues_crear);
    assert.equal(await visible(), 1);
    assert.equal(await compraVisible(), 0);
    await client.query("update formas_pago set es_venta = true, es_compra = true, mostrar_despues_crear = false where idforma_pago = $1", [id]);
    assert.equal(await visible(), 0);
    assert.equal(await compraVisible(), 0);
  } finally {
    await client.query("rollback");
    client.release();
    await pool.end();
  }
});
