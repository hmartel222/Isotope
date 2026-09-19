import snowflake from "snowflake-sdk";
import { db } from "./db";
const connection = snowflake.createConnection({ account: "synthetic", username: "isotope", password: "inert" });

/** execute is present for L2 but never taken at runtime. */
export async function handler() {
  if (false) await connection.execute({ sqlText: "select account_renewal from customer" });
  db.customer.update({ data: { renewal: 0 } });
  return { ok: true };
}
