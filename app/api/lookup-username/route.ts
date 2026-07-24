import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function getAnonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST(request: Request) {
  const supabase = getAnonClient();
  if (!supabase) return json({ error: "Supabase 尚未配置" }, 500);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "请求内容无效" }, 400);
  }

  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  if (!username || !/^[a-z0-9_]{3,20}$/.test(username)) {
    return json({ error: "用户名格式无效" }, 400);
  }

  const { data, error } = await supabase.rpc("get_email_by_username", { input: username });

  if (error) return json({ error: "查询失败" }, 500);
  if (!data) return json({ error: "该用户名不存在，请检查或直接用 GitHub 登录" }, 404);

  return json({ email: data as string });
}