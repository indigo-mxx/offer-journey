import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

declare global {
  interface Window {
    __SUPABASE_CONFIG__?: { url?: string; anonKey?: string };
  }
}

export function getSupabaseBrowserClient() {
  if (client) return client;
  const runtimeConfig = typeof window !== "undefined" ? window.__SUPABASE_CONFIG__ : undefined;
  const url = runtimeConfig?.url || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = runtimeConfig?.anonKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}
