import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("includes the cloud workspace, access control, and sharing surfaces", async () => {
  const [page, tracker, calendar, route, schema, hosting, styles, workspaceStyles, experienceSharingMigration, aiInterviewDeadlineMigration, offerDetailsMigration, offerCompensationMigration, offerCalculator, search] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/recruitment-tracker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/recruitment-calendar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/workspace.css", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/006_share_interview_experiences.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/010_ai_interview_deadlines.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/011_offer_details.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/012_offer_compensation_details.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/offer-calculator.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/search.ts", import.meta.url), "utf8"),
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
  assert.match(tracker, /打开邮箱/);
  assert.match(tracker, /MAILBOX_STORAGE_KEY/);
  assert.match(tracker, /https:\/\/mail\.qq\.com\//);
  assert.match(tracker, /https:\/\/mail\.163\.com\//);
  assert.match(tracker, /保存并打开/);
  assert.match(styles, /\.mailbox-quick-action/);
  assert.match(tracker, /toggleSort/);
  assert.match(tracker, /company-card-grid/);
  assert.match(tracker, /company-overview-card/);
  assert.match(tracker, /company-merge-table/);
  assert.match(tracker, /position-detail-table/);
  assert.match(tracker, /position-detail-position/);
  assert.match(tracker, /colSpan=\{view === "mine" \? 7 : 6\}/);
  assert.match(styles, /\.position-detail-position, \.position-detail-location/);
  assert.match(tracker, /application\.isOwner === false/);
  assert.match(styles, /position-detail-actions/);
  assert.match(styles, /max-width: 1280px/);
  assert.match(tracker, /view-mode-panel/);
  assert.match(tracker, /qiuzhao-list-mode/);
  assert.match(search, /pinyinSearchForms/);
  assert.match(search, /keyword\.length <= 3/);
  assert.match(tracker, /matchesFieldsSearch\(\[item\.company, item\.position, item\.base/);
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
  assert.match(tracker, /EXPERIENCE_VIEW_MODE_OPTIONS/);
  assert.match(tracker, /qiuzhao-experience-view-mode/);
  assert.match(tracker, /面经显示方式/);
  assert.match(styles, /\.experience-view-list/);
  assert.match(styles, /\.experience-view-timeline/);
  assert.match(tracker, /openExperienceFromInterview/);
  assert.match(tracker, /saveExperience/);
  assert.match(tracker, /experience-interview-meta/);
  assert.match(route, /interview_experiences/);
  assert.match(tracker, /好友共享/);
  assert.match(tracker, /选择面经共享范围/);
  assert.match(tracker, /批量设置面经共享/);
  assert.match(tracker, /一键全选/);
  assert.match(tracker, /SHARING_PREFERENCES_STORAGE_PREFIX/);
  assert.match(tracker, /applicationVisibility: canShare \? \(saved\.applicationVisibility \?\? "full"\)/);
  assert.match(tracker, /experienceVisibility: canShare \? \(saved\.experienceVisibility \?\? "full"\)/);
  assert.match(tracker, /offerShared: canShare \? \(saved\.offerShared \?\? true\)/);
  assert.match(tracker, /rememberSharing\(\{ experienceVisibility: experienceForm\.visibility/);
  assert.match(tracker, /experience-company-grid/);
  assert.match(tracker, /experienceCompanyGroups\.map/);
  assert.match(tracker, /按面试时间从近到远/);
  assert.match(tracker, /aria-label=\{`查看完整面经：\$\{experience\.title\}`\}/);
  assert.match(styles, /\.experience-view-button/);
  assert.ok(tracker.indexOf("experience-batch-bar") < tracker.indexOf("{filteredExperiences.length"), "batch sharing controls render in the experience library");
  assert.match(tracker, /updateExperienceVisibilityBatch/);
  assert.match(tracker, /linkedInterviewForExperience\(b, interviews\)\?\.scheduledAt/);
  assert.match(route, /action === "updateExperienceVisibilityBatch"/);
  assert.match(route, /\.in\("id", ids\)/);
  assert.match(tracker, /只读 · 来自共同小组/);
  assert.match(tracker, /查看完整面经/);
  assert.match(tracker, /共同小组中共享的完整面试记录/);
  assert.match(tracker, /setViewingExperience\(experience\)/);
  assert.match(styles, /\.experience-detail-section p[^}]*white-space: pre-wrap/);
  assert.match(route, /experienceGroupId/);
  assert.match(experienceSharingMigration, /public\.is_group_member\(group_id\)/);
  assert.match(experienceSharingMigration, /visibility = 'full'/);
  assert.match(tracker, /openStatFilter/);
  assert.match(tracker, /interview-stage-workspace/);
  assert.match(tracker, /renderExperienceLink/);
  assert.match(calendar, /calendar-status-summary/);
  assert.match(calendar, /completionStats\.completed/);
  assert.match(calendar, /completionStats\.pending/);
  assert.match(calendar, /completionStats\.total/);
  assert.match(calendar, /className="calendar-event-summary"/);
  assert.match(calendar, /className="calendar-event-company"/);
  assert.match(calendar, /className="calendar-event-stage"/);
  assert.match(calendar, /scheduleLink\(selectedEvent\.eventUrl\) \|\| scheduleLink\(selectedApplication\?\.link/);
  assert.match(calendar, /calendar-detail-open-link/);
  assert.match(calendar, />打开链接 ↗<\/a>/);
  assert.match(calendar, /calendarItemCanComplete\(selectedEvent\)/);
  assert.match(calendar, /completeItem\(selectedEvent\)/);
  assert.match(calendar, /item\.kind !== "interview" && calendarItemCanComplete\(item\)/);
  assert.match(tracker, /onCompleteEvent=\{\(calendarItem\) => void completeCalendarTodo\(calendarItem\)\}/);
  assert.match(workspaceStyles, /\.calendar-event \.calendar-event-stage\s*\{[^}]*flex:\s*none[^}]*white-space:\s*nowrap/s);
  assert.match(workspaceStyles, /\.calendar-event \.calendar-event-company\s*\{[^}]*text-overflow:\s*ellipsis/s);
  assert.match(tracker, /calendar-todo-filters/);
  assert.match(tracker, /visibleCalendarTodos\.map/);
  assert.doesNotMatch(tracker, /calendarTodos\.slice\(0,\s*12\)/);
  assert.match(tracker, /formatInterviewDate/);
  assert.match(tracker, /关联面试场次/);
  assert.match(tracker, /<span>形式<\/span>/);
  assert.match(tracker, /<span>结果<\/span>/);
  assert.doesNotMatch(tracker, /value=\{experienceForm\.interviewer\}/);
  assert.doesNotMatch(tracker, /value=\{experienceForm\.tags\}/);
  assert.doesNotMatch(tracker, /(?:<span>|placeholder="|ariaLabel=")\\u[0-9a-f]{4}/i);
  assert.match(route, /interview_id/);
  assert.match(schema, /interviewId/);
  assert.match(schema, /\| "AI面"/);
  assert.match(tracker, /INTERVIEW_ROUNDS = \["AI面", "技术一面"/);
  assert.match(tracker, /\{ key: "AI面", hint:/);
  assert.match(tracker, /if \(stage === "AI面"\) continue/);
  assert.match(tracker, /interviewStage\(interview\.round\) === "AI面"\) continue/);
  assert.match(tracker, /剩余时间（小时，可选）/);
  assert.match(tracker, /applyCalendarRemainingHours\("72"\)/);
  assert.match(calendar, /calendarItemCanComplete/);
  assert.match(calendar, /item\.kind === "assessment"/);
  assert.match(calendar, /agenda-event-complete/);
  assert.match(tracker, /schedule-chip-complete/);
  assert.match(tracker, /company-timeline-complete/);
  assert.match(tracker, /直接输入几点几分/);
  assert.match(tracker, /shiftCalendarClockTime\(-15\)/);
  assert.match(tracker, /CALENDAR_TIME_PRESETS\.map/);
  assert.match(styles, /\.calendar-time-assist/);
  assert.match(tracker, /syncStatus: item\.eventType === "written_test"/);
  assert.match(tracker, /calendarExperienceAfterSaveRef/);
  assert.match(tracker, /保存并补充面经/);
  assert.match(tracker, /calendarEventForm\.kind !== "interview" && \(/);
  assert.match(styles, /\.calendar-experience-action/);
  assert.match(tracker, /supportsRemainingHourDeadline\(calendarEventForm\.kind, calendarEventForm\.round\)/);
  assert.match(route, /timing_type: textValue\(value\.timingType/);
  assert.match(aiInterviewDeadlineMigration, /add column if not exists timing_type/);
  assert.match(tracker, /填写 Offer 详情/);
  assert.match(tracker, /共享给好友/);
  assert.match(tracker, /自动同步日历/);
  assert.match(tracker, /offerCalendarItems/);
  assert.match(calendar, /value: "offer", label: "Offer"/);
  assert.match(route, /offer_shared/);
  assert.match(route, /canSeeOfferDetails/);
  assert.match(offerDetailsMigration, /add column if not exists offer_received_at/);
  assert.match(offerDetailsMigration, /add column if not exists offer_shared boolean/);
  assert.match(offerCompensationMigration, /add column if not exists offer_compensation_details jsonb/);
  assert.match(tracker, /查看收入明细/);
  assert.match(tracker, /年实际到账/);
  assert.match(tracker, /总薪资（公积金 \+ 税后薪资）/);
  assert.match(tracker, /Offer 收入计算器/);
  assert.match(tracker, /changeWorkspaceView\("offerCalculator"\)/);
  assert.match(tracker, /临时计算参数已清空/);
  assert.match(route, /offer_compensation_details/);
  assert.match(offerCalculator, /function annualBonusTax/);
  assert.match(offerCalculator, /annualHousingFundAccount/);
  assert.match(offerCalculator, /annualTakeHomeWithHousingFund/);
  assert.match(styles, /interview-stage-board/);
  assert.match(styles, /interview-date-chip/);
  assert.match(styles, /stat-card\.is-selected/);
  assert.match(schema, /applications/);
  assert.match(hosting, /"d1": "DB"/);
});
