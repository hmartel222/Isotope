import snowflake from "snowflake-sdk";
import { db } from "./db";
const connection = snowflake.createConnection({ account: "synthetic", username: "isotope", password: "inert" });

/** Commit still writes a constant sibling field; only the tainted renewal should diverge. */
export async function handler() {
  const result = await connection.execute({ sqlText: "select account_renewal from customer" }) as { rows: { ACCOUNT_RENEWAL?: number }[] };
  db.customer.update({ data: { region: "us-east-1", renewal: result.rows[0].ACCOUNT_RENEWAL } });
  return { ok: true };
}
