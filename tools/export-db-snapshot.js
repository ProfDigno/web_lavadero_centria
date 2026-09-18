const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const output = process.argv[2] || path.join(__dirname, "..", "..", "lavadero-local-backup.sql");
const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "bdlavadero_centria",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || ""
});

function literal(value) {
  if (value === null || value === undefined) return "NULL";
  if (Buffer.isBuffer(value)) return `decode('${value.toString("hex")}', 'hex')`;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (typeof value === "object") return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function main() {
  const tables = await pool.query(`
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  `);
  const chunks = ["-- Lavadero Centria local database snapshot", "BEGIN;", "SET session_replication_role = replica;"];
  let totalRows = 0;
  for (const { table_name: table } of tables.rows) {
    const columns = await pool.query(`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = $1
      order by ordinal_position
    `, [table]);
    const names = columns.rows.map((row) => row.column_name);
    if (!names.length) continue;
    const rows = await pool.query(`select * from public."${table.replace(/"/g, '""')}"`);
    totalRows += rows.rowCount;
    for (const row of rows.rows) {
      const values = names.map((name) => literal(row[name])).join(", ");
      chunks.push(`INSERT INTO public."${table.replace(/"/g, '""')}" (${names.map((name) => `"${name.replace(/"/g, '""')}"`).join(", ")}) VALUES (${values});`);
    }
  }
  chunks.push("SET session_replication_role = DEFAULT;", "COMMIT;", "");
  fs.writeFileSync(output, chunks.join("\n"), "utf8");
  console.log(JSON.stringify({ output, tables: tables.rowCount, rows: totalRows }));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
