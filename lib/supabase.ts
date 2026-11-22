import { createClient } from "@supabase/supabase-js";

// Tables live in the "aptiming" schema (see supabase/001 and 002).
// The schema must also be added under Supabase -> Settings -> API -> Exposed schemas.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  { db: { schema: "aptiming" } }
);
