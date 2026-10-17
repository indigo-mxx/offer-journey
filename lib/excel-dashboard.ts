import type { Workbook, CellValue } from "exceljs";

type MetricRow = Record<string, unknown>;
const COLORS = { paper: "FFF7F4EC", white: "FFFFFEFA", green: "FF245D49", muted: "FF768277", line: "FFE0E4DA", pale: "FFEAF2EC", blue: "FF527591", bluePale: "FFEDF3F7", gold: "FF9A762E", goldPale: "FFFAF1DD", red: "FFAC5D49", redPale: "FFFAEEE7", ink: "FF263C32" };

/** Statistics are an export-time snapshot; recovery recalculates from business records. */
export function addExcelDashboard(workbook: Workbook, rows: MetricRow[], scope: string) {
  const sheet = workbook.addWorksheet("数据统计", {
    views: [{ showGridLines: false, zoomScale: 85, state: "frozen", ySplit: 3 }],
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: "A1:Y90", margins: { left: .25, right: .25, top: .35, bottom: .35, header: .15, footer: .15 } },
  });
  sheet.columns = Array.from({ length: 25 }, () => ({ width: 5.5 }));
  for (let row = 1; row <= 90; row++) {
    sheet.getRow(row).height = 21;
    for (let col = 1; col <= 25; col++) {
      const cell = sheet.getCell(row, col);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.paper } };
      cell.font = { name: "Microsoft YaHei", size: 10, color: { argb: COLORS.ink } };
      cell.alignment = { vertical: "middle", wrapText: true };
    }
  }
  const text = (row: number, first: number, last: number, value: CellValue, size = 10, color = COLORS.ink, bold = false) => {
    if (last > first) sheet.mergeCells(row, first, row, last);
    const cell = sheet.getCell(row, first);
    cell.value = value;
    cell.font = { name: "Microsoft YaHei", size, color: { argb: color }, bold };
    cell.alignment = { vertical: "middle", wrapText: true };
    return cell;
  };
  const source = (section: string, metric: string, key = "count"): CellValue => {
    const index = rows.findIndex((row) => row.section === section && row.metric === metric);
    if (index < 0) return "—";
    const result = rows[index][key];
    if (result == null || result === "") return "—";
    return result as number | string;
  };
  const panel = (top: number, bottom: number, first: number, last: number, title: string, accent = COLORS.green, tint = COLORS.pale) => {
    for (let row = top; row <= bottom; row++) for (let col = first; col <= last; col++) {
      sheet.getCell(row, col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: row === top ? tint : COLORS.white } };
    }
    text(top, first, last, title, 13, accent, true);
    sheet.getRow(top).height = 29;
  };
  const ratio = (row: number, first: number, last: number, value: CellValue, color = COLORS.green) => {
    const cell = text(row, first, last, value, 11, color, true);
    cell.numFmt = "0%";
    cell.alignment = { horizontal: "right", vertical: "middle" };
  };
  text(1, 2, 24, "秋招同行录  /  投递数据看板", 23, COLORS.green, true);
  sheet.getRow(1).height = 38;
  text(2, 2, 24, "累计记录与结果概览", 10, COLORS.muted);
  text(3, 2, 24, `统计范围：${scope}。导出时的快照，包含已结束流程；统计口径与页面一致。`, 10, COLORS.muted);
  const cards = [
    ["岗位投递", "count", "累计投递", COLORS.green, COLORS.pale],
    ["活跃流程", "count", "当前仍在持续推进", COLORS.blue, COLORS.bluePale],
    ["累计进入面试", "count", "含已结束流程，按岗位去重", COLORS.green, COLORS.pale],
    ["Offer（含意向）", "count", "正式 Offer + 待谈薪意向", COLORS.gold, COLORS.goldPale],
    ["流程推进率", "ratio", "排除简历挂与简历阶段", COLORS.green, COLORS.pale],
    ["面试通过率", "ratio", "通过 / 明确结果的场次", COLORS.blue, COLORS.bluePale],
  ];
  cards.forEach(([label, key, hint, color, tint], index) => {
    const first = 2 + index * 4;
    panel(5, 10, first, first + 2, label, color, tint);
    sheet.getCell(5, first).font = { name: "Microsoft YaHei", size: 11, color: { argb: color }, bold: true };
    const value = text(7, first, first + 2, source("总览", label, key), 25, color, true);
    if (key === "ratio") value.numFmt = "0%";
    sheet.getRow(7).height = 37;
    text(9, first, first + 2, hint, 8, COLORS.muted);
    sheet.getRow(9).height = 32;
  });

  panel(12, 22, 2, 15, "累计经历与录用进展");
  ["岗位投递", "累计进入测评 / 笔试", "累计进入面试", "Offer（含意向）"].forEach((label, index) => {
    const row = 14 + index * 2;
    text(row, 2, 8, label, 11, COLORS.ink, true);
    text(row, 9, 10, source("总览", label), 14, COLORS.green, true);
    const metric = rows.find((item) => item.section === "总览" && item.metric === label);
    const total = Number(rows.find((item) => item.section === "总览" && item.metric === "岗位投递")?.count ?? 0);
    const fraction = total ? Number(metric?.count ?? 0) / total : 0;
    ratio(row, 11, 15, label === "岗位投递" ? (total ? 1 : 0) : source("总览", label, "ratio"));
    for (let col = 2; col <= 15; col++) sheet.getCell(row + 1, col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: col - 2 < Math.round(fraction * 14) ? COLORS.green : COLORS.pale } };
    sheet.getRow(row + 1).height = 5;
  });
  panel(12, 22, 17, 24, "当前流程分布", COLORS.blue, COLORS.bluePale);
  rows.filter((item) => item.section === "当前流程分布").forEach((item, index) => {
    const row = 14 + Math.floor(index / 2) * 2;
    const first = index % 2 ? 21 : 17;
    text(row, first, first + 2, String(item.metric), 9);
    const count = text(row, first + 3, first + 3, source("当前流程分布", String(item.metric)), 12, COLORS.blue, true);
    count.alignment = { horizontal: "center", vertical: "middle" };
  });

  panel(24, 38, 2, 14, "各轮面试通过率 / 挂率", COLORS.blue, COLORS.bluePale);
  text(25, 2, 14, "通过率与挂率仅使用通过 / 未通过的场次。", 9, COLORS.muted);
  const cols = [[2, 4], [5, 6], [7, 8], [9, 10], [11, 12], [13, 14]];
  ["轮次", "场次", "通过", "未通过", "通过率", "挂率"].forEach((label, i) => text(27, cols[i][0], cols[i][1], label, 9, COLORS.blue, true));
  rows.filter((item) => item.section === "各轮面试").forEach((item, index) => {
    const row = 28 + index;
    const name = String(item.metric);
    text(row, 2, 4, name);
    for (const [key, col] of [["count", 5], ["passed", 7], ["failed", 9]] as const) text(row, col, col + 1, source("各轮面试", name, key), 10, key === "failed" ? COLORS.red : COLORS.ink);
    ratio(row, 11, 12, source("各轮面试", name, "ratio"));
    ratio(row, 13, 14, source("各轮面试挂率", name, "ratio"), COLORS.red);
  });
  text(36, 2, 7, "总体面试挂率", 10, COLORS.red, true);
  ratio(36, 8, 10, source("总览", "面试挂率", "ratio"), COLORS.red);
  text(38, 2, 14, "待定和未参加不计入通过率、面试挂率。", 9, COLORS.muted);
  panel(24, 38, 16, 24, "OC / 意向与 Offer", COLORS.gold, COLORS.goldPale);
  ["已获 OC / 意向（含正式 Offer）", "待谈薪 / 签约意向", "正式 Offer", "尚无 OC / 意向记录", "泡池子（当前待横向筛选）"].forEach((label, index) => {
    const row = 27 + index * 2;
    text(row, 16, 22, label, 10);
    text(row, 23, 24, source("OC / 意向", label), 16, COLORS.gold, true);
  });
  text(37, 16, 24, "泡池子尚未获意向；历史正式 Offer 仍计入 OC。", 9, COLORS.muted);

  panel(40, 55, 2, 24, "各阶段挂掉的岗位", COLORS.red, COLORS.redPale);
  text(41, 2, 9, "总体挂率：明确未通过岗位 / 总投递", 10, COLORS.muted);
  ratio(41, 10, 12, source("总览", "总体挂率", "ratio"), COLORS.red);
  text(41, 15, 22, "累计挂掉岗位（去重）", 10, COLORS.muted);
  text(41, 23, 24, source("总览", "总体挂率"), 13, COLORS.red, true);
  [["阶段", 2, 6], ["进入岗位数", 7, 11], ["挂掉岗位数", 12, 16], ["阶段挂率", 17, 24]].forEach(([label, first, last]) => text(43, Number(first), Number(last), String(label), 10, COLORS.red, true));
  rows.filter((item) => item.section === "各阶段挂掉岗位").forEach((item, index) => {
    const row = 44 + index;
    const name = String(item.metric);
    text(row, 2, 6, name);
    text(row, 7, 11, source("各阶段挂掉岗位", name));
    text(row, 12, 16, source("各阶段挂掉岗位", name, "failed"), 11, COLORS.red, true);
    ratio(row, 17, 24, source("各阶段挂掉岗位", name, "ratio"), COLORS.red);
  });
  text(55, 2, 24, "阶段挂率 = 挂掉 / 进入岗位；横向筛选含泡池子、横向挂、意向与 Offer。主动拒绝不算挂。", 9, COLORS.muted);

  const rankPanel = (top: number, first: number, last: number, section: string, accent = COLORS.green, tint = COLORS.pale) => {
    panel(top, top + 10, first, last, section, accent, tint);
    const values = rows.filter((item) => item.section === section);
    if (!values.length) text(top + 3, first, last, "暂无记录", 10, COLORS.muted);
    values.forEach((item, index) => {
      const row = top + 2 + index;
      text(row, first, last - 2, String(item.metric), 9);
      text(row, last - 1, last, source(section, String(item.metric)), 11, accent, true);
      sheet.getRow(row).height = Math.max(sheet.getRow(row).height ?? 21, 33, Math.ceil(String(item.metric).length * 2 / ((last - first - 1) * 5.5)) * 13);
    });
    if (values.length) {
      const rule = { type: "dataBar" as const, priority: 1, cfvo: [{ type: "num" as const, value: 0 }, { type: "num" as const, value: Math.max(1, ...values.map((item) => Number(item.count))) }], color: { argb: accent } };
      sheet.addConditionalFormatting({
        ref: `${sheet.getCell(top + 2, last - 1).address}:${sheet.getCell(top + 1 + values.length, last).address}`,
        rules: [rule],
      });
    }
  };
  rankPanel(58, 2, 8, "近六个月投递趋势");
  rankPanel(58, 10, 16, "投递渠道", COLORS.blue, COLORS.bluePale);
  rankPanel(58, 18, 24, "目标地点", COLORS.gold, COLORS.goldPale);
  rankPanel(72, 2, 6, "投递批次");
  rankPanel(72, 8, 12, "行业方向", COLORS.blue, COLORS.bluePale);
  rankPanel(72, 14, 18, "单位性质", COLORS.gold, COLORS.goldPale);
  rankPanel(72, 20, 24, "流程结论", COLORS.red, COLORS.redPale);
  text(87, 2, 24, "统计口径", 12, COLORS.green, true);
  text(88, 2, 24, "流程推进率排除简历挂及仍在简历投递 / 筛选阶段的岗位。历史记录缺失时，不推算未知阶段与结果。", 9, COLORS.muted);
  text(89, 2, 24, "绿色为累计进展，蓝色为面试与当前分布，金色为录用意向，暖红为未通过。暂无明确结果时显示“—”。", 9, COLORS.muted);
  text(90, 2, 24, "岗位与日程用于恢复安排，面经库完整保存面试过程及结果；导入后统计由业务记录重新计算。", 9, COLORS.muted);
  return sheet;
}
