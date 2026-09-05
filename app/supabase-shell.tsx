"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "../lib/supabase-browser";
import { RecruitmentTracker } from "./recruitment-tracker";

export function SupabaseShell() {
  const supabase = getSupabaseBrowserClient();
  const [session, setSession] = useState<Awaited<ReturnType<NonNullable<typeof supabase>["auth"]["getSession"]>>["data"]["session"]>(null);
  const [ready, setReady] = useState(!supabase);
  const [profileName, setProfileName] = useState<{ userId: string; username: string } | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setReady(true);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  const authUser = session?.user;
  const authUserId = authUser?.id;

  useEffect(() => {
    let active = true;
    if (!supabase || !authUserId) return;
    void supabase.from("profiles").select("username").eq("id", authUserId).maybeSingle().then(({ data }) => {
      if (active) setProfileName({ userId: authUserId, username: typeof data?.username === "string" ? data.username : "" });
    });
    return () => { active = false; };
  }, [authUserId, supabase]);

  const username = profileName && profileName.userId === authUserId ? profileName.username : "";
  const displayName = username || authUser?.user_metadata?.full_name || authUser?.email?.split("@")[0] || "同学";

  useEffect(() => {
    if (!ready) return;
    document.title = `秋招同行录 · ${authUserId ? displayName : "未登录"}`;
  }, [authUserId, displayName, ready]);

  if (!ready) {
    return <main className="loading-state">正在连接云端账户…</main>;
  }

  const invite = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("invite") : null;
  const signInPath = invite ? `/auth?invite=${encodeURIComponent(invite)}` : "/auth";
  const user = authUser
    ? { displayName, email: authUser.email ?? "", fullName: displayName }
    : null;

  return (
    <RecruitmentTracker
      user={user}
      accessToken={session?.access_token ?? null}
      signInPath={signInPath}
      signOutPath="/auth"
      onSignOut={supabase ? async () => { await supabase.auth.signOut(); window.location.assign("/"); } : undefined}
    />
  );
}
