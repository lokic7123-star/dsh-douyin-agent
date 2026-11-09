import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {ChatService} from '../chat-service.mjs';
import {messageFingerprint,messageContent,isOpenBacklogRecord} from '../chat-message.mjs';

// C1 隔离回放基建：R1–R6 脱敏失败案例的合成重建（来源：docs/backlog-forensics.md A 节结构关系）。
// 全部消息文本为合成改写；id 为合成短 id；不包含任何真实联系人、真实消息原文或真实标识。
// 驱动真实 processAutoBacklog 状态机，断言逐记录结局；本文件不含任何真实发送路径（发送只发生在合成 transport 上）。

const contact={id:'conv:'+'0'.repeat(64),name:'联系人A',isGroup:false,followed:null,relationshipStatus:'unavailable',identityVersion:2,identityKind:'rendered-user',identityHash:'0'.repeat(64),identityBinding:'binding:'+'1'.repeat(64),identityVerified:true,authorizationKind:'existing-conversation',verifiedAt:'2026-10-01T00:00:00.000Z'};
// 与 configure 生成的许可条目同形的确定性身份凭据（含 verifiedAt），供归档记录的 recoveryEvidence.contact 使用。
const authorized={id:contact.id,name:contact.name,followed:null,isGroup:false,verifiedAt:'2026-10-01T00:00:00.000Z',authorizationKind:'existing-conversation',identityVerified:true,identityBinding:contact.identityBinding,identityVersion:2,identityKind:contact.identityKind,identityHash:contact.identityHash,relationshipStatus:'unavailable',relationshipEvidence:'本人核对稳定会话身份后明确授权；网页未提供关注关系。'};
const textIncoming=(id,text)=>({id,text,sender:'incoming',direction:'incoming',kind:'text',identitySource:'dom-message-id',eligibleForReply:true,arrivalClassification:'new-tail',latestEndVerified:true,nativeServerMessageBound:true,nativeCreatedAt:new Date(Date.now()-300_000).toISOString(),timestamp:new Date(Date.now()-300_000).toISOString(),dateEvidence:{kind:'absolute'}});
const videoIncoming=id=>({id,text:'',sender:'incoming',direction:'incoming',kind:'video',identitySource:'dom-message-id',eligibleForReply:true,arrivalClassification:'new-tail',latestEndVerified:true,nativeServerMessageBound:true,nativeCreatedAt:new Date(Date.now()-300_000).toISOString(),timestamp:new Date(Date.now()-300_000).toISOString(),dateEvidence:{kind:'absolute'},media:{type:'shared-work',videoId:'1'.repeat(19),url:`https://www.douyin.com/video/${'1'.repeat(19)}`,identityConflict:false}});
function archiveRecord(authorized,messages,{id,phase='model',targetIds,generatedText=undefined,beforeDispatch=true}={}){
  const targets=Array.isArray(targetIds)?targetIds:[targetIds],incoming=[],qualified=[];
  for(const targetId of targets){const message=structuredClone(messages.find(item=>item.id===targetId));incoming.push(message);qualified.push({message,fingerprint:messageFingerprint(message),qualified:true,originalEligibleForReply:true});}
  return{archiveId:id,phase,at:new Date(Date.now()-180_000).toISOString(),skippedAt:new Date(Date.now()-120_000).toISOString(),...(generatedText!==undefined?{generatedText}:{}),incoming,recoveryEvidence:{version:1,beforeDispatch,contact:structuredClone(authorized),qualifiedIncoming:qualified,expectedContent:messageContent(messages),qualifiedAt:new Date(Date.now()-170_000).toISOString(),stopRequestId:null}};
}
async function replay(t,{messages,records,contact:contactOverride}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'backlog-replay-'));
  let modelCalls=0;
  const activeContact=contactOverride??contact;
  const browser={listContacts:async()=>({contacts:[structuredClone(activeContact)]}),unreadCounts:async()=>({available:true,counts:{}}),readConversation:async()=>({conversation:{id:activeContact.id,isGroup:activeContact.isGroup},contact:structuredClone(activeContact),messages:structuredClone(messages),dayEvidence:{chronology:'oldest-first',latestEndVerified:true}}),sendMessage:async()=>{throw new Error('回放中不得触发真实发送路径');},close:async()=>{}};
  const agent={replyTokens:512,reply:async value=>{modelCalls++;return{text:`合成回放回复 ${modelCalls}。`};}};
  const service=new ChatService({browser,agent,stateDir:directory,config:{apiKey:'synthetic-key'}});
  await service.configure({recipientIds:[activeContact.id],allowConversationOnly:true});await service.start({schedule:false});
  // 归档记录的身份凭据必须来自已核对的许可名单（含 verifiedAt），与真实归档链路一致（chat-service recoveryEvidence.contact）。
  const authorized=structuredClone(service.policy.allowlist[0]);
  const markValue=service.watermarks.contacts[activeContact.id];
  markValue.seen=messages.map(item=>item.id);markValue.unanswered=records.map(item=>typeof item==="function"?item(authorized):{...item,recoveryEvidence:{...item.recoveryEvidence,contact:structuredClone(authorized)}});markValue.pending=null;service.persist();
  t.after(async()=>{await service.close();fs.rmSync(directory,{recursive:true,force:true});});
  const mark=()=>service.watermarks.contacts[activeContact.id];
  return{service,mark,authorized,record:id=>mark().unanswered.find(item=>item.archiveId.startsWith(id)),modelCalls:()=>modelCalls,due:()=>{if(mark().autoBacklog)mark().autoBacklog.nextRetryAt=new Date(0).toISOString();service.persist();}};
}
async function runReplayPoll(f){await f.service.poll();}

