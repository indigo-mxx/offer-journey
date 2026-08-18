import { getUserFromAccessToken } from "../../../lib/supabase-server";

export const dynamic = "force-dynamic";

type Visibility = "private" | "progress" | "full";

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function textValue(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function tagValues(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].slice(0, 12).map((item) => item.slice(0, 40));
}

function visibility(value: unknown): Visibility {
  return value === "progress" || value === "full" ? value : "private";
}

const FINAL_OUTCOME_PREFIX = "【最终结果】";
const REJECTION_REASON_PREFIX = "【拒绝原因】";

function resolutionFromNote(value: string) {
  const finalOutcome = value.match(/【最终结果】([^\n]*)/)?.[1]?.trim() ?? "";
  const rejectionReason = value.match(/【拒绝原因】([^\n]*)/)?.[1]?.trim() ?? "";
  const note = value
    .replace(/【最终结果】[^\n]*\n?/g, "")
    .replace(/【拒绝原因】[^\n]*\n?/g, "")
    .trim();
  return { finalOutcome, rejectionReason, note };
}

function noteWithResolution(note: unknown, status: string, finalOutcome: unknown, rejectionReason: unknown) {
  const cleanNote = textValue(note, 3000)
    .replace(/【最终结果】[^\n]*\n?/g, "")
    .replace(/【拒绝原因】[^\n]*\n?/g, "")
    .trim();
  const result = status === "流程结束" ? textValue(finalOutcome, 80) : "";
  const reason = status === "已拒绝" ? textValue(rejectionReason, 200) : "";
  return [
    result ? `${FINAL_OUTCOME_PREFIX}${result}` : "",
    reason ? `${REJECTION_REASON_PREFIX}${reason}` : "",
    cleanNote,
  ].filter(Boolean).join("\n");
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

async function groupsForUser(supabase: Awaited<ReturnType<typeof getUserFromAccessToken>>["supabase"], userId: string) {
  const { data: memberships } = await supabase
    .from("group_members")
    .select("group_id, role")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true });
  if (!memberships?.length) return [];
  const groupIds = memberships.map((m) => m.group_id);
  const [{ data: groupRows }, { data: allMembers }] = await Promise.all([
    supabase
      .from("groups")
      .select("id, name, owner_id, invite_code")
      .in("id", groupIds),
    supabase
      .from("group_members")
      .select("group_id, user_id, role, joined_at")
      .in("group_id", groupIds)
      .order("joined_at", { ascending: true }),
  ]);
  const groupMap = new Map((groupRows ?? []).map((g) => [g.id, g]));
  const memberUserIds = [...new Set((allMembers ?? []).map((m) => m.user_id))];
  const { data: profiles } = memberUserIds.length
    ? await supabase.from("profiles").select("id, email, display_name").in("id", memberUserIds)
    : { data: [] };
  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
  const membersByGroup = new Map<string, typeof allMembers>();
  for (const member of allMembers ?? []) {
    if (!membersByGroup.has(member.group_id)) membersByGroup.set(member.group_id, []);
    membersByGroup.get(member.group_id)!.push(member);
  }
  const membershipMap = new Map(memberships.map((m) => [m.group_id, m.role]));
  return groupIds.map((id) => {
    const group = groupMap.get(id);
    if (!group) return null;
    const members = membersByGroup.get(id) ?? [];
    return {
      id: group.id,
      name: group.name,
      ownerEmail: profileMap.get(group.owner_id)?.email ?? "",
      inviteCode: group.invite_code,
      role: membershipMap.get(id) ?? "member",
      members: members.map((member) => ({
        email: profileMap.get(member.user_id)?.email ?? "",
        display_name: profileMap.get(member.user_id)?.display_name ?? "成员",
        role: member.role,
        joined_at: member.joined_at,
      })),
    };
  }).filter((g): g is NonNullable<typeof g> => g != null);
}

