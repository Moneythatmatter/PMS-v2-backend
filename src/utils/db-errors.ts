import { ConflictError, DatabaseError } from "../errors/index.js";

const RLS_HINT =
  "Supabase Row Level Security blocked this write. " +
  "Fix (pick one): (1) Add SUPABASE_SERVICE_ROLE_KEY to backend/.env and restart the backend, " +
  "or (2) run backend/sql/fb-pos-v2-rls.sql (F&B POS v2 tables) or the RLS section in food-beverages-schema.sql in the Supabase SQL Editor.";

export function throwIfRlsError(message: string): never {
  if (/row-level security/i.test(message)) {
    throw new DatabaseError(RLS_HINT);
  }
  if (/duplicate key value violates unique constraint/i.test(message)) {
    throw new ConflictError(`Duplicate entry: ${duplicateField(message)} already exists in this property.`);
  }
  throw new Error(message);
}

function duplicateField(message: string): string {
  const name = message.match(/constraint "([^"]+)"/)?.[1] ?? "";
  const field = ["item_code", "recipe_code", "table_no", "table_number", "order_no", "bill_no", "kot_number", "code", "name"]
    .find((f) => name.includes(`_${f}_`) || name.endsWith(`_${f}`));
  return field ? `this ${field.replace(/_/g, " ")}` : "a record with the same value";
}