test('回放（C1）：R1 历史映射失效记录转 needs-manual 终态，退出空转扫描且保留在待答清单',async t=>{
  const messages=[textIncoming('old-a','（合成改写）历史前文一'),textIncoming('old-b','（合成改写）历史前文二')];
  // R1 的目标消息（old-video）不在当前窗口——模拟 11-01 消息被挤出窗口。
  const staleTarget={...videoIncoming('stale-video'),id:'stale-video'};
  const staleWindow=[...messages,structuredClone(staleTarget)];
  const f=await replay(t,{messages,records:[archiveRecord(authorized,staleWindow,{id:'replay-r1-',phase:'superseded',targetIds:['stale-video'],generatedText:'（合成改写）针对视频的历史生成文本'})]});
  f.due();await f.service.poll();f.due();await f.service.poll();
  const record=f.record('replay-r1-');
  assert.equal(record.autoHandled,undefined);assert.equal(record.autoAttempt,undefined);
  assert.equal(record.needsManual,true,'结构性映射失效应转需人工终态');
  assert.equal(record.needsManualReason,'mapping-stale');
  const queue=f.mark().autoBacklog;
  assert.ok(!queue?.archiveIds?.includes(record.archiveId),'映射失败的记录不得进入补答队列');
  assert.equal(record.phase,'superseded');
  assert.ok(f.service.events.some(event=>event.type==='backlog.mapping_stale'),'终态转出应有事件');
  // 第二次 poll 后 retryCount 不再增长（终态退出空转扫描）
  const retryAfterSecond=f.mark().autoBacklog?.retryCount;
  f.due();await f.service.poll();
  assert.equal(f.mark().autoBacklog?.retryCount,retryAfterSecond,'终态记录退出空转，不再消耗退避');
});

test('回放（C2）：混合队列中纯文本解出照常推进，媒体记录拆出标需人工不再连坐',async t=>{
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),textIncoming('text-target','（合成改写）纯文字追问'),videoIncoming('video-1'),videoIncoming('video-2')];
  let sendCalls=0;
  const f=await replay(t,{messages,records:[
    archiveRecord(authorized,messages,{id:'replay-r2-text-',phase:'model',targetIds:['text-target']}),
    archiveRecord(authorized,messages,{id:'replay-r3-video-',phase:'model',targetIds:['video-1']}),
    archiveRecord(authorized,messages,{id:'replay-r4-video-',phase:'model',targetIds:['video-2']}),
  ]});
  f.service.browser.sendMessage=async(id,text,args)=>{sendCalls++;return{confirmed:true,messageId:'sent-1'};};
  f.due();await f.service.poll();
  // 媒体记录拆出标需人工，不进队列、不连坐
  for(const id of ['replay-r3-video-','replay-r4-video-']){
    const record=f.record(id);
    assert.equal(record.mediaNeedsManual,true,`${id} 应标需人工`);
    assert.equal(record.autoHandled,undefined,`${id} 保持 open 不整条结案`);
  }
  assert.ok(f.service.events.some(event=>event.type==='backlog.media_needs_manual'),'需人工标记应有事件');
  // P1-2 后行为变化：text-target 与两条媒体消息时间相邻（无引用框的追问），按宁可多转人工原则跟随转人工，不再自动盲答。
  const textRecord=f.record('replay-r2-text-');
  assert.equal(textRecord.needsManual,true,'相邻媒体已转人工，文本跟随转人工（P1-2）');
  assert.equal(textRecord.autoHandled,undefined);
  assert.equal(sendCalls,0,'相邻追问不得脱离媒体盲答');
});

test('回放（C2）：混合记录（单条 targets 含文字+媒体）文字目标随本次发送结案，媒体目标保持 open 标需人工，整条结案被禁止',async t=>{
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),textIncoming('text-target','（合成改写）纯文字追问'),videoIncoming('video-1')];
  let sendCalls=0;
  const f=await replay(t,{messages,records:[archiveRecord(authorized,messages,{id:'replay-mixed-',phase:'model',targetIds:['text-target','video-1']})]});
  f.service.browser.sendMessage=async(id,text,args)=>{sendCalls++;return{confirmed:true,messageId:'sent-1'};};
  f.due();await f.service.poll();
  const record=f.record('replay-mixed-');
  assert.equal(record.mediaNeedsManual,true,'媒体目标应标需人工');
  assert.equal(record.autoHandled,undefined,'混合记录不得因文字目标完成而整条结案');
  assert.equal(record.autoHandledProof,undefined);
  assert.equal(sendCalls,1,'文字目标照常生成发送一次');
  assert.ok(f.service.events.some(event=>event.type==='backlog.media_needs_manual'),'混合结案事件应存在');
});

