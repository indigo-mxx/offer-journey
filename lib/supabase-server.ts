import { createClient } from "@supabase/supabase-js";

export function getSupabaseServerClient(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase 环境变量尚未配置");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export async function getUserFromAccessToken(accessToken: string) {
  const supabase = getSupabaseServerClient(accessToken);
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) return { supabase, user: null };
  return { supabase, user: data.user };
}
