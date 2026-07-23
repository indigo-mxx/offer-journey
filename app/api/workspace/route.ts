import { getChatGPTUser } from "../../chatgpt-auth";
import { ensureSchema, getD1 } from "../../../db";

export const dynamic = "force-dynamic";

type Visibility = "private" | "progress" | "full";

type ApplicationInput = {
  id?: string;
  company?: string;
  position?: string;
  base?: string;
  batch?: string;
  status?: string;
  appliedAt?: string;
  channel?: string;
  link?: string;
  salary?: string;
  note?: string;
  visibility?: Visibility;
};

type GroupRow = {
  id: string;
  name: string;
  owner_email: string;
  invite_code: string;
  role: "owner" | "member";
};

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function textValue(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validVisibility(value: unknown): Visibility {
  return value === "progress" || value === "full" ? value : "private";
}

async function currentGroup(email: string): Promise<GroupRow | null> {
  const db = getD1();
  return (
    (await db
      .prepare(
        `SELECT g.id, g.name, g.owner_email, g.invite_code, gm.role
         FROM groups g
         JOIN group_members gm ON gm.group_id = g.id
         WHERE gm.user_email = ?
         ORDER BY gm.joined_at ASC
         LIMIT 1`,
      )
      .bind(email)
      .first<GroupRow>()) ?? null
  );
}

async function upsertUser(email: string, displayName: string) {
  const now = new Date().toISOString();
  await getD1()
    .prepare(
      `INSERT INTO users (email, display_name, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         display_name = excluded.display_name,
         updated_at = excluded.updated_at`,
    )
    .bind(email, displayName, now, now)
    .run();
}

async function saveApplication(
  email: string,
  input: ApplicationInput,
  group: GroupRow | null,
) {
  const company = textValue(input.company, 120);
  const position = textValue(input.position, 160);
  if (!company || !position) {
    throw new Error("公司和岗位不能为空");
  }

  const db = getD1();
  const now = new Date().toISOString();
  const id = textValue(input.id, 80) || crypto.randomUUID();
  const visibility = validVisibility(input.visibility);
  const groupId = visibility === "private" ? null : group?.id ?? null;

  await db
    .prepare(
      `INSERT INTO applications (
         id, owner_email, group_id, visibility, company, position, base,
         batch, status, applied_at, channel, link, salary, note, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         group_id = excluded.group_id,
         visibility = excluded.visibility,
         company = excluded.company,
         position = excluded.position,
         base = excluded.base,
         batch = excluded.batch,
         status = excluded.status,
         applied_at = excluded.applied_at,
         channel = excluded.channel,
         link = excluded.link,
         salary = excluded.salary,
         note = excluded.note,
         updated_at = excluded.updated_at
       WHERE applications.owner_email = excluded.owner_email`,
    )
    .bind(
      id,
      email,
      groupId,
      visibility,
      company,
      position,
      textValue(input.base, 100),
      textValue(input.batch, 40) || "秋招",
      textValue(input.status, 40) || "准备投递",
      textValue(input.appliedAt, 20),
      textValue(input.channel, 100),
      textValue(input.link, 1000),
      textValue(input.salary, 100),
      textValue(input.note, 3000),
      now,
      now,
    )
    .run();
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "请先登录" }, 401);

  await ensureSchema();
  await upsertUser(user.email, user.displayName);
  const db = getD1();
  const group = await currentGroup(user.email);

  const applications = await db
    .prepare(
      `SELECT
         a.id, a.owner_email, a.group_id, a.visibility, a.company,
         a.position, a.base, a.batch, a.status, a.applied_at, a.channel,
         a.link, a.salary, a.note, a.updated_at, u.display_name AS owner_name
       FROM applications a
       JOIN users u ON u.email = a.owner_email
       WHERE a.owner_email = ?
          OR (
            a.visibility != 'private'
            AND a.group_id IN (
              SELECT group_id FROM group_members WHERE user_email = ?
            )
          )
       ORDER BY a.updated_at DESC`,
    )
    .bind(user.email, user.email)
    .all<Record<string, string | null>>();

  let members: Record<string, string>[] = [];
  if (group) {
    const result = await db
      .prepare(
        `SELECT u.email, u.display_name, gm.role, gm.joined_at
         FROM group_members gm
         JOIN users u ON u.email = gm.user_email
         WHERE gm.group_id = ?
         ORDER BY CASE gm.role WHEN 'owner' THEN 0 ELSE 1 END, gm.joined_at ASC`,
      )
      .bind(group.id)
      .all<Record<string, string>>();
    members = result.results;
  }

  return json({
    user,
    group: group
      ? {
          id: group.id,
          name: group.name,
          ownerEmail: group.owner_email,
          inviteCode: group.invite_code,
          role: group.role,
          members,
        }
      : null,
    applications: applications.results.map((row) => {
      const isOwner = row.owner_email === user.email;
      const isProgressOnly = !isOwner && row.visibility === "progress";
      return {
        id: row.id,
        ownerEmail: row.owner_email,
        ownerName: row.owner_name,
        isOwner,
        groupId: row.group_id,
        visibility: row.visibility,
        company: row.company,
        position: row.position,
        base: row.base,
        batch: row.batch,
        status: row.status,
        appliedAt: row.applied_at,
        channel: isProgressOnly ? "" : row.channel,
        link: isProgressOnly ? "" : row.link,
        salary: isProgressOnly ? "" : row.salary,
        note: isProgressOnly ? "" : row.note,
        updatedAt: row.updated_at,
      };
    }),
  });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "请先登录" }, 401);

  await ensureSchema();
  await upsertUser(user.email, user.displayName);
  const db = getD1();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "请求内容无效" }, 400);
  }

  const action = textValue(body.action, 40);
  const group = await currentGroup(user.email);

  try {
    if (action === "saveApplication") {
      await saveApplication(
        user.email,
        (body.application ?? {}) as ApplicationInput,
        group,
      );
    } else if (action === "importApplications") {
      const list = Array.isArray(body.applications)
        ? body.applications.slice(0, 200)
        : [];
      for (const item of list) {
        await saveApplication(
          user.email,
          item as ApplicationInput,
          group,
        );
      }
    } else if (action === "updateStatus") {
      const id = textValue(body.id, 80);
      const status = textValue(body.status, 40);
      if (!id || !status) return json({ error: "状态更新无效" }, 400);
      await db
        .prepare(
          "UPDATE applications SET status = ?, updated_at = ? WHERE id = ? AND owner_email = ?",
        )
        .bind(status, new Date().toISOString(), id, user.email)
        .run();
    } else if (action === "deleteApplication") {
      await db
        .prepare("DELETE FROM applications WHERE id = ? AND owner_email = ?")
        .bind(textValue(body.id, 80), user.email)
        .run();
    } else if (action === "createGroup") {
      if (group) return json({ error: "你已经加入了一个共享小组" }, 409);
      const name = textValue(body.name, 80) || "秋招搭子小组";
      const id = crypto.randomUUID();
      const inviteCode = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
      const now = new Date().toISOString();
      await db.batch([
        db
          .prepare(
            "INSERT INTO groups (id, name, owner_email, invite_code, created_at) VALUES (?, ?, ?, ?, ?)",
          )
          .bind(id, name, user.email, inviteCode, now),
        db
          .prepare(
            "INSERT INTO group_members (group_id, user_email, role, joined_at) VALUES (?, ?, 'owner', ?)",
          )
          .bind(id, user.email, now),
      ]);
    } else if (action === "joinGroup") {
      if (group) return json({ error: "你已经加入了一个共享小组" }, 409);
      const code = textValue(body.inviteCode, 20).toUpperCase();
      const target = await db
        .prepare("SELECT id FROM groups WHERE invite_code = ?")
        .bind(code)
        .first<{ id: string }>();
      if (!target) return json({ error: "邀请码不存在" }, 404);
      await db
        .prepare(
          "INSERT OR IGNORE INTO group_members (group_id, user_email, role, joined_at) VALUES (?, ?, 'member', ?)",
        )
        .bind(target.id, user.email, new Date().toISOString())
        .run();
    } else if (action === "leaveGroup") {
      if (!group) return json({ error: "尚未加入共享小组" }, 409);
      if (group.role === "owner") {
        return json({ error: "创建者暂不能退出，请先保留小组" }, 409);
      }
      await db.batch([
        db
          .prepare(
            "UPDATE applications SET group_id = NULL, visibility = 'private' WHERE owner_email = ? AND group_id = ?",
          )
          .bind(user.email, group.id),
        db
          .prepare(
            "DELETE FROM group_members WHERE group_id = ? AND user_email = ?",
          )
          .bind(group.id, user.email),
      ]);
    } else if (action === "rotateInviteCode") {
      if (!group || group.role !== "owner") return json({ error: "无权操作" }, 403);
      const code = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
      await db
        .prepare("UPDATE groups SET invite_code = ? WHERE id = ? AND owner_email = ?")
        .bind(code, group.id, user.email)
        .run();
    } else {
      return json({ error: "未知操作" }, 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作失败";
    return json({ error: message }, 400);
  }

  return json({ ok: true });
}