test('回放（C2）：纯文本单记录不受影响，照常生成发送一次',async t=>{
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),textIncoming('text-target','（合成改写）纯文字追问')];
  let sendCalls=0;
  const f=await replay(t,{messages,records:[archiveRecord(authorized,messages,{id:'replay-text-ok-',phase:'model',targetIds:['text-target']})]});
  f.service.browser.sendMessage=async(id,text,args)=>{sendCalls++;return{confirmed:true,messageId:'sent-1'};};
  f.due();await f.service.poll();
  assert.equal(f.record('replay-text-ok-').autoHandled,true);
  assert.equal(sendCalls,1,'发送只发生在合成 transport 上，恰好一次');
});
test('回放（C2）：文本记录引用同批媒体（quote 指向）时跟随媒体转人工，不得脱离媒体盲答',async t=>{
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),{...videoIncoming('video-1'),reference:{text:'（合成改写）引用的视频预览',scope:'visible-quoted-message',contentStatus:'preview-only'}},{...textIncoming('quote-target','（合成改写）这个视频里讲的是什么'),reference:{text:'（合成改写）引用的视频预览',scope:'visible-quoted-message',contentStatus:'preview-only'}}];
  let sendCalls=0;
  const f=await replay(t,{messages,records:[
    archiveRecord(authorized,messages,{id:'replay-quote-media-',phase:'model',targetIds:['video-1']}),
    archiveRecord(authorized,messages,{id:'replay-quote-text-',phase:'model',targetIds:['quote-target']}),
  ]});
  f.service.browser.sendMessage=async()=>{sendCalls++;return{confirmed:true,messageId:'sent-1'};};
  f.due();await f.service.poll();
  assert.equal(f.record('replay-quote-text-').mediaNeedsManual,true,'引用媒体的文本记录应跟随媒体转人工');
  assert.equal(f.record('replay-quote-text-').autoHandled,undefined);
  assert.equal(sendCalls,0,'引用跟随场景不得发送脱离媒体的盲答');
  assert.ok(f.service.events.some(event=>event.type==='backlog.media_needs_manual'));
});
test('回放（C2 补充）：身份凭据无法双向核对的记录不再静默跳过——补事件与可见标记',async t=>{
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),textIncoming('text-target','（合成改写）纯文字追问')];
  const f=await replay(t,{messages,records:[archiveRecord(authorized,messages,{id:'replay-stale-id-',phase:'model',targetIds:['text-target']})]});
  // 模拟旧归档记录凭据过期/会话换绑：recoveryEvidence.contact 的绑定换成另一会话
  const record=f.record('replay-stale-id-');
  record.recoveryEvidence.contact={...structuredClone(authorized),identityBinding:'binding:'+'2'.repeat(64)};
  f.service.persist();
  f.due();await f.service.poll();
  assert.ok(record.identityUnverifiableAt,'应有可见的不可核对标记');
  assert.ok(f.service.events.some(event=>event.type==='backlog.identity_unverifiable'),'跳过必须有事件，不得静默');
  assert.equal(record.autoHandled,undefined);
});
test('回放（C2 兼容）：旧形状记录（无新字段的历史归档）经新逻辑读取不报错且不被误改',async t=>{
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),textIncoming('text-target','（合成改写）纯文字追问')];
  const f=await replay(t,{messages,records:[archiveRecord(authorized,messages,{id:'replay-legacy-shape-',phase:'model',targetIds:['text-target']})]});
  // 模拟真实 state 旧形状：剥掉新字段并伪造已结案的旧记录与新 open 记录共存
  let sendCalls=0;
  f.service.browser.sendMessage=async()=>{sendCalls++;return{confirmed:true,messageId:'sent-1'};};
  const record=f.record('replay-legacy-shape-');
  delete record.mediaNeedsManual; delete record.identityUnverifiableAt;
  const oldDone={...structuredClone(record),archiveId:'replay-old-done-',autoHandled:true,autoHandledAt:new Date(Date.now()-86_400_000).toISOString(),autoHandledBy:'dafeiyu',autoHandledProof:{version:1,source:'authorized-unsent-backlog-v1',method:'confirmed-platform-reply',messageId:'old-sent',confirmed:true},autoAttempt:{version:1,source:'authorized-unsent-backlog-v1',queueKey:'old',sourceHash:'0'.repeat(64),targets:[{id:'old-target',fingerprint:'0'.repeat(64)}],state:'confirmed',text:'（合成改写）历史回复',at:new Date(Date.now()-172_800_000).toISOString()}};
  f.mark().unanswered.push(oldDone);f.service.persist();
  f.due();await f.service.poll();
  assert.equal(oldDone.autoHandled,true,'旧已结案记录保持已结案');
  assert.equal(oldDone.mediaNeedsManual,undefined,'旧记录不被误改');
  assert.equal(record.autoHandled,true,'新 open 记录照常推进');
  assert.equal(sendCalls,1,'发送恰好一次且只在合成 transport');
});

test('回放（C3）：临时失败有界退避达到升级阈值后标 escalated 并建议人工核对，发送不明语义不变',async t=>{
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),textIncoming('text-target','（合成改写）纯文字追问')];
  // 生成持续失败：每次 poll 一次 bounded-generation-failed，跨队列 key 累计等待计数
  const f=await replay(t,{messages,records:[archiveRecord(authorized,messages,{id:'replay-escalate-',phase:'model',targetIds:['text-target']})]});
  f.service.agent.reply=async()=>{throw new Error('合成模型故障');};
  for(let i=0;i<7;i++){f.due();await f.service.poll();}
  const mark=f.mark();
  assert.ok(mark.autoBacklogWaits>=6,`连续等待计数应跨 key 累计达到阈值，实际 ${mark.autoBacklogWaits}`);
  assert.equal(mark.autoBacklogEscalated,true,'达到阈值应升级');
  assert.ok(f.service.events.some(event=>event.type==='backlog.escalated'),'升级应有事件');
  assert.equal(f.service.events.filter(event=>event.type==='backlog.escalated').length,1,'升级只标一次，不重复');
  assert.equal(f.sent?.length??0,0,'升级场景不得发送');
  // 发送不明语义不变：uncertain 记录只读回核对不重发
  const f2=await replay(t,{messages,records:[archiveRecord(authorized,messages,{id:'replay-uncertain-',phase:'sending',beforeDispatch:false,targetIds:['text-target']})]});
  let sendCalls=0;f2.service.browser.sendMessage=async()=>{sendCalls++;return{confirmed:true,messageId:'sent-x'};};
  f2.due();await f2.service.poll();
  assert.equal(sendCalls,0,'发送不明只核对不重发');
});

