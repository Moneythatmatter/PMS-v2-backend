import { DatabaseError } from "../errors/index.js";

const RLS_HINT =
  "Supabase Row Level Security blocked this write. " +
  "Add SUPABASE_SERVICE_ROLE_KEY to backend/.env (Supabase → Settings → API → service_role), " +
  "then restart the backend. Or run backend/sql/housekeeping-tasks-create-rpc.sql in the Supabase SQL Editor.";

export function throwIfRlsError(message: string): never {
  if (/row-level security/i.test(message)) {
    throw new DatabaseError(RLS_HINT);
  }
  throw new Error(message);
}
