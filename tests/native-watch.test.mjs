import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createNativeWatchDecision} from '../native-watch-decision.mjs';
import {WATCH_SYSTEM_PROMPT,watchDecisionMessages,parseWatchDecision} from '../api-agent.mjs';
import {AutonomousWatch} from '../autonomous-watch.mjs';
import {PersonaMemory} from '../persona-memory.mjs';
import {VideoLimits} from '../video-limits.mjs';

const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGDkAAAAASUVORK5CYII=';
const ID='1234567890123456789';
const state=()=>({url:`https://www.douyin.com/video/${ID}`,loginRequired:false,verificationRequired:false,privateChatVisible:false,video:{id:ID,url:`https://www.douyin.com/video/${ID}`,title:'合成科普动画',author:'合成作者',time:3,duration:60,readyState:4,paused:false}});
const observation=()=>({state:state(),frames:[{mimeType:'image/png',data:PNG,time:3,videoId:ID}],observation:{videoId:ID,beforeTime:0,afterTime:3}});
const decision=()=>({action:'stop',reason:'已观察到合成动画，记录后结束。',topics:[{topic:'科普动画',signal:'like'}],reflection:'这次有限采样展示了清楚的图解。'});
function fixture(options={}) {
  const requests=[],saved=[];
  const llm={resolveModelInfo:async()=>({inputModalities:['text','image']}),async *stream(input){requests.push(input);yield {type:'text-delta',index:0,text:JSON.stringify(decision())};yield {type:'usage',usage:{inputTokens:10,outputTokens:20,totalTokens:30}};yield {type:'finish',reason:{kind:'stop'}};},...options};
  const agent={session:{id:'synthetic-native',requestHeader:()=>({config:{provider:'synthetic',model:'synthetic-vision'}})},options:{}};
  const attachments={saveImages:async images=>{saved.push(images);return[{attachmentId:'synthetic-ref',mediaType:'image/png',bytes:Buffer.from(PNG,'base64').length,width:1,height:1}];}};
  return{llm,agent,attachments,requests,saved,provider:createNativeWatchDecision({llm,agent,attachments})};
}
test('真实决策消息通过原生适配：核对system、转换附件、沿用当前模型路由与用量',async()=>{
  const f=fixture(),controller=new AbortController();
  const result=await f.provider({system:WATCH_SYSTEM_PROMPT,messages:watchDecisionMessages(observation(),{context:'合成人格'}),signal:controller.signal});
  assert.deepEqual(JSON.parse(result.text),decision());assert.equal(result.usage.total_tokens,30);
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].provider,'synthetic');assert.equal(f.requests[0].model,'synthetic-vision');
  assert.equal(f.requests[0].system,WATCH_SYSTEM_PROMPT);assert.equal(f.requests[0].messages.length,1);assert.equal(f.requests[0].messages[0].content[1].attachment.attachmentId,'synthetic-ref');
  assert.equal(f.requests[0].tools,undefined);assert.equal(f.saved.length,1);assert.deepEqual(f.saved[0][0].data,Buffer.from(PNG,'base64'));
});
test('没有图像能力或system不一致时不发起原生模型生成',async()=>{
  const f=fixture({resolveModelInfo:async()=>({inputModalities:['text']})});
  await assert.rejects(f.provider({system:WATCH_SYSTEM_PROMPT,messages:watchDecisionMessages(observation())}),/画面/);assert.equal(f.requests.length,0);assert.equal(f.saved.length,0);
  const g=fixture();await assert.rejects(g.provider({system:WATCH_SYSTEM_PROMPT,messages:[{role:'system',content:'合成替换系统指令'}]}),/不一致/);assert.equal(g.requests.length,0);
});
test('error/aborted 完成标记仍拒绝；max-tokens 且正文完整按有效决策收（用户裁决：Magpie+GLM 实测 finish 常为 length，不再误判截断）',async()=>{
  for(const kind of ['error','aborted']){const f=fixture({async *stream(){yield{type:'text-delta',index:0,text:JSON.stringify(decision())};yield{type:'finish',reason:{kind}};}});await assert.rejects(f.provider({system:WATCH_SYSTEM_PROMPT,messages:watchDecisionMessages(observation())}),/未有效完成/);}
  const lengthOk=fixture({async *stream(){yield{type:'text-delta',index:0,text:JSON.stringify(decision())};yield{type:'finish',reason:{kind:'max-tokens'}};}});
  assert.deepEqual(JSON.parse((await lengthOk.provider({system:WATCH_SYSTEM_PROMPT,messages:watchDecisionMessages(observation())})).text),decision());
  const truncated=fixture({async *stream(){yield{type:'text-delta',index:0,text:'{"action":"st'};yield{type:'finish',reason:{kind:'max-tokens'}};}});
  const truncText=(await truncated.provider({system:WATCH_SYSTEM_PROMPT,messages:watchDecisionMessages(observation())})).text;
  assert.throws(()=>parseWatchDecision(truncText),/没有返回有效 JSON/, '真截断的残缺 JSON 由上层严格校验拒绝，不再由 finish 标记放过或拒绝');
  const f=fixture({async *stream(){yield{type:'block-end',index:0,block:{type:'text',text:JSON.stringify(decision())}};yield{type:'finish',reason:{kind:'stop'}};}});
  assert.deepEqual(JSON.parse((await f.provider({system:WATCH_SYSTEM_PROMPT,messages:watchDecisionMessages(observation())})).text),decision());
});