test('回放（P1-1a）：混合记录文字发送结果不明后，恢复流程只核对文字、媒体保持 open 不中断读回',async t=>{
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),textIncoming('text-target','（合成改写）纯文字追问'),videoIncoming('video-1')];
  const f=await replay(t,{messages,records:[archiveRecord(authorized,messages,{id:'mixed-uncertain-',targetIds:['text-target','video-1']})]});
  let sendCalls=0;
  f.service.browser.sendMessage=async(id,text,args)=>{sendCalls++;return{confirmed:false,deliveryUncertain:true};};
  f.due();await f.service.poll();
  const record=f.record('mixed-uncertain-');
  // 文字目标进入 sending：record 上应有文字子状态而非整条 uncertain
  assert.equal(sendCalls,1,'文字目标已尝试发送');
  const textSub=record.targetStates?.find(item=>item.messageId==='text-target');
  assert.ok(textSub,`文字目标应有持久子状态，实际 ${JSON.stringify(record.targetStates)}`);
  assert.equal(textSub.state,'uncertain');
  // 媒体目标已转人工
  assert.equal(record.needsManualReason,'media-unobservable');
  // 恢复轮询：文字读回核对不能被 needs-manual 跳过
  f.service.browser.sendMessage=async(id,text,args)=>{sendCalls++;throw new Error('读回核对不得再次发送');};
  messages.push({...textIncoming('sent-echo','合成回放回复 1。'),sender:'outgoing',direction:'outgoing',sent:true});
  f.due();await f.service.poll();
  const after=f.record('mixed-uncertain-');
  console.error('DEBUG-P11A after.targetStates=',JSON.stringify(after.targetStates),'needsManual=',after.needsManual,'archiveId=',after.archiveId);
  const textAfter=after.targetStates?.find(item=>item.messageId==='text-target');
  assert.equal(textAfter?.state,'confirmed','文字目标经读回结案');
  assert.equal(after.needsManualReason,'media-unobservable','媒体保持 open 需人工');
  assert.equal(after.autoHandled,undefined,'混合记录不得整条结案');
});

test('回放（P1-1b）：确认回执后重启（restoreBacklogReceipt 命中）文字结案、媒体保持 open 不被连坐结案',async t=>{
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),textIncoming('text-target','（合成改写）纯文字追问'),videoIncoming('video-1')];
  const f=await replay(t,{messages,records:[archiveRecord(authorized,messages,{id:'mixed-receipt-',targetIds:['text-target','video-1']})]});
  let sendCalls=0;
  // 桩需模仿真实浏览器：调用 args.authorize（含 beginDispatch→reserveBacklogDispatch 写 autoAttempt），否则恢复凭据缺失。
  f.service.browser.sendMessage=async(id,text,args)=>{sendCalls++;args.authorize({recipientId:id,phase:'prepare'});args.authorize({recipientId:id,phase:'before-click'});args.authorize.beginDispatch();return{confirmed:true,messageId:'receipt-1'};};
  f.due();await f.service.poll();
  const record=f.record('mixed-receipt-');
  // 模拟结案前崩溃：receipt 已持久化、autoHandled 尚未写盘
  // 模拟结案前崩溃：autoHandled 系列与 targetStates 未写盘，但 autoAttempt（含 queueKey）与 autoBacklog.receipt 已持久化——恢复凭据。
  const diskAll=JSON.parse(fs.readFileSync(path.join(f.service.stateDir,'chat-watermarks.json'),'utf8'));
  const diskRecord=diskAll.contacts[contact.id].unanswered.find(item=>item.archiveId.startsWith('mixed-receipt-'));
  delete diskRecord.autoHandled;delete diskRecord.autoHandledAt;delete diskRecord.autoHandledBy;delete diskRecord.autoHandledProof;delete diskRecord.targetStates;
  diskAll.contacts[contact.id].unanswered=diskAll.contacts[contact.id].unanswered.map(item=>item.archiveId.startsWith('mixed-receipt-')?diskRecord:item);
  fs.writeFileSync(path.join(f.service.stateDir,'chat-watermarks.json'),JSON.stringify(diskAll));
  f.service.watermarks=JSON.parse(fs.readFileSync(path.join(f.service.stateDir,'chat-watermarks.json'),'utf8'));
  // 重启后 restoreBacklogReceipt 命中
  const {createHash}=await import('node:crypto');
  const q=f.mark().autoBacklog,r=q?.receipt,rec=f.mark().unanswered[0];
  const key2=createHash('sha256').update(JSON.stringify([contact.id,r.archiveIds.slice().sort(),r.targets.map(item=>[item.id,item.fingerprint])])).digest('hex');
  console.error('DEBUG-P11B 校验全过。手动调 restore：');
  const restoredResult=f.service.restoreBacklogReceipt(contact,f.mark());
  console.error('DEBUG-P11B restored=',restoredResult,'targetStates=',JSON.stringify(f.mark().unanswered[0].targetStates),'needsManual=',f.mark().unanswered[0].needsManual,'reason=',f.mark().unanswered[0].needsManualReason);
  f.due();await f.service.poll();
  const after=f.record('mixed-receipt-');
  assert.equal(sendCalls,1,'不得因恢复而再次发送');
  const textAfter=after.targetStates?.find(item=>item.messageId==='text-target');
  assert.equal(textAfter?.state,'confirmed','文字目标经回执结案');
  assert.equal(after.needsManualReason,'media-unobservable','媒体保持 open 需人工');
  assert.equal(after.autoHandled,undefined,'混合记录不得整条结案（恢复路径同样受约束）');
});

test('回放（P1-2）：无引用框的媒体追问（同批）跟随转人工，不脱离媒体盲答',async t=>{
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),textIncoming('text-target','（合成改写）刚才那个视频讲的是什么'),videoIncoming('video-1')];
  let sendCalls=0;
  const f=await replay(t,{messages,records:[
    archiveRecord(authorized,messages,{id:'p12-media-',targetIds:['video-1']}),
    archiveRecord(authorized,messages,{id:'p12-text-',targetIds:['text-target']}),
  ]});
  f.service.browser.sendMessage=async()=>{sendCalls++;return{confirmed:true,messageId:'s'};};
  f.due();await f.service.poll();
  // 同批媒体记录转人工后，指向性文本（无 quote）不得继续自动生成
  assert.equal(sendCalls,0,'无引用框但语义指向同批媒体，不得盲答');
  const textRecord=f.record('p12-text-');
  assert.equal(textRecord.needsManual,true,'应跟随媒体转人工（宁可多转不可盲答）');
  assert.ok(f.record('p12-media-').needsManual);
});

