"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { autocompleteScore, matchesFieldsSearch, matchesLiteralSearch, matchesTextSearch, matchingAutocompleteOptions } from "@/lib/search";
import { createWorkspaceWorkbook, readWorkspaceWorkbook } from "@/lib/workbook-backup";
import type { WorkspaceBackup } from "@/lib/workbook-backup";
import type { Application, Interview, InterviewExperience, RecruitmentEvent, RecruitmentEventStatus, RecruitmentEventType, GroupInfo, ApplicationStatus, Visibility } from "@/db/schema";
import { RecruitmentCalendar, UpcomingScheduleCard, calendarKindLabel } from "./recruitment-calendar";
import type { CalendarItemKind, RecruitmentCalendarItem } from "./recruitment-calendar";
import type { ChatGPTUser } from "./chatgpt-auth";

// ──────────────────────────────────────────────── types
interface Props {
  user: ChatGPTUser | null;
  accessToken: string | null;
  signInPath: string;
  signOutPath: string;
  onSignOut?: () => Promise<void>;
}

interface FormState {
  company: string;
  position: string;
  base: string;
  batch: string;
  appliedAt: string;
  status: ApplicationStatus;
  channel: string;
  link: string;
  salary: string;
  note: string;
  finalOutcome: string;
  rejectionReason: string;
  visibility: Visibility;
  groupId: string;
  companyNature: string;
  companySubtype: string;
  industryTags: string[];
  companyScale: string;
}

interface CompanyFormState {
  name: string;
  companyNature: string;
  companySubtype: string;
  industryTags: string[];
  companyScale: string;
}

interface BatchPositionEntry {
  position: string;
  base: string;
}

interface ExperienceForm {
  applicationId: string;
  interviewId: string;
  scheduledAt: string;
  endedAt: string;
  title: string;
  company: string;
  position: string;
  round: string;
  format: string;
  result: string;
  interviewer: string;
  tags: string;
  content: string;
  takeaway: string;
  visibility: "private" | "full";
  groupId: string;
}

interface ImportPreview {
  fileName: string;
  applications: Application[];
  interviews: Interview[];
  experiences: InterviewExperience[];
  events: RecruitmentEvent[];
  ignoredInterviews: number;
  ignoredExperiences: number;
  ignoredEvents: number;
}

interface CalendarEventForm {
  phase: "scheduled" | "completed";
  kind: CalendarItemKind;
  timingType: "scheduled" | "deadline";
  applicationId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  round: string;
  mode: string;
  location: string;
  eventUrl: string;
  status: string;
  note: string;
  syncStatus: boolean;
}

interface CalendarTodoEntry {
  id: string;
  dismissKey: string;
  tone: "overdue" | "followup" | "missing" | "upcoming";
  label: string;
  title: string;
  detail: string;
  scheduledAt: string;
  priority: number;
  action: "scheduleInterview" | "editSchedule" | "writeExperience";
  application: Application;
  interview?: Interview;
  calendarItem?: RecruitmentCalendarItem;
  canComplete?: boolean;
}

interface RecoverySnapshot extends WorkspaceBackup {
  id: string;
  ownerKey: string;
  savedAt: string;
  fingerprint: string;
}

type ListMode = "companyList" | "companyCards" | "position" | "kanban";
type WorkspaceView = "calendar" | "mine" | "friends" | "sharing" | "dashboard" | "experiences";
type NoticeTone = "success" | "error" | "warning" | "info";

const LIST_MODE_STORAGE_KEY = "qiuzhao-list-mode";
const WORKSPACE_VIEW_STORAGE_KEY = "qiuzhao-workspace-view";
const CLOUD_REQUEST_TIMEOUT_MS = 35_000;
const CLOUD_RETRY_DELAY_MS = 900;
const RETRYABLE_CLOUD_ACTIONS = new Set([
  "saveApplication",
  "importApplications",
  "importWorkspace",
  "updateStatus",
  "deleteApplication",
  "saveInterview",
  "updateInterview",
  "deleteInterview",
  "saveExperience",
  "updateExperience",
  "deleteExperience",
  "saveEvent",
  "updateEvent",
  "deleteEvent",
  "dismissTodo",
]);
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const LIST_MODE_OPTIONS: Array<{
  value: ListMode;
  icon: string;
  label: string;
  description: string;
}> = [
  { value: "companyList", icon: "▤", label: "公司清单", description: "按公司汇总投递记录" },
  { value: "companyCards", icon: "▦", label: "公司卡片", description: "查看公司资料与岗位进度" },
  { value: "position", icon: "≡", label: "岗位明细", description: "逐条查看每个投递岗位" },
  { value: "kanban", icon: "◫", label: "进度看板", description: "按求职阶段推进流程" },
];

function noticeToneFor(message: string): NoticeTone {
  if (/失败|错误|超时|无法|未保存|不可用/.test(message)) return "error";
  if (/请|不能|暂时|没有可|未登录/.test(message)) return "warning";
  if (/成功|已保存|已更新|更新完成|已删除|已加入|已创建|已退出|导出|导入完成|已复制/.test(message)) return "success";
  return "info";
}

function databaseActionName(label: string) {
  return label.replace(/^正在/, "").replace(/中$/, "").trim() || "数据库操作";
}

function httpFailureReason(status: number) {
  const reasons: Record<number, string> = {
    400: "提交的数据不符合要求",
    401: "登录状态已失效，请重新登录",
    403: "当前账号没有操作权限",
    404: "目标记录不存在或已被删除",
    408: "云端请求超时",
    409: "数据状态发生冲突，请刷新后重试",
    425: "云端暂时无法处理该请求",
    429: "操作过于频繁，请稍后重试",
    500: "服务器处理异常",
    502: "云端服务暂时不可用",
    503: "云端服务暂时不可用",
    504: "云端响应超时",
  };
  return reasons[status] || `服务器返回 ${status}`;
}

function isTransientCloudFailure(message: string) {
  return /fetch failed|network|timeout|timed out|connection|temporar(?:y|ily)|upstream|gateway|连接中断|网络|超时|暂时不可用/i.test(message);
}

function waitForCloudRetry() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, CLOUD_RETRY_DELAY_MS));
}

function ModalPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

// ──────────────────────────────────────────────── constants
const STATUSES: ApplicationStatus[] = ["准备投递", "简历投递", "已投递", "简历筛选", "笔试", "一面", "二面", "三面", "终面", "HR面", "Offer", "已拒绝", "流程结束"];
const INTERVIEW_STATUSES: ApplicationStatus[] = ["一面", "二面", "三面", "终面", "HR面"];
const CLOSED_STATUSES: ApplicationStatus[] = ["已拒绝", "流程结束"];
const RESUME_STATUSES: ApplicationStatus[] = ["准备投递", "简历投递", "已投递", "简历筛选"];
const QUICK_STATUS_FILTERS = ["全部状态", "简历阶段", "笔试", "面试进行中", "Offer", "流程已结束"];
const KANBAN_COLUMNS: { key: string; label: string; hint: string; statuses: ApplicationStatus[] }[] = [
  { key: "resume", label: "简历阶段", hint: "准备、投递与筛选", statuses: RESUME_STATUSES },
  { key: "test", label: "笔试", hint: "测评与笔试", statuses: ["笔试"] },
  { key: "interview", label: "面试中", hint: "一面至 HR 面", statuses: INTERVIEW_STATUSES },
  { key: "offer", label: "Offer", hint: "已获得录用", statuses: ["Offer"] },
  { key: "closed", label: "已结束", hint: "拒绝或主动终止", statuses: CLOSED_STATUSES },
];

const BATCHES = ["秋招", "提前批", "日常实习", "其他"];

const BASE_OPTIONS = [
  "北京", "上海", "广州", "深圳", "杭州", "成都", "武汉", "南京", "苏州", "西安", "合肥", "重庆",
  "天津", "青岛", "厦门", "长沙", "郑州", "宁波", "无锡", "东莞", "珠海", "佛山", "济南", "大连",
  "沈阳", "长春", "哈尔滨", "福州", "昆明", "南昌", "石家庄", "香港", "全国", "远程",
];

const PLATFORM_OPTIONS = [
  "招聘官网", "内推", "校园招聘", "Boss 直聘", "牛客", "猎聘", "智联招聘", "前程无忧", "实习僧", "拉勾", "LinkedIn", "微信公众号", "线下宣讲会", "其他",
];

const VISIBILITY_OPTIONS: { value: Visibility; label: string }[] = [
  { value: "private", label: "仅自己" },
  { value: "progress", label: "仅共享进度" },
  { value: "full", label: "完整共享" },
];

const INDUSTRY_OPTIONS = [
  "半导体", "具身智能", "智能驾驶", "软件", "游戏", "汽车", "机器人", "AI / 大模型",
  "互联网 / 平台", "互联网/电商", "硬件 / 消费电子", "通信", "金融科技", "金融/银行",
  "生物医药", "医疗健康", "化工", "能源电力", "制造业", "快消/零售", "咨询/四大",
  "地产/建筑", "教育", "研究院", "公共服务", "其他",
];

const COMPANY_SCALE_OPTIONS = [
  "未知", "1-50人", "51-200人", "201-500人", "501-2000人", "2001-10000人", "10000+人",
];

const COMPANY_NATURE_PREFIX = "单位性质：";
const COMPANY_SUBTYPE_PREFIX = "单位细分：";
const LEGACY_COMPANY_NATURE_TAGS = new Map([
  ["国企/央企", "国企"],
  ["事业单位", "事业单位"],
  ["外企", "外企"],
  ["创业公司", "私企"],
]);
const COMPANY_NATURE_OPTIONS = [
  { value: "国企", subtypes: ["央企总部", "央企子公司", "地方国企", "国有金融机构"] },
  { value: "私企", subtypes: ["上市公司", "大型民企", "成长型公司", "初创公司"] },
  { value: "外企", subtypes: ["欧美外企", "日韩外企", "外资研发中心", "合资企业"] },
  { value: "事业单位", subtypes: ["高校", "科研院所", "公立医院", "其他事业单位"] },
  { value: "行政单位", subtypes: ["中央机关", "地方机关", "基层机关", "参公单位"] },
  { value: "其他", subtypes: ["社会组织", "国际组织", "其他单位"] },
];

const FINAL_OUTCOME_OPTIONS = ["简历挂", "笔试挂", "一面挂", "二面挂", "三面挂", "终面挂", "HR 面挂", "薪资不满足", "岗位关闭", "主动终止", "其他"];
const REJECTION_REASON_OPTIONS = ["薪资不满足", "岗位 / 方向不匹配", "已接受其他 Offer", "地点或到岗时间不合适", "个人原因", "其他"];

const EMPTY_FORM: FormState = {
  company: "",
  position: "",
  base: "",
  batch: "秋招",
  appliedAt: new Date().toISOString().slice(0, 10),
  status: "简历投递",
  channel: "",
  link: "",
  salary: "",
  note: "",
  finalOutcome: "",
  rejectionReason: "",
  visibility: "private",
  groupId: "",
  companyNature: "",
  companySubtype: "",
  industryTags: [],
  companyScale: "",
};

const EMPTY_COMPANY_FORM: CompanyFormState = {
  name: "",
  companyNature: "",
  companySubtype: "",
  industryTags: [],
  companyScale: "",
};

const EMPTY_EXPERIENCE: ExperienceForm = {
  applicationId: "",
  interviewId: "",
  scheduledAt: "",
  endedAt: "",
  title: "",
  company: "",
  position: "",
  round: "",
  format: "视频面试",
  result: "待定",
  interviewer: "",
  tags: "",
  content: "",
  takeaway: "",
  visibility: "private",
  groupId: "",
};

const INTERVIEW_ROUNDS = ["技术一面", "技术二面", "技术三面", "交叉面", "主管面", "HR面", "群面", "VP面", "其他"];
const INTERVIEW_FORMATS = ["视频面试", "电话面试", "线下", "笔试", "其他"];
const INTERVIEW_RESULTS = ["待定", "通过", "未通过", "未参加"];
const RECRUITMENT_EVENT_TYPES: RecruitmentEventType[] = ["written_test", "assessment", "deadline", "hr_contact", "other"];
const RECRUITMENT_EVENT_STATUSES: RecruitmentEventStatus[] = ["待进行", "已完成", "已取消"];
const CALENDAR_EVENT_MODES = ["线上", "线下", "电话", "邮件", "其他"];
const TODO_DISMISSALS_STORAGE_PREFIX = "dismissed-calendar-todos:";

function emptyCalendarEventForm(date = new Date()): CalendarEventForm {
  return {
    phase: "scheduled",
    kind: "written_test",
    timingType: "scheduled",
    applicationId: "",
    title: "",
    startsAt: calendarStartValue(date),
    endsAt: "",
    allDay: false,
    round: "技术一面",
    mode: "线上",
    location: "",
    eventUrl: "",
    status: "待进行",
    note: "",
    syncStatus: true,
  };
}

// ──────────────────────────────────────────────── helpers
function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatDateTime(value: string) {
  if (!value) return "时间待定";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

function calendarTodoTime(value: string) {
  if (!value) return "等待安排";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const today = new Date();
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((targetStart - dayStart) / 86_400_000);
  const prefix = days === 0 ? "今天" : days === 1 ? "明天" : days === -1 ? "昨天" : days > 1 && days <= 7 ? `${days} 天后` : days < -1 && days >= -7 ? `${Math.abs(days)} 天前` : "";
  const formatted = date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  return prefix ? `${prefix} · ${formatted}` : formatted;
}

function formatInterviewDate(value: string) {
  if (!value) return "时间待定";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date);
  const datePart = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
  const timePart = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  return `${datePart} ${weekday} ${timePart}`;
}

function dateTimeLocalValue(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function storedDateTimeValue(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function calendarStartValue(value: Date) {
  const date = new Date(value);
  if (date.getHours() === 0 && date.getMinutes() === 0) date.setHours(9, 0, 0, 0);
  else {
    date.setSeconds(0, 0);
    date.setMinutes(Math.ceil(date.getMinutes() / 30) * 30);
  }
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

type InterviewStage = "一面" | "二面" | "三面" | "终面" | "HR面" | "其他";

const INTERVIEW_STAGE_COLUMNS: Array<{ key: InterviewStage; hint: string }> = [
  { key: "一面", hint: "初轮沟通与基础考察" },
  { key: "二面", hint: "技术深挖与项目追问" },
  { key: "三面", hint: "高阶技术或交叉评估" },
  { key: "终面", hint: "主管与最终决策" },
  { key: "HR面", hint: "意向、薪资与到岗" },
];

function interviewStage(value: string): InterviewStage {
  const normalized = value.trim().toLocaleLowerCase().replace(/[\s\-_]/g, "");
  if (/hr|人力/.test(normalized)) return "HR面";
  if (/终|vp|高管|主管/.test(normalized)) return "终面";
  if (/三|3|交叉/.test(normalized)) return "三面";
  if (/二|2/.test(normalized)) return "二面";
  if (/一|1|初/.test(normalized)) return "一面";
  return "其他";
}

function defaultRoundForStage(stage: InterviewStage) {
  if (stage === "一面") return "技术一面";
  if (stage === "二面") return "技术二面";
  if (stage === "三面") return "技术三面";
  return stage === "其他" ? "其他" : stage;
}

function companyKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

function companyClassification(tags: string[] = []) {
  const storedNature = tags.find((tag) => tag.startsWith(COMPANY_NATURE_PREFIX))?.slice(COMPANY_NATURE_PREFIX.length) ?? "";
  const legacyNature = tags.map((tag) => LEGACY_COMPANY_NATURE_TAGS.get(tag)).find(Boolean) ?? "";
  const companyNature = storedNature === "民企" ? "私企" : storedNature || legacyNature;
  const companySubtype = tags.find((tag) => tag.startsWith(COMPANY_SUBTYPE_PREFIX))?.slice(COMPANY_SUBTYPE_PREFIX.length) ?? "";
  return { companyNature, companySubtype };
}

function matchesStatusFilter(status: ApplicationStatus, filter: string) {
  if (filter === "全部状态") return true;
  if (filter === "简历阶段") return RESUME_STATUSES.includes(status);
  if (filter === "面试进行中") return INTERVIEW_STATUSES.includes(status);
  if (filter === "流程已结束") return CLOSED_STATUSES.includes(status);
  return status === filter;
}

function industryOnly(tags: string[] = []) {
  return tags.filter((tag) => !tag.startsWith(COMPANY_NATURE_PREFIX) && !tag.startsWith(COMPANY_SUBTYPE_PREFIX) && !LEGACY_COMPANY_NATURE_TAGS.has(tag));
}

function tagsWithClassification(companyNature: string, companySubtype: string, industryTags: string[]) {
  return [
    ...(companyNature ? [`${COMPANY_NATURE_PREFIX}${companyNature}`] : []),
    ...(companySubtype ? [`${COMPANY_SUBTYPE_PREFIX}${companySubtype}`] : []),
    ...industryOnly(industryTags),
  ];
}

function statusTone(status: ApplicationStatus) {
  if (status === "Offer") return "offer";
  if (["一面", "二面", "三面", "终面", "HR面"].includes(status)) return "interview";
  if (status === "笔试") return "test";
  if (["已拒绝", "流程结束"].includes(status)) return "closed";
  return "default";
}

function visibilityLabel(visibility: Visibility) {
  if (visibility === "progress") return "共享进度";
  if (visibility === "full") return "完整共享";
  return "仅自己";
}

function externalHttpUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function PositionLinkAction({ application, compact = false }: { application: Application; compact?: boolean }) {
  if (application.isOwner === false && application.visibility !== "full") {
    return compact ? null : <span className="cell-muted">仅完整共享可见</span>;
  }

  const href = externalHttpUrl(application.link);
  if (!href) return compact ? null : <span className="cell-muted">未填写链接</span>;

  return (
    <a className={`position-link-action ${compact ? "compact" : ""}`} href={href} target="_blank" rel="noopener noreferrer" title={`打开 ${application.company} ${application.position} 的岗位链接`}>
      <span aria-hidden="true">↗</span>{compact ? "打开链接" : "打开岗位链接"}
    </a>
  );
}

function safeApplications(value: unknown): value is Application[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        typeof item.company === "string" &&
        typeof item.position === "string",
    )
  );
}

function safeInterviews(value: unknown): value is Interview[] {
  return Array.isArray(value) && value.every((item) => item && typeof item === "object" && typeof item.id === "string" && typeof item.applicationId === "string" && typeof item.scheduledAt === "string");
}
function safeExperiences(value: unknown): value is InterviewExperience[] {
  return Array.isArray(value) && value.every((item) => item && typeof item === "object" && typeof item.id === "string" && typeof item.title === "string" && typeof item.content === "string");
}

function isScheduledInterview(interview: Interview) {
  return interview.result === "未开始" || (
    !interview.endedAt && new Date(interview.scheduledAt).getTime() > Date.now() && (!interview.result || interview.result === "待定")
  );
}
function safeRecruitmentEvents(value: unknown): value is RecruitmentEvent[] {
  return Array.isArray(value) && value.every((item) => item && typeof item === "object" && typeof item.id === "string" && typeof item.applicationId === "string" && typeof item.eventType === "string" && typeof item.startsAt === "string");
}


function normalizeLocal(items: Application[]) {
  return items.map((item) => ({
    ...item,
    visibility: item.visibility ?? "private",
    industryTags: Array.isArray(item.industryTags) ? item.industryTags.filter(Boolean) : [],
    companyScale: item.companyScale ?? "",
    isOwner: true,
  }));
}

function normalizeInterviews(items: Interview[]) {
  return items.map((item) => ({ ...item, endedAt: item.endedAt ?? "", location: item.location ?? "", eventUrl: item.eventUrl ?? "" }));
}

function normalizeRecruitmentEvents(items: RecruitmentEvent[]): RecruitmentEvent[] {
  return items.map((item) => ({
    ...item,
    timingType: item.timingType === "deadline" ? "deadline" : "scheduled",
    endsAt: item.endsAt ?? "",
    allDay: Boolean(item.allDay),
    mode: item.mode ?? "",
    location: item.location ?? "",
    eventUrl: item.eventUrl ?? "",
    status: RECRUITMENT_EVENT_STATUSES.includes(item.status) ? item.status : "待进行",
    note: item.note ?? "",
    isOwner: item.isOwner ?? true,
  }));
}

function normalizeExperiences(items: InterviewExperience[]): InterviewExperience[] {
  return items.map((item) => ({
    ...item,
    interviewId: item.interviewId ?? "",
    tags: Array.isArray(item.tags) ? item.tags.filter(Boolean) : [],
    visibility: item.visibility === "full" ? "full" as const : "private" as const,
    groupId: item.groupId ?? null,
    isOwner: item.isOwner ?? true,
  }));
}

const RECOVERY_DATABASE_NAME = "offer-journey-recovery";
const RECOVERY_STORE_NAME = "workspace-snapshots";
const RECOVERY_SNAPSHOT_LIMIT = 5;

function openRecoveryDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前浏览器不支持本地恢复快照"));
      return;
    }
    const request = indexedDB.open(RECOVERY_DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RECOVERY_STORE_NAME)) {
        const store = database.createObjectStore(RECOVERY_STORE_NAME, { keyPath: "id" });
        store.createIndex("ownerKey", "ownerKey", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地恢复空间"));
  });
}

async function loadRecoverySnapshots(ownerKey: string) {
  const database = await openRecoveryDatabase();
  return new Promise<RecoverySnapshot[]>((resolve, reject) => {
    const transaction = database.transaction(RECOVERY_STORE_NAME, "readonly");
    const request = transaction.objectStore(RECOVERY_STORE_NAME).index("ownerKey").getAll(ownerKey);
    request.onsuccess = () => resolve((request.result as RecoverySnapshot[]).sort((a, b) => b.savedAt.localeCompare(a.savedAt)));
    request.onerror = () => reject(request.error ?? new Error("无法读取本地恢复快照"));
    transaction.oncomplete = () => database.close();
  });
}

async function saveRecoverySnapshot(ownerKey: string, data: WorkspaceBackup) {
  const events = Array.isArray(data.events) ? data.events : [];
  if (!data.applications.length && !data.interviews.length && !data.experiences.length && !events.length) return loadRecoverySnapshots(ownerKey);
  const fingerprint = [
    ...data.applications.map((item) => `a:${item.id}:${item.updatedAt}`),
    ...data.interviews.map((item) => `i:${item.id}:${item.updatedAt}`),
    ...data.experiences.map((item) => `e:${item.id}:${item.updatedAt}`),
    ...events.map((item) => `c:${item.id}:${item.updatedAt}`),
  ].sort().join("|");
  const existingSnapshots = await loadRecoverySnapshots(ownerKey);
  if (existingSnapshots[0]?.fingerprint === fingerprint) return existingSnapshots;
  const savedAt = new Date().toISOString();
  const snapshot: RecoverySnapshot = { id: `${ownerKey}:${savedAt}`, ownerKey, savedAt, fingerprint, ...data, events };
  const database = await openRecoveryDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(RECOVERY_STORE_NAME, "readwrite");
    transaction.objectStore(RECOVERY_STORE_NAME).put(snapshot);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("无法保存本地恢复快照"));
  });
  database.close();
  const snapshots = await loadRecoverySnapshots(ownerKey);
  if (snapshots.length > RECOVERY_SNAPSHOT_LIMIT) {
    const cleanupDatabase = await openRecoveryDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = cleanupDatabase.transaction(RECOVERY_STORE_NAME, "readwrite");
      const store = transaction.objectStore(RECOVERY_STORE_NAME);
      snapshots.slice(RECOVERY_SNAPSHOT_LIMIT).forEach((item) => store.delete(item.id));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("无法清理旧快照"));
    });
    cleanupDatabase.close();
  }
  return snapshots.slice(0, RECOVERY_SNAPSHOT_LIMIT);
}
function applicationImportKey(item: Pick<Application, "company" | "position" | "appliedAt">) {
  return [companyKey(item.company), item.position.trim().toLocaleLowerCase(), item.appliedAt || ""].join("|");
}

function importedApplication(item: Application, groupIds: Set<string>, fallbackGroupId: string) {
  const canShare = item.visibility !== "private" && Boolean(fallbackGroupId || (item.groupId && groupIds.has(item.groupId)));
  const groupId = canShare ? (item.groupId && groupIds.has(item.groupId) ? item.groupId : fallbackGroupId) : null;
  return {
    ...item,
    visibility: canShare ? item.visibility : "private" as Visibility,
    groupId,
    isOwner: true,
  };
}

type SortKey = "company" | "position" | "appliedAt" | "status";
type SortDirection = "asc" | "desc";

function compareApplications(a: Application, b: Application, key: SortKey) {
  if (key === "status") return STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status);
  if (key === "appliedAt") return (a.appliedAt || "").localeCompare(b.appliedAt || "");
  return (a[key] || "").localeCompare(b[key] || "", "zh-CN");
}

