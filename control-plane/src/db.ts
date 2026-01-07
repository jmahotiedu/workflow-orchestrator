import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { config } from "./config.js";

const pool = new Pool({
  connectionString: config.databaseUrl
});

export function getPool(): Pool {
  return pool;
}

export async function query<T extends QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<QueryResult<T>> {
  return pool.query<T>(text, values);
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
