import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main(): Promise<void> {
  const migrationsDir = path.resolve(__dirname, "../../migrations");
  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  const pool = getPool();
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`
  );

  for (const file of files) {
    const already = await pool.query<{ version: string }>(
      `SELECT version FROM schema_migrations WHERE version = $1`,
      [file]
    );
    if (already.rowCount && already.rowCount > 0) {
      continue;
    }
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query(`INSERT INTO schema_migrations (version) VALUES ($1)`, [file]);
      await pool.query("COMMIT");
      console.log(`Applied migration: ${file}`);
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
