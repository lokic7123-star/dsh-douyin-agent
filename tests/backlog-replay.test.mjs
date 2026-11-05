import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {ChatService} from '../chat-service.mjs';
import {messageFingerprint,messageContent} from '../chat-message.mjs';

// C1 隔离回放基建：R1–R6 脱敏失败案例的合成重建（来源：docs/backlog-forensics.md A 节结构关系）。
// 全部消息文本为合成改写；id 为合成短 id；不包含任何真实联系人、真实消息原文或真实标识。
// 驱动真实 processAutoBacklog 状态机，断言逐记录结局；本文件不含任何真实发送路径（发送只发生在合成 transport 上）。

const contact={id:'conv:'+'0'.repeat(64),name:'联系人A',isGroup:false,followed:null,relationshipStatus:'unavailable',identityVersion:2,identityKind:'rendered-user',identityHash:'0'.repeat(64),identityBinding:'binding:'+'1'.repeat(64),identityVerified:true,authorizationKind:'existing-conversation'};
// 与 configure 生成的许可条目同形的确定性身份凭据（含 verifiedAt），供归档记录的 recoveryEvidence.contact 使用。
const authorized={id:contact.id,name:contact.name,followed:null,isGroup:false,verifiedAt:'2026-10-01T00:00:00.000Z',authorizationKind:'existing-conversation',identityVerified:true,identityBinding:contact.identityBinding,identityVersion:2,identityKind:contact.identityKind,identityHash:contact.identityHash,relationshipStatus:'unavailable',relationshipEvidence:'本人核对稳定会话身份后明确授权；网页未提供关注关系。'};
const textIncoming=(id,text)=>({id,text,sender:'incoming',direction:'incoming',kind:'text',identitySource:'dom-message-id',eligibleForReply:true,arrivalClassification:'new-tail',latestEndVerified:true,nativeServerMessageBound:true,nativeCreatedAt:new Date(Date.now()-300_000).toISOString(),timestamp:new Date(Date.now()-300_000).toISOString(),dateEvidence:{kind:'absolute'}});
const videoIncoming=id=>({id,text:'',sender:'incoming',direction:'incoming',kind:'video',identitySource:'dom-message-id',eligibleForReply:true,arrivalClassification:'new-tail',latestEndVerified:true,nativeServerMessageBound:true,nativeCreatedAt:new Date(Date.now()-300_000).toISOString(),timestamp:new Date(Date.now()-300_000).toISOString(),dateEvidence:{kind:'absolute'},media:{type:'shared-work',videoId:'1'.repeat(19),url:`https://www.douyin.com/video/${'1'.repeat(19)}`,identityConflict:false}});
function archiveRecord(authorized,messages,{id,phase='model',targetIds,generatedText=undefined,beforeDispatch=true}={}){
  const targets=Array.isArray(targetIds)?targetIds:[targetIds],incoming=[],qualified=[];
  for(const targetId of targets){const message=structuredClone(messages.find(item=>item.id===targetId));incoming.push(message);qualified.push({message,fingerprint:messageFingerprint(message),qualified:true,originalEligibleForReply:true});}
  return{archiveId:id,phase,at:new Date(Date.now()-180_000).toISOString(),skippedAt:new Date(Date.now()-120_000).toISOString(),...(generatedText!==undefined?{generatedText}:{}),incoming,recoveryEvidence:{version:1,beforeDispatch,contact:structuredClone(authorized),qualifiedIncoming:qualified,expectedContent:messageContent(messages),qualifiedAt:new Date(Date.now()-170_000).toISOString(),stopRequestId:null}};
}
async function replay(t,{messages,records}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'backlog-replay-'));
  let modelCalls=0;
  const browser={listContacts:async()=>({contacts:[structuredClone(contact)]}),unreadCounts:async()=>({available:true,counts:{}}),readConversation:async()=>({conversation:{id:contact.id,isGroup:false},contact:structuredClone(contact),messages:structuredClone(messages),dayEvidence:{chronology:'oldest-first',latestEndVerified:true}}),sendMessage:async()=>{throw new Error('回放中不得触发真实发送路径');},close:async()=>{}};
  const agent={replyTokens:512,reply:async value=>{modelCalls++;return{text:`合成回放回复 ${modelCalls}。`};}};
  const service=new ChatService({browser,agent,stateDir:directory,config:{apiKey:'synthetic-key'}});
  await service.configure({recipientIds:[contact.id],allowConversationOnly:true});await service.start({schedule:false});
  // 归档记录的身份凭据必须来自已核对的许可名单（含 verifiedAt），与真实归档链路一致（chat-service recoveryEvidence.contact）。
  const authorized=structuredClone(service.policy.allowlist[0]);
  const markValue=service.watermarks.contacts[contact.id];
  markValue.seen=messages.map(item=>item.id);markValue.unanswered=records.map(item=>typeof item==="function"?item(authorized):{...item,recoveryEvidence:{...item.recoveryEvidence,contact:structuredClone(authorized)}});markValue.pending=null;service.persist();
  t.after(async()=>{await service.close();fs.rmSync(directory,{recursive:true,force:true});});
  const mark=()=>service.watermarks.contacts[contact.id];
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
  // 纯文本记录解出后照常生成发送并结案
  const textRecord=f.record('replay-r2-text-');
  assert.equal(sendCalls,1,'发送只发生在合成 transport 上，恰好一次');
  assert.equal(textRecord.autoHandled,true,'纯文本记录照常结案');
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
