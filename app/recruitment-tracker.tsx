"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { match } from "pinyin-pro";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { Application, Interview, GroupInfo, ApplicationStatus, Visibility } from "@/db/schema";
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

interface InterviewForm {
  applicationId: string;
  scheduledAt: string;
  endedAt: string;
  round: string;
  format: string;
  result: string;
  interviewer: string;
  summary: string;
  nextSteps: string;
}

interface ImportPreview {
  fileName: string;
  applications: Application[];
  interviews: Interview[];
  ignoredInterviews: number;
}

function ModalPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

// ──────────────────────────────────────────────── constants
const STATUSES: ApplicationStatus[] = ["准备投递", "简历投递", "已投递", "简历筛选", "笔试", "一面", "二面", "终面", "HR面", "Offer", "已拒绝", "流程结束"];
const INTERVIEW_STATUSES: ApplicationStatus[] = ["一面", "二面", "终面", "HR面"];
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

const FINAL_OUTCOME_OPTIONS = ["简历挂", "笔试挂", "一面挂", "二面挂", "终面挂", "HR 面挂", "薪资不满足", "岗位关闭", "主动终止", "其他"];
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

const EMPTY_INTERVIEW: InterviewForm = {
  applicationId: "",
  scheduledAt: "",
  endedAt: "",
  round: "",
  format: "",
  result: "",
  interviewer: "",
  summary: "",
  nextSteps: "",
};

const INTERVIEW_ROUNDS = ["技术一面", "技术二面", "技术三面", "交叉面", "主管面", "HR面", "群面", "VP面", "其他"];
const INTERVIEW_FORMATS = ["视频面试", "电话面试", "线下", "笔试", "其他"];
const INTERVIEW_RESULTS = ["待定", "通过", "未通过", "未参加"];

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

function companyKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

function autocompleteScore(value: string, query: string) {
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) return 0;
  const normalized = value.toLocaleLowerCase();
  if (normalized.startsWith(keyword)) return 100;
  if (normalized.includes(keyword)) return 80;
  const matchedIndexes = match(value, keyword, { precision: "start", lastPrecision: "start", insensitive: true });
  if (!matchedIndexes) return 0;
  return matchedIndexes[0] === 0 ? 70 : 50;
}

