"use client";

import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChatGPTUser } from "./chatgpt-auth";
import { getSupabaseBrowserClient } from "../lib/supabase-browser";

type ApplicationStatus =
  | "准备投递"
  | "已投递"
  | "笔试"
  | "一面"
  | "二面"
  | "终面"
  | "HR面"
  | "Offer"
  | "已拒绝"
  | "流程结束";

type Visibility = "private" | "progress" | "full";

type Application = {
  id: string;
  company: string;
  position: string;
  base: string;
  industryTags: string[];
  companyScale: string;
  batch: "提前批" | "秋招" | "日常实习" | "其他";
  status: ApplicationStatus;
  appliedAt: string;
  channel: string;
  link: string;
  salary: string;
  note: string;
  visibility: Visibility;
  updatedAt: string;
  ownerEmail?: string;
  ownerName?: string;
  isOwner?: boolean;
  groupId?: string | null;
};

type GroupMember = {
  email: string;
  display_name: string;
  role: "owner" | "member";
  joined_at: string;
};

type GroupInfo = {
  id: string;
  name: string;
  ownerEmail: string;
  inviteCode: string;
  role: "owner" | "member";
  members: GroupMember[];
};

type WorkspaceResponse = {
  applications: Application[];
  groups: GroupInfo[];
  interviews?: Interview[];
};

type Interview = {
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
  updatedAt: string;
};

const INTERVIEW_STORAGE_KEY = "autumn-recruitment-interviews-v1";
const EMPTY_INTERVIEW: Omit<Interview, "id" | "updatedAt"> = {
  applicationId: "",
  scheduledAt: "",
  endedAt: "",
  round: "一面",
  format: "视频面试",
  interviewer: "",
  result: "待进行",
  summary: "",
  nextSteps: "",
};

type Props = {
  user: ChatGPTUser | null;
  signInPath: string;
  signOutPath: string;
  onSignOut?: () => Promise<void>;
};

const STORAGE_KEY = "autumn-recruitment-applications-v1";
const STATUSES: ApplicationStatus[] = [
  "准备投递",
  "已投递",
  "笔试",
  "一面",
  "二面",
  "终面",
  "HR面",
  "Offer",
  "已拒绝",
  "流程结束",
];

const BASE_OPTIONS = ["北京", "上海", "广州", "深圳", "杭州", "成都", "武汉", "南京", "苏州", "西安", "合肥", "重庆"];
const PLATFORM_OPTIONS = ["招聘官网", "Boss 直聘", "牛客", "猎聘", "智联招聘", "前程无忧", "内推", "校园招聘"];
const INDUSTRY_OPTIONS = ["半导体", "具身智能", "智能驾驶", "软件", "游戏", "汽车", "机器人", "AI / 大模型", "互联网 / 平台", "硬件 / 消费电子", "金融科技", "金融", "医疗健康", "生物医药", "制造业", "化工", "能源电力", "国企", "事业单位", "研究院", "教育"];
const COMPANY_SCALE_OPTIONS = ["未知", "1-50人", "51-200人", "201-500人", "501-2000人", "2001-10000人", "10000+人"];

const EMPTY_FORM: Omit<
  Application,
  "id" | "updatedAt" | "ownerEmail" | "ownerName" | "isOwner" | "groupId"
> = {
  company: "",
  position: "",
  base: "",
  industryTags: [],
  companyScale: "",
  batch: "提前批",
  status: "准备投递",
  appliedAt: "",
  channel: "",
  link: "",
  salary: "",
  note: "",
  visibility: "private",
};

const SAMPLE_DATA: Application[] = [
  {
    id: "sample-1",
    company: "星海科技",
    position: "前端开发工程师",
    base: "上海",
    industryTags: ["软件"],
    companyScale: "2001-10000人",
    batch: "提前批",
    status: "一面",
    appliedAt: "2026-07-15",
    channel: "招聘官网",
    link: "",
    salary: "",
    note: "一面重点准备项目难点与性能优化。",
    visibility: "private",
    updatedAt: "2026-07-21T09:30:00.000Z",
  },
  {
    id: "sample-2",
    company: "远山智能",
    position: "算法工程师",
    base: "北京",
    industryTags: ["具身智能", "机器人"],
    companyScale: "51-200人",
    batch: "秋招",
    status: "笔试",
    appliedAt: "2026-07-19",
    channel: "内推",
    link: "",
    salary: "",
    note: "7 月 26 日在线笔试。",
    visibility: "private",
    updatedAt: "2026-07-22T12:00:00.000Z",
  },
  {
    id: "sample-3",
    company: "青鸟网络",
    position: "产品经理",
    base: "深圳",
    industryTags: ["互联网 / 平台"],
    companyScale: "10000+人",
    batch: "提前批",
    status: "Offer",
    appliedAt: "2026-07-03",
    channel: "Boss 直聘",
    link: "",
    salary: "25k × 15",
    note: "意向书已收到，等待正式 Offer。",
    visibility: "private",
    updatedAt: "2026-07-20T08:00:00.000Z",
  },
];