export async function GET(request: Request) {
  const current = await context(request);
  if (!current) return json({ error: "请先登录" }, 401);
  const { supabase, user } = current;

  const [[{ data: rows, error: applicationError }, { data: interviewRows, error: interviewError }, { data: experienceRows, error: experienceError }], groups] = await Promise.all([
    Promise.all([
      supabase.from("applications").select("*").order("updated_at", { ascending: false }),
      supabase.from("interviews").select("*").order("scheduled_at", { ascending: true }),
      supabase.from("interview_experiences").select("*").order("updated_at", { ascending: false }),
    ]),
    groupsForUser(supabase, user.id),
  ]);
  if (applicationError || interviewError) {
    return json({ error: applicationError?.message ?? interviewError?.message ?? "云端同步失败" }, 400);
  }

  if (experienceError && experienceError.code !== "42P01") return json({ error: experienceError.message }, 400);
  const ownerIds = [...new Set((rows ?? []).map((row) => row.owner_id))];
  const { data: profiles } = ownerIds.length
    ? await supabase.from("profiles").select("id, email, display_name").in("id", ownerIds)
    : { data: [] };
  const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const applications = (rows ?? []).map((row) => {
    const isOwner = row.owner_id === user.id;
    const progressOnly = !isOwner && row.visibility === "progress";
    const resolution = progressOnly ? { finalOutcome: "", rejectionReason: "", note: "" } : resolutionFromNote(row.note ?? "");
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
      industryTags: Array.isArray(row.industry_tags) ? row.industry_tags : [],
      companyScale: row.company_scale ?? "",
      batch: row.batch,
      status: row.status,
      appliedAt: row.applied_at ?? "",
      channel: progressOnly ? "" : row.channel,
      link: progressOnly ? "" : row.link,
      salary: progressOnly ? "" : row.salary,
      note: resolution.note,
      finalOutcome: resolution.finalOutcome,
      rejectionReason: resolution.rejectionReason,
      updatedAt: row.updated_at,
    };
  });
  const interviews = (interviewRows ?? []).map((row) => ({
    id: row.id,
    applicationId: row.application_id,
    scheduledAt: row.scheduled_at,
    endedAt: row.ended_at ?? "",
    round: row.round,
    format: row.format,
    interviewer: row.interviewer,
    result: row.result,
    summary: row.summary,
    nextSteps: row.next_steps,
    updatedAt: row.updated_at,
  }));

  const experiences = (experienceRows ?? []).map((row) => ({
    id: row.id,
    applicationId: row.application_id ?? "",
    title: row.title ?? "",
    company: row.company ?? "",
    position: row.position ?? "",
    round: row.round ?? "",
    tags: Array.isArray(row.tags) ? row.tags : [],
    content: row.content ?? "",
    takeaway: row.takeaway ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return json({ user, applications, interviews, experiences, groups });
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
    if (action === "saveApplication" || action === "importApplications" || action === "importWorkspace") {
      const workspaceImport = action === "importWorkspace";
      const input = (action === "importApplications" || workspaceImport) && Array.isArray(body.applications)
        ? body.applications.slice(0, workspaceImport ? 500 : 200)
        : [body.application ?? {}];
      if (workspaceImport && (!Array.isArray(body.applications) || body.applications.length > 500)) {
        return json({ error: "单次最多导入 500 个岗位" }, 400);
      }
      const userGroups = await groupsForUser(supabase, user.id);
      const allowedGroupIds = new Set(userGroups.map((group) => group.id));
      const payload = input.map((item) => {
        const value = (item ?? {}) as Record<string, unknown>;
        const level = visibility(value.visibility);
        const explicitGroupId = textValue(value.groupId, 80);
        const groupId = level === "private" ? null : (allowedGroupIds.has(explicitGroupId) ? explicitGroupId : (userGroups[0]?.id || null));
        return {
          ...(textValue(value.id, 80) ? { id: textValue(value.id, 80) } : {}),
          owner_id: user.id,
          group_id: groupId,
          visibility: level,
          company: textValue(value.company, 120),
          position: textValue(value.position, 160),
          base: textValue(value.base, 100),
          industry_tags: tagValues(value.industryTags),
          company_scale: textValue(value.companyScale, 100),
          batch: textValue(value.batch, 40) || "秋招",
          status: textValue(value.status, 40) || "准备投递",
          applied_at: textValue(value.appliedAt, 20) || null,
          channel: textValue(value.channel, 100),
          link: textValue(value.link, 1000),
          salary: textValue(value.salary, 100),
          note: noteWithResolution(value.note, textValue(value.status, 40) || "准备投递", value.finalOutcome, value.rejectionReason),
        };
      });
      if (payload.some((item) => !item.company || !item.position)) return json({ error: "公司和岗位不能为空" }, 400);
      if (workspaceImport && textValue(body.mode, 20) === "replace") {
        const { error: interviewDeleteError } = await supabase.from("interviews").delete().eq("owner_id", user.id);
        if (interviewDeleteError) return json({ error: interviewDeleteError.message }, 400);
        const { error: applicationDeleteError } = await supabase.from("applications").delete().eq("owner_id", user.id);
        if (applicationDeleteError) return json({ error: applicationDeleteError.message }, 400);
      }
      if (payload.length) {
        const { error } = await supabase.from("applications").upsert(payload, { onConflict: "id" });
        if (error) return json({ error: error.message }, 400);
      }
      if (workspaceImport) {
        if (!Array.isArray(body.interviews) || body.interviews.length > 1000) {
          return json({ error: "面试记录格式不正确或数量过多" }, 400);
        }
        const allowedApplicationIds = new Set(payload.map((item) => item.id).filter((id): id is string => Boolean(id)));
        const interviewPayload = body.interviews.map((item) => {
          const value = (item ?? {}) as Record<string, unknown>;
          return {
            ...(textValue(value.id, 80) ? { id: textValue(value.id, 80) } : {}),
            application_id: textValue(value.applicationId, 80),
            owner_id: user.id,
            scheduled_at: textValue(value.scheduledAt, 60),
            ended_at: textValue(value.endedAt, 60) || null,
            round: textValue(value.round, 40) || "一面",
            format: textValue(value.format, 40) || "视频面试",
            interviewer: textValue(value.interviewer, 120),
            result: textValue(value.result, 40) || "待定",
            summary: textValue(value.summary, 4000),
            next_steps: textValue(value.nextSteps, 2000),
          };
        });
        if (interviewPayload.some((item) => !item.application_id || !item.scheduled_at || !allowedApplicationIds.has(item.application_id))) {
          return json({ error: "面试记录没有匹配到本次导入的岗位" }, 400);
        }
        if (interviewPayload.length) {
          const { error } = await supabase.from("interviews").upsert(interviewPayload, { onConflict: "id" });
          if (error) return json({ error: error.message }, 400);
        }
      }
    } else if (action === "updateStatus") {
      const status = textValue(body.status, 40);
      const { error } = await supabase.from("applications").update({ status, note: noteWithResolution(body.note, status, body.finalOutcome, body.rejectionReason) }).eq("id", textValue(body.id, 80)).eq("owner_id", user.id);
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
      const groupId = textValue(body.groupId, 80);
      if (!groupId) return json({ error: "请指定小组" }, 400);
      const userGroups = await groupsForUser(supabase, user.id);
      const group = userGroups.find((g) => g.id === groupId);
      if (!group) return json({ error: "尚未加入该共享小组" }, 409);
      if (group.role === "owner") return json({ error: "创建者不能退出，请先删除小组" }, 409);
      await supabase.from("applications").update({ group_id: null, visibility: "private" }).eq("owner_id", user.id).eq("group_id", groupId);
      const { error } = await supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", user.id);
      if (error) return json({ error: error.message }, 400);
    } else if (action === "rotateInviteCode") {
      const groupId = textValue(body.groupId, 80);
      if (!groupId) return json({ error: "请指定小组" }, 400);
      const userGroups = await groupsForUser(supabase, user.id);
      const group = userGroups.find((g) => g.id === groupId);
      if (!group || group.role !== "owner") return json({ error: "无权操作" }, 403);
      const { error } = await supabase.from("groups").update({ invite_code: crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase() }).eq("id", groupId).eq("owner_id", user.id);
      if (error) return json({ error: error.message }, 400);
    } else if (action === "deleteGroup") {
      const groupId = textValue(body.groupId, 80);
      if (!groupId) return json({ error: "请指定小组" }, 400);
      const userGroups = await groupsForUser(supabase, user.id);
      const group = userGroups.find((g) => g.id === groupId);
      if (!group || group.role !== "owner") return json({ error: "只有创建者可以删除小组" }, 403);
      const { error: resetError } = await supabase.from("applications").update({ group_id: null, visibility: "private" }).eq("owner_id", user.id).eq("group_id", groupId);
      if (resetError) return json({ error: resetError.message }, 400);
      const { error } = await supabase.from("groups").delete().eq("id", groupId).eq("owner_id", user.id);
      if (error) return json({ error: error.message }, 400);
    } else if (["saveInterview", "updateInterview"].includes(action)) {
      const value = (body.interview ?? {}) as Record<string, unknown>;
      const interview = {
        ...(textValue(value.id, 80) ? { id: textValue(value.id, 80) } : {}),
        application_id: textValue(value.applicationId, 80),
        owner_id: user.id,
        scheduled_at: textValue(value.scheduledAt, 60),
        ended_at: textValue(value.endedAt, 60) || null,
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
    } else if (action === "saveExperience" || action === "updateExperience") {
      const value = (body.experience ?? {}) as Record<string, unknown>;
      const experience = {
        ...(textValue(value.id, 80) ? { id: textValue(value.id, 80) } : {}),
        owner_id: user.id,
        application_id: textValue(value.applicationId, 80) || null,
        title: textValue(value.title, 180),
        company: textValue(value.company, 120),
        position: textValue(value.position, 160),
        round: textValue(value.round, 40),
        tags: tagValues(value.tags),
        content: textValue(value.content, 12000),
        takeaway: textValue(value.takeaway, 4000),
      };
      if (!experience.title || !experience.content) return json({ error: "\u8bf7\u586b\u5199\u9762\u7ecf\u6807\u9898\u548c\u9762\u8bd5\u5185\u5bb9" }, 400);
      const { error } = await supabase.from("interview_experiences").upsert(experience, { onConflict: "id" });
      if (error) return json({ error: error.code === "42P01" ? "\u9762\u7ecf\u5e93\u5c1a\u672a\u521d\u59cb\u5316\uff0c\u8bf7\u5148\u5728 Supabase SQL Editor \u6267\u884c 004_interview_experiences.sql" : error.message }, 400);
    } else if (action === "deleteExperience") {
      const { error } = await supabase.from("interview_experiences").delete().eq("id", textValue(body.id, 80)).eq("owner_id", user.id);
      if (error) return json({ error: error.code === "42P01" ? "\u9762\u7ecf\u5e93\u5c1a\u672a\u521d\u59cb化，请先在 Supabase SQL Editor 执行 004_interview_experiences.sql" : error.message }, 400);
    } else {
      return json({ error: "未知操作" }, 400);
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "操作失败" }, 400);
  }
  return json({ ok: true });
}