test('当前路由声明off能力时仅本次短回复关闭思考，文本和图片保持原上限与附件', async () => {
  const f = fixture({ resolveModelInfo: async () => ({ inputModalities: ['text', 'image'], reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }], defaultEffort: 'high' } }) });
  await f.provider({ system: WATCH_SYSTEM_PROMPT, messages: watchDecisionMessages(observation()) });
  assert.equal(f.requests[0].reasoningEffort, 'off'); assert.equal(f.requests[0].maxTokens, 1200); assert.equal(f.saved.length, 1);
  const reply = createNativeWatchDecision({ llm: f.llm, attachments: f.attachments, agent: f.agent, maxTokens: 512 });
  await reply({ system: '合成普通聊天系统提示', messages: [{ role: 'user', content: '合成文字消息' }] });
  assert.equal(f.requests[1].reasoningEffort, 'off'); assert.equal(f.requests[1].maxTokens, 512);
  assert.equal(f.requests[1].messages[0].content[0].text, '合成文字消息');
  assert.equal(f.agent.session.requestHeader().config.reasoningEffort, undefined);
});

test('没有off能力不猜参数，能力每次重新核对，不缓存上一次关闭思考的选择', async () => {
  let info = { inputModalities: ['text'], reasoning: { efforts: [{ id: 'off', name: 'Off' }] } };
  const f = fixture({ resolveModelInfo: async () => info }), request = { system: '合成系统提示', messages: [{ role: 'user', content: '合成文字消息' }] };
  await f.provider(request); assert.equal(f.requests[0].reasoningEffort, 'off');
  info = { inputModalities: ['text'], reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } };
  await f.provider(request); assert.equal(Object.hasOwn(f.requests[1], 'reasoningEffort'), false);
  info = { inputModalities: ['text'] };
  await f.provider(request); assert.equal(Object.hasOwn(f.requests[2], 'reasoningEffort'), false);
});

test('关闭思考后 provider 收下截断残文并保留真实用量，由上层 JSON 校验拒绝', async () => {
  let calls = 0;
  const f = fixture({ resolveModelInfo: async () => ({ inputModalities: ['text'], reasoning: { efforts: [{ id: 'off', name: 'Off' }] } }),
    async *stream(input) { calls++; assert.equal(input.reasoningEffort, 'off'); yield { type: 'text-delta', index: 0, text: '{"action":"st' };
      yield { type: 'usage', usage: { inputTokens: 30, outputTokens: 1200, reasoningTokens: 1100, totalTokens: 1230 } }; yield { type: 'finish', reason: { kind: 'max-tokens' } }; } });
  const result = await f.provider({ system: '合成系统提示', messages: [{ role: 'user', content: '合成文字消息' }] });
  assert.equal(result.text, '{"action":"st'); assert.equal(result.usage.completion_tokens, 1200); assert.equal(result.usage.total_tokens, 1230);
  assert.throws(() => parseWatchDecision(result.text), /没有返回有效 JSON/, '残缺 JSON 由上层拒绝，计数为 WATCH_DECISION_FORMAT');
  assert.equal(calls, 1);
});
test('原生自主循环把观察写入同一人格文件，停止前的有限画面不直接学成喜欢',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-watch-shared-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  const memoryDir=path.join(root,'memory'),personaMemory=new PersonaMemory({memoryDir}),videoLimits=new VideoLimits({stateDir:path.join(root,'state')});personaMemory.initialize();videoLimits.markSession('dsh',{explicit:true});
  const f=fixture();let paused=0;
  const controller={execute:async(name,_args,options)=>{assert.ok(options.autonomousRunId);return name==='douyin_observe'?observation():state();},pauseForLimits:async()=>{paused++;}};
  const watch=new AutonomousWatch({controller,config:{},videoLimits,personaMemory,source:'dsh',stateDir:videoLimits.stateDir,decisionProvider:f.provider});
  t.after(()=>watch.close());watch.start({maxRequests:2},{explicit:true});await watch.completion;
  assert.equal(watch.state().running,false);assert.equal(watch.state().counts.requests,1);assert.equal(paused,1);assert.equal(f.requests.length,1);
  const apiPersona=new PersonaMemory({memoryDir}).snapshot();assert.equal(apiPersona.interests.length,0);assert.equal(apiPersona.recentObservations.length,1);assert.equal(apiPersona.recentObservations[0].signal,'neutral');assert.match(apiPersona.personaText,/科普动画/);
});