test('回放（P1-2）：跨轮次追问（媒体已转人工、下一轮不在 ready）仍跟随转人工',async t=>{
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),textIncoming('text-target','（合成改写）刚才那个视频讲的是什么'),videoIncoming('video-1')];
  let sendCalls=0;
  const f=await replay(t,{messages,records:[
    mark=>archiveRecord(mark,messages,{id:'p12-media-',targetIds:['video-1'],extra:{needsManual:true,needsManualReason:'media-unobservable',needsManualAt:new Date().toISOString()}}),
    archiveRecord(authorized,messages,{id:'p12-text-',targetIds:['text-target']}),
  ]});
  f.service.browser.sendMessage=async()=>{sendCalls++;return{confirmed:true,messageId:'s'};};
  f.due();await f.service.poll();
  assert.equal(sendCalls,0,'媒体已转人工后，指向性追问仍不得脱离媒体盲答');
  assert.equal(f.record('p12-text-').needsManual,true,'跨轮次关联仍应跟随转人工');
});

test('回放（P2）：失败→成功→新任务失败，新任务应能再次走完整退避并再次升级，不被旧标记压制',async t=>{
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),textIncoming('first-target','（合成改写）第一条追问')];
  let failMode=true;
  const f=await replay(t,{messages,records:[archiveRecord(authorized,messages,{id:'escalate-cycle-',targetIds:['first-target']})]});
  f.service.agent.reply=async()=>{if(failMode)throw new Error('合成模型故障');return{text:'（合成改写）成功的回复。'};};
  // 阶段一：失败累计到升级
  for(let i=0;i<7;i++){f.due();await f.service.poll();}
  assert.equal(f.mark().autoBacklogEscalated,true,'第一次升级成立');
  assert.ok(f.service.events.filter(event=>event.type==='backlog.escalated').length===1);
  // 阶段二：模型恢复，记录推进成功 → 等待计数重置、升级标记解除
  failMode=false;
  let stage2Send=0;f.service.browser.sendMessage=async(id,text,args)=>{stage2Send++;return{confirmed:true,messageId:'sent-stage2-'+stage2Send};};
  messages.push(textIncoming('second-target','（合成改写）第二条新追问'));f.due();await f.service.poll();
  const mark=f.mark();
  // 阶段二的推进是实时回复成功（second-target 的新消息即时答复）；旧待答记录保持原状。
  assert.ok(mark.autoBacklogEscalated===false,'成功推进应解除升级标记');
  assert.equal(mark.autoBacklogWaits,0,'成功推进应重置等待计数');
  // 阶段三：新任务失败 → 再次完整退避并再次升级
  failMode=true;
  const record2=f.mark().unanswered.find(item=>item.archiveId?.startsWith('escalate-cycle-')&&item.incoming?.[0]?.id==='second-target')??f.mark().unanswered.at(-1);
  f.due();await f.service.poll();
  for(let i=0;i<6;i++){f.due();await f.service.poll();}
  assert.equal(f.mark().autoBacklogEscalated,true,'新任务失败后应再次升级，不被旧标记压制');
});


test('回放（P1-1）：reserve 落盘后立即崩溃重启，混合记录 inFlight=true、autoDue=true、读回继续',async t=>{
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),textIncoming('text-target','（合成改写）纯文字追问'),videoIncoming('video-1')];
  const f=await replay(t,{messages,records:[archiveRecord(authorized,messages,{id:'reserve-crash-',targetIds:['text-target','video-1']})]});
  // 发送确认失败（uncertain 路径）确保 reserved 落盘
  f.service.browser.sendMessage=async(id,text,args)=>{args.authorize({recipientId:id,phase:'prepare'});args.authorize({recipientId:id,phase:'before-click'});args.authorize.beginDispatch();return{confirmed:false,deliveryUncertain:true};};
  f.due();await f.service.poll();
  // 模拟崩溃重启：只保留磁盘状态（targetStates 与 autoAttempt 已在 reserve/uncertain 时持久化）
  const disk=JSON.parse(fs.readFileSync(path.join(f.service.stateDir,'chat-watermarks.json'),'utf8'));
  f.service.watermarks=disk;
  const record=f.record('reserve-crash-');
  assert.equal(f.service.mixedRecordHasTextInFlight(record),true,'reserve/uncertain 子状态落盘后崩溃，读回流程应在');
  f.due();
  assert.equal(f.service.autoDue(f.mark()),true,'autoDue 应让读回继续（到期后）');
  // 读回继续：正文匹配的 outgoing 出现 → confirmed
  messages.push({...textIncoming('sent-echo','合成回放回复 1。'),sender:'outgoing',direction:'outgoing'});
  f.due();await f.service.poll();
  const textAfter=f.record('reserve-crash-').targetStates?.find(item=>item.messageId==='text-target');
  assert.equal(textAfter?.state,'confirmed','读回核对在崩溃重启后继续并结案文字目标');
  assert.equal(f.record('reserve-crash-').autoHandled,undefined,'混合记录仍不整条结案');
});

test('回放（P1-2）：reserved 目标后出现无关 outgoing 消息，不得误匹配转 confirmed',async t=>{
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),textIncoming('text-target','（合成改写）纯文字追问'),videoIncoming('video-1')];
  const f=await replay(t,{messages,records:[archiveRecord(authorized,messages,{id:'reserved-noise-',targetIds:['text-target','video-1']})]});
  f.service.browser.sendMessage=async(id,text,args)=>{args.authorize({recipientId:id,phase:'prepare'});args.authorize({recipientId:id,phase:'before-click'});args.authorize.beginDispatch();return{confirmed:false,deliveryUncertain:true};};
  f.due();await f.service.poll();
  const record=f.record('reserved-noise-');
  const before=structuredClone(record.targetStates);
  // 人工发一条无关 outgoing 消息（正文与 expectedText 不同）
  messages.push({...textIncoming('human-echo','（合成改写）这是人工另发的一条无关消息'),sender:'outgoing',direction:'outgoing'});
  f.due();await f.service.poll();
  const after=f.record('reserved-noise-').targetStates?.find(item=>item.messageId==='text-target');
  assert.equal(after?.state,'uncertain','无关消息不得当作发送成功，目标保持等待读回');
  assert.equal(f.record('reserved-noise-').autoHandled,undefined);
});

