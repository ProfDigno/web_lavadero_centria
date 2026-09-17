require("dotenv").config();

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { Client } = require("pg");

const sourceDatabase = process.env.DB_NAME;
const targetDatabase = "bdlavadero_centria";
const connection = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || ""
};

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function connect(database) {
  const client = new Client({ ...connection, database });
  await client.connect();
  return client;
}

async function main() {
  if (!sourceDatabase || sourceDatabase === targetDatabase) {
    throw new Error(`La base origen debe ser distinta de ${targetDatabase}.`);
  }

  const admin = await connect("postgres");
  try {
    const exists = await admin.query("select 1 from pg_database where datname = $1", [targetDatabase]);
    if (exists.rowCount) {
      if (process.argv.includes("--replace-partial")) {
        await admin.query(
          `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
          [targetDatabase]
        );
        await admin.query(`drop database ${quoteIdentifier(targetDatabase)}`);
        console.log(`Base parcial eliminada: ${targetDatabase}`);
      } else {
        throw new Error(`La base ${targetDatabase} ya existe; no se elimina ni se sobrescribe.`);
      }
    }
    await admin.query(`create database ${quoteIdentifier(targetDatabase)}`);
  } finally {
    await admin.end();
  }
  console.log(`Base creada: ${targetDatabase}`);

  const target = await connect(targetDatabase);
  const source = await connect(sourceDatabase);
  try {
    const migrationDir = path.join(__dirname, "..", "migrations");
    const migrationFiles = fs.readdirSync(migrationDir).filter((file) => file.endsWith(".sql")).sort();
    for (const file of migrationFiles) {
      if (["026_roles_compartidos.sql", "031_roles_iniciales.sql"].includes(file)) {
        console.log(`Migracion omitida por incompatibilidad de esquema historico: ${file}`);
        continue;
      }
      await target.query(fs.readFileSync(path.join(migrationDir, file), "utf8"));
      console.log(`Migracion aplicada: ${file}`);
      if (file === "030_roll_evento_relacion_unica.sql") {
        await target.query(`
          alter table usuario_roll drop constraint if exists usuario_roll_fk_idusuario_fkey;
          alter table usuario_roll drop column fk_idusuario;
          alter table usuarios add column fk_idusuario_roll integer;
          alter table usuarios drop constraint if exists usuarios_usuario_roll_fk;
          alter table usuarios add constraint usuarios_usuario_roll_fk
            foreign key (fk_idusuario_roll) references usuario_roll(idusuario_roll) on delete set null;
          alter table usuario_roll add constraint usuario_roll_roll_key unique (roll);

          insert into usuario_roll (roll, activo, creado_por)
          values
            ('ADMINISTRADOR', true, 'Sistema'),
            ('ENCARGADO', true, 'Sistema'),
            ('CAJERO', true, 'Sistema'),
            ('LAVADOR', true, 'Sistema')
          on conflict (roll) do update set activo = true;

          insert into usuario_roll_evento (nombre, descripcion, codigo_evento, activo, creado_por)
          values ('Bloquear servicio', 'Permite bloquear o desbloquear servicios.', 'servicio-bloqueo', true, 'Sistema')
          on conflict (codigo_evento) do update set activo = true;

          insert into usuario_roll_item (fk_idusuario_roll, fk_idusuario_roll_evento, activo, creado_por)
          select ur.idusuario_roll, ure.idusuario_roll_evento, true, 'Sistema'
          from usuario_roll ur cross join usuario_roll_evento ure
          where ure.codigo_evento = 'servicio-bloqueo'
            and ur.roll in ('ADMINISTRADOR', 'ENCARGADO', 'CAJERO')
          on conflict (fk_idusuario_roll, fk_idusuario_roll_evento) do update set activo = true;
        `);
        console.log("Esquema final de usuarios y roles preparado.");
      }
    }

    const keepTables = new Set([
      "usuarios",
      "usuario_roll",
      "usuario_roll_evento",
      "usuario_roll_item",
      "facturasend_config"
    ]);
    const tableResult = await target.query(
      `select tablename
       from pg_tables
       where schemaname = 'public'
       order by tablename`
    );
    const tablesToClear = tableResult.rows
      .map((row) => row.tablename)
      .filter((table) => !keepTables.has(table));
    if (tablesToClear.length) {
      await target.query(
        `truncate ${tablesToClear.map(quoteIdentifier).join(", ")} restart identity cascade`
      );
    }
    console.log(`Tablas operativas vaciadas: ${tablesToClear.length}`);

    const adminLogin = process.env.ADMIN_LOGIN || "admin";
    const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
    const adminName = process.env.ADMIN_NAME || "Administrador";
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    await target.query(
      `insert into usuarios (login, password_hash, nombre, activo, creado_por, fk_idusuario_roll)
       values ($1, $2, $3, true, $3,
               (select idusuario_roll from usuario_roll where roll = 'ADMINISTRADOR'))`,
      [adminLogin, passwordHash, adminName]
    );
    console.log(`Usuario administrador creado: ${adminLogin}`);

    const configResult = await source.query(
      `select base_url, tenant, api_key_encrypted, params, ambiente, config_set_api,
              kude_params, activo, creado_por
       from facturasend_config
       where activo = true
       order by idfacturasend_config desc
       limit 1`
    );
    if (configResult.rows[0]) {
      const row = configResult.rows[0];
      await target.query(
        `insert into facturasend_config
          (base_url, tenant, api_key_encrypted, params, ambiente, config_set_api,
           kude_params, activo, creado_por)
         values ($1, $2, $3, $4, $5, $6, $7, true, $8)`,
        [row.base_url, row.tenant, row.api_key_encrypted, row.params, row.ambiente,
          row.config_set_api, row.kude_params, row.creado_por]
      );
      console.log("Configuracion activa de FacturaSend copiada.");
    } else {
      console.log("No habia configuracion activa de FacturaSend para copiar.");
    }
  } finally {
    await Promise.all([target.end(), source.end()]);
  }
}

main().catch((error) => {
  console.error(`No se pudo crear la base nueva: ${error.message}`);
  process.exitCode = 1;
});
