import warehouse from "acme-warehouse";
import { db } from "./db";
throw new Error("wrong-provider case must never execute");
export async function handler() {
  const rows = await warehouse.query() as { ACCOUNT_RENEWAL: number }[];
  db.customer.update({ data: { renewal: rows[0].ACCOUNT_RENEWAL } });
  return { ok: true };
}