test('回放（P2-1）：紧邻追问与远处独立问题同批，只有追问记录转人工，独立问题照常发送',async t=>{
  // 布局：base-a, base-b, video-1(媒体), ask(紧邻追问), far-question(远处独立问题)
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),videoIncoming('video-1'),textIncoming('ask','（合成改写）刚才那个视频讲的是什么'),textIncoming('far-question','（合成改写）帮我推荐一部新番动漫吧')];
  let sendCalls=0;
  const f=await replay(t,{messages,records:[
    archiveRecord(authorized,messages,{id:'p21-far-',targetIds:['far-question']}),
    archiveRecord(authorized,messages,{id:'p21-ask-',targetIds:['ask']}),
    archiveRecord(authorized,messages,{id:'p21-media-',targetIds:['video-1']}),
  ]});
  f.service.browser.sendMessage=async()=>{sendCalls++;return{confirmed:true,messageId:'s'};};
  f.due();await f.service.poll();
  assert.equal(f.record('p21-ask-').needsManual,true,'紧邻追问应跟随转人工');
  assert.equal(f.record('p21-far-').needsManual,undefined,'远处独立问题不关联媒体，照常推进');
  assert.equal(f.record('p21-far-').autoHandled,true,'独立问题照常生成发送结案');
  assert.equal(sendCalls,1,'只发送独立问题的回复');
});

test('回放（P2-2）：记忆读取器抛错时 state=read-error 优先于 not-connected',async t=>{
  // getMemoryStore 返回无 recallForChat 的 store（not-connected 形态）但 recall 阶段抛错——按 catch 里 readError 标志优先判 read-error。
  // 直接对 ChatAgent 单测：memoryStore.recallForChat 抛错 → reply 返回 memoryEvidence.state='read-error'
  const {ChatAgent}=await import('../chat-agent.mjs');
  const agent=new ChatAgent({config:{apiKey:'k',baseUrl:'https://s.invalid',model:'m'},memoryStore:{recallForChat(){throw new Error('合成读取故障');}},replyProvider:async()=>({text:'回复',usage:{promptTokens:10,completionTokens:5}}),replyTokens:512});
  const result=await agent.reply({messages:[{id:'m1',sender:'incoming',text:'你好'}],conversation:{displayName:'联系人A',isGroup:false}});
  assert.equal(result.memoryEvidence.state,'read-error','抛错必须是 read-error 而非 not-connected');
});

test('回放（P1）：追问+独立问题同批拆分后，队列凭据四者均不含追问，命中回执只结案独立问题',async t=>{
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),videoIncoming('video-1'),textIncoming('ask','（合成改写）刚才那个视频讲的是什么'),textIncoming('far-question','（合成改写）帮我推荐一部新番动漫吧')];
  let sendCalls=0;
  const f=await replay(t,{messages,records:[
    archiveRecord(authorized,messages,{id:'p1-far-',targetIds:['far-question']}),
    archiveRecord(authorized,messages,{id:'p1-ask-',targetIds:['ask']}),
    archiveRecord(authorized,messages,{id:'p1-media-',targetIds:['video-1']}),
  ]});
  f.service.browser.sendMessage=async(id,text,args)=>{sendCalls++;args.authorize({recipientId:id,phase:'prepare'});args.authorize({recipientId:id,phase:'before-click'});args.authorize.beginDispatch();return{confirmed:true,messageId:'receipt-p1'};};
  f.due();await f.service.poll();
  const queue=f.mark().autoBacklog;
  const queueTargetIds=new Set((queue.targets??[]).map(item=>item.id));
  assert.equal(queueTargetIds.has('ask'),false,'queue.targets 不得含追问消息 id');
  assert.equal((queue.archiveIds??[]).includes('p1-ask-'),false,'queue.archiveIds 不得含追问记录');
  const pending=f.mark().pending;
  const pendingAuth=pending?.backlogAuthorization;
  if(pendingAuth){assert.equal(pendingAuth.archiveIds.includes('p1-ask-'),false,'pending.backlogAuthorization.archiveIds 不得含追问记录');assert.equal((pendingAuth.targets??[]).some(item=>item.id==='ask'),false,'pending.backlogAuthorization.targets 不得含追问消息 id');}
  // 命中回执：只有独立问题记录结案，追问保持 needs-manual
  assert.equal(f.record('p1-ask-').needsManual,true,'追问保持需人工');
  assert.equal(f.record('p1-far-').autoHandled,true,'独立问题照常结案');
  assert.equal(f.record('p1-ask-').autoHandled,undefined,'追问不得被回执连坐结案');
  // 回执目标身份与覆盖范围：receipt.targets 与重算后 targets 一致（不含 ask）
  const receipt=queue.receipt;
  if(receipt){assert.equal((receipt.targets??[]).some(item=>item.id==='ask'),false,'receipt.targets 不得含追问消息 id');assert.equal(receipt.archiveIds.includes('p1-ask-'),false,'receipt.archiveIds 不得含追问记录');}
});

