import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

let schemaReady: Promise<void> | null = null;

export function getD1(): D1Database {
  if (!env.DB) {
    throw new Error("Cloud database is unavailable.");
  }
  return env.DB;
}

export function getDb() {
  return drizzle(getD1(), { schema });
}

export function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  const db = getD1();
  const initialization = db
    .batch([
      db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
          email TEXT PRIMARY KEY NOT NULL,
          display_name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `),
      db.prepare(`
        CREATE TABLE IF NOT EXISTS groups (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          owner_email TEXT NOT NULL,
          invite_code TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL
        )
      `),
      db.prepare(`
        CREATE TABLE IF NOT EXISTS group_members (
          group_id TEXT NOT NULL,
          user_email TEXT NOT NULL,
          role TEXT NOT NULL,
          joined_at TEXT NOT NULL,
          PRIMARY KEY (group_id, user_email)
        )
      `),
      db.prepare(`
        CREATE TABLE IF NOT EXISTS applications (
          id TEXT PRIMARY KEY NOT NULL,
          owner_email TEXT NOT NULL,
          group_id TEXT,
          visibility TEXT NOT NULL DEFAULT 'private',
          company TEXT NOT NULL,
          position TEXT NOT NULL,
          base TEXT NOT NULL DEFAULT '',
          batch TEXT NOT NULL,
          status TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT '',
          channel TEXT NOT NULL DEFAULT '',
          link TEXT NOT NULL DEFAULT '',
          salary TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `),
      db.prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS groups_invite_code_idx ON groups(invite_code)",
      ),
      db.prepare(
        "CREATE INDEX IF NOT EXISTS groups_owner_email_idx ON groups(owner_email)",
      ),
      db.prepare(
        "CREATE INDEX IF NOT EXISTS group_members_user_email_idx ON group_members(user_email)",
      ),
      db.prepare(
        "CREATE INDEX IF NOT EXISTS applications_owner_email_idx ON applications(owner_email)",
      ),
      db.prepare(
        "CREATE INDEX IF NOT EXISTS applications_group_id_idx ON applications(group_id)",
      ),
      db.prepare(
        "CREATE INDEX IF NOT EXISTS applications_updated_at_idx ON applications(updated_at)",
      ),
    ])
    .then(() => undefined)
    .catch((error: unknown) => {
      schemaReady = null;
      throw error;
    });
  schemaReady = initialization;
  return initialization;
}
