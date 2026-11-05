import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeChatReply } from '../chat-native-reply.mjs';
import { ChatAgent } from '../chat-agent.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGDkAAAAASUVORK5CYII=';
const messages = [{ role: 'user', content: '（合成改写）好友发来的普通文字消息' }];
const agent = { session: { id: 'synthetic-chat', requestHeader: () => ({ config: { provider: 'synthetic', model: 'synthetic-chat' } }) }, options: {} };
function fixture(options = {}, providerOptions = {}) {
  const requests = [], saved = [];
  const llm = { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }), async *stream(input) { requests.push(input); yield { type: 'text-delta', index: 0, text: '合成完整回复。' }; yield { type: 'usage', usage: { inputTokens: 300, outputTokens: 40, totalTokens: 340 } }; yield { type: 'finish', reason: { kind: 'stop' } }; }, ...options };
  const attachments = { saveImages: async images => { saved.push(images); return [{ attachmentId: 'synthetic-ref', mediaType: 'image/png', bytes: 70, width: 1, height: 1 }]; } };
  return { llm, requests, saved, provider: createNativeChatReply({ llm, attachments, agent, ...providerOptions }) };
}

test('正常完成：完整回复与用量透传，模型路由、预算与消息形态与观看决策分开', async () => {
  const f = fixture();
  const result = await f.provider({ system: '合成聊天系统提示', messages, signal: undefined });
  assert.equal(result.text, '合成完整回复。');
  assert.equal(result.usage.prompt_tokens, 300); assert.equal(result.usage.completion_tokens, 40); assert.equal(result.usage.total_tokens, 340);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].provider, 'synthetic'); assert.equal(f.requests[0].model, 'synthetic-chat');
  assert.equal(f.requests[0].system, '合成聊天系统提示'); assert.equal(f.requests[0].maxTokens, 1000);
  assert.equal(f.requests[0].messages[0].role, 'user'); assert.equal(f.requests[0].messages[0].content[0].text, messages[0].content);
  assert.equal(f.requests[0].tools, undefined);
});

test('截断按失败处理：真实契约 max-tokens 与兼容 length/max_tokens 都归 TRUNCATED，不得当作完整回复', async () => {
  for (const kind of ['max-tokens', 'length', 'max_tokens']) {
    const f = fixture({ async *stream() { yield { type: 'text-delta', index: 0, text: '合成半截回复，后面被截断的' }; yield { type: 'finish', reason: { kind } }; } });
    await assert.rejects(f.provider({ system: 's', messages }), error => { assert.equal(error.code, 'CHAT_REPLY_TRUNCATED', kind); assert.doesNotMatch(error.message, /自主观看/); assert.match(error.message, /截断/); return true; });
  }
  // 截断错误仍带真实用量，供入账
  const f = fixture({ async *stream() { yield { type: 'text-delta', index: 0, text: '合成半截' }; yield { type: 'usage', usage: { inputTokens: 300, outputTokens: 512, totalTokens: 812 } }; yield { type: 'finish', reason: { kind: 'length' } }; } });
  await assert.rejects(f.provider({ system: 's', messages }), error => { assert.equal(error.code, 'CHAT_REPLY_TRUNCATED'); assert.equal(error.usage.completion_tokens, 512); return true; });
});

test('取消与服务失败：abort 立即中止，stream 抛错原样冒泡，非 stop 完成语义独立分类', async () => {
  const controller = new AbortController();
  const f = fixture({ async *stream(input) { yield { type: 'text-delta', index: 0, text: '合成开头' }; controller.abort(new Error('合成用户取消')); input.signal.throwIfAborted(); yield { type: 'finish', reason: { kind: 'stop' } }; } });
  await assert.rejects(f.provider({ system: 's', messages, signal: controller.signal }), /合成用户取消/);
  const g = fixture({ async *stream() { throw new Error('合成上游 5xx'); } });
  await assert.rejects(g.provider({ system: 's', messages }), /合成上游 5xx/);
  const h = fixture({ async *stream() { yield { type: 'finish', reason: { kind: 'error' } }; } });
  await assert.rejects(h.provider({ system: 's', messages }), error => { assert.equal(error.code, 'CHAT_REPLY_INCOMPLETE'); assert.doesNotMatch(error.message, /自主观看/); return true; });
  const e = fixture({ async *stream() { yield { type: 'finish', reason: { kind: 'stop' } }; } });
  await assert.rejects(e.provider({ system: 's', messages }), error => { assert.equal(error.code, 'CHAT_REPLY_INCOMPLETE'); return true; });
});

test('带画面聊天：附件走 attachments 保存，与观看决策同一传输但独立调用', async () => {
  const f = fixture();
  const withImage = [{ role: 'user', content: [{ type: 'text', text: '（合成改写）图片消息说明' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + PNG } }] }];
  const result = await f.provider({ system: 's', messages: withImage });
  assert.equal(result.text, '合成完整回复。');
  assert.equal(f.saved.length, 1); assert.deepEqual(f.saved[0][0].data, Buffer.from(PNG, 'base64'));
  assert.equal(f.requests[0].messages[0].content[1].attachment.attachmentId, 'synthetic-ref');
});