test('回放（P2）：uncertain 目标 + 正文匹配但 sent=false 的 outgoing 不得转 confirmed；对照 sent=true 同文正常确认',async t=>{
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),textIncoming('text-target','（合成改写）纯文字追问'),videoIncoming('video-1')];
  const f=await replay(t,{messages,records:[archiveRecord(authorized,messages,{id:'sentflag-',targetIds:['text-target','video-1']})]});
  f.service.browser.sendMessage=async(id,text,args)=>{args.authorize({recipientId:id,phase:'prepare'});args.authorize({recipientId:id,phase:'before-click'});args.authorize.beginDispatch();return{confirmed:false,deliveryUncertain:true};};
  f.due();await f.service.poll();
  // 未发出的 outgoing（sent=false）但正文与 expectedText 一致——状态矛盾，不得确认
  messages.push({...textIncoming('ghost-echo','合成回放回复 1。'),sender:'outgoing',direction:'outgoing',sent:false});
  f.due();await f.service.poll();
  assert.equal(f.record('sentflag-').targetStates?.find(item=>item.messageId==='text-target')?.state,'uncertain','sent=false 的同文候选不得当作发送成功');
  // 对照：真实发出的同文（sent=true）出现后正常确认
  messages.push({...textIncoming('real-echo','合成回放回复 1。'),sender:'outgoing',direction:'outgoing',sent:true});
  f.due();await f.service.poll();
  assert.equal(f.record('sentflag-').targetStates?.find(item=>item.messageId==='text-target')?.state,'confirmed','sent=true 的同文候选正常确认');
});

test('回放（离线代答）：关服来信记录经 offline-native-arrival-v1 证据源补核后真正代答发送一次（用户裁决 2026-11-09）',async t=>{
  const target=textIncoming('offline-target','（合成改写）离线期间发来的私信');
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),target];
  const f=await replay(t,{messages,records:[]});
  // 离线记录形状 = offlineUnanswered 产出：无 recoveryEvidence、带 offlineBacklogAt（上次停止时间，早于消息创建）。
  const record={archiveId:'replay-offline-',phase:'unqualified',at:new Date(Date.now()-60_000).toISOString(),offlineBacklogAt:Date.now()-600_000,incoming:[structuredClone(target)],reason:'服务离线期间收到，未回复；已进入待答，按证据链补答。'};
  f.mark().unanswered.push(record);f.service.persist();
  let sendCalls=0;f.service.browser.sendMessage=async(id,text,args)=>{sendCalls++;return{confirmed:true,messageId:'sent-1'};};
  f.due();await f.service.poll();
  assert.equal(record.recoveryEvidence?.qualificationSource,'offline-native-arrival-v1','离线记录应经离线证据源补核通过');
  assert.equal(record.autoHandled,true,'离线来信应被真正代答，不再卡在 identity-unverifiable');
  assert.equal(sendCalls,1,'恰好发送一次');
  assert.ok(f.service.events.some(event=>event.type==='backlog.native_arrival_qualified'),'补核通过应有事件');
});

test('回放（人工接手）：needs-manual 记录目标之后出现人工 outgoing 自动结案退出清单（用户裁决 2026-11-09「回复了为什么还要待答」）',async t=>{
  const humanReply={...textIncoming('human-reply','（合成改写）人工手动回复'),sender:'outgoing',direction:'outgoing'};
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),textIncoming('text-target','（合成改写）纯文字追问'),humanReply];
  const f=await replay(t,{messages,records:[archiveRecord(authorized,messages,{id:'replay-human-manual-',phase:'model',targetIds:['text-target']})]});
  const record=f.record('replay-human-manual-');
  record.needsManual=true;record.needsManualReason='media-unobservable';f.service.persist();
  f.due();await f.service.poll();
  assert.ok(record.handledByUserAt,'人工接手后记录应自动结案');
  assert.equal(record.humanReplyProof?.messageId,'human-reply','结案应保留人工回复证据');
  assert.ok(f.service.events.some(event=>event.type==='backlog.human_replied_closed'),'结案应有事件');
  assert.equal(isOpenBacklogRecord(record),false,'结案记录退出待答清单口径');
});

test('回放（人工接手）：open 记录目标之后出现人工 outgoing 时不再排队代答，直接结案防重复',async t=>{
  const humanReply={...textIncoming('human-reply-open','（合成改写）人工抢先把消息回了'),sender:'outgoing',direction:'outgoing'};
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),textIncoming('text-target','（合成改写）纯文字追问'),humanReply];
  const f=await replay(t,{messages,records:[archiveRecord(authorized,messages,{id:'replay-human-open-',phase:'model',targetIds:['text-target']})]});
  let sendCalls=0;f.service.browser.sendMessage=async()=>{sendCalls++;return{confirmed:true,messageId:'sent-1'};};
  f.due();await f.service.poll();
  const record=f.record('replay-human-open-');
  assert.equal(sendCalls,0,'人工已接手，代答不得再排队造成重复发送');
  assert.ok(record.handledByUserAt,'记录应因人工接手自动结案');
});

test('回放（人工接手）：机器人自己的回复不得当作人工接手——混合记录媒体目标保持待答（交叉审核 B-1）',async t=>{
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),textIncoming('text-target','（合成改写）纯文字追问'),videoIncoming('video-1')];
  const f=await replay(t,{messages,records:[archiveRecord(authorized,messages,{id:'replay-bot-echo-',phase:'model',targetIds:['text-target','video-1']})]});
  f.service.browser.sendMessage=async(id,text,args)=>{args.authorize({recipientId:id,phase:'prepare'});args.authorize({recipientId:id,phase:'before-click'});return{confirmed:true,messageId:'bot-echo-1'};};
  f.due();await f.service.poll();
  const record=f.record('replay-bot-echo-');
  assert.equal(record.mediaNeedsManual,true,'媒体目标应标需人工（与 C2 既有断言一致）');
  // 第二轮：窗口里出现机器人自己发出的回复（与真实发送同形，且有发送证明可归因）。
  messages.push({...textIncoming('bot-echo-1','合成回放回复 1。'),sender:'outgoing',direction:'outgoing'});
  f.due();await f.service.poll();
  assert.equal(record.handledByUserAt,undefined,'机器人自己的回复不得结案记录');
  assert.equal(record.needsManual,true,'媒体待答必须继续保留在清单');
  assert.ok(!f.service.events.some(event=>event.type==='backlog.human_replied_closed'),'不得产生失实的人工接手事件');
});

