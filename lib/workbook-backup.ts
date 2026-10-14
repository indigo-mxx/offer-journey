import type { Application, ApplicationStatus, Interview, InterviewExperience, OfferCompensationDetails, RecruitmentEvent, RecruitmentEventStatus, RecruitmentEventType, Visibility } from "@/db/schema";
import type { Cell, Row, Worksheet } from "exceljs";
import { calculateRecruitmentAnalytics } from "./recruitment-analytics.ts";

export type WorkspaceBackup = {
  applications: Application[];
  interviews: Interview[];
  experiences: InterviewExperience[];
  events: RecruitmentEvent[];
};

export type WorkbookExportOptions = { scheduleSort?: "position" | "time"; statisticsApplicationIds?: string[]; statisticsRangeLabel?: string };
const INTERVIEW_STAGE_HEADERS = ["AI面", "一面", "二面", "三面", "终面", "HR面", "其他面试"];
function exportInterviewStage(round: string) {
  const value = round.toLowerCase();
  if (/ai|智能面/.test(value)) return "AI面";
  if (/hr|人力/.test(value)) return "HR面";
  if (/终|vp|高管|主管/.test(value)) return "终面";
  if (/三|3|交叉/.test(value)) return "三面";
  if (/二|2/.test(value)) return "二面";
  if (/一|1|初/.test(value)) return "一面";
  return "其他面试";
}
function displayInterviewTime(interview: Interview) {
  const date = validDate(interview.scheduledAt);
  if (!date) return "";
  const time = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  return `${time}${interview.timingType === "deadline" ? " 截止" : ""} · ${interview.result || "待定"}`;
}

const APPLICATION_STATUSES: ApplicationStatus[] = ["准备投递", "简历投递", "已投递", "简历筛选", "笔试", "AI面", "一面", "二面", "三面", "终面", "HR面", "已意向，待谈薪/签约", "Offer", "已拒绝", "流程结束"];
const VISIBILITY_LABELS: Record<Visibility, string> = { private: "仅自己", progress: "仅共享进度", full: "完整共享" };
const VISIBILITY_VALUES: Record<string, Visibility> = { "仅自己": "private", "仅共享进度": "progress", "共享进度": "progress", "完整共享": "full", private: "private", progress: "progress", full: "full" };
const EVENT_TYPE_LABELS: Record<RecruitmentEventType, string> = { written_test: "笔试", assessment: "测评", deadline: "截止事项", hr_contact: "HR 沟通", other: "其他" };
const EVENT_TYPE_VALUES: Record<string, RecruitmentEventType> = { "笔试": "written_test", "测评": "assessment", "截止事项": "deadline", "截止日期": "deadline", "HR 沟通": "hr_contact", "HR沟通": "hr_contact", "其他": "other", written_test: "written_test", assessment: "assessment", deadline: "deadline", hr_contact: "hr_contact", other: "other" };
const EVENT_STATUSES: RecruitmentEventStatus[] = ["待进行", "已完成", "已取消"];

function validDate(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
function exportDate(value: string) {
  const date = validDate(value);
  return date ? new Date(date.getTime() + BEIJING_OFFSET_MS) : null;
}

function excelText(value: unknown) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const item = value as { text?: unknown; result?: unknown; richText?: Array<{ text?: string }> };
    if (typeof item.text === "string") return item.text;
    if (item.result != null) return String(item.result);
    if (Array.isArray(item.richText)) return item.richText.map((part) => part.text ?? "").join("");
  }
  return String(value);
}

function dateFromExcel(value: unknown, dateOnly = false) {
  let date: Date | null = null;
  if (value instanceof Date) date = value;
  else if (typeof value === "number") date = new Date(Math.round((value - 25569) * 86_400_000));
  else {
    const text = excelText(value).trim();
    if (!text) return "";
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
    else return text;
  }
  if (!date || Number.isNaN(date.getTime())) return "";
  if (dateOnly) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return date.toISOString();
}

function splitTags(value: unknown) {
  return [...new Set(excelText(value).split(/[、,，/|]/).map((item) => item.trim()).filter(Boolean))].slice(0, 12);
}

function safeId(value: unknown) {
  const id = excelText(value).trim();
  return id || crypto.randomUUID();
}

function applicationKey(company: string, position: string) {
  return `${company.trim().toLocaleLowerCase()}|${position.trim().toLocaleLowerCase()}`;
}

async function loadExcelWorkbook() {
  // exceljs is CJS; under a bundler it exposes { Workbook } directly, while in
  // pure Node ESM the constructor sits under mod.default.Workbook. Resolve both.
  const mod: any = await import("exceljs");
  const Workbook = mod.Workbook ?? mod.default?.Workbook;
  if (typeof Workbook !== "function") {
    throw new Error("无法加载 Excel 引擎，请检查 exceljs 是否正常安装");
  }
  return new Workbook();
}

