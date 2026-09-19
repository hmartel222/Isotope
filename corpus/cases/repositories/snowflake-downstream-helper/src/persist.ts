import { db } from "./db";

/** One helper hop from execute() row into the DB sink. */
export function persistCustomer(renewal: number | undefined) {
  db.customer.update({ data: { renewal } });
}
