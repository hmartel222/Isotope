import snowflake from "snowflake-sdk";
import { persistCustomer } from "./persist";
const connection = snowflake.createConnection({ account: "synthetic", username: "isotope", password: "inert" });

/** Upgrade commit still calls execute(); downstream persist writes ACCOUNT_RENEWAL. */
export async function handler() {
  const result = await connection.execute({ sqlText: "select account_renewal from customer" }) as { rows: { ACCOUNT_RENEWAL?: number }[] };
  persistCustomer(result.rows[0].ACCOUNT_RENEWAL);
  return { ok: true };
}
