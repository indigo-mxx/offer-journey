"use client";

import { FormEvent, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "../../lib/supabase-browser";
import "../globals.css";

export default function AccountPage() {
  const supabase = getSupabaseBrowserClient();
  const [email, setEmail] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [password, setPasswordValue] = useState("");
  const [provider, setProvider] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        window.location.assign("/auth");
        return;
      }
      setEmail(data.user.email ?? "");
      setProvider(data.user.app_metadata?.provider ?? "");
    });
  }, [supabase]);

  async function updateEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !newEmail.trim()) return;
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
    setMessage(error ? error.message : "绑定邮件已发送，请打开新旧邮箱中的确认邮件完成绑定。");
    if (!error) setNewEmail("");
    setBusy(false);
  }

  async function setAccountPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || password.length < 6) return;
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.updateUser({ password });
    setMessage(error ? error.message : "密码已设置。下次可以使用当前邮箱和这个密码登录。");
    if (!error) setPasswordValue("");
    setBusy(false);
  }

  return (
    <main className="auth-shell">
      <section className="account-card">
        <a className="brand" href="/" aria-label="返回秋招同行录">
          <span className="brand-mark">秋</span>
          <span><strong>秋招同行录</strong><small>账户设置</small></span>
        </a>
        <div className="auth-copy">
          <p className="eyebrow">ACCOUNT SETTINGS</p>
          <h1>管理你的登录方式</h1>
          <p>GitHub 登录后不需要重复注册。你还可以在这里绑定邮箱，或给当前账号设置密码。</p>
        </div>
        <div className="account-summary">
          <span className="account-avatar">{email.slice(0, 1).toUpperCase() || "U"}</span>
          <div><strong>{email || "正在读取账号…"}</strong><small>{provider === "github" ? "已使用 GitHub 登录" : "邮箱账号"}</small></div>
        </div>
        {provider === "github" && <p className="form-hint">当前账号已绑定 GitHub 登录</p>}
        <form onSubmit={setAccountPassword} className="auth-form account-form">
          <h2>设置邮箱登录密码</h2>
          <p className="form-hint">如果你是 GitHub 注册用户，设置密码后可直接用上面的邮箱 + 密码登录。</p>
          <label><span>新密码</span><input type="password" minLength={6} required value={password} onChange={(event) => setPasswordValue(event.target.value)} placeholder="至少 6 位" /></label>
          <button className="primary-button" disabled={busy || !supabase}>{busy ? "处理中…" : "保存密码"}</button>
        </form>
        <form onSubmit={updateEmail} className="auth-form account-form">
          <h2>绑定或更换邮箱</h2>
          <p className="form-hint">填写后会发送确认邮件；确认完成前，当前邮箱仍然有效。</p>
          <label><span>新邮箱</span><input type="email" required value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="例如 your@qq.com" /></label>
          <button className="secondary-button" disabled={busy || !supabase}>{busy ? "处理中…" : "发送绑定确认邮件"}</button>
        </form>
        {message && <p className="auth-message">{message}</p>}
        <p className="auth-back"><a href="/">返回工作台</a></p>
      </section>
    </main>
  );
}