function formatDate(value: string) {
  if (!value) return "未填写";
  const date = new Date(`${value}T00:00:00`);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatInterviewTime(value: string) {
  if (!value) return "未填写";
  return new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function companyKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

function statusTone(status: ApplicationStatus) {
  if (status === "Offer") return "offer";
  if (["一面", "二面", "终面", "HR面"].includes(status)) return "interview";
  if (status === "笔试") return "test";
  if (["已拒绝", "流程结束"].includes(status)) return "closed";
  return "default";
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

export function RecruitmentTracker({
  user,
  signInPath,
  signOutPath,
  onSignOut,
}: Props) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [localBackup, setLocalBackup] = useState<Application[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"mine" | "friends" | "sharing" | "insights">("mine");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("全部状态");
  const [batchFilter, setBatchFilter] = useState("全部批次");
  const [industryFilter, setIndustryFilter] = useState("全部行业");
  const [scaleFilter, setScaleFilter] = useState("全部规模");
  const [positionFilter, setPositionFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [isInterviewOpen, setIsInterviewOpen] = useState(false);
  const [editingInterviewId, setEditingInterviewId] = useState<string | null>(null);
  const [interviewForm, setInterviewForm] = useState(EMPTY_INTERVIEW);
  const [notice, setNotice] = useState("");
  const [groupName, setGroupName] = useState("秋招搭子小组");
  const [inviteCode, setInviteCode] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  const inviteHandledRef = useRef(false);

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId) ?? null,
    [groups, activeGroupId],
  );

  const cloudAction = useCallback(async (payload: Record<string, unknown>) => {
    const supabase = getSupabaseBrowserClient();
    const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
    const response = await fetch("/api/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(data.session?.access_token
        ? { headers: { "content-type": "application/json", Authorization: `Bearer ${data.session.access_token}` } }
        : {}),
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(result.error || "操作失败");
  }, []);

  const loadCloud = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
    const response = await fetch("/api/workspace", {
      cache: "no-store",
      ...(data.session?.access_token ? { headers: { Authorization: `Bearer ${data.session.access_token}` } } : {}),
    });
    const result = (await response.json()) as WorkspaceResponse & {
      error?: string;
    };
    if (!response.ok) throw new Error(result.error || "云端同步失败");
    setApplications(result.applications);
    setGroups(result.groups);
    setActiveGroupId((prev) => {
      if (prev && result.groups.some((g) => g.id === prev)) return prev;
      return result.groups[0]?.id ?? null;
    });
    setInterviews(result.interviews ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let localItems: Application[] = [];
    let localInterviews: Interview[] = [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (safeApplications(parsed)) localItems = normalizeLocal(parsed);
      }
    } catch {
      localItems = [];
    }
    try {
      const raw = window.localStorage.getItem(INTERVIEW_STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (safeInterviews(parsed)) localInterviews = normalizeInterviews(parsed);
      }
    } catch {
      localInterviews = [];
    }

    if (user) {
      window.queueMicrotask(() => {
        if (!cancelled) {
          setLocalBackup(
            localItems.filter((item) => !item.id.startsWith("sample-")),
          );
          setInterviews(localInterviews);
        }
      });
      window.queueMicrotask(() => {
        void loadCloud()
          .catch((error: Error) => {
            if (!cancelled) setNotice(error.message);
          })
          .finally(() => {
            if (!cancelled) setReady(true);
          });
      });
    } else {
      window.queueMicrotask(() => {
        if (!cancelled) {
          setApplications(localItems.length ? localItems : SAMPLE_DATA);
          setInterviews(localInterviews);
          setReady(true);
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [loadCloud, user]);

  useEffect(() => {
    if (!ready || user) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(applications));
  }, [applications, ready, user]);

  useEffect(() => {
    if (!ready || user) return;
    window.localStorage.setItem(INTERVIEW_STORAGE_KEY, JSON.stringify(interviews));
  }, [interviews, ready, user]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const invite = (new URLSearchParams(window.location.search).get("invite") || window.localStorage.getItem("pending-invite"))?.trim().toUpperCase();
    if (!user || !ready || !invite || inviteHandledRef.current) return;
    inviteHandledRef.current = true;
    setInviteCode(invite);
    void (async () => {
      try {
        await cloudAction({ action: "joinGroup", inviteCode: invite });
        await loadCloud();
        window.localStorage.removeItem("pending-invite");
        window.history.replaceState({}, "", window.location.pathname);
        setNotice("已通过分享链接加入小组");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "加入小组失败");
      }
    })();
  }, [cloudAction, loadCloud, ready, user]);

  const ownApplications = useMemo(
    () => applications.filter((item) => item.isOwner !== false),
    [applications],
  );

  const friendApplications = useMemo(
    () => applications.filter((item) => item.isOwner === false),
    [applications],
  );

  const filtered = useMemo(() => {
    const source = view === "friends" ? friendApplications : ownApplications;
    const normalized = query.trim().toLowerCase();
    return source
      .filter((item) => {
        const searchTarget = [
          item.company,
          item.position,
          item.base,
          item.industryTags.join(" "),
          item.companyScale,
          item.channel,
          item.note,
          item.ownerName,
        ]
          .join(" ")
          .toLowerCase();
        return (
          (!normalized || searchTarget.includes(normalized)) &&
          (statusFilter === "全部状态" || item.status === statusFilter) &&
          (batchFilter === "全部批次" || item.batch === batchFilter) &&
          (industryFilter === "全部行业" || item.industryTags.includes(industryFilter)) &&
          (scaleFilter === "全部规模" || item.companyScale === scaleFilter) &&
          (!positionFilter.trim() || item.position.toLowerCase().includes(positionFilter.trim().toLowerCase())) &&
          (!locationFilter.trim() || item.base.toLowerCase().includes(locationFilter.trim().toLowerCase()))
        );
      })
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }, [
    batchFilter,
    friendApplications,
    industryFilter,
    ownApplications,
    locationFilter,
    positionFilter,
    query,
    scaleFilter,
    statusFilter,
    view,
  ]);

  const companyApplications = useMemo(() => {
    if (!selectedCompany) return [];
    const source = view === "friends" ? friendApplications : ownApplications;
    return source
      .filter((item) => companyKey(item.company) === companyKey(selectedCompany))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [friendApplications, ownApplications, selectedCompany, view]);

  const stats = useMemo(() => {
    const interview = ownApplications.filter((item) =>
      ["一面", "二面", "终面", "HR面"].includes(item.status),
    ).length;
    const active = ownApplications.filter(
      (item) => !["Offer", "已拒绝", "流程结束"].includes(item.status),
    ).length;
    const offers = ownApplications.filter(
      (item) => item.status === "Offer",
    ).length;
    return { total: ownApplications.length, active, interview, offers };
  }, [ownApplications]);

  function openCreate(source?: Application) {
    setEditingId(null);
    setForm({
      company: source?.company ?? "",
      position: "",
      base: source?.base ?? "",
      industryTags: source?.industryTags ?? [],
      companyScale: source?.companyScale ?? "",
      batch: source?.batch ?? "秋招",
      status: "准备投递",
      appliedAt: new Date().toISOString().slice(0, 10),
      channel: source?.channel ?? "",
      link: source?.link ?? "",
      salary: source?.salary ?? "",
      note: source?.note ?? "",
      visibility: source?.visibility ?? "private",
    });
    setIsFormOpen(true);
  }

  function copyFromExisting(id: string) {
    const source = ownApplications.find((item) => item.id === id);
    if (source) openCreate(source);
  }

  function openEdit(item: Application) {
    if (item.isOwner === false) return;
    setEditingId(item.id);
    setForm({
      company: item.company,
      position: item.position,
      base: item.base,
      industryTags: item.industryTags ?? [],
      companyScale: item.companyScale ?? "",
      batch: item.batch,
      status: item.status,
      appliedAt: item.appliedAt,
      channel: item.channel,
      link: item.link,
      salary: item.salary,
      note: item.note,
      visibility: item.visibility,
    });
    setIsFormOpen(true);
  }

  function openCompany(company: string) {
    setSelectedCompany(company);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.company.trim() || !form.position.trim()) return;
    const next: Application = {
      ...form,
      visibility: activeGroup ? form.visibility : "private",
      company: form.company.trim(),
      position: form.position.trim(),
      id: editingId ?? crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
      isOwner: true,
    };
    setBusy(true);
    try {
      if (user) {
        await cloudAction({ action: "saveApplication", application: { ...next, groupId: activeGroupId } });
        await loadCloud();
      } else if (editingId) {
        setApplications((current) =>
          current.map((item) => (item.id === editingId ? next : item)),
        );
      } else {
        setApplications((current) => [next, ...current]);
      }
      setNotice(editingId ? "岗位信息已更新" : "已添加一条投递记录");
      closeForm();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(id: string, status: ApplicationStatus) {
    setBusy(true);
    try {
      if (user) {
        await cloudAction({ action: "updateStatus", id, status });
        await loadCloud();
      } else {
        setApplications((current) =>
          current.map((item) =>
            item.id === id
              ? { ...item, status, updatedAt: new Date().toISOString() }
              : item,
          ),
        );
      }
      setNotice(`进度已更新为「${status}」`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "更新失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeApplication(item: Application) {
    if (!window.confirm(`确定删除 ${item.company} · ${item.position} 吗？`)) {
      return;
    }
    setBusy(true);
    try {
      if (user) {
        await cloudAction({ action: "deleteApplication", id: item.id });
        await loadCloud();
      } else {
        setApplications((current) =>
          current.filter((application) => application.id !== item.id),
        );
      }
      setNotice("记录已删除");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(ownApplications, null, 2)], {
      type: "application/json",
    });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `秋招投递备份-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
    setNotice("备份文件已下载");
  }

  async function importData(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!safeApplications(parsed)) throw new Error("invalid");
      if (
        ownApplications.length &&
        !window.confirm("导入会增加这些记录，是否继续？")
      ) {
        return;
      }
      const normalized = normalizeLocal(parsed);
      if (user) {
        setBusy(true);
        await cloudAction({
          action: "importApplications",
          applications: normalized,
        });
        await loadCloud();
      } else {
        setApplications(normalized);
      }
      setNotice(`已导入 ${normalized.length} 条记录`);
    } catch (error) {
      if (error instanceof SyntaxError || (error as Error).message === "invalid") {
        window.alert("这个文件不是有效的秋招投递备份。");
      } else {
        setNotice(error instanceof Error ? error.message : "导入失败");
      }
    } finally {
      setBusy(false);
    }
  }

  async function migrateLocalData() {
    if (!localBackup.length) return;
    setBusy(true);
    try {
      await cloudAction({
        action: "importApplications",
        applications: localBackup,
      });
      window.localStorage.removeItem(STORAGE_KEY);
      setLocalBackup([]);
      await loadCloud();
      setNotice("本地记录已安全迁移到云端");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "迁移失败");
    } finally {
      setBusy(false);
    }
  }

  function openInterviewCreate(applicationId = ownApplications[0]?.id ?? "") {
    setEditingInterviewId(null);
    const start = new Date(Date.now() + 86400000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    setInterviewForm({ ...EMPTY_INTERVIEW, applicationId, scheduledAt: start.toISOString().slice(0, 16), endedAt: end.toISOString().slice(0, 16) });
    setIsInterviewOpen(true);
  }

  function openInterviewEdit(item: Interview) {
    setEditingInterviewId(item.id);
    setInterviewForm({
      applicationId: item.applicationId,
      scheduledAt: item.scheduledAt.slice(0, 16),
      endedAt: item.endedAt ? item.endedAt.slice(0, 16) : "",
      round: item.round,
      format: item.format,
      interviewer: item.interviewer,
      result: item.result,
      summary: item.summary,
      nextSteps: item.nextSteps,
    });
    setIsInterviewOpen(true);
  }

  function closeInterview() {
    setIsInterviewOpen(false);
    setEditingInterviewId(null);
    setInterviewForm(EMPTY_INTERVIEW);
  }

  async function submitInterview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!interviewForm.applicationId || !interviewForm.scheduledAt) return;
    const next: Interview = {
      ...interviewForm,
      id: editingInterviewId ?? crypto.randomUUID(),
      scheduledAt: new Date(interviewForm.scheduledAt).toISOString(),
      endedAt: interviewForm.endedAt ? new Date(interviewForm.endedAt).toISOString() : "",
      updatedAt: new Date().toISOString(),
    };
    setBusy(true);
    try {
      if (user) {
        await cloudAction({ action: editingInterviewId ? "updateInterview" : "saveInterview", interview: next });
        await loadCloud();
      } else {
        setInterviews((current) => editingInterviewId ? current.map((item) => item.id === editingInterviewId ? next : item) : [next, ...current]);
      }
      setNotice(editingInterviewId ? "面试记录已更新" : "面试安排已添加");
      closeInterview();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存面试记录失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeInterview(item: Interview) {
    if (!window.confirm("确定删除这条面试记录吗？")) return;
    setBusy(true);
    try {
      if (user) {
        await cloudAction({ action: "deleteInterview", id: item.id });
        await loadCloud();
      } else {
        setInterviews((current) => current.filter((entry) => entry.id !== item.id));
      }
      setNotice("面试记录已删除");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  async function groupAction(payload: Record<string, unknown>, success: string) {
    setBusy(true);
    try {
      await cloudAction(payload);
      await loadCloud();
      setNotice(success);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  function clearFilters() {
    setQuery("");
    setStatusFilter("全部状态");
    setBatchFilter("全部批次");
    setIndustryFilter("全部行业");
    setScaleFilter("全部规模");
    setPositionFilter("");
    setLocationFilter("");
  }

  async function copyInviteCode() {
    if (!activeGroup) return;
    await navigator.clipboard.writeText(activeGroup.inviteCode);
    setNotice("邀请码已复制");
  }

  async function copyShareLink() {
    if (!activeGroup) return;
    const shareLink = `${window.location.origin}/?invite=${encodeURIComponent(activeGroup.inviteCode)}`;
    await navigator.clipboard.writeText(shareLink);
    setNotice("分享链接已复制，朋友登录后会自动加入小组");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="秋招同行录首页">
          <span className="brand-mark">秋</span>
          <span>
            <strong>MXX · 秋招同行录</strong>
            <small>{user ? "云端协作工作台" : "我的本地投递进度"}</small>
          </span>
        </a>
        <div className="top-actions">
          <span className={`save-state ${user ? "cloud" : ""}`}>
            <span className="save-dot" />
            {user ? "云端已连接" : "已自动保存在本机"}
          </span>
          {user ? (
            <div className="account-menu">
              <a className="account-avatar" href="/account" aria-label={`${user.displayName} · 个人中心`} title="个人中心">
                {user.displayName.slice(0, 1).toUpperCase()}
              </a>
              <span className="account-copy">
                <strong>{user.displayName}</strong>
                <small>{user.email}</small>
              </span>
              <a className="account-center-link" href="/account" aria-label="个人中心">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <span>个人中心</span>
              </a>
              {onSignOut ? (
                <button className="account-signout" onClick={() => void onSignOut()}>退出</button>
              ) : (
                <a className="account-signout" href={signOutPath}>退出</a>
              )}
            </div>
          ) : (
            <a className="secondary-button button-link" href={signInPath}>
              登录并同步
            </a>
          )}
          <button className="primary-button" onClick={() => openCreate()}>
            <span>＋</span> 新增投递
          </button>
        </div>
      </header>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">
            2026 秋招 · {user ? "与好友并肩前进" : "个人工作台"}
          </p>
          <h1>把每一次投递，变成清晰的下一步。</h1>
          <p className="hero-copy">
            {user
              ? "进度已在云端同步。你可以邀请秋招搭子加入小组，并精确决定每条记录分享多少。"
              : "公司、岗位、Base、时间和面试进度都放在一处。登录后可跨设备同步并与好友安全共享。"}
          </p>
        </div>
        <div className="hero-note">
          <span className="hero-note-icon">{activeGroup ? "♧" : "⌁"}</span>
          <div>
            <strong>{activeGroup ? activeGroup.name : "今天的小提醒"}</strong>
            <p>
              {activeGroup
                ? `小组目前有 ${activeGroup.members.length} 位成员，好友公开的进度会显示在协作视图。`
                : stats.interview
                  ? `你有 ${stats.interview} 个岗位正在面试阶段，记得及时补充面经。`
                  : "先添加第一条投递，之后每次进展都顺手更新一下。"}
            </p>
          </div>
        </div>
      </section>

      {user && localBackup.length > 0 && (
        <section className="migration-banner">
          <div>
            <strong>发现 {localBackup.length} 条本地投递记录</strong>
            <p>一键迁移到云端后，就能在其他设备继续使用。</p>
          </div>
          <button
            className="primary-button"
            disabled={busy}
            onClick={migrateLocalData}
          >
            迁移到云端
          </button>
        </section>
      )}

      <section className="stats-grid" aria-label="投递数据概览">
        <article className="stat-card">
          <span className="stat-icon ink">⌘</span>
          <div><small>累计投递</small><strong>{stats.total}</strong><span>份岗位记录</span></div>
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

      <section className="workspace">
        <nav className="view-tabs" aria-label="工作台视图">
          <button className={view === "mine" ? "active" : ""} onClick={() => setView("mine")}>
            我的投递 <span>{ownApplications.length}</span>
          </button>
          <button
            className={view === "friends" ? "active" : ""}
            onClick={() => setView("friends")}
            disabled={!user}
          >
            好友进度 <span>{friendApplications.length}</span>
          </button>
          <button
            className={view === "sharing" ? "active" : ""}
            onClick={() => setView("sharing")}
            disabled={!user}
          >
            共享与隐私
          </button>
          <button className={view === "insights" ? "active" : ""} onClick={() => setView("insights")}>
            数据分析
          </button>
        </nav>

        {view === "insights" ? (
          <InsightsPanel applications={ownApplications} interviews={interviews} />
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
            <div className="workspace-head">
              <div>
                <p className="section-kicker">
                  {view === "friends" ? "FRIENDS" : "APPLICATIONS"}
                </p>
                <h2>{view === "friends" ? "好友公开进度" : "投递清单"}</h2>
              </div>
              <div className="data-actions">
                <input
                  ref={importRef}
                  className="visually-hidden"
                  type="file"
                  accept="application/json,.json"
                  onChange={importData}
                />
                {view === "mine" && (
                  <>
                    <button className="text-button" onClick={() => importRef.current?.click()}>
                      导入备份
                    </button>
                    <button className="text-button" onClick={exportData}>导出备份</button>
                  </>
                )}
                <span>{filtered.length} 条结果</span>
              </div>
            </div>

            <div className="filters">
              <label className="search-box">
                <span>⌕</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={view === "friends" ? "搜索好友、公司或岗位" : "搜索公司、岗位、城市或备注"}
                  aria-label="搜索投递记录"
                />
              </label>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="按状态筛选">
                <option>全部状态</option>
                {STATUSES.map((status) => <option key={status}>{status}</option>)}
              </select>
              <select value={batchFilter} onChange={(event) => setBatchFilter(event.target.value)} aria-label="按批次筛选">
                <option>全部批次</option>
                <option>提前批</option><option>秋招</option><option>日常实习</option><option>其他</option>
              </select>
              <select value={industryFilter} onChange={(event) => setIndustryFilter(event.target.value)} aria-label="按行业筛选">
                <option>全部行业</option>
                {Array.from(new Set([...INDUSTRY_OPTIONS, ...applications.flatMap((item) => item.industryTags ?? [])])).map((industry) => <option key={industry}>{industry}</option>)}
              </select>
              <select value={scaleFilter} onChange={(event) => setScaleFilter(event.target.value)} aria-label="按公司规模筛选">
                <option>全部规模</option>
                {Array.from(new Set([...COMPANY_SCALE_OPTIONS, ...applications.map((item) => item.companyScale).filter(Boolean)])).map((scale) => <option key={scale}>{scale}</option>)}
              </select>
              <label className="filter-input"><span>岗位</span><input list="position-filter-options" value={positionFilter} onChange={(event) => setPositionFilter(event.target.value)} placeholder="筛选岗位" aria-label="按岗位筛选" /></label>
              <label className="filter-input"><span>地点</span><input list="location-filter-options" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} placeholder="筛选 Base" aria-label="按地点筛选" /></label>
              <datalist id="position-filter-options">{Array.from(new Set(applications.map((item) => item.position).filter(Boolean))).map((position) => <option key={position} value={position} />)}</datalist>
              <datalist id="location-filter-options">{Array.from(new Set(applications.map((item) => item.base).filter(Boolean))).map((location) => <option key={location} value={location} />)}</datalist>
              {(query || positionFilter || locationFilter || statusFilter !== "全部状态" || batchFilter !== "全部批次" || industryFilter !== "全部行业" || scaleFilter !== "全部规模") && <button className="clear-filter-button" onClick={clearFilters}>清空筛选</button>}
            </div>

            {!ready ? (
              <div className="loading-state">正在同步投递记录…</div>
            ) : filtered.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>公司 / 岗位</th>
                      {view === "friends" && <th>好友</th>}
                      <th>Base</th><th>批次</th><th>投递时间</th><th>当前进度</th>
                      <th>{view === "friends" ? "分享范围" : "隐私"}</th>
                      <th aria-label="操作" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <button
                            className="company-cell"
                            onClick={() => openCompany(item.company)}
                            aria-label={`查看 ${item.company} 的全部岗位`}
                          >
                            <span className="company-avatar">{item.company.slice(0, 1)}</span>
                            <span><strong>{item.company}</strong><small>{item.position}</small><small className="company-tags">{item.industryTags?.length ? item.industryTags.join(" · ") : "未标记行业"}{item.companyScale ? ` · ${item.companyScale}` : ""}</small></span>
                          </button>
                        </td>
                        {view === "friends" && <td data-label="好友">{item.ownerName || "好友"}</td>}
                        <td data-label="Base">{item.base || "—"}</td>
                        <td data-label="批次"><span className="batch-tag">{item.batch}</span></td>
                        <td data-label="投递时间">{formatDate(item.appliedAt)}</td>
                        <td data-label="当前进度">
                          {item.isOwner === false ? (
                            <span className={`status-badge ${statusTone(item.status)}`}>{item.status}</span>
                          ) : (
                            <select
                              className={`status-select ${statusTone(item.status)}`}
                              value={item.status}
                              disabled={busy}
                              onChange={(event) => updateStatus(item.id, event.target.value as ApplicationStatus)}
                              aria-label={`修改 ${item.company} 的进度`}
                            >
                              {STATUSES.map((status) => <option key={status}>{status}</option>)}
                            </select>
                          )}
                        </td>
                        <td data-label="隐私">
                          <span className={`privacy-tag ${item.visibility}`}>
                            {item.visibility === "private" ? "仅自己" : item.visibility === "progress" ? "仅进度" : "完整共享"}
                          </span>
                        </td>
                        <td>
                          {item.isOwner !== false && (
                            <div className="row-actions">
                              <button onClick={() => openEdit(item)}>编辑</button>
                              <button onClick={() => openCreate(item)}>复制</button>
                              <button className="danger" onClick={() => removeApplication(item)}>删除</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <span>{view === "friends" ? "♧" : "◎"}</span>
                <h3>
                  {view === "friends"
                    ? activeGroup ? "好友还没有公开进度" : "先创建或加入一个共享小组"
                    : applications.length ? "没有符合条件的记录" : "从第一份投递开始"}
                </h3>
                <p>
                  {view === "friends"
                    ? "好友将岗位设为“仅共享进度”或“完整共享”后，会出现在这里。"
                    : "添加公司和岗位信息，我们会帮你记住后续的每一步。"}
                </p>
                {view === "friends" && !activeGroup ? (
                  <button className="primary-button" onClick={() => setView("sharing")}>设置共享小组</button>
                ) : view === "mine" && !ownApplications.length ? (
                  <button className="primary-button" onClick={() => openCreate()}>＋ 新增投递</button>
                ) : null}
              </div>
            )}
          </>
        )}
      </section>

      <section className="interview-planner legacy-interview-planner" aria-label="面试安排与面经">
        <div className="planner-head">
          <div>
            <p className="section-kicker">INTERVIEW LOG</p>
            <h2>面试安排与面经</h2>
            <p>把每次面试的时间、轮次和复盘要点放在岗位下面，临近面试时一眼就能找到。</p>
          </div>
          <button className="primary-button" onClick={() => openInterviewCreate()} disabled={!ownApplications.length}>＋ 新增面试</button>
        </div>
        {interviews.length ? (
          <div className="interview-list">
            {interviews.slice().sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()).map((item) => {
              const application = applications.find((entry) => entry.id === item.applicationId);
              return (
                <article className="interview-card" key={item.id}>
                  <div className="interview-date"><strong>{new Date(item.scheduledAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric" })}</strong><span>{new Date(item.scheduledAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}{item.endedAt ? ` — ${new Date(item.endedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : ""}</span><small>开始 — 结束</small></div>
                  <div className="interview-main"><div className="interview-title"><strong>{application?.company || "未关联岗位"}</strong><span>{application?.position || ""}</span></div><div className="interview-meta"><span>{item.round}</span><span>{item.format}</span><span>{item.result}</span>{item.interviewer && <span>面试官：{item.interviewer}</span>}</div>{item.summary && <p>{item.summary}</p>}{item.nextSteps && <small>下一步：{item.nextSteps}</small>}</div>
                  <div className="interview-actions"><button onClick={() => openInterviewEdit(item)}>编辑</button><button className="danger" onClick={() => void removeInterview(item)}>删除</button></div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="planner-empty"><span>◷</span><strong>还没有面试安排</strong><p>添加一次面试时间，面试后再补充简要面经和下一步。</p></div>
        )}
      </section>

      <footer>
        <span>{user ? "云端数据仅对你和获得授权的小组成员可见。" : "本地数据只存放在当前浏览器，请定期导出备份。"}</span>
        <span>下一阶段：简历解析 · 素材库 · 辅助填写</span>
      </footer>

      {isFormOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeForm}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="form-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <p className="section-kicker">{editingId ? "UPDATE APPLICATION" : "NEW APPLICATION"}</p>
                <h2 id="form-title">{editingId ? "编辑投递记录" : "新增投递"}</h2>
              </div>
              <button className="close-button" onClick={closeForm} aria-label="关闭">×</button>
            </div>
            <form onSubmit={submitForm}>
              {!editingId && ownApplications.length > 0 && (
                <div className="copy-from-existing">
                  <span>从已有记录快速复制</span>
                  <select
                    value=""
                    onChange={(event) => {
                      const id = event.target.value;
                      if (!id) return;
                      const source = ownApplications.find((item) => item.id === id);
                      if (source) {
                        setForm({
                          ...form,
                          company: source.company,
                          base: source.base,
                          industryTags: source.industryTags ?? [],
                          companyScale: source.companyScale ?? "",
                          batch: source.batch,
                          channel: source.channel,
                          link: source.link,
                          salary: source.salary,
                          note: source.note,
                          visibility: source.visibility,
                        });
                      }
                    }}
                  >
                    <option value="">选择一条已有记录（仅复制公司信息）</option>
                    {Array.from(
                      ownApplications
                        .reduce((map, item) => {
                          if (!map.has(item.company)) map.set(item.company, item);
                          return map;
                        }, new Map<string, Application>())
                        .values()
                    )
                      .sort((a, b) => a.company.localeCompare(b.company, "zh"))
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.company} · {item.position}（{item.base || "无地点"}）
                        </option>
                      ))}
                  </select>
                </div>
              )}
              <div className="form-grid">
                <label><span>公司名称 *</span><input required autoFocus value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} placeholder="例如：字节跳动" /></label>
                <label><span>岗位名称 *</span><input required value={form.position} onChange={(event) => setForm({ ...form, position: event.target.value })} placeholder="例如：前端开发工程师" /></label>
                <label><span>Base 城市（可选）</span><input list="base-options" value={form.base} onChange={(event) => setForm({ ...form, base: event.target.value })} placeholder="可选：北京 / 上海，也可自定义" /></label>
                <label className="full-field"><span>公司行业标签（可多选，也可自定义）</span>
                  <div className="tag-picker">
                    {INDUSTRY_OPTIONS.map((industry) => {
                      const active = form.industryTags.includes(industry);
                      return <button type="button" key={industry} className={`tag-choice${active ? " active" : ""}`} onClick={() => setForm({ ...form, industryTags: active ? form.industryTags.filter((tag) => tag !== industry) : [...form.industryTags, industry] })}>{industry}</button>;
                    })}
                  </div>
                  <input value={form.industryTags.filter((tag) => !INDUSTRY_OPTIONS.includes(tag)).join("、")} onChange={(event) => {
                    const custom = event.target.value.split(/[、,，]/).map((tag) => tag.trim()).filter(Boolean);
                    setForm({ ...form, industryTags: [...form.industryTags.filter((tag) => INDUSTRY_OPTIONS.includes(tag)), ...custom] });
                  }} placeholder="自定义标签，可用顿号分隔，例如：新能源、ToB" />
                </label>
                <label><span>公司规模（可选）</span><input list="scale-options" value={form.companyScale} onChange={(event) => setForm({ ...form, companyScale: event.target.value })} placeholder="选择范围或自定义，例如：约300人" /></label>
                <label><span>招聘批次</span><select value={form.batch} onChange={(event) => setForm({ ...form, batch: event.target.value as Application["batch"] })}><option>提前批</option><option>秋招</option><option>日常实习</option><option>其他</option></select></label>
                <label><span>当前进度</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ApplicationStatus })}>{STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
                <label><span>投递时间</span><input type="date" value={form.appliedAt} onChange={(event) => setForm({ ...form, appliedAt: event.target.value })} /></label>
                <label><span>投递平台（可选）</span><input list="platform-options" value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value })} placeholder="选择主流平台或自定义输入" /></label>
                <label><span>薪资信息</span><input value={form.salary} onChange={(event) => setForm({ ...form, salary: event.target.value })} placeholder="可选，例如：25k × 15" /></label>
                <label className="full-field"><span>岗位链接</span><input type="url" value={form.link} onChange={(event) => setForm({ ...form, link: event.target.value })} placeholder="https://..." /></label>
                <label className="full-field"><span>备注 / 下一步</span><textarea rows={3} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="记录截止时间、面试安排、联系人或需要准备的内容" /></label>
                <label className="full-field privacy-field">
                  <span>谁可以看到这条记录</span>
                  <select
                    value={form.visibility}
                    onChange={(event) => setForm({ ...form, visibility: event.target.value as Visibility })}
                    disabled={!activeGroup}
                  >
                    <option value="private">仅自己可见</option>
                    <option value="progress">小组可见进度（隐藏渠道、链接、薪资和备注）</option>
                    <option value="full">小组可见完整信息</option>
                  </select>
                  <small>{activeGroup ? "你可以随时修改，权限立即生效。" : "加入共享小组后可开放给好友。"}</small>
                </label>
                <datalist id="base-options">
                  {BASE_OPTIONS.map((option) => <option key={option} value={option} />)}
                </datalist>
                <datalist id="platform-options">
                  {PLATFORM_OPTIONS.map((option) => <option key={option} value={option} />)}
                </datalist>
                <datalist id="scale-options">
                  {COMPANY_SCALE_OPTIONS.map((option) => <option key={option} value={option} />)}
                </datalist>
                {editingId && (
                  <section className="embedded-interviews full-field" aria-label="当前岗位的面试记录">
                    <div className="embedded-interviews-head">
                      <div><span className="section-kicker">INTERVIEW LOG</span><strong>面试安排与面经</strong><small>把这家公司的所有面试集中在这里管理</small></div>
                      <button type="button" className="secondary-button" onClick={() => openInterviewCreate(editingId)}>选择或新增面试记录</button>
                    </div>
                    {interviews.filter((item) => item.applicationId === editingId).length ? (
                      <div className="embedded-interview-list">
                        {interviews.filter((item) => item.applicationId === editingId).sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()).map((item) => (
                          <article className="embedded-interview-item" key={item.id}>
                            <div><strong>{formatInterviewTime(item.scheduledAt)}{item.endedAt ? ` — ${formatInterviewTime(item.endedAt)}` : ""}</strong><span>{item.round} · {item.format} · {item.result}</span></div>
                            <div className="row-actions"><button type="button" onClick={() => openInterviewEdit(item)}>编辑</button><button type="button" className="danger" onClick={() => void removeInterview(item)}>删除</button></div>
                            {item.summary && <p>{item.summary}</p>}
                          </article>
                        ))}
                      </div>
                    ) : <p className="embedded-empty">还没有面试记录，点击右上角开始添加。</p>}
                  </section>
                )}
              </div>
              <div className="form-actions">
                <button type="button" className="secondary-button" onClick={closeForm}>取消</button>
                <button type="submit" className="primary-button" disabled={busy}>{busy ? "正在保存…" : editingId ? "保存修改" : "添加到清单"}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {isInterviewOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeInterview}>
          <section className="modal interview-modal" role="dialog" aria-modal="true" aria-labelledby="interview-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><p className="section-kicker">INTERVIEW LOG</p><h2 id="interview-title">{editingInterviewId ? "编辑面试记录" : "新增面试安排"}</h2></div><button className="close-button" onClick={closeInterview} aria-label="关闭">×</button></div>
            <form onSubmit={submitInterview}>
              <div className="form-grid">
                <label className="full-field"><span>关联岗位 *</span><select required value={interviewForm.applicationId} onChange={(event) => setInterviewForm({ ...interviewForm, applicationId: event.target.value })}><option value="">请选择一个岗位</option>{ownApplications.map((item) => <option key={item.id} value={item.id}>{item.company} · {item.position}</option>)}</select></label>
                <label><span>面试开始时间 *</span><input required type="datetime-local" value={interviewForm.scheduledAt} onChange={(event) => setInterviewForm({ ...interviewForm, scheduledAt: event.target.value })} /></label>
                <label><span>面试结束时间（可选）</span><input type="datetime-local" min={interviewForm.scheduledAt || undefined} value={interviewForm.endedAt} onChange={(event) => setInterviewForm({ ...interviewForm, endedAt: event.target.value })} /></label>
                <label><span>面试轮次</span><select value={interviewForm.round} onChange={(event) => setInterviewForm({ ...interviewForm, round: event.target.value })}><option>一面</option><option>二面</option><option>终面</option><option>HR 面</option><option>群面</option><option>笔试/测评</option></select></label>
                <label><span>面试形式</span><select value={interviewForm.format} onChange={(event) => setInterviewForm({ ...interviewForm, format: event.target.value })}><option>视频面试</option><option>电话面试</option><option>现场面试</option><option>群面</option><option>笔试/测评</option></select></label>
                <label><span>面试官 / 联系人</span><input value={interviewForm.interviewer} onChange={(event) => setInterviewForm({ ...interviewForm, interviewer: event.target.value })} placeholder="可选" /></label>
                <label><span>结果</span><select value={interviewForm.result} onChange={(event) => setInterviewForm({ ...interviewForm, result: event.target.value })}><option>待进行</option><option>通过</option><option>待定</option><option>未通过</option><option>已取消</option></select></label>
                <label className="full-field"><span>简要面经 / 复盘</span><textarea rows={5} value={interviewForm.summary} onChange={(event) => setInterviewForm({ ...interviewForm, summary: event.target.value })} placeholder="记录问了什么、自己的回答、哪里卡住了、下次要补什么" /></label>
                <label className="full-field"><span>下一步</span><textarea rows={3} value={interviewForm.nextSteps} onChange={(event) => setInterviewForm({ ...interviewForm, nextSteps: event.target.value })} placeholder="例如：补充项目性能优化案例，等待二面通知" /></label>
              </div>
              <div className="form-actions"><button type="button" className="secondary-button" onClick={closeInterview}>取消</button><button type="submit" className="primary-button" disabled={busy}>{busy ? "正在保存…" : "保存面试记录"}</button></div>
            </form>
          </section>
        </div>
      )}

      {selectedCompany && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSelectedCompany(null)}>
          <section className="modal company-modal" role="dialog" aria-modal="true" aria-labelledby="company-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><p className="section-kicker">COMPANY OVERVIEW</p><h2 id="company-title">{selectedCompany}</h2><p className="modal-subtitle">已记录 {companyApplications.length} 个岗位，可逐个编辑投递进度</p></div>
              <button className="close-button" onClick={() => setSelectedCompany(null)} aria-label="关闭">×</button>
            </div>
            <div className="company-summary">
              <span><b>{new Set(companyApplications.map((item) => item.position)).size}</b> 个岗位</span>
              <span><b>{new Set(companyApplications.map((item) => item.base).filter(Boolean)).size || "—"}</b> 个地点</span>
              <span><b>{companyApplications.filter((item) => item.status === "Offer").length}</b> 个 Offer</span>
              <span><b>{companyApplications[0]?.industryTags?.length || 0}</b> 个行业标签</span>
              <button className="secondary-button compact-button" onClick={() => { setSelectedCompany(null); openCreate({ company: selectedCompany, position: "", base: "", industryTags: [], companyScale: "", batch: "秋招", status: "准备投递", appliedAt: new Date().toISOString().slice(0, 10), channel: "", link: "", salary: "", note: "", visibility: "private", id: "", updatedAt: "" }); }}>＋ 新增岗位</button>
            </div>
            <div className="company-job-list">
              {companyApplications.map((item) => (
                <article className="company-job-card" key={item.id}>
                  <div className="company-job-main"><strong>{item.position}</strong><span>{item.base || "地点未填写"} · {item.batch} · {formatDate(item.appliedAt)}</span>{item.industryTags?.length ? <small>{item.industryTags.join(" · ")}{item.companyScale ? ` · ${item.companyScale}` : ""}</small> : null}</div>
                  <span className={`status-badge ${statusTone(item.status)}`}>{item.status}</span>
                  <div className="company-job-actions">
                    {item.isOwner !== false && <button className="secondary-button compact-button" onClick={() => { setSelectedCompany(null); openEdit(item); }}>编辑</button>}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}

      {notice && <div className="toast">{notice}</div>}
    </main>
  );
}

