import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ChatAgent } from '../chat-agent.mjs';
import { ChatService } from '../chat-service.mjs';

const config = { apiKey: 'synthetic-self-heal-key', baseUrl: 'https://synthetic.example', model: 'synthetic-model' };
const contact = { id: `conv:${'1'.repeat(64)}`, name: '合成联系人', followed: true, isGroup: false, identityVerified: true, identityBinding: `binding:${'2'.repeat(64)}`, identityVersion: 2, identityKind: 'rendered-user', identityHash: '1'.repeat(64) };
const message = (id, text, sender = 'incoming') => ({ id, text, sender, eligibleForReply: true });
const notRunning = () => Object.assign(new Error('专用浏览器未运行，未自动打开。'), { code: 'BROWSER_NOT_RUNNING' });

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-self-heal-test-'));
  const messages = [message('old', '启动前的旧消息，不应回复')];
  const sent = [];
  const inputs = [];
  const heals = [];
  const browser = {
    listContacts: async () => ({ contacts: [contact] }),
    readConversation: async (id, args) => { assert.equal(args.allowed, true); assert.equal(id, contact.id); return { conversation: { id }, contact: { ...contact }, messages: [...messages] }; },
    sendMessage: async (id, text, args) => { assert.equal(args.allowed, true); sent.push({ id, text }); return { confirmed: true, messageId: `sent-${sent.length}` }; },
    selfHealChat: async () => { heals.push(Date.now()); return { prepared: true, count: 1 }; },
    ...options.browser,
  };
  const agent = { replyTokens: 512, reply: async (value) => { inputs.push(value.messages.map((item) => ({ ...item }))); return { text: '[自动回复] 合成测试回复' }; }, ...options.agent };
  const service = new ChatService({ browser, config, agent, stateDir: directory });
  t.after(async () => { await service.close(); const target = path.resolve(directory); if (!target.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('测试清理目录越界。'); fs.rmSync(target, { recursive: true, force: true }); });
  return { service, messages, sent, inputs, directory, browser, agent, heals };
}
const prepare = async (f, limit = 40) => { await f.service.configure({ recipientIds: [contact.id], dailyReplyLimit: limit }); await f.service.start({ schedule: false }); };
// 全量兜底那一轮不查未读角标；把上次全量时间推到当下，让这一轮走未读探针，
// 「有未读＝有人欠账」这条线索才进得来。
const prepareWithDebtProbe = async (f) => { await prepare(f); f.service.lastFullScanAt = Date.now(); };
const events = (f) => fs.readFileSync(f.service.logFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));

test('浏览器没在运行时后台自己拉起并重读，之后按正常资格回复', async t => {
  const f = fixture(t);
  await prepareWithDebtProbe(f);
  // 角标报未读＝有人确实在等回复，属于「有欠账」，才允许为了回复自己拉起浏览器。
  f.browser.unreadCounts = async () => ({ available: true, counts: { [contact.id]: 1 } });
  let down = true;
  const read = f.browser.readConversation;
  f.browser.readConversation = async (id, args) => { if (down) { down = false; throw notRunning(); } return read(id, args); };
  f.messages.push(message('new', '自愈之后的新消息'));
  await f.service.poll();
  assert.equal(f.heals.length, 1, '只自愈一次');
  assert.equal(f.service.state().contacts[0].status, 'ready');
  assert.equal(f.inputs.length, 1, '自愈后按新到达资格正常回复');
  assert.equal(f.sent.length, 1);
  const lines = events(f);
  assert.equal(lines.filter(item => item.type === 'browser.self_healed').length, 1);
  assert.equal(lines.filter(item => item.type === 'message.browser_closed').length, 0, '自愈成功不记未运行');
});

