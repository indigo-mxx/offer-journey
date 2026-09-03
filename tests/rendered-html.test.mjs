import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("includes the cloud workspace, access control, and sharing surfaces", async () => {
  const [page, tracker, route, schema, hosting, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/recruitment-tracker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /SupabaseShell/);
  assert.match(tracker, /SharingPanel/);
  assert.match(tracker, /visibility/);
  assert.match(tracker, /PositionLinkAction/);
  assert.match(tracker, /仅完整共享可见/);
  assert.match(tracker, /复制岗位链接/);
  assert.match(tracker, /岗位链接已复制/);
  assert.match(tracker, /noopener noreferrer/);
  assert.match(tracker, /processing-overlay/);
  assert.match(tracker, /showProcessingHint/);
  assert.match(tracker, /processing-card/);
  assert.match(tracker, /toggleSort/);
  assert.match(tracker, /company-card-grid/);
  assert.match(tracker, /company-overview-card/);
  assert.match(tracker, /company-merge-table/);
  assert.match(tracker, /view-mode-panel/);
  assert.match(tracker, /qiuzhao-list-mode/);
  assert.match(tracker, /pinyinSearchForms/);
  assert.match(tracker, /matchesTextSearch\(item\.company, q\)/);
  assert.match(tracker, /支持拼音 \/ 首字母/);
  assert.match(tracker, /select-field \$\{className\}\$\{open \? " is-open" : ""\}/);
  assert.match(tracker, /select-popover portal-popover/);
  assert.match(tracker, /createPortal\(/);
  assert.match(styles, /company-detail-table tbody tr:has\(\.select-field\.is-open\)/);
  assert.match(styles, /\.select-popover\.portal-popover/);
  assert.match(route, /getUserFromAccessToken/);
  assert.match(route, /owner_id/);
  assert.match(route, /group_members/);
  assert.match(route, /saveApplication/);
  assert.match(route, /deleteApplication/);
  assert.match(tracker, /experience-library/);
  assert.match(tracker, /openExperienceFromInterview/);
  assert.match(tracker, /saveExperience/);
  assert.match(tracker, /experience-interview-meta/);
  assert.match(route, /interview_experiences/);
  assert.match(tracker, /openStatFilter/);
  assert.match(tracker, /interview-stage-workspace/);
  assert.match(tracker, /renderExperienceLink/);
  assert.match(tracker, /formatInterviewDate/);
  assert.match(tracker, /关联面试场次/);
  assert.match(tracker, /<span>形式<\/span>/);
  assert.match(tracker, /<span>结果<\/span>/);
  assert.doesNotMatch(tracker, /value=\{experienceForm\.interviewer\}/);
  assert.doesNotMatch(tracker, /value=\{experienceForm\.tags\}/);
  assert.doesNotMatch(tracker, /(?:<span>|placeholder="|ariaLabel=")\\u[0-9a-f]{4}/i);
  assert.match(route, /interview_id/);
  assert.match(schema, /interviewId/);
  assert.match(styles, /interview-stage-board/);
  assert.match(styles, /interview-date-chip/);
  assert.match(styles, /stat-card\.is-selected/);
  assert.match(schema, /applications/);
  assert.match(hosting, /"d1": "DB"/);
});
