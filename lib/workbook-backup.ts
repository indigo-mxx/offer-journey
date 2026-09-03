import type { Application, ApplicationStatus, Interview, InterviewExperience, Visibility } from "@/db/schema";
import type { Cell, Row, Worksheet } from "exceljs";

export type WorkspaceBackup = {
  applications: Application[];
  interviews: Interview[];
  experiences: InterviewExperience[];
};

const APPLICATION_STATUSES: ApplicationStatus[] = ["准备投递", "简历投递", "已投递", "简历筛选", "笔试", "一面", "二面", "三面", "终面", "HR面", "Offer", "已拒绝", "流程结束"];
const VISIBILITY_LABELS: Record<Visibility, string> = { private: "仅自己", progress: "仅共享进度", full: "完整共享" };
const VISIBILITY_VALUES: Record<string, Visibility> = { "仅自己": "private", "仅共享进度": "progress", "共享进度": "progress", "完整共享": "full", private: "private", progress: "progress", full: "full" };

function validDate(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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

export async function createWorkspaceWorkbook(data: WorkspaceBackup) {
  const workbook = await loadExcelWorkbook();
  const exportedAt = new Date();
  workbook.creator = "秋招同行录";
  workbook.lastModifiedBy = "秋招同行录";
  workbook.created = exportedAt;
  workbook.modified = exportedAt;
  workbook.title = "秋招同行录完整备份";
  workbook.subject = "岗位、面试与面经完整恢复备份";
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
    line: "FFD8E4DC",
    white: "FFFFFFFF",
    muted: "FF6E8177",
  };
  const bodyFont = { name: "Microsoft YaHei", size: 10, color: { argb: palette.ink } };

  function addDataSheet(name: string, title: string, subtitle: string, columns: Array<{ header: string; key: string; width: number; hidden?: boolean }>, rows: Record<string, unknown>[], accent: string) {
    const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 4, showGridLines: false }] });
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
    return sheet;
  }

  const appById = new Map(data.applications.map((item) => [item.id, item]));
  const interviewById = new Map(data.interviews.map((item) => [item.id, item]));

  const applicationsSheet = addDataSheet("岗位记录", "岗位记录", "可直接修改中文业务字段；浅灰色隐藏列用于恢复关联，请不要删除。", [
    { header: "公司", key: "company", width: 18 }, { header: "岗位", key: "position", width: 24 }, { header: "Base", key: "base", width: 12 },
    { header: "行业标签", key: "industryTags", width: 24 }, { header: "公司规模", key: "companyScale", width: 14 }, { header: "批次", key: "batch", width: 12 },
    { header: "当前进度", key: "status", width: 14 }, { header: "投递日期", key: "appliedAt", width: 13 }, { header: "投递渠道", key: "channel", width: 16 },
    { header: "岗位链接", key: "link", width: 34 }, { header: "薪资", key: "salary", width: 16 }, { header: "备注", key: "note", width: 34 },
    { header: "最终结果", key: "finalOutcome", width: 14 }, { header: "拒绝原因", key: "rejectionReason", width: 20 }, { header: "公开范围", key: "visibility", width: 14 },
    { header: "岗位ID", key: "id", width: 18, hidden: true }, { header: "共享小组ID", key: "groupId", width: 18, hidden: true },
    { header: "创建时间", key: "createdAt", width: 20, hidden: true }, { header: "更新时间", key: "updatedAt", width: 20, hidden: true },
  ], data.applications.map((item) => ({
    company: item.company, position: item.position, base: item.base, industryTags: item.industryTags.join("、"), companyScale: item.companyScale,
    batch: item.batch, status: item.status, appliedAt: validDate(item.appliedAt), channel: item.channel, link: item.link, salary: item.salary, note: item.note,
    finalOutcome: item.finalOutcome ?? "", rejectionReason: item.rejectionReason ?? "", visibility: VISIBILITY_LABELS[item.visibility], id: item.id,
    groupId: item.groupId ?? "", createdAt: validDate(item.createdAt ?? ""), updatedAt: validDate(item.updatedAt),
  })), palette.brand);
  applicationsSheet.getColumn("appliedAt").numFmt = "yyyy-mm-dd";
  applicationsSheet.getColumn("createdAt").numFmt = "yyyy-mm-dd hh:mm";
  applicationsSheet.getColumn("updatedAt").numFmt = "yyyy-mm-dd hh:mm";
  applicationsSheet.getColumn("link").eachCell((cell: Cell, rowNumber: number) => {
    if (rowNumber <= 4 || !cell.text) return;
    cell.value = { text: cell.text, hyperlink: cell.text, tooltip: "打开岗位链接" };
    cell.font = { ...bodyFont, color: { argb: palette.blue }, underline: true };
  });

  const interviewsSheet = addDataSheet("面试安排", "面试安排", "每一行是一场面试。开始与结束时间使用 Excel 日期格式，可正常排序筛选。", [
    { header: "公司", key: "company", width: 18 }, { header: "岗位", key: "position", width: 24 }, { header: "轮次", key: "round", width: 14 },
    { header: "开始时间", key: "scheduledAt", width: 19 }, { header: "结束时间", key: "endedAt", width: 19 }, { header: "形式", key: "format", width: 14 },
    { header: "结果", key: "result", width: 12 }, { header: "面试官", key: "interviewer", width: 16 }, { header: "总结", key: "summary", width: 36 },
    { header: "后续安排", key: "nextSteps", width: 30 }, { header: "岗位ID", key: "applicationId", width: 18, hidden: true },
    { header: "面试ID", key: "id", width: 18, hidden: true }, { header: "创建时间", key: "createdAt", width: 20, hidden: true }, { header: "更新时间", key: "updatedAt", width: 20, hidden: true },
  ], data.interviews.map((item) => {
    const application = appById.get(item.applicationId);
    return { company: application?.company ?? "", position: application?.position ?? "", round: item.round, scheduledAt: validDate(item.scheduledAt), endedAt: validDate(item.endedAt), format: item.format, result: item.result, interviewer: item.interviewer, summary: item.summary, nextSteps: item.nextSteps, applicationId: item.applicationId, id: item.id, createdAt: validDate(item.createdAt ?? ""), updatedAt: validDate(item.updatedAt) };
  }), palette.blue);
  interviewsSheet.getColumn("scheduledAt").numFmt = "yyyy-mm-dd hh:mm";
  interviewsSheet.getColumn("endedAt").numFmt = "yyyy-mm-dd hh:mm";
  interviewsSheet.getColumn("createdAt").numFmt = "yyyy-mm-dd hh:mm";
  interviewsSheet.getColumn("updatedAt").numFmt = "yyyy-mm-dd hh:mm";

  const experiencesSheet = addDataSheet("面经库", "面经库", "完整保存题目、回答思路与复盘要点，并通过隐藏 ID 保留岗位和面试关联。", [
    { header: "标题", key: "title", width: 28 }, { header: "公司", key: "company", width: 18 }, { header: "岗位", key: "position", width: 24 },
    { header: "轮次", key: "round", width: 14 }, { header: "标签", key: "tags", width: 22 }, { header: "面试内容", key: "content", width: 52 },
    { header: "复盘要点", key: "takeaway", width: 40 }, { header: "共享范围", key: "visibility", width: 14 }, { header: "面试时间", key: "interviewAt", width: 19 },
    { header: "岗位ID", key: "applicationId", width: 18, hidden: true }, { header: "面试ID", key: "interviewId", width: 18, hidden: true },
    { header: "面经ID", key: "id", width: 18, hidden: true }, { header: "共享小组ID", key: "groupId", width: 18, hidden: true }, { header: "创建时间", key: "createdAt", width: 20, hidden: true }, { header: "更新时间", key: "updatedAt", width: 20, hidden: true },
  ], data.experiences.map((item) => ({
    title: item.title, company: item.company, position: item.position, round: item.round, tags: item.tags.join("、"), content: item.content, takeaway: item.takeaway,
    interviewAt: validDate(interviewById.get(item.interviewId ?? "")?.scheduledAt ?? ""), applicationId: item.applicationId ?? "", interviewId: item.interviewId ?? "", id: item.id,
    visibility: item.visibility === "full" ? "共享给好友" : "仅自己", groupId: item.groupId ?? "", createdAt: validDate(item.createdAt ?? ""), updatedAt: validDate(item.updatedAt),
  })), palette.amber);
  experiencesSheet.getColumn("interviewAt").numFmt = "yyyy-mm-dd hh:mm";
  experiencesSheet.getColumn("createdAt").numFmt = "yyyy-mm-dd hh:mm";
  experiencesSheet.getColumn("updatedAt").numFmt = "yyyy-mm-dd hh:mm";
  experiencesSheet.eachRow((row: Row, rowNumber: number) => { if (rowNumber >= 5) row.height = 44; });

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
  guide.getCell("B5").value = `导出时间：${exportedAt.toLocaleString("zh-CN")}　｜　备份版本：3`;
  guide.getCell("B5").font = { name: "Microsoft YaHei", size: 10, color: { argb: palette.muted } };
  const cards = [["岗位记录", data.applications.length, palette.brandSoft, palette.brand], ["面试安排", data.interviews.length, palette.blueSoft, palette.blue], ["面经沉淀", data.experiences.length, palette.amberSoft, palette.amber]] as const;
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
  workbook.views = [{ x: 0, y: 0, width: 12000, height: 20000, firstSheet: 0, activeTab: workbook.worksheets.indexOf(guide), visibility: "visible" }];

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export async function readWorkspaceWorkbook(file: File): Promise<WorkspaceBackup> {
  const workbook = await loadExcelWorkbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const applicationsSheet = workbook.getWorksheet("岗位记录");
  const interviewsSheet = workbook.getWorksheet("面试安排");
  const experiencesSheet = workbook.getWorksheet("面经库");
  if (!applicationsSheet) throw new Error("Excel 中缺少“岗位记录”工作表");

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
      status: APPLICATION_STATUSES.includes(statusText) ? statusText : "准备投递", appliedAt: dateFromExcel(row["投递日期"], true), channel: excelText(row["投递渠道"]).trim(),
      link: excelText(row["岗位链接"]).trim(), salary: excelText(row["薪资"]).trim(), note: excelText(row["备注"]).trim(), finalOutcome: excelText(row["最终结果"]).trim(),
      rejectionReason: excelText(row["拒绝原因"]).trim(), visibility: VISIBILITY_VALUES[excelText(row["公开范围"]).trim()] ?? "private", groupId: excelText(row["共享小组ID"]).trim() || null,
      createdAt: dateFromExcel(row["创建时间"]) || now, updatedAt: dateFromExcel(row["更新时间"]) || now, isOwner: true,
    };
  }).filter((item) => item.company && item.position);
  if (applications.length > 500) throw new Error("单次最多导入 500 个岗位");
  const applicationIds = new Set(applications.map((item) => item.id));
  const applicationByName = new Map(applications.map((item) => [applicationKey(item.company, item.position), item.id]));

  const interviews = records(interviewsSheet).map((row): Interview | null => {
    const applicationId = excelText(row["岗位ID"]).trim() || applicationByName.get(applicationKey(excelText(row["公司"]), excelText(row["岗位"]))) || "";
    const scheduledAt = dateFromExcel(row["开始时间"]);
    if (!applicationIds.has(applicationId) || !scheduledAt) return null;
    return { id: safeId(row["面试ID"]), applicationId, scheduledAt, endedAt: dateFromExcel(row["结束时间"]), round: excelText(row["轮次"]).trim() || "一面", format: excelText(row["形式"]).trim() || "视频面试", result: excelText(row["结果"]).trim() || "待定", interviewer: excelText(row["面试官"]).trim(), summary: excelText(row["总结"]).trim(), nextSteps: excelText(row["后续安排"]).trim(), createdAt: dateFromExcel(row["创建时间"]) || now, updatedAt: dateFromExcel(row["更新时间"]) || now };
  }).filter((item): item is Interview => Boolean(item));
  if (interviews.length > 1000) throw new Error("单次最多导入 1000 条面试记录");
  const interviewIds = new Set(interviews.map((item) => item.id));

  const experiences = records(experiencesSheet).map((row): InterviewExperience | null => {
    const applicationId = excelText(row["岗位ID"]).trim() || applicationByName.get(applicationKey(excelText(row["公司"]), excelText(row["岗位"]))) || "";
    const interviewId = excelText(row["面试ID"]).trim();
    const title = excelText(row["标题"]).trim();
    const content = excelText(row["面试内容"]).trim();
    if (!title || !content) return null;
    return { id: safeId(row["面经ID"]), applicationId: applicationIds.has(applicationId) ? applicationId : "", interviewId: interviewIds.has(interviewId) ? interviewId : "", title, company: excelText(row["公司"]).trim(), position: excelText(row["岗位"]).trim(), round: excelText(row["轮次"]).trim(), tags: splitTags(row["标签"]), content, takeaway: excelText(row["复盘要点"]).trim(), visibility: excelText(row["共享范围"]).trim() === "共享给好友" ? "full" : "private", groupId: excelText(row["共享小组ID"]).trim() || null, isOwner: true, createdAt: dateFromExcel(row["创建时间"]) || now, updatedAt: dateFromExcel(row["更新时间"]) || now };
  }).filter((item): item is InterviewExperience => Boolean(item));
  if (experiences.length > 1000) throw new Error("单次最多导入 1000 篇面经");
  return { applications, interviews, experiences };
}
