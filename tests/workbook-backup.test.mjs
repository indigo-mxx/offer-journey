import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import test from "node:test";

// Round-trip regression test for the Excel backup module.
// Exercises the real createWorkspaceWorkbook + readWorkspaceWorkbook so that
// any garbled-text (乱码) or field/date/linkage loss surfaces as a failure.
const { createWorkspaceWorkbook, readWorkspaceWorkbook } = await import(
  "../lib/workbook-backup.ts"
);

// Sample data with Chinese / English mix, tags, dates, and a linked interview.
const SAMPLE = {
  applications: [
    {
      id: "app-huawei",
      company: "华为技术",
      position: "嵌入式软件工程师",
      base: "深圳",
      industryTags: ["半导体", "智驾", "软件"],
      companyScale: "超大型",
      batch: "秋招",
      status: "二面",
      appliedAt: "2025-09-01",
      channel: "官网",
      link: "https://example.com/huawei",
      salary: "30-40K·15薪",
      note: "关键岗位，优先级高",
      finalOutcome: "",
      rejectionReason: "",
      offerReceivedAt: "2025-09-25T02:00:00.000Z",
      offerDeadline: "2025-09-30T10:00:00.000Z",
      offerOnboardDate: "2025-10-20",
      offerCompensation: "35K × 15 薪 + 签字费",
      offerBenefits: "补充医疗、餐补、住房补贴",
      offerContact: "王 HR / hr@example.com",
      offerNote: "答复前确认股票归属周期",
      offerShared: true,
      offerCompensationDetails: { currency: "CNY", city: "北京", monthlyBaseSalary: 35000, salaryMonths: 15, performanceBonus: 20000, signingBonus: 50000, monthlyAllowance: 1000, otherAnnualCash: 0, equityAnnualValue: 100000, bonusTaxMode: "separate", bonusMonth: 12, signingBonusMonth: 1, socialInsuranceBase: 35000, housingFundBase: 35000, pensionRate: 8, medicalRate: 2, unemploymentRate: 0.5, housingFundRate: 12, employerHousingFundRate: 12, specialDeductionMonthly: 1500, otherDeductionMonthly: 0 },
      visibility: "full",
      groupId: null,
      createdAt: "2025-09-01T08:00:00.000Z",
      updatedAt: "2025-09-10T10:30:00.000Z",
      isOwner: true,
    },
    {
      id: "app-byte",
      company: "ByteDance 字节跳动",
      position: "Backend Engineer",
      base: "北京",
      industryTags: ["软件"],
      companyScale: "超大型",
      batch: "提前批",
      status: "已意向，待谈薪/签约",
      appliedAt: "2025-08-20",
      channel: "内推",
      link: "",
      salary: "",
      note: "",
      finalOutcome: "",
      rejectionReason: "",
      visibility: "private",
      groupId: null,
      createdAt: "2025-08-20T03:00:00.000Z",
      updatedAt: "2025-08-25T09:15:00.000Z",
      isOwner: true,
    },
  ],
  interviews: [
    {
      id: "int-tech1",
      applicationId: "app-huawei",
      scheduledAt: "2025-09-15T14:30:00.000Z",
      endedAt: "2025-09-15T16:00:00.000Z",
      round: "技术一面",
      format: "视频面试",
      result: "通过",
      interviewer: "张工 / 李工",
      summary: "问了项目、操作系统与一道手撕题",
      nextSteps: "等二面通知",
      createdAt: "2025-09-12T01:00:00.000Z",
      updatedAt: "2025-09-15T16:05:00.000Z",
    },
    {
      id: "int-hr1",
      applicationId: "app-huawei",
      scheduledAt: "2025-09-22T07:00:00.000Z",
      endedAt: "",
      round: "HR面",
      format: "电话面试",
      result: "待定",
      interviewer: "王HR",
      summary: "",
      nextSteps: "",
      createdAt: "2025-09-20T02:00:00.000Z",
      updatedAt: "2025-09-20T02:00:00.000Z",
    },
  ],
  experiences: [
    {
      id: "exp-tech1",
      applicationId: "app-huawei",
      interviewId: "int-tech1",
      title: "华为技术一面复盘",
      company: "华为技术",
      position: "嵌入式软件工程师",
      round: "技术一面",
      tags: ["操作系统", "手撕代码", "项目深挖"],
      content: "1. 中断上下文与软中断区别\n2. volatile 的语义与编译器优化\n3. 手撕：反转链表区间 [m, n]",
      takeaway: "中断部分回答偏浅，需补《深入理解Linux内核》第7章。",
      visibility: "full",
      groupId: "group-campus",
      isOwner: true,
      createdAt: "2025-09-15T16:10:00.000Z",
      updatedAt: "2025-09-16T01:00:00.000Z",
    },
    {
      id: "exp-general",
      applicationId: "",
      interviewId: "",
      title: "通用面经：自我介绍模板",
      company: "",
      position: "",
      round: "",
      tags: ["自我介绍", "通用"],
      content: "三段式：背景 + 项目亮点 + 与岗位契合点。",
      takeaway: "控制在 90 秒内。",
      createdAt: "2025-09-01T05:00:00.000Z",
      updatedAt: "2025-09-01T05:00:00.000Z",
    },
  ],
};

