import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
import { config } from "../config/index.js";
/** Prefer service role on the server so API writes are not blocked by RLS. */
const usingServiceRole = Boolean(config.supabase.serviceRoleKey());
const supabaseKey = config.supabase.serviceRoleKey() ?? config.supabase.anonKey();
if (!usingServiceRole && process.env.NODE_ENV !== "test") {
    console.warn("[supabase] SUPABASE_SERVICE_ROLE_KEY is not set — using anon key. " +
        "Run backend/sql/housekeeping-tasks-create-rpc.sql in Supabase if writes fail RLS.");
}
export const supabase = createClient(config.supabase.url(), supabaseKey);
//# sourceMappingURL=supabase.js.map