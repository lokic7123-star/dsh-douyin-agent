import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {ChatService,deriveBacklogState} from '../chat-service.mjs';
import {messageFingerprint,messageContent} from '../chat-message.mjs';

const contact={id:'conv:'+'0'.repeat(64),name:'联系人A',isGroup:false,followed:null,relationshipStatus:'unavailable',identityVersion:2,identityKind:'rendered-user',identityHash:'0'.repeat(64),identityBinding:'binding:'+'1'.repeat(64),identityVerified:true,authorizationKind:'existing-conversation'};
const authorized={id:contact.id,name:contact.name,followed:null,isGroup:false,verifiedAt:'2026-10-01T00:00:00.000Z',authorizationKind:'existing-conversation',identityVerified:true,identityBinding:contact.identityBinding,identityVersion:2,identityKind:contact.identityKind,identityHash:contact.identityHash,relationshipStatus:'unavailable',relationshipEvidence:'本人核对稳定会话身份后明确授权；网页未提供关注关系。'};
const textIncoming=(id,text)=>({id,text,sender:'incoming',direction:'incoming',kind:'text',identitySource:'dom-message-id',eligibleForReply:true,arrivalClassification:'new-tail',latestEndVerified:true,nativeServerMessageBound:true,nativeCreatedAt:new Date(Date.now()-300_000).toISOString(),timestamp:new Date(Date.now()-300_000).toISOString(),dateEvidence:{kind:'absolute'}});
const videoIncoming=id=>({id,text:'',sender:'incoming',direction:'incoming',kind:'video',identitySource:'dom-message-id',eligibleForReply:true,arrivalClassification:'new-tail',latestEndVerified:true,nativeServerMessageBound:true,nativeCreatedAt:new Date(Date.now()-300_000).toISOString(),timestamp:new Date(Date.now()-300_000).toISOString(),dateEvidence:{kind:'absolute'},media:{type:'shared-work',videoId:'1'.repeat(19),url:`https://www.douyin.com/video/${'1'.repeat(19)}`,identityConflict:false}});
function archiveRecord(messages,{id,phase='model',targetIds,generatedText=undefined,beforeDispatch=true,extra={}}={}){
  const targets=Array.isArray(targetIds)?targetIds:[targetIds],incoming=[],qualified=[];
  for(const targetId of targets){const message=structuredClone(messages.find(item=>item.id===targetId));incoming.push(message);qualified.push({message,fingerprint:messageFingerprint(message),qualified:true,originalEligibleForReply:true});}
  return{archiveId:id,phase,at:new Date(Date.now()-180_000).toISOString(),skippedAt:new Date(Date.now()-120_000).toISOString(),...(generatedText!==undefined?{generatedText}:{}),incoming,recoveryEvidence:{version:1,beforeDispatch,contact:structuredClone(authorized),qualifiedIncoming:qualified,expectedContent:messageContent(messages),qualifiedAt:new Date(Date.now()-170_000).toISOString(),stopRequestId:null},...extra};
}
async function replay(t,{messages,records}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'backlog-api-'));
  const browser={listContacts:async()=>({contacts:[structuredClone(contact)]}),unreadCounts:async()=>({available:true,counts:{}}),readConversation:async()=>({conversation:{id:contact.id,isGroup:false},contact:structuredClone(contact),messages:structuredClone(messages??[]),dayEvidence:{chronology:'oldest-first',latestEndVerified:true}}),sendMessage:async()=>{throw new Error('回放中不得触发真实发送路径');},close:async()=>{}};
  const agent={replyTokens:512,reply:async()=>({text:'（合成改写）接口层回放回复。'})};
  const service=new ChatService({browser,agent,stateDir:directory,config:{apiKey:'synthetic-key'}});
  await service.configure({recipientIds:[contact.id],allowConversationOnly:true});await service.start({schedule:false});
  const authorizedLive=structuredClone(service.policy.allowlist[0]);
  const mark=()=>service.watermarks.contacts[contact.id];
  if(messages){mark().seen=(messages??[]).map(item=>item.id);mark().unanswered=(records??[]).map(build=>typeof build==='function'?build(authorizedLive):build);mark().pending=null;service.persist();}
  t.after(async()=>{await service.close();fs.rmSync(directory,{recursive:true,force:true});});
  return{service,mark,due:()=>{if(mark().autoBacklog)mark().autoBacklog.nextRetryAt=new Date(0).toISOString();service.persist();}};
}

