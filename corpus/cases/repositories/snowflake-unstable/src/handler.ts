import snowflake from "snowflake-sdk";
import { db } from "./db";
const connection = snowflake.createConnection({ account: "synthetic", username: "isotope", password: "inert" });

/** Synthetic nondeterminism via hrtime; each child run differs. */
export async function handler() {
  const result = await connection.execute({ sqlText: "select account_renewal from customer" }) as { rows: { ACCOUNT_RENEWAL?: number }[] };
  db.customer.update({ data: { renewal: result.rows[0].ACCOUNT_RENEWAL, t: Number(process.hrtime.bigint()) } });
  return { ok: true };
}
