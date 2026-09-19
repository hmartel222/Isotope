import snowflake from "snowflake-sdk";
import { db } from "./db";
const connection = snowflake.createConnection({ account: "synthetic", username: "isotope", password: "inert" });

/** Already reads RENEWAL.AT with a legacy fallback. */
export async function handler() {
  const result = await connection.execute({ sqlText: "select account_renewal from customer" }) as { rows: { ACCOUNT_RENEWAL?: number; RENEWAL?: { AT?: number } }[] };
  const row = result.rows[0];
  db.customer.update({ data: { renewal: row.RENEWAL?.AT ?? row.ACCOUNT_RENEWAL } });
  return { ok: true };
}

