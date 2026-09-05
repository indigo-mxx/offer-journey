"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "../../lib/supabase-browser";
import "../globals.css";

type LoginMode = "email" | "username";

export default function AuthPage() {
  const supabase = getSupabaseBrowserClient();
  const [loginMode, setLoginMode] = useState<LoginMode>("email");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(() => supabase ? "" : "还没有配置 Supabase 环境变量，请先完成项目设置。");

  function homePath() {
    const invite = new URLSearchParams(window.location.search).get("invite") || window.localStorage.getItem("pending-invite");
    return invite ? `/?invite=${encodeURIComponent(invite)}` : "/";
  }

  useEffect(() => {
    const invite = new URLSearchParams(window.location.search).get("invite")?.trim().toUpperCase();
    if (invite) window.localStorage.setItem("pending-invite", invite);
  }, []);

  async function lookupEmailByUsername(uname: string): Promise<string | null> {
    try {
      const res = await fetch("/api/lookup-username", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: uname }),
      });
      if (!res.ok) return null;
      const { email: found } = await res.json() as { email: string };
      return found;
    } catch {
      return null;
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage("");

    let actualEmail = email;

    // If username mode, resolve email from username first
    if (loginMode === "username") {
      const found = await lookupEmailByUsername(username);
      if (!found) {
        setMessage("该用户名不存在，请检查或切换到邮箱登录");
        setBusy(false);
        return;
      }
      actualEmail = found;
    }

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email: actualEmail, password });
      if (error) {
        setMessage(error.message);
      } else {
        window.location.assign(homePath());
      }
    } else {
      // signup only with email
      const result = await supabase.auth.signUp({ email: actualEmail, password, options: { data: { full_name: actualEmail.split("@")[0] } } });
      if (result.error) {
        setMessage(result.error.message);
      } else if (!result.data.session) {
        setMessage("注册成功，请打开邮箱里的验证链接，然后返回网站登录。");
      } else {
        window.location.assign(homePath());
      }
    }
    setBusy(false);
  }

  async function githubLogin() {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: `${window.location.origin}${homePath()}` },
    });
    if (error) setMessage(error.message);
    setBusy(false);
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link className="brand" href="/" aria-label="返回秋招同行录">
          <span className="brand-mark">秋</span>
          <span><strong>MXX · 秋招同行录</strong><small>投递与面试进度工作台</small></span>
        </Link>
        <div className="auth-copy">
          <p className="eyebrow">CLOUD ACCOUNT</p>
          <h1>{mode === "signin" ? "登录你的云端工作台" : "创建一个云端账号"}</h1>
          <p>QQ 邮箱、网易邮箱、Gmail 都可以直接使用；也可以用 GitHub 一键登录。</p>
        </div>
        <button className="secondary-button google-button" onClick={() => void githubLogin()} disabled={busy || !supabase}>
          <span className="google-mark github-mark">GH</span> GitHub 登录
        </button>
        <div className="auth-divider"><span>或使用密码</span></div>

        {/* Login mode tabs: email / username */}
        <div className="auth-mode-tabs">
          <button className={loginMode === "email" ? "active" : ""} onClick={() => setLoginMode("email")} type="button">邮箱登录</button>
          <button className={loginMode === "username" ? "active" : ""} onClick={() => setLoginMode("username")} type="button">用户名登录</button>
        </div>

        <form onSubmit={submit} className="auth-form">
          {loginMode === "email" ? (
            <label><span>邮箱</span><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
          ) : (
            <label><span>用户名</span><input type="text" required value={username} onChange={(event) => setUsername(event.target.value)} placeholder="例如：青山同学" minLength={2} maxLength={20} /></label>
          )}
          <label><span>密码</span><input type="password" minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 6 位" /></label>
          <button className="primary-button" disabled={busy || !supabase}>{busy ? "处理中…" : mode === "signin" ? "登录" : "注册并发送验证邮件"}</button>
        </form>

        <button className="auth-switch" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(""); }}>
          {mode === "signin" ? "还没有账号？注册一个" : "已有账号？返回登录"}
        </button>
        {message && <p className="auth-message">{message}</p>}
        <p className="auth-back"><Link href="/">先使用本地模式，不登录也可以记录</Link></p>
      </section>
    </main>
  );
}
