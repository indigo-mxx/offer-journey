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
  group: GroupInfo | null;
};

type Props = {
  user: ChatGPTUser | null;
  signInPath: string;
  signOutPath: string;
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

const EMPTY_FORM: Omit<
  Application,
  "id" | "updatedAt" | "ownerEmail" | "ownerName" | "isOwner" | "groupId"
> = {
  company: "",
  position: "",
  base: "",
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

function normalizeLocal(items: Application[]) {
  return items.map((item) => ({
    ...item,
    visibility: item.visibility ?? "private",
    isOwner: true,
  }));
}

export function RecruitmentTracker({
  user,
  signInPath,
  signOutPath,
}: Props) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [group, setGroup] = useState<GroupInfo | null>(null);
  const [localBackup, setLocalBackup] = useState<Application[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"mine" | "friends" | "sharing">("mine");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("全部状态");
  const [batchFilter, setBatchFilter] = useState("全部批次");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [notice, setNotice] = useState("");
  const [groupName, setGroupName] = useState("秋招搭子小组");
  const [inviteCode, setInviteCode] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  const cloudAction = useCallback(async (payload: Record<string, unknown>) => {
    const response = await fetch("/api/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(result.error || "操作失败");
  }, []);

  const loadCloud = useCallback(async () => {
    const response = await fetch("/api/workspace", { cache: "no-store" });
    const result = (await response.json()) as WorkspaceResponse & {
      error?: string;
    };
    if (!response.ok) throw new Error(result.error || "云端同步失败");
    setApplications(result.applications);
    setGroup(result.group);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let localItems: Application[] = [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (safeApplications(parsed)) localItems = normalizeLocal(parsed);
      }
    } catch {
      localItems = [];
    }

    if (user) {
      window.queueMicrotask(() => {
        if (!cancelled) {
          setLocalBackup(
            localItems.filter((item) => !item.id.startsWith("sample-")),
          );
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
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
          item.channel,
          item.note,
          item.ownerName,
        ]
          .join(" ")
          .toLowerCase();
        return (
          (!normalized || searchTarget.includes(normalized)) &&
          (statusFilter === "全部状态" || item.status === statusFilter) &&
          (batchFilter === "全部批次" || item.batch === batchFilter)
        );
      })
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }, [
    batchFilter,
    friendApplications,
    ownApplications,
    query,
    statusFilter,
    view,
  ]);

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

  function openCreate() {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      appliedAt: new Date().toISOString().slice(0, 10),
    });
    setIsFormOpen(true);
  }

  function openEdit(item: Application) {
    if (item.isOwner === false) return;
    setEditingId(item.id);
    setForm({
      company: item.company,
      position: item.position,
      base: item.base,
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
      visibility: group ? form.visibility : "private",
      company: form.company.trim(),
      position: form.position.trim(),
      id: editingId ?? crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
      isOwner: true,
    };
    setBusy(true);
    try {
      if (user) {
        await cloudAction({ action: "saveApplication", application: next });
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

  async function copyInviteCode() {
    if (!group) return;
    await navigator.clipboard.writeText(group.inviteCode);
    setNotice("邀请码已复制");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="秋招同行录首页">
          <span className="brand-mark">秋</span>
          <span>
            <strong>秋招同行录</strong>
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
              <span className="account-avatar">
                {user.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="account-copy">
                <strong>{user.displayName}</strong>
                <a href={signOutPath}>退出</a>
              </span>
            </div>
          ) : (
            <a className="secondary-button button-link" href={signInPath}>
              登录并同步
            </a>
          )}
          <button className="primary-button" onClick={openCreate}>
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
          <span className="hero-note-icon">{group ? "♧" : "⌁"}</span>
          <div>
            <strong>{group ? group.name : "今天的小提醒"}</strong>
            <p>
              {group
                ? `小组目前有 ${group.members.length} 位成员，好友公开的进度会显示在协作视图。`
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
        </nav>

        {view === "sharing" && user ? (
          <SharingPanel
            group={group}
            groupName={groupName}
            inviteCode={inviteCode}
            busy={busy}
            setGroupName={setGroupName}
            setInviteCode={setInviteCode}
            copyInviteCode={copyInviteCode}
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
                            onClick={() => openEdit(item)}
                            disabled={item.isOwner === false}
                            aria-label={`${item.isOwner === false ? "查看" : "编辑"} ${item.company} ${item.position}`}
                          >
                            <span className="company-avatar">{item.company.slice(0, 1)}</span>
                            <span><strong>{item.company}</strong><small>{item.position}</small></span>
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
                    ? group ? "好友还没有公开进度" : "先创建或加入一个共享小组"
                    : applications.length ? "没有符合条件的记录" : "从第一份投递开始"}
                </h3>
                <p>
                  {view === "friends"
                    ? "好友将岗位设为“仅共享进度”或“完整共享”后，会出现在这里。"
                    : "添加公司和岗位信息，我们会帮你记住后续的每一步。"}
                </p>
                {view === "friends" && !group ? (
                  <button className="primary-button" onClick={() => setView("sharing")}>设置共享小组</button>
                ) : view === "mine" && !ownApplications.length ? (
                  <button className="primary-button" onClick={openCreate}>＋ 新增投递</button>
                ) : null}
              </div>
            )}
          </>
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
              <div className="form-grid">
                <label><span>公司名称 *</span><input required autoFocus value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} placeholder="例如：字节跳动" /></label>
                <label><span>岗位名称 *</span><input required value={form.position} onChange={(event) => setForm({ ...form, position: event.target.value })} placeholder="例如：前端开发工程师" /></label>
                <label><span>Base 城市</span><input value={form.base} onChange={(event) => setForm({ ...form, base: event.target.value })} placeholder="例如：北京 / 上海" /></label>
                <label><span>招聘批次</span><select value={form.batch} onChange={(event) => setForm({ ...form, batch: event.target.value as Application["batch"] })}><option>提前批</option><option>秋招</option><option>日常实习</option><option>其他</option></select></label>
                <label><span>当前进度</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ApplicationStatus })}>{STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
                <label><span>投递时间</span><input type="date" value={form.appliedAt} onChange={(event) => setForm({ ...form, appliedAt: event.target.value })} /></label>
                <label><span>投递渠道</span><input value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value })} placeholder="招聘官网 / 内推 / 招聘平台" /></label>
                <label><span>薪资信息</span><input value={form.salary} onChange={(event) => setForm({ ...form, salary: event.target.value })} placeholder="可选，例如：25k × 15" /></label>
                <label className="full-field"><span>岗位链接</span><input type="url" value={form.link} onChange={(event) => setForm({ ...form, link: event.target.value })} placeholder="https://..." /></label>
                <label className="full-field"><span>备注 / 下一步</span><textarea rows={3} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="记录截止时间、面试安排、联系人或需要准备的内容" /></label>
                <label className="full-field privacy-field">
                  <span>谁可以看到这条记录</span>
                  <select
                    value={form.visibility}
                    onChange={(event) => setForm({ ...form, visibility: event.target.value as Visibility })}
                    disabled={!group}
                  >
                    <option value="private">仅自己可见</option>
                    <option value="progress">小组可见进度（隐藏渠道、链接、薪资和备注）</option>
                    <option value="full">小组可见完整信息</option>
                  </select>
                  <small>{group ? "你可以随时修改，权限立即生效。" : "加入共享小组后可开放给好友。"}</small>
                </label>
              </div>
              <div className="form-actions">
                <button type="button" className="secondary-button" onClick={closeForm}>取消</button>
                <button type="submit" className="primary-button" disabled={busy}>{busy ? "正在保存…" : editingId ? "保存修改" : "添加到清单"}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {notice && <div className="toast">{notice}</div>}
    </main>
  );
}

