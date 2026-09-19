import snowflake from "snowflake-sdk";
import { db } from "./db";
const connection = snowflake.createConnection({ account: "synthetic", username: "isotope", password: "inert" });

/** Synthetic snowflake-sdk consumer. Not a live Snowflake evaluation. */
export async function handler() {
  const result = await connection.execute({ sqlText: "select account_renewal from customer" }) as { rows: { ACCOUNT_RENEWAL?: number }[] };
  const row = result.rows[0];
  db.customer.update({ data: { renewal: row.ACCOUNT_RENEWAL } });
  return { ok: true };
}

