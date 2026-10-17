import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateRecruitmentAnalytics, POOL_STATUS } from '../lib/recruitment-analytics.ts';

test('historical stages survive closed applications and count each position once', () => {
  const apps = [
    { id: 'closed', status: '流程结束', finalOutcome: '二面挂' },
    { id: 'rejected', status: '已拒绝' },
    { id: 'written', status: '流程结束', finalOutcome: '笔试挂' },
    { id: 'resume', status: '简历投递' },
  ];
  const interviews = [{ id: 'one', applicationId: 'closed', round: '技术一面', result: '通过' }, { id: 'two', applicationId: 'closed', round: '技术二面', result: '未通过' }];
  const events = [{ applicationId: 'closed', eventType: 'assessment', status: '已完成' }, { applicationId: 'resume', eventType: 'written_test', status: '已取消' }];
  const experiences = [{ applicationId: 'rejected', round: '技术一面' }];
  const result = calculateRecruitmentAnalytics(apps, interviews, events, experiences);
  assert.equal(result.interview, 2);
  assert.equal(result.written, 2);
  assert.equal(result.progressed, 3);
  assert.equal(result.passRate, 50);
  assert.ok(result.interviewIds.has('closed'));
  assert.ok(result.interviewIds.has('rejected'));
  assert.ok(!result.interviewIds.has('written'));
  assert.ok(!result.writtenIds.has('resume'));
});

test('offer and OC totals include intentions and retained offers after a process ends', () => {
  const result = calculateRecruitmentAnalytics([
    { id: 'intent', status: '已意向，待谈薪/签约' },
    { id: 'offer', status: 'Offer', offerReceivedAt: '2026-10-01' },
    { id: 'closed-offer', status: '已拒绝', offerReceivedAt: '2026-09-01' },
    { id: 'same', status: '已意向，待谈薪/签约', offerReceivedAt: '2026-10-01' },
    { id: 'no', status: '简历筛选' },
  ]);
  assert.equal(result.offers, 4);
  assert.equal(result.formalOffers, 3);
  assert.equal(result.intents, 1);
  assert.equal(result.offerRate, 80);
  assert.equal(result.formalOffers + result.intents, result.offers);
});

test('pass rates exclude pending and absence, deduplicate interviews and respect the selected cohort', () => {
  const pass = { id: 'pass', applicationId: 'a', round: '技术一面', result: '通过' };
  const interviews = [pass, pass,
    { id: 'fail', applicationId: 'a', round: '技术一面', result: '未通过' },
    { id: 'pending', applicationId: 'a', round: 'HR面', result: '待定' },
    { id: 'scheduled', applicationId: 'a', round: 'AI面', result: '未开始' },
    { id: 'absent', applicationId: 'a', round: '技术二面', result: '未参加' },
    { id: 'other-cohort', applicationId: 'b', round: '技术一面', result: '通过' },
  ];
  const result = calculateRecruitmentAnalytics([{ id: 'a', status: '流程结束' }], interviews);
  assert.equal(result.resolved, 2);
  assert.equal(result.passRate, 50);
  assert.equal(result.pending, 2);
  assert.equal(result.absent, 1);
  assert.equal(result.stages.find((row) => row.stage === '一面').rate, 50);
  assert.equal(result.stages.find((row) => row.stage === 'HR面').rate, null);
  assert.equal(calculateRecruitmentAnalytics([]).passRate, null);
});

test('resume rejection and current resume screening never count as progressing beyond resume', () => {
  const result = calculateRecruitmentAnalytics([
    { id: 'rejected-resume', status: '流程结束', finalOutcome: '简历挂' },
    { id: 'screening', status: '简历筛选' },
    { id: 'submitted', status: '简历投递' },
    { id: 'test-rejection', status: '流程结束', finalOutcome: '笔试挂' },
    { id: 'interview-rejection', status: '流程结束', finalOutcome: '二面挂' },
    { id: 'unknown', status: '流程结束', finalOutcome: '主动终止' },
    { id: 'assessment', status: '已拒绝' },
  ], [], [{ applicationId: 'assessment', eventType: 'assessment', status: '已完成' }]);
  assert.equal(result.progressed, 3);
  assert.equal(result.failedApplications, 3);
  assert.equal(result.failureStages.find((row) => row.stage === '简历').failed, 1);
  assert.equal(result.failureStages.find((row) => row.stage === '笔试').failed, 1);
  assert.equal(result.failureStages.find((row) => row.stage === '二面').failed, 1);
});