// ──────────────────────────────────────────────── components
function SharingPanel({
  groups,
  activeGroupId,
  setActiveGroupId,
  groupName,
  inviteCode,
  busy,
  setGroupName,
  setInviteCode,
  copyInviteCode,
  copyShareLink,
  runAction,
}: {
  groups: GroupInfo[];
  activeGroupId: string | null;
  setActiveGroupId: (id: string | null) => void;
  groupName: string;
  inviteCode: string;
  busy: boolean;
  setGroupName: (name: string) => void;
  setInviteCode: (code: string) => void;
  copyInviteCode: () => void;
  copyShareLink: () => void;
  runAction: (action: string) => Promise<void>;
}) {
  const selectedGroup = groups.find((group) => group.id === activeGroupId) ?? null;
  return (
    <div className="sharing-panel">
      <h3>共享小组</h3>
      {groups.length === 0 ? (
        <p>暂无小组，创建一个吧</p>
      ) : (
        <ul className="group-list">
          {groups.map((g) => (
            <li key={g.id} className={g.id === activeGroupId ? "active" : ""}>
              <button onClick={() => setActiveGroupId(g.id === activeGroupId ? null : g.id)}>
                {g.name} ({g.members.length}人)
              </button>
            </li>
          ))}
        </ul>
      )}
      {selectedGroup && (
        <div className="current-invite-card">
          <div>
            <small>当前小组邀请码</small>
            <strong>{selectedGroup.inviteCode || "暂未生成"}</strong>
            <span>分享邀请码或链接，好友加入后才能看到你公开的进度。</span>
          </div>
          <div className="current-invite-actions">
            <button onClick={copyInviteCode} disabled={busy || !selectedGroup.inviteCode}>复制邀请码</button>
            <button onClick={copyShareLink} disabled={busy || !selectedGroup.inviteCode}>复制邀请链接</button>
          </div>
        </div>
      )}
      <div className="group-actions">
        <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="小组名称" disabled={busy} />
        <button onClick={() => runAction("create")} disabled={busy || !groupName.trim()}>
          {busy ? "处理中…" : "创建新小组"}
        </button>
      </div>
      <div className="group-invite">
        <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="输入邀请码加入其他小组" disabled={busy} />
        <button onClick={() => runAction("join")} disabled={busy || !inviteCode.trim()}>
          {busy ? "处理中…" : "加入小组"}
        </button>
        {activeGroupId && (
          <>
          <button
            className="danger"
            onClick={() => runAction(selectedGroup?.role === "owner" ? "delete" : "leave")}
            disabled={busy}
          >
            {selectedGroup?.role === "owner" ? "删除小组" : "退出小组"}
          </button>
          </>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────── main component
type DashboardRange = "all" | "30" | "90";

type DropdownOption = { value: string; label: string; hint?: string };

function DropdownSelect({
  value,
  options,
  onChange,
  placeholder = "请选择",
  ariaLabel,
  disabled = false,
  className = "",
}: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);
  const popoverRef = useRef<HTMLDivElement>(null);
  const filteredOptions = options.filter((option) => `${option.label} ${option.hint ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const updatePopoverPosition = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportPadding = 12;
      const width = Math.min(Math.max(rect.width, 190), window.innerWidth - viewportPadding * 2);
      const left = Math.min(Math.max(rect.right - width, viewportPadding), window.innerWidth - width - viewportPadding);
      const estimatedHeight = 300;
      const openUp = rect.bottom + estimatedHeight > window.innerHeight - viewportPadding && rect.top > estimatedHeight;
      setPopoverStyle(openUp
        ? { width, left, top: "auto", bottom: window.innerHeight - rect.top + 6 }
        : { width, left, top: rect.bottom + 6, bottom: "auto" });
    };
    const frame = window.requestAnimationFrame(updatePopoverPosition);
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [open]);


  return (
    <div className={`select-field ${className}${open ? " is-open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => { setQuery(""); setOpen((current) => !current); }}
      >
        <span className={selected ? "" : "placeholder"}>{selected?.label ?? placeholder}</span><i aria-hidden="true">⌄</i>
      </button>
      {open && createPortal(
        <div className="select-popover portal-popover" ref={popoverRef} style={popoverStyle} role="listbox" aria-label={ariaLabel} onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            rootRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
          }
        }}>
          <label className="select-search"><span>⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入关键词筛选" /></label>
          <div className="select-options">
            {filteredOptions.length ? filteredOptions.map((option) => (
              <button
                type="button"
                key={option.value}
                className={option.value === value ? "selected" : ""}
                role="option"
                aria-selected={option.value === value}
                onClick={() => { onChange(option.value); setOpen(false); }}
              >
                <strong>{option.label}</strong>{option.hint && <small>{option.hint}</small>}
              </button>
            )) : <p className="select-empty">没有匹配的选项</p>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function DashboardPanel({
  applications,
  range,
  onRangeChange,
  onOpenApplications,
}: {
  applications: Application[];
  range: DashboardRange;
  onRangeChange: (range: DashboardRange) => void;
  onOpenApplications: () => void;
}) {
  const dashboard = useMemo(() => {
    const total = applications.length;
    const percentage = (count: number) => total ? Math.round((count / total) * 100) : 0;
    const active = applications.filter((item) => ![...CLOSED_STATUSES, "Offer"].includes(item.status)).length;
    const interview = applications.filter((item) => INTERVIEW_STATUSES.includes(item.status)).length;
    const offers = applications.filter((item) => item.status === "Offer").length;
    const progressed = applications.filter((item) => !RESUME_STATUSES.includes(item.status)).length;
    const companyCount = new Set(applications.map((item) => companyKey(item.company))).size;
    const sharedCount = applications.filter((item) => item.visibility !== "private").length;

    const rank = (values: string[]) => [...new Map(
      values.map((value) => value.trim() || "未填写").map((value) => [value, 0]),
    ).keys()].map((label) => ({
      label,
      count: values.filter((value) => (value.trim() || "未填写") === label).length,
    })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-CN")).slice(0, 5);

    const sixMonths = Array.from({ length: 6 }, (_, index) => {
      const date = new Date();
      date.setDate(1);
      date.setMonth(date.getMonth() - (5 - index));
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      return { key, label: `${date.getMonth() + 1}月`, count: applications.filter((item) => item.appliedAt?.startsWith(key)).length };
    });

    return {
      total,
      active,
      interview,
      offers,
      companyCount,
      sharedCount,
      responseRate: percentage(progressed),
      offerRate: percentage(offers),
      funnel: [
        { label: "岗位记录", count: total, hint: "全部状态" },
        { label: "进入笔试", count: applications.filter((item) => item.status === "笔试" || INTERVIEW_STATUSES.includes(item.status) || item.status === "Offer").length, hint: "笔试及后续阶段" },
        { label: "进入面试", count: applications.filter((item) => INTERVIEW_STATUSES.includes(item.status) || item.status === "Offer").length, hint: "一面至 Offer" },
        { label: "获得 Offer", count: offers, hint: "录用结果" },
      ],
      statuses: KANBAN_COLUMNS.map((column) => ({ label: column.label, count: applications.filter((item) => column.statuses.includes(item.status)).length })),
      trend: sixMonths,
      dimensions: {
        channels: rank(applications.map((item) => item.channel ?? "")),
        locations: rank(applications.flatMap((item) => (item.base || "未填写").split(/[、,，/]/))),
        batches: rank(applications.map((item) => item.batch)),
        industries: rank(applications.flatMap((item) => {
          const tags = industryOnly(item.industryTags ?? []);
          return tags.length ? tags : ["未标注"];
        })),
        natures: rank(applications.map((item) => companyClassification(item.industryTags ?? []).companyNature || "未标注")),
        outcomes: rank(applications.filter((item) => CLOSED_STATUSES.includes(item.status)).map((item) => item.finalOutcome || item.rejectionReason || "未注明")),
      },
    };
  }, [applications]);

  const maxTrend = Math.max(...dashboard.trend.map((item) => item.count), 1);
  const maxFunnel = Math.max(dashboard.total, 1);
  const renderRanks = (title: string, subtitle: string, items: Array<{ label: string; count: number }>) => (
    <article className="dashboard-card dashboard-rank-card">
      <div className="dashboard-card-head"><div><span>{subtitle}</span><h3>{title}</h3></div></div>
      {items.length ? <div className="dashboard-bar-list">
        {items.map((item) => (
          <div className="dashboard-bar-row" key={item.label}>
            <strong title={item.label}>{item.label}</strong>
            <div><i style={{ width: `${dashboard.total ? Math.max((item.count / dashboard.total) * 100, 3) : 0}%` }} /></div>
            <b>{item.count}</b>
          </div>
        ))}
      </div> : <p className="dashboard-empty">暂无可分析的记录</p>}
    </article>
  );

  return (
    <section className="analytics-dashboard" aria-label="投递数据看板">
      <header className="dashboard-head">
        <div>
          <h2>投递数据看板</h2>
          <p>从投递节奏、流程推进和目标覆盖三个角度，查看当前求职进展。</p>
        </div>
        <div className="dashboard-actions">
          <div className="dashboard-range" aria-label="统计时间范围">
            {(["all", "90", "30"] as DashboardRange[]).map((value) => (
              <button key={value} type="button" className={range === value ? "active" : ""} onClick={() => onRangeChange(value)}>
                {value === "all" ? "全部" : `近 ${value} 天`}
              </button>
            ))}
          </div>
          <button type="button" className="secondary-button dashboard-list-button" onClick={onOpenApplications}>查看投递清单</button>
        </div>
      </header>

      {dashboard.total === 0 ? (
        <div className="dashboard-empty-state"><strong>这个时间范围内还没有投递记录</strong><span>切换统计范围，或回到投递清单新增第一条记录。</span></div>
      ) : <>
        <div className="dashboard-kpis">
          <article><span>岗位投递</span><strong>{dashboard.total}</strong><small>{dashboard.companyCount} 家公司</small></article>
          <article><span>活跃流程</span><strong>{dashboard.active}</strong><small>仍在持续推进</small></article>
          <article><span>面试阶段</span><strong>{dashboard.interview}</strong><small>一面至 HR 面</small></article>
          <article><span>Offer</span><strong>{dashboard.offers}</strong><small>Offer 率 {dashboard.offerRate}%</small></article>
          <article><span>流程推进率</span><strong>{dashboard.responseRate}%</strong><small>已走出简历阶段</small></article>
          <article><span>已共享记录</span><strong>{dashboard.sharedCount}</strong><small>可与搭子同步进展</small></article>
        </div>

        <div className="dashboard-grid dashboard-grid-primary">
          <article className="dashboard-card dashboard-funnel-card">
            <div className="dashboard-card-head"><div><span>流程转化</span><h3>从投递到 Offer</h3></div><small>按当前记录状态计算</small></div>
            <div className="dashboard-funnel-list">
              {dashboard.funnel.map((step) => (
                <div className="dashboard-funnel-row" key={step.label}>
                  <div><strong>{step.label}</strong><small>{step.hint}</small></div>
                  <div className="dashboard-funnel-track"><i style={{ width: `${Math.max((step.count / maxFunnel) * 100, step.count ? 7 : 0)}%` }} /></div>
                  <b>{step.count}<small>{dashboard.total ? ` · ${Math.round((step.count / dashboard.total) * 100)}%` : ""}</small></b>
                </div>
              ))}
            </div>
          </article>
          <article className="dashboard-card dashboard-status-card">
            <div className="dashboard-card-head"><div><span>当前分布</span><h3>流程状态</h3></div></div>
            <div className="dashboard-status-list">
              {dashboard.statuses.map((item) => (
                <div key={item.label}><span>{item.label}</span><strong>{item.count}</strong></div>
              ))}
            </div>
          </article>
        </div>

        <div className="dashboard-grid dashboard-grid-secondary">
          <article className="dashboard-card dashboard-trend-card">
            <div className="dashboard-card-head"><div><span>投递节奏</span><h3>近六个月趋势</h3></div><small>按投递日期汇总</small></div>
            <div className="dashboard-trend-bars">
              {dashboard.trend.map((item) => <div key={item.key}><strong>{item.count}</strong><i style={{ height: `${Math.max((item.count / maxTrend) * 100, item.count ? 8 : 0)}%` }} /><span>{item.label}</span></div>)}
            </div>
          </article>
          {renderRanks("投递渠道", "来源偏好", dashboard.dimensions.channels)}
          {renderRanks("目标地点", "地域覆盖", dashboard.dimensions.locations)}
        </div>

        <div className="dashboard-grid dashboard-grid-tertiary">
          {renderRanks("投递批次", "计划节奏", dashboard.dimensions.batches)}
          {renderRanks("行业方向", "目标赛道", dashboard.dimensions.industries)}
          {renderRanks("单位性质", "组织类型", dashboard.dimensions.natures)}
          {renderRanks("流程结论", "结束原因", dashboard.dimensions.outcomes)}
        </div>
      </>}
    </section>
  );
}

export function RecruitmentTracker({
  user,
  accessToken,
  signInPath,
  signOutPath,
  onSignOut,
}: Props) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [localBackup, setLocalBackup] = useState<Application[]>([]);
  const [ready, setReady] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [showProcessingHint, setShowProcessingHint] = useState(false);
  const [view, setView] = useState<WorkspaceView>("calendar");
  const [dashboardRange, setDashboardRange] = useState<DashboardRange>("all");
  const [listMode, setListMode] = useState<ListMode>("companyList");
  const [sortKey, setSortKey] = useState<SortKey>("appliedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("全部状态");
  const [batchFilter, setBatchFilter] = useState("全部批次");
  const [statFilter, setStatFilter] = useState<"all" | "active" | "interview" | "offer">("all");
  const [companyNatureFilter, setCompanyNatureFilter] = useState("全部单位性质");
  const [industryFilter, setIndustryFilter] = useState("全部行业方向");
  const [scaleFilter, setScaleFilter] = useState("全部规模");
  const [positionFilter, setPositionFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [editingCompanyName, setEditingCompanyName] = useState<string | null>(null);
  const [companyForm, setCompanyForm] = useState<CompanyFormState>(EMPTY_COMPANY_FORM);
  const [form, setForm] = useState(EMPTY_FORM);
  const [batchPositions, setBatchPositions] = useState<BatchPositionEntry[]>([{ position: "", base: "" }]);
  const [companyAutocompleteOpen, setCompanyAutocompleteOpen] = useState(false);
  const [positionAutocompleteIndex, setPositionAutocompleteIndex] = useState<number | "edit" | null>(null);
  const [baseAutocompleteIndex, setBaseAutocompleteIndex] = useState<number | "edit" | null>(null);
  const [channelAutocompleteOpen, setChannelAutocompleteOpen] = useState(false);
  const [selectedApplicationIds, setSelectedApplicationIds] = useState<string[]>([]);
  const [batchStatus, setBatchStatus] = useState<ApplicationStatus | "">("");
  const [batchCompanyNature, setBatchCompanyNature] = useState("");
  const [batchCompanySubtype, setBatchCompanySubtype] = useState("");
  const [batchVisibility, setBatchVisibility] = useState<Visibility | "">("");
  const [batchGroupId, setBatchGroupId] = useState("");
  const [batchFinalOutcome, setBatchFinalOutcome] = useState("");
  const [batchRejectionReason, setBatchRejectionReason] = useState("");

  useEffect(() => {
    const closeAutocompleteOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".autocomplete-field")) return;
      setCompanyAutocompleteOpen(false);
      setPositionAutocompleteIndex(null);
      setBaseAutocompleteIndex(null);
      setChannelAutocompleteOpen(false);
    };
    document.addEventListener("pointerdown", closeAutocompleteOnOutsidePointer, true);
    return () => {
      document.removeEventListener("pointerdown", closeAutocompleteOnOutsidePointer, true);
    };
  }, []);
  const [inlineStatusEditor, setInlineStatusEditor] = useState<{
    applicationId: string;
    status: "流程结束" | "已拒绝";
    finalOutcome: string;
    rejectionReason: string;
  } | null>(null);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [events, setEvents] = useState<RecruitmentEvent[]>([]);
  const [calendarReady, setCalendarReady] = useState(!user);
  const [notice, setNotice] = useState("");
  const [experiences, setExperiences] = useState<InterviewExperience[]>([]);
  const [experienceQuery, setExperienceQuery] = useState("");
  const [experienceApplicationFilter, setExperienceApplicationFilter] = useState("");
  const [experienceScope, setExperienceScope] = useState<"all" | "mine" | "friends">("mine");
  const [isExperienceOpen, setIsExperienceOpen] = useState(false);
  const [isCalendarEventOpen, setIsCalendarEventOpen] = useState(false);
  const [editingCalendarItem, setEditingCalendarItem] = useState<RecruitmentCalendarItem | null>(null);
  const [viewingFriendCalendarItem, setViewingFriendCalendarItem] = useState<RecruitmentCalendarItem | null>(null);
  const [calendarScope, setCalendarScope] = useState<"mine" | "friends">("mine");
  const [calendarEventForm, setCalendarEventForm] = useState<CalendarEventForm>(() => emptyCalendarEventForm());
  const [dismissedTodoKeys, setDismissedTodoKeys] = useState<string[]>([]);
  const [editingExperienceId, setEditingExperienceId] = useState<string | null>(null);
  const [experienceForm, setExperienceForm] = useState(EMPTY_EXPERIENCE);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [recoverySnapshots, setRecoverySnapshots] = useState<RecoverySnapshot[]>([]);
  const [groupName, setGroupName] = useState("秋招搭子小组");
  const [inviteCode, setInviteCode] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const inviteHandledRef = useRef(false);
  const busy = pendingAction !== null;
  const noticeTone = notice ? noticeToneFor(notice) : "info";
  const workspaceCacheKey = user ? `workspace-cache:${user.email}` : null;
  const recoveryOwnerKey = user?.email ?? "local";
  const todoDismissalsStorageKey = `${TODO_DISMISSALS_STORAGE_PREFIX}${recoveryOwnerKey}`;

  useEffect(() => {
    const timer = window.setTimeout(
      () => setShowProcessingHint(Boolean(pendingAction)),
      pendingAction ? 500 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [pendingAction]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), noticeTone === "error" ? 8_000 : 4_500);
    return () => window.clearTimeout(timer);
  }, [notice, noticeTone]);

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId) ?? null,
    [groups, activeGroupId],
  );

  const defaultGroupId = activeGroupId || groups[0]?.id || "";

  const cloudAction = useCallback(async (payload: Record<string, unknown>) => {
    let token = accessToken;
    if (!token) {
      const supabase = getSupabaseBrowserClient();
      const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
      token = data.session?.access_token ?? null;
    }
    const action = typeof payload.action === "string" ? payload.action : "";
    const maxAttempts = RETRYABLE_CLOUD_ACTIONS.has(action) ? 2 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        throw new Error("浏览器当前处于离线状态，数据没有提交到云端");
      }
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), CLOUD_REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch("/api/workspace", {
          method: "POST",
          headers: token
            ? { "content-type": "application/json", Authorization: `Bearer ${token}` }
            : { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
          cache: "no-store",
        });
        const responseText = await response.text();
        let result: { ok?: boolean; error?: string; message?: string } | null = null;
        if (responseText) {
          try {
            result = JSON.parse(responseText) as { ok?: boolean; error?: string; message?: string };
          } catch {
            // An HTML error page or damaged response is never treated as a successful save.
          }
        }
        if (!response.ok) {
          const reason = result?.error || result?.message || httpFailureReason(response.status);
          if (attempt < maxAttempts && (RETRYABLE_HTTP_STATUSES.has(response.status) || isTransientCloudFailure(reason))) {
            await waitForCloudRetry();
            continue;
          }
          const retried = attempt > 1 ? "（已自动重试 1 次）" : "";
          throw new Error(`${reason}${retried}`);
        }
        if (result?.ok !== true) {
          if (attempt < maxAttempts) {
            await waitForCloudRetry();
            continue;
          }
          throw new Error(result?.error || result?.message || "云端没有返回有效的保存确认，请刷新数据确认是否已生效");
        }
        return;
      } catch (error) {
        const timedOut = error instanceof Error && error.name === "AbortError";
        const networkFailed = error instanceof TypeError;
        if ((timedOut || networkFailed) && attempt < maxAttempts) {
          await waitForCloudRetry();
          continue;
        }
        if (timedOut) {
          const retried = attempt > 1 ? "，已自动重试 1 次" : "";
          throw new Error(`云端响应超过 ${CLOUD_REQUEST_TIMEOUT_MS / 1000} 秒${retried}；结果暂时无法确认，请刷新后检查`);
        }
        if (networkFailed) {
          const retried = attempt > 1 ? "（已自动重试 1 次）" : "";
          throw new Error(`网络连接仍不稳定${retried}，数据是否提交成功暂时无法确认，请刷新后检查`);
        }
        throw error;
      } finally {
        window.clearTimeout(timeout);
      }
    }
  }, [accessToken]);

  const runCloudMutation = useCallback(async (
    label: string,
    payload: Record<string, unknown>,
    keepPending = false,
  ) => {
    setNotice("");
    setPendingAction(label);
    try {
      await cloudAction(payload);
      setNotice(`${databaseActionName(label)}成功`);
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "请稍后重试";
      setNotice(`${databaseActionName(label)}失败：${detail}`);
      return false;
    } finally {
      if (!keepPending) setPendingAction(null);
    }
  }, [cloudAction]);

  const changeListMode = useCallback((mode: ListMode) => {
    setListMode(mode);
    try {
      localStorage.setItem(LIST_MODE_STORAGE_KEY, mode);
    } catch {
      // The preference is optional; the selected view still works for this visit.
    }
  }, []);

  const changeWorkspaceView = useCallback((nextView: WorkspaceView) => {
    setView(nextView);
    try {
      localStorage.setItem(WORKSPACE_VIEW_STORAGE_KEY, nextView);
    } catch {
      // The calendar remains the first-visit default when storage is unavailable.
    }
  }, []);

  const loadCloud = useCallback(async () => {
    let token = accessToken;
    if (!token) {
      const supabase = getSupabaseBrowserClient();
      const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
      token = data.session?.access_token ?? null;
    }
    if (!token) throw new Error("未登录");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CLOUD_REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch("/api/workspace", {
        method: "GET",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`云端同步超过 ${CLOUD_REQUEST_TIMEOUT_MS / 1000} 秒`);
      }
      if (error instanceof TypeError) throw new Error("网络连接不可用");
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
    const responseText = await response.text();
    let result: {
      applications?: unknown;
      interviews?: unknown;
      groups?: unknown;
      experiences?: unknown;
      events?: unknown;
      dismissedTodoKeys?: unknown;
      calendarReady?: unknown;
      error?: string;
      message?: string;
    } = {};
    if (responseText) {
      try {
        result = JSON.parse(responseText) as typeof result;
      } catch {
        throw new Error(response.ok ? "云端返回了无法识别的数据" : httpFailureReason(response.status));
      }
    }
    if (!response.ok) throw new Error(result.error || result.message || httpFailureReason(response.status));
    if (!safeApplications(result.applications)) throw new Error("投递数据解析失败");
    if (!safeInterviews(result.interviews)) throw new Error("面试数据解析失败");
    const experienceData = result.experiences ?? [];
    if (!safeExperiences(experienceData)) throw new Error("面经数据解析失败");
    const eventData = result.events ?? [];
    if (!safeRecruitmentEvents(eventData)) throw new Error("日程数据解析失败");
    const groupsData = (Array.isArray(result.groups) ? result.groups : []) as GroupInfo[];
    const normalizedApplications = result.applications.map((item) => ({
        ...item,
        visibility: item.visibility ?? "private",
        industryTags: Array.isArray(item.industryTags) ? item.industryTags.filter(Boolean) : [],
        companyScale: item.companyScale ?? "",
        isOwner: item.isOwner ?? true,
      }));
    const normalizedInterviews = normalizeInterviews(result.interviews);
    const normalizedExperiences = normalizeExperiences(experienceData);
    const normalizedEvents = normalizeRecruitmentEvents(eventData);
    const cloudDismissedTodoKeys = Array.isArray(result.dismissedTodoKeys) ? result.dismissedTodoKeys.filter((item): item is string => typeof item === "string") : [];
    let localDismissedTodoKeys: string[] = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(todoDismissalsStorageKey) ?? "[]") as unknown;
      if (Array.isArray(parsed)) localDismissedTodoKeys = parsed.filter((item): item is string => typeof item === "string");
    } catch {
      // Invalid preference cache does not block cloud data.
    }
    const mergedDismissedTodoKeys = [...new Set([...cloudDismissedTodoKeys, ...localDismissedTodoKeys])];
    if (workspaceCacheKey) {
      try {
        const cached = JSON.parse(localStorage.getItem(workspaceCacheKey) ?? "null") as { applications?: unknown; interviews?: unknown; experiences?: unknown; events?: unknown } | null;
        const cachedExperiences = cached?.experiences ?? [];
        const cachedEvents = cached?.events ?? [];
        if (cached && safeApplications(cached.applications) && safeInterviews(cached.interviews) && safeExperiences(cachedExperiences) && safeRecruitmentEvents(cachedEvents)) {
          const cachedOwnerIds = new Set(cached.applications.filter((item) => item.isOwner !== false).map((item) => item.id));
          void saveRecoverySnapshot(recoveryOwnerKey, {
            applications: cached.applications.filter((item) => item.isOwner !== false),
            interviews: cached.interviews.filter((item) => cachedOwnerIds.has(item.applicationId)),
            experiences: cachedExperiences.filter((item) => item.isOwner !== false && (!item.applicationId || cachedOwnerIds.has(item.applicationId))),
            events: cachedEvents.filter((item) => item.isOwner !== false && cachedOwnerIds.has(item.applicationId)),
          }).then(setRecoverySnapshots).catch(() => {});
        }
      } catch {
        // A malformed fast-start cache should never block the cloud workspace.
      }
    }
    setApplications(normalizedApplications);
    setInterviews(normalizedInterviews);
    setExperiences(normalizedExperiences);
    setEvents(normalizedEvents);
    setDismissedTodoKeys(mergedDismissedTodoKeys);
    try { localStorage.setItem(todoDismissalsStorageKey, JSON.stringify(mergedDismissedTodoKeys)); } catch { /* optional preference cache */ }
    setCalendarReady(result.calendarReady !== false);
    setGroups(groupsData);
    if (workspaceCacheKey) {
      try {
        localStorage.setItem(workspaceCacheKey, JSON.stringify({ applications: normalizedApplications, interviews: normalizedInterviews, experiences: normalizedExperiences, events: normalizedEvents, groups: groupsData }));
      } catch {
        // Storage is an optional fast-start cache.
      }
    }
    if (groupsData.length > 0) {
      const saved = localStorage.getItem("activeGroupId");
      const current = activeGroupId ? groupsData.find((g) => g.id === activeGroupId) : null;
      const found = saved ? groupsData.find((g) => g.id === saved) : null;
      if (!current) setActiveGroupId(found?.id ?? groupsData[0].id);
    } else {
      setActiveGroupId(null);
    }
    return groupsData;
  }, [accessToken, activeGroupId, workspaceCacheKey, recoveryOwnerKey, todoDismissalsStorageKey]);

  const loadLocal = useCallback(() => {
    try {
      const dismissed = JSON.parse(localStorage.getItem(todoDismissalsStorageKey) ?? "[]") as unknown;
      if (Array.isArray(dismissed)) setDismissedTodoKeys(dismissed.filter((item): item is string => typeof item === "string"));
      if (workspaceCacheKey) {
        const cached = localStorage.getItem(workspaceCacheKey);
        if (cached) {
          const parsed = JSON.parse(cached) as { applications?: unknown; interviews?: unknown; experiences?: unknown; events?: unknown; groups?: unknown };
          if (safeApplications(parsed.applications)) {
            const cachedApplications = parsed.applications.map((item) => ({
              ...item,
              visibility: item.visibility ?? "private",
              industryTags: Array.isArray(item.industryTags) ? item.industryTags.filter(Boolean) : [],
              companyScale: item.companyScale ?? "",
              isOwner: item.isOwner ?? true,
            }));
            setApplications(cachedApplications);
            setLocalBackup(cachedApplications);
          }
          if (safeInterviews(parsed.interviews)) setInterviews(normalizeInterviews(parsed.interviews));
          if (safeExperiences(parsed.experiences)) setExperiences(normalizeExperiences(parsed.experiences));
          if (safeRecruitmentEvents(parsed.events)) setEvents(normalizeRecruitmentEvents(parsed.events));
          if (Array.isArray(parsed.groups)) setGroups(parsed.groups as GroupInfo[]);
          return;
        }
      }
      const raw = localStorage.getItem("applications");
      const interviewsRaw = localStorage.getItem("interviews");
      const experiencesRaw = localStorage.getItem("interview-experiences");
      const eventsRaw = localStorage.getItem("recruitment-events");
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (safeApplications(parsed)) {
          setApplications(normalizeLocal(parsed));
          setLocalBackup(normalizeLocal(parsed));
        }
      }
      if (interviewsRaw) {
        const parsed = JSON.parse(interviewsRaw) as unknown;
        if (safeInterviews(parsed)) setInterviews(normalizeInterviews(parsed));
      }
      if (experiencesRaw) {
        const parsed = JSON.parse(experiencesRaw) as unknown;
        if (safeExperiences(parsed)) setExperiences(normalizeExperiences(parsed));
      }
      if (eventsRaw) {
        const parsed = JSON.parse(eventsRaw) as unknown;
        if (safeRecruitmentEvents(parsed)) setEvents(normalizeRecruitmentEvents(parsed));
      }
    } catch {
      // ignore
    }
  }, [todoDismissalsStorageKey, workspaceCacheKey]);

  const saveLocal = useCallback(
    (items: Application[]) => {
      try {
        localStorage.setItem("applications", JSON.stringify(items));
        setLocalBackup(items);
      } catch {
        setNotice("本地缓存保存失败，请立即导出 Excel 备份");
      }
    },
    [],
  );

  const saveInterviewsLocal = useCallback(
    (items: Interview[]) => {
      try {
        localStorage.setItem("interviews", JSON.stringify(items));
      } catch {
        setNotice("面试记录未保存到本地缓存，请立即导出 Excel 备份");
      }
    },
    [],
  );

  const saveExperiencesLocal = useCallback(
    (items: InterviewExperience[]) => {
      try {
        localStorage.setItem("interview-experiences", JSON.stringify(items));
      } catch {
        setNotice("面经未保存到本地缓存，请立即导出 Excel 备份");
      }
    },
    [],
  );

  const saveEventsLocal = useCallback(
    (items: RecruitmentEvent[]) => {
      try {
        localStorage.setItem("recruitment-events", JSON.stringify(items));
      } catch {
        setNotice("日程未保存到本地缓存，请立即导出 Excel 备份");
      }
    },
    [],
  );

  // ────────────────────────────────── lifecycle
  useEffect(() => {
    try {
      const savedView = localStorage.getItem(WORKSPACE_VIEW_STORAGE_KEY);
      if (["calendar", "mine", "friends", "sharing", "dashboard", "experiences"].includes(savedView ?? "")) setView(savedView as WorkspaceView);
    } catch {
      // Keep calendar as the first-visit default.
    }
  }, []);

  useEffect(() => {
    try {
      const savedMode = localStorage.getItem(LIST_MODE_STORAGE_KEY);
      if (LIST_MODE_OPTIONS.some((option) => option.value === savedMode)) {
        setListMode(savedMode as ListMode);
      }
    } catch {
      // Keep the compact company list when browser storage is unavailable.
    }
  }, []);

  useEffect(() => {
    loadLocal();
    if (user) {
      loadCloud()
        .then(() => setNotice("云端数据同步成功"))
        .catch((error) => {
          const detail = error instanceof Error ? error.message : "未知错误";
          setNotice(`云端数据同步失败：${detail}；已显示本机缓存`);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (user) return;
    if (applications === localBackup) return;
    saveLocal(applications);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applications]);

  useEffect(() => {
    if (user) return;
    saveInterviewsLocal(interviews);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviews]);
  useEffect(() => {
    if (user) return;
    saveExperiencesLocal(experiences);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experiences]);
  useEffect(() => {
    if (user) return;
    saveEventsLocal(events);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);


  useEffect(() => {
    if (ready) return;
    if (applications.length || localBackup.length) {
      setReady(true);
    }
  }, [applications, localBackup, ready]);

  useEffect(() => {
    if (inviteHandledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("invite");
    if (code) {
      inviteHandledRef.current = true;
      setInviteCode(code);
      setView("sharing");
    }
  }, []);

  useEffect(() => {
    if (activeGroupId) localStorage.setItem("activeGroupId", activeGroupId);
    else localStorage.removeItem("activeGroupId");
  }, [activeGroupId]);

  // ────────────────────────────────── derived data
  const ownApplications = useMemo(
    () => applications.filter((item) => item.isOwner !== false),
    [applications],
  );
  const schedulableApplications = useMemo(
    () => ownApplications.filter((item) => !CLOSED_STATUSES.includes(item.status)),
    [ownApplications],
  );
  const calendarApplicationOptions = useMemo(
    () => ownApplications.filter((item) => !CLOSED_STATUSES.includes(item.status) || item.id === editingCalendarItem?.applicationId),
    [editingCalendarItem?.applicationId, ownApplications],
  );

  const dashboardApplications = useMemo(() => {
    if (dashboardRange === "all") return ownApplications;
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - Number(dashboardRange));
    const cutoffValue = cutoff.toISOString().slice(0, 10);
    return ownApplications.filter((item) => item.appliedAt && item.appliedAt >= cutoffValue);
  }, [dashboardRange, ownApplications]);

  const friendApplications = useMemo(
    () => applications.filter((item) => item.isOwner === false),
    [applications],
  );

  const calendarItems = useMemo<RecruitmentCalendarItem[]>(() => {
    const applicationMap = new Map(ownApplications.map((item) => [item.id, item]));
    const interviewItems = interviews.flatMap((item) => {
      const application = applicationMap.get(item.applicationId);
      if (!application) return [];
      return [{
        source: "interview" as const,
        id: item.id,
        applicationId: item.applicationId,
        kind: "interview" as const,
        timingType: "scheduled" as const,
        title: item.round || "面试",
        company: application.company,
        position: application.position,
        startsAt: item.scheduledAt,
        endsAt: item.endedAt ?? "",
        allDay: false,
        mode: item.format ?? "",
        location: item.location ?? "",
        eventUrl: item.eventUrl ?? "",
        status: item.result || "待定",
        ownerName: "我",
        ownerEmail: user?.email ?? "",
        isOwner: true,
      }];
    });
    const otherItems = events.flatMap((item) => {
      const application = applicationMap.get(item.applicationId);
      if (!application || item.isOwner === false) return [];
      return [{
        source: "event" as const,
        id: item.id,
        applicationId: item.applicationId,
        kind: item.eventType,
        timingType: item.timingType === "deadline" ? "deadline" as const : "scheduled" as const,
        title: item.title || calendarKindLabel(item.eventType),
        company: application.company,
        position: application.position,
        startsAt: item.startsAt,
        endsAt: item.endsAt ?? "",
        allDay: item.allDay,
        mode: item.mode,
        location: item.location,
        eventUrl: item.eventUrl,
        status: item.status,
        ownerName: "我",
        ownerEmail: user?.email ?? "",
        isOwner: true,
      }];
    });
    return [...interviewItems, ...otherItems].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [events, interviews, ownApplications, user?.email]);

  const friendCalendarApplications = useMemo(
    () => friendApplications.filter((item) => item.visibility === "full" && (!activeGroupId || item.groupId === activeGroupId)),
    [activeGroupId, friendApplications],
  );
  const friendCalendarItems = useMemo<RecruitmentCalendarItem[]>(() => {
    const applicationMap = new Map(friendCalendarApplications.map((item) => [item.id, item]));
    const interviewItems = interviews.flatMap((item) => {
      const application = applicationMap.get(item.applicationId);
      if (!application) return [];
      return [{
        source: "interview" as const,
        id: item.id,
        applicationId: item.applicationId,
        kind: "interview" as const,
        timingType: "scheduled" as const,
        title: item.round || "面试",
        company: application.company,
        position: application.position,
        startsAt: item.scheduledAt,
        endsAt: item.endedAt ?? "",
        allDay: false,
        mode: item.format ?? "",
        location: item.location ?? "",
        eventUrl: item.eventUrl ?? "",
        status: item.result || "未开始",
        ownerName: application.ownerName || "好友",
        ownerEmail: application.ownerEmail || application.ownerName || "好友",
        isOwner: false,
      }];
    });
    const otherItems = events.flatMap((item) => {
      const application = applicationMap.get(item.applicationId);
      if (!application || item.isOwner !== false) return [];
      return [{
        source: "event" as const,
        id: item.id,
        applicationId: item.applicationId,
        kind: item.eventType,
        timingType: item.timingType === "deadline" ? "deadline" as const : "scheduled" as const,
        title: item.title || calendarKindLabel(item.eventType),
        company: application.company,
        position: application.position,
        startsAt: item.startsAt,
        endsAt: item.endsAt ?? "",
        allDay: item.allDay,
        mode: item.mode,
        location: item.location,
        eventUrl: item.eventUrl,
        status: item.status,
        ownerName: application.ownerName || "好友",
        ownerEmail: application.ownerEmail || application.ownerName || "好友",
        isOwner: false,
      }];
    });
    return [...interviewItems, ...otherItems].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [events, friendCalendarApplications, interviews]);
  const friendCalendarOwnerCount = useMemo(
    () => new Set(friendCalendarApplications.map((item) => item.ownerEmail || item.ownerName).filter(Boolean)).size,
    [friendCalendarApplications],
  );

  const editingCalendarInterview = editingCalendarItem?.source === "interview"
    ? interviews.find((item) => item.id === editingCalendarItem.id)
    : undefined;
  const editingCalendarInterviewHasExperience = editingCalendarInterview
    ? experiences.some((experience) =>
        experience.isOwner !== false && (
          experience.interviewId === editingCalendarInterview.id ||
          (!experience.interviewId && experience.applicationId === editingCalendarInterview.applicationId && interviewStage(experience.round) === interviewStage(editingCalendarInterview.round))
        ),
      )
    : false;
  const editingCalendarInterviewStoredCompleted = editingCalendarInterview ? !isScheduledInterview(editingCalendarInterview) : false;

  const filteredExperiences = useMemo(() => {
    const keyword = experienceQuery.trim();
    return [...experiences]
      .filter((item) => experienceScope === "all" || (experienceScope === "mine" ? item.isOwner !== false : item.isOwner === false))
      .filter((item) => !experienceApplicationFilter || item.applicationId === experienceApplicationFilter)
      .filter((item) => !keyword || matchesFieldsSearch([item.title, item.company, item.position, item.round], keyword) || matchesLiteralSearch(`${item.content} ${item.takeaway}`, keyword))
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }, [experiences, experienceQuery, experienceApplicationFilter, experienceScope]);

  const importDuplicateCount = useMemo(() => {
    if (!importPreview) return 0;
    const existingIds = new Set(ownApplications.map((item) => item.id));
    const existingKeys = new Set(ownApplications.map(applicationImportKey));
    const seenKeys = new Set<string>();
    return importPreview.applications.reduce((count, item) => {
      const key = applicationImportKey(item);
      const duplicate = existingIds.has(item.id) || existingKeys.has(key) || seenKeys.has(key);
      seenKeys.add(key);
      return count + Number(duplicate);
    }, 0);
  }, [importPreview, ownApplications]);

  const industryOptions = useMemo(
    () => [...new Set([...INDUSTRY_OPTIONS, ...applications.flatMap((item) => industryOnly(item.industryTags ?? []))])].filter(Boolean),
    [applications],
  );

  const companySuggestions = useMemo(() => {
    const uniqueCompanies = [...new Map(ownApplications.map((item) => [companyKey(item.company), item])).values()];
    return uniqueCompanies
      .map((item) => ({ item, score: autocompleteScore(item.company, form.company) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || (b.item.updatedAt ?? "").localeCompare(a.item.updatedAt ?? ""))
      .slice(0, 6)
      .map(({ item }) => item);
  }, [ownApplications, form.company]);

  const positionSuggestions = useMemo(() => {
    const candidates = [...new Map(ownApplications.map((item) => [`${companyKey(item.company)}|${item.position.trim().toLocaleLowerCase()}`, item])).values()];
    const search = (value: string) => candidates
      .map((item) => ({ item, score: autocompleteScore(item.position, value) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => {
        const companyBoost = form.company.trim() && companyKey(a.item.company) === companyKey(form.company) ? 1 : 0;
        const otherCompanyBoost = form.company.trim() && companyKey(b.item.company) === companyKey(form.company) ? 1 : 0;
        return otherCompanyBoost - companyBoost || b.score - a.score || (b.item.updatedAt ?? "").localeCompare(a.item.updatedAt ?? "");
      })
      .slice(0, 6)
      .map(({ item }) => item);
    return { search };
  }, [ownApplications, form.company]);

  const companyNatureOptions = useMemo(
    () => [...new Set([
      ...COMPANY_NATURE_OPTIONS.map((option) => option.value),
      ...applications.map((item) => companyClassification(item.industryTags ?? []).companyNature).filter(Boolean),
    ])],
    [applications],
  );

  const companyScaleOptions = useMemo(
    () => [...new Set([...COMPANY_SCALE_OPTIONS, ...applications.map((item) => item.companyScale).filter(Boolean)])],
    [applications],
  );

  const baseOptions = useMemo(
    () => [...new Set([...BASE_OPTIONS, ...applications.map((item) => item.base).filter(Boolean)])],
    [applications],
  );

  const platformOptions = useMemo(
    () => [...new Set([...PLATFORM_OPTIONS, ...applications.map((item) => item.channel).filter(Boolean)])],
    [applications],
  );

  const stats = useMemo(() => {
    const total = ownApplications.length;
    const active = ownApplications.filter((a) => !["已拒绝", "流程结束", "Offer"].includes(a.status)).length;
    const interview = ownApplications.filter((a) => INTERVIEW_STATUSES.includes(a.status)).length;
    const offers = ownApplications.filter((a) => a.status === "Offer").length;
    return { total, active, interview, offers };
  }, [ownApplications]);

  const filtered = useMemo(() => {
    const source = view === "friends" ? friendApplications : ownApplications;
    let items = source;
    if (statFilter === "active") items = items.filter((item) => !["\u5df2\u62d2\u7edd", "\u6d41\u7a0b\u7ed3\u675f", "Offer"].includes(item.status));
    if (statFilter === "interview") items = items.filter((item) => INTERVIEW_STATUSES.includes(item.status));
    if (statFilter === "offer") items = items.filter((item) => item.status === "Offer");
    if (query.trim()) {
      const q = query.trim();
      items = items.filter((item) => matchesFieldsSearch([item.company, item.position, item.base ?? ""], q));
    }
    if (statusFilter !== "全部状态") items = items.filter((item) => matchesStatusFilter(item.status, statusFilter));
    if (batchFilter !== "全部批次") items = items.filter((item) => item.batch === batchFilter);
    if (companyNatureFilter !== "全部单位性质") items = items.filter((item) => companyClassification(item.industryTags ?? []).companyNature === companyNatureFilter);
    if (industryFilter !== "全部行业方向") items = items.filter((item) => industryOnly(item.industryTags ?? []).includes(industryFilter));
    if (scaleFilter !== "全部规模") items = items.filter((item) => item.companyScale === scaleFilter);
    if (positionFilter) items = items.filter((item) => matchesTextSearch(item.position, positionFilter));
    if (locationFilter) items = items.filter((item) => matchesTextSearch(item.base ?? "", locationFilter));
    return items.slice().sort((a, b) => {
      const result = compareApplications(a, b, sortKey);
      return sortDirection === "asc" ? result : -result;
    });
  }, [query, statusFilter, statFilter, batchFilter, companyNatureFilter, industryFilter, scaleFilter, positionFilter, locationFilter, view, ownApplications, friendApplications, sortKey, sortDirection]);

  const activeFilterCount = useMemo(() => [
    query.trim(),
    statusFilter !== "全部状态",
    batchFilter !== "全部批次",
    statFilter !== "all",
    companyNatureFilter !== "全部单位性质",
    industryFilter !== "全部行业方向",
    scaleFilter !== "全部规模",
    positionFilter.trim(),
    locationFilter.trim(),
  ].filter(Boolean).length, [query, statusFilter, statFilter, batchFilter, companyNatureFilter, industryFilter, scaleFilter, positionFilter, locationFilter]);
  const interviewWorkspaceActive = statFilter === "interview" || statusFilter === "面试进行中";

  const quickStatusCounts = useMemo(() => {
    const source = view === "friends" ? friendApplications : ownApplications;
    return new Map(QUICK_STATUS_FILTERS.map((filter) => [filter, source.filter((item) => matchesStatusFilter(item.status, filter)).length]));
  }, [view, ownApplications, friendApplications]);

  const filteredIds = useMemo(() => filtered.map((item) => item.id), [filtered]);
  const selectedFilteredCount = useMemo(
    () => filteredIds.filter((id) => selectedApplicationIds.includes(id)).length,
    [filteredIds, selectedApplicationIds],
  );
  const allFilteredSelected = filteredIds.length > 0 && selectedFilteredCount === filteredIds.length;
  const partiallyFilteredSelected = selectedFilteredCount > 0 && !allFilteredSelected;

  const toggleFilteredSelection = useCallback(() => {
    setSelectedApplicationIds((current) => {
      const selected = new Set(current);
      if (filteredIds.every((id) => selected.has(id))) {
        return current.filter((id) => !filteredIds.includes(id));
      }
      return [...new Set([...current, ...filteredIds])];
    });
  }, [filteredIds]);

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = partiallyFilteredSelected;
  }, [partiallyFilteredSelected, listMode]);

  // ────────────────────────────────── company grouping
  const companyGrouped = useMemo(() => {
    const map = new Map<string, Application[]>();
    for (const item of filtered) {
      const key = companyKey(item.company);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries())
      .map(([key, apps]) => {
        const latest = apps.slice().sort((a, b) => (b.appliedAt || "").localeCompare(a.appliedAt || ""))[0];
        return {
          key,
          company: apps[0].company,
          applications: apps,
          industryTags: [...new Set(apps.flatMap((app) => industryOnly(app.industryTags ?? [])))],
          companyNature: companyClassification(apps[0].industryTags ?? []).companyNature,
          companySubtype: companyClassification(apps[0].industryTags ?? []).companySubtype,
          companyScale: apps.find((app) => app.companyScale)?.companyScale ?? "",
          bases: [...new Set(apps.map((app) => app.base).filter(Boolean))],
          latestAppliedAt: latest?.appliedAt ?? "",
          statuses: [...new Set(apps.map((app) => app.status))],
          conclusions: [...new Set(apps.flatMap((app) => [app.finalOutcome, app.rejectionReason]).filter(Boolean))],
          visibilities: [...new Set(apps.map((app) => app.visibility))],
          sharedCount: apps.filter((app) => app.visibility !== "private").length,
        };
      })
      .sort((a, b) => {
        if (sortKey === "company") {
          const result = a.company.localeCompare(b.company, "zh-CN");
          return sortDirection === "asc" ? result : -result;
        }
        return compareApplications(a.applications[0], b.applications[0], sortKey) * (sortDirection === "asc" ? 1 : -1);
      });
  }, [filtered, sortKey, sortDirection]);

  const listInsights = useMemo(() => {
    const total = filtered.length;
    const companyCount = new Set(filtered.map((item) => companyKey(item.company))).size;
    const interviewCount = filtered.filter((item) => INTERVIEW_STATUSES.includes(item.status)).length;
    const offerCount = filtered.filter((item) => item.status === "Offer").length;
    const sharedCount = filtered.filter((item) => item.visibility !== "private").length;
    const rate = (count: number) => total ? Math.round((count / total) * 100) : 0;

    return [
      { label: "公司总数", value: companyCount, unit: "家", detail: `覆盖 ${total} 个岗位`, progress: total ? 100 : 0, color: "#5c9874" },
      { label: "面试进行中", value: interviewCount, unit: "个", detail: `占全部岗位 ${rate(interviewCount)}%`, progress: rate(interviewCount), color: "#6589b2" },
      { label: "已拿 Offer", value: offerCount, unit: "个", detail: `占全部岗位 ${rate(offerCount)}%`, progress: rate(offerCount), color: "#d49743" },
      { label: "已共享给搭子", value: sharedCount, unit: "个", detail: `占全部岗位 ${rate(sharedCount)}%`, progress: rate(sharedCount), color: "#9b6b9c" },
    ];
  }, [filtered]);

  const actionReminders = useMemo(() => {
    const now = Date.now();
    const appById = new Map(ownApplications.map((item) => [item.id, item]));
    const upcomingApplicationIds = new Set<string>();
    const interviewFollowUpApplicationIds = new Set<string>();
    const reminders: Array<{
      id: string;
      kind: "upcoming" | "experience" | "result" | "event" | "stale";
      label: string;
      title: string;
      detail: string;
      priority: number;
      application: Application;
      interview?: Interview;
      calendarItem?: RecruitmentCalendarItem;
    }> = [];

    for (const interview of interviews) {
      const application = appById.get(interview.applicationId);
      if (!application) continue;
      const scheduledAt = new Date(interview.scheduledAt).getTime();
      if (!Number.isFinite(scheduledAt)) continue;
      const daysAway = (scheduledAt - now) / 86_400_000;
      const recordedEnd = new Date(interview.endedAt).getTime();
      const followUpAt = Number.isFinite(recordedEnd) ? recordedEnd : scheduledAt + 2 * 60 * 60 * 1000;
      const daysSinceFollowUp = (now - followUpAt) / 86_400_000;
      if (daysAway >= 0 && daysAway <= 14) {
        upcomingApplicationIds.add(application.id);
        interviewFollowUpApplicationIds.add(application.id);
        reminders.push({
          id: `upcoming-${interview.id}`,
          kind: "upcoming",
          label: "待面试",
          title: `${application.company} · ${interview.round || "面试"}`,
          detail: `${formatDateTime(interview.scheduledAt)} · ${application.position}`,
          priority: scheduledAt,
          application,
          interview,
          calendarItem: calendarItems.find((item) => item.source === "interview" && item.id === interview.id),
        });
      } else if (daysSinceFollowUp >= 0 && daysSinceFollowUp <= 30) {
        const hasLinkedExperience = experiences.some((experience) =>
          experience.isOwner !== false && (
            (experience.interviewId && experience.interviewId === interview.id) ||
            (!experience.interviewId && experience.applicationId === interview.applicationId && interviewStage(experience.round) === interviewStage(interview.round))
          ),
        );

        if (!hasLinkedExperience) {
          interviewFollowUpApplicationIds.add(application.id);
          reminders.push({
            id: `experience-${interview.id}`,
            kind: "experience",
            label: "待补面经",
            title: `${application.company} · ${interview.round || "面试"}`,
            detail: `${formatDateTime(interview.endedAt || interview.scheduledAt)} · 补充面试复盘`,
            priority: now + 500_000_000 + Math.abs(followUpAt - now),
            application,
            interview,
          });
        } else if (!interview.result || interview.result === "待定" || interview.result === "未开始") {
          interviewFollowUpApplicationIds.add(application.id);
          reminders.push({
            id: `result-${interview.id}`,
            kind: "result",
            label: "待补结果",
            title: `${application.company} · ${interview.round || "面试"}`,
            detail: `${formatDateTime(interview.scheduledAt)} · 记录面试结果`,
            priority: now + 1_000_000_000 + Math.abs(followUpAt - now),
            application,
            interview,
          });
        }
      }
    }

    for (const application of ownApplications) {
      if (!INTERVIEW_STATUSES.includes(application.status)) continue;
      const currentStage = interviewStage(application.status);
      const hasCurrentInterview = interviews.some((interview) =>
        interview.applicationId === application.id && interviewStage(interview.round) === currentStage,
      );
      if (hasCurrentInterview) continue;
      interviewFollowUpApplicationIds.add(application.id);
      reminders.push({
        id: `missing-interview-${application.id}-${currentStage}`,
        kind: "upcoming",
        label: "待补面试安排",
        title: `${application.company} · ${application.status}`,
        detail: `${application.position} · 补充本轮面试日期和形式`,
        priority: now + 250_000_000,
        application,
      });
    }

    for (const calendarItem of calendarItems.filter((item) => item.source === "event" && item.status !== "已取消" && item.status !== "已完成")) {
      const application = appById.get(calendarItem.applicationId);
      if (!application) continue;
      const startsAt = new Date(calendarItem.startsAt).getTime();
      if (!Number.isFinite(startsAt)) continue;
      const daysAway = (startsAt - now) / 86_400_000;
      if (daysAway >= -30 && daysAway <= 14) {
        upcomingApplicationIds.add(application.id);
        reminders.push({
          id: `calendar-${calendarItem.id}`,
          kind: "event",
          label: calendarItem.kind === "written_test" && calendarItem.timingType === "deadline"
            ? (daysAway < 0 ? "笔试截止时间已过" : "笔试即将截止")
            : daysAway < 0 ? "日程已过期" : `即将${calendarKindLabel(calendarItem.kind)}`,
          title: `${application.company} · ${calendarItem.title}`,
          detail: `${formatDateTime(calendarItem.startsAt)} · ${application.position}`,
          priority: daysAway < 0 ? now - startsAt : startsAt,
          application,
          calendarItem,
        });
      }
    }

    for (const application of ownApplications) {
      if ([...CLOSED_STATUSES, "Offer"].includes(application.status) || upcomingApplicationIds.has(application.id) || interviewFollowUpApplicationIds.has(application.id)) continue;
      const lastTouched = new Date(application.updatedAt || `${application.appliedAt}T00:00:00`).getTime();
      const staleDays = Math.floor((now - lastTouched) / 86_400_000);
      if (Number.isFinite(lastTouched) && staleDays >= 7) {
        reminders.push({
          id: `stale-${application.id}`,
          kind: "stale",
          label: `${staleDays} 天未更新`,
          title: `${application.company} · ${application.position}`,
          detail: `当前进度：${application.status}，建议确认后续安排`,
          priority: now + 2_000_000_000 - staleDays,
          application,
        });
      }
    }

    return reminders.sort((a, b) => a.priority - b.priority).slice(0, 6);
  }, [calendarItems, ownApplications, interviews, experiences]);

  const calendarTodos = useMemo<CalendarTodoEntry[]>(() => {
    const now = Date.now();
    const applicationMap = new Map(ownApplications.map((item) => [item.id, item]));
    const calendarItemMap = new Map(calendarItems.map((item) => [`${item.source}-${item.id}`, item]));
    const todos: CalendarTodoEntry[] = [];

    for (const application of ownApplications) {
      if (!INTERVIEW_STATUSES.includes(application.status)) continue;
      const stage = interviewStage(application.status);
      const currentInterview = interviews.find((interview) =>
        interview.applicationId === application.id && interviewStage(interview.round) === stage,
      );
      if (!currentInterview) {
        todos.push({
          id: `todo-missing-${application.id}-${stage}`,
          dismissKey: `todo-missing-${application.id}-${stage}@${application.updatedAt}`,
          tone: "missing",
          label: "待定面试",
          title: `${application.company} · ${application.status}`,
          detail: `${application.position} · 还没有填写本轮面试时间`,
          scheduledAt: "",
          priority: 40_000_000_000_000,
          action: "scheduleInterview",
          application,
        });
      }
    }

    for (const interview of interviews) {
      const application = applicationMap.get(interview.applicationId);
      if (!application) continue;
      const scheduledAt = new Date(interview.scheduledAt).getTime();
      if (!Number.isFinite(scheduledAt) || interview.result === "未参加") continue;
      const calendarItem = calendarItemMap.get(`interview-${interview.id}`);
      const hasExperience = experiences.some((experience) =>
        experience.isOwner !== false && (
          experience.interviewId === interview.id ||
          (!experience.interviewId && experience.applicationId === interview.applicationId && interviewStage(experience.round) === interviewStage(interview.round))
        ),
      );
      const recordedEnd = new Date(interview.endedAt).getTime();
      const finishedAt = Number.isFinite(recordedEnd) ? recordedEnd : scheduledAt + 2 * 60 * 60 * 1000;
      if (finishedAt > now && calendarItem) {
        todos.push({
          id: `todo-interview-${interview.id}`,
          dismissKey: `todo-interview-${interview.id}@${interview.updatedAt}`,
          tone: "upcoming",
          label: scheduledAt <= now ? "面试进行中" : "待参加面试",
          title: `${application.company} · ${interview.round || "面试"}`,
          detail: `${application.position}${interview.format ? ` · ${interview.format}` : ""}`,
          scheduledAt: interview.scheduledAt,
          priority: 50_000_000_000_000 + scheduledAt,
          action: "editSchedule",
          application,
          interview,
          calendarItem,
        });
      } else if (finishedAt <= now && !hasExperience) {
        todos.push({
          id: `todo-experience-${interview.id}`,
          dismissKey: `todo-experience-${interview.id}@${interview.updatedAt}`,
          tone: "followup",
          label: "待补面经",
          title: `${application.company} · ${interview.round || "面试"}`,
          detail: `${application.position} · 面试已结束，趁记忆清晰完成复盘`,
          scheduledAt: interview.endedAt || interview.scheduledAt,
          priority: 20_000_000_000_000 - Math.max(finishedAt, 0),
          action: "writeExperience",
          application,
          interview,
          calendarItem,
        });
      } else if (finishedAt <= now && (!interview.result || interview.result === "待定" || interview.result === "未开始") && calendarItem) {
        todos.push({
          id: `todo-result-${interview.id}`,
          dismissKey: `todo-result-${interview.id}@${interview.updatedAt}`,
          tone: "followup",
          label: "待补面试结果",
          title: `${application.company} · ${interview.round || "面试"}`,
          detail: `${application.position} · 面经已记录，补充本轮结果`,
          scheduledAt: interview.endedAt || interview.scheduledAt,
          priority: 30_000_000_000_000 - Math.max(finishedAt, 0),
          action: "editSchedule",
          application,
          interview,
          calendarItem,
        });
      }
    }

    for (const event of events) {
      if (event.isOwner === false || event.status !== "待进行") continue;
      const application = applicationMap.get(event.applicationId);
      const calendarItem = calendarItemMap.get(`event-${event.id}`);
      const startsAt = new Date(event.startsAt).getTime();
      if (!application || !calendarItem || !Number.isFinite(startsAt)) continue;
      const overdue = startsAt < now;
      todos.push({
        id: `todo-event-${event.id}`,
        dismissKey: `todo-event-${event.id}@${event.updatedAt}`,
        tone: overdue ? "overdue" : "upcoming",
        label: event.eventType === "written_test" && event.timingType === "deadline"
          ? (overdue ? "笔试截止时间已过" : "笔试待截止")
          : overdue ? `${calendarKindLabel(event.eventType)}已到期` : `待${calendarKindLabel(event.eventType)}`,
        title: `${application.company} · ${event.title}`,
        detail: `${application.position}${event.timingType === "deadline" ? " · 截止前完成" : event.mode ? ` · ${event.mode}` : ""}`,
        scheduledAt: event.startsAt,
        priority: overdue ? 10_000_000_000_000 - Math.max(startsAt, 0) : 50_000_000_000_000 + startsAt,
        action: "editSchedule",
        application,
        calendarItem,
        canComplete: true,
      });
    }

    return todos.filter((todo) => !dismissedTodoKeys.includes(todo.dismissKey)).sort((a, b) => a.priority - b.priority);
  }, [calendarItems, dismissedTodoKeys, events, experiences, interviews, ownApplications]);

  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection(key === "appliedAt" ? "desc" : "asc");
    }
  }, [sortKey]);

  const sortIndicator = useCallback((key: SortKey) => {
    if (sortKey !== key) return "↕";
    return sortDirection === "asc" ? "↑" : "↓";
  }, [sortKey, sortDirection]);

  // ────────────────────────────────── actions
  const addApplication = useCallback(
    async (item: Application) => {
      if (user) {
        const saved = await runCloudMutation("保存投递信息中", { action: "saveApplication", application: item });
        if (!saved) return false;
      }
      setApplications((prev) => [...prev, item]);
      setNotice("投递记录已保存");
      return true;
    },
    [user, runCloudMutation],
  );

  const addApplications = useCallback(
    async (items: Application[]) => {
      if (user) {
        const saved = await runCloudMutation("批量保存投递信息中", { action: "importApplications", applications: items });
        if (!saved) return false;
      }
      setApplications((prev) => [...prev, ...items]);
      setNotice(`已保存 ${items.length} 个岗位`);
      return true;
    },
    [user, runCloudMutation],
  );

  const updateApplication = useCallback(
    async (id: string, changes: Partial<Application>) => {
      const current = applications.find((item) => item.id === id);
      if (!current) {
        setNotice("保存修改失败：岗位记录不存在或已被删除，请刷新后重试");
        return false;
      }
      const next = { ...current, ...changes, updatedAt: new Date().toISOString() };
      if (user) {
        const saved = await runCloudMutation("保存修改中", { action: "saveApplication", application: next });
        if (!saved) return false;
      }
      setApplications((prev) => prev.map((item) => (item.id === id ? next : item)));
      setNotice("修改已保存");
      return true;
    },
    [applications, user, runCloudMutation],
  );

  const removeApplication = useCallback(
    async (item: Application) => {
      if (!confirm(`确定删除 ${item.company} - ${item.position} 的投递记录吗？`)) return;
      if (user) {
        const removed = await runCloudMutation("删除投递记录中", { action: "deleteApplication", id: item.id });
        if (!removed) return;
      }
      setApplications((prev) => prev.filter((entry) => entry.id !== item.id));
      setInterviews((prev) => prev.filter((entry) => entry.applicationId !== item.id));
      setEvents((prev) => prev.filter((entry) => entry.applicationId !== item.id));
      setNotice("投递记录已删除");
    },
    [user, runCloudMutation],
  );

  const updateStatus = useCallback(
    async (id: string, status: ApplicationStatus) => {
      const current = applications.find((item) => item.id === id);
      if (!current) {
        setNotice("更新面试进度失败：岗位记录不存在或已被删除，请刷新后重试");
        return;
      }
      if (user) {
        const saved = await runCloudMutation("更新面试进度中", {
          action: "updateStatus",
          id,
          status,
          note: current.note,
          finalOutcome: "",
          rejectionReason: "",
        });
        if (!saved) return;
      }
      setApplications((prev) => prev.map((item) => (item.id === id ? { ...item, status, finalOutcome: "", rejectionReason: "" } : item)));
      setNotice("进度已更新");
    },
    [applications, user, runCloudMutation],
  );

  const chooseStatus = useCallback((item: Application, status: ApplicationStatus) => {
    if (status === "流程结束" || status === "已拒绝") {
      setInlineStatusEditor({
        applicationId: item.id,
        status,
        finalOutcome: item.finalOutcome ?? "",
        rejectionReason: item.rejectionReason ?? "",
      });
      return;
    }
    void updateStatus(item.id, status);
  }, [updateStatus]);

  const saveInlineStatus = useCallback(async () => {
    if (!inlineStatusEditor) return;
    if (inlineStatusEditor.status === "流程结束" && !inlineStatusEditor.finalOutcome) {
      setNotice("请选择流程最终走到的状态");
      return;
    }
    if (inlineStatusEditor.status === "已拒绝" && !inlineStatusEditor.rejectionReason.trim()) {
      setNotice("请填写拒绝原因");
      return;
    }
    const saved = await updateApplication(inlineStatusEditor.applicationId, {
      status: inlineStatusEditor.status,
      finalOutcome: inlineStatusEditor.status === "流程结束" ? inlineStatusEditor.finalOutcome : "",
      rejectionReason: inlineStatusEditor.status === "已拒绝" ? inlineStatusEditor.rejectionReason.trim() : "",
    });
    if (saved) setInlineStatusEditor(null);
  }, [inlineStatusEditor, updateApplication]);

  const renderStatusControl = (item: Application, compact = false) => {
    const editor = inlineStatusEditor?.applicationId === item.id ? inlineStatusEditor : null;
    if (view !== "mine") return <span className={`status-badge ${statusTone(item.status)}`}>{item.status}</span>;
    if (editor) {
      return (
        <div className={`inline-status-editor ${compact ? "compact" : ""}`}>
          <span className={`status-badge ${statusTone(editor.status)}`}>{editor.status}</span>
          {editor.status === "流程结束" ? (
            <DropdownSelect
              value={editor.finalOutcome}
              onChange={(finalOutcome) => setInlineStatusEditor((current) => current ? { ...current, finalOutcome } : current)}
              options={FINAL_OUTCOME_OPTIONS.map((option) => ({ value: option, label: option }))}
              placeholder="选择最终状态"
              ariaLabel="选择流程最终状态"
            />
          ) : (
            <input
              list="rejection-reason-options"
              value={editor.rejectionReason}
              onChange={(event) => setInlineStatusEditor((current) => current ? { ...current, rejectionReason: event.target.value } : current)}
              placeholder="填写拒绝原因"
              aria-label="填写拒绝原因"
            />
          )}
          <div className="inline-status-actions">
            <button type="button" className="inline-save-button" onClick={() => void saveInlineStatus()} disabled={busy}>保存</button>
            <button type="button" className="inline-cancel-button" onClick={() => setInlineStatusEditor(null)} disabled={busy}>取消</button>
          </div>
        </div>
      );
    }
    return <DropdownSelect
      className={`status-select ${statusTone(item.status)}`}
      value={item.status}
      onChange={(status) => chooseStatus(item, status as ApplicationStatus)}
      options={STATUSES.map((status) => ({ value: status, label: status }))}
      disabled={busy}
      ariaLabel={`修改 ${item.company} ${item.position} 的进度`}
    />;
  };

  const renderExperienceLink = (item: Application, compact = false) => {
    const count = experiences.filter((experience) => experience.applicationId === item.id).length;
    const canEdit = view === "mine";
    const viewExperiences = () => {
      setExperienceApplicationFilter(item.id);
      setExperienceScope("mine");
      setView("experiences");
    };
    return (
      <div className={`interview-round-strip experience-link-strip ${compact ? "compact" : ""}`} aria-label={`${item.company} ${item.position} 的面经`}>
        {count > 0 ? (
          <button type="button" className="interview-date-chip experience-link-chip" onClick={viewExperiences} title="查看该岗位全部面经">
            <strong>{count} 篇面经</strong>
            <span>查看 ↗</span>
          </button>
        ) : canEdit ? (
          <button
            type="button"
            className="interview-date-chip add"
            onClick={() => openExperienceCreate(item.id, defaultRoundForStage(interviewStage(item.status)))}
          >
            <strong>＋ 记录面经</strong>
            <span>顺手记录面试时间</span>
          </button>
        ) : (
          <span className="interview-date-empty">暂未共享面经</span>
        )}
      </div>
    );
  };

  const renderScheduleStrip = (item: Application, compact = false) => {
    const now = Date.now();
    const related = calendarItems.filter((entry) => entry.applicationId === item.id && entry.status !== "已取消");
    const upcoming = related.filter((entry) => new Date(entry.startsAt).getTime() >= now);
    const visible = (upcoming.length ? upcoming : related.slice().sort((a, b) => b.startsAt.localeCompare(a.startsAt))).slice(0, compact ? 2 : 3);
    if (!visible.length && view !== "mine") return null;
    return (
      <div className={`schedule-chip-strip ${compact ? "compact" : ""}`} aria-label={`${item.company} ${item.position} 的日程`}>
        {visible.map((entry) => (
          <button type="button" className={`schedule-chip event-${entry.kind}`} key={`${entry.source}-${entry.id}`} onClick={() => openCalendarEdit(entry)}>
            <strong>{calendarKindLabel(entry.kind)} · {formatDateTime(entry.startsAt)}</strong>
            <span>{entry.title}</span>
          </button>
        ))}
        {view === "mine" && !CLOSED_STATUSES.includes(item.status) && (
          <button type="button" className="schedule-chip add" onClick={() => openCalendarCreate(new Date(), item.id, INTERVIEW_STATUSES.includes(item.status) ? "interview" : "written_test")}>
            <strong>＋ 添加日程</strong><span>笔试 / 测评 / 面试</span>
          </button>
        )}
      </div>
    );
  };

  const renderCompanySchedule = (companyApplications: Application[]) => {
    const ids = new Set(companyApplications.map((item) => item.id));
    const now = Date.now();
    const next = calendarItems.find((entry) => ids.has(entry.applicationId) && entry.status !== "已取消" && new Date(entry.startsAt).getTime() >= now);
    if (!next) return null;
    return (
      <button type="button" className={`company-next-schedule event-${next.kind}`} onClick={() => openCalendarEdit(next)}>
        <strong>下一项 · {calendarKindLabel(next.kind)}</strong><span>{formatDateTime(next.startsAt)} · {next.position}</span>
      </button>
    );
  };

  const toggleApplicationSelection = useCallback((id: string) => {
    setSelectedApplicationIds((current) => current.includes(id)
      ? current.filter((itemId) => itemId !== id)
      : [...current, id]);
  }, []);

  const toggleCompanySelection = useCallback((ids: string[]) => {
    setSelectedApplicationIds((current) => {
      const allSelected = ids.every((id) => current.includes(id));
      return allSelected
        ? current.filter((id) => !ids.includes(id))
        : [...new Set([...current, ...ids])];
    });
  }, []);

  const applyBatchChanges = useCallback(async () => {
    if (selectedApplicationIds.length === 0) return;
    if (!batchStatus && !batchCompanyNature && !batchVisibility) {
      setNotice("请选择要批量修改的进度、单位性质或公开范围");
      return;
    }
    if (batchStatus === "流程结束" && !batchFinalOutcome) {
      setNotice("请选择批量流程结束的最终状态");
      return;
    }
    if (batchStatus === "已拒绝" && !batchRejectionReason.trim()) {
      setNotice("请填写批量拒绝原因");
      return;
    }
    const shareGroupId = batchGroupId || defaultGroupId;
    if (batchVisibility && batchVisibility !== "private" && !shareGroupId) {
      setNotice("请先创建或加入小组，再批量共享给搭子");
      return;
    }
    const now = new Date().toISOString();
    const selectedSet = new Set(selectedApplicationIds);
    const classificationCompanyKeys = batchCompanyNature
      ? new Set(ownApplications.filter((item) => selectedSet.has(item.id)).map((item) => companyKey(item.company)))
      : new Set<string>();
    const changed = ownApplications
      .filter((item) => selectedSet.has(item.id) || classificationCompanyKeys.has(companyKey(item.company)))
      .map((item) => ({
        ...item,
        ...(selectedSet.has(item.id) && batchStatus ? { status: batchStatus } : {}),
        ...(selectedSet.has(item.id) && batchStatus === "流程结束" ? { finalOutcome: batchFinalOutcome, rejectionReason: "" } : {}),
        ...(selectedSet.has(item.id) && batchStatus === "已拒绝" ? { finalOutcome: "", rejectionReason: batchRejectionReason } : {}),
        ...(selectedSet.has(item.id) && batchStatus && !["流程结束", "已拒绝"].includes(batchStatus) ? { finalOutcome: "", rejectionReason: "" } : {}),
        ...(classificationCompanyKeys.has(companyKey(item.company)) ? {
          industryTags: tagsWithClassification(batchCompanyNature, batchCompanySubtype, item.industryTags ?? []),
        } : {}),
        ...(selectedSet.has(item.id) && batchVisibility ? {
          visibility: batchVisibility,
          groupId: batchVisibility === "private" ? null : shareGroupId,
        } : {}),
        updatedAt: now,
      }));
    if (user) {
      const saved = await runCloudMutation("批量修改投递信息中", { action: "importApplications", applications: changed });
      if (!saved) return;
    }
    const changedMap = new Map(changed.map((item) => [item.id, item]));
    setApplications((current) => current.map((item) => changedMap.get(item.id) ?? item));
    setSelectedApplicationIds([]);
    setBatchStatus("");
    setBatchCompanyNature("");
    setBatchCompanySubtype("");
    setBatchVisibility("");
    setBatchGroupId("");
    setBatchFinalOutcome("");
    setBatchRejectionReason("");
    setNotice(`已批量更新 ${changed.length} 条投递`);
  }, [selectedApplicationIds, batchStatus, batchCompanyNature, batchCompanySubtype, batchVisibility, batchGroupId, batchFinalOutcome, batchRejectionReason, defaultGroupId, ownApplications, user, runCloudMutation]);

  useEffect(() => {
    loadRecoverySnapshots(recoveryOwnerKey).then(setRecoverySnapshots).catch(() => setRecoverySnapshots([]));
  }, [recoveryOwnerKey]);

  useEffect(() => {
    if (!ready) return;
    const ownIds = new Set(ownApplications.map((item) => item.id));
    const snapshot: WorkspaceBackup = {
      applications: ownApplications,
      interviews: interviews.filter((item) => ownIds.has(item.applicationId)),
      experiences: experiences.filter((item) => item.isOwner !== false && (!item.applicationId || ownIds.has(item.applicationId))),
      events: events.filter((item) => item.isOwner !== false && ownIds.has(item.applicationId)),
    };
    if (!snapshot.applications.length && !snapshot.interviews.length && !snapshot.experiences.length && !snapshot.events.length) return;
    const timer = window.setTimeout(() => {
      saveRecoverySnapshot(recoveryOwnerKey, snapshot).then(setRecoverySnapshots).catch(() => {});
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [events, experiences, interviews, ownApplications, ready, recoveryOwnerKey]);

  const updateInterview = useCallback(
    async (id: string, changes: Partial<Interview>) => {
      const current = interviews.find((item) => item.id === id);
      if (!current) {
        setNotice("保存面试修改失败：面试记录不存在或已被删除，请刷新后重试");
        return false;
      }
      const next = { ...current, ...changes, updatedAt: new Date().toISOString() };
      if (user) {
        const saved = await runCloudMutation("保存面试修改中", { action: "updateInterview", interview: next });
        if (!saved) return false;
      }
      setInterviews((prev) => prev.map((item) => (item.id === id ? next : item)));
      setNotice("面试修改已保存");
      return true;
    },
    [interviews, user, runCloudMutation],
  );

  // 面经表单保存时，按需创建或更新关联面试场次。
  const ensureInterviewForExperience = useCallback(
    async (input: { applicationId: string; round: string; scheduledAt: string; endedAt: string; interviewId: string; format: string; result: string }): Promise<string> => {
      const { applicationId, round, scheduledAt, endedAt, interviewId, format, result } = input;
      if (!applicationId) return "";
      const explicit = interviews.find((item) => item.id === interviewId && item.applicationId === applicationId);
      if (explicit) {
        const changes: Partial<Interview> = {};
        if (round && round !== explicit.round) changes.round = round;
        if (scheduledAt && scheduledAt !== explicit.scheduledAt) changes.scheduledAt = scheduledAt;
        if (endedAt !== (explicit.endedAt ?? "") ) changes.endedAt = endedAt;
        if (format && format !== (explicit.format ?? "")) changes.format = format;
        if (result && result !== (explicit.result ?? "")) changes.result = result;
        if (Object.keys(changes).length && !(await updateInterview(explicit.id, changes))) return "";
        return explicit.id;
      }
      const matched = [...interviews]
        .filter((item) => item.applicationId === applicationId && (!round || interviewStage(item.round) === interviewStage(round)))
        .sort((a, b) => (b.scheduledAt ?? "").localeCompare(a.scheduledAt ?? ""))[0];
      if (matched) {
        const changes: Partial<Interview> = { round: round || matched.round };
        if (scheduledAt) changes.scheduledAt = scheduledAt;
        if (endedAt) changes.endedAt = endedAt;
        if (format && format !== (matched.format ?? "")) changes.format = format;
        if (result && result !== (matched.result ?? "")) changes.result = result;
        if (Object.keys(changes).length && !(await updateInterview(matched.id, changes))) return "";
        return matched.id;
      }
      if (!scheduledAt) return "";
      const now = new Date().toISOString();
      const item: Interview = {
        id: crypto.randomUUID(),
        applicationId,
        scheduledAt,
        endedAt,
        round: round || "技术一面",
        format: format || "视频面试",
        result: result || "待定",
        interviewer: "",
        summary: "",
        nextSteps: "",
        createdAt: now,
        updatedAt: now,
      };
      if (user) {
        const saved = await runCloudMutation("保存面试安排中", { action: "saveInterview", interview: item });
        if (!saved) return "";
      }
      setInterviews((prev) => [...prev, item]);
      return item.id;
    },
    [interviews, user, runCloudMutation, updateInterview],
  );

  const removeInterview = useCallback(
    async (item: Interview, options: { silent?: boolean } = {}) => {
      if (!options.silent && !confirm(`确定删除这条面试记录吗？`)) return false;
      if (user) {
        const removed = await runCloudMutation("删除面试记录中", { action: "deleteInterview", id: item.id });
        if (!removed) return false;
      }
      setInterviews((prev) => prev.filter((entry) => entry.id !== item.id));
      if (!options.silent) setNotice("面试记录已删除");
      return true;
    },
    [user, runCloudMutation],
  );

  const openCalendarCreate = useCallback((date = new Date(), applicationId = "", kind: CalendarItemKind = "written_test") => {
    const form = emptyCalendarEventForm(date);
    const application = ownApplications.find((item) => item.id === applicationId);
    if (application && CLOSED_STATUSES.includes(application.status)) {
      setNotice("该岗位流程已经终止，不能再添加新日程");
      return;
    }
    setCalendarEventForm({
      ...form,
      applicationId,
      kind,
      timingType: "scheduled",
      round: kind === "interview" ? defaultRoundForStage(interviewStage(application?.status ?? "")) : form.round,
      mode: kind === "interview" ? "视频面试" : form.mode,
      status: kind === "interview" ? "未开始" : "待进行",
      syncStatus: kind === "interview" || kind === "written_test",
    });
    setEditingCalendarItem(null);
    setIsCalendarEventOpen(true);
  }, [ownApplications]);

  const openCalendarEdit = useCallback((calendarItem: RecruitmentCalendarItem) => {
    if (!calendarItem.isOwner) {
      setViewingFriendCalendarItem(calendarItem);
      return;
    }
    if (calendarItem.source === "interview") {
      const item = interviews.find((entry) => entry.id === calendarItem.id);
      if (!item) {
        setNotice("打开日程失败：面试记录不存在，请刷新后重试");
        return;
      }
      const scheduled = isScheduledInterview(item);
      setCalendarEventForm({
        phase: scheduled ? "scheduled" : "completed",
        kind: "interview",
        timingType: "scheduled",
        applicationId: item.applicationId,
        title: item.round || "面试",
        startsAt: dateTimeLocalValue(item.scheduledAt),
        endsAt: dateTimeLocalValue(item.endedAt ?? ""),
        allDay: false,
        round: item.round || "技术一面",
        mode: item.format || "视频面试",
        location: item.location ?? "",
        eventUrl: item.eventUrl ?? "",
        status: scheduled ? "未开始" : item.result || "待定",
        note: scheduled ? "" : item.summary || "",
        syncStatus: false,
      });
    } else {
      const item = events.find((entry) => entry.id === calendarItem.id);
      if (!item) {
        setNotice("打开日程失败：日程记录不存在，请刷新后重试");
        return;
      }
      setCalendarEventForm({
        phase: item.status === "已完成" ? "completed" : "scheduled",
        kind: item.eventType,
        timingType: item.timingType === "deadline" ? "deadline" : "scheduled",
        applicationId: item.applicationId,
        title: item.title,
        startsAt: dateTimeLocalValue(item.startsAt),
        endsAt: dateTimeLocalValue(item.endsAt),
        allDay: item.allDay,
        round: "技术一面",
        mode: item.mode,
        location: item.location,
        eventUrl: item.eventUrl,
        status: item.status,
        note: item.note,
        syncStatus: false,
      });
    }
    setEditingCalendarItem(calendarItem);
    setIsCalendarEventOpen(true);
  }, [events, interviews]);

  const closeCalendarEvent = useCallback(() => {
    setIsCalendarEventOpen(false);
    setEditingCalendarItem(null);
  }, []);

  useEffect(() => {
    if (!isCalendarEventOpen) return;
    const dialog = document.querySelector<HTMLElement>(".calendar-event-modal");
    if (!dialog) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (dialog.querySelector<HTMLElement>('input:not([type="checkbox"]), textarea') ?? dialog.querySelector<HTMLElement>("button"))?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeCalendarEvent();
      } else if (event.key === "Tab") {
        // Custom selects render their options in a portal beside the dialog.
        const popover = dialog.querySelector(".select-field.is-open") ? document.querySelector(".select-popover") : null;
        const selector = 'button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), a[href], [tabindex="0"]';
        const focusable = [...dialog.querySelectorAll<HTMLElement>(selector), ...(popover?.querySelectorAll<HTMLElement>(selector) ?? [])].filter((element) => element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [isCalendarEventOpen, closeCalendarEvent]);

  const submitCalendarEvent = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const application = ownApplications.find((item) => item.id === calendarEventForm.applicationId);
    if (!application) {
      setNotice("请选择需要关联的公司和岗位");
      return;
    }
    const startInput = calendarEventForm.allDay
      ? `${calendarEventForm.startsAt.slice(0, 10)}T${calendarEventForm.timingType === "deadline" ? "23:59:59" : "00:00:00"}`
      : calendarEventForm.startsAt;
    const endInput = calendarEventForm.phase === "scheduled"
      ? ""
      : calendarEventForm.allDay && calendarEventForm.endsAt
        ? `${calendarEventForm.endsAt.slice(0, 10)}T23:59:59`
        : calendarEventForm.endsAt;
    const startsAt = storedDateTimeValue(startInput);
    const endsAt = storedDateTimeValue(endInput);
    if (!startsAt) {
      setNotice("请填写日程开始时间");
      return;
    }
    if (endsAt && new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
      setNotice("结束时间不能早于开始时间");
      return;
    }
    const duplicate = calendarItems.some((item) =>
      item.applicationId === application.id && item.kind === calendarEventForm.kind && item.startsAt === startsAt &&
      !(editingCalendarItem && item.source === editingCalendarItem.source && item.id === editingCalendarItem.id),
    );
    if (duplicate) {
      setNotice("同一岗位在这个时间已经有同类型日程，请先编辑现有记录");
      return;
    }
    const now = new Date().toISOString();
    let scheduleSaved = false;
    if (calendarEventForm.kind === "interview") {
      const current = editingCalendarItem?.source === "interview" ? interviews.find((item) => item.id === editingCalendarItem.id) : null;
      const convertedEvent = editingCalendarItem?.source === "event" ? events.find((item) => item.id === editingCalendarItem.id) : null;
      const item: Interview = {
        id: current?.id ?? crypto.randomUUID(),
        applicationId: application.id,
        scheduledAt: startsAt,
        endedAt: endsAt,
        round: calendarEventForm.round || "技术一面",
        format: calendarEventForm.mode || "视频面试",
        location: calendarEventForm.location.trim(),
        eventUrl: calendarEventForm.eventUrl.trim(),
        result: calendarEventForm.phase === "scheduled" ? "未开始" : (calendarEventForm.status === "未开始" ? "待定" : calendarEventForm.status || "待定"),
        interviewer: current?.interviewer ?? "",
        summary: calendarEventForm.phase === "scheduled" ? current?.summary ?? "" : calendarEventForm.note.trim(),
        nextSteps: current?.nextSteps ?? "",
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      };
      if (user) {
        scheduleSaved = await runCloudMutation(current ? "保存面试日程修改中" : "保存面试日程中", { action: current ? "updateInterview" : "saveInterview", interview: item });
        if (!scheduleSaved) return;
        if (convertedEvent) {
          const removedOriginal = await runCloudMutation("转换类型并移除原日程中", { action: "deleteEvent", id: convertedEvent.id });
          if (!removedOriginal) {
            const rolledBack = await runCloudMutation("撤销未完成的类型转换中", { action: "deleteInterview", id: item.id });
            setNotice(rolledBack ? "修改事件类型失败：原日程未能删除，已撤销新面试记录" : "修改事件类型失败且自动撤销失败，请刷新后删除重复记录");
            return;
          }
        }
      } else scheduleSaved = true;
      if (convertedEvent) setEvents((items) => items.filter((entry) => entry.id !== convertedEvent.id));
      setInterviews((items) => current ? items.map((entry) => entry.id === item.id ? item : entry) : [...items, item]);
    } else {
      if (!RECRUITMENT_EVENT_TYPES.includes(calendarEventForm.kind)) {
        setNotice("请选择有效的日程类型");
        return;
      }
      const current = editingCalendarItem?.source === "event" ? events.find((item) => item.id === editingCalendarItem.id) : null;
      const convertedInterview = editingCalendarItem?.source === "interview" ? interviews.find((item) => item.id === editingCalendarItem.id) : null;
      const item: RecruitmentEvent = {
        id: current?.id ?? crypto.randomUUID(),
        applicationId: application.id,
        eventType: calendarEventForm.kind,
        timingType: calendarEventForm.kind === "written_test" ? calendarEventForm.timingType : "scheduled",
        title: calendarEventForm.title.trim() || `${application.company} · ${calendarKindLabel(calendarEventForm.kind)}`,
        startsAt,
        endsAt,
        allDay: calendarEventForm.allDay,
        mode: calendarEventForm.mode.trim(),
        location: calendarEventForm.location.trim(),
        eventUrl: calendarEventForm.eventUrl.trim(),
        status: calendarEventForm.phase === "completed"
          ? "已完成"
          : calendarEventForm.status === "已取消" ? "已取消" : "待进行",
        note: calendarEventForm.note.trim(),
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        isOwner: true,
      };
      if (user) {
        scheduleSaved = await runCloudMutation(current ? "保存日程修改中" : "保存日程中", { action: current ? "updateEvent" : "saveEvent", event: item });
        if (!scheduleSaved) return;
        if (convertedInterview) {
          const removedOriginal = await runCloudMutation("转换类型并移除原面试中", { action: "deleteInterview", id: convertedInterview.id });
          if (!removedOriginal) {
            const rolledBack = await runCloudMutation("撤销未完成的类型转换中", { action: "deleteEvent", id: item.id });
            setNotice(rolledBack ? "修改事件类型失败：原面试未能删除，已撤销新日程记录" : "修改事件类型失败且自动撤销失败，请刷新后删除重复记录");
            return;
          }
        }
      } else scheduleSaved = true;
      if (convertedInterview) {
        setInterviews((items) => items.filter((entry) => entry.id !== convertedInterview.id));
        setExperiences((items) => items.map((entry) => entry.interviewId === convertedInterview.id ? { ...entry, interviewId: "" } : entry));
      }
      setEvents((items) => current ? items.map((entry) => entry.id === item.id ? item : entry) : [...items, item]);
    }

    let targetStatus: ApplicationStatus | "" = "";
    if (calendarEventForm.kind === "written_test") targetStatus = "笔试";
    if (calendarEventForm.kind === "interview") {
      const stage = interviewStage(calendarEventForm.round);
      if (stage !== "其他") targetStatus = stage;
    }
    let progressSynced = true;
    if (scheduleSaved && calendarEventForm.syncStatus && targetStatus && ![...CLOSED_STATUSES, "Offer"].includes(application.status)) {
      const currentIndex = STATUSES.indexOf(application.status);
      const targetIndex = STATUSES.indexOf(targetStatus);
      if (targetIndex > currentIndex) progressSynced = await updateApplication(application.id, { status: targetStatus, finalOutcome: "", rejectionReason: "" });
    }
    closeCalendarEvent();
    const recordLabel = calendarEventForm.phase === "scheduled" ? "日程已约定" : "完成记录已保存";
    setNotice(progressSynced ? `${calendarKindLabel(calendarEventForm.kind)}${recordLabel}` : `${calendarKindLabel(calendarEventForm.kind)}${recordLabel}，但岗位进度同步失败，请稍后重试`);
  }, [calendarEventForm, calendarItems, closeCalendarEvent, editingCalendarItem, events, interviews, ownApplications, runCloudMutation, updateApplication, user]);

  const removeCalendarEvent = useCallback(async () => {
    if (!editingCalendarItem || !confirm(`确定删除这条${calendarKindLabel(editingCalendarItem.kind)}日程吗？`)) return;
    if (editingCalendarItem.source === "interview") {
      const item = interviews.find((entry) => entry.id === editingCalendarItem.id);
      if (!item) return;
      const removed = await removeInterview(item, { silent: true });
      if (!removed) return;
      setExperiences((items) => items.map((entry) => entry.interviewId === item.id ? { ...entry, interviewId: "" } : entry));
    } else {
      const item = events.find((entry) => entry.id === editingCalendarItem.id);
      if (!item) return;
      if (user) {
        const removed = await runCloudMutation("删除日程中", { action: "deleteEvent", id: item.id });
        if (!removed) return;
      }
      setEvents((items) => items.filter((entry) => entry.id !== item.id));
    }
    closeCalendarEvent();
    setNotice("日程已删除");
  }, [closeCalendarEvent, editingCalendarItem, events, interviews, removeInterview, runCloudMutation, user]);

  const completeCalendarTodo = useCallback(async (calendarItem: RecruitmentCalendarItem) => {
    if (calendarItem.source !== "event") return;
    const current = events.find((item) => item.id === calendarItem.id);
    if (!current) {
      setNotice("标记完成失败：日程记录不存在或已被删除，请刷新后重试");
      return;
    }
    const next: RecruitmentEvent = { ...current, status: "已完成", updatedAt: new Date().toISOString() };
    if (user) {
      const saved = await runCloudMutation("标记日程完成中", { action: "updateEvent", event: next });
      if (!saved) return;
    }
    setEvents((items) => items.map((item) => item.id === next.id ? next : item));
    setNotice(`${calendarKindLabel(next.eventType)}已标记完成`);
  }, [events, runCloudMutation, user]);

  const dismissCalendarTodo = useCallback(async (todo: CalendarTodoEntry) => {
    if (user) {
      const saved = await runCloudMutation("忽略待做提醒中", { action: "dismissTodo", reminderKey: todo.dismissKey });
      if (!saved) return;
    }
    setDismissedTodoKeys((current) => {
      const next = current.includes(todo.dismissKey) ? current : [...current, todo.dismissKey];
      try { localStorage.setItem(todoDismissalsStorageKey, JSON.stringify(next)); } catch { /* cloud copy remains authoritative */ }
      return next;
    });
    setNotice("该条待做已忽略；原始日程和面试记录仍然保留");
  }, [runCloudMutation, todoDismissalsStorageKey, user]);

  const addExperience = useCallback(async (item: InterviewExperience) => {
    if (user) {
      const saved = await runCloudMutation("保存面经中", { action: "saveExperience", experience: item });
      if (!saved) return false;
    }
    setExperiences((current) => [item, ...current]);
    setNotice("面经已保存");
    return true;
  }, [user, runCloudMutation]);

  const updateExperience = useCallback(async (id: string, changes: Partial<InterviewExperience>) => {
    const current = experiences.find((item) => item.id === id);
    if (!current) {
      setNotice("保存面经修改失败：面经记录不存在或已被删除，请刷新后重试");
      return false;
    }
    const next = { ...current, ...changes, updatedAt: new Date().toISOString() };
    if (user) {
      const saved = await runCloudMutation("保存面经修改中", { action: "updateExperience", experience: next });
      if (!saved) return false;
    }
    setExperiences((items) => items.map((item) => item.id === id ? next : item));
    setNotice("面经修改已保存");
    return true;
  }, [experiences, user, runCloudMutation]);

  const removeExperience = useCallback(async (item: InterviewExperience) => {
    if (!confirm("删除这条面经？关联的面试时间记录也会一并删除。")) return false;
    if (user) {
      const removed = await runCloudMutation("删除面经中", { action: "deleteExperience", id: item.id });
      if (!removed) return false;
    }
    setExperiences((items) => items.filter((entry) => entry.id !== item.id));
    // 级联删除关联面试记录（best-effort：失败仅告警，不回滚面经删除）
    const linkedInterview = interviews.find((interview) =>
      (item.interviewId && interview.id === item.interviewId) ||
      (!item.interviewId && item.applicationId && interview.applicationId === item.applicationId && interviewStage(interview.round) === interviewStage(item.round)),
    );
    if (linkedInterview) {
      const cascaded = await removeInterview(linkedInterview, { silent: true });
      if (!cascaded) {
        setNotice("面经已删除，关联面试记录删除失败，可在面经库重新补录");
        return true;
      }
    }
    setNotice("面经已删除");
    return true;
  }, [user, runCloudMutation, interviews, removeInterview]);

  const openExperienceCreate = useCallback((applicationId = "", round = "") => {
    const application = ownApplications.find((item) => item.id === applicationId);
    setExperienceForm({ ...EMPTY_EXPERIENCE, applicationId, round, company: application?.company ?? "", position: application?.position ?? "" });
    setExperienceScope("mine");
    setEditingExperienceId(null);
    setIsExperienceOpen(true);
  }, [ownApplications]);

  const openExperienceEdit = useCallback((item: InterviewExperience) => {
    const linkedInterview = interviews.find((interview) =>
      (item.interviewId && interview.id === item.interviewId) ||
      (!item.interviewId && item.applicationId && interview.applicationId === item.applicationId && interviewStage(interview.round) === interviewStage(item.round)),
    );
    setExperienceForm({
      applicationId: item.applicationId ?? "",
      interviewId: item.interviewId ?? "",
      scheduledAt: dateTimeLocalValue(linkedInterview?.scheduledAt ?? ""),
      endedAt: dateTimeLocalValue(linkedInterview?.endedAt ?? ""),
      title: item.title,
      company: item.company,
      position: item.position,
      round: item.round,
      format: linkedInterview?.format ?? "视频面试",
      result: linkedInterview?.result ?? "待定",
      interviewer: linkedInterview?.interviewer ?? "",
      tags: item.tags.join(" / "),
      content: item.content,
      takeaway: item.takeaway,
      visibility: item.visibility === "full" ? "full" : "private",
      groupId: item.groupId ?? "",
    });
    setEditingExperienceId(item.id);
    setIsExperienceOpen(true);
  }, [interviews]);

  const groupAction = useCallback(
    async (action: string) => {
      try {
        if (action === "create") {
          const existingIds = new Set(groups.map((group) => group.id));
          const created = await runCloudMutation("创建小组中", { action: "createGroup", name: groupName }, true);
          if (!created) return;
          const nextGroups = await loadCloud();
          const newGroup = nextGroups.find((group) => !existingIds.has(group.id));
          if (newGroup) setActiveGroupId(newGroup.id);
          setGroupName("");
          setNotice("新小组已创建，可以继续创建其他小组");
        } else if (action === "join") {
          const joined = await runCloudMutation("加入小组中", { action: "joinGroup", inviteCode }, true);
          if (!joined) return;
          await loadCloud();
          setInviteCode("");
          setNotice("已加入小组");
        } else if (action === "leave") {
          if (!activeGroupId) return;
          const left = await runCloudMutation("退出小组中", { action: "leaveGroup", groupId: activeGroupId }, true);
          if (!left) return;
          setActiveGroupId(null);
          await loadCloud();
          setNotice("已退出小组");
        } else if (action === "delete") {
          if (!activeGroupId || !confirm("确定删除这个小组吗？成员关系会一并移除，原投递记录和面经会转为仅自己可见。")) return;
          const deleted = await runCloudMutation("删除小组中", { action: "deleteGroup", groupId: activeGroupId }, true);
          if (!deleted) return;
          setActiveGroupId(null);
          await loadCloud();
          setNotice("小组已删除");
        }
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "操作失败");
      } finally {
        setPendingAction(null);
      }
    },
    [groups, runCloudMutation, groupName, inviteCode, activeGroupId, loadCloud],
  );

  const copyInviteCode = useCallback(() => {
    if (!activeGroup) return;
    navigator.clipboard.writeText(activeGroup.inviteCode ?? "").catch(() => {});
    setNotice("邀请码已复制");
  }, [activeGroup]);

  const copyShareLink = useCallback(() => {
    if (!activeGroup) return;
    const link = `${window.location.origin}${window.location.pathname}?invite=${activeGroup.inviteCode}`;
    navigator.clipboard.writeText(link).catch(() => {});
    setNotice("分享链接已复制");
  }, [activeGroup]);

  const copyPositionLink = useCallback(async (application: Application) => {
    if (!application.isOwner && application.visibility !== "full") {
      setNotice("该岗位仅共享进度，链接不可复制");
      return;
    }

    const link = externalHttpUrl(application.link);
    if (!link) {
      setNotice("该岗位还没有有效链接");
      return;
    }

    try {
      await navigator.clipboard.writeText(link);
      setNotice("岗位链接已复制");
    } catch {
      setNotice("复制失败，请手动打开链接后复制");
    }
  }, []);

  const exportData = useCallback(async () => {
    setPendingAction("正在生成 Excel 完整备份");
    try {
      const ownIds = new Set(ownApplications.map((item) => item.id));
      const backup: WorkspaceBackup = {
        applications: ownApplications,
        interviews: interviews.filter((item) => ownIds.has(item.applicationId)),
        experiences: experiences.filter((item) => item.isOwner !== false && (!item.applicationId || ownIds.has(item.applicationId))),
        events: events.filter((item) => item.isOwner !== false && ownIds.has(item.applicationId)),
      };
      const blob = await createWorkspaceWorkbook(backup);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `秋招同行录_完整备份_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setRecoverySnapshots(await saveRecoverySnapshot(recoveryOwnerKey, backup));
      setNotice("Excel 完整备份已导出，并已更新本地恢复快照");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Excel 备份生成失败，请稍后重试");
    } finally {
      setPendingAction(null);
    }
  }, [events, experiences, interviews, ownApplications, recoveryOwnerKey]);

  const importData = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setPendingAction("正在读取完整备份");
      try {
        const extension = file.name.toLocaleLowerCase().split(".").pop();
        if (extension !== "xlsx" && extension !== "json") {
          setNotice("请选择秋招同行录导出的 Excel（.xlsx）或旧版 JSON 备份");
          return;
        }
        if (file.size > 20 * 1024 * 1024) {
          setNotice("备份文件不能超过 20MB");
          return;
        }
        let data: { applications?: unknown; interviews?: unknown; experiences?: unknown; events?: unknown };
        if (extension === "xlsx") {
          data = await readWorkspaceWorkbook(file);
        } else {
          const text = await file.text();
          const parsed = JSON.parse(text) as unknown;
          data = Array.isArray(parsed)
            ? { applications: parsed }
            : parsed && typeof parsed === "object"
              ? parsed as { applications?: unknown; interviews?: unknown; experiences?: unknown; events?: unknown }
              : {};
        }
        if (!safeApplications(data.applications) || data.applications.length > 500) {
          setNotice("格式错误，请检查备份文件");
          return;
        }
        const normalizedApplications = normalizeLocal(data.applications);
        const applicationIds = new Set(normalizedApplications.map((item) => item.id));
        const normalizedInterviews = safeInterviews(data.interviews)
          ? normalizeInterviews(data.interviews).filter((item) => applicationIds.has(item.applicationId))
          : [];
        const ignoredInterviews = safeInterviews(data.interviews) ? data.interviews.length - normalizedInterviews.length : 0;
        const experienceData = data.experiences ?? [];
        const normalizedExperiences = safeExperiences(experienceData)
          ? normalizeExperiences(experienceData).map((item) => ({
              ...item,
              applicationId: item.applicationId && applicationIds.has(item.applicationId) ? item.applicationId : "",
              interviewId: item.interviewId && normalizedInterviews.some((interview) => interview.id === item.interviewId) ? item.interviewId : "",
            }))
          : [];
        const ignoredExperiences = Array.isArray(data.experiences) ? data.experiences.length - normalizedExperiences.length : 0;
        const eventData = data.events ?? [];
        const normalizedEvents = safeRecruitmentEvents(eventData)
          ? normalizeRecruitmentEvents(eventData).filter((item) => applicationIds.has(item.applicationId))
          : [];
        const ignoredEvents = Array.isArray(data.events) ? data.events.length - normalizedEvents.length : 0;
        setImportPreview({
          fileName: file.name,
          applications: normalizedApplications,
          interviews: normalizedInterviews,
          experiences: normalizedExperiences,
          events: normalizedEvents,
          ignoredInterviews,
          ignoredExperiences,
          ignoredEvents,
        });
        setImportMode("merge");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "无法读取备份文件，请确认文件完整且未损坏");
      } finally {
        setPendingAction(null);
        if (importRef.current) importRef.current.value = "";
      }
    },
    [],
  );

  const openRecoverySnapshot = useCallback((snapshot: RecoverySnapshot) => {
    setImportPreview({
      fileName: `本地恢复快照 · ${new Date(snapshot.savedAt).toLocaleString("zh-CN")}`,
      applications: normalizeLocal(snapshot.applications),
      interviews: normalizeInterviews(snapshot.interviews),
      experiences: normalizeExperiences(snapshot.experiences),
      events: normalizeRecruitmentEvents(snapshot.events ?? []),
      ignoredInterviews: 0,
      ignoredExperiences: 0,
      ignoredEvents: 0,
    });
    setImportMode("merge");
  }, []);

  const applyImport = useCallback(async () => {
    if (!importPreview) return;
    const availableGroupIds = new Set(groups.map((group) => group.id));
    const now = new Date().toISOString();
    const existingByKey = new Map(ownApplications.map((item) => [applicationImportKey(item), item]));
    const existingById = new Map(ownApplications.map((item) => [item.id, item]));
    const idMap = new Map<string, string>();
    const accepted: Application[] = [];
    const seenIncomingKeys = new Set<string>();

    for (const source of importPreview.applications) {
      const key = applicationImportKey(source);
      const existing = existingById.get(source.id) ?? existingByKey.get(key);
      if (importMode === "merge" && existing) {
        idMap.set(source.id, existing.id);
        continue;
      }
      if (importMode === "merge" && seenIncomingKeys.has(key)) continue;
      const item = importedApplication(source, availableGroupIds, defaultGroupId);
      const id = importMode === "merge" ? crypto.randomUUID() : item.id;
      idMap.set(source.id, id);
      seenIncomingKeys.add(key);
      accepted.push({ ...item, id, createdAt: item.createdAt || now, updatedAt: now });
    }

    const existingInterviewByKey = new Map(interviews.map((item) => [`${item.applicationId}|${item.scheduledAt}|${item.round}`, item]));
    const interviewIdMap = new Map<string, string>();
    const acceptedInterviews: Interview[] = [];
    for (const source of importPreview.interviews) {
      const applicationId = idMap.get(source.applicationId);
      if (!applicationId) continue;
      const key = `${applicationId}|${source.scheduledAt}|${source.round}`;
      const existing = existingInterviewByKey.get(key);
      if (importMode === "merge" && existing) {
        interviewIdMap.set(source.id, existing.id);
        continue;
      }
      const id = importMode === "merge" ? crypto.randomUUID() : source.id;
      interviewIdMap.set(source.id, id);
      acceptedInterviews.push({ ...source, id, applicationId, createdAt: source.createdAt || now, updatedAt: now });
    }

    const experienceKey = (item: Pick<InterviewExperience, "applicationId" | "round" | "title">) => `${item.applicationId ?? ""}|${item.round.trim().toLocaleLowerCase()}|${item.title.trim().toLocaleLowerCase()}`;
    const existingExperienceKeys = new Set(experiences.filter((item) => item.isOwner !== false).map(experienceKey));
    const acceptedExperiences = importPreview.experiences
      .map((source) => ({
        ...source,
        id: importMode === "merge" ? crypto.randomUUID() : source.id,
        applicationId: source.applicationId ? idMap.get(source.applicationId) ?? "" : "",
        interviewId: source.interviewId ? interviewIdMap.get(source.interviewId) ?? "" : "",
        createdAt: source.createdAt || now,
        updatedAt: now,
        visibility: source.visibility === "full" && Boolean((source.groupId && availableGroupIds.has(source.groupId)) || defaultGroupId) ? "full" as const : "private" as const,
        groupId: source.visibility === "full" ? (source.groupId && availableGroupIds.has(source.groupId) ? source.groupId : defaultGroupId || null) : null,
        isOwner: true,
      }))
      .filter((item) => importMode === "replace" || !existingExperienceKeys.has(experienceKey(item)));

    const existingEventKeys = new Set(
      events
        .filter((item) => item.isOwner !== false)
        .map((item) => `${item.applicationId}|${item.eventType}|${item.startsAt}`),
    );
    const acceptedEvents = importPreview.events
      .map((source) => ({
        ...source,
        id: importMode === "merge" ? crypto.randomUUID() : source.id,
        applicationId: idMap.get(source.applicationId) ?? "",
        createdAt: source.createdAt || now,
        updatedAt: now,
        isOwner: true,
      }))
      .filter((item) => Boolean(item.applicationId))
      .filter((item) => importMode === "replace" || !existingEventKeys.has(`${item.applicationId}|${item.eventType}|${item.startsAt}`));

    if (importMode === "merge" && !accepted.length && !acceptedInterviews.length && !acceptedExperiences.length && !acceptedEvents.length) {
      setImportPreview(null);
      setNotice("没有可导入的新记录，重复的岗位、面试、日程与面经已自动跳过");
      return;
    }
    if (user) {
      const saved = await runCloudMutation("正在导入并同步云端", {
        action: "importWorkspace",
        mode: importMode,
        applications: accepted,
        interviews: acceptedInterviews,
        experiences: acceptedExperiences,
        events: acceptedEvents,
      });
      if (!saved) return;
    }
    if (importMode === "replace") {
      setApplications((current) => [...current.filter((item) => item.isOwner === false), ...accepted]);
      setInterviews(acceptedInterviews);
      setExperiences((current) => [...acceptedExperiences, ...current.filter((item) => item.isOwner === false)]);
      setEvents((current) => [...acceptedEvents, ...current.filter((item) => item.isOwner === false)]);
      saveLocal(accepted);
      saveInterviewsLocal(acceptedInterviews);
      saveExperiencesLocal(acceptedExperiences);
      saveEventsLocal(acceptedEvents);
    } else {
      setApplications((current) => [...current, ...accepted]);
      setInterviews((current) => [...current, ...acceptedInterviews]);
      setExperiences((current) => [...acceptedExperiences, ...current]);
      setEvents((current) => [...current, ...acceptedEvents]);
      saveLocal([...ownApplications, ...accepted]);
      saveInterviewsLocal([...interviews, ...acceptedInterviews]);
      saveExperiencesLocal([...acceptedExperiences, ...experiences]);
      saveEventsLocal([...events, ...acceptedEvents]);
    }
    setImportPreview(null);
    setNotice(`导入完成：${accepted.length} 个岗位、${acceptedInterviews.length} 条面试、${acceptedEvents.length} 条日程、${acceptedExperiences.length} 篇面经`);
  }, [defaultGroupId, events, experiences, groups, importMode, importPreview, interviews, ownApplications, runCloudMutation, saveEventsLocal, saveExperiencesLocal, saveInterviewsLocal, saveLocal, user]);

  const clearFilters = useCallback(() => {
    setQuery("");
    setStatusFilter("全部状态");
    setStatFilter("all");
    setBatchFilter("全部批次");
    setCompanyNatureFilter("全部单位性质");
    setIndustryFilter("全部行业方向");
    setScaleFilter("全部规模");
    setPositionFilter("");
    setLocationFilter("");
    setFiltersExpanded(false);
  }, []);

  const openStatFilter = useCallback((filter: "all" | "active" | "interview" | "offer") => {
    clearFilters();
    setView("mine");
    setSelectedApplicationIds([]);
    setStatFilter(filter);
    setStatusFilter(filter === "interview" ? "\u9762\u8bd5\u8fdb\u884c\u4e2d" : filter === "offer" ? "Offer" : "\u5168\u90e8\u72b6\u6001");
  }, [clearFilters]);
  // ────────────────────────────────── form
  function openCreate(source?: Application) {
    setBatchPositions([{ position: "", base: source?.base ?? "" }]);
    if (source) {
      const classification = companyClassification(source.industryTags ?? []);
      setForm({
        company: source.company,
        position: "",
        base: source.base ?? "",
        batch: source.batch,
        appliedAt: new Date().toISOString().slice(0, 10),
        status: "简历投递",
        channel: source.channel ?? "",
        link: source.link ?? "",
        salary: source.salary ?? "",
        note: source.note ?? "",
        finalOutcome: "",
        rejectionReason: "",
        visibility: source.visibility,
        groupId: source.groupId ?? defaultGroupId,
        companyNature: classification.companyNature,
        companySubtype: classification.companySubtype,
        industryTags: industryOnly(source.industryTags ?? []),
        companyScale: source.companyScale ?? "",
      });
    } else {
      setForm({ ...EMPTY_FORM, groupId: defaultGroupId });
    }
    setEditingId(null);
    setIsFormOpen(true);
  }

  function openEdit(item: Application, status = item.status) {
    setSelectedCompany(null);
    const classification = companyClassification(item.industryTags ?? []);
    setBatchPositions([{ position: item.position, base: item.base ?? "" }]);
    setForm({
      company: item.company,
      position: item.position,
      base: item.base ?? "",
      batch: item.batch,
      appliedAt: item.appliedAt,
      status,
      channel: item.channel ?? "",
      link: item.link ?? "",
      salary: item.salary ?? "",
      note: item.note ?? "",
      finalOutcome: item.finalOutcome ?? "",
      rejectionReason: item.rejectionReason ?? "",
      visibility: item.visibility,
      groupId: item.groupId ?? defaultGroupId,
      companyNature: classification.companyNature,
      companySubtype: classification.companySubtype,
      industryTags: industryOnly(item.industryTags ?? []),
      companyScale: item.companyScale ?? "",
    });
    setEditingId(item.id);
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingId(null);
    setBatchPositions([{ position: "", base: "" }]);
    setCompanyAutocompleteOpen(false);
    setPositionAutocompleteIndex(null);
    setBaseAutocompleteIndex(null);
    setChannelAutocompleteOpen(false);
  }

  function updateFormField(field: keyof FormState, value: string | string[]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function applyCompanySuggestion(source: Application) {
    const classification = companyClassification(source.industryTags ?? []);
    setForm((current) => ({
      ...current,
      company: source.company,
      companyNature: classification.companyNature,
      companySubtype: classification.companySubtype,
      industryTags: industryOnly(source.industryTags ?? []),
      companyScale: source.companyScale ?? "",
    }));
    setCompanyAutocompleteOpen(false);
  }

  async function submitForm(event: React.FormEvent) {
    event.preventDefault();
    const positions = editingId
      ? [{ position: form.position.trim(), base: form.base.trim() }]
      : batchPositions
        .map((item) => ({ position: item.position.trim(), base: item.base.trim() }))
        .filter((item) => item.position);
    if (!form.company.trim() || positions.length === 0) {
      setNotice("公司和岗位不能为空");
      return;
    }
    if (!editingId) {
      const seenInBatch = new Set<string>();
      const duplicates = positions.filter((item) => {
        const key = `${companyKey(form.company)}|${item.position.toLocaleLowerCase()}|${item.base.toLocaleLowerCase()}`;
        const repeatedInBatch = seenInBatch.has(key);
        seenInBatch.add(key);
        const alreadyExists = ownApplications.some((application) =>
          companyKey(application.company) === companyKey(form.company) &&
          application.position.trim().toLocaleLowerCase() === item.position.toLocaleLowerCase() &&
          (application.base ?? "").trim().toLocaleLowerCase() === item.base.toLocaleLowerCase(),
        );
        return repeatedInBatch || alreadyExists;
      });
      if (duplicates.length > 0 && !confirm(`发现 ${duplicates.length} 个可能重复的岗位：${duplicates.map((item) => item.position).join("、")}。仍要继续添加吗？`)) return;
    }
    if (form.status === "流程结束" && !form.finalOutcome) {
      setNotice("请选择流程最终走到的状态");
      return;
    }
    if (form.status === "已拒绝" && !form.rejectionReason.trim()) {
      setNotice("请填写拒绝原因");
      return;
    }
    const shareGroupId = form.groupId || defaultGroupId;
    const industryTags = tagsWithClassification(form.companyNature, form.companySubtype, form.industryTags);
    if (form.visibility !== "private" && !shareGroupId) {
      setNotice("请先创建或加入小组，再设置共享范围");
      return;
    }
    let saved = false;
    if (editingId) {
      saved = await updateApplication(editingId, {
        company: form.company,
        position: form.position,
        base: form.base,
        batch: form.batch,
        appliedAt: form.appliedAt,
        status: form.status,
        channel: form.channel,
        link: form.link,
        salary: form.salary,
        note: form.note,
        finalOutcome: form.finalOutcome,
        rejectionReason: form.rejectionReason,
        visibility: form.visibility,
        groupId: form.visibility === "private" ? null : shareGroupId,
        industryTags,
        companyScale: form.companyScale,
      });
    } else {
      const now = new Date().toISOString();
      const items: Application[] = positions.map((item) => ({
          id: crypto.randomUUID(),
          company: form.company.trim(),
          position: item.position,
          base: item.base,
          batch: form.batch,
          appliedAt: form.appliedAt,
          status: form.status,
          channel: form.channel,
          link: form.link,
          salary: form.salary,
          note: form.note,
          finalOutcome: form.finalOutcome,
          rejectionReason: form.rejectionReason,
          visibility: form.visibility,
          groupId: form.visibility === "private" ? null : shareGroupId,
          industryTags,
          companyScale: form.companyScale,
          createdAt: now,
          updatedAt: now,
        }));
      saved = items.length === 1 ? await addApplication(items[0]) : await addApplications(items);
    }
    if (saved) closeForm();
  }

  function closeExperienceForm() {
    setIsExperienceOpen(false);
    setEditingExperienceId(null);
    setExperienceForm(EMPTY_EXPERIENCE);
  }

  async function submitExperienceForm(event: React.FormEvent) {
    event.preventDefault();
    if (!experienceForm.title.trim() || !experienceForm.content.trim()) {
      setNotice("\u8bf7\u586b\u5199\u9762\u7ecf\u6807\u9898\u548c\u9762\u8bd5\u5185\u5bb9");
      return;
    }
    const scheduledAt = storedDateTimeValue(experienceForm.scheduledAt);
    const endedAt = storedDateTimeValue(experienceForm.endedAt);
    if (scheduledAt && !experienceForm.applicationId) {
      setNotice("\u8bf7\u5148\u9009\u62e9\u5173\u8054\u5c97\u4f4d\u518d\u586b\u5199\u9762\u8bd5\u65f6\u95f4");
      return;
    }
    if (endedAt && scheduledAt && new Date(endedAt).getTime() < new Date(scheduledAt).getTime()) {
      setNotice("\u7ed3\u675f\u65f6\u95f4\u4e0d\u80fd\u65e9\u4e8e\u9762\u8bd5\u5f00\u59cb\u65f6\u95f4");
      return;
    }
    const interviewId = await ensureInterviewForExperience({
      applicationId: experienceForm.applicationId,
      round: experienceForm.round.trim(),
      scheduledAt,
      endedAt,
      interviewId: experienceForm.interviewId,
      format: experienceForm.format,
      result: experienceForm.result,
    });
    if (experienceForm.applicationId && scheduledAt && !interviewId) return;
    const now = new Date().toISOString();
    const tags = experienceForm.tags.split(/[\/,\u3001\uff0c]/).map((tag) => tag.trim()).filter(Boolean);
    if (experienceForm.visibility === "full" && !experienceForm.groupId) {
      setNotice("请选择共享小组");
      return;
    }
    const changes = {
      applicationId: experienceForm.applicationId,
      interviewId,
      title: experienceForm.title.trim(),
      company: experienceForm.company.trim(),
      position: experienceForm.position.trim(),
      round: experienceForm.round.trim(),
      tags,
      content: experienceForm.content.trim(),
      takeaway: experienceForm.takeaway.trim(),
      visibility: experienceForm.visibility,
      groupId: experienceForm.visibility === "full" ? experienceForm.groupId : null,
    };
    const saved = editingExperienceId
      ? await updateExperience(editingExperienceId, changes)
      : await addExperience({ id: crypto.randomUUID(), ...changes, createdAt: now, updatedAt: now });
    if (saved) closeExperienceForm();
  }

  function selectExperienceApplication(applicationId: string) {
    const application = ownApplications.find((item) => item.id === applicationId);
    setExperienceForm((current) => ({
      ...current,
      applicationId,
      interviewId: current.interviewId && interviews.some((item) => item.id === current.interviewId && item.applicationId === applicationId) ? current.interviewId : "",
      company: application?.company ?? current.company,
      position: application?.position ?? current.position,
    }));
  }
  // ────────────────────────────────── company modal

  function openExperienceFromInterview(interview: Interview) {
    const application = ownApplications.find((item) => item.id === interview.applicationId);
    setExperienceForm({
      ...EMPTY_EXPERIENCE,
      applicationId: interview.applicationId,
      interviewId: interview.id,
      scheduledAt: dateTimeLocalValue(interview.scheduledAt),
      endedAt: dateTimeLocalValue(interview.endedAt ?? ""),
      company: application?.company ?? "",
      position: application?.position ?? "",
      round: interview.round,
      format: interview.format ?? "\u89c6\u9891\u9762\u8bd5",
      result: interview.result ?? "\u5f85\u5b9a",
      interviewer: interview.interviewer ?? "",
      title: `${application?.company ?? "\u672c\u6b21"}${interview.round ? ` \u00b7 ${interview.round}` : ""}\u9762\u7ecf`,
      content: interview.summary,
      takeaway: interview.nextSteps,
    });
    setEditingExperienceId(null);
    setIsExperienceOpen(true);
  }

  // 从面试记录跳转：有对应面经则打开面经编辑，没有则带面试信息新建面经
  function openExperienceByInterview(interview: Interview) {
    const linked = experiences.find((experience) =>
      (interview.id && experience.interviewId === interview.id) ||
      (!experience.interviewId && experience.applicationId === interview.applicationId && interviewStage(experience.round) === interviewStage(interview.round)),
    );
    if (linked) {
      openExperienceEdit(linked);
    } else {
      openExperienceFromInterview(interview);
    }
  }

  function openCompany(company: string) {
    setSelectedCompany(company);
  }

  function closeCompany() {
    setSelectedCompany(null);
  }

  function openCompanyEdit(company: string) {
    const companyItems = ownApplications.filter((item) => companyKey(item.company) === companyKey(company));
    const companyTags = [...new Set(companyItems.flatMap((item) => item.industryTags ?? []))];
    const classification = companyClassification(companyTags);
    setCompanyForm({
      name: company,
      companyNature: classification.companyNature,
      companySubtype: classification.companySubtype,
      industryTags: industryOnly(companyTags),
      companyScale: companyItems.find((item) => item.companyScale)?.companyScale ?? "",
    });
    setEditingCompanyName(company);
    setSelectedCompany(null);
  }

  function closeCompanyEdit() {
    setEditingCompanyName(null);
    setCompanyForm(EMPTY_COMPANY_FORM);
  }

  async function submitCompanyEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editingCompanyName || !companyForm.name.trim()) {
      setNotice("公司名称不能为空");
      return;
    }
    const now = new Date().toISOString();
    const industryTags = tagsWithClassification(companyForm.companyNature, companyForm.companySubtype, companyForm.industryTags);
    const changed = ownApplications
      .filter((item) => companyKey(item.company) === companyKey(editingCompanyName))
      .map((item) => ({
        ...item,
        company: companyForm.name.trim(),
        industryTags,
        companyScale: companyForm.companyScale,
        updatedAt: now,
      }));
    if (user) {
      const saved = await runCloudMutation("保存公司信息中", { action: "importApplications", applications: changed });
      if (!saved) return;
    }
    const changedMap = new Map(changed.map((item) => [item.id, item]));
    setApplications((current) => current.map((item) => changedMap.get(item.id) ?? item));
    setNotice(`已更新 ${companyForm.name.trim()} 的公司信息及 ${changed.length} 个岗位`);
    closeCompanyEdit();
  }

  const companyApplications = useMemo(() => {
    if (!selectedCompany) return [];
    const source = view === "friends" ? friendApplications : ownApplications;
    return source
      .filter((item) => companyKey(item.company) === companyKey(selectedCompany))
      .sort((a, b) => compareApplications(a, b, sortKey) * (sortDirection === "asc" ? 1 : -1));
  }, [selectedCompany, view, ownApplications, friendApplications, sortKey, sortDirection]);
  const allCompanyApplicationsSelected = companyApplications.length > 0 && companyApplications.every((item) => selectedApplicationIds.includes(item.id));
  const companyApplicationIds = useMemo(() => new Set(companyApplications.map((item) => item.id)), [companyApplications]);
  const companyInterviews = useMemo(
    () => interviews.filter((item) => companyApplicationIds.has(item.applicationId)),
    [interviews, companyApplicationIds],
  );
  const companyRecruitmentEvents = useMemo(
    () => events.filter((item) => companyApplicationIds.has(item.applicationId)),
    [events, companyApplicationIds],
  );
  const companyCalendarItems = useMemo(
    () => calendarItems.filter((item) => companyApplicationIds.has(item.applicationId)),
    [calendarItems, companyApplicationIds],
  );
  const companyTimeline = useMemo(() => {
    const applicationMap = new Map(companyApplications.map((item) => [item.id, item]));
    const editableCalendarMap = new Map(companyCalendarItems.map((item) => [`${item.source}-${item.id}`, item]));
    const deliveryEvents = companyApplications.map((item) => ({
      id: `application-${item.id}`,
      date: item.appliedAt ? `${item.appliedAt}T00:00:00` : item.createdAt ?? item.updatedAt,
      type: "投递",
      title: item.position,
      detail: `${item.batch} · ${item.base || "地点待定"} · ${item.status}`,
      tone: "delivery",
      interview: undefined as Interview | undefined,
      calendarItem: undefined as RecruitmentCalendarItem | undefined,
    }));
    const interviewEvents = companyInterviews.map((item) => {
      const application = applicationMap.get(item.applicationId);
      return {
        id: `interview-${item.id}`,
        date: item.scheduledAt,
        type: item.round || "面试",
        title: application?.position ?? "关联岗位",
        detail: [item.format, item.result].filter(Boolean).join(" · ") || "等待补充面试信息",
        tone: "interview",
        interview: item,
        calendarItem: editableCalendarMap.get(`interview-${item.id}`),
      };
    });
    const recruitmentEventItems = companyRecruitmentEvents.map((item) => {
      const application = applicationMap.get(item.applicationId);
      return {
        id: `event-${item.id}`,
        date: item.startsAt,
        type: calendarKindLabel(item.eventType),
        title: application?.position ?? "关联岗位",
        detail: [item.title, item.mode, item.location, item.status].filter(Boolean).join(" · "),
        tone: item.eventType,
        interview: undefined as Interview | undefined,
        calendarItem: editableCalendarMap.get(`event-${item.id}`),
      };
    });
    return [...deliveryEvents, ...interviewEvents, ...recruitmentEventItems]
      .filter((item) => item.date)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [companyApplications, companyCalendarItems, companyInterviews, companyRecruitmentEvents]);

  // ────────────────────────────────── render
  return (
    <div className={`app-shell workspace-active-${view}`}>
      <datalist id="rejection-reason-options">
        {REJECTION_REASON_OPTIONS.map((option) => <option key={option} value={option} />)}
      </datalist>
      {showProcessingHint && pendingAction && (
        <div className="processing-overlay" role="status" aria-live="polite" aria-busy="true">
          <div className="processing-card">
            <span className="processing-spinner" aria-hidden="true" />
            <div>
              <strong>{pendingAction}</strong>
              <small>正在同步，请稍候</small>
            </div>
          </div>
        </div>
      )}
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">秋</span>
          <span>
            <strong>秋招同行录</strong>
            <small>求职记录</small>
          </span>
        </a>
        <div className="top-actions">
          {user ? (
            <div className="account-menu">
              <a className="account-avatar" href="/account" title="账户中心">
                {user.displayName.slice(0, 1).toUpperCase()}
              </a>
              <div className="account-copy">
                <strong>{user.displayName}</strong>
                <small>{user.email}</small>
              </div>
              <a className="account-center-link" href="/account">
                账户中心
              </a>
              <button className="account-signout" onClick={() => void onSignOut?.()}>
                退出登录
              </button>
            </div>
          ) : (
            <a className="primary-button button-link" href={signInPath}>
              登录
            </a>
          )}
        </div>
      </header>

      <section className="workspace-intro" aria-label="求职工作台">
        <div><h1>我的求职记录</h1><p>{user ? "已连接云端同步" : "保存在当前浏览器"}</p></div>
        <button className="primary-button" onClick={() => { changeWorkspaceView("mine"); openCreate(); }}>＋ 新增投递</button>
      </section>

      <section className="stats-grid">
        <button type="button" className={["stat-card", statFilter === "all" ? "is-selected" : ""].filter(Boolean).join(" ")} onClick={() => openStatFilter("all")} aria-pressed={statFilter === "all"} aria-label={"\u67e5\u770b\u5168\u90e8\u6295\u9012"}>
          <span className="stat-icon ink">⌗</span>
          <div><small>总投递</small><strong>{stats.total}</strong><span>累计投递</span></div>
        </button>
        <button type="button" className={["stat-card", statFilter === "active" ? "is-selected" : ""].filter(Boolean).join(" ")} onClick={() => openStatFilter("active")} aria-pressed={statFilter === "active"} aria-label={"\u67e5\u770b\u8fdb\u884c\u4e2d\u6295\u9012"}>
          <span className="stat-icon blue">↗</span>
          <div><small>进行中</small><strong>{stats.active}</strong><span>个活跃流程</span></div>
        </button>
        <button type="button" className={["stat-card", statFilter === "interview" ? "is-selected" : ""].filter(Boolean).join(" ")} onClick={() => openStatFilter("interview")} aria-pressed={statFilter === "interview"} aria-label={"\u67e5\u770b\u9762\u8bd5\u9636\u6bb5\u6295\u9012"}>
          <span className="stat-icon amber">◌</span>
          <div><small>面试阶段</small><strong>{stats.interview}</strong><span>个待跟进</span></div>
        </button>
        <button type="button" className={["stat-card", "highlight", statFilter === "offer" ? "is-selected" : ""].filter(Boolean).join(" ")} onClick={() => openStatFilter("offer")} aria-pressed={statFilter === "offer"} aria-label={"\u67e5\u770b Offer \u6295\u9012"}>
          <span className="stat-icon green">✓</span>
          <div><small>Offer</small><strong>{stats.offers}</strong><span>已获得</span></div>
        </button>
      </section>

      <section className={`workspace workspace-${view}`}>
        <nav className="view-tabs" aria-label="工作台视图">
          <button className={view === "calendar" ? "active" : ""} onClick={() => changeWorkspaceView("calendar")}>
            <i className="view-tab-icon" aria-hidden="true">▦</i> 日程日历 <span>{calendarItems.length}</span>
          </button>
          <button className={view === "mine" ? "active" : ""} onClick={() => changeWorkspaceView("mine")}>
            <i className="view-tab-icon" aria-hidden="true">⌂</i> 我的投递 <span>{ownApplications.length}</span>
          </button>
          <button
            className={view === "dashboard" ? "active" : ""}
            onClick={() => { changeWorkspaceView("dashboard"); setSelectedApplicationIds([]); }}
          >
            <i className="view-tab-icon" aria-hidden="true">{"\u25eb"}</i> {"\u6570\u636e\u770b\u677f"}
          </button>
          <button
            className={view === "experiences" ? "active" : ""}
            onClick={() => { changeWorkspaceView("experiences"); setSelectedApplicationIds([]); }}
          >
            <i className="view-tab-icon" aria-hidden="true">{"\u2726"}</i> {"\u9762\u7ecf\u5e93"} <span>{experiences.length}</span>
          </button>
          <button
            className={view === "friends" ? "active" : ""}
            onClick={() => { changeWorkspaceView("friends"); setSelectedApplicationIds([]); }}
            disabled={!user}
          >
            <i className="view-tab-icon" aria-hidden="true">◎</i> 好友进度 <span>{friendApplications.length}</span>
          </button>
          <button
            className={view === "sharing" ? "active" : ""}
            onClick={() => { changeWorkspaceView("sharing"); setSelectedApplicationIds([]); }}
            disabled={!user}
          >
            <i className="view-tab-icon" aria-hidden="true">↗</i> 共享管理
          </button>
        </nav>

        {view === "calendar" ? (
          <>
            {user && !calendarReady && (
              <div className="migration-banner calendar-migration" role="status">
                <div><strong>日历数据库等待初始化</strong><p>现有岗位仍可查看；新增日程前请在 Supabase 执行 007_recruitment_calendar.sql。</p></div>
              </div>
            )}
            <RecruitmentCalendar
              items={calendarScope === "mine" ? calendarItems : friendCalendarItems}
              applications={calendarScope === "mine" ? ownApplications : friendCalendarApplications}
              busy={busy}
              scope={calendarScope}
              friendCount={friendCalendarOwnerCount}
              onScopeChange={setCalendarScope}
              onCreate={(date) => schedulableApplications.length ? openCalendarCreate(date) : ownApplications.length ? setNotice("当前没有可添加日程的进行中岗位") : openCreate()}
              onEdit={openCalendarEdit}
            />
            <section className="calendar-todo-panel" aria-label="招聘待做事项">
              <header className="calendar-todo-head">
                <div>
                  <h2>我的待做</h2>
                  <p>待安排的面试、待补充的面经与结果。</p>
                </div>
                <span><strong>{calendarTodos.length}</strong> 项待处理</span>
              </header>
              {calendarTodos.length ? (
                <div className="calendar-todo-list">
                  {calendarTodos.slice(0, 12).map((todo) => (
                    <article className={`calendar-todo-item ${todo.tone}`} key={todo.id}>
                      <div className="calendar-todo-state"><i aria-hidden="true" /><span>{todo.label}</span></div>
                      <div className="calendar-todo-copy">
                        <strong>{todo.title}</strong>
                        <small>{todo.detail}</small>
                      </div>
                      <time>{calendarTodoTime(todo.scheduledAt)}</time>
                      <div className="calendar-todo-actions">
                        <button type="button" className="todo-ignore-button" disabled={busy} onClick={() => void dismissCalendarTodo(todo)} title="只隐藏这条提醒，不删除原记录">忽略</button>
                        {externalHttpUrl(todo.application.link) ? (
                          <a className="todo-job-link" href={externalHttpUrl(todo.application.link)} target="_blank" rel="noopener noreferrer" title="打开该岗位的官网或投递进度页面">打开岗位链接 ↗</a>
                        ) : (
                          <button type="button" className="todo-job-link missing" disabled title="请先在岗位信息中填写官网或投递链接">未填写岗位链接</button>
                        )}
                        {todo.canComplete && todo.calendarItem && (
                          <button type="button" className="todo-complete-button" disabled={busy} onClick={() => void completeCalendarTodo(todo.calendarItem!)}>标记完成</button>
                        )}
                        <button
                          type="button"
                          className="todo-primary-button"
                          disabled={busy}
                          onClick={() => {
                            if (todo.action === "scheduleInterview") openCalendarCreate(new Date(), todo.application.id, "interview");
                            else if (todo.action === "writeExperience" && todo.interview) openExperienceByInterview(todo.interview);
                            else if (todo.calendarItem) openCalendarEdit(todo.calendarItem);
                          }}
                        >
                          {todo.action === "scheduleInterview" ? "定面试" : todo.action === "writeExperience" ? "补充面经" : "查看安排"} →
                        </button>
                      </div>
                    </article>
                  ))}
                  {calendarTodos.length > 12 && <p className="calendar-todo-more">优先显示最近的 12 项，完成后会自动展示后续待做。</p>}
                </div>
              ) : (
                <div className="calendar-todo-empty"><span>✓</span><div><strong>当前待做已经处理完毕</strong><small>新增测评或面试安排后，这里会自动生成提醒。</small></div></div>
              )}
            </section>
          </>
        ) : view === "experiences" ? (
          <section className="experience-library" aria-label={"\u9762\u7ecf\u5e93"}>
            <div className="experience-library-head">
              <div>
                <h2>{"\u9762\u7ecf\u5e93"}</h2>
                <p>{"\u628a\u6bcf\u6b21\u9762\u8bd5\u7684\u9ad8\u9891\u95ee\u9898\u3001\u56de\u7b54\u601d\u8def\u548c\u590d\u76d8\u8981\u70b9\u6c89\u6dc0\u4e0b\u6765\uff0c\u4e0b\u4e00\u6b21\u66f4\u4ece\u5bb9\u3002"}</p>
              </div>
              <button type="button" className="primary-button experience-create-button" onClick={() => openExperienceCreate()}>
                <span aria-hidden="true">+</span> {"\u8bb0\u5f55\u9762\u7ecf"}
              </button>
            </div>
            {experienceApplicationFilter && (
              <div className="experience-application-filter">
                <span>仅显示：{ownApplications.find((app) => app.id === experienceApplicationFilter)?.company ?? "该岗位"} 的面经</span>
                <button type="button" className="text-button" onClick={() => setExperienceApplicationFilter("")}>← 返回全部面经</button>
              </div>
            )}
            <div className="experience-library-tools">
              <label className="experience-search">
                <span aria-hidden="true">{"\u2315"}</span>
                <input value={experienceQuery} onChange={(event) => setExperienceQuery(event.target.value)} placeholder={"\u641c\u7d22\u516c\u53f8\u3001\u5c97\u4f4d\u3001\u9898\u76ee\u6216\u590d\u76d8\u5185\u5bb9\uff08\u652f\u6301\u62fc\u97f3\uff09"} />
              </label>
              <div className="experience-scope-tabs" aria-label="面经查看范围">
                <button type="button" className={experienceScope === "mine" ? "active" : ""} onClick={() => setExperienceScope("mine")}>我的</button>
                <button type="button" className={experienceScope === "friends" ? "active" : ""} onClick={() => setExperienceScope("friends")} disabled={!user}>好友共享</button>
                <button type="button" className={experienceScope === "all" ? "active" : ""} onClick={() => setExperienceScope("all")} disabled={!user}>全部</button>
              </div>
              <div className="experience-counts">
                <span><b>{experiences.filter((item) => item.isOwner !== false).length}</b> 我的面经</span>
                <span><b>{experiences.filter((item) => item.isOwner === false).length}</b> 好友共享</span>
                <span><b>{new Set(experiences.map((item) => item.company).filter(Boolean)).size}</b> {"\u5bb6\u516c\u53f8"}</span>
              </div>
            </div>
            {filteredExperiences.length === 0 ? (
              <div className="experience-empty">
                <div className="experience-empty-mark">{"\u2726"}</div>
                <h3>{experiences.length ? "\u6ca1\u6709\u627e\u5230\u5339\u914d\u7684\u9762\u7ecf" : "\u4ece\u7b2c\u4e00\u7bc7\u9762\u7ecf\u5f00\u59cb"}</h3>
                <p>{experiences.length ? "\u6362\u4e2a\u5173\u952e\u8bcd\u8bd5\u8bd5\uff0c\u4e5f\u53ef\u641c\u7d22\u62fc\u97f3\u3002" : "\u8bb0\u5f55\u9898\u76ee\u3001\u56de\u7b54\u601d\u8def\u4e0e\u590d\u76d8\u8981\u70b9\uff0c\u9010\u6b65\u5f62\u6210\u81ea\u5df1\u7684\u9762\u8bd5\u8d44\u6599\u5e93\u3002"}</p>
                {!experiences.length && <button type="button" className="secondary-button" onClick={() => openExperienceCreate()}>{"\u5199\u4e00\u7bc7\u9762\u7ecf"}</button>}
              </div>
            ) : (
              <div className="experience-grid">
                {filteredExperiences.map((experience) => (
                  <article className="experience-card" key={experience.id}>
                    <header>
                      <div>
                        <span className="experience-round">{experience.round || "\u901a\u7528\u590d\u76d8"}</span>
                        <h3>{experience.title}</h3>
                      </div>
                      <div className="experience-card-origin">
                        {experience.isOwner === false
                          ? <span className="experience-owner">{experience.ownerName || "好友"} 分享</span>
                          : <span className={`experience-visibility ${experience.visibility === "full" ? "shared" : ""}`}>{experience.visibility === "full" ? "已共享" : "仅自己"}</span>}
                        <time>{formatDateTime(experience.updatedAt)}</time>
                      </div>
                    </header>
                    {(experience.company || experience.position) && <p className="experience-company">{[experience.company, experience.position].filter(Boolean).join(" / ")}</p>}
                    {(() => {
                      const linkedInterview = interviews.find((interview) =>
                        interview.id === experience.interviewId ||
                        (!experience.interviewId && interview.applicationId === experience.applicationId && interviewStage(interview.round) === interviewStage(experience.round)),
                      );
                      if (linkedInterview) {
                        return (
                          <div className={`experience-interview-meta result-${linkedInterview.result || "待定"}`}>
                            <span className="eim-time">{formatInterviewDate(linkedInterview.scheduledAt)}</span>
                            <span className="eim-result">{linkedInterview.result || "结果待定"}</span>
                            {linkedInterview.format && <span className="eim-format">{linkedInterview.format}</span>}
                          </div>
                        );
                      }
                      return experience.applicationId ? <span className="experience-auto-link">已关联岗位 · 填写面试时间后自动建联</span> : null;
                    })()}
                    <p className="experience-content">{experience.content}</p>
                    {experience.takeaway && <div className="experience-takeaway"><strong>{"\u590d\u76d8\u8981\u70b9"}</strong><span>{experience.takeaway}</span></div>}
                    <footer>
                      {experience.isOwner !== false ? (
                        <>
                          <button type="button" className="text-button" onClick={() => openExperienceEdit(experience)}>{"\u7f16\u8f91"}</button>
                          <button type="button" className="text-button danger-text" onClick={() => void removeExperience(experience)}>{"\u5220\u9664"}</button>
                        </>
                      ) : <span className="experience-readonly">只读 · 来自共同小组</span>}
                    </footer>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : view === "dashboard" ? (
          <DashboardPanel
            applications={dashboardApplications}
            range={dashboardRange}
            onRangeChange={setDashboardRange}
            onOpenApplications={() => setView("mine")}
          />
        ) : view === "sharing" && user ? (
          <SharingPanel
            groups={groups}
            activeGroupId={activeGroupId}
            setActiveGroupId={setActiveGroupId}
            groupName={groupName}
            inviteCode={inviteCode}
            busy={busy}
            setGroupName={setGroupName}
            setInviteCode={setInviteCode}
            copyInviteCode={copyInviteCode}
            copyShareLink={copyShareLink}
            runAction={groupAction}
          />
        ) : (
          <>
            <div className="toolbar">
              <div className="toolbar-row">
                <div className="toolbar-search">
                  <span className="search-icon">🔍</span>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="搜索公司、岗位、地点… 支持拼音 / 首字母"
                    className="search-input"
                  />
                </div>
                <div className="toolbar-actions">
                  {view === "mine" ? (
                    <button className="primary-button" onClick={() => openCreate()}>
                      + 新增公司 / 岗位
                    </button>
                  ) : (
                    <span className="readonly-note">好友进度仅供查看</span>
                  )}
                  {view === "mine" && (
                    <>
                      <button className="secondary-button batch-select-button" onClick={toggleFilteredSelection} disabled={filteredIds.length === 0}>
                        {allFilteredSelected ? "取消当前筛选" : `全选当前筛选${filteredIds.length ? `（${filteredIds.length}）` : ""}`}
                      </button>
                      <button className="secondary-button" onClick={() => void exportData()} disabled={busy}>导出 Excel</button>
                      <input ref={importRef} type="file" accept=".xlsx,.json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/json" onChange={importData} className="hidden" />
                      <button className="secondary-button" onClick={() => importRef.current?.click()} disabled={busy}>导入备份</button>
                      <button
                        className="secondary-button recovery-button"
                        onClick={() => recoverySnapshots[0] && openRecoverySnapshot(recoverySnapshots[0])}
                        disabled={busy || recoverySnapshots.length === 0}
                        title={recoverySnapshots[0] ? `恢复 ${new Date(recoverySnapshots[0].savedAt).toLocaleString("zh-CN")} 的本地快照` : "产生非空记录后会自动保留本地快照"}
                      >
                        本地恢复{recoverySnapshots.length ? ` · ${recoverySnapshots.length}` : ""}
                      </button>
                    </>
                  )}
                </div>
              </div>
              {!interviewWorkspaceActive && <div className="view-mode-panel">
                <div className="view-mode-heading">
                  <strong>显示方式</strong>
                </div>
                <div className="view-mode-options" role="group" aria-label="清单显示方式">
                  {LIST_MODE_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      className={`view-mode-button ${listMode === option.value ? "active" : ""}`}
                      aria-pressed={listMode === option.value}
                      title={option.description}
                      onClick={() => changeListMode(option.value)}
                    >
                      <i className="view-mode-icon" aria-hidden="true">{option.icon}</i>
                      <span className="view-mode-copy">
                        <strong>{option.label}</strong>
                      </span>
                    </button>
                  ))}
                </div>
              </div>}
              <div className="quick-filter-row">
                <div className="quick-status-list" aria-label="快捷进度筛选">
                  {QUICK_STATUS_FILTERS.map((filter) => (
                    <button
                      type="button"
                      key={filter}
                      className={statusFilter === filter ? "active" : ""}
                      aria-pressed={statusFilter === filter}
                      onClick={() => {
                        setStatusFilter(filter);
                        setStatFilter(filter === "面试进行中" ? "interview" : "all");
                      }}
                    >
                      {filter === "全部状态" ? "全部" : filter}
                      <span>{quickStatusCounts.get(filter) ?? 0}</span>
                    </button>
                  ))}
                </div>
                <div className="filter-overview">
                  <span><strong>{companyGrouped.length}</strong> 家公司 · <strong>{filtered.length}</strong> 个岗位</span>
                  <button
                    type="button"
                    className={`filter-toggle ${filtersExpanded ? "active" : ""}`}
                    aria-expanded={filtersExpanded}
                    onClick={() => setFiltersExpanded((expanded) => !expanded)}
                  >
                    {filtersExpanded ? "收起筛选" : "更多筛选"}{activeFilterCount > 0 && <b>{activeFilterCount}</b>}
                  </button>
                </div>
              </div>
              {filtersExpanded && <div className="filter-row">
                <label className="sort-control">
                  <span>排序</span>
                  <DropdownSelect value={sortKey} onChange={(value) => {
                    const key = value as SortKey;
                    setSortKey(key);
                    setSortDirection(key === "appliedAt" ? "desc" : "asc");
                  }} options={[
                    { value: "appliedAt", label: "投递时间" }, { value: "company", label: "公司名称" }, { value: "status", label: "面试进度" }, { value: "position", label: "岗位名称" },
                  ]} ariaLabel="选择排序方式" />
                  <button
                    type="button"
                    onClick={() => setSortDirection((direction) => direction === "asc" ? "desc" : "asc")}
                    aria-label={sortDirection === "asc" ? "切换为降序" : "切换为升序"}
                  >
                    {sortDirection === "asc" ? "升序 ↑" : "降序 ↓"}
                  </button>
                </label>
                <DropdownSelect value={statusFilter} onChange={(status) => { setStatusFilter(status); setStatFilter(status === "面试进行中" ? "interview" : "all"); }} options={["全部状态", "简历阶段", "面试进行中", "流程已结束", ...STATUSES].map((option) => ({ value: option, label: option }))} ariaLabel="筛选状态" />
                <DropdownSelect value={batchFilter} onChange={setBatchFilter} options={["全部批次", ...BATCHES].map((option) => ({ value: option, label: option }))} ariaLabel="筛选批次" />
                <DropdownSelect value={companyNatureFilter} onChange={setCompanyNatureFilter} options={["全部单位性质", ...companyNatureOptions].map((option) => ({ value: option, label: option }))} ariaLabel="筛选单位性质" />
                <DropdownSelect value={industryFilter} onChange={setIndustryFilter} options={["全部行业方向", ...industryOptions].map((option) => ({ value: option, label: option }))} ariaLabel="筛选行业方向" />
                <DropdownSelect value={scaleFilter} onChange={setScaleFilter} options={["全部规模", ...companyScaleOptions].map((option) => ({ value: option, label: option }))} ariaLabel="筛选公司规模" />
                <input value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)} placeholder="岗位筛选" />
                <input value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} placeholder="输入地点筛选" />
                {activeFilterCount > 0 && <button className="secondary-button" onClick={clearFilters}>清除全部</button>}
              </div>}
            </div>

            {view === "mine" && <UpcomingScheduleCard items={calendarItems} onOpenCalendar={() => changeWorkspaceView("calendar")} onEdit={openCalendarEdit} />}

            {filtered.length > 0 && !interviewWorkspaceActive && (
              <section className="list-insights list-insights-top" aria-label="当前投递统计">
                <div className="list-insights-copy">
                  <h3>当前筛选</h3>
                </div>
                <div className="insight-rings">
                  {listInsights.map((insight) => (
                    <article
                      className="insight-card"
                      key={insight.label}
                      style={{ "--insight-color": insight.color } as CSSProperties}
                    >
                      <div
                        className="insight-ring"
                        style={{ "--insight-progress": `${insight.progress}%` } as CSSProperties}
                      >
                        <strong>{insight.value}</strong>
                        <small>{insight.unit}</small>
                      </div>
                      <div>
                        <strong>{insight.label}</strong>
                        <small>{insight.detail}</small>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {view === "mine" && selectedApplicationIds.length > 0 && (
              <div className="batch-action-bar" role="region" aria-label="批量修改投递">
                <div className="batch-selection-copy">
                  <strong>已选择 {selectedApplicationIds.length} 个岗位{selectedFilteredCount !== selectedApplicationIds.length && `（当前筛选内 ${selectedFilteredCount} 个）`}</strong>
                  <small>单位性质会同步到所选岗位所属的公司资料</small>
                  <button type="button" onClick={() => setSelectedApplicationIds([])}>取消选择</button>
                </div>
                <label>
                  <span>批量进度</span>
                  <DropdownSelect value={batchStatus} onChange={(status) => setBatchStatus(status as ApplicationStatus | "")} options={STATUSES.map((option) => ({ value: option, label: option }))} placeholder="保持不变" ariaLabel="批量设置进度" />
                </label>
                <label>
                  <span>统一单位性质</span>
                  <DropdownSelect value={batchCompanyNature} onChange={(companyNature) => { setBatchCompanyNature(companyNature); setBatchCompanySubtype(""); }} options={COMPANY_NATURE_OPTIONS.map(({ value }) => ({ value, label: value }))} placeholder="保持不变" ariaLabel="批量设置单位性质" />
                </label>
                {batchCompanyNature && (
                  <label>
                    <span>统一单位细分</span>
                    <DropdownSelect value={batchCompanySubtype} onChange={setBatchCompanySubtype} options={(COMPANY_NATURE_OPTIONS.find((option) => option.value === batchCompanyNature)?.subtypes ?? []).map((subtype) => ({ value: subtype, label: subtype }))} placeholder="暂不填写" ariaLabel="批量设置单位细分" />
                  </label>
                )}
                {batchStatus === "流程结束" && (
                  <label>
                    <span>最终状态</span>
                    <DropdownSelect value={batchFinalOutcome} onChange={setBatchFinalOutcome} options={FINAL_OUTCOME_OPTIONS.map((option) => ({ value: option, label: option }))} placeholder="请选择" ariaLabel="批量选择最终状态" />
                  </label>
                )}
                {batchStatus === "已拒绝" && (
                  <label>
                    <span>拒绝原因</span>
                    <input list="rejection-reason-options" value={batchRejectionReason} onChange={(e) => setBatchRejectionReason(e.target.value)} placeholder="填写或选择原因" />
                  </label>
                )}
                <label>
                  <span>批量公开</span>
                  <DropdownSelect value={batchVisibility} onChange={(visibility) => setBatchVisibility(visibility as Visibility | "")} options={VISIBILITY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} placeholder="保持不变" ariaLabel="批量设置公开范围" />
                </label>
                {batchVisibility && batchVisibility !== "private" && (groups.length > 0 ? (
                  <label>
                    <span>共享给</span>
                    <DropdownSelect value={batchGroupId || defaultGroupId} onChange={setBatchGroupId} options={groups.map((group) => ({ value: group.id, label: group.name }))} ariaLabel="选择共享小组" />
                  </label>
                ) : (
                  <div className="batch-share-hint">
                    <span>还没有可共享的小组</span>
                    <button type="button" onClick={() => { setView("sharing"); setSelectedApplicationIds([]); }}>去创建或加入</button>
                  </div>
                ))}
                <button className="primary-button" type="button" onClick={() => void applyBatchChanges()} disabled={busy}>
                  {busy ? "保存中…" : "应用修改"}
                </button>
              </div>
            )}

            {interviewWorkspaceActive ? (
              <section className="interview-stage-workspace" aria-label="面试进度">
                <header className="interview-stage-hero">
                  <div>
                    <h2>面试进度</h2>
                    <p>岗位按当前轮次分开排列；点「查看面经」进入该岗位全部面经与面试记录。</p>
                  </div>
                  <div className="interview-stage-summary">
                    <span><b>{filtered.length}</b> 个面试中岗位</span>
                    <span><b>{interviews.filter((interview) => filteredIds.includes(interview.applicationId)).length}</b> 场已安排</span>
                    <span><b>{experiences.filter((experience) => experience.applicationId && filteredIds.includes(experience.applicationId)).length}</b> 篇关联面经</span>
                  </div>
                </header>
                <div className="interview-stage-board-wrap">
                  <div className="interview-stage-board">
                    {INTERVIEW_STAGE_COLUMNS.map((stage) => {
                      const stageApplications = filtered.filter((item) => interviewStage(item.status) === stage.key);
                      return (
                        <section className={`interview-stage-column stage-${stage.key}`} key={stage.key}>
                          <header>
                            <div><strong>{stage.key}</strong><small>{stage.hint}</small></div>
                            <span>{stageApplications.length}</span>
                          </header>
                          <div className="interview-stage-cards">
                            {stageApplications.length === 0 ? (
                              <div className="interview-stage-empty">暂无处于{stage.key}的岗位</div>
                            ) : stageApplications.map((item) => (
                              <article className="interview-stage-card" key={item.id}>
                                <div className="interview-stage-card-head">
                                  <button type="button" onClick={() => openCompany(item.company)}>{item.company}</button>
                                  <span>{item.base || "地点待定"}</span>
                                </div>
                                <h3>{item.position}</h3>
                                <div className="interview-stage-current">
                                  <span>当前进度</span>{renderStatusControl(item, true)}
                                </div>
                                {renderScheduleStrip(item, true)}
                                {renderExperienceLink(item)}
                                <footer>
                                  <PositionLinkAction application={item} compact />
                                  {view === "mine" && <button type="button" onClick={() => openEdit(item)}>编辑岗位</button>}
                                </footer>
                              </article>
                            ))}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                </div>
              </section>
            ) : listMode === "companyList" ? (
              <div className="company-view company-list-view">
                {companyGrouped.length === 0 ? (
                  <div className="empty-state">
                    <span>{activeFilterCount > 0 ? "⌕" : "＋"}</span>
                    <h3>{activeFilterCount > 0 ? "没有符合条件的记录" : "还没有投递记录"}</h3>
                    <p>{activeFilterCount > 0 ? "换个筛选条件，已有数据不会受影响。" : "从第一家公司和岗位开始整理你的秋招进度。"}</p>
                    {activeFilterCount > 0
                      ? <button className="secondary-button" onClick={clearFilters}>清除全部筛选</button>
                      : view === "mine" && <button className="primary-button" onClick={() => openCreate()}>添加第一条投递</button>}
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table company-merge-table">
                      <thead>
                        <tr>
                          {view === "mine" && <th className="selection-column"><input ref={selectAllRef} type="checkbox" aria-label="全选当前筛选结果" checked={allFilteredSelected} onChange={toggleFilteredSelection} /></th>}
                          <th><button className="sort-button" onClick={() => toggleSort("company")}>公司 {sortIndicator("company")}</button></th>
                          <th>岗位</th>
                          <th>行业 / 规模</th>
                          <th>Base 地点</th>
                          <th><button className="sort-button" onClick={() => toggleSort("appliedAt")}>最近投递 {sortIndicator("appliedAt")}</button></th>
                          <th><button className="sort-button" onClick={() => toggleSort("status")}>进度概览 {sortIndicator("status")}</button></th>
                          <th>公开状态</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {companyGrouped.map((group) => (
                          <tr key={group.key} className="company-merge-row">
                            {view === "mine" && (
                              <td className="selection-column" data-label="选择">
                                <input
                                  type="checkbox"
                                  aria-label={`选择 ${group.company} 的全部岗位`}
                                  checked={group.applications.every((item) => selectedApplicationIds.includes(item.id))}
                                  onChange={() => toggleCompanySelection(group.applications.map((item) => item.id))}
                                />
                              </td>
                            )}
                            <td data-label="公司" className="company-merge-name">
                              <div className="company-name-lockup">
                                <span className="company-monogram" aria-hidden="true">{group.company.trim().slice(0, 1).toUpperCase()}</span>
                                <button className="company-link" onClick={() => openCompany(group.company)}>{group.company}</button>
                              </div>
                              {(group.companyNature || group.companySubtype) && (
                                <div className="company-merge-meta">
                                  {group.companyNature && <span className="company-nature-tag">{group.companyNature}</span>}
                                  {group.companySubtype && <span className="company-subtype-tag">{group.companySubtype}</span>}
                                </div>
                              )}
                            </td>
                            <td data-label="岗位">
                              <button className="position-count" onClick={() => openCompany(group.company)}>{group.applications.length} 个岗位</button>
                              <span className="company-row-hint">点击查看岗位明细</span>
                            </td>
                            <td data-label="行业 / 规模">
                              <div className="company-merge-meta">
                                {group.industryTags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
                                {group.industryTags.length > 3 && <span>+{group.industryTags.length - 3}</span>}
                                {group.companyScale && <span>{group.companyScale}</span>}
                              </div>
                            </td>
                            <td data-label="Base 地点" className="cell-muted">{group.bases.length ? group.bases.join("、") : "—"}</td>
                            <td data-label="最近投递" className="cell-muted">{formatDate(group.latestAppliedAt)}</td>
                            <td data-label="进度概览">
                              <div className="company-status-summary">
                                {group.statuses.slice(0, 3).map((status) => <span key={status} className={`status-badge ${statusTone(status)}`}>{status}</span>)}
                                {group.statuses.length > 3 && <span className="cell-muted">+{group.statuses.length - 3}</span>}
                                {group.conclusions.slice(0, 2).map((conclusion) => <span key={conclusion} className="company-conclusion">{conclusion}</span>)}
                              </div>
                              {renderCompanySchedule(group.applications)}
                            </td>
                            <td data-label="公开状态">
                              {group.visibilities.length === 1 ? (
                                <span className={`privacy-tag ${group.visibilities[0]}`}>{visibilityLabel(group.visibilities[0])}</span>
                              ) : (
                                <span className="privacy-tag mixed">部分共享 · {group.sharedCount}/{group.applications.length}</span>
                              )}
                            </td>
                            <td data-label="操作" className="cell-actions">
                              <div className="action-buttons company-row-actions">
                                {group.applications.filter((item) => externalHttpUrl(item.link) && (item.isOwner !== false || item.visibility === "full")).length === 1 && (
                                  <PositionLinkAction application={group.applications.find((item) => externalHttpUrl(item.link) && (item.isOwner !== false || item.visibility === "full"))!} compact />
                                )}
                                {group.applications.filter((item) => externalHttpUrl(item.link) && (item.isOwner !== false || item.visibility === "full")).length > 1 && (
                                  <button className="action-btn" type="button" onClick={() => openCompany(group.company)}>{group.applications.filter((item) => externalHttpUrl(item.link)).length} 个岗位链接</button>
                                )}
                                <button className="secondary-button compact-button" onClick={() => openCompany(group.company)}>查看公司</button>
                                {view === "mine" && <button className="action-btn" onClick={() => openCompanyEdit(group.company)}>编辑公司</button>}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : listMode === "companyCards" ? (
              <div className="company-view">
                {companyGrouped.length === 0 ? (
                  <div className="empty-state">
                    <span>{activeFilterCount > 0 ? "⌕" : "＋"}</span>
                    <h3>{activeFilterCount > 0 ? "没有符合条件的记录" : "还没有投递记录"}</h3>
                    <p>{activeFilterCount > 0 ? "换个筛选条件，已有数据不会受影响。" : "从第一家公司和岗位开始整理你的秋招进度。"}</p>
                    {activeFilterCount > 0
                      ? <button className="secondary-button" onClick={clearFilters}>清除全部筛选</button>
                      : view === "mine" && <button className="primary-button" onClick={() => openCreate()}>添加第一条投递</button>}
                  </div>
                ) : (
                  <div className="company-gallery">
                    <div className="company-gallery-head">
                      <div>
                        <strong>公司档案</strong>
                      </div>
                      <small>点击卡片查看该公司的全部岗位与面试时间线</small>
                    </div>
                    <div className="company-card-grid">
                      {companyGrouped.map((group) => {
                        const cardTone = group.statuses.includes("Offer")
                          ? "offer"
                          : group.statuses.some((status) => INTERVIEW_STATUSES.includes(status))
                            ? "interview"
                            : group.statuses.every((status) => ["已拒绝", "流程结束"].includes(status))
                              ? "closed"
                              : "active";
                        return (
                          <article className={`company-overview-card ${cardTone}`} key={group.key}>
                            <span className="company-card-accent" aria-hidden="true" />
                            <header className="company-card-head">
                              <button className="company-card-identity" type="button" onClick={() => openCompany(group.company)}>
                                <span className="company-card-monogram" aria-hidden="true">{group.company.trim().slice(0, 1).toUpperCase()}</span>
                                <span>
                                  <strong>{group.company}</strong>
                                  <small>{[group.companyNature, group.companySubtype].filter(Boolean).join(" · ") || "公司资料待补充"}</small>
                                </span>
                              </button>
                              <div className="company-card-tools">
                                <span className="company-card-stage">
                                  {cardTone === "offer" ? "已获 Offer" : cardTone === "interview" ? "面试推进中" : cardTone === "closed" ? "流程已结束" : "持续跟进"}
                                </span>
                                {view === "mine" && (
                                  <label className="company-card-selector" title="选择该公司的全部岗位">
                                    <input
                                      type="checkbox"
                                      aria-label={`选择 ${group.company} 的全部岗位`}
                                      checked={group.applications.every((item) => selectedApplicationIds.includes(item.id))}
                                      onChange={() => toggleCompanySelection(group.applications.map((item) => item.id))}
                                    />
                                    <span>全选</span>
                                  </label>
                                )}
                              </div>
                            </header>

                            <div className="company-card-tags">
                              {group.industryTags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
                              {group.industryTags.length > 3 && <span>+{group.industryTags.length - 3}</span>}
                              {group.companyScale && <span>{group.companyScale}</span>}
                              {group.industryTags.length === 0 && !group.companyScale && <span className="muted">尚未添加行业标签</span>}
                            </div>

                            <div className="company-card-metrics">
                              <button type="button" onClick={() => openCompany(group.company)}>
                                <strong>{group.applications.length}</strong><span>投递岗位</span>
                              </button>
                              <div><strong>{group.bases.length || "—"}</strong><span>{group.bases.length ? "Base 地点" : "地点待定"}</span></div>
                              <div><strong>{formatDate(group.latestAppliedAt)}</strong><span>最近投递</span></div>
                            </div>

                            <div className="company-card-progress">
                              <div className="company-card-section-title"><span>进度概览</span><small>{group.applications.length} 条记录</small></div>
                              <div className="company-status-summary">
                                {group.statuses.slice(0, 3).map((status) => <span key={status} className={`status-badge ${statusTone(status)}`}>{status}</span>)}
                                {group.statuses.length > 3 && <span className="status-more">+{group.statuses.length - 3}</span>}
                                {group.conclusions.slice(0, 1).map((conclusion) => <span key={conclusion} className="company-conclusion">{conclusion}</span>)}
                              </div>
                              {renderCompanySchedule(group.applications)}
                            </div>

                            <footer className="company-card-foot">
                              {group.visibilities.length === 1 ? (
                                <span className={`privacy-tag ${group.visibilities[0]}`}>{visibilityLabel(group.visibilities[0])}</span>
                              ) : (
                                <span className="privacy-tag mixed">部分共享 · {group.sharedCount}/{group.applications.length}</span>
                              )}
                              <div>
                                {group.applications.filter((item) => externalHttpUrl(item.link) && (item.isOwner !== false || item.visibility === "full")).length === 1 && (
                                  <PositionLinkAction application={group.applications.find((item) => externalHttpUrl(item.link) && (item.isOwner !== false || item.visibility === "full"))!} compact />
                                )}
                                {group.applications.filter((item) => externalHttpUrl(item.link) && (item.isOwner !== false || item.visibility === "full")).length > 1 && (
                                  <button className="company-card-edit" type="button" onClick={() => openCompany(group.company)}>查看岗位链接</button>
                                )}
                                {view === "mine" && <button className="company-card-edit" type="button" onClick={() => openCompanyEdit(group.company)}>编辑资料</button>}
                                <button className="company-card-open" type="button" onClick={() => openCompany(group.company)}>查看详情 <span>→</span></button>
                              </div>
                            </footer>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : listMode === "kanban" ? (
              <div className="kanban-board-wrap">
                <div className="kanban-board" aria-label="投递进度看板">
                  {KANBAN_COLUMNS.map((column) => {
                    const columnItems = filtered.filter((item) => column.statuses.includes(item.status));
                    return (
                      <section className={`kanban-column kanban-${column.key}`} key={column.key}>
                        <header className="kanban-column-head">
                          <div><strong>{column.label}</strong><small>{column.hint}</small></div>
                          <span>{columnItems.length}</span>
                        </header>
                        <div className="kanban-card-list">
                          {columnItems.length === 0 ? (
                            <div className="kanban-empty">暂无岗位</div>
                          ) : columnItems.map((item) => (
                            <article className="kanban-card" key={item.id}>
                              <div className="kanban-card-head">
                                {view === "mine" && (
                                  <input
                                    type="checkbox"
                                    aria-label={`选择 ${item.company} ${item.position}`}
                                    checked={selectedApplicationIds.includes(item.id)}
                                    onChange={() => toggleApplicationSelection(item.id)}
                                  />
                                )}
                                <button type="button" className="kanban-company" onClick={() => openCompany(item.company)}>{item.company}</button>
                                <span className={`privacy-dot ${item.visibility}`} title={visibilityLabel(item.visibility)} />
                              </div>
                              <strong className="kanban-position">{item.position}</strong>
                              <div className="kanban-meta">
                                <span>{item.base || "地点待定"}</span>
                                <span>{formatDate(item.appliedAt)}</span>
                              </div>
                              {renderScheduleStrip(item, true)}
                              {(INTERVIEW_STATUSES.includes(item.status) || experiences.some((experience) => experience.applicationId === item.id)) && renderExperienceLink(item, true)}
                              <div className="kanban-card-foot">
                                {renderStatusControl(item, true)}
                                <PositionLinkAction application={item} compact />
                                {view === "mine" && <button type="button" className="action-btn" onClick={() => openEdit(item)}>编辑</button>}
                              </div>
                            </article>
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="table-wrap">
                <table className={`data-table position-detail-table ${view === "mine" ? "owner-view" : "friend-view"}`}>
                  <thead>
                      <tr>
                        {view === "mine" && <th className="selection-column"><input ref={selectAllRef} type="checkbox" aria-label="全选当前筛选结果" checked={allFilteredSelected} onChange={toggleFilteredSelection} /></th>}
                        <th><button className="sort-button" onClick={() => toggleSort("company")}>公司 {sortIndicator("company")}</button></th>
                      <th><button className="sort-button" onClick={() => toggleSort("position")}>岗位 {sortIndicator("position")}</button></th>
                      <th>地点</th>
                      <th>批次</th>
                      <th><button className="sort-button" onClick={() => toggleSort("appliedAt")}>投递日期 {sortIndicator("appliedAt")}</button></th>
                      <th><button className="sort-button" onClick={() => toggleSort("status")}>面试进度 {sortIndicator("status")}</button></th>
                      <th>公开状态</th>
                      {view === "friends" && <th>岗位链接</th>}
                      {view === "mine" && <th>操作</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                        <tr>
                          <td colSpan={view === "mine" ? 9 : 8} className="empty-row">
                            <div className="empty-state">
                              <span>{activeFilterCount > 0 ? "⌕" : "＋"}</span>
                              <h3>{activeFilterCount > 0 ? "没有符合条件的记录" : "还没有投递记录"}</h3>
                              <p>{activeFilterCount > 0 ? "换个筛选条件，已有数据不会受影响。" : "从第一家公司和岗位开始整理你的秋招进度。"}</p>
                              {activeFilterCount > 0
                                ? <button className="secondary-button" onClick={clearFilters}>清除全部筛选</button>
                                : view === "mine" && <button className="primary-button" onClick={() => openCreate()}>添加第一条投递</button>}
                            </div>
                        </td>
                      </tr>
                    ) : (
                      filtered.map((item) => (
                        <tr key={item.id}>
                          {view === "mine" && (
                            <td className="selection-column" data-label="选择">
                              <input
                                type="checkbox"
                                aria-label={`选择 ${item.company} ${item.position}`}
                                checked={selectedApplicationIds.includes(item.id)}
                                onChange={() => toggleApplicationSelection(item.id)}
                              />
                            </td>
                          )}
                          <td className="cell-company" data-label="公司">
                            <button className="company-link" onClick={() => openCompany(item.company)}>
                              {item.company}
                            </button>
                          </td>
                          <td data-label="岗位">{item.position}</td>
                          <td className="cell-muted" data-label="地点">{item.base || "—"}</td>
                          <td data-label="批次"><span className="batch-tag">{item.batch}</span></td>
                          <td className="cell-muted" data-label="投递日期">{formatDate(item.appliedAt)}</td>
                          <td data-label="面试进度"><div className="status-result-cell">{renderStatusControl(item)}
                            {item.finalOutcome && <small>最终：{item.finalOutcome}</small>}
                            {item.rejectionReason && <small>原因：{item.rejectionReason}</small>}
                            {renderScheduleStrip(item, true)}
                            {(INTERVIEW_STATUSES.includes(item.status) || experiences.some((experience) => experience.applicationId === item.id)) && renderExperienceLink(item, true)}
                          </div></td>
                          <td data-label="公开状态"><span className={`privacy-tag ${item.visibility}`}>{visibilityLabel(item.visibility)}</span></td>
                          {view === "friends" && <td data-label="岗位链接"><PositionLinkAction application={item} /></td>}
                          {view === "mine" && (
                            <td className="cell-actions" data-label="操作">
                              <div className="action-buttons position-detail-actions">
                                {externalHttpUrl(item.link) && <><PositionLinkAction application={item} compact /><button className="action-btn" onClick={() => void copyPositionLink(item)} title="复制岗位链接">复制链接</button></>}
                                <button className="action-btn" onClick={() => openEdit(item)} title="编辑岗位信息">编辑岗位</button>
                                <button className="action-btn" onClick={() => openCreate(item)} title="复制创建同公司新岗位">复制</button>
                                <button className="action-btn" onClick={() => openExperienceCreate(item.id)} title="记录面经">记录面经</button>
                                <button className="action-btn danger" onClick={() => removeApplication(item)} title="删除">删除</button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {view === "mine" && actionReminders.length > 0 && (
              <section className="action-center" aria-label="待跟进提醒">
                <div className="action-center-head">
                  <div>
                    <span>待跟进提醒</span>
                    <h3>接下来要处理的事情</h3>
                  </div>
                  <small>根据面试安排、面经记录和最近更新时间自动生成</small>
                </div>
                <div className="action-reminder-list">
                  {actionReminders.map((reminder) => (
                    <article className={`action-reminder ${reminder.kind}`} key={reminder.id}>
                      <i className="reminder-icon" aria-hidden="true">
                        {reminder.kind === "upcoming" ? "◷" : reminder.kind === "experience" ? "✎" : reminder.kind === "result" ? "✓" : "↻"}
                      </i>
                      <span>{reminder.label}</span>
                      <strong>{reminder.title}</strong>
                      <small>{reminder.detail}</small>
                      <button
                        type="button"
                        onClick={() => reminder.calendarItem
                          ? openCalendarEdit(reminder.calendarItem)
                          : reminder.id.startsWith("missing-interview-")
                            ? openCalendarCreate(new Date(), reminder.application.id, "interview")
                            : reminder.interview
                              ? openExperienceByInterview(reminder.interview)
                              : openEdit(reminder.application)}
                      >
                        {reminder.id.startsWith("missing-interview-") ? "补充安排" : reminder.kind === "upcoming" ? "查看安排" : reminder.kind === "experience" ? "补充面经" : reminder.kind === "result" ? "补充结果" : "更新进度"} →
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            )}

          </>
        )}

        {importPreview && (
          <ModalPortal>
            <div className="modal-overlay modal-overlay-elevated">
              <div className="modal import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
                <div className="modal-head">
                  <div>
                    <h2 id="import-title">确认导入备份</h2>
                    <p className="modal-subtitle">已读取 {importPreview.fileName}。确认后将同时恢复岗位、面试、日程和面经关联。</p>
                  </div>
                  <button type="button" className="close-button" onClick={() => setImportPreview(null)} disabled={busy} aria-label="关闭">×</button>
                </div>
                <div className="import-summary-grid">
                  <div><strong>{importPreview.applications.length}</strong><span>岗位记录</span></div>
                  <div><strong>{importPreview.interviews.length}</strong><span>面试记录</span></div>
                  <div><strong>{importPreview.events.length}</strong><span>日程记录</span></div>
                  <div><strong>{importPreview.experiences.length}</strong><span>面经记录</span></div>
                  <div><strong>{importDuplicateCount}</strong><span>可能重复</span></div>
                </div>
                <div className="import-mode-list">
                  <label className={importMode === "merge" ? "active" : ""}>
                    <input type="radio" name="import-mode" value="merge" checked={importMode === "merge"} onChange={() => setImportMode("merge")} />
                    <span><strong>合并导入（推荐）</strong><small>保留现有记录，自动跳过相同的公司、岗位和投递日期。</small></span>
                  </label>
                  <label className={importMode === "replace" ? "active warning" : ""}>
                    <input type="radio" name="import-mode" value="replace" checked={importMode === "replace"} onChange={() => setImportMode("replace")} />
                    <span><strong>替换我的全部记录</strong><small>用备份内容覆盖当前账号下的岗位、面试、日程和面经；好友共享记录不受影响。</small></span>
                  </label>
                </div>
                <div className="import-notes">
                  <span>共享小组不会随备份迁移；找不到原小组的记录会安全地转为“仅自己可见”。</span>
                  {importPreview.ignoredInterviews > 0 && <span>{importPreview.ignoredInterviews} 条未关联岗位的面试记录不会导入。</span>}
                  {importPreview.ignoredExperiences > 0 && <span>{importPreview.ignoredExperiences} 篇格式不完整的面经不会导入。</span>}
                  {importPreview.ignoredEvents > 0 && <span>{importPreview.ignoredEvents} 条未关联岗位或格式不完整的日程不会导入。</span>}
                  {importMode === "merge" && importDuplicateCount > 0 && <span>{importDuplicateCount} 条可能重复的岗位将被跳过。</span>}
                </div>
                <div className="modal-actions import-actions">
                  <button type="button" className="secondary-button" onClick={() => setImportPreview(null)} disabled={busy}>取消</button>
                  <button type="button" className="primary-button" onClick={() => void applyImport()} disabled={busy}>
                    {busy ? "导入中…" : importMode === "replace" ? "确认替换并导入" : "开始合并导入"}
                  </button>
                </div>
              </div>
            </div>
          </ModalPortal>
        )}

        {/* ────────────────────────────────── form modal */}
        {isFormOpen && (
          <ModalPortal>
          <div className="modal-overlay">
            <div className="modal application-form-modal">
              <div className="modal-head">
                <div>
                  <h2>{editingId ? "编辑岗位投递" : "新增公司与岗位"}</h2>
                  <p className="modal-subtitle">先确定公司和岗位，再补充投递信息与共享范围。</p>
                </div>
                <button type="button" className="close-button" onClick={closeForm} aria-label="关闭">×</button>
              </div>
              <form onSubmit={submitForm}>
                <div className="form-grid">
                  <div className="form-section-heading full-width">
                    <span>1</span>
                    <div><strong>公司与岗位</strong><small>同一家公司可以一次添加多个岗位</small></div>
                  </div>
                  <label className="autocomplete-field">
                    <span>公司 *</span>
                    <input
                      value={form.company}
                      onChange={(e) => updateFormField("company", e.target.value)}
                      onFocus={() => setCompanyAutocompleteOpen(true)}
                      onBlur={() => setCompanyAutocompleteOpen(false)}
                      placeholder="输入公司名称，支持拼音联想"
                      autoComplete="off"
                      required
                    />
                    {companyAutocompleteOpen && form.company.trim() && companySuggestions.length > 0 && (
                      <div className="autocomplete-menu" role="listbox" aria-label="公司联想">
                        {companySuggestions.map((item) => (
                          <button
                            type="button"
                            key={item.id}
                            className="autocomplete-option"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyCompanySuggestion(item)}
                          >
                            <strong>{item.company}</strong>
                            <small>{industryOnly(item.industryTags ?? []).slice(0, 2).join(" · ") || "已有投递记录"}</small>
                          </button>
                        ))}
                      </div>
                    )}
                    <span className="field-hint">支持任意中文包含、拼音全拼和首字母，例如：宇 / 树 / yu / ys</span>
                  </label>
                  {editingId ? (
                    <label className="autocomplete-field">
                      <span>岗位 *</span>
                      <input
                        value={form.position}
                        onChange={(e) => updateFormField("position", e.target.value)}
                        onFocus={() => setPositionAutocompleteIndex("edit")}
                        onBlur={() => setPositionAutocompleteIndex(null)}
                        placeholder="输入岗位名称，支持拼音联想"
                        autoComplete="off"
                        required
                      />
                      {positionAutocompleteIndex === "edit" && form.position.trim() && positionSuggestions.search(form.position).length > 0 && (
                        <div className="autocomplete-menu" role="listbox" aria-label="岗位联想">
                          {positionSuggestions.search(form.position).map((item) => (
                            <button
                              type="button"
                              key={item.id}
                              className="autocomplete-option"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => { updateFormField("position", item.position); setPositionAutocompleteIndex(null); }}
                            >
                              <strong>{item.position}</strong>
                              <small>{item.company}{item.base ? ` · ${item.base}` : ""}</small>
                            </button>
                          ))}
                        </div>
                      )}
                    </label>
                  ) : (
                    <label className="full-width batch-position-field">
                      <span>岗位列表 *</span>
                      <span className="field-hint">每个岗位单独设置 Base 地点；渠道、批次、投递日期和公开范围会作为这一批岗位的共同信息。</span>
                      <div className="batch-position-list">
                        {batchPositions.map((entry, index) => (
                          <div className="batch-position-row" key={`position-${index}`}>
                            <div className="autocomplete-field position-autocomplete">
                              <input
                                value={entry.position}
                                onChange={(e) => setBatchPositions((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, position: e.target.value } : item))}
                                onFocus={() => setPositionAutocompleteIndex(index)}
                                onBlur={() => setPositionAutocompleteIndex(null)}
                                placeholder={`岗位 ${index + 1}，例如：算法工程师`}
                                autoComplete="off"
                                required={index === 0}
                              />
                              {positionAutocompleteIndex === index && entry.position.trim() && positionSuggestions.search(entry.position).length > 0 && (
                                <div className="autocomplete-menu" role="listbox" aria-label={`岗位 ${index + 1} 联想`}>
                                  {positionSuggestions.search(entry.position).map((item) => (
                                    <button
                                      type="button"
                                      key={item.id}
                                      className="autocomplete-option"
                                      onMouseDown={(event) => event.preventDefault()}
                                      onClick={() => {
                                        setBatchPositions((prev) => prev.map((current, itemIndex) => itemIndex === index ? { ...current, position: item.position } : current));
                                        setPositionAutocompleteIndex(null);
                                      }}
                                    >
                                      <strong>{item.position}</strong>
                                      <small>{item.company}{item.base ? ` · ${item.base}` : ""}</small>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="autocomplete-field batch-base-autocomplete">
                              <div className="combobox-input">
                                <input
                                  value={entry.base}
                                  onChange={(e) => setBatchPositions((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, base: e.target.value } : item))}
                                  onFocus={() => setBaseAutocompleteIndex(index)}
                                  onBlur={() => setBaseAutocompleteIndex(null)}
                                  placeholder="选择或输入地点"
                                  aria-label={`岗位 ${index + 1} 的 Base 地点`}
                                  autoComplete="off"
                                />
                                <button type="button" className="combobox-toggle" aria-label={`展开岗位 ${index + 1} 的地点选项`} onMouseDown={(event) => event.preventDefault()} onClick={() => setBaseAutocompleteIndex(index)}>⌄</button>
                              </div>
                              {baseAutocompleteIndex === index && matchingAutocompleteOptions(baseOptions, entry.base).length > 0 && (
                                <div className="autocomplete-menu" role="listbox" aria-label={`岗位 ${index + 1} 的地点联想`}>
                                  {matchingAutocompleteOptions(baseOptions, entry.base).map((option) => (
                                    <button
                                      type="button"
                                      key={option}
                                      className="autocomplete-option"
                                      onMouseDown={(event) => event.preventDefault()}
                                      onClick={() => {
                                        setBatchPositions((prev) => prev.map((current, itemIndex) => itemIndex === index ? { ...current, base: option } : current));
                                        setBaseAutocompleteIndex(null);
                                      }}
                                    >
                                      <strong>{option}</strong>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            {batchPositions.length > 1 && (
                              <button type="button" className="action-btn danger" onClick={() => setBatchPositions((prev) => prev.filter((_, itemIndex) => itemIndex !== index))} title="移除此岗位">✕</button>
                            )}
                          </div>
                        ))}
                      </div>
                      <button type="button" className="secondary-button batch-add-position" onClick={() => setBatchPositions((prev) => [...prev, { position: "", base: "" }])}>
                        + 再加一个岗位
                      </button>
                    </label>
                  )}
                  <div className="form-section-heading full-width">
                    <span>2</span>
                    <div><strong>投递信息</strong><small>记录批次、日期与当前进展</small></div>
                  </div>
                  {editingId && (
                    <label className="autocomplete-field">
                      <span>Base 地点</span>
                      <div className="combobox-input">
                        <input
                          value={form.base}
                          onChange={(e) => updateFormField("base", e.target.value)}
                          onFocus={() => setBaseAutocompleteIndex("edit")}
                          onBlur={() => setBaseAutocompleteIndex(null)}
                          placeholder="选择或输入地点"
                          autoComplete="off"
                        />
                        <button type="button" className="combobox-toggle" aria-label="展开地点选项" onMouseDown={(event) => event.preventDefault()} onClick={() => setBaseAutocompleteIndex("edit")}>⌄</button>
                      </div>
                      {baseAutocompleteIndex === "edit" && matchingAutocompleteOptions(baseOptions, form.base).length > 0 && (
                        <div className="autocomplete-menu" role="listbox" aria-label="地点联想">
                          {matchingAutocompleteOptions(baseOptions, form.base).map((option) => (
                            <button
                              type="button"
                              key={option}
                              className="autocomplete-option"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => { updateFormField("base", option); setBaseAutocompleteIndex(null); }}
                            >
                              <strong>{option}</strong>
                            </button>
                          ))}
                        </div>
                      )}
                    </label>
                  )}
                  <label>
                    <span>批次</span>
                    <DropdownSelect value={form.batch} onChange={(batch) => updateFormField("batch", batch)} options={BATCHES.map((batch) => ({ value: batch, label: batch }))} ariaLabel="选择投递批次" />
                  </label>
                  <label>
                    <span>投递日期</span>
                    <input type="date" value={form.appliedAt} onChange={(e) => updateFormField("appliedAt", e.target.value)} />
                  </label>
                  <label>
                    <span>状态</span>
                    <DropdownSelect value={form.status} onChange={(status) => updateFormField("status", status)} options={STATUSES.map((status) => ({ value: status, label: status }))} ariaLabel="选择当前状态" />
                  </label>
                  {form.status === "流程结束" && (
                    <label>
                      <span>最终走到哪一步 *</span>
                      <DropdownSelect value={form.finalOutcome} onChange={(finalOutcome) => updateFormField("finalOutcome", finalOutcome)} options={FINAL_OUTCOME_OPTIONS.map((option) => ({ value: option, label: option }))} placeholder="请选择最终状态" ariaLabel="选择最终状态" />
                    </label>
                  )}
                  {form.status === "已拒绝" && (
                    <label className="full-width">
                      <span>拒绝原因 *</span>
                      <input list="rejection-reason-options" value={form.rejectionReason} onChange={(e) => updateFormField("rejectionReason", e.target.value)} placeholder="例如：薪资不满足、已接受其他 Offer" required />
                    </label>
                  )}
                  <label className="autocomplete-field">
                    <span>投递渠道</span>
                    <div className="combobox-input">
                      <input
                        value={form.channel}
                        onChange={(e) => updateFormField("channel", e.target.value)}
                        onFocus={() => setChannelAutocompleteOpen(true)}
                        onBlur={() => setChannelAutocompleteOpen(false)}
                        placeholder="选择或输入渠道"
                        autoComplete="off"
                      />
                      <button type="button" className="combobox-toggle" aria-label="展开投递渠道选项" onMouseDown={(event) => event.preventDefault()} onClick={() => setChannelAutocompleteOpen(true)}>⌄</button>
                    </div>
                    {channelAutocompleteOpen && matchingAutocompleteOptions(platformOptions, form.channel).length > 0 && (
                      <div className="autocomplete-menu" role="listbox" aria-label="投递渠道联想">
                        {matchingAutocompleteOptions(platformOptions, form.channel).map((option) => (
                          <button
                            type="button"
                            key={option}
                            className="autocomplete-option"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => { updateFormField("channel", option); setChannelAutocompleteOpen(false); }}
                          >
                            <strong>{option}</strong>
                          </button>
                        ))}
                      </div>
                    )}
                  </label>
                  <label>
                    <span>链接</span>
                    <input value={form.link} onChange={(e) => updateFormField("link", e.target.value)} placeholder="https://…" />
                  </label>
                  <label>
                    <span>薪资</span>
                    <input value={form.salary} onChange={(e) => updateFormField("salary", e.target.value)} placeholder="例如 20k-30k" />
                  </label>
                  <label>
                    <span>公司规模</span>
                    <DropdownSelect value={form.companyScale} onChange={(companyScale) => updateFormField("companyScale", companyScale)} options={companyScaleOptions.map((option) => ({ value: option, label: option }))} placeholder="不限" ariaLabel="选择公司规模" />
                  </label>
                  <div className="form-section-heading full-width">
                    <span>3</span>
                    <div><strong>公司资料与共享</strong><small>公开时仅向所选小组成员展示</small></div>
                  </div>
                  <label>
                    <span>单位性质（大类）</span>
                    <DropdownSelect value={form.companyNature} onChange={(companyNature) => setForm((current) => ({ ...current, companyNature, companySubtype: "" }))} options={COMPANY_NATURE_OPTIONS.map(({ value }) => ({ value, label: value }))} placeholder="暂不填写" ariaLabel="选择单位性质" />
                  </label>
                  {form.companyNature && (
                    <label>
                      <span>单位细分</span>
                      <DropdownSelect value={form.companySubtype} onChange={(companySubtype) => updateFormField("companySubtype", companySubtype)} options={(COMPANY_NATURE_OPTIONS.find((option) => option.value === form.companyNature)?.subtypes ?? []).map((subtype) => ({ value: subtype, label: subtype }))} placeholder="暂不填写" ariaLabel="选择单位细分" />
                    </label>
                  )}
                  <label className="full-width">
                    <span>行业方向</span>
                    <div className="tag-selector">
                      {INDUSTRY_OPTIONS.map((tag: string) => (
                        <button
                          key={tag}
                          type="button"
                          className={`tag-option ${form.industryTags.includes(tag) ? "active" : ""}`}
                          onClick={() => {
                            const next = form.industryTags.includes(tag)
                              ? form.industryTags.filter((t) => t !== tag)
                              : [...form.industryTags, tag];
                            updateFormField("industryTags", next);
                          }}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                    <input
                      className="custom-tag-input"
                      value={form.industryTags.filter((tag) => !INDUSTRY_OPTIONS.includes(tag)).join("、")}
                      onChange={(event) => {
                        const customTags = event.target.value.split(/[、,，]/).map((tag) => tag.trim()).filter(Boolean);
                        updateFormField("industryTags", [
                          ...form.industryTags.filter((tag) => INDUSTRY_OPTIONS.includes(tag)),
                          ...customTags,
                        ]);
                      }}
                      placeholder="自定义标签，可用顿号分隔，例如：新能源、ToB"
                    />
                  </label>
                  <label className="full-width">
                    <span>备注</span>
                    <textarea value={form.note} onChange={(e) => updateFormField("note", e.target.value)} rows={2} />
                  </label>
                  <label className="full-width">
                    <span>可见性</span>
                    <DropdownSelect className="drop-up" value={form.visibility} onChange={(visibility) => updateFormField("visibility", visibility as Visibility)} options={VISIBILITY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} ariaLabel="选择公开范围" />
                  </label>
                  {form.visibility !== "private" && groups.length > 0 && (
                    <label className="full-width">
                      <span>共享到小组</span>
                      <DropdownSelect value={form.groupId || defaultGroupId} onChange={(groupId) => updateFormField("groupId", groupId)} options={groups.map((group) => ({ value: group.id, label: group.name }))} placeholder="选择小组…" ariaLabel="选择共享小组" />
                    </label>
                  )}
                  {form.visibility !== "private" && groups.length === 0 && (
                    <div className="share-setup-prompt full-width">
                      <div>
                        <strong>还没有可共享的小组</strong>
                        <small>先创建或加入小组，才能把这批投递共享给搭子。</small>
                      </div>
                      <button type="button" className="secondary-button" onClick={() => { closeForm(); setView("sharing"); }}>去创建或加入</button>
                    </div>
                  )}
                </div>
                <div className="form-actions">
                  <button type="submit" className="primary-button" disabled={busy || (form.visibility !== "private" && groups.length === 0)}>
                    {busy ? "保存中…" : editingId ? "保存修改" : "添加记录"}
                  </button>
                </div>
              </form>
            </div>
          </div>
          </ModalPortal>
        )}

        {/* ────────────────────────────────── company edit modal */}
        {isExperienceOpen && (
          <ModalPortal>
            <div className="modal-overlay modal-overlay-elevated">
              <div className="modal experience-form-modal" onClick={(event) => event.stopPropagation()}>
                <div className="modal-head">
                  <div>
                    <h2>{editingExperienceId ? "\u7f16\u8f91\u9762\u7ecf" : "\u8bb0\u5f55\u9762\u7ecf"}</h2>
                    <p className="modal-subtitle">{"\u8bb0\u5f55\u9898\u76ee\u3001\u56de\u7b54\u601d\u8def\u4e0e\u590d\u76d8\u8981\u70b9\uff1b\u4e5f\u53ef\u4ee5\u4e0d\u5173\u8054\u5177\u4f53\u5c97\u4f4d\u3002"}</p>
                  </div>
                  <button type="button" className="close-button" onClick={closeExperienceForm} aria-label={"\u5173\u95ed"}>{"\u00d7"}</button>
                </div>
                <form onSubmit={submitExperienceForm}>
                  <div className="form-grid experience-form-grid">
                    <label className="full-width">
                      <span>{"\u5173\u8054\u5c97\u4f4d\uff08\u53ef\u9009\uff09"}</span>
                      <DropdownSelect value={experienceForm.applicationId} onChange={selectExperienceApplication} options={ownApplications.map((app) => ({ value: app.id, label: `${app.company} \u00b7 ${app.position}` }))} placeholder={"\u4e0d\u5173\u8054\uff0c\u8bb0\u5f55\u901a\u7528\u9762\u7ecf"} ariaLabel={"\u9009\u62e9\u5173\u8054\u5c97\u4f4d"} />
                    </label>
                    {experienceForm.applicationId && interviews.some((item) => item.applicationId === experienceForm.applicationId) && (
                      <label className="full-width">
                        <span>关联面试场次</span>
                        <DropdownSelect
                          value={experienceForm.interviewId}
                          onChange={(interviewId) => {
                            const interview = interviews.find((item) => item.id === interviewId);
                            setExperienceForm((current) => ({
                              ...current,
                              interviewId,
                              round: interview?.round ?? current.round,
                              scheduledAt: interview ? dateTimeLocalValue(interview.scheduledAt) : current.scheduledAt,
                              endedAt: interview ? dateTimeLocalValue(interview.endedAt ?? "") : current.endedAt,
                              format: interview?.format ?? current.format,
                              result: interview?.result ?? current.result,
                              interviewer: interview?.interviewer ?? current.interviewer,
                            }));
                          }}
                          options={interviews
                            .filter((item) => item.applicationId === experienceForm.applicationId)
                            .sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""))
                            .map((item) => ({ value: item.id, label: `${item.round || "面试"} · ${formatInterviewDate(item.scheduledAt)}` }))}
                          placeholder="按轮次自动匹配"
                          ariaLabel="选择关联面试场次"
                        />
                        <small className="experience-link-hint">选择具体场次最准确；留空时会按岗位和轮次自动关联最近一场。</small>
                      </label>
                    )}
                    <label>
                      <span>{"\u9762\u8bd5\u65f6\u95f4"}{experienceForm.applicationId ? " *" : ""}</span>
                      <input type="datetime-local" value={experienceForm.scheduledAt} required={Boolean(experienceForm.applicationId)} onChange={(event) => setExperienceForm((current) => ({ ...current, scheduledAt: event.target.value }))} />
                    </label>
                    <label>
                      <span>{"\u7ed3\u675f\u65f6\u95f4"}</span>
                      <input type="datetime-local" value={experienceForm.endedAt} onChange={(event) => setExperienceForm((current) => ({ ...current, endedAt: event.target.value }))} />
                    </label>
                    {experienceForm.applicationId && (
                      <>
                        <label>
                          <span>形式</span>
                          <DropdownSelect value={experienceForm.format} onChange={(format) => setExperienceForm((current) => ({ ...current, format }))} options={INTERVIEW_FORMATS.map((option) => ({ value: option, label: option }))} placeholder="选择形式" ariaLabel="选择面试形式" />
                        </label>
                        <label>
                          <span>结果</span>
                          <DropdownSelect value={experienceForm.result} onChange={(result) => setExperienceForm((current) => ({ ...current, result }))} options={INTERVIEW_RESULTS.map((option) => ({ value: option, label: option }))} placeholder="选择结果" ariaLabel="选择面试结果" />
                        </label>
                      </>
                    )}
                    <label className="full-width">
                      <span>{"\u6807\u9898 *"}</span>
                      <input value={experienceForm.title} onChange={(event) => setExperienceForm((current) => ({ ...current, title: event.target.value }))} placeholder={"\u4f8b\u5982\uff1a\u4e00\u9762\u9ad8\u9891\u7b97\u6cd5\u9898\u4e0e\u9879\u76ee\u6df1\u6316"} required autoFocus />
                    </label>
                    <label>
                      <span>{"\u516c\u53f8"}</span>
                      <input value={experienceForm.company} onChange={(event) => setExperienceForm((current) => ({ ...current, company: event.target.value }))} placeholder={"\u4f8b\u5982\uff1a\u5b57\u8282\u8df3\u52a8"} />
                    </label>
                    <label>
                      <span>{"\u5c97\u4f4d"}</span>
                      <input value={experienceForm.position} onChange={(event) => setExperienceForm((current) => ({ ...current, position: event.target.value }))} placeholder={"\u4f8b\u5982\uff1a\u7b97\u6cd5\u5de5\u7a0b\u5e08"} />
                    </label>
                    <label>
                      <span>{"\u8f6e\u6b21"}</span>
                      <DropdownSelect value={experienceForm.round} onChange={(round) => setExperienceForm((current) => ({ ...current, round }))} options={[...INTERVIEW_ROUNDS, "\u7b14\u8bd5", "\u7efc\u5408\u590d\u76d8"].map((option) => ({ value: option, label: option }))} placeholder={"\u9009\u62e9\u6216\u7559\u7a7a"} ariaLabel={"\u9009\u62e9\u9762\u8bd5\u8f6e\u6b21"} />
                    </label>
                    <label className="full-width">
                      <span>{"\u9762\u8bd5\u5185\u5bb9 *"}</span>
                      <textarea value={experienceForm.content} onChange={(event) => setExperienceForm((current) => ({ ...current, content: event.target.value }))} rows={8} placeholder={"\u5199\u4e0b\u9898\u76ee\u3001\u8ffd\u95ee\u3001\u4f60\u7684\u56de\u7b54\u601d\u8def\u3001\u6ca1\u7b54\u597d\u7684\u5730\u65b9\u2026\u2026"} required />
                    </label>
                    <label className="full-width">
                      <span>{"\u590d\u76d8\u8981\u70b9"}</span>
                      <textarea value={experienceForm.takeaway} onChange={(event) => setExperienceForm((current) => ({ ...current, takeaway: event.target.value }))} rows={3} placeholder={"\u4e0b\u4e00\u6b21\u60f3\u4f18\u5316\u7684\u8868\u8fbe\u3001\u9700\u8981\u8865\u7684\u77e5\u8bc6\u70b9\u6216\u540e\u7eed\u884c\u52a8"} />
                    </label>
                    <label className="full-width privacy-field">
                      <span>共享范围</span>
                      <DropdownSelect
                        value={experienceForm.visibility}
                        onChange={(visibility) => setExperienceForm((current) => ({ ...current, visibility: visibility as "private" | "full", groupId: visibility === "private" ? "" : (current.groupId || defaultGroupId) }))}
                        options={[{ value: "private", label: "仅自己" }, { value: "full", label: "共享给好友" }]}
                        ariaLabel="选择面经共享范围"
                      />
                      <small>{experienceForm.visibility === "full" ? "共同小组成员可以只读查看这篇面经。" : "只有你自己可以查看。"}</small>
                    </label>
                    {experienceForm.visibility === "full" && groups.length > 0 && (
                      <label className="full-width">
                        <span>共享到小组</span>
                        <DropdownSelect value={experienceForm.groupId || defaultGroupId} onChange={(groupId) => setExperienceForm((current) => ({ ...current, groupId }))} options={groups.map((group) => ({ value: group.id, label: `${group.name} · ${group.members.length} 人` }))} ariaLabel="选择面经共享小组" />
                      </label>
                    )}
                    {experienceForm.visibility === "full" && groups.length === 0 && (
                      <div className="share-setup-prompt full-width">
                        <div><strong>还没有共享小组</strong><small>请先保存为“仅自己”，再到共享管理创建或加入小组。</small></div>
                      </div>
                    )}
                  </div>
                  <div className="form-actions">
                    {editingExperienceId && (
                      <button type="button" className="danger-button form-delete-button" disabled={busy} onClick={async () => {
                        const item = experiences.find((experience) => experience.id === editingExperienceId);
                        if (item && await removeExperience(item)) closeExperienceForm();
                      }}>
                        {"\u5220\u9664\u9762\u7ecf"}
                      </button>
                    )}
                    <button type="button" className="secondary-button" onClick={closeExperienceForm}>{"\u53d6\u6d88"}</button>
                    <button type="submit" className="primary-button" disabled={busy}>{busy ? "\u4fdd\u5b58\u4e2d\u2026" : editingExperienceId ? "\u4fdd\u5b58\u4fee\u6539" : "\u4fdd\u5b58\u9762\u7ecf"}</button>
                  </div>
                </form>
              </div>
            </div>
          </ModalPortal>
        )}

        {editingCompanyName && (
          <ModalPortal>
            <div className="modal-overlay modal-overlay-elevated">
              <div className="modal company-edit-modal" onClick={(event) => event.stopPropagation()}>
                <div className="modal-head">
                  <div>
                    <h2>修改公司信息</h2>
                    <p className="modal-subtitle">公司资料会同步更新到该公司的全部岗位，不会改变各岗位的投递进度。</p>
                  </div>
                  <button type="button" className="close-button" onClick={closeCompanyEdit} aria-label="关闭">×</button>
                </div>
                <form onSubmit={submitCompanyEdit}>
                  <div className="form-grid company-edit-grid">
                    <label className="full-width">
                      <span>公司名称 *</span>
                      <input
                        value={companyForm.name}
                        onChange={(event) => setCompanyForm((current) => ({ ...current, name: event.target.value }))}
                        placeholder="输入公司名称"
                        required
                        autoFocus
                      />
                    </label>
                    <label className="full-width">
                      <span>公司规模</span>
                      <DropdownSelect value={companyForm.companyScale} onChange={(companyScale) => setCompanyForm((current) => ({ ...current, companyScale }))} options={companyScaleOptions.map((scale) => ({ value: scale, label: scale }))} placeholder="暂不填写" ariaLabel="选择公司规模" />
                    </label>
                    <label>
                      <span>单位性质（大类）</span>
                      <DropdownSelect value={companyForm.companyNature} onChange={(companyNature) => setCompanyForm((current) => ({ ...current, companyNature, companySubtype: "" }))} options={COMPANY_NATURE_OPTIONS.map(({ value }) => ({ value, label: value }))} placeholder="暂不填写" ariaLabel="选择单位性质" />
                    </label>
                    {companyForm.companyNature && (
                      <label>
                        <span>单位细分</span>
                        <DropdownSelect value={companyForm.companySubtype} onChange={(companySubtype) => setCompanyForm((current) => ({ ...current, companySubtype }))} options={(COMPANY_NATURE_OPTIONS.find((option) => option.value === companyForm.companyNature)?.subtypes ?? []).map((subtype) => ({ value: subtype, label: subtype }))} placeholder="暂不填写" ariaLabel="选择单位细分" />
                      </label>
                    )}
                    <label className="full-width">
                      <span>行业方向</span>
                      <div className="tag-selector">
                        {INDUSTRY_OPTIONS.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            className={`tag-option ${companyForm.industryTags.includes(tag) ? "active" : ""}`}
                            onClick={() => setCompanyForm((current) => ({
                              ...current,
                              industryTags: current.industryTags.includes(tag)
                                ? current.industryTags.filter((item) => item !== tag)
                                : [...current.industryTags, tag],
                            }))}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                      <input
                        className="custom-tag-input"
                        value={companyForm.industryTags.filter((tag) => !INDUSTRY_OPTIONS.includes(tag)).join("、")}
                        onChange={(event) => {
                          const customTags = event.target.value.split(/[、,，]/).map((tag) => tag.trim()).filter(Boolean);
                          setCompanyForm((current) => ({
                            ...current,
                            industryTags: [
                              ...current.industryTags.filter((tag) => INDUSTRY_OPTIONS.includes(tag)),
                              ...customTags,
                            ],
                          }));
                        }}
                        placeholder="自定义标签，可用顿号分隔"
                      />
                    </label>
                  </div>
                  <div className="company-edit-impact">
                    将同步更新该公司下的 {ownApplications.filter((item) => companyKey(item.company) === companyKey(editingCompanyName)).length} 个岗位
                  </div>
                  <div className="form-actions">
                    <button type="button" className="secondary-button" onClick={closeCompanyEdit}>取消</button>
                    <button type="submit" className="primary-button" disabled={busy}>{busy ? "保存中…" : "保存公司信息"}</button>
                  </div>
                </form>
              </div>
            </div>
          </ModalPortal>
        )}

        {viewingFriendCalendarItem && (
          <ModalPortal>
            <div className="modal-overlay modal-overlay-elevated" onClick={() => setViewingFriendCalendarItem(null)}>
              <div className="modal friend-calendar-modal" role="dialog" aria-modal="true" aria-labelledby="friend-calendar-title" onClick={(event) => event.stopPropagation()}>
                <header className="modal-head">
                  <div>
                    <h2 id="friend-calendar-title">好友日程</h2>
                    <p>{viewingFriendCalendarItem.ownerName} 通过小组完整共享，内容仅供查看。</p>
                  </div>
                  <button className="icon-button" type="button" onClick={() => setViewingFriendCalendarItem(null)} aria-label="关闭好友日程">×</button>
                </header>
                <div className="friend-calendar-summary">
                  <span className={`friend-calendar-kind event-${viewingFriendCalendarItem.kind}`}>{calendarKindLabel(viewingFriendCalendarItem.kind)}</span>
                  <strong>{viewingFriendCalendarItem.title}</strong>
                  <p>{viewingFriendCalendarItem.company} · {viewingFriendCalendarItem.position}</p>
                  <dl>
                    <div><dt>记录阶段</dt><dd>{["未开始", "待进行", "已取消"].includes(viewingFriendCalendarItem.status) ? "约好的日程" : "已完成的记录"}</dd></div>
                    <div><dt>{viewingFriendCalendarItem.timingType === "deadline" ? "截止时间" : "开始时间"}</dt><dd>{formatDateTime(viewingFriendCalendarItem.startsAt)}</dd></div>
                    {viewingFriendCalendarItem.endsAt && <div><dt>结束时间</dt><dd>{formatDateTime(viewingFriendCalendarItem.endsAt)}</dd></div>}
                    {viewingFriendCalendarItem.mode && <div><dt>形式</dt><dd>{viewingFriendCalendarItem.mode}</dd></div>}
                    {viewingFriendCalendarItem.location && <div><dt>地点</dt><dd>{viewingFriendCalendarItem.location}</dd></div>}
                    <div><dt>状态 / 结果</dt><dd>{viewingFriendCalendarItem.status}</dd></div>
                  </dl>
                </div>
                <footer className="friend-calendar-actions">
                  {externalHttpUrl(viewingFriendCalendarItem.eventUrl) && <a className="secondary-button button-link" href={externalHttpUrl(viewingFriendCalendarItem.eventUrl)} target="_blank" rel="noopener noreferrer">打开共享链接 ↗</a>}
                  <button type="button" className="primary-button" onClick={() => setViewingFriendCalendarItem(null)}>知道了</button>
                </footer>
              </div>
            </div>
          </ModalPortal>
        )}

        {/* ────────────────────────────────── calendar event modal */}
        {isCalendarEventOpen && (
          <ModalPortal>
            <div className="modal-overlay modal-overlay-elevated" onClick={closeCalendarEvent}>
              <div className="modal calendar-event-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-event-title" onClick={(event) => event.stopPropagation()}>
                <header className="modal-head">
                  <div>
                    <h2 id="calendar-event-title">{editingCalendarItem ? "编辑日程" : "新增日程"}</h2>
                    <p>填写时间与安排，结束后可在这里补充结果。</p>
                  </div>
                  <button className="icon-button" type="button" onClick={closeCalendarEvent} aria-label="关闭日程编辑">×</button>
                </header>
                <form onSubmit={(event) => void submitCalendarEvent(event)}>
                  <div className="calendar-event-form-grid">
                    <div className="calendar-record-phase" role="group" aria-label="选择记录阶段">
                      <button
                        type="button"
                        className={calendarEventForm.phase === "scheduled" ? "active" : ""}
                        onClick={() => setCalendarEventForm((current) => ({
                          ...current,
                          phase: "scheduled",
                          endsAt: "",
                          status: current.kind === "interview" ? "未开始" : "待进行",
                          note: current.kind === "interview" ? "" : current.note,
                        }))}
                      >
                        <strong>约好的日程</strong><small>尚未开始，只填写安排信息</small>
                      </button>
                      <button
                        type="button"
                        className={calendarEventForm.phase === "completed" ? "active completed" : ""}
                        onClick={() => setCalendarEventForm((current) => ({
                          ...current,
                          phase: "completed",
                          status: current.kind === "interview" ? (current.status === "未开始" ? "待定" : current.status) : "已完成",
                        }))}
                      >
                        <strong>已完成的记录</strong><small>结束后补充结果与面经</small>
                      </button>
                    </div>
                    <label>
                      <span>事项类型 *</span>
                      <DropdownSelect
                        value={calendarEventForm.kind}
                        onChange={(kind) => setCalendarEventForm((current) => ({
                          ...current,
                          kind: kind as CalendarItemKind,
                          timingType: kind === "written_test" ? current.timingType : "scheduled",
                          title: current.kind === "interview" && kind !== "interview" ? "" : current.title,
                          round: kind === "interview" && current.kind !== "interview" ? defaultRoundForStage(interviewStage(ownApplications.find((item) => item.id === current.applicationId)?.status ?? "")) : current.round,
                          mode: kind === "interview" ? "视频面试" : "线上",
                          status: kind === "interview" ? (current.phase === "scheduled" ? "未开始" : "待定") : (current.phase === "completed" ? "已完成" : "待进行"),
                          allDay: kind === "deadline",
                          syncStatus: kind === "interview" || kind === "written_test",
                        }))}
                        options={[
                          { value: "interview", label: "面试" },
                          { value: "written_test", label: "笔试" },
                          { value: "assessment", label: "测评" },
                          { value: "deadline", label: "截止事项" },
                          { value: "hr_contact", label: "HR 沟通" },
                          { value: "other", label: "其他" },
                        ]}
                        ariaLabel="选择日程类型"
                      />
                    </label>
                    <label>
                      <span>关联公司 / 岗位 *</span>
                      <DropdownSelect
                        value={calendarEventForm.applicationId}
                        onChange={(applicationId) => setCalendarEventForm((current) => ({ ...current, applicationId }))}
                        options={calendarApplicationOptions.map((item) => ({ value: item.id, label: `${item.company} · ${item.position}` }))}
                        placeholder="选择岗位"
                        ariaLabel="选择日程关联岗位"
                      />
                    </label>

                    {calendarEventForm.kind === "interview" ? (
                      <label>
                        <span>面试轮次 *</span>
                        <DropdownSelect value={calendarEventForm.round} onChange={(round) => setCalendarEventForm((current) => ({ ...current, round }))} options={INTERVIEW_ROUNDS.map((round) => ({ value: round, label: round }))} ariaLabel="选择面试轮次" />
                      </label>
                    ) : (
                      <label className="calendar-event-title-field">
                        <span>标题</span>
                        <input value={calendarEventForm.title} onChange={(event) => setCalendarEventForm((current) => ({ ...current, title: event.target.value }))} placeholder={`例如：${calendarKindLabel(calendarEventForm.kind)}安排`} maxLength={180} />
                      </label>
                    )}

                    {calendarEventForm.kind === "written_test" && (
                      <div className="calendar-written-test-timing" role="group" aria-label="选择笔试时间类型">
                        <span>笔试时间类型 *</span>
                        <div>
                          <button type="button" className={calendarEventForm.timingType === "scheduled" ? "active" : ""} onClick={() => setCalendarEventForm((current) => ({ ...current, timingType: "scheduled", allDay: false }))}>
                            <strong>指定时间</strong><small>有明确的开考时间</small>
                          </button>
                          <button type="button" className={calendarEventForm.timingType === "deadline" ? "active" : ""} onClick={() => setCalendarEventForm((current) => ({ ...current, timingType: "deadline", allDay: true, endsAt: "" }))}>
                            <strong>截止时间</strong><small>在此之前自行完成</small>
                          </button>
                        </div>
                      </div>
                    )}

                    {calendarEventForm.kind !== "interview" && (
                      <label className="calendar-all-day-toggle">
                        <input type="checkbox" checked={calendarEventForm.allDay} onChange={(event) => setCalendarEventForm((current) => ({ ...current, allDay: event.target.checked }))} />
                        <span>{calendarEventForm.kind === "written_test" && calendarEventForm.timingType === "deadline" ? "只记录截止日期，不指定具体时刻" : "全天事项"}</span>
                      </label>
                    )}

                    <label>
                      <span>{calendarEventForm.kind === "written_test" && calendarEventForm.timingType === "deadline" ? "截止" : "开始"}{calendarEventForm.allDay ? "日期" : "时间"} *</span>
                      <input
                        type={calendarEventForm.allDay ? "date" : "datetime-local"}
                        value={calendarEventForm.allDay ? calendarEventForm.startsAt.slice(0, 10) : calendarEventForm.startsAt}
                        onChange={(event) => setCalendarEventForm((current) => ({ ...current, startsAt: current.allDay ? `${event.target.value}T09:00` : event.target.value }))}
                        required
                      />
                    </label>
                    {calendarEventForm.phase === "completed" && calendarEventForm.timingType !== "deadline" && (
                      <label>
                        <span>结束{calendarEventForm.allDay ? "日期" : "时间"}</span>
                        <input
                          type={calendarEventForm.allDay ? "date" : "datetime-local"}
                          value={calendarEventForm.allDay ? calendarEventForm.endsAt.slice(0, 10) : calendarEventForm.endsAt}
                          onChange={(event) => setCalendarEventForm((current) => ({ ...current, endsAt: current.allDay && event.target.value ? `${event.target.value}T18:00` : event.target.value }))}
                        />
                      </label>
                    )}
                    <label>
                      <span>{calendarEventForm.kind === "interview" ? "面试形式" : "进行形式"}</span>
                      <DropdownSelect value={calendarEventForm.mode} onChange={(mode) => setCalendarEventForm((current) => ({ ...current, mode }))} options={(calendarEventForm.kind === "interview" ? INTERVIEW_FORMATS : CALENDAR_EVENT_MODES).map((mode) => ({ value: mode, label: mode }))} ariaLabel="选择日程形式" />
                    </label>
                    {calendarEventForm.phase === "completed" && calendarEventForm.kind === "interview" && (
                      <label>
                        <span>面试结果</span>
                        <DropdownSelect value={calendarEventForm.status === "未开始" ? "待定" : calendarEventForm.status} onChange={(status) => setCalendarEventForm((current) => ({ ...current, status }))} options={INTERVIEW_RESULTS.map((status) => ({ value: status, label: status }))} ariaLabel="选择面试结果" />
                      </label>
                    )}
                    {calendarEventForm.phase === "scheduled" && calendarEventForm.kind !== "interview" && (
                      <label>
                        <span>安排状态</span>
                        <DropdownSelect value={calendarEventForm.status === "已取消" ? "已取消" : "待进行"} onChange={(status) => setCalendarEventForm((current) => ({ ...current, status }))} options={["待进行", "已取消"].map((status) => ({ value: status, label: status }))} ariaLabel="选择安排状态" />
                      </label>
                    )}
                    {calendarEventForm.phase === "completed" && calendarEventForm.kind !== "interview" && (
                      <div className="calendar-completed-note"><strong>✓ 保存为已完成</strong><small>保存后会从待做中移除，并保留在日历和统计中。</small></div>
                    )}
                    <label>
                      <span>地点</span>
                      <input value={calendarEventForm.location} onChange={(event) => setCalendarEventForm((current) => ({ ...current, location: event.target.value }))} placeholder="例如：线上 / 上海会议室" maxLength={240} />
                    </label>
                    <label>
                      <span>考试 / 会议链接</span>
                      <input type="url" value={calendarEventForm.eventUrl} onChange={(event) => setCalendarEventForm((current) => ({ ...current, eventUrl: event.target.value }))} placeholder="https://…" maxLength={1000} />
                    </label>
                    {(calendarEventForm.phase === "completed" || calendarEventForm.kind !== "interview") && (
                      <label className="calendar-event-note">
                        <span>{calendarEventForm.phase === "completed" ? "过程记录" : "准备事项"}</span>
                        <textarea value={calendarEventForm.note} onChange={(event) => setCalendarEventForm((current) => ({ ...current, note: event.target.value }))} rows={3} maxLength={3000} placeholder={calendarEventForm.phase === "completed" ? "补充过程、结果或后续行动" : "考试说明或需要携带的材料"} />
                      </label>
                    )}
                    {(calendarEventForm.kind === "interview" || calendarEventForm.kind === "written_test") && (
                      <label className="calendar-progress-toggle">
                        <input type="checkbox" checked={calendarEventForm.syncStatus} onChange={(event) => setCalendarEventForm((current) => ({ ...current, syncStatus: event.target.checked }))} />
                        <span><strong>同步岗位进度</strong><small>只向前推进，不会覆盖 Offer、已拒绝或已结束状态</small></span>
                      </label>
                    )}
                  </div>
                  <footer className="modal-actions calendar-event-actions">
                    <div>
                      {editingCalendarItem && <button type="button" className="danger-button" onClick={() => void removeCalendarEvent()} disabled={busy}>删除日程</button>}
                      {externalHttpUrl(calendarEventForm.eventUrl) && <a className="secondary-button button-link" href={externalHttpUrl(calendarEventForm.eventUrl)} target="_blank" rel="noopener noreferrer">打开链接 ↗</a>}
                      {editingCalendarInterview && editingCalendarInterviewStoredCompleted && calendarEventForm.phase === "completed" && (
                        <button type="button" className="secondary-button" disabled={busy} onClick={() => { closeCalendarEvent(); openExperienceByInterview(editingCalendarInterview); }}>
                          {editingCalendarInterviewHasExperience ? "编辑面经" : "补充面经"}
                        </button>
                      )}
                    </div>
                    <div><button type="button" className="secondary-button" onClick={closeCalendarEvent} disabled={busy}>取消</button><button type="submit" className="primary-button" disabled={busy || calendarApplicationOptions.length === 0}>{busy ? "保存中…" : calendarEventForm.phase === "scheduled" ? "保存约定日程" : "保存完成记录"}</button></div>
                  </footer>
                </form>
              </div>
            </div>
          </ModalPortal>
        )}

        {/* ────────────────────────────────── company modal */}
        {selectedCompany && (
          <ModalPortal>
          <div className="modal-overlay" onClick={closeCompany}>
            <div className="modal modal-wide company-detail-modal" onClick={(e) => e.stopPropagation()}>
              <div className="company-modal-header">
                <div>
                  <h2>{selectedCompany}</h2>
                  <p className="modal-subtitle">共 {companyApplications.length} 个岗位，集中查看和更新每次投递。</p>
                </div>
                <div className="company-modal-actions">
                  {view === "mine" && (
                    <>
                      <button className="secondary-button" onClick={() => openCompanyEdit(selectedCompany)}>编辑公司信息</button>
                      <button className="primary-button" onClick={() => { const src = companyApplications[0]; closeCompany(); openCreate(src); }}>+ 新增岗位</button>
                    </>
                  )}
                  <button type="button" className="close-button" onClick={closeCompany} aria-label="关闭">×</button>
                </div>
              </div>
              <div className="company-summary">
                <span><b>{companyApplications.length}</b>岗位总数</span>
                <span><b>{companyApplications.filter((item) => ![...CLOSED_STATUSES, "Offer"].includes(item.status)).length}</b>进行中</span>
                <span><b>{companyInterviews.length + companyRecruitmentEvents.length}</b>日程安排</span>
                <span><b>{companyApplications.filter((item) => item.visibility !== "private").length}</b>已共享</span>
              </div>
              {companyTimeline.length > 0 && (
                <details className="company-timeline">
                  <summary>
                    <span>投递与日程时间线</span>
                    <small>{companyTimeline.length} 个节点 · 点击展开</small>
                  </summary>
                  <div className="company-timeline-list">
                    {companyTimeline.map((event) => (
                      <article className={`company-timeline-event ${event.tone}`} key={event.id}>
                        <time>{formatDateTime(event.date)}</time>
                        <i aria-hidden="true" />
                        <div>
                          <span>{event.type}</span><strong>{event.title}</strong><small>{event.detail}</small>
                          {view === "mine" && event.calendarItem && <button type="button" onClick={() => { closeCompany(); openCalendarEdit(event.calendarItem!); }}>编辑日程</button>}
                          {view === "mine" && event.interview && <button type="button" onClick={() => { closeCompany(); openExperienceByInterview(event.interview!); }}>编辑面经</button>}
                        </div>
                      </article>
                    ))}
                  </div>
                </details>
              )}
              {view === "mine" && selectedApplicationIds.length > 0 && (
                <div className="batch-action-bar company-modal-batch">
                  <div className="batch-selection-copy">
                    <strong>已选择 {selectedApplicationIds.length} 个岗位</strong>
                    <small>统一设置后会同步更新这些岗位的公司资料</small>
                    <button type="button" onClick={() => setSelectedApplicationIds([])}>取消选择</button>
                  </div>
                  <label>
                    <span>批量进度</span>
                    <DropdownSelect value={batchStatus} onChange={(status) => setBatchStatus(status as ApplicationStatus | "")} options={STATUSES.map((option) => ({ value: option, label: option }))} placeholder="保持不变" ariaLabel="批量设置进度" />
                  </label>
                  <label>
                    <span>统一单位性质</span>
                    <DropdownSelect value={batchCompanyNature} onChange={(companyNature) => { setBatchCompanyNature(companyNature); setBatchCompanySubtype(""); }} options={COMPANY_NATURE_OPTIONS.map(({ value }) => ({ value, label: value }))} placeholder="保持不变" ariaLabel="批量设置单位性质" />
                  </label>
                  {batchCompanyNature && (
                    <label>
                      <span>统一单位细分</span>
                      <DropdownSelect value={batchCompanySubtype} onChange={setBatchCompanySubtype} options={(COMPANY_NATURE_OPTIONS.find((option) => option.value === batchCompanyNature)?.subtypes ?? []).map((subtype) => ({ value: subtype, label: subtype }))} placeholder="暂不填写" ariaLabel="批量设置单位细分" />
                    </label>
                  )}
                  {batchStatus === "流程结束" && (
                    <label>
                      <span>最终状态</span>
                      <DropdownSelect value={batchFinalOutcome} onChange={setBatchFinalOutcome} options={FINAL_OUTCOME_OPTIONS.map((option) => ({ value: option, label: option }))} placeholder="请选择" ariaLabel="批量选择最终状态" />
                    </label>
                  )}
                  {batchStatus === "已拒绝" && (
                    <label>
                      <span>拒绝原因</span>
                      <input list="rejection-reason-options" value={batchRejectionReason} onChange={(e) => setBatchRejectionReason(e.target.value)} placeholder="填写或选择原因" />
                    </label>
                  )}
                  <label>
                    <span>批量公开</span>
                    <DropdownSelect value={batchVisibility} onChange={(visibility) => setBatchVisibility(visibility as Visibility | "")} options={VISIBILITY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} placeholder="保持不变" ariaLabel="批量设置公开范围" />
                </label>
                {batchVisibility && batchVisibility !== "private" && (groups.length > 0 ? (
                  <label>
                    <span>共享给</span>
                    <DropdownSelect value={batchGroupId || defaultGroupId} onChange={setBatchGroupId} options={groups.map((group) => ({ value: group.id, label: group.name }))} ariaLabel="选择共享小组" />
                  </label>
                ) : (
                  <div className="batch-share-hint">
                    <span>还没有可共享的小组</span>
                    <button type="button" onClick={() => { closeCompany(); setView("sharing"); setSelectedApplicationIds([]); }}>去创建或加入</button>
                  </div>
                ))}
                <button className="primary-button" type="button" onClick={() => void applyBatchChanges()} disabled={busy}>
                    {busy ? "保存中…" : "应用修改"}
                  </button>
                </div>
              )}
              <div className="company-detail-table-wrap">
              <table className="data-table company-detail-table">
                <thead>
                  <tr>
                    {view === "mine" && <th className="selection-column"><input type="checkbox" aria-label="全选当前公司的岗位" checked={allCompanyApplicationsSelected} onChange={() => toggleCompanySelection(companyApplications.map((item) => item.id))} /></th>}
                    <th><button className="sort-button" onClick={() => toggleSort("position")}>岗位 {sortIndicator("position")}</button></th>
                    <th>地点</th>
                    <th>批次</th>
                    <th><button className="sort-button" onClick={() => toggleSort("appliedAt")}>投递日期 {sortIndicator("appliedAt")}</button></th>
                    <th><button className="sort-button" onClick={() => toggleSort("status")}>面试进度 {sortIndicator("status")}</button></th>
                    {view === "friends" && <th>岗位链接</th>}
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {companyApplications.map((item) => (
                    <tr key={item.id}>
                      {view === "mine" && (
                        <td className="selection-column" data-label="选择">
                          <input type="checkbox" aria-label={`选择 ${item.position}`} checked={selectedApplicationIds.includes(item.id)} onChange={() => toggleApplicationSelection(item.id)} />
                        </td>
                      )}
                      <td className="company-detail-position" data-label="岗位">{item.position}</td>
                      <td className="cell-muted" data-label="地点">{item.base || "—"}</td>
                      <td data-label="批次"><span className="batch-tag">{item.batch}</span></td>
                      <td className="cell-muted" data-label="投递日期">{formatDate(item.appliedAt)}</td>
                      <td data-label="面试进度"><div className="status-result-cell">{renderStatusControl(item)}
                        {item.finalOutcome && <small>最终：{item.finalOutcome}</small>}
                        {item.rejectionReason && <small>原因：{item.rejectionReason}</small>}
                        {companyInterviews.filter((interview) => interview.applicationId === item.id).length > 0 && (
                          <small>{companyInterviews.filter((interview) => interview.applicationId === item.id).length} 场面试记录</small>
                        )}
                        {renderScheduleStrip(item, true)}
                        {(INTERVIEW_STATUSES.includes(item.status) || experiences.some((experience) => experience.applicationId === item.id)) && renderExperienceLink(item, true)}
                      </div></td>
                      {view === "friends" && <td data-label="岗位链接"><PositionLinkAction application={item} /></td>}
                      <td className="cell-actions" data-label="操作">
                        {view === "mine" && externalHttpUrl(item.link) && <><PositionLinkAction application={item} compact /><button className="action-btn" onClick={() => void copyPositionLink(item)} title="复制岗位链接">复制</button></>}
                        {view === "mine" && <div className="action-buttons">
                          <button className="action-btn" onClick={() => openEdit(item)} title="编辑岗位信息">编辑岗位</button>
                          <button className="action-btn" onClick={() => { const src = item; closeCompany(); openCreate(src); }} title="复制创建同公司新岗位">复制</button>
                          <button className="action-btn" onClick={() => { closeCompany(); openExperienceCreate(item.id); }} title="记录面经">记录面经</button>
                          <button className="action-btn danger" onClick={() => removeApplication(item)} title="删除">删除</button>
                        </div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          </div>
          </ModalPortal>
        )}

        {/* ────────────────────────────────── notice toast */}
        {notice && (
          <ModalPortal>
            <div className={`notice-toast ${noticeTone}`} role={noticeTone === "error" ? "alert" : "status"} aria-live={noticeTone === "error" ? "assertive" : "polite"}>
              <span className="notice-toast-icon" aria-hidden="true">
                {noticeTone === "success" ? "✓" : noticeTone === "error" ? "!" : noticeTone === "warning" ? "△" : "i"}
              </span>
              <span className="notice-toast-message">{notice}</span>
              <button type="button" onClick={() => setNotice("")} aria-label="关闭提示">×</button>
            </div>
          </ModalPortal>
        )}
      </section>

      {/* ────────────────────────────────── footer */}
      <footer className="app-footer">
        <p>秋招同行录</p>
      </footer>
    </div>
  );
}
