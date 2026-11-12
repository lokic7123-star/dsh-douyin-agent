import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { archivePending, ChatService } from '../chat-service.mjs';
import { DailyReport } from '../daily-report.mjs';
import { PersonaMemory } from '../persona-memory.mjs';

const config = { apiKey: 'synthetic-retention-key', baseUrl: 'https://synthetic.example', model: 'synthetic-model' };
const contact = { id: `conv:${'3'.repeat(64)}`, name: '合成联系人', followed: true, isGroup: false, identityVerified: true, identityBinding: `binding:${'4'.repeat(64)}`, identityVersion: 2, identityKind: 'rendered-user', identityHash: '3'.repeat(64) };

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-retention-test-'));
  t.after(() => {
    const target = path.resolve(directory);
    if (!target.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(target).startsWith('douyin-retention-test-')) throw new Error('测试清理目录越界。');
    fs.rmSync(target, { recursive: true, force: true });
  });
  const browser = { listContacts: async () => ({ contacts: [contact] }), readConversation: async () => ({ conversation: { id: contact.id }, contact: { ...contact }, messages: [] }), sendMessage: async () => ({ confirmed: true, messageId: 'sent-1' }) };
  const agent = { replyTokens: 256, reply: async () => ({ text: '[自动回复] 合成测试回复' }) };
  const service = new ChatService({ browser, config, agent, stateDir: directory });
  t.after(async () => { await service.close(); });
  return { directory, service };
}

test('事件日志超过体积上限就滚动归档，最多保留三份归档', async t => {
  const { directory, service } = fixture(t);
  const logFile = path.join(directory, 'chat-events.jsonl');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(logFile, `${'x'.repeat(2 * 1024 * 1024 + 16)}\n`);
  service.log('synthetic.event', { note: '触发滚动' });
  assert.equal(fs.existsSync(`${logFile}.1`), true, '当前文件应被归档为 .1');
  assert.equal(fs.existsSync(logFile), true, '滚动后应继续写当前文件');
  const archived = fs.readFileSync(`${logFile}.1`, 'utf8');
  assert.ok(archived.includes('xxxx'), '归档内容应是滚动前的日志');
  const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert.equal(lines.filter(item => item.type === 'synthetic.event').length, 1, '新事件写在当前文件');
});

test('启动失败反复重试时，同一错误只记一条启动失败日志', async t => {
  const { directory, service } = fixture(t);
  await service.configure({ recipientIds: [contact.id], dailyReplyLimit: 40 });
  const notRunning = () => Object.assign(new Error('专用浏览器未运行，未自动打开。'), { code: 'BROWSER_NOT_RUNNING' });
  service.browser.listContacts = async () => { throw notRunning(); };
  await assert.rejects(() => service.start({ schedule: false }), error => error.code === 'BROWSER_NOT_RUNNING');
  await assert.rejects(() => service.start({ schedule: false }), error => error.code === 'BROWSER_NOT_RUNNING');
  await assert.rejects(() => service.start({ schedule: false }), error => error.code === 'BROWSER_NOT_RUNNING');
  const lines = fs.readFileSync(path.join(directory, 'chat-events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert.equal(lines.filter(item => item.type === 'service.deferred').length, 1, '同一启动失败不应反复刷日志');
});

test('待答归档超过上限就丢掉最旧的记录，最近的保留', () => {
  const mark = { unanswered: [] };
  for (let index = 0; index < 520; index += 1) archivePending(mark, { phase: 'unsupported-media', incoming: [{ id: `m-${index}`, kind: 'text' }] }, '合成归档');
  assert.equal(mark.unanswered.length, 500, '待答归档应被裁到上限');
  assert.equal(mark.unanswered[mark.unanswered.length - 1].incoming[0].id, 'm-519', '最近一条必须保留');
});

test('日报统计回复时同时读取滚动归档，滚动不丢当天回复数', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-retention-report-'));
  t.after(() => {
    const target = path.resolve(root);
    if (!target.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(target).startsWith('douyin-retention-report-')) throw new Error('测试清理目录越界。');
    fs.rmSync(target, { recursive: true, force: true });
  });
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  const event = { at: '2026-10-16T04:00:00.000Z', type: 'reply.sent' };
  fs.writeFileSync(path.join(stateDir, 'chat-events.jsonl.1'), `${JSON.stringify(event)}\n`);
  const memory = new PersonaMemory({ memoryDir: path.join(root, 'memory'), legacyRoleCardFile: path.join(root, 'never.md') });
  memory.initialize({ importLegacy: false });
  const report = new DailyReport({ personaMemory: memory, now: () => Date.parse('2026-10-16T12:00:00Z'), stateDir });
  const summary = report.interactions('2026-10-16');
  assert.equal(summary.replies, 1, '滚动归档里的回复也要算进当天回复数');
});
