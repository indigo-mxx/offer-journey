import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateRecruitmentAnalytics } from '../lib/recruitment-analytics.ts';

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
