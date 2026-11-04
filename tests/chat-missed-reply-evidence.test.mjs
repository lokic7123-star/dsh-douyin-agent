import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {ChatService} from '../chat-service.mjs';
const hashKey='0'.repeat(64);
const contact={id:`conv:${hashKey}`,name:'合成证据好友',isGroup:false,followed:null,relationshipStatus:'unavailable',identityVersion:2,identityKind:'rendered-user',identityHash:hashKey,identityBinding:`binding:${'1'.repeat(64)}`,identityVerified:true,authorizationKind:'existing-conversation'};
const incoming=(id,text='合成消息')=>({id,text,sender:'incoming',direction:'incoming',kind:'text',identitySource:'dom-message-id',eligibleForReply:true,arrivalClassification:'new-tail',latestEndVerified:true,timestamp:new Date().toISOString(),dateEvidence:{kind:'absolute'},nativeServerMessageBound:true,nativeCreatedAt:new Date().toISOString()});
async function fixture(t,{readEvidence=false,pageReadyEvidence=false}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'douyin-evidence-'));
  const messages=[{...incoming('seed-a','启动前甲'),arrivalClassification:'baseline',eligibleForReply:false},{...incoming('seed-b','启动前乙'),arrivalClassification:'baseline',eligibleForReply:false}],sent=[];
  let snapshotExtra=()=>'',sendMessageGuard;
  const browser={listContacts:async()=>({contacts:[structuredClone(contact)]}),unreadCounts:async()=>({available:true,counts:{}}),readConversation:async()=>{const extra=snapshotExtra();return{conversation:{id:contact.id,isGroup:false},contact:structuredClone(contact),messages:structuredClone(messages),dayEvidence:{chronology:'oldest-first',latestEndVerified:true},...extra};},sendMessage:async(id,text,args)=>{if(sendMessageGuard)await sendMessageGuard(args);sent.push({id,text});return{confirmed:true,messageId:'sent-1'};},close:async()=>{}};
  const service=new ChatService({browser,agent:{replyTokens:512,reply:async()=>({text:'合成证据回复。'})},stateDir:directory,config:{apiKey:'synthetic-key'}});
  await service.configure({recipientIds:[contact.id],allowConversationOnly:true});
  if(readEvidence)snapshotExtra=()=>({readEvidence:{pageReady:true,observedAt:new Date().toISOString(),readAt:new Date().toISOString(),messageCount:messages.length,nativeIdCount:messages.length}});
  if(pageReadyEvidence){const withRead=snapshotExtra;snapshotExtra=()=>({...withRead(),pageReadyEvidence:{pageReady:true,pageUrlSource:'专用聊天页消息面板可见',conversationIdentityChecked:true,identitySamples:3,clickSkipped:false}});}
  t.after(async()=>{await service.close();fs.rmSync(directory,{recursive:true,force:true});});
  return{directory,contact,messages,sent,service,snapshotExtra,browser,value:()=>service.state()};
}
test('证据链：带证据快照在首读记录页面就绪、身份核对与读取时间戳',async t=>{
  const f=await fixture(t,{readEvidence:true,pageReadyEvidence:true});await f.service.start({schedule:false});await f.service.poll();
  const event=f.service.events.filter(item=>item.type==='message.read_evidence').at(-1);
  assert.ok(event);assert.equal(event.pageReady,true);assert.equal(event.conversationIdentityChecked,true);assert.equal(event.clickSkipped,false);assert.equal(event.identitySamples,3);assert.ok(event.readAt);assert.equal(event.messageCount,2);assert.equal(event.messageSetChanged,true);
});
test('证据链：浏览器层未提供证据时如实记 null，不冒充已核对',async t=>{
  const f=await fixture(t);await f.service.start({schedule:false});await f.service.poll();
  const event=f.service.events.filter(item=>item.type==='message.read_evidence').at(-1);
  assert.ok(event);assert.equal(event.pageReady,null);assert.equal(event.conversationIdentityChecked,null);
});
test('证据链：消息集合稳定时不再重复记录，新消息到达才记录并标记变化',async t=>{
  const f=await fixture(t,{readEvidence:true,pageReadyEvidence:true});await f.service.start({schedule:false});await f.service.poll();
  const afterFirst=f.service.events.filter(item=>item.type==='message.read_evidence').length;assert.ok(afterFirst>=1);
  f.service.lastFullScanAt=0;await f.service.poll();assert.equal(f.service.events.filter(item=>item.type==='message.read_evidence').length,afterFirst);
  f.messages.push(incoming('fresh-1','新到的合成消息'));f.service.lastFullScanAt=0;await f.service.poll();
  const event=f.service.events.filter(item=>item.type==='message.read_evidence').at(-1);
  assert.equal(event.messageSetChanged,true);assert.equal(event.messageCount,3);
});
test('待答四态：确定未发送的崩溃待答重启后自动恢复只发一次',async t=>{
  const f=await fixture(t,{readEvidence:true});await f.service.start({schedule:false});
  // 模拟崩溃：进程直接死亡，没有经过 stop()，锁里留下已不存在的 pid。
  f.messages.push(incoming('crash-target','崩溃前的新消息'));
  const {messageFingerprint,messageContent}=await import('../chat-message.mjs');
  const target=structuredClone(f.messages.at(-1));
  const mark=f.service.watermarks.contacts[f.contact.id];
  // 真实链路里 pending.recoveryEvidence.contact 来自已核对的许可名单条目（含 verifiedAt）。
  const evidenceContact=structuredClone(f.service.policy.allowlist[0]);
  mark.pending={phase:'model',incoming:[structuredClone(target)],at:new Date().toISOString(),recoveryEvidence:{version:1,beforeDispatch:true,contact:evidenceContact,qualifiedIncoming:[{message:structuredClone(target),fingerprint:messageFingerprint(target),qualified:true,originalEligibleForReply:true}],expectedContent:messageContent(f.messages),qualifiedAt:new Date().toISOString()}};
  f.service.persist();
  const deadPid=process.pid+100000;
  fs.writeFileSync(path.join(f.directory,'chat-loop.lock'),JSON.stringify({pid:deadPid,runId:'crashed-run',heartbeatAt:new Date(Date.now()-60_000).toISOString(),status:'running'}));
  const restarted=new ChatService({browser:f.browser,agent:{replyTokens:512,reply:async()=>({text:'重启后的合成回复。'})},stateDir:f.directory,config:{apiKey:'synthetic-key'}});
  t.after(async()=>{await restarted.close();f.service.loseOwnership();await f.service.close();});
  await restarted.configure({recipientIds:[f.contact.id],allowConversationOnly:true});await restarted.start({schedule:false});await restarted.poll();
  assert.equal(f.sent.length,1);assert.equal(f.sent[0].text,'重启后的合成回复。');
});
test('待答四态：发送不明重启后只读回核对不自动重发',async t=>{
  const f=await fixture(t,{readEvidence:true});await f.service.start({schedule:false});
  const mark=f.service.watermarks.contacts[f.contact.id];
  const target={...structuredClone(f.messages.at(-1)),id:'uncertain-target',text:'发送不明的消息'};
  f.messages.push(target);
  mark.pending={phase:'sending',incoming:[structuredClone(target)],at:new Date().toISOString(),recoveryEvidence:{version:1,beforeDispatch:false,contact:structuredClone(f.contact),qualifiedIncoming:[{message:structuredClone(target),fingerprint:'0'.repeat(64),qualified:true,originalEligibleForReply:true}],expectedContent:[],qualifiedAt:new Date().toISOString()}};
  mark.status='delivery-uncertain';f.service.persist();await f.service.close();
  const restarted=new ChatService({browser:f.browser,agent:{replyTokens:512,reply:async()=>{throw new Error('发送不明时禁止模型');}},stateDir:f.directory,config:{apiKey:'synthetic-key'}});
  t.after(async()=>{await restarted.close();});
  await restarted.configure({recipientIds:[f.contact.id],allowConversationOnly:true});await restarted.start({schedule:false});await restarted.poll();
  assert.equal(f.sent.length,0);assert.ok(restarted.watermarks.contacts[f.contact.id].unanswered.length>=1);
});
test('防重复：恢复发送后水位只记一次，再次轮询不会重发同一消息',async t=>{
  const f=await fixture(t,{readEvidence:true});await f.service.start({schedule:false});
  f.messages.push(incoming('once-target','只应回复一次'));
  const target=structuredClone(f.messages.at(-1)),{messageFingerprint,messageContent}=await import('../chat-message.mjs');
  const mark=f.service.watermarks.contacts[f.contact.id];
  mark.pending={phase:'model',incoming:[structuredClone(target)],at:new Date().toISOString(),recoveryEvidence:{version:1,beforeDispatch:true,contact:structuredClone(f.contact),qualifiedIncoming:[{message:structuredClone(target),fingerprint:messageFingerprint(target),qualified:true,originalEligibleForReply:true}],expectedContent:messageContent(f.messages),qualifiedAt:new Date().toISOString()}};
  f.service.persist();
  await f.service.poll();await f.service.poll();await f.service.poll();
  assert.equal(f.sent.length,1);
  const seen=f.service.watermarks.contacts[f.contact.id].seen;
  assert.equal(seen.filter(id=>id==='once-target').length,1);
});
test('撤权：好友互动开关关闭后 poll 直接停止恢复，不再发送且不再读消息',async t=>{
  const f=await fixture(t,{readEvidence:true});await f.service.start({schedule:false});
  fs.writeFileSync(path.join(f.directory,'friend-interactions-policy.json'),JSON.stringify({version:1,enabled:false}));
  f.messages.push(incoming('revoked-target','撤权后不再回复的新消息'));
  await f.service.poll();
  assert.equal(f.sent.length,0);
  const state=f.service.state();assert.equal(state.running,false);
});
test('身份变化：恢复期间会话身份不匹配时转人工待答，不发送',async t=>{
  const f=await fixture(t,{readEvidence:true});await f.service.start({schedule:false});
  f.messages.push(incoming('identity-target','身份核对前的新消息'));
  const target=structuredClone(f.messages.at(-1)),{messageFingerprint,messageContent}=await import('../chat-message.mjs');
  const mark=f.service.watermarks.contacts[f.contact.id];
  mark.pending={phase:'model',incoming:[structuredClone(target)],at:new Date().toISOString(),recoveryEvidence:{version:1,beforeDispatch:true,contact:structuredClone(f.contact),qualifiedIncoming:[{message:structuredClone(target),fingerprint:messageFingerprint(target),qualified:true,originalEligibleForReply:true}],expectedContent:messageContent(f.messages),qualifiedAt:new Date().toISOString()}};
  // 恢复时对方会话身份已改变：旧待答凭据无法双向核对，须转人工待答而不是发送；新消息先计入水位，只测旧待答不重发。
  mark.pending.recoveryEvidence.contact={...structuredClone(f.contact),identityHash:'e'.repeat(64)};
  mark.seen=[...mark.seen,'identity-target'];
  f.service.persist();
  await f.service.poll();
  assert.equal(f.sent.length,0);
  assert.ok((f.service.watermarks.contacts[f.contact.id].unanswered||[]).some(item=>item.incoming?.some(message=>message.id==='identity-target')||item.incoming?.some(message=>message.text==='身份核对前的新消息')));
});
test('补答等待原因透出：waiting-bounded-generation-evidence 显示给用户而非静默',async t=>{
  const f=await fixture(t,{readEvidence:true});await f.service.start({schedule:false});
  f.messages.push(incoming('stuck-target','为什么会一直卡住'));
  const target=structuredClone(f.messages.at(-1)),{messageFingerprint,messageContent}=await import('../chat-message.mjs');
  const mark=f.service.watermarks.contacts[f.contact.id];
  // 纯媒体目标：有 recoveryEvidence 但 generatedText 为空，进入等待有界生成证据的分支。
  mark.unanswered=[{archiveId:'media-archive',phase:'model',at:new Date().toISOString(),incoming:[structuredClone(target)],recoveryEvidence:{version:1,beforeDispatch:true,contact:structuredClone(f.contact),qualifiedIncoming:[{message:structuredClone(target),fingerprint:messageFingerprint(target),qualified:true,originalEligibleForReply:true}],expectedContent:messageContent(f.messages),qualifiedAt:new Date().toISOString()}}];
  mark.pending=null;f.service.persist();
  const state=f.service.state();
  assert.ok(state.contacts[0].reason.includes('等待')||state.contacts[0].reason.includes('自动整理'),state.contacts[0].reason);
  const queue=f.service.watermarks.contacts[f.contact.id].autoBacklog;
  if(queue?.state==='waiting')assert.ok(state.contacts[0].reason.includes('证据')||state.contacts[0].reason.includes('生成')||state.contacts[0].reason.includes('自动整理'),state.contacts[0].reason);
});
test('接口缺口：/chat/unanswered 带 running 与 worker 标志，state 带 unansweredCount',async t=>{
  const f=await fixture(t,{readEvidence:true});await f.service.start({schedule:false});
  const list=f.service.unanswered();
  assert.equal(typeof list.running,'boolean');assert.ok(list.worker);assert.equal(list.worker.alive,true);assert.ok(['running','starting'].includes(list.worker.status));
  assert.equal(typeof f.service.state().unansweredCount,'number');
});
