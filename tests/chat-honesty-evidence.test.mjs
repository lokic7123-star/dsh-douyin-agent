import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {ChatService} from '../chat-service.mjs';
import {ChatAgent} from '../chat-agent.mjs';
import {messageFingerprint,messageContent} from '../chat-message.mjs';

const contact={id:'conv:'+'0'.repeat(64),name:'联系人A',isGroup:false,followed:null,relationshipStatus:'unavailable',identityVersion:2,identityKind:'rendered-user',identityHash:'0'.repeat(64),identityBinding:'binding:'+'1'.repeat(64),identityVerified:true,authorizationKind:'existing-conversation',verifiedAt:'2026-10-01T00:00:00.000Z'};
const textIncoming=(id,text)=>({id,text,sender:'incoming',direction:'incoming',kind:'text',identitySource:'dom-message-id',eligibleForReply:true,arrivalClassification:'new-tail',latestEndVerified:true,nativeServerMessageBound:true,nativeCreatedAt:new Date(Date.now()-300_000).toISOString(),timestamp:new Date(Date.now()-300_000).toISOString(),dateEvidence:{kind:'absolute'}});
const messages=[textIncoming('m1','（合成改写）你好，最近怎么样？')];
function fixture(t,{memoryEvidence}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'e-section-'));
  const replyProvider=async()=>({text:'（合成改写）挺好的，谢谢关心。',usage:{promptTokens:100,completionTokens:20}});
  const agentOptions={config:{apiKey:'synthetic-key',baseUrl:'https://synthetic.invalid',model:'synthetic-model'},replyProvider,replyTokens:512};
  if(memoryEvidence==='not-connected')Object.assign(agentOptions,{});
  else if(memoryEvidence==='read-error')Object.assign(agentOptions,{memoryStore:{recallForChat(){throw new Error('合成记忆读取故障');}}});
  else if(memoryEvidence==='retrieved')Object.assign(agentOptions,{memoryStore:{recallForChat(){return{entries:[{origin:'qq',id:'e1',status:'confirmed',content:'（合成改写）历史记忆条目一',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',metadata:{role:'user',sourceType:'group'}},{origin:'video',id:'e2',status:'confirmed',content:'（合成改写）历史记忆条目二',createdAt:'2026-01-02T00:00:00.000Z',updatedAt:'2026-01-02T00:00:00.000Z',metadata:{role:'user'}}],sharedPersonaText:''};}}});
  const browser={listContacts:async()=>({contacts:[structuredClone(contact)]}),unreadCounts:async()=>({available:true,counts:{}}),readConversation:{ value(){ return async()=>({conversation:{id:contact.id,isGroup:false},contact:structuredClone(this.allowlistContact),messages:structuredClone(messages),dayEvidence:{chronology:'oldest-first',latestEndVerified:true}}); } }.value(),sendMessage:async(id,text,args)=>{args?.authorize?.({recipientId:id,phase:'prepare'});args?.authorize?.({recipientId:id,phase:'before-click'});args?.authorize?.beginDispatch();return{confirmed:true,messageId:'sent-1'};},close:async()=>{}};
  const service=new ChatService({browser,agent:new ChatAgent(agentOptions),stateDir:directory,config:{apiKey:'synthetic-key'}});
  t.after(async()=>{await service.close();fs.rmSync(directory,{recursive:true,force:true});});
  return{service,directory};
}
async function runReply(t,{memoryEvidence}={}){
  const f=fixture(t,{memoryEvidence});
  await f.service.configure({recipientIds:[contact.id],allowConversationOnly:true});
  // 身份双向核对要求 readConversation 返回的 contact 与许可名单同源（verifiedAt 在 configure 时重打时间戳），
  // 必须在 start 前替换（start 内 assertConversationSnapshot 会立即读回核对）。
  const allowlistContact=structuredClone(f.service.policy.allowlist[0]);
  f.service.browser.readConversation=async()=>({conversation:{id:contact.id,isGroup:false},contact:structuredClone(allowlistContact),messages:structuredClone(messages),dayEvidence:{chronology:'oldest-first',latestEndVerified:true}});
  await f.service.start({schedule:false});
  const mark=f.service.watermarks.contacts[contact.id];
  // 实时路径：seen 不含 m1 → poll 发现新消息 → 直接生成回复 → reply.sent。
  mark.seen=[];mark.unanswered=[];mark.pending=null;f.service.persist();
  await f.service.poll();
  const event=f.service.events.find(item=>item.type==='reply.sent');
  if(!event)console.error('DEBUG-E4 events=',f.service.events.map(item=>item.type).join(','),'status=',mark.status,'reason=',String(mark.reason||'').slice(0,80));
  return{f,event};
}

test('E-4：reply.sent 带记忆未接入态 memoryEvidence（state=not-connected）',async t=>{
  const {event}=await runReply(t,{memoryEvidence:'not-connected'});
  assert.ok(event,'reply.sent 事件应存在');
  assert.ok(event.memoryEvidence,'事件应带 memoryEvidence 字段');
  assert.equal(event.memoryEvidence.state,'not-connected');
  assert.equal(event.memoryEvidence.recalledCount,0);
  assert.deepEqual(event.memoryEvidence.originKinds,[]);
  assert.equal(JSON.stringify(event.memoryEvidence).includes('历史记忆条目'),false,'不得带记忆原文');
});

test('E-4：reply.sent 带记忆读取失败态 memoryEvidence（state=read-error）',async t=>{
  const {event}=await runReply(t,{memoryEvidence:'read-error'});
  assert.ok(event.memoryEvidence,'读取失败也应有 memoryEvidence（不得静默装作未接入）');
  assert.equal(event.memoryEvidence.state,'read-error');
  assert.equal(event.memoryEvidence.recalledCount,0);
});

test('E-4：reply.sent 带正常检索态 memoryEvidence（state=retrieved 含命中数与来源 kind）',async t=>{
  const {event}=await runReply(t,{memoryEvidence:'retrieved'});
  assert.equal(event.memoryEvidence.state,'retrieved');
  assert.equal(event.memoryEvidence.recalledCount,2,'命中数应真实');
  assert.deepEqual(event.memoryEvidence.originKinds,['qq','video'],'来源 kind 列表应真实');
  assert.equal(JSON.stringify(event.memoryEvidence).includes('历史记忆条目'),false,'不得带记忆原文');
});

test('E-2：PROMPT 诚实性条目——不断言未上线，保留如实陈述空间与未命中口径',async t=>{
  const source=fs.readFileSync(new URL('../chat-agent.mjs',import.meta.url),'utf8');
  assert.match(source,/不得断言它"未上线、未安装、未验收或没在运行"/,'不得断言正在使用的系统未上线');
  assert.match(source,/我这边感知不到|说不准/,'不确定时用感知不到口径');
  assert.match(source,/我这边没有接入\/读不到/,'确实未接入时保留如实陈述空间');
  assert.match(source,/这次没查到相关记忆/,'记忆未命中时如实说');
  assert.match(source,/不把未命中解释成整个记忆系统没在运行/,'未命中不得外推为系统未运行');
});
