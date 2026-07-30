import {
  index,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export type ApplicationStatus =
  | "准备投递"
  | "简历投递"
  | "简历筛选"
  | "已投递"
  | "笔试"
  | "一面"
  | "二面"
  | "终面"
  | "HR面"
  | "Offer"
  | "已拒绝"
  | "流程结束";

export type Visibility = "private" | "progress" | "full";

export type Application = {
  id: string;
  company: string;
  position: string;
  base: string;
  industryTags: string[];
  companyScale: string;
  batch: string;
  status: ApplicationStatus;
  appliedAt: string;
  channel: string;
  link: string;
  salary: string;
  note: string;
  visibility: Visibility;
  createdAt?: string;
  updatedAt: string;
  ownerEmail?: string;
  ownerName?: string;
  isOwner?: boolean;
  groupId?: string | null;
};

export type Interview = {
  id: string;
  applicationId: string;
  scheduledAt: string;
  endedAt: string;
  round: string;
  format: string;
  interviewer: string;
  result: string;
  summary: string;
  nextSteps: string;
  createdAt?: string;
  updatedAt: string;
};

export type GroupInfo = {
  id: string;
  name: string;
  ownerEmail: string;
  inviteCode: string;
  role: "owner" | "member";
  members: Array<{
    email: string;
    display_name: string;
    role: "owner" | "member";
    joined_at: string;
  }>;
};

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

export const profiles = sqliteTable(
  "profiles",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    username: text("username").unique(),
    displayName: text("display_name").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("profiles_email_idx").on(table.email),
    uniqueIndex("profiles_username_idx").on(table.username),
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
