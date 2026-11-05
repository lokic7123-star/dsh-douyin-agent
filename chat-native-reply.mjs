import { randomUUID } from 'node:crypto';

const IMAGE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
const BUDGET = 1000, BUDGET_MAX = 1200;

// 聊天回复专用 provider：复用 DSH 底层模型传输（llm），与观看决策通道分开预算、错误分类与完成语义。
// 预算依据（2026-11 取证 docs/backlog-forensics.md）：512 决策预算下唯一成功样本 completionTokens=494（贴线），
// 其余全为 max-tokens 截断；1000 覆盖其两倍余量且低于 DSH 1200 约定。截断按失败处理，绝不当作完整回复发送。
export function createNativeChatReply({ llm, attachments, agent, maxTokens = BUDGET } = {}) {
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > BUDGET_MAX) throw new Error(`聊天回复输出预算须在 1 至 ${BUDGET_MAX} 之间。`);
  const header = agent?.session?.requestHeader?.()?.config;
  const provider = header?.provider ?? agent?.options?.provider;
  const model = header?.model ?? agent?.options?.model;
  if (!provider || !model || typeof llm?.stream !== 'function' || typeof llm?.resolveModelInfo !== 'function') throw new Error('当前 DSH 未提供可核实的模型路由，不能启动聊天回复。');
  return async function chatReply({ system, messages, signal }) {
    signal?.throwIfAborted();
    const info = await llm.resolveModelInfo(provider, model, signal);
    const shortReplyControls = Array.isArray(info?.reasoning?.efforts) && info.reasoning.efforts.some(effort => effort.id === 'off') ? { reasoningEffort: 'off' } : {};
    const hasImages = messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image_url'));
    if (hasImages && (!info?.inputModalities?.includes('image') || typeof attachments?.saveImages !== 'function')) throw new Error('当前 DSH 模型或附件服务不能接收聊天采样画面，已停止本次回复。');
    const converted = [];
    for (const message of messages) {
      if (message.role === 'system') { if (message.content !== system) throw new Error('聊天回复系统提示不一致。'); continue; }
      if (!['user', 'assistant'].includes(message.role)) throw new Error('聊天回复只接收本次会话的用户或模型消息。');
      const blocks = [];
      for (const part of typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content || []) {
        if (part.type === 'text') blocks.push({ type: 'text', text: String(part.text) });
        else if (part.type === 'image_url') {
          const match = IMAGE.exec(part.image_url?.url || '');
          if (!match) throw new Error('聊天画面格式无效。');
          const data = Buffer.from(match[2], 'base64');
          if (!data.length || data.length > 2_000_000 || data.toString('base64') !== match[2]) throw new Error('聊天画面超出限制或编码无效。');
          const refs = await attachments.saveImages([{ data, mediaType: match[1] }]);
          signal?.throwIfAborted();
          if (!Array.isArray(refs) || refs.length !== 1 || !refs[0]?.attachmentId) throw new Error('DSH 未保存完整的聊天画面附件。');
          blocks.push({ type: 'image', attachment: refs[0] });
        } else throw new Error('聊天回复请求含未允许的内容类型。');
      }
      converted.push({ id: randomUUID(), role: message.role, content: blocks, source: { kind: 'plugin', plugin: 'douyin-browser', form: 'snapshot', sections: [] } });
    }
    let text = '', finish, usage = {}; const deltaIndexes = new Set();
    for await (const chunk of llm.stream({ provider, model, messages: converted, system, maxTokens, ...shortReplyControls, signal, sessionId: agent.session.id })) {
      signal?.throwIfAborted();
      if (chunk.type === 'text-delta') {
        deltaIndexes.add(chunk.index);
        text += chunk.text;
        if (text.length > 12_000) throw Object.assign(new Error('聊天回复超过长度上限，未发送。'), { code: 'CHAT_REPLY_OVERLONG', usage });
      }
      if (chunk.type === 'block-end' && chunk.block?.type === 'text' && !deltaIndexes.has(chunk.index)) text += chunk.block.text;
      if (text.length > 12_000) throw Object.assign(new Error('聊天回复超过长度上限，未发送。'), { code: 'CHAT_REPLY_OVERLONG', usage });
      if (chunk.type === 'usage') usage = { ...chunk.usage, prompt_tokens: chunk.usage.inputTokens ?? null, completion_tokens: chunk.usage.outputTokens ?? null, total_tokens: chunk.usage.totalTokens ?? (Number.isSafeInteger(chunk.usage.inputTokens) && Number.isSafeInteger(chunk.usage.outputTokens) ? chunk.usage.inputTokens + chunk.usage.outputTokens : null) };
      if (chunk.type === 'finish') finish = chunk.reason;
    }
    // 真实 DSH 契约用连字符 'max-tokens'（native-watch-decision 同源）；'max_tokens'/'length' 为兼容保留，三种都按截断处理。
    if (finish?.kind === 'max-tokens' || finish?.kind === 'max_tokens' || finish?.kind === 'length') throw Object.assign(new Error('聊天回复超出输出预算被截断，未当作完整回复发送。'), { code: 'CHAT_REPLY_TRUNCATED', usage });
    if (finish?.kind !== 'stop' || !text.trim()) throw Object.assign(new Error(`聊天回复未正常完成（${finish?.kind || '缺少完成标记'}），未发送。`), { usage, code: 'CHAT_REPLY_INCOMPLETE' });
    return { text, usage };
  };
}
