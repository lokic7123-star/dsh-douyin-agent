// D6 前置验证：Magpie（OpenAI 兼容 chat）音频输入合同探测。
// 用法：MAGPIE_BASE_URL=... MAGPIE_API_KEY=... MAGPIE_MODEL=... node verify-magpie-audio.mjs <音频文件路径>
// 只发一条 1 秒级音频的 chat-audio 请求，打印模型是否接受 input_audio content part。
// 不落盘 key；从环境变量读取；不写任何配置文件。
import fs from 'node:fs';

const base = (process.env.MAGPIE_BASE_URL || '').replace(/\/+$/, '');
const key = process.env.MAGPIE_API_KEY || '';
const model = process.env.MAGPIE_MODEL || '';
const file = process.argv[2] || '';

if (!base || !key || !model || !file) { console.error('用法：MAGPIE_BASE_URL=... MAGPIE_API_KEY=... MAGPIE_MODEL=... node verify-magpie-audio.mjs <wav/mp3 文件>'); process.exit(2); }
if (!fs.existsSync(file)) { console.error(`音频文件不存在：${file}`); process.exit(2); }

const bytes = fs.readFileSync(file);
const format = file.toLowerCase().endsWith('.mp3') ? 'mp3' : 'wav';
const body = {
  model,
  max_tokens: 256,
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: '请逐字转写这段音频，只回答转写文本。' },
      { type: 'input_audio', input_audio: { data: bytes.toString('base64'), format } },
    ],
  }],
};

try {
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST', redirect: 'error',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  console.log(`HTTP ${response.status}`);
  const data = await response.json().catch(() => null);
  if (response.ok) {
    const content = data?.choices?.[0]?.message?.content;
    console.log(content ? `✅ Magpie 接受音频输入（合同成立）\n答复：${String(content).slice(0, 300)}` : '⚠️ HTTP 200 但无 content——检查响应结构');
    console.log(`usage: ${JSON.stringify(data?.usage ?? null)}`);
  } else {
    console.log(`❌ 拒绝：${JSON.stringify(data).slice(0, 400)}`);
    console.log('若错误是 content 类型不支持/未知字段 → 该模型端点不支持 chat-audio，D6 需走专用转写接口或宿主 llm 桥接。');
  }
} catch (error) {
  console.log(`❌ 请求失败：${error.message}`);
}