export async function createWorkspaceWorkbook(data: WorkspaceBackup, options: WorkbookExportOptions = {}) {
  const workbook = await loadExcelWorkbook();
  const exportedAt = new Date();
  workbook.creator = "秋招同行录";
  workbook.lastModifiedBy = "秋招同行录";
  workbook.created = exportedAt;
  workbook.modified = exportedAt;
  workbook.title = "秋招同行录完整备份";
  workbook.subject = "岗位、日程、面试与面经完整恢复备份";
  workbook.company = "MXX Career Studio";
  workbook.calcProperties.fullCalcOnLoad = true;

  const palette = {
    ink: "FF173D31",
    brand: "FF176B55",
    brandSoft: "FFE7F4EC",
    blue: "FF315F89",
    blueSoft: "FFEAF2F8",
    amber: "FFD49743",
    amberSoft: "FFFFF4DE",
    purple: "FF76558F",
    purpleSoft: "FFF1EAF6",
    line: "FFD8E4DC",
    white: "FFFFFFFF",
    muted: "FF6E8177",
  };
  const bodyFont = { name: "Microsoft YaHei", size: 10, color: { argb: palette.ink } };

  function addDataSheet(name: string, title: string, subtitle: string, columns: Array<{ header: string; key: string; width: number; hidden?: boolean }>, rows: Record<string, unknown>[], accent: string) {
    const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", xSplit: 2, ySplit: 4, showGridLines: false }] });
    sheet.mergeCells(1, 1, 1, columns.length);
    sheet.getCell("A1").value = title;
    sheet.getCell("A1").font = { name: "Microsoft YaHei", size: 20, bold: true, color: { argb: palette.white } };
    sheet.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
    sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: accent } };
    sheet.getRow(1).height = 38;
    sheet.mergeCells(2, 1, 2, columns.length);
    sheet.getCell("A2").value = subtitle;
    sheet.getCell("A2").font = { name: "Microsoft YaHei", size: 9, color: { argb: palette.muted } };
    sheet.getCell("A2").alignment = { vertical: "middle", wrapText: true };
    sheet.getRow(2).height = 26;
    sheet.getRow(3).height = 8;
    sheet.columns = columns.map((column) => ({ key: column.key, width: column.width, hidden: column.hidden }));
    const headerRow = sheet.getRow(4);
    headerRow.values = columns.map((column) => column.header);
    headerRow.height = 28;
    headerRow.eachCell((cell: Cell) => {
      cell.font = { name: "Microsoft YaHei", size: 10, bold: true, color: { argb: palette.white } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: accent } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = { bottom: { style: "medium", color: { argb: accent } } };
    });
    for (const rowData of rows) {
      const row = sheet.addRow(rowData);
      row.height = 28;
      row.eachCell({ includeEmpty: true }, (cell: Cell) => {
        cell.font = bodyFont;
        cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
        cell.border = { bottom: { style: "hair", color: { argb: palette.line } } };
      });
    }
    const tableRows = rows.length ? rows.map((row) => columns.map((column) => row[column.key] ?? "")) : [columns.map(() => "")];
    sheet.addTable({
      name: `${name.replace(/[^a-zA-Z0-9]/g, "") || `Sheet${workbook.worksheets.length}`}Table`,
      ref: "A4",
      headerRow: true,
      totalsRow: false,
      style: { theme: "TableStyleMedium2", showRowStripes: true },
      columns: columns.map((column) => ({ name: column.header, filterButton: true })),
      rows: tableRows,
    });
    sheet.eachRow((row: Row, rowNumber: number) => {
      if (rowNumber < 5) return;
      let lines = 1;
      columns.forEach((column, index) => {
        if (column.hidden) return;
        const text = row.getCell(index + 1).text;
        const estimated = text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil([...line].reduce((width, char) => width + (char.charCodeAt(0) > 255 ? 2 : 1), 0) / Math.max(column.width - 2, 1))), 0);
        lines = Math.max(lines, estimated);
      });
      row.height = Math.min(240, Math.max(28, lines * 15 + 10));
    });
    return sheet;
  }

  const appById = new Map(data.applications.map((item) => [item.id, item]));
  const interviewById = new Map(data.interviews.map((item) => [item.id, item]));
  const recruitmentEvents = Array.isArray(data.events) ? data.events : [];
  const sortLabel = options.scheduleSort === "time" ? "按时间从早到晚" : "按公司 / 岗位，同岗位按时间从早到晚";
  const comparePosition = (a: { applicationId: string }, b: { applicationId: string }) => {
    const left = appById.get(a.applicationId);
    const right = appById.get(b.applicationId);
    return (left?.company ?? "").localeCompare(right?.company ?? "", "zh-CN")
      || (left?.position ?? "").localeCompare(right?.position ?? "", "zh-CN")
      || a.applicationId.localeCompare(b.applicationId);
  };
  const compareTime = (a: string, b: string) => (validDate(a)?.getTime() ?? Infinity) - (validDate(b)?.getTime() ?? Infinity);
  const sortedInterviews = [...data.interviews].sort((a, b) =>
    (options.scheduleSort === "time" ? compareTime(a.scheduledAt, b.scheduledAt) || comparePosition(a, b) : comparePosition(a, b) || compareTime(a.scheduledAt, b.scheduledAt)) || a.id.localeCompare(b.id));
  const linkedInterview = (item: InterviewExperience) => {
    const explicit = interviewById.get(item.interviewId ?? "");
    if (explicit && (!item.applicationId || explicit.applicationId === item.applicationId)) return explicit;
    const candidates = data.interviews.filter((interview) => item.applicationId && interview.applicationId === item.applicationId && interview.round === item.round);
    return candidates.length === 1 ? candidates[0] : undefined;
  };

  const statisticsIds = options.statisticsApplicationIds ? new Set(options.statisticsApplicationIds) : null;
  const statisticsApplications = data.applications.filter((item) => !statisticsIds || statisticsIds.has(item.id));
  const statistics = calculateRecruitmentAnalytics(statisticsApplications, data.interviews, recruitmentEvents, data.experiences);
  const proportion = (count: number) => statistics.total ? count / statistics.total : null;
  const statisticsRows: Record<string, unknown>[] = [
    { section: "总览", metric: "岗位投递", count: statistics.total, note: `${new Set(statisticsApplications.map((item) => item.company.trim().toLowerCase())).size} 家公司` },
    { section: "总览", metric: "活跃流程", count: statistics.active, note: "当前仍在推进的岗位" },
    { section: "总览", metric: "累计进入面试", count: statistics.interview, ratio: proportion(statistics.interview), note: "按岗位去重，包含已结束流程" },
    { section: "总览", metric: "累计进入测评 / 笔试", count: statistics.written, ratio: proportion(statistics.written), note: "依据安排、记录或最终结果" },
    { section: "总览", metric: "Offer（含意向）", count: statistics.offers, ratio: statistics.offerRate / 100, note: `正式 ${statistics.formalOffers} · 待谈薪意向 ${statistics.intents}` },
    { section: "总览", metric: "流程推进率", count: statistics.progressed, ratio: proportion(statistics.progressed), note: "已走出简历阶段" },
    { section: "总览", metric: "面试通过率", count: statistics.resolved, passed: statistics.passed, failed: statistics.failed, ratio: statistics.passRate === null ? null : statistics.passRate / 100, note: "通过 ÷（通过 + 未通过）；数量为明确填写结果的场次" },
    { section: "总览", metric: "待定 / 未开始", count: statistics.pending, note: "面试场次，不计入通过率" },
    { section: "总览", metric: "未参加", count: statistics.absent, note: "面试场次，不计入通过率" },
    ...statistics.stages.map((item) => ({ section: "各轮面试", metric: item.stage, count: item.total, passed: item.passed, failed: item.failed, ratio: item.rate === null ? null : item.rate / 100, note: "通过率仅使用已填写通过 / 未通过的场次" })),
    { section: "OC / 意向", metric: "已获 OC / 意向（含正式 Offer）", count: statistics.offers, ratio: proportion(statistics.offers) },
    { section: "OC / 意向", metric: "待谈薪 / 签约意向", count: statistics.intents },
    { section: "OC / 意向", metric: "正式 Offer", count: statistics.formalOffers },
    { section: "OC / 意向", metric: "尚无 OC / 意向记录", count: statistics.total - statistics.offers },
  ];
  const distributions = [
    ["简历阶段", ["准备投递", "简历投递", "已投递", "简历筛选"]],
    ["笔试", ["笔试"]], ["面试中", ["AI面", "一面", "二面", "三面", "终面", "HR面"]],
    ["待谈薪/签约", ["已意向，待谈薪/签约"]], ["正式 Offer", ["Offer"]], ["已结束", ["已拒绝", "流程结束"]],
  ] as const;
  for (const [metric, statuses] of distributions) {
    const count = statisticsApplications.filter((item) => (statuses as readonly string[]).includes(item.status)).length;
    statisticsRows.push({ section: "当前流程分布", metric, count, ratio: proportion(count), note: "按当前状态统计" });
  }
  for (let index = 5; index >= 0; index--) {
    const month = new Date(Date.UTC(exportedAt.getFullYear(), exportedAt.getMonth() - index, 1));
    const key = month.toISOString().slice(0, 7);
    const count = statisticsApplications.filter((item) => item.appliedAt?.startsWith(key)).length;
    statisticsRows.push({ section: "近六个月投递趋势", metric: key, count, note: "按投递日期汇总" });
  }
  function addRank(section: string, values: string[]) {
    const counts = new Map<string, number>();
    for (const value of values) { const label = value.trim() || "未填写"; counts.set(label, (counts.get(label) ?? 0) + 1); }
    for (const [metric, count] of [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN")).slice(0, 5)) {
      statisticsRows.push({ section, metric, count, note: "前 5 项；与看板展示范围一致" });
    }
  }
  addRank("投递渠道", statisticsApplications.map((item) => item.channel ?? ""));
  addRank("目标地点", statisticsApplications.flatMap((item) => (item.base || "未填写").split(/[、,，/]/)));
  addRank("投递批次", statisticsApplications.map((item) => item.batch));
  const legacyNatures = new Map([["国企/央企", "国企"], ["事业单位", "事业单位"], ["外企", "外企"], ["创业公司", "私企"]]);
  addRank("行业方向", statisticsApplications.flatMap((item) => {
    const tags = (item.industryTags ?? []).filter((tag) => !tag.startsWith("单位性质：") && !tag.startsWith("单位细分：") && !legacyNatures.has(tag));
    return tags.length ? tags : ["未标注"];
  }));
  addRank("单位性质", statisticsApplications.map((item) => {
    const tags = item.industryTags ?? [];
    const nature = tags.find((tag) => tag.startsWith("单位性质："))?.slice(5) || tags.map((tag) => legacyNatures.get(tag)).find(Boolean);
    return nature === "民企" ? "私企" : nature || "未标注";
  }));
  addRank("流程结论", statisticsApplications.filter((item) => ["已拒绝", "流程结束"].includes(item.status)).map((item) => item.finalOutcome || item.rejectionReason || "未注明"));
  const statisticsSheet = addDataSheet("数据统计", "投递数据看板", `统计范围：${options.statisticsRangeLabel ?? "全部投递"}。累计历史记录包含已结束流程；空白比例表示暂无明确结果。此表为导出时的统计快照。`, [
    { header: "分类", key: "section", width: 23 }, { header: "统计项目", key: "metric", width: 36 },
    { header: "数量", key: "count", width: 12 }, { header: "通过", key: "passed", width: 12 },
    { header: "未通过", key: "failed", width: 12 }, { header: "比例 / 通过率", key: "ratio", width: 18 },
    { header: "统计口径", key: "note", width: 62 },
  ], statisticsRows, palette.brand);
  statisticsSheet.getColumn("ratio").numFmt = "0%";
  for (const key of ["count", "passed", "failed"]) statisticsSheet.getColumn(key).numFmt = "0";

  const applicationsSheet = addDataSheet("岗位记录", "岗位记录", "各轮面试时间为北京时间汇总（只读）；同轮多场全部保留。明细请编辑“面试安排”，隐藏列用于恢复关联。", [
    { header: "公司", key: "company", width: 18 }, { header: "岗位", key: "position", width: 24 }, { header: "Base", key: "base", width: 12 },
    { header: "行业标签", key: "industryTags", width: 24 }, { header: "公司规模", key: "companyScale", width: 14 }, { header: "批次", key: "batch", width: 12 },
    { header: "当前进度", key: "status", width: 24 }, { header: "投递日期", key: "appliedAt", width: 13 }, { header: "投递渠道", key: "channel", width: 16 },
    { header: "岗位链接", key: "link", width: 34 }, { header: "薪资", key: "salary", width: 16 }, { header: "备注", key: "note", width: 34 },
    { header: "最终结果", key: "finalOutcome", width: 14 }, { header: "拒绝原因", key: "rejectionReason", width: 20 }, { header: "公开范围", key: "visibility", width: 14 },
    { header: "Offer 获得时间", key: "offerReceivedAt", width: 19 }, { header: "Offer 答复截止", key: "offerDeadline", width: 19 }, { header: "预计入职日期", key: "offerOnboardDate", width: 15 },
    { header: "Offer 薪酬", key: "offerCompensation", width: 24 }, { header: "Offer 福利", key: "offerBenefits", width: 30 }, { header: "Offer 联系人", key: "offerContact", width: 20 },
    { header: "Offer 备注", key: "offerNote", width: 34 }, { header: "共享 Offer 详情", key: "offerShared", width: 16 },
    { header: "Offer 收入计算参数", key: "offerCompensationDetails", width: 24, hidden: true },
    ...INTERVIEW_STAGE_HEADERS.map((stage) => ({ header: `${stage}时间与结果`, key: `stage:${stage}`, width: 30 })),
    { header: "岗位ID", key: "id", width: 18, hidden: true }, { header: "共享小组ID", key: "groupId", width: 18, hidden: true },
    { header: "创建时间", key: "createdAt", width: 20, hidden: true }, { header: "更新时间", key: "updatedAt", width: 20, hidden: true },
  ], data.applications.map((item) => ({
    company: item.company, position: item.position, base: item.base, industryTags: item.industryTags.join("、"), companyScale: item.companyScale,
    batch: item.batch, status: item.status, appliedAt: validDate(item.appliedAt), channel: item.channel, link: item.link, salary: item.salary, note: item.note,
    finalOutcome: item.finalOutcome ?? "", rejectionReason: item.rejectionReason ?? "", visibility: VISIBILITY_LABELS[item.visibility], id: item.id,
    offerReceivedAt: exportDate(item.offerReceivedAt ?? ""), offerDeadline: exportDate(item.offerDeadline ?? ""), offerOnboardDate: validDate(item.offerOnboardDate ?? ""),
    offerCompensation: item.offerCompensation ?? "", offerBenefits: item.offerBenefits ?? "", offerContact: item.offerContact ?? "", offerNote: item.offerNote ?? "", offerShared: item.offerShared ? "是" : "否",
    offerCompensationDetails: item.offerCompensationDetails ? JSON.stringify(item.offerCompensationDetails) : "",
    groupId: item.groupId ?? "", createdAt: exportDate(item.createdAt ?? ""), updatedAt: exportDate(item.updatedAt),
    ...Object.fromEntries(INTERVIEW_STAGE_HEADERS.map((stage) => [`stage:${stage}`, data.interviews
      .filter((interview) => interview.applicationId === item.id && exportInterviewStage(interview.round) === stage)
      .sort((a, b) => compareTime(a.scheduledAt, b.scheduledAt)).map(displayInterviewTime).filter(Boolean).join("\n")])),
  })), palette.brand);
  applicationsSheet.getColumn("appliedAt").numFmt = "yyyy-mm-dd";
  applicationsSheet.getColumn("offerReceivedAt").numFmt = "yyyy-mm-dd hh:mm";
  applicationsSheet.getColumn("offerDeadline").numFmt = "yyyy-mm-dd hh:mm";
  applicationsSheet.getColumn("offerOnboardDate").numFmt = "yyyy-mm-dd";
  applicationsSheet.getColumn("createdAt").numFmt = "yyyy-mm-dd hh:mm";
  applicationsSheet.getColumn("updatedAt").numFmt = "yyyy-mm-dd hh:mm";
  applicationsSheet.getColumn("link").eachCell((cell: Cell, rowNumber: number) => {
    if (rowNumber <= 4 || !cell.text) return;
    cell.value = { text: cell.text, hyperlink: cell.text, tooltip: "打开岗位链接" };
    cell.font = { ...bodyFont, color: { argb: palette.blue }, underline: true };
  });

  const interviewsSheet = addDataSheet("面试安排", "面试安排", `每行一场面试，${sortLabel}。本表是面试恢复来源；日程安排中的面试行为只读汇总。`, [
    { header: "公司", key: "company", width: 18 }, { header: "岗位", key: "position", width: 24 }, { header: "轮次", key: "round", width: 14 },
    { header: "时间类型", key: "timingType", width: 14 }, { header: "开始时间", key: "scheduledAt", width: 19 }, { header: "结束时间", key: "endedAt", width: 19 }, { header: "形式", key: "format", width: 14 },
    { header: "结果", key: "result", width: 12 }, { header: "地点", key: "location", width: 18 }, { header: "会议链接", key: "eventUrl", width: 34 }, { header: "面试官", key: "interviewer", width: 16 }, { header: "总结", key: "summary", width: 36 },
    { header: "后续安排", key: "nextSteps", width: 30 }, { header: "岗位ID", key: "applicationId", width: 18, hidden: true },
    { header: "面试ID", key: "id", width: 18, hidden: true }, { header: "创建时间", key: "createdAt", width: 20, hidden: true }, { header: "更新时间", key: "updatedAt", width: 20, hidden: true },
  ], sortedInterviews.map((item) => {
    const application = appById.get(item.applicationId);
    return { company: application?.company ?? "", position: application?.position ?? "", round: item.round, timingType: item.timingType === "deadline" ? "截止时间" : "指定时间", scheduledAt: exportDate(item.scheduledAt), endedAt: exportDate(item.endedAt), format: item.format, result: item.result, location: item.location ?? "", eventUrl: item.eventUrl ?? "", interviewer: item.interviewer, summary: item.summary, nextSteps: item.nextSteps, applicationId: item.applicationId, id: item.id, createdAt: exportDate(item.createdAt ?? ""), updatedAt: exportDate(item.updatedAt) };
  }), palette.blue);
  interviewsSheet.getColumn("scheduledAt").numFmt = "yyyy-mm-dd hh:mm";
  interviewsSheet.getColumn("endedAt").numFmt = "yyyy-mm-dd hh:mm";
  interviewsSheet.getColumn("createdAt").numFmt = "yyyy-mm-dd hh:mm";
  interviewsSheet.getColumn("updatedAt").numFmt = "yyyy-mm-dd hh:mm";
  interviewsSheet.getColumn("eventUrl").eachCell((cell: Cell, rowNumber: number) => {
    if (rowNumber <= 4 || !cell.text) return;
    cell.value = { text: cell.text, hyperlink: cell.text, tooltip: "打开面试链接" };
    cell.font = { ...bodyFont, color: { argb: palette.blue }, underline: true };
  });

  const scheduleRows = [
    ...recruitmentEvents.map((item) => ({
      ...item, source: "event", startsAtText: item.startsAt, result: "", round: "",
      company: appById.get(item.applicationId)?.company ?? "", position: appById.get(item.applicationId)?.position ?? "",
      eventType: EVENT_TYPE_LABELS[item.eventType], timingType: item.timingType === "deadline" ? "截止时间" : "指定时间",
      startsAt: exportDate(item.startsAt), endsAt: exportDate(item.endsAt), allDay: item.allDay ? "是" : "否",
      createdAt: exportDate(item.createdAt ?? ""), updatedAt: exportDate(item.updatedAt),
    })),
    ...data.interviews.map((item) => ({
      id: item.id, applicationId: item.applicationId, source: "interview", startsAtText: item.scheduledAt,
      company: appById.get(item.applicationId)?.company ?? "", position: appById.get(item.applicationId)?.position ?? "",
      eventType: "面试", title: item.round, round: item.round, result: item.result,
      timingType: item.timingType === "deadline" ? "截止时间" : "指定时间",
      startsAt: exportDate(item.scheduledAt), endsAt: exportDate(item.endedAt), allDay: "否", mode: item.format,
      location: item.location ?? "", eventUrl: item.eventUrl ?? "", note: item.summary,
      status: item.endedAt || ["通过", "未通过", "未参加"].includes(item.result) ? "已完成" : "待进行",
      createdAt: exportDate(item.createdAt ?? ""), updatedAt: exportDate(item.updatedAt),
    })),
  ].sort((a, b) => (options.scheduleSort === "time" ? compareTime(a.startsAtText, b.startsAtText) || comparePosition(a, b) : comparePosition(a, b) || compareTime(a.startsAtText, b.startsAtText)) || a.id.localeCompare(b.id));
  const eventsSheet = addDataSheet("日程安排", "日程安排 · 全部事项", `包含面试、测评、笔试及其他事项；${sortLabel}。面试行仅供查看，修改与恢复以“面试安排”为准。`, [
    { header: "公司", key: "company", width: 18 }, { header: "岗位", key: "position", width: 24 }, { header: "类型", key: "eventType", width: 13 }, { header: "时间类型", key: "timingType", width: 14 },
    { header: "标题", key: "title", width: 28 }, { header: "开始时间", key: "startsAt", width: 19 }, { header: "结束时间", key: "endsAt", width: 19 },
    { header: "全天", key: "allDay", width: 10 }, { header: "形式", key: "mode", width: 14 }, { header: "地点", key: "location", width: 18 },
    { header: "日程链接", key: "eventUrl", width: 34 }, { header: "状态", key: "status", width: 12 }, { header: "面试轮次", key: "round", width: 14 }, { header: "面试结果", key: "result", width: 12 }, { header: "备注", key: "note", width: 36 },
    { header: "记录来源", key: "source", width: 14, hidden: true },
    { header: "岗位ID", key: "applicationId", width: 18, hidden: true }, { header: "日程ID", key: "id", width: 18, hidden: true },
    { header: "创建时间", key: "createdAt", width: 20, hidden: true }, { header: "更新时间", key: "updatedAt", width: 20, hidden: true },
  ], scheduleRows, palette.purple);
  eventsSheet.getColumn("startsAt").numFmt = "yyyy-mm-dd hh:mm";
  eventsSheet.getColumn("endsAt").numFmt = "yyyy-mm-dd hh:mm";
  eventsSheet.getColumn("createdAt").numFmt = "yyyy-mm-dd hh:mm";
  eventsSheet.getColumn("updatedAt").numFmt = "yyyy-mm-dd hh:mm";
  eventsSheet.getColumn("eventUrl").eachCell((cell: Cell, rowNumber: number) => {
    if (rowNumber <= 4 || !cell.text) return;
    cell.value = { text: cell.text, hyperlink: cell.text, tooltip: "打开日程链接" };
    cell.font = { ...bodyFont, color: { argb: palette.purple }, underline: true };
  });

  const sortedExperiences = [...data.experiences].sort((a, b) => {
    const left = appById.get(a.applicationId ?? "");
    const right = appById.get(b.applicationId ?? "");
    return (left?.company ?? a.company).localeCompare(right?.company ?? b.company, "zh-CN")
      || (left?.position ?? a.position).localeCompare(right?.position ?? b.position, "zh-CN")
      || (a.applicationId ?? "").localeCompare(b.applicationId ?? "")
      || INTERVIEW_STAGE_HEADERS.indexOf(exportInterviewStage(a.round)) - INTERVIEW_STAGE_HEADERS.indexOf(exportInterviewStage(b.round))
      || compareTime(linkedInterview(a)?.scheduledAt ?? a.createdAt ?? "", linkedInterview(b)?.scheduledAt ?? b.createdAt ?? "")
      || a.id.localeCompare(b.id);
  });
  const experiencesSheet = addDataSheet("面经库", "面经库 · 按岗位归档", "相同公司 / 岗位放在一起，依轮次与时间排列。面试结果取自关联场次（只读），请在“面试安排”修改。", [
    { header: "公司", key: "company", width: 18 }, { header: "岗位", key: "position", width: 24 }, { header: "标题", key: "title", width: 28 },
    { header: "轮次", key: "round", width: 14 }, { header: "通过与否", key: "result", width: 12 }, { header: "标签", key: "tags", width: 22 }, { header: "面试内容", key: "content", width: 52 },
    { header: "复盘要点", key: "takeaway", width: 40 }, { header: "共享范围", key: "visibility", width: 14 }, { header: "面试时间", key: "interviewAt", width: 19 },
    { header: "岗位ID", key: "applicationId", width: 18, hidden: true }, { header: "面试ID", key: "interviewId", width: 18, hidden: true },
    { header: "面经ID", key: "id", width: 18, hidden: true }, { header: "共享小组ID", key: "groupId", width: 18, hidden: true }, { header: "创建时间", key: "createdAt", width: 20, hidden: true }, { header: "更新时间", key: "updatedAt", width: 20, hidden: true },
  ], sortedExperiences.map((item) => ({
    title: item.title, company: appById.get(item.applicationId ?? "")?.company ?? item.company, position: appById.get(item.applicationId ?? "")?.position ?? item.position, round: item.round, result: linkedInterview(item)?.result || "未关联结果", tags: item.tags.join("、"), content: item.content, takeaway: item.takeaway,
    interviewAt: exportDate(linkedInterview(item)?.scheduledAt ?? ""), applicationId: item.applicationId ?? "", interviewId: item.interviewId ?? "", id: item.id,
    visibility: item.visibility === "full" ? "共享给好友" : "仅自己", groupId: item.groupId ?? "", createdAt: exportDate(item.createdAt ?? ""), updatedAt: exportDate(item.updatedAt),
  })), palette.amber);
  experiencesSheet.getColumn("interviewAt").numFmt = "yyyy-mm-dd hh:mm";
  experiencesSheet.getColumn("createdAt").numFmt = "yyyy-mm-dd hh:mm";
  experiencesSheet.getColumn("updatedAt").numFmt = "yyyy-mm-dd hh:mm";
  experiencesSheet.eachRow((row: Row, rowNumber: number) => { if (rowNumber >= 5) row.height = Math.max(row.height ?? 28, 44); });
  for (const sheet of [interviewsSheet, eventsSheet, experiencesSheet]) {
    sheet.getColumn("result").eachCell((cell: Cell, rowNumber: number) => {
      if (rowNumber <= 4) return;
      const color = cell.text === "通过" ? palette.brand : cell.text === "未通过" ? "FFAB493D" : palette.muted;
      cell.font = { ...bodyFont, bold: ["通过", "未通过"].includes(cell.text), color: { argb: color } };
    });
  }

  const guide = workbook.addWorksheet("使用说明", { views: [{ showGridLines: false }] });
  guide.columns = [{ width: 4 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 4 }];
  guide.mergeCells("B2:E3");
  guide.getCell("B2").value = "秋招同行录 · 完整恢复备份";
  guide.getCell("B2").font = { name: "Microsoft YaHei", size: 24, bold: true, color: { argb: palette.white } };
  guide.getCell("B2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: palette.brand } };
  guide.getCell("B2").alignment = { vertical: "middle", horizontal: "left" };
  guide.getRow(2).height = 32;
  guide.getRow(3).height = 32;
  guide.mergeCells("B5:E5");
  guide.getCell("B5").value = `导出时间：${exportedAt.toLocaleString("zh-CN")}　｜　备份版本：6`;
  guide.getCell("B5").font = { name: "Microsoft YaHei", size: 10, color: { argb: palette.muted } };
  guide.mergeCells("B6:E6");
  guide.getCell("B6").value = "时间显示：北京时间（UTC+8）";
  guide.getCell("B6").font = bodyFont;
  const cards = [["岗位记录", data.applications.length, palette.brandSoft, palette.brand], ["面试安排", data.interviews.length, palette.blueSoft, palette.blue], ["全部日程", scheduleRows.length, palette.purpleSoft, palette.purple], ["面经沉淀", data.experiences.length, palette.amberSoft, palette.amber]] as const;
  cards.forEach(([label, count, fill, color], index) => {
    const column = 2 + index;
    const cell = guide.getCell(7, column);
    cell.value = `${count}\n${label}`;
    cell.font = { name: "Microsoft YaHei", size: 12, bold: true, color: { argb: color } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { top: { style: "thin", color: { argb: color } }, bottom: { style: "thin", color: { argb: color } }, left: { style: "thin", color: { argb: color } }, right: { style: "thin", color: { argb: color } } };
  });
  guide.getRow(7).height = 58;
  guide.mergeCells("B10:E10");
  guide.getCell("B10").value = "恢复说明";
  guide.getCell("B10").font = { name: "Microsoft YaHei", size: 15, bold: true, color: { argb: palette.ink } };
  const notes = [
    "1. 在秋招同行录中点击“导入备份”，选择本文件即可恢复。",
    "2. 推荐使用“合并导入”；只有确认云端记录需要整体重建时才选择“替换”。",
    "3. 可以修改可见的中文字段，但请勿删除工作表或隐藏的关联列。",
    "4. .xlsx 原生保存中文，不需要另选编码，Excel/WPS 均不会出现 CSV 式乱码。",
    "5. 共享小组成员关系不会写入备份；恢复时无效的小组会自动转为“仅自己可见”。",
    `6. 日程排序：${sortLabel}。面经始终按公司、岗位和面试轮次归档。`,
    "7. 岗位的各轮时间、日程中的面试行和面经通过与否为汇总信息；面试恢复以“面试安排”为准，避免重复导入。",
    "8. 数据统计包含导出时的数据看板快照；导入时由恢复后的业务记录重新计算，不重复导入统计行。",
  ];
  notes.forEach((note, index) => {
    guide.mergeCells(12 + index, 2, 12 + index, 5);
    const cell = guide.getCell(12 + index, 2);
    cell.value = note;
    cell.font = bodyFont;
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: index % 2 ? "FFF7FAF8" : "FFFFFFFF" } };
    cell.border = { bottom: { style: "hair", color: { argb: palette.line } } };
    guide.getRow(12 + index).height = 30;
  });
  guide.state = "visible";
  workbook.views = [{ x: 0, y: 0, width: 12000, height: 20000, firstSheet: 0, activeTab: workbook.worksheets.indexOf(statisticsSheet), visibility: "visible" }];

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export async function readWorkspaceWorkbook(file: File): Promise<WorkspaceBackup> {
  const workbook = await loadExcelWorkbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const applicationsSheet = workbook.getWorksheet("岗位记录");
  const interviewsSheet = workbook.getWorksheet("面试安排");
  const eventsSheet = workbook.getWorksheet("日程安排");
  const experiencesSheet = workbook.getWorksheet("面经库");
  if (!applicationsSheet) throw new Error("Excel 中缺少“岗位记录”工作表");
  const beijingDates = workbook.getWorksheet("使用说明")?.getCell("B6").text === "时间显示：北京时间（UTC+8）";
  function readWorkbookDate(value: unknown, dateOnly = false) {
    const parsed = dateFromExcel(value, dateOnly);
    if (!beijingDates || dateOnly || !parsed) return parsed;
    // Excel stores timezone-free serials. Undo the display offset for v6 files;
    // explicit ISO strings entered by users already identify an instant.
    if (typeof value === "string" && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) return parsed;
    const plainDate = typeof value === "string" ? value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/) : null;
    const date = plainDate
      ? new Date(Date.UTC(Number(plainDate[1]), Number(plainDate[2]) - 1, Number(plainDate[3]), Number(plainDate[4] ?? 0), Number(plainDate[5] ?? 0), Number(plainDate[6] ?? 0)))
      : validDate(parsed);
    return date ? new Date(date.getTime() - BEIJING_OFFSET_MS).toISOString() : parsed;
  }

  function records(sheet: Worksheet | undefined) {
    if (!sheet) return [] as Record<string, unknown>[];
    const headers = new Map<number, string>();
    sheet.getRow(4).eachCell({ includeEmpty: true }, (cell: Cell, column: number) => headers.set(column, cell.text.trim()));
    const result: Record<string, unknown>[] = [];
    // actualRowCount undercounts after xlsx.load (it is not recomputed on
    // read), so iterate up to rowCount and let the empty-row filter below drop
    // any trailing blank rows that the table/filter view may have left behind.
    const lastRow = Math.max(sheet.rowCount ?? 0, sheet.actualRowCount ?? 0);
    for (let rowNumber = 5; rowNumber <= lastRow; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const record: Record<string, unknown> = {};
      headers.forEach((header, column) => { if (header) record[header] = row.getCell(column).value; });
      if (Object.values(record).some((value) => excelText(value).trim())) result.push(record);
    }
    return result;
  }

  const now = new Date().toISOString();
  const applications = records(applicationsSheet).map((row): Application => {
    const statusText = excelText(row["当前进度"]).trim() as ApplicationStatus;
    return {
      id: safeId(row["岗位ID"]), company: excelText(row["公司"]).trim(), position: excelText(row["岗位"]).trim(), base: excelText(row["Base"]).trim(),
      industryTags: splitTags(row["行业标签"]), companyScale: excelText(row["公司规模"]).trim(), batch: excelText(row["批次"]).trim() || "秋招",
      status: APPLICATION_STATUSES.includes(statusText) ? statusText : "准备投递", appliedAt: readWorkbookDate(row["投递日期"], true), channel: excelText(row["投递渠道"]).trim(),
      link: excelText(row["岗位链接"]).trim(), salary: excelText(row["薪资"]).trim(), note: excelText(row["备注"]).trim(), finalOutcome: excelText(row["最终结果"]).trim(),
      rejectionReason: excelText(row["拒绝原因"]).trim(), visibility: VISIBILITY_VALUES[excelText(row["公开范围"]).trim()] ?? "private", groupId: excelText(row["共享小组ID"]).trim() || null,
      offerReceivedAt: readWorkbookDate(row["Offer 获得时间"]), offerDeadline: readWorkbookDate(row["Offer 答复截止"]), offerOnboardDate: readWorkbookDate(row["预计入职日期"], true),
      offerCompensation: excelText(row["Offer 薪酬"]).trim(), offerBenefits: excelText(row["Offer 福利"]).trim(), offerContact: excelText(row["Offer 联系人"]).trim(), offerNote: excelText(row["Offer 备注"]).trim(), offerShared: excelText(row["共享 Offer 详情"]).trim() === "是",
      offerCompensationDetails: (() => { try { const parsed = JSON.parse(excelText(row["Offer 收入计算参数"])); return parsed && typeof parsed === "object" ? parsed as OfferCompensationDetails : undefined; } catch { return undefined; } })(),
      createdAt: readWorkbookDate(row["创建时间"]) || now, updatedAt: readWorkbookDate(row["更新时间"]) || now, isOwner: true,
    };
  }).filter((item) => item.company && item.position);
  if (applications.length > 500) throw new Error("单次最多导入 500 个岗位");
  const applicationIds = new Set(applications.map((item) => item.id));
  const applicationByName = new Map(applications.map((item) => [applicationKey(item.company, item.position), item.id]));

  const interviews = records(interviewsSheet).map((row): Interview | null => {
    const applicationId = excelText(row["岗位ID"]).trim() || applicationByName.get(applicationKey(excelText(row["公司"]), excelText(row["岗位"]))) || "";
    const scheduledAt = readWorkbookDate(row["开始时间"]);
    if (!applicationIds.has(applicationId) || !scheduledAt) return null;
    return { id: safeId(row["面试ID"]), applicationId, scheduledAt, endedAt: readWorkbookDate(row["结束时间"]), timingType: excelText(row["时间类型"]).trim() === "截止时间" ? "deadline" : "scheduled", round: excelText(row["轮次"]).trim() || "一面", format: excelText(row["形式"]).trim() || "视频面试", result: excelText(row["结果"]).trim() || "待定", location: excelText(row["地点"]).trim(), eventUrl: excelText(row["会议链接"]).trim(), interviewer: excelText(row["面试官"]).trim(), summary: excelText(row["总结"]).trim(), nextSteps: excelText(row["后续安排"]).trim(), createdAt: readWorkbookDate(row["创建时间"]) || now, updatedAt: readWorkbookDate(row["更新时间"]) || now };
  }).filter((item): item is Interview => Boolean(item));
  if (interviews.length > 1000) throw new Error("单次最多导入 1000 条面试记录");
  const interviewIds = new Set(interviews.map((item) => item.id));

  const events = records(eventsSheet).map((row): RecruitmentEvent | null => {
    if (excelText(row["记录来源"]) === "interview" || excelText(row["类型"]) === "面试") return null;
    const applicationId = excelText(row["岗位ID"]).trim() || applicationByName.get(applicationKey(excelText(row["公司"]), excelText(row["岗位"]))) || "";
    const eventType = EVENT_TYPE_VALUES[excelText(row["类型"]).trim()];
    const startsAt = readWorkbookDate(row["开始时间"]);
    const endsAt = readWorkbookDate(row["结束时间"]);
    const statusText = excelText(row["状态"]).trim() as RecruitmentEventStatus;
    if (!applicationIds.has(applicationId) || !eventType || !startsAt || (endsAt && new Date(endsAt).getTime() < new Date(startsAt).getTime())) return null;
    return { id: safeId(row["日程ID"]), applicationId, eventType, timingType: excelText(row["时间类型"]).trim() === "截止时间" ? "deadline" : "scheduled", title: excelText(row["标题"]).trim() || EVENT_TYPE_LABELS[eventType], startsAt, endsAt, allDay: ["是", "true", "1"].includes(excelText(row["全天"]).trim().toLocaleLowerCase()), mode: excelText(row["形式"]).trim(), location: excelText(row["地点"]).trim(), eventUrl: excelText(row["日程链接"]).trim(), status: EVENT_STATUSES.includes(statusText) ? statusText : "待进行", note: excelText(row["备注"]).trim(), createdAt: readWorkbookDate(row["创建时间"]) || now, updatedAt: readWorkbookDate(row["更新时间"]) || now, isOwner: true };
  }).filter((item): item is RecruitmentEvent => Boolean(item));
  if (events.length > 2000) throw new Error("单次最多导入 2000 条日程记录");

  const experiences = records(experiencesSheet).map((row): InterviewExperience | null => {
    const applicationId = excelText(row["岗位ID"]).trim() || applicationByName.get(applicationKey(excelText(row["公司"]), excelText(row["岗位"]))) || "";
    const interviewId = excelText(row["面试ID"]).trim();
    const title = excelText(row["标题"]).trim();
    const content = excelText(row["面试内容"]).trim();
    if (!title || !content) return null;
    return { id: safeId(row["面经ID"]), applicationId: applicationIds.has(applicationId) ? applicationId : "", interviewId: interviewIds.has(interviewId) ? interviewId : "", title, company: excelText(row["公司"]).trim(), position: excelText(row["岗位"]).trim(), round: excelText(row["轮次"]).trim(), tags: splitTags(row["标签"]), content, takeaway: excelText(row["复盘要点"]).trim(), visibility: excelText(row["共享范围"]).trim() === "共享给好友" ? "full" : "private", groupId: excelText(row["共享小组ID"]).trim() || null, isOwner: true, createdAt: readWorkbookDate(row["创建时间"]) || now, updatedAt: readWorkbookDate(row["更新时间"]) || now };
  }).filter((item): item is InterviewExperience => Boolean(item));
  if (experiences.length > 1000) throw new Error("单次最多导入 1000 篇面经");
  return { applications, interviews, experiences, events };
}
