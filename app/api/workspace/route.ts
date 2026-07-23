import { getUserFromAccessToken } from "../../../lib/supabase-server";

export const dynamic = "force-dynamic";

type Visibility = "private" | "progress" | "full";

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function textValue(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function visibility(value: unknown): Visibility {
  return value === "progress" || value === "full" ? value : "private";
}

function accessToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

async function context(request: Request) {
  const token = accessToken(request);
  if (!token) return null;
  const result = await getUserFromAccessToken(token);
  return result.user ? result : null;
}

async function groupForUser(supabase: Awaited<ReturnType<typeof getUserFromAccessToken>>["supabase"], userId: string) {
  const { data: memberships } = await supabase
    .from("group_members")
    .select("group_id, role")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true })
    .limit(1);
  const membership = memberships?.[0];
  if (!membership) return null;
  const { data: group } = await supabase
    .from("groups")
    .select("id, name, owner_id, invite_code")
    .eq("id", membership.group_id)
    .maybeSingle();
  if (!group) return null;
  const { data: members } = await supabase
    .from("group_members")
    .select("user_id, role, joined_at")
    .eq("group_id", group.id)
    .order("joined_at", { ascending: true });
  const memberIds = (members ?? []).map((member) => member.user_id);
  const { data: profiles } = memberIds.length
    ? await supabase.from("profiles").select("id, email, display_name").in("id", memberIds)
    : { data: [] };
  const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  return {
    id: group.id,
    name: group.name,
    ownerEmail: profileMap.get(group.owner_id)?.email ?? "",
    inviteCode: group.invite_code,
    role: membership.role,
    members: (members ?? []).map((member) => ({
      email: profileMap.get(member.user_id)?.email ?? "",
      display_name: profileMap.get(member.user_id)?.display_name ?? "成员",
      role: member.role,
      joined_at: member.joined_at,
    })),
  };
}

export async function GET(request: Request) {
  const current = await context(request);
  if (!current) return json({ error: "请先登录" }, 401);
  const { supabase, user } = current;

  const [{ data: rows, error: applicationError }, { data: interviewRows, error: interviewError }] = await Promise.all([
    supabase.from("applications").select("*").order("updated_at", { ascending: false }),
    supabase.from("interviews").select("*").order("scheduled_at", { ascending: true }),
  ]);
  if (applicationError || interviewError) {
    return json({ error: applicationError?.message ?? interviewError?.message ?? "云端同步失败" }, 400);
  }

  const ownerIds = [...new Set((rows ?? []).map((row) => row.owner_id))];
  const { data: profiles } = ownerIds.length
    ? await supabase.from("profiles").select("id, email, display_name").in("id", ownerIds)
    : { data: [] };
  const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const applications = (rows ?? []).map((row) => {
    const isOwner = row.owner_id === user.id;
    const progressOnly = !isOwner && row.visibility === "progress";
    return {
      id: row.id,
      ownerEmail: profileMap.get(row.owner_id)?.email ?? "",
      ownerName: profileMap.get(row.owner_id)?.display_name ?? "朋友",
      isOwner,
      groupId: row.group_id,
      visibility: row.visibility,
      company: row.company,
      position: row.position,
      base: row.base,
      batch: row.batch,
      status: row.status,
      appliedAt: row.applied_at ?? "",
      channel: progressOnly ? "" : row.channel,
      link: progressOnly ? "" : row.link,
      salary: progressOnly ? "" : row.salary,
      note: progressOnly ? "" : row.note,
      updatedAt: row.updated_at,
    };
  });
  const interviews = (interviewRows ?? []).map((row) => ({
    id: row.id,
    applicationId: row.application_id,
    scheduledAt: row.scheduled_at,
    round: row.round,
    format: row.format,
    interviewer: row.interviewer,
    result: row.result,
    summary: row.summary,
    nextSteps: row.next_steps,
    updatedAt: row.updated_at,
  }));

  return json({ user, applications, interviews, group: await groupForUser(supabase, user.id) });
}

