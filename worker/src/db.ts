import { Pool } from "pg";
import { config } from "./config.js";

const pool = new Pool({
  connectionString: config.databaseUrl
});

export function getPool(): Pool {
  return pool;
}