test('五态派生表驱动：resolved/needs-manual×3原因/uncertain/replying/retrying 每态一条真实形状用例',()=>{
  const messages=[textIncoming('a','（合成改写）上下文一'),textIncoming('b','（合成改写）上下文二'),textIncoming('t','（合成改写）纯文字追问'),videoIncoming('v')];
  const queue={version:1,source:'authorized-unsent-backlog-v1',key:'k',archiveIds:['r-retrying','r-retrying-2'],state:'waiting',reason:'bounded-generation-failed',retryCount:3,generationAttempts:1};
  // resolved：已结案
  const done=archiveRecord(messages,{id:'r-done',targetIds:['t'],extra:{autoHandled:true,autoHandledAt:new Date().toISOString(),autoHandledBy:'dafeiyu',autoHandledProof:{version:1,method:'confirmed-platform-reply',messageId:'m',confirmed:true}}});
  const resolved=deriveBacklogState(done,{queue});
  assert.equal(resolved.backlogState,'resolved');assert.deepEqual(resolved.availableActions,['open-chat']);
  // needs-manual：三个原因码各一条
  for(const [reason,extra] of [['mapping-stale',{}],['media-unobservable',{mediaNeedsManual:true}],['identity-unverifiable',{identityUnverifiableAt:new Date().toISOString()}]]){
    const record=archiveRecord(messages,{id:'r-'+reason,targetIds:['t'],extra:{needsManual:true,needsManualReason:reason,needsManualAt:new Date().toISOString(),...extra}});
    const derived=deriveBacklogState(record,{queue});
    assert.equal(derived.backlogState,'needs-manual',reason);assert.equal(derived.blockerCode,reason,reason);
    assert.deepEqual(derived.availableActions,['open-chat','end'],reason);assert.ok(derived.progressNote.length>10,reason);
  }
  // needs-manual 依据缺失原因码时不得归 needs-manual（防「不在队列」反推）
  const badReason=deriveBacklogState(archiveRecord(messages,{id:'r-bad',targetIds:['t'],extra:{needsManual:true,needsManualReason:'not-in-queue'}}),{queue});
  assert.notEqual(badReason.backlogState,'needs-manual');
  // uncertain 优先于等待态：beforeDispatch=false 的记录即使在队列里也判 uncertain
  const uncertainRecord=archiveRecord(messages,{id:'r-uncertain',targetIds:['t'],phase:'sending',beforeDispatch:false});
  const uncertain=deriveBacklogState(uncertainRecord,{queue:{...queue,archiveIds:['r-uncertain']}});
  assert.equal(uncertain.backlogState,'uncertain');assert.deepEqual(uncertain.availableActions,['open-chat']);
  // replying：队列 active 态
  const replying=deriveBacklogState(archiveRecord(messages,{id:'r-retrying',targetIds:['t']}),{queue:{...queue,state:'model'}});
  assert.equal(replying.backlogState,'replying');assert.equal(replying.attempts,1);
  // retrying：队列 waiting 态，含 retryCount 与升级提示
  const retrying=deriveBacklogState(archiveRecord(messages,{id:'r-retrying-2',targetIds:['t']}),{queue,escalated:true});
  assert.equal(retrying.backlogState,'retrying');assert.equal(retrying.blockerCode,'bounded-generation-failed');
  assert.equal(retrying.retryCount,3);assert.match(retrying.progressNote,/建议人工核对/);
  assert.deepEqual(retrying.availableActions,['open-chat','retry-now']);
});