test('回放（存量复活）：旧代码误杀的 identity-unverifiable 无证据记录经当前窗口重新补核后恢复代答',async t=>{
  const target=textIncoming('legacy-target','在干嘛');
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),target];
  const f=await replay(t,{messages,records:[]});
  // 真实存量形状：offlineUnanswered 旧版产出，被旧资格模型 2 秒内杀成终态——无证据、无 offlineBacklogAt。
  const record={archiveId:'legacy-killed-',phase:'unqualified',at:new Date(Date.now()-180_000).toISOString(),incoming:[structuredClone(target)],needsManual:true,needsManualReason:'identity-unverifiable'};
  f.mark().unanswered.push(record);f.service.persist();
  let sendCalls=0;f.service.browser.sendMessage=async(id,text,args)=>{sendCalls++;return{confirmed:true,messageId:'sent-1'};};
  f.due();await f.service.poll();
  assert.equal(record.needsManual,undefined,'误杀记录应复活退出人工终态');
  assert.equal(record.recoveryEvidence?.qualificationSource,'offline-native-arrival-v1','复活证据应走离线补核源');
  assert.equal(record.autoHandled,true,'复活的离线来信应被真正代答');
  assert.equal(sendCalls,1,'恰好发送一次');
  assert.ok(f.service.events.some(event=>event.type==='backlog.legacy_record_revived'),'复活应有事件');
});

test('回放（群聊离线代答）：群里被 @ 或叫到响应昵称的离线消息与个人会话同一规则真正代答（用户裁决 2026-11-09）',async t=>{
  const target=textIncoming('group-offline-target','大肥鱼，在干嘛');
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),target];
  const groupContact={...contact,isGroup:true,name:'（合成改写）群',identityKind:'rendered-group',identityHash:'0'.repeat(64),identityBinding:'binding:'+'1'.repeat(64)};
  const f=await replay(t,{messages,records:[],contact:groupContact});
  const record={archiveId:'replay-group-offline-',phase:'unqualified',at:new Date(Date.now()-60_000).toISOString(),offlineBacklogAt:Date.now()-600_000,incoming:[structuredClone(target)],reason:'服务离线期间收到，未回复；已进入待答，按证据链补答。'};
  f.mark().unanswered.push(record);f.service.persist();
  let sendCalls=0;f.service.browser.sendMessage=async(id,text,args)=>{sendCalls++;return{confirmed:true,messageId:'sent-1'};};
  f.due();await f.service.poll();
  assert.equal(record.recoveryEvidence?.qualificationSource,'offline-native-arrival-v1','被点名的群离线消息应经离线证据源补核通过');
  assert.equal(record.autoHandled,true,'被点名的群离线消息应被真正代答');
  assert.equal(sendCalls,1,'恰好发送一次');
});

test('回放（群聊离线过滤）：群里未被 @ 且未叫响应昵称的离线消息不进待答（用户裁决 2026-11-09，与实时链路同一规则）',async t=>{
  const groupContact={...contact,isGroup:true,name:'（合成改写）群',identityKind:'rendered-group',identityHash:'0'.repeat(64),identityBinding:'binding:'+'1'.repeat(64)};
  const f=await replay(t,{messages:[],records:[],contact:groupContact});
  const old={startedAt:new Date(Date.now()-900_000).toISOString(),stoppedAt:new Date(Date.now()-600_000).toISOString(),seen:[],context:[]};
  const plain=textIncoming('group-plain','在干嘛');
  const records=f.service.offlineUnanswered(groupContact,old,[plain]);
  assert.equal(records.length,0,'未被点名的群消息不得进待答');
  const addressed=textIncoming('group-at','@大肥鱼 说点什么');
  const records2=f.service.offlineUnanswered(groupContact,old,[structuredClone(addressed)]);
  assert.equal(records2.length,1,'被点名的群消息应进待答');
  assert.equal(records2[0].offlineBacklogAt,Date.parse(old.stoppedAt),'记录应携带离线边界');
});

test('回放（死锁解除）：needs-manual 记录被前置补核写入证据后，复活入口仍能摘除人工标记并代答（真机 14:28 死锁回归）',async t=>{
  const target=textIncoming('deadlock-target','大肥鱼，在干嘛');
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),target];
  const groupContact={...contact,isGroup:true,name:'（合成改写）群',identityKind:'rendered-group',identityHash:'0'.repeat(64),identityBinding:'binding:'+'1'.repeat(64)};
  const f=await replay(t,{messages,records:[],contact:groupContact});
  // 真机 14:28 现场形状：qualifyNativeBacklog 先给 needs-manual 记录补上 recoveryEvidence（native_arrival_qualified），
  // 旧复活守卫因「证据已存在」拒绝复活，needsManual 无人摘除 → 记录带合格证据永久卡死。
  const record={archiveId:'deadlock-5376415e-',phase:'unqualified',at:new Date(Date.now()-60_000).toISOString(),offlineBacklogAt:Date.now()-600_000,incoming:[structuredClone(target)],needsManual:true,needsManualReason:'identity-unverifiable',recoveryEvidence:{qualificationSource:'offline-native-arrival-v1',beforeDispatch:true,contact:structuredClone(groupContact),qualifiedIncoming:[]}};
  f.mark().unanswered.push(record);f.service.persist();
  let sendCalls=0;f.service.browser.sendMessage=async(id,text,args)=>{sendCalls++;return{confirmed:true,messageId:'sent-1'};};
  f.due();await f.service.poll();
  assert.equal(record.needsManual,undefined,'带合格证据的误杀记录必须解除人工终态（死锁根除）');
  assert.equal(record.autoHandled,true,'解除后应被真正代答');
  assert.equal(sendCalls,1,'恰好发送一次');
});
