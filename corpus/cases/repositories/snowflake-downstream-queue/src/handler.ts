import snowflake from "snowflake-sdk";
import { enqueue } from "./jobs";
const connection = snowflake.createConnection({ account: "synthetic", username: "isotope", password: "inert" });

/** Missing ACCOUNT_RENEWAL still enqueues after the upgrade commit. */
export async function handler() {
  const result = await connection.execute({ sqlText: "select account_renewal from customer" }) as { rows: { ACCOUNT_RENEWAL?: number }[] };
  enqueue({ kind: "renewal", at: result.rows[0].ACCOUNT_RENEWAL });
  return { ok: true };
}
