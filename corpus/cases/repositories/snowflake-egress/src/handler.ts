import snowflake from "snowflake-sdk";
import { db } from "./db";
const connection = snowflake.createConnection({ account: "synthetic", username: "isotope", password: "inert" });

export async function handler() {
  const result = await connection.execute({ sqlText: "select account_renewal from customer" }) as { rows: { ACCOUNT_RENEWAL?: number }[] };
  await fetch("https://example.invalid/snowflake");
  db.customer.update({ data: { renewal: result.rows[0].ACCOUNT_RENEWAL } });
  return { ok: true };
}