test('failure statistics reconcile records and final outcomes without double counting positions', () => {
  const result = calculateRecruitmentAnalytics([
    { id: 'a', status: '流程结束', finalOutcome: 'AI 面挂' },
    { id: 'b', status: '流程结束', finalOutcome: 'HR 面挂' },
    { id: 'c', status: '已拒绝', rejectionReason: '薪资不满足' },
    { id: 'd', status: '一面' },
  ], [
    { id: 'a1', applicationId: 'a', round: 'AI面', result: '未通过' },
    { id: 'a2', applicationId: 'a', round: 'AI面', result: '未通过' },
    { id: 'd1', applicationId: 'd', round: '技术一面', result: '通过' },
    { id: 'c1', applicationId: 'c', round: 'HR面', result: '未参加' },
    { id: 'outside', applicationId: 'outside', round: '技术一面', result: '未通过' },
  ]);
  assert.equal(result.failedApplications, 2);
  assert.equal(result.failureRate, 50);
  assert.equal(result.interviewFailRate, 67);
  assert.equal(result.failureStages.find((row) => row.stage === 'AI面').failed, 1);
  assert.equal(result.failureStages.find((row) => row.stage === 'AI面').rate, 100);
  assert.equal(result.failureStages.find((row) => row.stage === 'HR面').rate, 50);
  assert.equal(result.stages.find((row) => row.stage === 'AI面').failRate, 100);
  assert.equal(calculateRecruitmentAnalytics([]).failureRate, null);
});

test('pool is after interviews but before OC, with horizontal rejection counted separately', () => {
  const result = calculateRecruitmentAnalytics([
    { id: 'pool', status: POOL_STATUS },
    { id: 'horizontal', status: '流程结束', finalOutcome: '横向挂' },
    { id: 'intent', status: '已意向，待谈薪/签约' },
    { id: 'offer', status: 'Offer' },
    { id: 'resume', status: '简历筛选' },
  ]);
  assert.equal(result.pool, 1);
  assert.equal(result.interview, 4);
  assert.equal(result.progressed, 4);
  assert.equal(result.offers, 2, 'waiting in the pool is not an offer or intention');
  assert.equal(result.intents, 1);
  assert.equal(result.formalOffers, 1);
  assert.equal(result.offerRate, 40);
  assert.deepEqual(result.failureStages.find((item) => item.stage === '横向筛选'), { stage: '横向筛选', entered: 4, failed: 1, rate: 25 });
  assert.equal(result.failedApplications, 1);
  assert.equal(result.failureRate, 20);
  assert.equal(result.failed, 0, 'horizontal rejection is not an interview rejection');
  assert.equal(result.passRate, null, 'the application stage does not invent individual round results');
});

test('horizontal failure retains passed interviews and excludes other cohorts', () => {
  const result = calculateRecruitmentAnalytics([
    { id: 'a', status: '流程结束', finalOutcome: '横向挂' },
    { id: 'b', status: POOL_STATUS },
  ], [
    { id: 'a1', applicationId: 'a', round: '技术一面', result: '通过' },
    { id: 'a2', applicationId: 'a', round: 'HR面', result: '通过' },
    { id: 'b1', applicationId: 'b', round: 'HR面', result: '待定' },
    { id: 'outside', applicationId: 'outside', round: 'HR面', result: '未通过' },
  ]);
  assert.equal(result.passed, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.passRate, 100);
  assert.equal(result.pending, 1);
  assert.equal(result.failedApplications, 1);
  assert.equal(result.failureStages.find((item) => item.stage === '横向筛选').rate, 50);
  assert.equal(result.failureStages.find((item) => item.stage === 'HR面').failed, 0);
});