test('自愈失败时落回未运行状态并进入冷却，不每轮重复拉起', async t => {
  const f = fixture(t, { browser: { selfHealChat: async () => { throw Object.assign(new Error('合成自愈失败'), { code: 'CHAT_LOGIN_REQUIRED', needsUserAction: true }); } } });
  await prepareWithDebtProbe(f);
  // 同样先制造欠账：有欠账才允许拉起，否则属于「没人欠账就别开抖音」。
  f.browser.unreadCounts = async () => ({ available: true, counts: { [contact.id]: 1 } });
  f.browser.readConversation = async () => { throw notRunning(); };
  await f.service.poll(); await f.service.poll(); await f.service.poll();
  const row = f.service.state().contacts[0];
  assert.equal(row.status, 'ready');
  assert.match(row.reason, /需要登录或验证/);
  assert.equal(row.recovery.requiresUserAction, true);
  const lines = events(f);
  assert.equal(lines.filter(item => item.type === 'browser.self_heal_failed').length, 1, '冷却期内只尝试一次自愈');
  assert.equal(lines.filter(item => item.type === 'message.browser_closed').length, 1, '未运行日志仍降频记录一条');
});

test('启动阶段浏览器没在运行也不拉起：没人欠账就不该打开抖音', async t => {
  const f = fixture(t);
  await f.service.configure({ recipientIds: [contact.id], dailyReplyLimit: 40 });
  let down = true;
  const list = f.browser.listContacts;
  f.browser.listContacts = async (options) => { if (down) { down = false; throw notRunning(); } return list(options); };
  // 启动阶段只读一次联系人不拉起浏览器（2026-11-10 用户裁决：启动不触发）。
  await assert.rejects(() => f.service.start({ schedule: false }), error => error.code === 'BROWSER_NOT_RUNNING');
  assert.equal(f.heals.length, 0, '启动阶段不自己拉起浏览器');
  assert.equal(f.service.state().running, false);
});

test('自愈只在浏览器控制器支持时启用，不支持时保持原样记录未运行', async t => {
  const f = fixture(t);
  delete f.browser.selfHealChat;
  await prepareWithDebtProbe(f);
  // 有欠账才会尝试自愈；这里控制器不支持自愈，于是保持原样记为未运行。
  f.browser.unreadCounts = async () => ({ available: true, counts: { [contact.id]: 1 } });
  f.browser.readConversation = async () => { throw notRunning(); };
  await f.service.poll();
  const row = f.service.state().contacts[0];
  assert.equal(row.status, 'ready');
  assert.match(row.reason, /浏览器未运行/);
});

test('到达时间只进系统提示，服务端时间优先，页面时间标为参考', async () => {
  let request;
  const agent = new ChatAgent({ config: { apiKey: '', model: 'synthetic-timing' }, replyProvider: async value => { request = value; return { text: '合成回复' }; } });
  await agent.reply({
    messages: [
      { id: 'a', sender: 'incoming', text: '第一条', nativeCreatedAt: '2026-11-10T03:00:00.000Z', dateEvidence: { raw: '今天 12:00', kind: 'today' } },
      { id: 'b', sender: 'incoming', text: '第二条', dateEvidence: { raw: '2026-11-09 08:30', kind: 'absolute' } },
    ],
    conversation: { displayName: '合成昵称', isGroup: false },
  });
  assert.match(request.system, /本轮收到的消息到达时间/);
  assert.match(request.system, /2026-11-10T03:00:00.000Z/);
  assert.match(request.system, /服务端消息时间/);
  assert.match(request.system, /2026-11-09 08:30/);
  assert.match(request.system, /页面显示的日期/);
  assert.doesNotMatch(JSON.stringify(request.messages), /2026-11-10T03:00:00.000Z/);
  assert.equal(request.messages.at(-1).content, '第二条');
});

test('没有可读时间时不注入时间说明', async () => {
  let request;
  const agent = new ChatAgent({ config: { apiKey: '', model: 'synthetic-timing' }, replyProvider: async value => { request = value; return { text: '合成回复' }; } });
  await agent.reply({ messages: [{ id: 'a', sender: 'incoming', text: '没有时间戳' }], conversation: { displayName: '合成昵称', isGroup: false } });
  assert.doesNotMatch(request.system, /本轮收到的消息到达时间/);
});
