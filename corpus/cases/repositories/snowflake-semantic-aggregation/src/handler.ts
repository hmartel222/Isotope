import snowflake from "snowflake-sdk";
import { db } from "./db";
const connection = snowflake.createConnection({ account: "synthetic", username: "isotope", password: "inert" });

/** Synthetic multi-row aggregation. Not a live Snowflake evaluation. */
export async function handler() {
  const result = await connection.execute({ sqlText: "select account_renewal from customer" }) as { rows: { ACCOUNT_RENEWAL?: number; RENEWAL?: { AT?: number } }[] };
  const row = result.rows[0];
  const renewal = Math.max(row.RENEWAL?.AT ?? row.ACCOUNT_RENEWAL ?? 0, result.rows[1]?.RENEWAL?.AT ?? result.rows[1]?.ACCOUNT_RENEWAL ?? 0);
  db.customer.update({ data: { renewal } });
  return { ok: true };
}
