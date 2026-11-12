import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AutonomousComments } from '../autonomous-comments.mjs';
import { AutonomousShare } from '../autonomous-share.mjs';

const day = offsetDays => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(Date.now() + offsetDays * 86400000));
const conv = 'conv:' + 'a'.repeat(64);
const evidence = 'video:' + 'b'.repeat(64);

const stubs = () => ({
  personaMemory: { snapshot: () => ({ interests: [] }) },
  videoLimits: { state: () => ({ allowed: true }) },
  send: async () => ({ confirmed: true }),
});

test('分享账本：过期的已确认记录被剪掉，未确认记录与最近记录保留', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-share-retention-'));
  const share = new AutonomousShare({ ...stubs(), stateDir: directory, source: 'api' });
  const ledger = {
    version: 1,
    days: { [day(-200)]: 1, [day(-1)]: 1 },
    operations: [
      { operationId: 'old-done', videoId: '1', recipientId: conv, evidenceId: evidence, status: 'confirmed', day: day(-200), source: 'api', pid: 1 },
      { operationId: 'old-pending', videoId: '2', recipientId: conv, evidenceId: evidence, status: 'uncertain', day: day(-200), source: 'api', pid: 1 },
      { operationId: 'new-done', videoId: '3', recipientId: conv, evidenceId: evidence, status: 'confirmed', day: day(-1), source: 'api', pid: 1 },
    ],
  };
  share.pruneLedger(ledger);
  const ids = ledger.operations.map(item => item.operationId);
  assert.ok(!ids.includes('old-done'), '过期的已确认分享记录应被清掉');
  assert.ok(ids.includes('old-pending'), '未确认的分享记录必须保留，等人工核对');
  assert.ok(ids.includes('new-done'), '最近的分享记录必须保留');
  assert.equal(ledger.days[day(-200)], undefined, '被剪掉日期的预算计数也要一起清掉，否则自校验会报错');
  assert.equal(ledger.days[day(-1)], 1, '最近日期的预算计数保留');
});

test('评论账本：过期的已确认记录被剪掉，未确认记录与最近记录保留', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-comments-retention-'));
  const comments = new AutonomousComments({ ...stubs(), stateDir: directory, source: 'api' });
  const ledger = {
    version: 1,
    days: { [day(-200)]: 1, [day(-1)]: 1 },
    sessions: {},
    operations: [
      { operationId: 'old-done', videoId: '1', evidenceId: evidence, status: 'confirmed', day: day(-200), source: 'api', pid: 1 },
      { operationId: 'old-pending', videoId: '2', evidenceId: evidence, status: 'uncertain', day: day(-200), source: 'api', pid: 1 },
      { operationId: 'new-done', videoId: '3', evidenceId: evidence, status: 'confirmed', day: day(-1), source: 'api', pid: 1 },
    ],
  };
  comments.pruneLedger(ledger);
  const ids = ledger.operations.map(item => item.operationId);
  assert.ok(!ids.includes('old-done'), '过期的已确认评论记录应被清掉');
  assert.ok(ids.includes('old-pending'), '未确认的评论记录必须保留');
  assert.ok(ids.includes('new-done'), '最近的评论记录必须保留');
  assert.equal(ledger.days[day(-200)], undefined, '被剪掉日期的预算计数也要一起清掉');
});
