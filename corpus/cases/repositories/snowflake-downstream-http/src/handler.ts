import snowflake from "snowflake-sdk";
import { post } from "./http";
const connection = snowflake.createConnection({ account: "synthetic", username: "isotope", password: "inert" });

/** Mocked http_out (not fetch) so the upgrade's missing field is visible off-box. */
export async function handler() {
  const result = await connection.execute({ sqlText: "select account_renewal from customer" }) as { rows: { ACCOUNT_RENEWAL?: number }[] };
  post("/hooks/renewal", { at: result.rows[0].ACCOUNT_RENEWAL });
  return { ok: true };
}