test('接入 ChatAgent：用量照常入账不漏记，预算 1000 不被 replyTokens 压回 512', async t => {
  const directoryPrefix = 'chat-native-reply';
  const seen = [];
  const chatAgent = new ChatAgent({ config: { apiKey: '' }, replyProvider: async request => { const provider = fixture(); const result = await provider.provider(request); seen.push(result.usage); return result; } });
  const reply = await chatAgent.reply({ messages: [{ id: 'm1', sender: 'incoming', text: '（合成改写）普通消息' }], conversation: { displayName: '联系人A', isGroup: false } });
  assert.equal(reply.text, '合成完整回复。');
  assert.equal(reply.usage.promptTokens, 300); assert.equal(reply.usage.completionTokens, 40);
  assert.match(directoryPrefix, /chat-native-reply/); assert.equal(seen.length, 1);
  // provider 自身预算断言：调用不传 maxTokens 也用 1000，传入更小值不回退
  const p = fixture();
  await p.provider({ system: 's', messages, maxTokens: 512 });
  assert.equal(p.requests[0].maxTokens, 1000);
});
test('账本断言：截断带用量入账一次、正常完成入账一次、abort 无用量不入账', async t => {
  const { UsageLedger } = await import('../usage-ledger.mjs');
  const fs = await import('node:fs'), os = await import('node:os'), nodePath = await import('node:path');
  const stateDir = fs.default.mkdtempSync(nodePath.default.join(os.default.tmpdir(), 'chat-reply-ledger-'));
  t.after(() => fs.default.rmSync(stateDir, { recursive: true, force: true }));
  const ledger = new UsageLedger({ stateDir, now: () => Date.parse('2026-11-06T00:00:00Z') });
  let mode = 'ok', abortSignal = undefined;
  // usageLedger 按真实装配方式外部赋值（core.mjs:513 / app.mjs:82），不是构造参数。
  const chatAgent = new ChatAgent({ config: { apiKey: '' }, replyProvider: request => {
    const streamers = {
      ok: async function* () { yield { type: 'text-delta', index: 0, text: '合成完整回复。' }; yield { type: 'usage', usage: { inputTokens: 300, outputTokens: 40, totalTokens: 340 } }; yield { type: 'finish', reason: { kind: 'stop' } }; },
      truncate: async function* () { yield { type: 'text-delta', index: 0, text: '合成半截' }; yield { type: 'usage', usage: { inputTokens: 300, outputTokens: 512, totalTokens: 812 } }; yield { type: 'finish', reason: { kind: 'max-tokens' } }; },
      abort: async function* (input) { yield { type: 'text-delta', index: 0, text: '合成开头，无用量就被取消' }; abortSignal.abort(new Error('合成用户取消')); input.signal.throwIfAborted(); yield { type: 'finish', reason: { kind: 'stop' } }; },
    };
    const streamer = streamers[mode];
    return fixture({ async *stream(input) { yield* streamer(input); } }).provider({ system: request.system, messages: request.messages, signal: request.signal });
  } });
  chatAgent.usageLedger = ledger; chatAgent.source = 'dsh';
  // 1) 正常完成：入账一次
  await chatAgent.reply({ messages: [{ id: 'm1', sender: 'incoming', text: '（合成改写）普通消息' }], conversation: { displayName: '联系人A', isGroup: false } });
  // 2) 截断（真实 max-tokens，带用量）：失败路径入账一次
  mode = 'truncate';
  await assert.rejects(chatAgent.reply({ messages: [{ id: 'm2', sender: 'incoming', text: '（合成改写）会触发截断的消息' }], conversation: { displayName: '联系人A', isGroup: false } }), /截断/);
  // 3) abort 无用量：不入账
  mode = 'abort'; abortSignal = new AbortController();
  await assert.rejects(chatAgent.reply({ messages: [{ id: 'm3', sender: 'incoming', text: '（合成改写）被取消的消息' }], conversation: { displayName: '联系人A', isGroup: false }, signal: abortSignal.signal }));
  const usage = ledger.state();
  assert.equal(usage.total.requests, 2, `应恰好入账两条（正常+截断），实际 ${usage.total.requests}`);
  assert.equal(usage.total.completionTokens, 552, '40（正常）+512（截断）');
  assert.deepEqual(usage.groups.map(group => [group.source, group.kind, group.requests]), [['dsh', 'chat', 2]]);
});
test('预算参数校验沿用 DSH 1200 上限约定', () => {
  assert.throws(() => createNativeChatReply({ llm: {}, attachments: {}, agent, maxTokens: 1201 }), /1200/);
  assert.throws(() => createNativeChatReply({ llm: {}, attachments: {}, agent, maxTokens: 0 }), /预算/);
});
