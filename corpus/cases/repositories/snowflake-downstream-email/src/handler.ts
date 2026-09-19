import snowflake from "snowflake-sdk";
import { db } from "./db";
import { send } from "./mailer";
const connection = snowflake.createConnection({ account: "synthetic", username: "isotope", password: "inert" });

/** Same execute() value fans out to email and DB after the upgrade commit. */
export async function handler() {
  const result = await connection.execute({ sqlText: "select account_renewal from customer" }) as { rows: { ACCOUNT_RENEWAL?: number }[] };
  const renewal = result.rows[0].ACCOUNT_RENEWAL;
  send({ template: "renewal", at: renewal });
  db.customer.update({ data: { renewal } });
  return { ok: true };
}
