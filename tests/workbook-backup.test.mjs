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
      status: "简历筛选",
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
    assert.ok(sameInstant(app.updatedAt, "2025-09-10T10:30:00.000Z"), "updatedAt instant preserved");

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
