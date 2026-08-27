import { createClient } from "jsr:@supabase/supabase-js@2";

// Service-role client for use inside edge functions only. Never expose this key to the browser.
export function adminClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false } });
}