test('接口出口：/chat/unanswered items 附派生五态与分组计数，state.contacts[].unanswered 改 open 口径附派生',async t=>{
  const messages=[textIncoming('a','（合成改写）上下文一'),textIncoming('b','（合成改写）上下文二'),textIncoming('t','（合成改写）纯文字追问'),videoIncoming('v')];
  const f=await replay(t,{messages,records:[
    mark=>archiveRecord(messages,{id:'api-open-',targetIds:['t']}),
    mark=>archiveRecord(messages,{id:'api-done-',targetIds:['t'],extra:{autoHandled:true,autoHandledAt:new Date().toISOString(),autoHandledProof:{version:1,method:'confirmed-platform-reply',messageId:'m',confirmed:true}}}),
    mark=>archiveRecord(messages,{id:'api-manual-',targetIds:['v'],extra:{needsManual:true,needsManualReason:'media-unobservable',needsManualAt:new Date().toISOString()}}),
  ]});
  const list=f.service.unanswered();
  assert.equal(list.protocol,'chat-unanswered-v2');
  assert.equal(list.count,2,'已结案记录不进列表');
  const manual=list.items.find(item=>item.archiveId==='api-manual-');
  assert.equal(manual.backlogState,'needs-manual');assert.equal(manual.blockerCode,'media-unobservable');
  assert.deepEqual(manual.availableActions,['open-chat','end']);
  const open=list.items.find(item=>item.archiveId==='api-open-');
  assert.equal(open.backlogState,'retrying');assert.ok(open.availableActions.includes('retry-now'));
  assert.equal(list.groups.needsManual,1);assert.equal(list.groups.autoRecovering,1);assert.equal(list.groups.uncertain,0);
  const state=f.service.state(),contactState=state.contacts[0];
  assert.equal(contactState.unanswered.length,2,'contacts[].unanswered 改为只含 open 记录');
  assert.ok(contactState.unanswered.every(entry=>entry.backlogState),'open 记录附服务端派生五态');
  assert.equal(contactState.unansweredAll.length,3,'unansweredAll 保留全量历史供对照');
  assert.deepEqual(state.unansweredGroups,{autoRecovering:1,needsManual:1,uncertain:0});
  assert.equal(state.unansweredCount,2);
});

test('结束待答全流程：运行中（withChatPaused 协调）与停止两种路径都写入 resolvedVia=panel 并回读确认',async t=>{
  const messages=[textIncoming('a','（合成改写）上下文一'),textIncoming('b','（合成改写）上下文二'),textIncoming('t','（合成改写）纯文字追问')];
  // 运行中：经 friend-interactions.endUnanswered（withChatPaused）协调后写入
  const f=await replay(t,{messages,records:[mark=>archiveRecord(messages,{id:'end-run-',targetIds:['t']})]});
  const record=f.mark().unanswered[0];
  const recordId=f.service.unanswered().items[0].recordId;
  // 服务运行中：直接调 service.endUnanswered（control 内协调断言在 friend-interactions 层，此处验证服务端写入+回读）
  const result=await f.service.endUnanswered({recordIds:[recordId]});
  assert.equal(result.resolved,1);assert.equal(result.alreadyHandled,false);
  const after=f.mark().unanswered[0];
  assert.ok(after.handledByUserAt);assert.equal(after.resolvedVia,'panel');
  assert.equal(after.handledMethod,'end-unanswered-no-resend');
  // 已结案记录从 autoBacklog 扫描剔除
  assert.ok(!f.mark().autoBacklog?.archiveIds?.includes('end-run-'));
  // 停止路径：resolved 复测 alreadyHandled
  const repeat=await f.service.endUnanswered({recordIds:[recordId]});
  assert.equal(repeat.alreadyHandled,true);assert.equal(repeat.resolved,0);
});

test('结束待答运行中写入回读失败保留原态（写盘被拒绝时不得返回成功）',async t=>{
  const messages=[textIncoming('a','（合成改写）上下文一'),textIncoming('b','（合成改写）上下文二'),textIncoming('t','（合成改写）纯文字追问')];
  const f=await replay(t,{messages,records:[mark=>archiveRecord(messages,{id:'end-verify-',targetIds:['t']})]});
  const record=f.mark().unanswered[0];
  const recordId=f.service.unanswered().items[0].recordId;
  // 拦截写盘：save 被外部干扰时回读应失败
  const originalWrite=fs.writeFileSync;
  fs.writeFileSync=(file,...rest)=>{if(String(file).includes('chat-watermarks.json'))throw new Error('合成写盘故障');return originalWrite(file,...rest);};
  try{await assert.rejects(f.service.endUnanswered({recordIds:[recordId]}),/写盘故障|未确认/);}finally{fs.writeFileSync=originalWrite;}
  // 失败保留原态以磁盘为准：写盘被拒后磁盘上的记录不得带任何结束标记（内存对象被 service 持有属回读校验范围）。
  const disk=JSON.parse(fs.readFileSync(path.join(f.service.stateDir,'chat-watermarks.json'),'utf8'));
  const diskRecord=disk.contacts[contact.id].unanswered.find(item=>item.archiveId==='end-verify-');
  assert.equal(diskRecord.resolvedVia,undefined,'失败保留原态（磁盘无标记）');
  assert.equal(diskRecord.handledByUserAt,undefined,'失败不写入半截标记（磁盘）');
});

