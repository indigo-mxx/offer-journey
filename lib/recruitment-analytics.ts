import type { Application, Interview, InterviewExperience, RecruitmentEvent } from "../db/schema";

const INTERVIEW_STATUSES = ["AI面", "一面", "二面", "三面", "终面", "HR面"];
const RESUME_STATUSES = ["准备投递", "简历投递", "已投递", "简历筛选"];
const CLOSED_STATUSES = ["已拒绝", "流程结束"];
export const INTENT_STATUS = "已意向，待谈薪/签约";

export function interviewAnalyticsStage(round: string) {
  const value = round.toLowerCase();
  if (/ai|智能面/.test(value)) return "AI面";
  if (/hr|人力/.test(value)) return "HR面";
  if (/终|vp|高管|主管/.test(value)) return "终面";
  if (/三|3|交叉/.test(value)) return "三面";
  if (/二|2/.test(value)) return "二面";
  if (/一|1|初/.test(value)) return "一面";
  return "其他面试";
}

export function calculateRecruitmentAnalytics(applications: Application[], interviews: Interview[] = [], events: RecruitmentEvent[] = [], experiences: InterviewExperience[] = []) {
  const ids = new Set(applications.map((app) => app.id));
  const interviewRecords = [...new Map(interviews.filter((item) => ids.has(item.applicationId)).map((item) => [item.id, item])).values()];
  const interviewIds = new Set(interviewRecords.map((item) => item.applicationId));
  const writtenIds = new Set(events.filter((item) => ids.has(item.applicationId) && ["written_test", "assessment"].includes(item.eventType) && item.status !== "已取消").map((item) => item.applicationId));
  for (const experience of experiences) {
    if (!experience.applicationId || !ids.has(experience.applicationId)) continue;
    if (/笔试|测评/.test(experience.round)) writtenIds.add(experience.applicationId);
    else interviewIds.add(experience.applicationId);
  }
  const formalOfferIds = new Set<string>();
  const intentIds = new Set<string>();
  const progressedIds = new Set<string>();
  for (const app of applications) {
    if (app.status === "Offer" || app.offerReceivedAt) formalOfferIds.add(app.id);
    if (app.status === INTENT_STATUS) intentIds.add(app.id);
    const outcome = app.finalOutcome ?? "";
    if (INTERVIEW_STATUSES.includes(app.status) || /(?:AI\s*面|HR\s*面|一面|二面|三面|终面)挂/.test(outcome) || formalOfferIds.has(app.id) || intentIds.has(app.id)) interviewIds.add(app.id);
    // Later stages do not prove a written test took place: use its own records.
    if (app.status === "笔试" || outcome === "笔试挂") writtenIds.add(app.id);
    if (!RESUME_STATUSES.includes(app.status) && outcome !== "简历挂"
      && (INTERVIEW_STATUSES.includes(app.status) || app.status === "笔试" || interviewIds.has(app.id) || writtenIds.has(app.id) || formalOfferIds.has(app.id) || intentIds.has(app.id))) progressedIds.add(app.id);
  }
  const offerIds = new Set([...formalOfferIds, ...intentIds]);
  const pendingIntentIds = new Set([...intentIds].filter((id) => !formalOfferIds.has(id)));
  const resolved = interviewRecords.filter((item) => ["通过", "未通过"].includes(item.result));
  const passed = resolved.filter((item) => item.result === "通过").length;
  const failed = resolved.length - passed;
  const rate = (numerator: number, denominator: number) => denominator ? Math.round(numerator / denominator * 100) : null;
  const stages = ["AI面", "一面", "二面", "三面", "终面", "HR面", "其他面试"].map((stage) => {
    const records = interviewRecords.filter((item) => interviewAnalyticsStage(item.round) === stage);
    const decisions = records.filter((item) => ["通过", "未通过"].includes(item.result));
    const passed = decisions.filter((item) => item.result === "通过").length;
    return { stage, total: records.length, passed, failed: decisions.length - passed, rate: rate(passed, decisions.length), failRate: rate(decisions.length - passed, decisions.length) };
  });
  const failureStages = ["简历", "测评", "笔试", "AI面", "一面", "二面", "三面", "终面", "HR面", "其他面试"].map((stage) => ({ stage, enteredIds: new Set<string>(), failedIds: new Set<string>() }));
  const stageByName = new Map(failureStages.map((item) => [item.stage, item]));
  const markStage = (stage: string, id: string, failed = false) => {
    const entry = stageByName.get(stage);
    entry?.enteredIds.add(id);
    if (failed) entry?.failedIds.add(id);
  };
  for (const app of applications) {
    markStage("简历", app.id);
    if (app.status === "笔试") markStage("笔试", app.id);
    if (INTERVIEW_STATUSES.includes(app.status)) markStage(app.status, app.id);
    const outcome = (app.finalOutcome ?? "").replace(/\s/g, "");
    const failedStage = outcome.endsWith("挂") ? outcome.slice(0, -1) : "";
    if (stageByName.has(failedStage)) markStage(failedStage, app.id, true);
  }
  for (const event of events) {
    if (ids.has(event.applicationId) && event.status !== "已取消") {
      if (event.eventType === "assessment") markStage("测评", event.applicationId);
      if (event.eventType === "written_test") markStage("笔试", event.applicationId);
    }
  }
  for (const record of interviewRecords) markStage(interviewAnalyticsStage(record.round), record.applicationId, record.result === "未通过");
  for (const experience of experiences) {
    if (!experience.applicationId || !ids.has(experience.applicationId)) continue;
    markStage(/测评/.test(experience.round) ? "测评" : /笔试/.test(experience.round) ? "笔试" : interviewAnalyticsStage(experience.round), experience.applicationId);
  }
  const failedApplicationIds = new Set(failureStages.flatMap((item) => [...item.failedIds]));
  return {
    total: applications.length, interviewIds, writtenIds, offerIds,
    interview: interviewIds.size, written: writtenIds.size, offers: offerIds.size,
    formalOffers: formalOfferIds.size, intents: pendingIntentIds.size,
    active: applications.filter((item) => ![...CLOSED_STATUSES, "Offer"].includes(item.status)).length,
    progressed: progressedIds.size, offerRate: rate(offerIds.size, applications.length) ?? 0,
    passed, failed, resolved: resolved.length, passRate: rate(passed, resolved.length), interviewFailRate: rate(failed, resolved.length),
    failedApplications: failedApplicationIds.size, failureRate: rate(failedApplicationIds.size, applications.length),
    failureStages: failureStages.map((item) => ({ stage: item.stage, entered: item.enteredIds.size, failed: item.failedIds.size, rate: rate(item.failedIds.size, item.enteredIds.size) })),
    pending: interviewRecords.filter((item) => !["通过", "未通过", "未参加"].includes(item.result)).length,
    absent: interviewRecords.filter((item) => item.result === "未参加").length,
    stages,
  };
}
