"use client";

import { FormEvent, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "../../lib/supabase-browser";
import "../globals.css";

export default function AuthPage() {
  const supabase = getSupabaseBrowserClient();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!supabase) setMessage("还没有配置 Supabase 环境变量，请先完成项目设置。");
  }, [supabase]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    const result = mode === "signin"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { full_name: email.split("@")[0] } } });
    if (result.error) {
      setMessage(result.error.message);
    } else if (mode === "signup" && !result.data.session) {
      setMessage("注册成功，请打开邮箱里的验证链接，然后返回网站登录。");
    } else {
      window.location.assign("/");
    }
    setBusy(false);
  }

  async function githubLogin() {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: `${window.location.origin}/` },
    });
    if (error) setMessage(error.message);
    setBusy(false);
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <a className="brand" href="/" aria-label="返回秋招同行录">
          <span className="brand-mark">秋</span>
          <span><strong>秋招同行录</strong><small>投递与面试进度工作台</small></span>
        </a>
        <div className="auth-copy">
          <p className="eyebrow">CLOUD ACCOUNT</p>
          <h1>{mode === "signin" ? "登录你的云端工作台" : "创建一个云端账号"}</h1>
          <p>QQ 邮箱、网易邮箱、Gmail 都可以直接使用；也可以用 GitHub 一键登录。</p>
        </div>
        <div className="auth-divider"><span>或使用邮箱</span></div>
        <form onSubmit={submit} className="auth-form">
          <label><span>邮箱</span><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
          <label><span>密码</span><input type="password" minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 6 位" /></label>
          <button className="primary-button" disabled={busy || !supabase}>{busy ? "处理中…" : mode === "signin" ? "登录" : "注册并发送验证邮件"}</button>
        </form>
        <button className="secondary-button google-button" onClick={() => void githubLogin()} disabled={busy || !supabase}>
          <span className="google-mark github-mark">GH</span> GitHub 登录
        </button>
        <button className="auth-switch" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(""); }}>
          {mode === "signin" ? "还没有账号？注册一个" : "已有账号？返回登录"}
        </button>
        {message && <p className="auth-message">{message}</p>}
        <p className="auth-back"><a href="/">先使用本地模式，不登录也可以记录</a></p>
      </section>
    </main>
  );
}
