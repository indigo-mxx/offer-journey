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
  assert.match(tracker, /createExperienceDraft/);
  assert.match(route, /interview_experiences/);
  assert.match(tracker, /openStatFilter/);
  assert.match(styles, /stat-card\.is-selected/);
  assert.match(schema, /applications/);
  assert.match(hosting, /"d1": "DB"/);
});
