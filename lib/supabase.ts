import { createClient } from "@supabase/supabase-js";

// Tables live in the "aptiming" schema (see supabase/001 and 002).
// The schema must also be added under Supabase -> Settings -> API -> Exposed schemas.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// False when the two settings are missing (e.g. not added in Vercel yet). Pages show a message
// instead of failing the whole build.
export const supabaseConfigured = Boolean(url && key);

export const supabase = createClient(
  url || "https://placeholder.supabase.co",
  key || "placeholder-key",
  { db: { schema: "aptiming" } }
);