function InsightsPanel({ applications, interviews }: { applications: Application[]; interviews: Interview[] }) {
  const statusCounts = STATUSES.map((status) => ({ status, count: applications.filter((item) => item.status === status).length })).filter((item) => item.count > 0);
  const maxStatus = Math.max(...statusCounts.map((item) => item.count), 1);
  const industryCounts = Array.from(applications.flatMap((item) => item.industryTags ?? []).reduce((map, tag) => map.set(tag, (map.get(tag) ?? 0) + 1), new Map<string, number>()).entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const locationCounts = Array.from(applications.reduce((map, item) => item.base ? map.set(item.base, (map.get(item.base) ?? 0) + 1) : map, new Map<string, number>()).entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const upcoming = interviews.filter((item) => new Date(item.scheduledAt).getTime() >= Date.now()).sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()).slice(0, 5);
  const companies = new Set(applications.map((item) => companyKey(item.company))).size;
  const offers = applications.filter((item) => item.status === "Offer").length;
  const closed = applications.filter((item) => ["已拒绝", "流程结束"].includes(item.status)).length;
  return (
    <div className="insights-panel">
      <div className="insights-head"><div><p className="section-kicker">PERSONAL INSIGHTS</p><h2>投递数据分析</h2><p>把分散的记录整理成更容易行动的信号。</p></div><span className="insight-refresh">实时计算 · {applications.length} 条记录</span></div>
      <div className="insight-kpis"><article><span>公司数</span><strong>{companies}</strong><small>覆盖不同团队</small></article><article><span>岗位数</span><strong>{applications.length}</strong><small>每个岗位独立跟踪</small></article><article><span>Offer</span><strong>{offers}</strong><small>继续保持节奏</small></article><article><span>面试记录</span><strong>{interviews.length}</strong><small>{upcoming.length ? `${upcoming.length} 场待进行` : "暂无待进行"}</small></article></div>
      <div className="insights-grid">
        <section className="insight-card status-chart"><div className="insight-card-head"><div><span className="section-kicker">PIPELINE</span><h3>流程分布</h3></div><small>{closed} 条已结束</small></div>{statusCounts.length ? statusCounts.map((item) => <div className="bar-row" key={item.status}><span>{item.status}</span><div><i style={{ width: `${Math.max(10, item.count / maxStatus * 100)}%` }} /></div><b>{item.count}</b></div>) : <p className="insight-empty">添加投递后会显示流程分布。</p>}</section>
        <section className="insight-card"><div className="insight-card-head"><div><span className="section-kicker">INDUSTRY MAP</span><h3>行业偏好</h3></div><small>按标签统计</small></div>{industryCounts.length ? <div className="rank-list">{industryCounts.map(([tag, count], index) => <div className="rank-row" key={tag}><span className="rank-number">0{index + 1}</span><strong>{tag}</strong><em>{count} 个岗位</em></div>)}</div> : <p className="insight-empty">给公司添加行业标签后，这里会更有参考价值。</p>}</section>
        <section className="insight-card"><div className="insight-card-head"><div><span className="section-kicker">LOCATION</span><h3>地点分布</h3></div><small>Base 城市</small></div>{locationCounts.length ? <div className="rank-list">{locationCounts.map(([location, count]) => <div className="rank-row" key={location}><span className="location-dot" /><strong>{location}</strong><em>{count} 个岗位</em></div>)}</div> : <p className="insight-empty">补充 Base 后可以比较城市机会。</p>}</section>
        <section className="insight-card upcoming-card"><div className="insight-card-head"><div><span className="section-kicker">NEXT UP</span><h3>最近面试</h3></div><small>按时间排序</small></div>{upcoming.length ? <div className="upcoming-list">{upcoming.map((item) => { const app = applications.find((entry) => entry.id === item.applicationId); return <div className="upcoming-row" key={item.id}><time>{formatInterviewTime(item.scheduledAt)}</time><div><strong>{app?.company || "未关联岗位"}</strong><span>{app?.position || ""} · {item.round}</span></div><b>{item.endedAt ? `${new Date(item.endedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 结束` : "待补结束时间"}</b></div>; })}</div> : <p className="insight-empty">近期没有安排好的面试。</p>}</section>
      </div>
    </div>
  );
}

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
  setGroupName: (value: string) => void;
  setInviteCode: (value: string) => void;
  copyInviteCode: () => void;
  copyShareLink: () => void;
  runAction: (payload: Record<string, unknown>, success: string) => Promise<void>;
}) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? null;

  const groupSwitcher = (
    <div className="group-switcher">
      <label>当前小组：</label>
      <select
        value={activeGroupId ?? ""}
        onChange={(event) => setActiveGroupId(event.target.value || null)}
      >
        {groups.length === 0 && <option value="">（无小组）</option>}
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name} ({g.members.length}人)
          </option>
        ))}
      </select>
      <button
        className="secondary-button compact-button"
        onClick={() => setShowCreateForm(true)}
      >
        ＋ 创建小组
      </button>
      <button
        className="secondary-button compact-button"
        onClick={() => setShowCreateForm(true)}
      >
        ↗ 加入小组
      </button>
    </div>
  );

  if (groups.length === 0 || showCreateForm || !activeGroup) {
    return (
      <div className="sharing-layout">
        {groups.length > 0 && (
          <div className="form-view-header">
            {groupSwitcher}
            <button className="secondary-button compact-button" onClick={() => setShowCreateForm(false)}>
              ← 返回小组
            </button>
          </div>
        )}
        <div className="sharing-intro">
          <p className="section-kicker">SHARED SPACE</p>
          <h2>和秋招搭子一起前进</h2>
          <p>创建小组后会得到一个邀请码。好友登录并输入邀请码即可加入，不需要公开任何默认数据。</p>
          <div className="privacy-points">
            <span><b>1</b> 所有岗位默认仅自己可见</span>
            <span><b>2</b> 每条记录单独选择分享范围</span>
            <span><b>3</b> 权限修改后立即生效</span>
          </div>
        </div>
        <div className="sharing-cards">
          <section className="sharing-card">
            <span className="sharing-card-icon">＋</span>
            <h3>创建新小组</h3>
            <p>适合你来邀请朋友。</p>
            <label><span>小组名称</span><input value={groupName} onChange={(event) => setGroupName(event.target.value)} /></label>
            <button className="primary-button" disabled={busy} onClick={() => runAction({ action: "createGroup", name: groupName }, "共享小组已创建")}>创建并获得邀请码</button>
          </section>
          <section className="sharing-card">
            <span className="sharing-card-icon outline">↗</span>
            <h3>加入好友的小组</h3>
            <p>输入好友发给你的 8 位邀请码。</p>
            <label><span>邀请码</span><input value={inviteCode} maxLength={8} onChange={(event) => setInviteCode(event.target.value.toUpperCase())} placeholder="例如：A1B2C3D4" /></label>
            <button className="secondary-button" disabled={busy || inviteCode.length < 8} onClick={() => runAction({ action: "joinGroup", inviteCode }, "已加入好友小组")}>加入小组</button>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="group-dashboard">
      {groupSwitcher}
      <div className="group-head">
        <div><p className="section-kicker">SHARED SPACE</p><h2>{activeGroup.name}</h2><p>{activeGroup.members.length} 位成员 · 你的身份是{activeGroup.role === "owner" ? "创建者" : "成员"}</p></div>
        <div className="invite-code-box">
          <small>好友邀请码</small>
          <strong>{activeGroup.inviteCode}</strong>
          <div className="invite-actions"><button onClick={copyInviteCode}>复制邀请码</button><button onClick={copyShareLink}>复制分享链接</button></div>
          <code>{typeof window !== "undefined" ? `${window.location.origin}/?invite=${activeGroup.inviteCode}` : ""}</code>
        </div>
      </div>
      <div className="group-grid">
        <section className="members-card">
          <div className="card-title"><h3>小组成员</h3><span>{activeGroup.members.length}</span></div>
          <div className="member-list">
            {activeGroup.members.map((member) => (
              <div className="member-row" key={member.email}>
                <span className="member-avatar">{member.display_name.slice(0, 1).toUpperCase()}</span>
                <span><strong>{member.display_name}</strong><small>{member.email}</small></span>
                <em>{member.role === "owner" ? "创建者" : "成员"}</em>
              </div>
            ))}
          </div>
        </section>
        <section className="privacy-card">
          <div className="card-title"><h3>隐私控制说明</h3><span>逐条设置</span></div>
          <div className="privacy-level"><i className="private" /><span><strong>仅自己</strong><small>好友看不到公司和任何进度</small></span></div>
          <div className="privacy-level"><i className="progress" /><span><strong>仅共享进度</strong><small>隐藏渠道、链接、薪资和私人备注</small></span></div>
          <div className="privacy-level"><i className="full" /><span><strong>完整共享</strong><small>小组成员能查看全部岗位信息</small></span></div>
        </section>
      </div>
      <div className="group-actions">
        {activeGroup.role === "owner" ? (
          <>
            <button className="secondary-button" disabled={busy} onClick={() => runAction({ action: "rotateInviteCode", groupId: activeGroupId }, "邀请码已更新")}>废弃旧邀请码并生成新的</button>
            <button className="danger-button" disabled={busy} onClick={() => window.confirm("删除小组后，成员关系会解除，已共享岗位会恢复为仅自己可见。确定删除吗？") && runAction({ action: "deleteGroup", groupId: activeGroupId }, "共享小组已删除")}>删除小组</button>
          </>
        ) : (
          <button className="danger-button" disabled={busy} onClick={() => window.confirm("退出后，你已共享的岗位会自动改为仅自己可见。确定退出吗？") && runAction({ action: "leaveGroup", groupId: activeGroupId }, "已退出共享小组")}>退出小组</button>
        )}
      </div>
    </div>
  );
}