function SharingPanel({
  group,
  groupName,
  inviteCode,
  busy,
  setGroupName,
  setInviteCode,
  copyInviteCode,
  runAction,
}: {
  group: GroupInfo | null;
  groupName: string;
  inviteCode: string;
  busy: boolean;
  setGroupName: (value: string) => void;
  setInviteCode: (value: string) => void;
  copyInviteCode: () => void;
  runAction: (payload: Record<string, unknown>, success: string) => Promise<void>;
}) {
  if (!group) {
    return (
      <div className="sharing-layout">
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
      <div className="group-head">
        <div><p className="section-kicker">SHARED SPACE</p><h2>{group.name}</h2><p>{group.members.length} 位成员 · 你的身份是{group.role === "owner" ? "创建者" : "成员"}</p></div>
        <div className="invite-code-box">
          <small>好友邀请码</small>
          <strong>{group.inviteCode}</strong>
          <button onClick={copyInviteCode}>复制</button>
        </div>
      </div>
      <div className="group-grid">
        <section className="members-card">
          <div className="card-title"><h3>小组成员</h3><span>{group.members.length}</span></div>
          <div className="member-list">
            {group.members.map((member) => (
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
        {group.role === "owner" ? (
          <button className="secondary-button" disabled={busy} onClick={() => runAction({ action: "rotateInviteCode" }, "邀请码已更新")}>废弃旧邀请码并生成新的</button>
        ) : (
          <button className="danger-button" disabled={busy} onClick={() => window.confirm("退出后，你已共享的岗位会自动改为仅自己可见。确定退出吗？") && runAction({ action: "leaveGroup" }, "已退出共享小组")}>退出小组</button>
        )}
      </div>
    </div>
  );
}
