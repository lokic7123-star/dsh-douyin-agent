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

test('回放基线（C1）：R1 历史映射失效记录每轮扫描都不进队列，停在「缺证据无法补答」',async t=>{
  const messages=[textIncoming('old-a','（合成改写）历史前文一'),textIncoming('old-b','（合成改写）历史前文二')];
  // R1 的目标消息（old-video）不在当前窗口——模拟 11-01 消息被挤出窗口。
  const staleTarget={...videoIncoming('stale-video'),id:'stale-video'};
  const staleWindow=[...messages,structuredClone(staleTarget)];
  const f=await replay(t,{messages,records:[archiveRecord(authorized,staleWindow,{id:'replay-r1-',phase:'superseded',targetIds:['stale-video'],generatedText:'（合成改写）针对视频的历史生成文本'})]});
  f.due();await f.service.poll();
  const record=f.record('replay-r1-');
  assert.equal(record.autoHandled,undefined);assert.equal(record.autoAttempt,undefined);
  const queue=f.mark().autoBacklog;
  assert.ok(!queue?.archiveIds?.includes(record.archiveId),'映射失败的记录不得进入补答队列');
  assert.equal(record.phase,'superseded');
});

test('回放基线（C1）：R2/R3 媒体记录与 R4–R6 纯文本记录合并队列，当前行为为整批媒体门槛连坐（C2 将改变）',async t=>{
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),textIncoming('text-target','（合成改写）纯文字追问'),videoIncoming('video-1'),videoIncoming('video-2')];
  const f=await replay(t,{messages,records:[
    archiveRecord(authorized,messages,{id:'replay-r2-text-',phase:'model',targetIds:['text-target']}),
    archiveRecord(authorized,messages,{id:'replay-r3-video-',phase:'model',targetIds:['video-1']}),
    archiveRecord(authorized,messages,{id:'replay-r4-video-',phase:'model',targetIds:['video-2']}),
  ]});
  f.due();await f.service.poll();
  const queue=f.mark().autoBacklog;
  assert.ok(queue,'应构建补答队列');
  assert.equal(queue.reason,'waiting-bounded-generation-evidence','当前行为：混合队列在生成门槛连坐');
  assert.equal(queue.retryCount,1);
  assert.equal(queue.text,null,'不得为混合队列生成回复文本');
  assert.ok([f.record('replay-r2-text-'),f.record('replay-r3-video-'),f.record('replay-r4-video-')].every(record=>record.autoHandled===undefined),'整批保持 open');
  // 三条记录的 targets 都被映射进队列（连坐范围=全部）
  assert.deepEqual(queue.archiveIds.length,3);
});

test('回放基线（C1）：混合记录（单条 targets 含文字+媒体）在当前行为下同样连坐',async t=>{
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),textIncoming('text-target','（合成改写）纯文字追问'),videoIncoming('video-1')];
  const f=await replay(t,{messages,records:[archiveRecord(authorized,messages,{id:'replay-mixed-',phase:'model',targetIds:['text-target','video-1']})]});
  f.due();await f.service.poll();
  const queue=f.mark().autoBacklog;
  assert.equal(queue?.reason,'waiting-bounded-generation-evidence');
  assert.equal(f.record('replay-mixed-').autoHandled,undefined);
});

test('回放基线（C1）：纯文本单记录不受影响，照常生成发送一次',async t=>{
  const messages=[textIncoming('base-a','（合成改写）上下文一'),textIncoming('base-b','（合成改写）上下文二'),textIncoming('text-target','（合成改写）纯文字追问')];
  let sendCalls=0;
  const f=await replay(t,{messages,records:[archiveRecord(authorized,messages,{id:'replay-text-ok-',phase:'model',targetIds:['text-target']})]});
  f.service.browser.sendMessage=async(id,text,args)=>{sendCalls++;return{confirmed:true,messageId:'sent-1'};};
  f.due();await f.service.poll();
  assert.equal(f.record('replay-text-ok-').autoHandled,true);
  assert.equal(sendCalls,1,'发送只发生在合成 transport 上，恰好一次');
});
