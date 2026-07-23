import {
  index,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  email: text("email").primaryKey(),
  displayName: text("display_name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const groups = sqliteTable(
  "groups",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    ownerEmail: text("owner_email").notNull(),
    inviteCode: text("invite_code").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("groups_invite_code_idx").on(table.inviteCode),
    index("groups_owner_email_idx").on(table.ownerEmail),
  ],
);

export const groupMembers = sqliteTable(
  "group_members",
  {
    groupId: text("group_id").notNull(),
    userEmail: text("user_email").notNull(),
    role: text("role", { enum: ["owner", "member"] }).notNull(),
    joinedAt: text("joined_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.userEmail] }),
    index("group_members_user_email_idx").on(table.userEmail),
  ],
);

export const applications = sqliteTable(
  "applications",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    groupId: text("group_id"),
    visibility: text("visibility", {
      enum: ["private", "progress", "full"],
    })
      .notNull()
      .default("private"),
    company: text("company").notNull(),
    position: text("position").notNull(),
    base: text("base").notNull().default(""),
    batch: text("batch").notNull(),
    status: text("status").notNull(),
    appliedAt: text("applied_at").notNull().default(""),
    channel: text("channel").notNull().default(""),
    link: text("link").notNull().default(""),
    salary: text("salary").notNull().default(""),
    note: text("note").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("applications_owner_email_idx").on(table.ownerEmail),
    index("applications_group_id_idx").on(table.groupId),
    index("applications_updated_at_idx").on(table.updatedAt),
  ],
);