function matchingAutocompleteOptions(values: string[], query: string) {
  const options = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (!query.trim()) return options;
  return options
    .map((value) => ({ value, score: autocompleteScore(value, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.value.localeCompare(b.value, "zh-CN"))
    .slice(0, 6)
    .map(({ value }) => value);
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
  if (["一面", "二面", "终面", "HR面"].includes(status)) return "interview";
  if (status === "笔试") return "test";
  if (["已拒绝", "流程结束"].includes(status)) return "closed";
  return "default";
}

function visibilityLabel(visibility: Visibility) {
  if (visibility === "progress") return "共享进度";
  if (visibility === "full") return "完整共享";
  return "仅自己";
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
  return items.map((item) => ({ ...item, endedAt: item.endedAt ?? "" }));
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
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);
  const filteredOptions = options.filter((option) => `${option.label} ${option.hint ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside, true);
    };
  }, [open]);

  return (
    <div className={`select-field ${className}`} ref={rootRef}>
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
      {open && (
        <div className="select-popover" role="listbox" aria-label={ariaLabel}>
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
        </div>
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
          <p className="section-kicker">APPLICATION ANALYTICS</p>
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
  const [view, setView] = useState<"mine" | "friends" | "sharing" | "dashboard">("mine");
  const [dashboardRange, setDashboardRange] = useState<DashboardRange>("all");
  const [listMode, setListMode] = useState<"company" | "position" | "kanban">("company");
  const [sortKey, setSortKey] = useState<SortKey>("appliedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("全部状态");
  const [batchFilter, setBatchFilter] = useState("全部批次");
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
  const [isInterviewOpen, setIsInterviewOpen] = useState(false);
  const [editingInterviewId, setEditingInterviewId] = useState<string | null>(null);
  const [interviewForm, setInterviewForm] = useState(EMPTY_INTERVIEW);
  const [notice, setNotice] = useState("");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [groupName, setGroupName] = useState("秋招搭子小组");
  const [inviteCode, setInviteCode] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const inviteHandledRef = useRef(false);
  const busy = pendingAction !== null;
  const workspaceCacheKey = user ? `workspace-cache:${user.email}` : null;

  useEffect(() => {
    const timer = window.setTimeout(
      () => setShowProcessingHint(Boolean(pendingAction)),
      pendingAction ? 500 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [pendingAction]);

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
    const response = await fetch("/api/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(token
        ? { headers: { "content-type": "application/json", Authorization: `Bearer ${token}` } }
        : {}),
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(result.error || "操作失败");
  }, [accessToken]);

  const runCloudMutation = useCallback(async (
    label: string,
    payload: Record<string, unknown>,
    keepPending = false,
  ) => {
    setPendingAction(label);
    try {
      await cloudAction(payload);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败，请稍后重试");
      return false;
    } finally {
      if (!keepPending) setPendingAction(null);
    }
  }, [cloudAction]);

  const loadCloud = useCallback(async () => {
    let token = accessToken;
    if (!token) {
      const supabase = getSupabaseBrowserClient();
      const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
      token = data.session?.access_token ?? null;
    }
    if (!token) throw new Error("未登录");
    const response = await fetch("/api/workspace", {
      method: "GET",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    const result = (await response.json()) as {
      applications: unknown;
      interviews: unknown;
      groups: unknown;
    };
    if (!safeApplications(result.applications)) throw new Error("投递数据解析失败");
    if (!safeInterviews(result.interviews)) throw new Error("面试数据解析失败");
    const groupsData = (Array.isArray(result.groups) ? result.groups : []) as GroupInfo[];
    const normalizedApplications = result.applications.map((item) => ({
        ...item,
        visibility: item.visibility ?? "private",
        industryTags: Array.isArray(item.industryTags) ? item.industryTags.filter(Boolean) : [],
        companyScale: item.companyScale ?? "",
        isOwner: item.isOwner ?? true,
      }));
    const normalizedInterviews = normalizeInterviews(result.interviews);
    setApplications(normalizedApplications);
    setInterviews(normalizedInterviews);
    setGroups(groupsData);
    if (workspaceCacheKey) {
      try {
        localStorage.setItem(workspaceCacheKey, JSON.stringify({ applications: normalizedApplications, interviews: normalizedInterviews, groups: groupsData }));
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
  }, [accessToken, activeGroupId, workspaceCacheKey]);

  const loadLocal = useCallback(() => {
    try {
      if (workspaceCacheKey) {
        const cached = localStorage.getItem(workspaceCacheKey);
        if (cached) {
          const parsed = JSON.parse(cached) as { applications?: unknown; interviews?: unknown; groups?: unknown };
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
          if (Array.isArray(parsed.groups)) setGroups(parsed.groups as GroupInfo[]);
          return;
        }
      }
      const raw = localStorage.getItem("applications");
      const interviewsRaw = localStorage.getItem("interviews");
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
    } catch {
      // ignore
    }
  }, [workspaceCacheKey]);

  const saveLocal = useCallback(
    (items: Application[]) => {
      try {
        localStorage.setItem("applications", JSON.stringify(items));
        setLocalBackup(items);
      } catch {
        // ignore
      }
    },
    [],
  );

  const saveInterviewsLocal = useCallback(
    (items: Interview[]) => {
      try {
        localStorage.setItem("interviews", JSON.stringify(items));
      } catch {
        // ignore
      }
    },
    [],
  );

  // ────────────────────────────────── lifecycle
  useEffect(() => {
    loadLocal();
    if (user) {
      loadCloud().catch(() => {
        setNotice("暂时无法同步云端，已显示本机缓存");
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
    const interview = ownApplications.filter((a) => ["一面", "二面", "终面", "HR面"].includes(a.status)).length;
    const offers = ownApplications.filter((a) => a.status === "Offer").length;
    return { total, active, interview, offers };
  }, [ownApplications]);

  const filtered = useMemo(() => {
    const source = view === "friends" ? friendApplications : ownApplications;
    let items = source;
    if (query) {
      const q = query.trim().toLocaleLowerCase();
      items = items.filter(
        (item) =>
          item.company.toLocaleLowerCase().includes(q) ||
          item.position.toLocaleLowerCase().includes(q) ||
          (item.base ?? "").toLocaleLowerCase().includes(q) ||
          (item.note ?? "").toLocaleLowerCase().includes(q) ||
          (item.channel ?? "").toLocaleLowerCase().includes(q) ||
          (item.industryTags ?? []).join(" ").toLocaleLowerCase().includes(q),
      );
    }
    if (statusFilter !== "全部状态") items = items.filter((item) => matchesStatusFilter(item.status, statusFilter));
    if (batchFilter !== "全部批次") items = items.filter((item) => item.batch === batchFilter);
    if (companyNatureFilter !== "全部单位性质") items = items.filter((item) => companyClassification(item.industryTags ?? []).companyNature === companyNatureFilter);
    if (industryFilter !== "全部行业方向") items = items.filter((item) => industryOnly(item.industryTags ?? []).includes(industryFilter));
    if (scaleFilter !== "全部规模") items = items.filter((item) => item.companyScale === scaleFilter);
    if (positionFilter) items = items.filter((item) => item.position.toLocaleLowerCase().includes(positionFilter.toLocaleLowerCase()));
    if (locationFilter) items = items.filter((item) => (item.base ?? "").toLocaleLowerCase().includes(locationFilter.toLocaleLowerCase()));
    return items.slice().sort((a, b) => {
      const result = compareApplications(a, b, sortKey);
      return sortDirection === "asc" ? result : -result;
    });
  }, [query, statusFilter, batchFilter, companyNatureFilter, industryFilter, scaleFilter, positionFilter, locationFilter, view, ownApplications, friendApplications, sortKey, sortDirection]);

  const activeFilterCount = useMemo(() => [
    query.trim(),
    statusFilter !== "全部状态",
    batchFilter !== "全部批次",
    companyNatureFilter !== "全部单位性质",
    industryFilter !== "全部行业方向",
    scaleFilter !== "全部规模",
    positionFilter.trim(),
    locationFilter.trim(),
  ].filter(Boolean).length, [query, statusFilter, batchFilter, companyNatureFilter, industryFilter, scaleFilter, positionFilter, locationFilter]);

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
    const interviewCount = filtered.filter((item) => ["一面", "二面", "终面", "HR面"].includes(item.status)).length;
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
    const reminders: Array<{
      id: string;
      kind: "upcoming" | "result" | "stale";
      label: string;
      title: string;
      detail: string;
      priority: number;
      application: Application;
      interview?: Interview;
    }> = [];

    for (const interview of interviews) {
      const application = appById.get(interview.applicationId);
      if (!application) continue;
      const scheduledAt = new Date(interview.scheduledAt).getTime();
      if (!Number.isFinite(scheduledAt)) continue;
      const daysAway = (scheduledAt - now) / 86_400_000;
      if (daysAway >= 0 && daysAway <= 14) {
        upcomingApplicationIds.add(application.id);
        reminders.push({
          id: `upcoming-${interview.id}`,
          kind: "upcoming",
          label: "即将面试",
          title: `${application.company} · ${interview.round || "面试"}`,
          detail: `${formatDateTime(interview.scheduledAt)} · ${application.position}`,
          priority: scheduledAt,
          application,
          interview,
        });
      } else if (daysAway < 0 && daysAway >= -30 && (!interview.result || interview.result === "待定")) {
        reminders.push({
          id: `result-${interview.id}`,
          kind: "result",
          label: "待补结果",
          title: `${application.company} · ${interview.round || "面试"}`,
          detail: `${formatDateTime(interview.scheduledAt)} · 记录结果与复盘`,
          priority: now + 1_000_000_000 + Math.abs(scheduledAt - now),
          application,
          interview,
        });
      }
    }

    for (const application of ownApplications) {
      if ([...CLOSED_STATUSES, "Offer"].includes(application.status) || upcomingApplicationIds.has(application.id)) continue;
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
  }, [ownApplications, interviews]);

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
      if (!current) return false;
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
      setNotice("投递记录已删除");
    },
    [user, runCloudMutation],
  );

  const updateStatus = useCallback(
    async (id: string, status: ApplicationStatus) => {
      const current = applications.find((item) => item.id === id);
      if (!current) return;
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

  const addInterview = useCallback(
    async (item: Interview) => {
      if (user) {
        const saved = await runCloudMutation("保存面试安排中", { action: "saveInterview", interview: item });
        if (!saved) return false;
      }
      setInterviews((prev) => [...prev, item]);
      setNotice("面试安排已保存");
      return true;
    },
    [user, runCloudMutation],
  );

  const updateInterview = useCallback(
    async (id: string, changes: Partial<Interview>) => {
      const current = interviews.find((item) => item.id === id);
      if (!current) return false;
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

  const removeInterview = useCallback(
    async (item: Interview) => {
      if (!confirm(`确定删除这条面试记录吗？`)) return false;
      if (user) {
        const removed = await runCloudMutation("删除面试记录中", { action: "deleteInterview", id: item.id });
        if (!removed) return false;
      }
      setInterviews((prev) => prev.filter((entry) => entry.id !== item.id));
      setNotice("面试记录已删除");
      return true;
    },
    [user, runCloudMutation],
  );

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
          if (!activeGroupId || !confirm("确定删除这个小组吗？成员关系会一并移除，原投递记录会转为仅自己可见。")) return;
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

  const exportData = useCallback(() => {
    try {
      const ownIds = new Set(ownApplications.map((item) => item.id));
      const backup = {
        app: "秋招同行录",
        schemaVersion: 2,
        exportedAt: new Date().toISOString(),
        applications: ownApplications,
        interviews: interviews.filter((item) => ownIds.has(item.applicationId)),
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `投递记录备份_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }, [ownApplications, interviews]);

  const importData = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        if (!file.name.toLocaleLowerCase().endsWith(".json")) {
          setNotice("请选择从秋招同行录导出的 JSON 备份文件");
          return;
        }
        if (file.size > 5 * 1024 * 1024) {
          setNotice("备份文件不能超过 5MB");
          return;
        }
        const text = await file.text();
        const parsed = JSON.parse(text) as unknown;
        const data = Array.isArray(parsed)
          ? { applications: parsed }
          : parsed && typeof parsed === "object"
            ? parsed as { applications?: unknown; interviews?: unknown }
            : {};
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
        setImportPreview({
          fileName: file.name,
          applications: normalizedApplications,
          interviews: normalizedInterviews,
          ignoredInterviews,
        });
        setImportMode("merge");
      } catch {
        setNotice("无法读取备份文件，请确认它是有效的 JSON 文件");
      } finally {
        if (importRef.current) importRef.current.value = "";
      }
    },
    [],
  );

  const applyImport = useCallback(async () => {
    if (!importPreview) return;
    const availableGroupIds = new Set(groups.map((group) => group.id));
    const now = new Date().toISOString();
    const existingByKey = new Map(ownApplications.map((item) => [applicationImportKey(item), item]));
    const existingIds = new Set(ownApplications.map((item) => item.id));
    const idMap = new Map<string, string>();
    const accepted: Application[] = [];
    const seenIncomingKeys = new Set<string>();

    for (const source of importPreview.applications) {
      const key = applicationImportKey(source);
      if (importMode === "merge" && (existingIds.has(source.id) || existingByKey.has(key) || seenIncomingKeys.has(key))) continue;
      const item = importedApplication(source, availableGroupIds, defaultGroupId);
      const id = importMode === "merge" ? crypto.randomUUID() : item.id;
      idMap.set(source.id, id);
      seenIncomingKeys.add(key);
      accepted.push({ ...item, id, createdAt: item.createdAt || now, updatedAt: now });
    }

    const existingInterviewKeys = new Set(interviews.map((item) => `${item.applicationId}|${item.scheduledAt}|${item.round}`));
    const acceptedInterviews = importPreview.interviews
      .filter((item) => idMap.has(item.applicationId))
      .filter((item) => importMode === "replace" || !existingInterviewKeys.has(`${idMap.get(item.applicationId)}|${item.scheduledAt}|${item.round}`))
      .map((item) => ({
        ...item,
        id: importMode === "merge" ? crypto.randomUUID() : item.id,
        applicationId: idMap.get(item.applicationId)!,
        createdAt: item.createdAt || now,
        updatedAt: now,
      }));

    if (importMode === "merge" && !accepted.length && !acceptedInterviews.length) {
      setImportPreview(null);
      setNotice("没有可导入的新记录，重复的公司、岗位与投递日期已自动跳过");
      return;
    }
    if (user) {
      const saved = await runCloudMutation("正在导入并同步云端", {
        action: "importWorkspace",
        mode: importMode,
        applications: accepted,
        interviews: acceptedInterviews,
      });
      if (!saved) return;
    }
    if (importMode === "replace") {
      setApplications((current) => [...current.filter((item) => item.isOwner === false), ...accepted]);
      setInterviews(acceptedInterviews);
      saveLocal(accepted);
      saveInterviewsLocal(acceptedInterviews);
    } else {
      setApplications((current) => [...current, ...accepted]);
      setInterviews((current) => [...current, ...acceptedInterviews]);
      saveLocal([...ownApplications, ...accepted]);
      saveInterviewsLocal([...interviews, ...acceptedInterviews]);
    }
    setImportPreview(null);
    setNotice(`导入完成：新增 ${accepted.length} 个岗位${acceptedInterviews.length ? `、${acceptedInterviews.length} 条面试记录` : ""}`);
  }, [defaultGroupId, groups, importMode, importPreview, interviews, ownApplications, runCloudMutation, saveInterviewsLocal, saveLocal, user]);

  const clearFilters = useCallback(() => {
    setQuery("");
    setStatusFilter("全部状态");
    setBatchFilter("全部批次");
    setCompanyNatureFilter("全部单位性质");
    setIndustryFilter("全部行业方向");
    setScaleFilter("全部规模");
    setPositionFilter("");
    setLocationFilter("");
    setFiltersExpanded(false);
  }, []);

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

  // ────────────────────────────────── interview form
  function openInterviewCreate(applicationId = "") {
    setInterviewForm({ ...EMPTY_INTERVIEW, applicationId });
    setEditingInterviewId(null);
    setIsInterviewOpen(true);
  }

  function openInterviewEdit(item: Interview) {
    setInterviewForm({
      applicationId: item.applicationId,
      scheduledAt: item.scheduledAt,
      endedAt: item.endedAt ?? "",
      round: item.round,
      format: item.format,
      result: item.result,
      interviewer: item.interviewer ?? "",
      summary: item.summary ?? "",
      nextSteps: item.nextSteps ?? "",
    });
    setEditingInterviewId(item.id);
    setIsInterviewOpen(true);
  }

  function closeInterviewForm() {
    setIsInterviewOpen(false);
    setEditingInterviewId(null);
  }

  async function submitInterviewForm(event: React.FormEvent) {
    event.preventDefault();
    if (!interviewForm.applicationId || !interviewForm.scheduledAt) {
      setNotice("请选择关联岗位和面试时间");
      return;
    }
    let saved = false;
    if (editingInterviewId) {
      saved = await updateInterview(editingInterviewId, interviewForm);
    } else {
      const item: Interview = {
        id: crypto.randomUUID(),
        ...interviewForm,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      saved = await addInterview(item);
    }
    if (saved) closeInterviewForm();
  }

  // ────────────────────────────────── company modal
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
  const companyTimeline = useMemo(() => {
    const applicationMap = new Map(companyApplications.map((item) => [item.id, item]));
    const deliveryEvents = companyApplications.map((item) => ({
      id: `application-${item.id}`,
      date: item.appliedAt ? `${item.appliedAt}T00:00:00` : item.createdAt ?? item.updatedAt,
      type: "投递",
      title: item.position,
      detail: `${item.batch} · ${item.base || "地点待定"} · ${item.status}`,
      tone: "delivery",
      interview: undefined as Interview | undefined,
    }));
    const interviewEvents = companyInterviews.map((item) => {
      const application = applicationMap.get(item.applicationId);
      return {
        id: `interview-${item.id}`,
        date: item.scheduledAt,
        type: item.round || "面试",
        title: application?.position ?? "关联岗位",
        detail: [item.format, item.result, item.interviewer].filter(Boolean).join(" · ") || "等待补充面试信息",
        tone: "interview",
        interview: item,
      };
    });
    return [...deliveryEvents, ...interviewEvents]
      .filter((item) => item.date)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [companyApplications, companyInterviews]);

  // ────────────────────────────────── render
  return (
    <div className="app-shell">
      <datalist id="rejection-reason-options">
        {REJECTION_REASON_OPTIONS.map((option) => <option key={option} value={option} />)}
      </datalist>
      {showProcessingHint && pendingAction && (
        <div className="processing-overlay" role="status" aria-live="polite" aria-busy="true">
          <div className="processing-card">
            <span className="processing-spinner" aria-hidden="true" />
            <div>
              <strong>{pendingAction}</strong>
              <small>正在安全同步，请稍候</small>
            </div>
          </div>
        </div>
      )}
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">秋</span>
          <span>
            <strong>秋招同行录</strong>
            <small>投递进度 · 面试记录 · 小组共享</small>
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

      <section className="hero">
        <div className="hero-main">
          <p className="eyebrow"><span /> MXX CAREER STUDIO</p>
          <h1>让每一次投递，<br /><em>都有清晰的下一步。</em></h1>
          <p className="hero-copy">
            从公司与岗位，到面试时间线和最终 Offer，把秋招里容易散落的信息整理成一张清晰、可靠的行动地图。
          </p>
          <div className="hero-actions">
            <button className="primary-button hero-primary-action" onClick={() => { setView("mine"); openCreate(); }}>
              <span>＋</span> 记录新公司
            </button>
            <button className="hero-text-action" onClick={() => setView("dashboard")}>查看数据看板 <span>↗</span></button>
          </div>
          <div className="hero-signals" aria-label="产品能力">
            <span><i />公司与多岗位</span>
            <span><i />面试时间线</span>
            <span><i />好友隐私共享</span>
          </div>
        </div>
        <div className="hero-note" aria-label="使用提示">
          <div className="hero-note-topline">
            <span className="hero-note-label">SMART WORKFLOW</span>
            <span className="hero-note-status"><i /> {user ? "云端同步已连接" : "本地模式可直接使用"}</span>
          </div>
          <div className="hero-note-content">
            <span className="hero-note-icon">⌁</span>
            <div>
              <strong>一家公司，统一管理多个岗位</strong>
              <p>公司资料只需填写一次，岗位、面试和进度各自独立，回顾时更加清楚。</p>
            </div>
          </div>
          <div className="hero-note-flow" aria-hidden="true">
            <span>公司</span><i>→</i><span>岗位</span><i>→</i><span>面试</span><i>→</i><span>Offer</span>
          </div>
        </div>
      </section>

      <section className="stats-grid">
        <article className="stat-card">
          <span className="stat-icon ink">⌗</span>
          <div><small>总投递</small><strong>{stats.total}</strong><span>累计投递</span></div>
        </article>
        <article className="stat-card">
          <span className="stat-icon blue">↗</span>
          <div><small>进行中</small><strong>{stats.active}</strong><span>个活跃流程</span></div>
        </article>
        <article className="stat-card">
          <span className="stat-icon amber">◌</span>
          <div><small>面试阶段</small><strong>{stats.interview}</strong><span>个待跟进</span></div>
        </article>
        <article className="stat-card highlight">
          <span className="stat-icon green">✓</span>
          <div><small>Offer</small><strong>{stats.offers}</strong><span>继续加油</span></div>
        </article>
      </section>

      <section className={`workspace workspace-${view}`}>
        <nav className="view-tabs" aria-label="工作台视图">
          <button className={view === "mine" ? "active" : ""} onClick={() => setView("mine")}>
            <i className="view-tab-icon" aria-hidden="true">⌂</i> 我的投递 <span>{ownApplications.length}</span>
          </button>
          <button
            className={view === "dashboard" ? "active" : ""}
            onClick={() => { setView("dashboard"); setSelectedApplicationIds([]); }}
          >
            <i className="view-tab-icon" aria-hidden="true">◫</i> 数据看板
          </button>
          <button
            className={view === "friends" ? "active" : ""}
            onClick={() => { setView("friends"); setSelectedApplicationIds([]); }}
            disabled={!user}
          >
            <i className="view-tab-icon" aria-hidden="true">◎</i> 好友进度 <span>{friendApplications.length}</span>
          </button>
          <button
            className={view === "sharing" ? "active" : ""}
            onClick={() => { setView("sharing"); setSelectedApplicationIds([]); }}
            disabled={!user}
          >
            <i className="view-tab-icon" aria-hidden="true">↗</i> 共享管理
          </button>
        </nav>

        {view === "dashboard" ? (
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
                    placeholder="搜索公司、岗位、地点、标签、渠道…"
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
                  <div className="display-switch" aria-label="清单显示方式">
                    <button type="button" className={listMode === "company" ? "active" : ""} aria-pressed={listMode === "company"} onClick={() => setListMode("company")}>公司合并</button>
                    <button type="button" className={listMode === "position" ? "active" : ""} aria-pressed={listMode === "position"} onClick={() => setListMode("position")}>岗位明细</button>
                    <button type="button" className={listMode === "kanban" ? "active" : ""} aria-pressed={listMode === "kanban"} onClick={() => setListMode("kanban")}>进度看板</button>
                  </div>
                  {view === "mine" && (
                    <>
                      <button className="secondary-button batch-select-button" onClick={toggleFilteredSelection} disabled={filteredIds.length === 0}>
                        {allFilteredSelected ? "取消当前筛选" : `全选当前筛选${filteredIds.length ? `（${filteredIds.length}）` : ""}`}
                      </button>
                      <button className="secondary-button" onClick={exportData}>导出</button>
                      <input ref={importRef} type="file" accept=".json,application/json" onChange={importData} className="hidden" />
                      <button className="secondary-button" onClick={() => importRef.current?.click()} disabled={busy}>导入备份</button>
                    </>
                  )}
                </div>
              </div>
              <div className="quick-filter-row">
                <div className="quick-status-list" aria-label="快捷进度筛选">
                  {QUICK_STATUS_FILTERS.map((filter) => (
                    <button
                      type="button"
                      key={filter}
                      className={statusFilter === filter ? "active" : ""}
                      aria-pressed={statusFilter === filter}
                      onClick={() => setStatusFilter(filter)}
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
                <DropdownSelect value={statusFilter} onChange={setStatusFilter} options={["全部状态", "简历阶段", "面试进行中", "流程已结束", ...STATUSES].map((option) => ({ value: option, label: option }))} ariaLabel="筛选状态" />
                <DropdownSelect value={batchFilter} onChange={setBatchFilter} options={["全部批次", ...BATCHES].map((option) => ({ value: option, label: option }))} ariaLabel="筛选批次" />
                <DropdownSelect value={companyNatureFilter} onChange={setCompanyNatureFilter} options={["全部单位性质", ...companyNatureOptions].map((option) => ({ value: option, label: option }))} ariaLabel="筛选单位性质" />
                <DropdownSelect value={industryFilter} onChange={setIndustryFilter} options={["全部行业方向", ...industryOptions].map((option) => ({ value: option, label: option }))} ariaLabel="筛选行业方向" />
                <DropdownSelect value={scaleFilter} onChange={setScaleFilter} options={["全部规模", ...companyScaleOptions].map((option) => ({ value: option, label: option }))} ariaLabel="筛选公司规模" />
                <input value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)} placeholder="岗位筛选" />
                <input value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} placeholder="输入地点筛选" />
                {activeFilterCount > 0 && <button className="secondary-button" onClick={clearFilters}>清除全部</button>}
              </div>}
            </div>

            {filtered.length > 0 && (
              <section className="list-insights list-insights-top" aria-label="当前投递统计">
                <div className="list-insights-copy">
                  <span>当前清单统计</span>
                  <h3>投递进展一览</h3>
                  <p>统计会随上方的筛选条件和查看范围实时变化。</p>
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

            {listMode === "company" ? (
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
                                <button className="company-link" onClick={() => openCompany(group.company)}>
                                  {group.company}
                                </button>
                              </div>
                              {(group.companyNature || group.companySubtype) && (
                                <div className="company-merge-meta">
                                  {group.companyNature && <span className="company-nature-tag">{group.companyNature}</span>}
                                  {group.companySubtype && <span className="company-subtype-tag">{group.companySubtype}</span>}
                                </div>
                              )}
                            </td>
                            <td data-label="岗位">
                              <button className="position-count" onClick={() => openCompany(group.company)}>
                                {group.applications.length} 个岗位
                              </button>
                              <span className="company-row-hint">点击查看岗位明细</span>
                            </td>
                            <td data-label="行业 / 规模">
                              <div className="company-merge-meta">
                                {group.industryTags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
                                {group.companyScale && <span>{group.companyScale}</span>}
                              </div>
                            </td>
                            <td data-label="Base 地点" className="cell-muted">
                              {group.bases.length ? group.bases.join("、") : "—"}
                            </td>
                            <td data-label="最近投递" className="cell-muted">{formatDate(group.latestAppliedAt)}</td>
                            <td data-label="进度概览">
                              <div className="company-status-summary">
                                {group.statuses.slice(0, 3).map((status) => <span key={status} className={`status-badge ${statusTone(status)}`}>{status}</span>)}
                                {group.statuses.length > 3 && <span className="cell-muted">+{group.statuses.length - 3}</span>}
                                {group.conclusions.slice(0, 2).map((conclusion) => <span key={conclusion} className="company-conclusion">{conclusion}</span>)}
                              </div>
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
                              <div className="kanban-card-foot">
                                {renderStatusControl(item, true)}
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
                <table className="data-table">
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
                      <th>操作</th>
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
                          </div></td>
                          <td data-label="公开状态"><span className={`privacy-tag ${item.visibility}`}>{visibilityLabel(item.visibility)}</span></td>
                          <td className="cell-actions" data-label="操作">
                            {view === "mine" && (
                              <div className="action-buttons">
                                <button className="action-btn" onClick={() => openEdit(item)} title="编辑岗位信息">编辑岗位</button>
                                <button className="action-btn" onClick={() => openCreate(item)} title="复制创建同公司新岗位">复制</button>
                                <button className="action-btn" onClick={() => openInterviewCreate(item.id)} title="添加面试">添加面试</button>
                                <button className="action-btn danger" onClick={() => removeApplication(item)} title="删除">删除</button>
                              </div>
                            )}
                          </td>
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
                  <small>根据面试安排和最近更新时间自动生成</small>
                </div>
                <div className="action-reminder-list">
                  {actionReminders.map((reminder) => (
                    <article className={`action-reminder ${reminder.kind}`} key={reminder.id}>
                      <i className="reminder-icon" aria-hidden="true">
                        {reminder.kind === "upcoming" ? "◷" : reminder.kind === "result" ? "✓" : "↻"}
                      </i>
                      <span>{reminder.label}</span>
                      <strong>{reminder.title}</strong>
                      <small>{reminder.detail}</small>
                      <button
                        type="button"
                        onClick={() => reminder.interview ? openInterviewEdit(reminder.interview) : openEdit(reminder.application)}
                      >
                        {reminder.kind === "upcoming" ? "查看安排" : reminder.kind === "result" ? "补充结果" : "更新进度"} →
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
                    <p className="modal-kicker">IMPORT BACKUP</p>
                    <h2 id="import-title">确认导入备份</h2>
                    <p className="modal-subtitle">已读取 {importPreview.fileName}。选择处理方式后才会写入你的投递记录。</p>
                  </div>
                  <button type="button" className="close-button" onClick={() => setImportPreview(null)} disabled={busy} aria-label="关闭">×</button>
                </div>
                <div className="import-summary-grid">
                  <div><strong>{importPreview.applications.length}</strong><span>岗位记录</span></div>
                  <div><strong>{importPreview.interviews.length}</strong><span>面试记录</span></div>
                  <div><strong>{importDuplicateCount}</strong><span>可能重复</span></div>
                </div>
                <div className="import-mode-list">
                  <label className={importMode === "merge" ? "active" : ""}>
                    <input type="radio" name="import-mode" value="merge" checked={importMode === "merge"} onChange={() => setImportMode("merge")} />
                    <span><strong>合并导入（推荐）</strong><small>保留现有记录，自动跳过相同的公司、岗位和投递日期。</small></span>
                  </label>
                  <label className={importMode === "replace" ? "active warning" : ""}>
                    <input type="radio" name="import-mode" value="replace" checked={importMode === "replace"} onChange={() => setImportMode("replace")} />
                    <span><strong>替换我的全部记录</strong><small>用备份内容覆盖当前账号下的投递与面试记录；好友共享记录不受影响。</small></span>
                  </label>
                </div>
                <div className="import-notes">
                  <span>共享小组不会随备份迁移；找不到原小组的记录会安全地转为“仅自己可见”。</span>
                  {importPreview.ignoredInterviews > 0 && <span>{importPreview.ignoredInterviews} 条未关联岗位的面试记录不会导入。</span>}
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
                  <p className="modal-kicker">{editingId ? "EDIT APPLICATION" : "NEW APPLICATION"}</p>
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

        {/* ────────────────────────────────── interview form modal */}
        {isInterviewOpen && (
          <ModalPortal>
          <div className="modal-overlay">
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h2>{editingInterviewId ? "编辑面试" : "添加面试"}</h2>
              <form onSubmit={submitInterviewForm}>
                <div className="form-grid">
                  <label className="full-width">
                    关联岗位
                    <DropdownSelect value={interviewForm.applicationId} onChange={(applicationId) => setInterviewForm((prev) => ({ ...prev, applicationId }))} options={ownApplications.map((app) => ({ value: app.id, label: `${app.company} - ${app.position}` }))} placeholder="选择岗位…" ariaLabel="选择关联岗位" />
                  </label>
                  <label>
                    面试时间 *
                    <input
                      type="datetime-local"
                      value={interviewForm.scheduledAt}
                      onChange={(e) => setInterviewForm((prev) => ({ ...prev, scheduledAt: e.target.value }))}
                      required
                    />
                  </label>
                  <label>
                    结束时间
                    <input
                      type="datetime-local"
                      value={interviewForm.endedAt}
                      onChange={(e) => setInterviewForm((prev) => ({ ...prev, endedAt: e.target.value }))}
                    />
                  </label>
                  <label>
                    轮次
                    <DropdownSelect value={interviewForm.round} onChange={(round) => setInterviewForm((prev) => ({ ...prev, round }))} options={INTERVIEW_ROUNDS.map((option) => ({ value: option, label: option }))} placeholder="选择轮次" ariaLabel="选择面试轮次" />
                  </label>
                  <label>
                    形式
                    <DropdownSelect value={interviewForm.format} onChange={(format) => setInterviewForm((prev) => ({ ...prev, format }))} options={INTERVIEW_FORMATS.map((option) => ({ value: option, label: option }))} placeholder="选择形式" ariaLabel="选择面试形式" />
                  </label>
                  <label>
                    结果
                    <DropdownSelect value={interviewForm.result} onChange={(result) => setInterviewForm((prev) => ({ ...prev, result }))} options={INTERVIEW_RESULTS.map((option) => ({ value: option, label: option }))} placeholder="选择结果" ariaLabel="选择面试结果" />
                  </label>
                  <label>
                    面试官
                    <input
                      value={interviewForm.interviewer}
                      onChange={(e) => setInterviewForm((prev) => ({ ...prev, interviewer: e.target.value }))}
                      placeholder="姓名/职位"
                    />
                  </label>
                  <label className="full-width">
                    总结
                    <textarea
                      value={interviewForm.summary}
                      onChange={(e) => setInterviewForm((prev) => ({ ...prev, summary: e.target.value }))}
                      rows={2}
                    />
                  </label>
                  <label className="full-width">
                    后续安排
                    <textarea
                      value={interviewForm.nextSteps}
                      onChange={(e) => setInterviewForm((prev) => ({ ...prev, nextSteps: e.target.value }))}
                      rows={2}
                    />
                  </label>
                </div>
                <div className="form-actions">
                  {editingInterviewId && (
                    <button
                      type="button"
                      className="danger-button form-delete-button"
                      disabled={busy}
                      onClick={async () => {
                        const item = interviews.find((interview) => interview.id === editingInterviewId);
                        if (!item) return;
                        if (await removeInterview(item)) closeInterviewForm();
                      }}
                    >
                      删除记录
                    </button>
                  )}
                  <button type="button" className="secondary-button" onClick={closeInterviewForm}>取消</button>
                  <button type="submit" className="primary-button" disabled={busy}>
                    {busy ? "保存中…" : editingInterviewId ? "保存修改" : "添加面试"}
                  </button>
                </div>
              </form>
            </div>
          </div>
          </ModalPortal>
        )}

        {/* ────────────────────────────────── company edit modal */}
        {editingCompanyName && (
          <ModalPortal>
            <div className="modal-overlay modal-overlay-elevated">
              <div className="modal company-edit-modal" onClick={(event) => event.stopPropagation()}>
                <div className="modal-head">
                  <div>
                    <p className="modal-kicker">EDIT COMPANY</p>
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

        {/* ────────────────────────────────── company modal */}
        {selectedCompany && (
          <ModalPortal>
          <div className="modal-overlay" onClick={closeCompany}>
            <div className="modal modal-wide company-detail-modal" onClick={(e) => e.stopPropagation()}>
              <div className="company-modal-header">
                <div>
                  <p className="modal-kicker">COMPANY APPLICATIONS</p>
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
                <span><b>{companyInterviews.length}</b>面试记录</span>
                <span><b>{companyApplications.filter((item) => item.visibility !== "private").length}</b>已共享</span>
              </div>
              {companyTimeline.length > 0 && (
                <details className="company-timeline">
                  <summary>
                    <span>投递与面试时间线</span>
                    <small>{companyTimeline.length} 个节点 · 点击展开</small>
                  </summary>
                  <div className="company-timeline-list">
                    {companyTimeline.map((event) => (
                      <article className={`company-timeline-event ${event.tone}`} key={event.id}>
                        <time>{formatDateTime(event.date)}</time>
                        <i aria-hidden="true" />
                        <div>
                          <span>{event.type}</span><strong>{event.title}</strong><small>{event.detail}</small>
                          {view === "mine" && event.interview && <button type="button" onClick={() => { closeCompany(); openInterviewEdit(event.interview!); }}>编辑面试记录</button>}
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
                      </div></td>
                      <td className="cell-actions" data-label="操作">
                        {view === "mine" && <div className="action-buttons">
                          <button className="action-btn" onClick={() => openEdit(item)} title="编辑岗位信息">编辑岗位</button>
                          <button className="action-btn" onClick={() => { const src = item; closeCompany(); openCreate(src); }} title="复制创建同公司新岗位">复制</button>
                          <button className="action-btn" onClick={() => { closeCompany(); openInterviewCreate(item.id); }} title="添加面试">添加面试</button>
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
          <div className="notice-toast" onClick={() => setNotice("")}>
            {notice}
          </div>
        )}
      </section>

      {/* ────────────────────────────────── footer */}
      <footer className="app-footer">
        <p>秋招同行录 — 开源 · 隐私优先 · 小组共享</p>
      </footer>
    </div>
  );
}
