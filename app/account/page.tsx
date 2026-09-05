"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "../../lib/supabase-browser";
import { isValidUsername, normalizeUsername, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from "../../lib/username";
import "../globals.css";

export default function AccountPage() {
  const supabase = getSupabaseBrowserClient();
  const [email, setEmail] = useState("");
  const [provider, setProvider] = useState("");
  const [currentUsername, setCurrentUsername] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPasswordValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [usernameError, setUsernameError] = useState("");

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        window.location.assign("/auth");
        return;
      }
      setEmail(data.user.email ?? "");
      setProvider(data.user.app_metadata?.provider ?? "");

      // Load current username from profile
      const { data: profile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", data.user.id)
        .maybeSingle();
      if (profile?.username) {
        setCurrentUsername(profile.username);
        setUsername(profile.username);
      }
    });
  }, [supabase]);

  function validateUsername(value: string): string {
    if (!value.trim()) return "";
    const length = Array.from(value.trim()).length;
    if (length < USERNAME_MIN_LENGTH || length > USERNAME_MAX_LENGTH) return `用户名长度需在 ${USERNAME_MIN_LENGTH}~${USERNAME_MAX_LENGTH} 个字符之间`;
    if (!isValidUsername(value)) return "用户名仅支持中文、英文字母、数字和下划线";
    return "";
  }

  async function checkUsernameAvailability(value: string): Promise<boolean> {
    if (!supabase) return false;
    const { data } = await supabase.rpc("get_email_by_username", { input: normalizeUsername(value) });
    // If no email returned, the username is available; if it returns current user's email, it's also ok
    return !data || data === email;
  }

  async function saveUsername() {
    if (!supabase) return;
    const err = validateUsername(username);
    if (err) { setUsernameError(err); return; }
    if (!username.trim()) { setUsernameError("请输入用户名"); return; }

    setBusy(true);
    setMessage("");
    setUsernameError("");

    const normalizedUsername = normalizeUsername(username);
    const available = await checkUsernameAvailability(normalizedUsername);
    if (!available) {
      setUsernameError("该用户名已被使用，请换一个");
      setBusy(false);
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({ username: normalizedUsername })
      .eq("id", (await supabase.auth.getUser()).data.user?.id ?? "");

    if (error) {
      setMessage(error.message);
    } else {
      setCurrentUsername(normalizedUsername);
      setUsername(normalizedUsername);
      setMessage("用户名已保存");
    }
    setBusy(false);
  }

  async function setAccountPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || password.length < 6) return;
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.updateUser({ password });
    setMessage(error ? error.message : "密码已设置。下次可以使用用户名和这个密码登录。");
    if (!error) setPasswordValue("");
    setBusy(false);
  }

  return (
    <main className="auth-shell">
      <section className="account-card">
        <Link className="brand" href="/" aria-label="返回秋招同行录">
          <span className="brand-mark">秋</span>
          <span><strong>MXX · 秋招同行录</strong><small>个人中心</small></span>
        </Link>
        <div className="auth-copy">
          <p className="eyebrow">ACCOUNT SETTINGS</p>
          <h1>个人中心</h1>
          <p>使用 GitHub 登录后即可使用。你还可以设置用户名和密码，之后无需 GitHub 也可直接登录。</p>
        </div>

        <div className="account-summary">
          <span className="account-avatar">{email.slice(0, 1).toUpperCase() || "U"}</span>
          <div>
            <strong>{email || "正在读取账号…"}</strong>
            <small>
              {provider === "github" ? "已使用 GitHub 登录" : "邮箱账号"}
              {currentUsername ? ` · 用户名：${currentUsername}` : ""}
            </small>
          </div>
        </div>

        {/* Username setting */}
        <form className="auth-form account-form" onSubmit={(e) => { e.preventDefault(); void saveUsername(); }}>
          <h2>设置用户名</h2>
          <p className="form-hint">
            此名称会显示在工作台右上角，也可用于登录。2~20 个字符，支持中文、英文字母、数字和下划线。
          </p>
          <label>
            <span>用户名</span>
            <input
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                setUsernameError(validateUsername(event.target.value));
              }}
              placeholder="例如：青山同学"
              minLength={USERNAME_MIN_LENGTH}
              maxLength={USERNAME_MAX_LENGTH}
            />
          </label>
          {usernameError && <p className="field-error">{usernameError}</p>}
          <button
            className="primary-button"
            disabled={busy || !supabase || !!usernameError}
            type="submit"
          >
            {busy ? "处理中…" : currentUsername ? "更新用户名" : "保存用户名"}
          </button>
        </form>

        {/* Password setting */}
        <form onSubmit={setAccountPassword} className="auth-form account-form">
          <h2>设置登录密码</h2>
          <p className="form-hint">
            设置密码后，可直接用上面的用户名 + 密码登录，不再需要 GitHub。
          </p>
          <label>
            <span>密码</span>
            <input
              type="password"
              minLength={6}
              required
              value={password}
              onChange={(event) => setPasswordValue(event.target.value)}
              placeholder="至少 6 位"
            />
          </label>
          <button className="primary-button" disabled={busy || !supabase || !username.trim()}>
            {busy ? "处理中…" : "保存密码"}
          </button>
          {!username.trim() && <p className="form-hint" style={{ color: "var(--muted)" }}>请先设置用户名，再保存密码</p>}
        </form>

        {message && <p className="auth-message">{message}</p>}
        <p className="auth-back"><Link href="/">返回工作台</Link></p>
      </section>
    </main>
  );
}