export async function POST(request: Request) {
  const current = await context(request);
  if (!current) return json({ error: "请先登录" }, 401);
  const { supabase, user } = current;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "请求内容无效" }, 400);
  }
  const action = textValue(body.action, 40);

  try {
    if (action === "saveApplication" || action === "importApplications") {
      const input = action === "importApplications" && Array.isArray(body.applications)
        ? body.applications.slice(0, 200)
        : [body.application ?? {}];
      const currentGroup = await groupForUser(supabase, user.id);
      const payload = input.map((item) => {
        const value = (item ?? {}) as Record<string, unknown>;
        const level = visibility(value.visibility);
        return {
          ...(textValue(value.id, 80) ? { id: textValue(value.id, 80) } : {}),
          owner_id: user.id,
          group_id: level === "private" ? null : textValue(value.groupId, 80) || currentGroup?.id || null,
          visibility: level,
          company: textValue(value.company, 120),
          position: textValue(value.position, 160),
          base: textValue(value.base, 100),
          batch: textValue(value.batch, 40) || "秋招",
          status: textValue(value.status, 40) || "准备投递",
          applied_at: textValue(value.appliedAt, 20) || null,
          channel: textValue(value.channel, 100),
          link: textValue(value.link, 1000),
          salary: textValue(value.salary, 100),
          note: textValue(value.note, 3000),
        };
      });
      if (payload.some((item) => !item.company || !item.position)) return json({ error: "公司和岗位不能为空" }, 400);
      const { error } = await supabase.from("applications").upsert(payload, { onConflict: "id" });
      if (error) return json({ error: error.message }, 400);
    } else if (action === "updateStatus") {
      const { error } = await supabase.from("applications").update({ status: textValue(body.status, 40) }).eq("id", textValue(body.id, 80)).eq("owner_id", user.id);
      if (error) return json({ error: error.message }, 400);
    } else if (action === "deleteApplication") {
      const { error } = await supabase.from("applications").delete().eq("id", textValue(body.id, 80)).eq("owner_id", user.id);
      if (error) return json({ error: error.message }, 400);
    } else if (action === "createGroup") {
      const { error } = await supabase.rpc("create_group", { group_name: textValue(body.name, 80) });
      if (error) return json({ error: error.message }, 400);
    } else if (action === "joinGroup") {
      const { error } = await supabase.rpc("join_group", { invite: textValue(body.inviteCode, 20).toUpperCase() });
      if (error) return json({ error: error.message.includes("invite_not_found") ? "邀请码不存在" : error.message }, 400);
    } else if (action === "leaveGroup") {
      const group = await groupForUser(supabase, user.id);
      if (!group) return json({ error: "尚未加入共享小组" }, 409);
      if (group.role === "owner") return json({ error: "创建者暂时不能退出，请先保留小组" }, 409);
      await supabase.from("applications").update({ group_id: null, visibility: "private" }).eq("owner_id", user.id).eq("group_id", group.id);
      const { error } = await supabase.from("group_members").delete().eq("group_id", group.id).eq("user_id", user.id);
      if (error) return json({ error: error.message }, 400);
    } else if (action === "rotateInviteCode") {
      const group = await groupForUser(supabase, user.id);
      if (!group || group.role !== "owner") return json({ error: "无权操作" }, 403);
      const { error } = await supabase.from("groups").update({ invite_code: crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase() }).eq("id", group.id).eq("owner_id", user.id);
      if (error) return json({ error: error.message }, 400);
    } else if (action === "deleteGroup") {
      const group = await groupForUser(supabase, user.id);
      if (!group || group.role !== "owner") return json({ error: "只有创建者可以删除小组" }, 403);
      const { error: resetError } = await supabase.from("applications").update({ group_id: null, visibility: "private" }).eq("owner_id", user.id).eq("group_id", group.id);
      if (resetError) return json({ error: resetError.message }, 400);
      const { error } = await supabase.from("groups").delete().eq("id", group.id).eq("owner_id", user.id);
      if (error) return json({ error: error.message }, 400);
    } else if (["saveInterview", "updateInterview"].includes(action)) {
      const value = (body.interview ?? {}) as Record<string, unknown>;
      const interview = {
        ...(textValue(value.id, 80) ? { id: textValue(value.id, 80) } : {}),
        application_id: textValue(value.applicationId, 80),
        owner_id: user.id,
        scheduled_at: textValue(value.scheduledAt, 60),
        round: textValue(value.round, 40) || "一面",
        format: textValue(value.format, 40) || "视频面试",
        interviewer: textValue(value.interviewer, 120),
        result: textValue(value.result, 40) || "待进行",
        summary: textValue(value.summary, 4000),
        next_steps: textValue(value.nextSteps, 2000),
      };
      if (!interview.application_id || !interview.scheduled_at) return json({ error: "请选择岗位并填写面试时间" }, 400);
      const { error } = await supabase.from("interviews").upsert(interview, { onConflict: "id" });
      if (error) return json({ error: error.message }, 400);
    } else if (action === "deleteInterview") {
      const { error } = await supabase.from("interviews").delete().eq("id", textValue(body.id, 80)).eq("owner_id", user.id);
      if (error) return json({ error: error.message }, 400);
    } else {
      return json({ error: "未知操作" }, 400);
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "操作失败" }, 400);
  }
  return json({ ok: true });
}