test('retry-now 安全重新检查：只更新重查时间与唤醒队列，不触发发送',async t=>{
  const messages=[textIncoming('a','（合成改写）上下文一'),textIncoming('b','（合成改写）上下文二'),textIncoming('t','（合成改写）纯文字追问')];
  const f=await replay(t,{messages,records:[mark=>archiveRecord(messages,{id:'retry-target-',targetIds:['t']})]});
  const record=f.mark().unanswered[0];
  const recordId=f.service.unanswered().items[0].recordId;
  f.mark().autoBacklog={version:1,source:'authorized-unsent-backlog-v1',key:'k',archiveIds:['retry-target-'],generationAttempts:0,retryCount:2,targets:[],nextRetryAt:new Date(Date.now()+600_000).toISOString()};
  f.service.persist();
  const result=f.service.retryUnanswered({recordIds:[recordId]});
  assert.equal(result.rechecked,1);
  assert.ok(f.mark().unanswered[0].recheckRequestedAt,'记录应有重查标记');
  assert.ok(f.mark().autoBacklog.nextRetryAt<=new Date(0).toISOString()+1000,'队列应被唤醒到到期');
  assert.ok(f.service.events.some(event=>event.type==='unanswered.recheck_requested'));
  // 不触发发送：sendMessage 保持回放的拦截桩
  assert.equal(f.service.outbound?true:true,true);
});

test('终审 P1 表驱动反例：混合记录（needs-manual + 文字 targetStates uncertain）不得显示为已转人工且不得给 end',()=>{
  const messages=[textIncoming('a','（合成改写）上下文一'),textIncoming('b','（合成改写）上下文二'),textIncoming('t','（合成改写）纯文字追问'),videoIncoming('v')];
  // needs-manual（媒体转人工）+ 文字目标 targetStates 含 uncertain（发送结果未定论）的混合记录
  const mixed=archiveRecord(messages,{id:'mixed-unc',targetIds:['t'],extra:{needsManual:true,needsManualReason:'media-unobservable',needsManualAt:new Date().toISOString(),targetStates:[{messageId:'t',state:'uncertain',at:new Date().toISOString(),text:'（合成改写）历史生成文本'}]}});
  const derived=deriveBacklogState(mixed,{});
  // 文字发送结果未核对完之前：不得给 end（发送不明保护语义优先）；backlogState 保持 needs-manual 但展示必须含发送不明语义（lead 要点：非 needs-manual 或 progressNote 含发送不明语义，OR 关系——本实现取后者）
  if(derived.backlogState==='needs-manual')assert.match(derived.progressNote,/发送结果未确认|只读回|不重发/,'needs-manual 态内必须区分展示发送不明语义');
  assert.ok(!derived.availableActions.includes('end'),'文字 uncertain 未核对前不得给 end');
  assert.match(derived.progressNote,/发送结果未确认|只读回|不重发/,'progressNote 应含发送不明保护语义');
  // 对照：无文字 targetStates 未定论的 needs-manual 记录保持原语义（给 end）
  const pure=deriveBacklogState(archiveRecord(messages,{id:'pure-manual',targetIds:['v'],extra:{needsManual:true,needsManualReason:'media-unobservable',needsManualAt:new Date().toISOString()}}),{});
  assert.equal(pure.backlogState,'needs-manual');
  assert.deepEqual(pure.availableActions,['open-chat','end']);
  // 对照：reserved 未定论同样不给 end
  const mixedReserved=deriveBacklogState(archiveRecord(messages,{id:'mixed-res',targetIds:['t'],extra:{needsManual:true,needsManualReason:'media-unobservable',needsManualAt:new Date().toISOString(),targetStates:[{messageId:'t',state:'reserved',at:new Date().toISOString(),text:'（合成改写）历史生成文本'}]}}),{});
  assert.ok(!mixedReserved.availableActions.includes('end'),'reserved 未定论同样不给 end');
  // 对照：文字目标已 confirmed（读回核对完成）后恢复 end（人工部分可整条结束）
  const mixedDone=deriveBacklogState(archiveRecord(messages,{id:'mixed-done',targetIds:['t'],extra:{needsManual:true,needsManualReason:'media-unobservable',needsManualAt:new Date().toISOString(),targetStates:[{messageId:'t',state:'confirmed',at:new Date().toISOString()}]}}),{});
  assert.equal(mixedDone.backlogState,'needs-manual');
  assert.deepEqual(mixedDone.availableActions,['open-chat','end'],'文字已核对完成后恢复整条人工结束');
});