function sameInstant(a, b, toleranceMs = 1000) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= toleranceMs;
}

test("Excel round-trip preserves Chinese text, dates, tags and linkage with no 乱码", async () => {
  const blob = await createWorkspaceWorkbook(SAMPLE);
  assert.ok(blob instanceof Blob, "createWorkspaceWorkbook should return a Blob");
  const buffer = Buffer.from(await blob.arrayBuffer());
  // Note: .xlsx is a ZIP archive, so sheet names are deflate-compressed and do
  // not appear as raw UTF-8 bytes — the real no-乱码 check is the round-trip
  // below, which parses the workbook back and compares Chinese strings exactly.

  const dir = await mkdtemp(join(tmpdir(), "wkbk-"));
  try {
    const file = join(dir, "backup.xlsx");
    await writeFile(file, buffer);
    // Simulate a browser File upload by wrapping the buffer in a global File.
    const restored = await readWorkspaceWorkbook(new File([buffer], "backup.xlsx"));

    // --- applications ---
    assert.equal(restored.applications.length, 2, "both applications import back");
    const app = restored.applications.find((item) => item.id === "app-huawei");
    assert.ok(app, "app-huawei id preserved");
    assert.equal(app.company, "华为技术", "company Chinese intact");
    assert.equal(app.position, "嵌入式软件工程师", "position Chinese intact");
    assert.deepEqual(app.industryTags, ["半导体", "智驾", "软件"], "industry tags round-trip as array");
    assert.equal(app.status, "二面", "status Chinese preserved");
    assert.equal(app.appliedAt, "2025-09-01", "appliedAt round-trips as date-only");
    assert.equal(app.visibility, "full", "visibility maps back to enum value");
    assert.equal(app.note, "关键岗位，优先级高", "note Chinese intact");
    assert.equal(app.link, "https://example.com/huawei", "link preserved");
    assert.equal(app.salary, "30-40K·15薪", "salary with · intact");
    assert.ok(sameInstant(app.offerReceivedAt, "2025-09-25T02:00:00.000Z"), "offer received time preserved");
    assert.ok(sameInstant(app.offerDeadline, "2025-09-30T10:00:00.000Z"), "offer deadline preserved");
    assert.equal(app.offerOnboardDate, "2025-10-20", "offer onboarding date preserved");
    assert.equal(app.offerCompensation, "35K × 15 薪 + 签字费", "offer compensation preserved");
    assert.equal(app.offerBenefits, "补充医疗、餐补、住房补贴", "offer benefits preserved");
    assert.equal(app.offerContact, "王 HR / hr@example.com", "offer contact preserved");
    assert.equal(app.offerNote, "答复前确认股票归属周期", "offer note preserved");
    assert.equal(app.offerShared, true, "offer sharing preference preserved");
    assert.equal(app.offerCompensationDetails?.monthlyBaseSalary, 35000, "offer compensation calculator inputs preserved");
    assert.equal(app.offerCompensationDetails?.housingFundRate, 12, "offer housing fund settings preserved");
    assert.ok(sameInstant(app.updatedAt, "2025-09-10T10:30:00.000Z"), "updatedAt instant preserved");
    assert.equal(restored.applications.find((item) => item.id === "app-byte")?.status, "已意向，待谈薪/签约", "intent status survives backup round-trip");

    const appEn = restored.applications.find((item) => item.id === "app-byte");
    assert.ok(appEn, "app-byte id preserved");
    assert.equal(appEn.company, "ByteDance 字节跳动", "mixed CN/EN company intact");
    assert.equal(appEn.position, "Backend Engineer", "English position intact");
    assert.equal(appEn.visibility, "private", "private visibility preserved");

    // --- interviews (the time store under Option B) ---
    assert.equal(restored.interviews.length, 2, "both interviews import back");
    const tech = restored.interviews.find((item) => item.id === "int-tech1");
    assert.ok(tech, "int-tech1 id preserved");
    assert.equal(tech.applicationId, "app-huawei", "interview→application link intact");
    assert.equal(tech.round, "技术一面", "round Chinese intact");
    assert.equal(tech.result, "通过", "result Chinese intact");
    assert.equal(tech.interviewer, "张工 / 李工", "interviewer with separator intact");
    assert.ok(sameInstant(tech.scheduledAt, "2025-09-15T14:30:00.000Z"), "scheduledAt instant round-trips");
    assert.ok(sameInstant(tech.endedAt, "2025-09-15T16:00:00.000Z"), "endedAt instant round-trips");
    assert.equal(tech.summary, "问了项目、操作系统与一道手撕题", "summary Chinese intact");
    assert.equal(tech.nextSteps, "等二面通知", "nextSteps Chinese intact");

    const hr = restored.interviews.find((item) => item.id === "int-hr1");
    assert.ok(hr, "int-hr1 id preserved");
    assert.equal(hr.endedAt, "", "empty endedAt stays empty (旧数据兼容)");

    // --- experiences ---
    assert.equal(restored.experiences.length, 2, "both experiences import back");
    const exp = restored.experiences.find((item) => item.id === "exp-tech1");
    assert.ok(exp, "exp-tech1 id preserved");
    assert.equal(exp.title, "华为技术一面复盘", "title Chinese intact");
    assert.deepEqual(exp.tags, ["操作系统", "手撕代码", "项目深挖"], "tags split back to array");
    assert.equal(
      exp.content,
      "1. 中断上下文与软中断区别\n2. volatile 的语义与编译器优化\n3. 手撕：反转链表区间 [m, n]",
      "multiline Chinese content intact",
    );
    assert.equal(exp.takeaway, "中断部分回答偏浅，需补《深入理解Linux内核》第7章。", "takeaway with 《》 intact");
    assert.equal(exp.interviewId, "int-tech1", "experience→interview link preserved (Option B bridge)");
    assert.equal(exp.applicationId, "app-huawei", "experience→application link preserved");
    assert.equal(exp.visibility, "full", "experience sharing visibility is preserved");
    assert.equal(exp.groupId, "group-campus", "experience sharing group is preserved");

    const general = restored.experiences.find((item) => item.id === "exp-general");
    assert.ok(general, "exp-general id preserved");
    assert.equal(general.applicationId, "", "general experience has no application");
    assert.equal(general.interviewId, "", "general experience has no interview");
    assert.deepEqual(general.tags, ["自我介绍", "通用"], "general tags intact");
    assert.equal(general.visibility, "private", "legacy experience defaults to private");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readWorkspaceWorkbook drops interviews/experiences missing the required fields", async () => {
  // An interview without scheduledAt, and an experience without content, must be filtered out.
  const data = {
    applications: SAMPLE.applications,
    interviews: [{ ...SAMPLE.interviews[0], id: "int-nodate", scheduledAt: "" }],
    experiences: [{ ...SAMPLE.experiences[1], id: "exp-nocontent", content: "" }],
  };
  const blob = await createWorkspaceWorkbook(data);
  const buffer = Buffer.from(await blob.arrayBuffer());
  const restored = await readWorkspaceWorkbook(new File([buffer], "backup.xlsx"));
  assert.equal(restored.interviews.length, 0, "interview without scheduledAt is dropped");
  assert.equal(restored.experiences.length, 0, "experience without content is dropped");
});

test("export groups experiences and combines schedules without duplicating restored interviews", async () => {
  const second = { ...SAMPLE.interviews[0], id: "int-tech1-repeat", scheduledAt: "2025-09-16T06:00:00.000Z", endedAt: "", result: "未通过" };
  const event = { id: "event-test", applicationId: "app-byte", eventType: "written_test", timingType: "deadline", title: "笔试", startsAt: "2025-09-18T10:00:00.000Z", endsAt: "", allDay: false, mode: "线上", location: "", eventUrl: "https://example.com/test", status: "待进行", note: "", createdAt: "2025-09-01T00:00:00.000Z", updatedAt: "2025-09-01T00:00:00.000Z" };
  const assessment = { ...event, id: "event-assessment", applicationId: "app-huawei", eventType: "assessment", title: "测评", startsAt: "2025-09-14T10:00:00.000Z" };
  const experience = { ...SAMPLE.experiences[0], id: "exp-repeat", interviewId: second.id, title: "复试记录" };
  const data = { ...SAMPLE, interviews: [second, ...SAMPLE.interviews], events: [event, assessment], experiences: [experience, SAMPLE.experiences[1], SAMPLE.experiences[0]] };
  const exceljs = await import("exceljs");
  const Workbook = exceljs.Workbook ?? exceljs.default.Workbook;
  function records(sheet) {
    const headers = [];
    sheet.getRow(4).eachCell((cell, index) => { headers[index] = cell.text; });
    return Array.from({ length: sheet.rowCount - 4 }, (_, index) => Object.fromEntries(headers.flatMap((header, column) => header ? [[header, sheet.getRow(index + 5).getCell(column).value]] : [])));
  }
  for (const scheduleSort of ["position", "time"]) {
    const blob = await createWorkspaceWorkbook(data, { scheduleSort });
    const buffer = await blob.arrayBuffer();
    const workbook = new Workbook();
    await workbook.xlsx.load(buffer);
    const schedules = records(workbook.getWorksheet("日程安排"));
    assert.equal(schedules.find((row) => row["日程ID"] === event.id)["开始时间"].getUTCHours(), 18, "Excel displays Beijing wall time");
    assert.equal(schedules.length, 5, "all interviews, written tests and assessments appear once");
    assert.equal(schedules.filter((row) => row["类型"] === "面试").length, 3);
    assert.ok(schedules.some((row) => row["类型"] === "测评"));
    assert.ok(schedules.some((row) => row["类型"] === "笔试"));
    if (scheduleSort === "time") {
      const times = schedules.map((row) => row["开始时间"].getTime());
      assert.deepEqual(times, [...times].sort((a, b) => a - b));
    } else {
      const ids = schedules.map((row) => row["岗位ID"]);
      const huaweiIndexes = ids.flatMap((id, index) => id === "app-huawei" ? [index] : []);
      assert.equal(huaweiIndexes.at(-1) - huaweiIndexes[0] + 1, huaweiIndexes.length, "all schedules for one position stay adjacent");
    }
    const apps = records(workbook.getWorksheet("岗位记录"));
    const summary = apps.find((row) => row["岗位ID"] === "app-huawei")["一面时间与结果"];
    assert.equal(apps.find((row) => row["岗位ID"] === "app-huawei")["二面时间与结果"], "", "missing rounds stay blank");
    assert.match(summary, /2025\/09\/15 22:30 · 通过/);
    assert.match(summary, /2025\/09\/16 14:00 · 未通过/);
    const experiences = records(workbook.getWorksheet("面经库"));
    assert.deepEqual(experiences.filter((row) => row["岗位ID"] === "app-huawei").map((row) => row["通过与否"]), ["通过", "未通过"]);
    assert.equal(experiences.find((row) => row["面经ID"] === "exp-general")["通过与否"], "未关联结果");
    assert.equal(workbook.getWorksheet("面经库").views[0].xSplit, 2);
    assert.ok(workbook.getWorksheet("面经库").getRow(5).height >= 44);
    const restored = await readWorkspaceWorkbook(new File([buffer], "backup.xlsx"));
    assert.equal(restored.interviews.length, 3);
    assert.equal(restored.events.length, 2, "interview summary rows do not become duplicated events");
    assert.equal(restored.events.find((item) => item.id === event.id).eventUrl, event.eventUrl);
    assert.equal(restored.events.find((item) => item.id === event.id).startsAt, event.startsAt, "Beijing display dates restore the original instant");
    if (scheduleSort === "time") {
      // Legacy files use unshifted UTC Excel serials and have no v6 timezone marker.
      workbook.getWorksheet("使用说明").getCell("B6").value = "";
      const legacySheet = workbook.getWorksheet("面试安排");
      let startColumn, idColumn;
      legacySheet.getRow(4).eachCell((cell, index) => {
        if (cell.text === "开始时间") startColumn = index;
        if (cell.text === "面试ID") idColumn = index;
      });
      legacySheet.eachRow((row, number) => {
        if (number >= 5 && row.getCell(idColumn).value === second.id) row.getCell(startColumn).value = new Date(second.scheduledAt);
      });
      const legacy = await readWorkspaceWorkbook(new File([await workbook.xlsx.writeBuffer()], "old-backup.xlsx"));
      assert.equal(legacy.interviews.find((item) => item.id === second.id).scheduledAt, second.scheduledAt, "legacy timestamps remain compatible");
    }
  }
  assert.equal(data.interviews[0].id, second.id, "sorting does not mutate source data");
});

test("Excel includes the dashboard snapshot and preserves the selected statistics cohort", async () => {
  const exceljs = await import("exceljs");
  const Workbook = exceljs.Workbook ?? exceljs.default.Workbook;
  for (const statisticsApplicationIds of [undefined, ['app-byte']]) {
    const blob = await createWorkspaceWorkbook(SAMPLE, { statisticsApplicationIds, statisticsRangeLabel: statisticsApplicationIds ? '近 30 天投递的岗位' : '全部投递' });
    const buffer = await blob.arrayBuffer();
    const workbook = new Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('数据统计');
    assert.ok(sheet);
    const rows = [];
    sheet.eachRow((row, number) => { if (number >= 5) rows.push({ section: row.getCell(1).value, metric: row.getCell(2).value, count: row.getCell(3).value, ratio: row.getCell(6).value }); });
    const metric = (label) => rows.find((row) => row.metric === label);
    assert.equal(metric('岗位投递').count, statisticsApplicationIds ? 1 : 2);
    assert.equal(metric('Offer（含意向）').count, statisticsApplicationIds ? 1 : 2);
    assert.equal(metric('Offer（含意向）').ratio, 1, 'rates are numeric percentages');
    assert.equal(metric('面试通过率').ratio, statisticsApplicationIds ? '' : 1, 'unknown pass rate stays blank');
    assert.equal(metric('面试挂率').ratio, statisticsApplicationIds ? '' : 0);
    assert.equal(metric('总体挂率').count, 0);
    assert.equal(rows.filter((row) => row.section === '各阶段挂掉岗位').length, 10);
    assert.equal(rows.filter((row) => row.section === '各轮面试挂率').length, 7);
    assert.equal(rows.filter((row) => row.section === '各轮面试').length, 7);
    assert.equal(rows.filter((row) => row.section === '近六个月投递趋势').length, 6);
    assert.equal(sheet.getColumn(6).numFmt, '0%');
    assert.equal(sheet.views[0].ySplit, 4);
    const restored = await readWorkspaceWorkbook(new File([buffer], 'backup-with-dashboard.xlsx'));
    assert.equal(restored.applications.length, 2, 'statistics cohort does not filter the full backup');
    assert.equal(restored.interviews.length, 2, 'summary statistics are never imported as records');
  }
});

test('exported progression excludes resume rejection and screening while preserving failure counts', async () => {
  const data = { applications: [
    { ...SAMPLE.applications[0], status: '流程结束', finalOutcome: '简历挂', offerReceivedAt: '' },
    { ...SAMPLE.applications[1], status: '简历筛选' },
  ], interviews: [], experiences: [], events: [] };
  const blob = await createWorkspaceWorkbook(data);
  const exceljs = await import('exceljs');
  const Workbook = exceljs.Workbook ?? exceljs.default.Workbook;
  const workbook = new Workbook();
  await workbook.xlsx.load(await blob.arrayBuffer());
  const rows = [];
  workbook.getWorksheet('数据统计').eachRow((row, number) => { if (number >= 5) rows.push({ section: row.getCell(1).value, metric: row.getCell(2).value, count: row.getCell(3).value, failed: row.getCell(5).value, ratio: row.getCell(6).value }); });
  assert.equal(rows.find((row) => row.metric === '流程推进率').ratio, 0);
  assert.equal(rows.find((row) => row.metric === '总体挂率').ratio, 0.5);
  const resume = rows.find((row) => row.section === '各阶段挂掉岗位' && row.metric === '简历');
  assert.equal(resume.failed, 1);
  assert.equal(resume.ratio, 0.5);
});
