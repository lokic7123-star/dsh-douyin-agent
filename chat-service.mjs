import { readFriendInteractionsEnabled, acquireFriendInteractionDispatch } from './friend-interactions-guard.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { resolveRuntimePaths } from './runtime-paths.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { ChatAgent, normalizeChatReplyText } from './chat-agent.mjs?v=9';
import { loadApiConfig, redact } from './api-agent.mjs';
import { messageFingerprint, messageContent, messageWatermark, compareMessageWatermark, isOpenBacklogRecord, mapBacklogMessages, backlogOutgoingReadback, validBacklogQualification, qualifyNativeUnanswered } from './chat-message.mjs';
import { OutboundCoordinator } from './outbound-send.mjs';
import { canAuthorizeConversation, hasStableConversationIdentity, isStoredContactAuthorized, matchesAuthorizedContact, upgradeAuthorizedContact } from './contact-authorization.mjs';
import { groupMessageAddressesFish, normalizeMentionNames } from './group-reply-trigger.mjs';
import { isMetadataMessage, isReplyableMessage } from './chat-message.mjs';
import { ChatOutputAssets } from './chat-output.mjs';
import { GroupVideoInbox } from './group-video-inbox.mjs';

const basePolicy = () => ({ version: 1, enabled: false, allowlist: [], dailyReplyLimit: null });
const dayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const load = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
const alive = (pid) => { if (!Number.isSafeInteger(pid) || pid < 1) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
function save(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(temporary, file); }
function initialize(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); let descriptor; try { descriptor = fs.openSync(file, 'wx', 0o600); } catch (error) { if (error.code === 'EEXIST') return; throw error; } try { fs.writeFileSync(descriptor, JSON.stringify(value, null, 2)); } finally { fs.closeSync(descriptor); } }
function recentEvents(file) {
  if (!fs.existsSync(file)) return [];
  const descriptor = fs.openSync(file, 'r');
  try { const size = fs.fstatSync(descriptor).size; const length = Math.min(size, 65_536); const buffer = Buffer.alloc(length); fs.readSync(descriptor, buffer, 0, length, size - length); const lines = buffer.toString('utf8').split('\n'); if (size > length) lines.shift(); return lines.filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }).slice(-30); }
  finally { fs.closeSync(descriptor); }
}
function validatePolicy(policy) {
  if(!policy||policy.version!==1||typeof policy.enabled!=='boolean')throw new Error('私信许可记录损坏，已阻止自动回复。');
  if (!Array.isArray(policy.allowlist) || new Set(policy.allowlist.map((item) => item?.id)).size !== policy.allowlist.length) throw new Error('许可名单须为不同的个人或群聊会话，不能重复选择。');
  for (const item of policy.allowlist) if (!isStoredContactAuthorized(item)) throw new Error('许可名单必须有已核对的关注关系，或本人明确授权的个人、群聊会话身份。');
  return { ...policy, dailyReplyLimit: null, groupMentionNames: normalizeMentionNames(policy.groupMentionNames) };
}
function messagesOf(snapshot) {
  if (snapshot?.loginRequired || snapshot?.verificationRequired || snapshot?.blocked) throw Object.assign(new Error('抖音账号暂需登录或验证，回复队列继续保留。'), { code: 'CHAT_ACCOUNT_ACTION_REQUIRED', needsUserAction: true });
  if (!Array.isArray(snapshot?.messages)) throw new Error('没有读到可靠的私信消息列表。');
  const messages = snapshot.messages.map((message) => ({ ...structuredClone(message), sender: message.sender || message.direction }));
  if (messages.some((message) => typeof message.id !== 'string' || !message.id || !['incoming', 'outgoing', 'unknown'].includes(message.sender))) throw new Error('私信消息缺少稳定 ID 或方向，未回复。');
  return messages;
}
function assertConversationSnapshot(contact, snapshot) {
  if (!matchesAuthorizedContact(contact, snapshot?.contact) || snapshot?.conversation?.id !== contact.id) throw new Error('会话身份或许可绑定回读不一致，已暂停。');
  if (typeof snapshot.conversation.isGroup === 'boolean' && snapshot.conversation.isGroup !== contact.isGroup) throw new Error('会话类型回读不一致，已暂停。');
}
function verifiedAuthorizedContact(stored, current) {
  if (stored.authorizationKind === 'manual') {
    if (!matchesAuthorizedContact(stored, current)) throw new Error('人工授权会话的显示名或类型已变化，已暂停。');
    return { ...stored, name: current.name || current.displayName || stored.name };
  }
  if (!hasStableConversationIdentity(current)) throw new Error('未读到许可会话可靠的稳定身份，未继续自动回复；请本人重新核对授权。');
  const upgraded = upgradeAuthorizedContact(stored, current);
  if (!upgraded) throw new Error('许可会话的稳定身份尚未核对，旧关注名单不能自动迁移；请本人重新核对授权。');
  return upgraded;
}
const contentOf=messages=>messages.map(message=>({id:message.id,fingerprint:messageFingerprint(message)}));
const unresolvedManual=mark=>mark.accountActionRequired===true?1:0;
const autoPendingCount=mark=>(mark.unanswered||[]).filter(isOpenBacklogRecord).length+(['inflight','delivery-uncertain'].includes(mark.status)&&mark.pending?.incoming?.length&&!mark.pending.backlogAuthorization?1:0);
const unansweredReason=item=>typeof item?.reason==='string'&&item.reason.trim()?item.reason.trim().slice(0,200):({
  unqualified:'新消息尚未取得可靠的新到达资格，未自动回复。',
  'unsupported-media':'消息附件未能可靠读取，未推断内容。',
  'not-sent':'发送前检查未通过，未发送。',
  'stopped-before-send':'停止前未发送，保留待核对。',
  'delivery-uncertain':'发送结果未确认，未自动重发。',
  model:'回复尚未发送，保留待核对。',
  observing:'回复尚未发送，保留待核对。',
  superseded:'生成期间到达新消息或人工回复，本次未发送。',
}[item?.phase]||'这条消息没有完成自动回复，保留待核对。');
const messageKind=message=>message?.media?.type==='voice'?'语音':message?.media?.type==='image'?'图片':message?.media?.type==='emoji'?'表情':message?.media?.type==='shared-work'?'分享作品':message?.unsupported===true?'不支持的消息':typeof message?.text==='string'&&message.text.trim()?'文字':'未知类型';
// D1 记录级五态派生（服务端算好，前端不复刻规则）。needs-manual 必须依据明确原因码，uncertain 优先于普通等待态。
const needsManualReasonText={'mapping-stale':'消息证据已失效（消息被挤出当前窗口或上下文不可核对），无法自动补答，需人工处理。','media-unobservable':'该待答含媒体内容（媒体观察不持久化，自动补答无法重看画面），需人工查看后处理。','identity-unverifiable':'该待答的身份凭据无法与当前会话核对，需重新核对该会话后处理。'};
const progressNoteText={'waiting-bounded-generation-evidence':'正在等待可生成回复的上下文证据。','waiting-backlog-evidence-or-outgoing':'正在补答证据核对。','waiting-archive-identity':'正在核对记录标识。','waiting-target-context-capacity':'正在核对上下文容量。','waiting-context-after-bounded-generation':'该上下文的生成次数已达上限，稍后自动重试。','waiting-generated-text':'正在等待生成的回复文本。','bounded-generation-failed':'上次自动生成失败，稍后自动重试。','waiting-native-outgoing-readback':'正在读回已发出的消息以确认发送结果。','waiting-zero-click-retry':'上次未能点击发送，稍后自动重试。','waiting-contact-recheck':'正在等待重新核对该会话。','waiting-reliable-conversation':'正在等待可核对的会话快照。','waiting-media-manual':'该批待答含需人工处理的媒体内容。'};
export function deriveBacklogState(record,{queue,escalated=false}={}){
  if(!record||record.autoHandled===true||record.handledByUserAt||record.resolvedVia)return{backlogState:'resolved',progressNote:'已回复或已结束，不会再自动回复。',availableActions:['open-chat'],blockerCode:null,attempts:0};
  const isUncertain=Boolean(record.legacyUncertain===true||record.recoveryEvidence?.beforeDispatch===false||['sending','delivery-uncertain'].includes(record.phase)||['reserved','uncertain'].includes(record.autoAttempt?.state)||(record.targetStates??[]).some(item=>['reserved','uncertain'].includes(item.state)));
  if(record.needsManual===true&&typeof record.needsManualReason==='string'&&['mapping-stale','media-unobservable','identity-unverifiable'].includes(record.needsManualReason)){
    // 终审 P1 发送不明保护语义优先：混合记录或旧格式/身份核对记录只要存在发送未定论（targetStates/autoAttempt/phase/beforeDispatch 等既有判据），
    // progressNote 写明未定论语义，availableActions 绝对不给 end（核对完前不允许整条人工结束）；
    // 待文字目标全部核对完成（confirmed/zero-click 等终态）且无其他发送不明证据后，恢复整条人工结束。
    if(isUncertain){
      const pendingTextState=(record.targetStates??[]).find(item=>['reserved','uncertain'].includes(item.state));
      const note=record.needsManualReason==='media-unobservable'&&pendingTextState
        ?'媒体部分已转人工；文字部分发送结果未确认，只读回核对，不会自动重发——文字核对完成前不能整条结束。'
        :`${needsManualReasonText[record.needsManualReason]} 发送结果未确认，只读回核对，不会自动重发——${pendingTextState?'文字核对完成':'人工核实送达'}前不能整条结束。`;
      const blocker=record.autoAttempt?.state==='uncertain'||pendingTextState?'readback-uncertain':'delivery-uncertain';
      return{backlogState:'needs-manual',progressNote:note,availableActions:['open-chat'],blockerCode:blocker,attempts:0,textReadbackPending:Boolean(pendingTextState)};
    }
    return{backlogState:'needs-manual',progressNote:needsManualReasonText[record.needsManualReason],availableActions:['open-chat','end'],blockerCode:record.needsManualReason,attempts:0};
  }
  if(isUncertain)return{backlogState:'uncertain',progressNote:'发送结果未确认，只读回核对，不会自动重发；请人工核对是否已送达。',availableActions:['open-chat'],blockerCode:record.autoAttempt?.state==='uncertain'||(record.targetStates??[]).some(item=>['reserved','uncertain'].includes(item.state))?'readback-uncertain':'delivery-uncertain',attempts:0};
  const inQueue=Boolean(queue&&Array.isArray(queue.archiveIds)&&queue.archiveIds.includes(record.archiveId));
  const attempts=Number.isSafeInteger(record.autoBacklog?.generationAttempts)||Number.isSafeInteger(queue?.generationAttempts)?(record.autoBacklog?.generationAttempts??queue?.generationAttempts??0):0;
  const retryCount=queue?.retryCount??0;
  if(inQueue&&['model','sending','ready'].includes(queue.state))return{backlogState:'replying',progressNote:'正在自动补答本次待答。',availableActions:['open-chat'],blockerCode:null,attempts,retryCount,escalated};
  if(inQueue){const note=progressNoteText[queue.reason]||'自动整理进行中。';return{backlogState:'retrying',progressNote:escalated?`${note}已连续多次等待，建议人工核对。`:note,availableActions:['open-chat','retry-now'],blockerCode:queue.reason,attempts,retryCount,escalated};}
  return{backlogState:'retrying',progressNote:'待答已进入自动整理队列，等待下一轮核对。',availableActions:['open-chat','retry-now'],blockerCode:'not-in-queue',attempts,retryCount,escalated};
}
const unansweredRecordId=(contactId,item)=>createHash('sha256').update(JSON.stringify([contactId,item?.archiveId?['archive',item.archiveId]:['legacy',item?.phase||'',item?.skippedAt||null,item?.at||null,(item?.incoming||[]).map(message=>({id:message?.id||'',kind:message?.kind||null,type:message?.type||null,media:message?.media?.type||null}))]])).digest('hex');
function unansweredItems(watermarks,policy){const items=[];for(const contact of policy.allowlist){const mark=watermarks.contacts?.[contact.id];for(const item of mark?.unanswered||[])items.push({contact,item,recordId:unansweredRecordId(contact.id,item)});}return items;}
function unansweredSnapshot(items){return createHash('sha256').update(items.filter(entry=>isOpenBacklogRecord(entry.item)).map(entry=>entry.recordId).sort().join('\n')).digest('hex');}
function unansweredPreview(item){const messages=Array.isArray(item?.incoming)?item.incoming:[];const text=messages.find(message=>typeof message?.text==='string'&&message.text.trim());if(text)return{preview:text.text.trim().slice(0,160),previewNote:'本地保留的文字预览，仅用于核对；不会自动补发。'};const kinds=[...new Set(messages.map(messageKind))];return{preview:null,previewNote:kinds.length?`${kinds.join('、')}消息没有可显示的文字正文，未做识别或猜测。`:'本地没有这条消息的可显示内容，未做识别或猜测。'};}

function maintenanceActive(stateDir){try{const value=load(path.join(stateDir,'friend-interactions-policy.json'),{version:1,enabled:true});return value?.version===1&&value.enabled===true&&fs.existsSync(path.join(stateDir,'friend-interactions-settings.guard'));}catch{return false;}}
function revokeError(stateDir,phase){const maintenance=maintenanceActive(stateDir);return Object.assign(new Error(maintenance?'正在维护好友名单，发送已暂缓。':'好友互动开关或回复许可已撤回，未继续发送。'),{code:maintenance?'CHAT_MAINTENANCE_REVOKED':'CHAT_INTERACTIONS_REVOKED',safeBeforeDispatch:phase==='prepare'});}
function allowMaintenanceRecovery(pending){if(pending?.recoveryEvidence?.beforeDispatch===true){pending.restartAllowed=true;pending.recoveryExpiresAt??=Date.now()+5*60_000;}}
// 待答发送状态四态：certain-unsent=确定未发送（发送前阶段且保留完整 beforeDispatch 证据，且用户停止时未明确要求不恢复）；
// sending/inflight=正在发送；uncertain=发送不明（已可能点击发送或进入自动补答队列）；confirmed=已确认送达（无待答）。
// 只有 certain-unsent 且回读资格仍有效才自动恢复；uncertain 只读回核对，不自动重发。
const certainUnsentPhases=['outbound-wait','observing','model','superseded','stopped-before-send','unqualified'];
const certainUnsentPending=pending=>Boolean(pending&&certainUnsentPhases.includes(pending.phase)&&pending.recoveryEvidence?.beforeDispatch===true&&!pending.backlogAuthorization&&pending.restartAllowed!==false);
const backlogWaitReason=code=>({'waiting-reliable-conversation':'等待可核对的会话快照','waiting-backlog-evidence-or-outgoing':'等待补答证据或排除已回复可能','waiting-archive-identity':'等待待答记录标识核对','waiting-bounded-generation-evidence':'等待可生成回复的上下文证据','waiting-target-context-capacity':'等待上下文容量核对','waiting-context-after-bounded-generation':'该上下文的生成次数已达上限，稍后自动重试','waiting-generated-text':'等待生成的回复文本','bounded-generation-failed':'上次自动生成失败，稍后自动重试','waiting-native-outgoing-readback':'正在读回已发出的消息以确认发送结果','waiting-zero-click-retry':'上次未能点击发送，稍后自动重试','waiting-contact-recheck':'等待重新核对该会话'}[code]||'自动整理进行中');
function archivePending(mark,pending,reason,{handledByUserAt}={}) {
  if(!pending)return;
  mark.unanswered||=[];const archiveKey=JSON.stringify([pending.phase,pending.incoming||[]]);const existing=mark.unanswered.find(item=>item.archiveKey===archiveKey&&!item.handledByUserAt);if(existing){if(handledByUserAt)existing.handledByUserAt=handledByUserAt;return;}
  mark.unanswered.push({...structuredClone(pending),archiveId:randomUUID(),archiveKey,skippedAt:new Date().toISOString(),reason,...(handledByUserAt?{handledByUserAt}:{})});
}
function recoveryEvidence(contact,incoming,messages,prior,stopRequest) {
  if(!incoming.length)return null;
  const qualifiedIncoming=incoming.map(message=>{const qualified=message.eligibleForReply===true||prior?.qualifiedIncoming?.some(item=>item.qualified===true&&item.originalEligibleForReply===true&&item.message?.id===message.id&&item.fingerprint===messageFingerprint(message))===true;return{message:structuredClone(message),fingerprint:messageFingerprint(message),qualified,originalEligibleForReply:qualified};});
  if(qualifiedIncoming.some(item=>!item.qualified||item.message.sender!=='incoming'))return null;
  return{version:1,beforeDispatch:true,contact:structuredClone(contact),qualifiedIncoming,expectedContent:contentOf(messages),qualifiedAt:prior?.qualifiedAt||new Date().toISOString(),stopRequestId:prior?.stopRequestId??stopRequest?.requestId??null};
}
function recoverableIncoming(pending,contact,messages,stopRequest) {
  const evidence=pending?.recoveryEvidence;
  if(!pending?.restartAllowed||!Number.isFinite(pending.recoveryExpiresAt)||pending.recoveryExpiresAt<Date.now()||evidence?.version!==1||evidence.beforeDispatch!==true||!matchesAuthorizedContact(evidence.contact,contact)||!matchesAuthorizedContact(contact,evidence.contact)||!Array.isArray(evidence.qualifiedIncoming)||!evidence.qualifiedIncoming.length||JSON.stringify(evidence.expectedContent)!==JSON.stringify(contentOf(messages))||messages.some(item=>item.sender==='unknown'))return null;
  if(stopRequest&&stopRequest.preservePending!==true&&stopRequest.requestId!==evidence.stopRequestId)return null;
  const incoming=[];
  for(const item of evidence.qualifiedIncoming){const current=messages.find(value=>value.id===item.message?.id);if(item.qualified!==true||item.originalEligibleForReply!==true||!current||current.sender!=='incoming'||item.fingerprint!==messageFingerprint(current))return null;incoming.push(current);}
  const last=messages.findLastIndex(item=>incoming.some(value=>value.id===item.id));if(last<0||messages.slice(last+1).some(item=>item.sender==='outgoing'))return null;
  return incoming;
}

function referencedSharedWork(contact, incoming, context, messages) {
  if (incoming.some(message => message.media?.type === 'shared-work')) return [];
  const explicitReference = message => typeof message.text === 'string' && /上面|前面|刚才|这个|这条|那条|那个|别人发的|发给你|分享给你/u.test(message.text) && /视频|作品|看|评/u.test(message.text);
  const triggers = incoming.filter(message => explicitReference(message) || typeof message.text === 'string' && !/喜欢什么|看过什么|看什么|什么类型/u.test(message.text) && /(?:看|评).{0,12}(?:视频|作品)|(?:视频|作品).{0,12}(?:怎么|如何|评价)/u.test(message.text));
  if (!triggers.length) return [];
  const known = new Map(context.map(message => [message.id, messageFingerprint(message)]));
  for (const trigger of triggers.slice().reverse()) {
    const index = messages.findIndex(message => message.id === trigger.id);
    for (let prior = index - 1; prior >= Math.max(0, index - 8); prior--) {
      const message = messages[prior];
      if (message.sender === 'outgoing') break;
      if (message.sender !== 'incoming' || message.media?.type !== 'shared-work' || message.unsupported === true || known.has(message.id) && known.get(message.id) !== messageFingerprint(message)) continue;
      if (contact.isGroup === true && (typeof trigger.memberId !== 'string' || !/^member:[a-f0-9]{64}$/.test(trigger.memberId) || typeof message.memberId !== 'string' || !/^member:[a-f0-9]{64}$/.test(message.memberId) || message.memberId !== trigger.memberId && !explicitReference(trigger))) continue;
      return [message];
    }
  }
  return [];
}

function verifiedSharedVideoSample(value, videoId) {
  const observation = value?.observation;
  const frames = (value?.frames ?? []).filter(frame => frame.videoId === videoId && Number.isFinite(frame.time) && frame.time >= observation?.beforeTime - 0.25 && frame.time <= observation?.afterTime + 0.25);
  return value?.state?.video?.id === videoId && observation?.videoId === videoId && observation.beforePaused === false && observation.paused === false
    && Number.isFinite(observation.beforeTime) && Number.isFinite(observation.afterTime) && observation.afterTime > observation.beforeTime + 0.1
    && frames.length >= 2 && frames.some(frame => frame.time > frames[0].time + 0.1);
}

// 沿用视频工具的本机配置与直接 API 请求；私信状态及正文只写本机 state。
export class ChatService {
  constructor({ browser, config = loadApiConfig(), agent = new ChatAgent({ config }), stateDir = resolveRuntimePaths().stateDir, pollIntervalMs = 2_000, fullScanIntervalMs = 60_000, outboundCoordinator, mediaAdapter, observeSharedWork, videoLimits, onPrepared, outputAssets, groupVideoInbox } = {}) {
    if (!browser?.listContacts || !browser?.readConversation || !browser?.sendMessage) throw new Error('缺少私信浏览器控制器。');
    if (observeSharedWork !== undefined && typeof observeSharedWork !== 'function') throw new TypeError('分享作品观察器须为本机函数。');
    if(onPrepared!==undefined&&typeof onPrepared!=='function')throw new TypeError('准备完成回调必须是本机函数。');
    if (videoLimits !== undefined && typeof videoLimits?.state !== 'function') throw new TypeError('分享作品时限须使用本机视频用量服务。');
    Object.assign(this, { browser, config, agent, stateDir, pollIntervalMs, fullScanIntervalMs, mediaAdapter, observeSharedWork, videoLimits, onPrepared });
    this.outputAssets = outputAssets ?? (typeof browser?.sendImageMessage === 'function' ? new ChatOutputAssets() : null);
    this.outbound = outboundCoordinator ?? new OutboundCoordinator({ stateDir, source: browser.controller?.source === 'dsh-chat' ? 'dsh' : 'api' });
    this.policyFile = path.join(stateDir, 'chat-policy.json');
    this.watermarkFile = path.join(stateDir, 'chat-watermarks.json');
    this.logFile = path.join(stateDir, 'chat-events.jsonl');
    this.lockFile = path.join(stateDir, 'chat-loop.lock'); this.stopFile = path.join(stateDir, 'chat-stop.request.json'); this.guardFile = path.join(stateDir, 'chat-control.guard');
    this.policy = validatePolicy(load(this.policyFile, basePolicy()));
    this.watermarks = load(this.watermarkFile, { version: 1, contacts: {}, days: {} });
    this.running = false; this.busy = false; this.timer = null; this.abort = null; this.starting = null; this.runId = null; this.heartbeat = null; this.ownershipLost = false;
    this.pollRequested = false; this.pollScheduled = null; this.incomingPriority = new Set(); this.incomingUnsubscribe = null; this.notificationsTask = null; this.notificationCleanup = null; this.lastFullScanAt = 0; this.unreadProbeUnavailable = false;
    this.events = [];
    this.readEvidence = new Map();
    this.replyQualifications = new Map(); this.supersededQualifications = new Map();
    this.groupVideos = groupVideoInbox ?? (typeof observeSharedWork === 'function' && videoLimits && typeof agent.inspectSharedVideo === 'function' ? new GroupVideoInbox({ stateDir }) : null);
    if (!fs.existsSync(this.watermarkFile)) initialize(this.watermarkFile, this.watermarks);
    if (!fs.existsSync(this.policyFile)) initialize(this.policyFile, this.policy);
  }


  clearReplyQualifications() { this.replyQualifications.clear(); this.supersededQualifications.clear(); }
  qualificationValid(entry, contact, message) {
    return Boolean(entry && entry.runId === this.runId && Number.isFinite(entry.expiresAt) && entry.expiresAt >= Date.now()
      && matchesAuthorizedContact(entry.contact, contact) && matchesAuthorizedContact(contact, entry.contact)
      && entry.message?.id === message?.id && message?.sender === 'incoming' && entry.fingerprint === messageFingerprint(message));
  }
  rememberReplyQualifications(contact, messages) {
    if (!this.running || !this.runId || this.abort?.signal.aborted) return;
    this.assertOwned();
    const policy = validatePolicy(load(this.policyFile, this.policy));
    const authorized = policy.allowlist.find(item => item.id === contact.id);
    if (!readFriendInteractionsEnabled(this.stateDir) || !policy.enabled || !matchesAuthorizedContact(contact, authorized) || !matchesAuthorizedContact(authorized, contact)) {
      this.clearReplyQualifications(); return;
    }
    const now = Date.now(), seen = new Set(this.watermarks.contacts[contact.id]?.seen || []);
    for (const [key, entry] of this.replyQualifications) if (entry.runId !== this.runId || entry.expiresAt < now) this.replyQualifications.delete(key);
    for (const message of messages) {
      if (message.sender !== 'incoming' || message.arrivalClassification !== 'new-tail' || message.eligibleForReply !== true || seen.has(message.id)) continue;
      const key = contact.id + '\0' + message.id, existing = this.replyQualifications.get(key);
      if (existing) {
        if (!this.qualificationValid(existing, contact, message)) this.replyQualifications.delete(key);
        continue;
      }
      this.replyQualifications.set(key, { runId: this.runId, contact: structuredClone(contact), message: structuredClone(message), fingerprint: messageFingerprint(message), qualifiedAt: now, expiresAt: now + 5 * 60_000 });
    }
    const own = [...this.replyQualifications].filter(([, entry]) => entry.contact.id === contact.id);
    while (own.length > 200) this.replyQualifications.delete(own.shift()[0]);
    while (this.replyQualifications.size > 2000) this.replyQualifications.delete(this.replyQualifications.keys().next().value);
  }
  qualifiedEvidence(contact, messages, { includeSeen = false } = {}) {
    const seen = new Set(this.watermarks.contacts[contact.id]?.seen || []), result = [];
    for (const message of messages) {
      if (!includeSeen && seen.has(message.id)) continue;
      const key = contact.id + '\0' + message.id, entry = this.replyQualifications.get(key);
      if (!entry) continue;
      if (!this.qualificationValid(entry, contact, message)) { this.replyQualifications.delete(key); continue; }
      result.push({ message: structuredClone(message), fingerprint: entry.fingerprint, qualified: true, originalEligibleForReply: true });
    }
    return result;
  }
  queueSuperseded(contact, mark, incoming, messages) {
    this.rememberReplyQualifications(contact, messages);
    const prior = mark.pending?.recoveryEvidence;
    const qualified = this.qualifiedEvidence(contact, messages), ids = new Set([...incoming.map(item => item.id), ...qualified.map(item => item.message.id)]);
    const selected = messages.filter(item => ids.has(item.id) && item.sender === 'incoming');
    if (incoming.some(item => !selected.some(current => current.id === item.id && messageFingerprint(current) === messageFingerprint(item)))) throw new Error('待答内容或方向已变化，未保留自动重答资格。');
    const evidence = recoveryEvidence(contact, selected, messages, { ...prior, qualifiedIncoming: [...(prior?.qualifiedIncoming || []), ...qualified] }, load(this.stopFile, null));
    if (!evidence) throw new Error('待答没有完整原始资格证据，未保留自动重答资格。');
    this.supersededQualifications.set(contact.id, { runId: this.runId, contact: structuredClone(contact), expiresAt: Date.now() + 5 * 60_000, qualifiedIncoming: structuredClone(evidence.qualifiedIncoming) });
    mark.pending = { ...mark.pending, phase: 'superseded', incoming: structuredClone(selected), recoveryEvidence: evidence, reason: '生成期间到达新消息或人工回复，本次未发送。' };
    delete mark.retry;
  }
  takeSuperseded(contact, messages) {
    const queued = this.supersededQualifications.get(contact.id); this.supersededQualifications.delete(contact.id);
    if (!queued) return { incoming: [], qualifiedIncoming: [] };
    if (queued.runId !== this.runId || queued.expiresAt < Date.now() || !matchesAuthorizedContact(queued.contact, contact) || !matchesAuthorizedContact(contact, queued.contact)) throw new Error('待答资格已过期或许可身份改变，未自动重答。');
    const incoming = [];
    for (const item of queued.qualifiedIncoming) {
      const current = messages.find(message => message.id === item.message?.id);
      if (item.qualified !== true || item.originalEligibleForReply !== true || !current || current.sender !== 'incoming' || item.fingerprint !== messageFingerprint(current)) throw new Error('待答内容已改变、撤回或方向不明，未自动重答。');
      incoming.push(current);
    }
    return { incoming, qualifiedIncoming: queued.qualifiedIncoming };
  }

  log(type, value = {}) {
    const event = redact({ at: new Date().toISOString(), type, ...value }, [this.config?.apiKey]);
    fs.mkdirSync(this.stateDir, { recursive: true });
    fs.appendFileSync(this.logFile, `${JSON.stringify(event)}\n`, { mode: 0o600 });
    this.events.push(event); if (this.events.length > 100) this.events.shift();
  }
  persist() { if (this.ownershipLost) throw new Error('回复进程已失去锁，未覆盖其他入口的水位。'); if (this.runId) this.assertOwned(); save(this.watermarkFile, this.watermarks); }
  refreshAuthorizedContact(stored, verified) {
    if (JSON.stringify(stored) === JSON.stringify(verified)) return stored;
    return this.control(() => {
      this.assertOwned();
      const policy = validatePolicy(load(this.policyFile, this.policy));
      const index = policy.allowlist.findIndex(item => item.id === stored.id);
      if (index < 0 || JSON.stringify(policy.allowlist[index]) !== JSON.stringify(stored)) throw new Error('核对期间许可名单已变化，未覆盖新设置或继续回复。');
      policy.allowlist[index] = verified;
      this.policy = policy; save(this.policyFile, policy);
      return verified;
    });
  }
  control(action) {
    fs.mkdirSync(this.stateDir, { recursive: true });
    const token = randomUUID(); let descriptor;
    try { descriptor = fs.openSync(this.guardFile, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw Object.assign(new Error('另一个入口正在更新回复锁，或控制锁需要人工核对；未自动删除控制锁。'), { code: 'CHAT_CONTROL_BUSY' }); throw error; }
    try { fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() })); }
    finally { fs.closeSync(descriptor); }
    try { return action(); }
    finally { const current = load(this.guardFile, null); if (current?.token === token && current.pid === process.pid) fs.unlinkSync(this.guardFile); }
  }
  loseOwnership() {
    if (this.ownershipLost) return;
    this.clearReplyQualifications();
    this.ownershipLost = true; this.running = false;
    this.stopPolling(); clearInterval(this.heartbeat); this.heartbeat = null;
    this.abort?.abort(new Error('回复进程已失去 worker 锁，已停止操作。'));
    this.runId = null;
    this.log('worker.ownership_lost', { message: '已停止旧入口，不改新入口的锁、配置或水位。' });
  }
  assertOwned() { const worker = this.worker(); if (!this.runId || worker?.owned !== true || worker.pid !== process.pid) { this.loseOwnership(); throw new Error('回复进程已失去 worker 锁，未继续操作。'); } return worker; }
  worker() {
    try { const worker = load(this.lockFile, null); return worker ? { ...worker, alive: alive(worker.pid), heartbeatFresh: Date.now() - Date.parse(worker.heartbeatAt) < 10_000, owned: worker.runId === this.runId } : null; }
    catch { return fs.existsSync(this.lockFile) ? { alive: Date.now() - fs.statSync(this.lockFile).mtimeMs < 30_000, owned: false, status: 'starting', note: '锁文件尚未写完，暂不启动第二个回复进程。' } : null; }
  }
  acquire() {
    this.control(() => {
      const existing = this.worker();
      if (existing?.alive) throw new Error('另一个入口已经运行私信自动回复；请使用状态或停止工具。');
      if (existing) fs.unlinkSync(this.lockFile);
      const descriptor = fs.openSync(this.lockFile, 'wx', 0o600);
      this.runId = randomUUID(); this.ownershipLost = false;
      try { fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, runId: this.runId, heartbeatAt: new Date().toISOString(), status: 'starting' })); }
      finally { fs.closeSync(descriptor); }
      this.watermarks = load(this.watermarkFile, { version: 1, contacts: {}, days: {} });
      for (const mark of Object.values(this.watermarks.contacts)) if (mark.status === 'inflight') { mark.status = 'delivery-uncertain'; mark.reason = '上次进程在发送确认前结束，请人工核对。'; }
      this.persist();
    });
    this.heartbeat = setInterval(() => {
      try {
        this.assertOwned();
        const request = load(this.stopFile, null);
        if (request?.targetRunId === this.runId && (this.running || this.starting)) this.stop({preservePending:request.preservePending===true,reason:request.reason});
        if (this.runId) this.control(() => { this.assertOwned(); save(this.lockFile, { pid: process.pid, runId: this.runId, heartbeatAt: new Date().toISOString(), status: this.running ? 'running' : this.starting ? 'starting' : 'stopping' }); });
        if (!this.running && !this.busy && !this.starting) this.release();
      } catch (error) { if (error.code !== 'CHAT_CONTROL_BUSY') this.log('worker.control_error', { message: error.message }); }
    }, 1000); this.heartbeat.unref?.();
  }
  release() {
    if (!this.runId || this.busy || this.starting || this.groupVideos?.running) return;
    try { this.control(() => { this.assertOwned(); const policy = validatePolicy(load(this.policyFile, this.policy)); policy.enabled = false; save(this.policyFile, policy); fs.unlinkSync(this.lockFile); }); }
    catch (error) { if (error.code === 'CHAT_CONTROL_BUSY') return; if (this.ownershipLost) return; throw error; }
    clearInterval(this.heartbeat); this.heartbeat = null; this.runId = null;
  }
  state() {
    const worker = this.worker();
    const sharedVideos = this.groupVideos?.state() || (fs.existsSync(path.join(this.stateDir, 'group-video-inbox.json')) ? new GroupVideoInbox({ stateDir: this.stateDir }).state() : undefined);
    if (!worker?.owned) { this.policy = validatePolicy(load(this.policyFile, this.policy)); this.watermarks = load(this.watermarkFile, this.watermarks); this.events = recentEvents(this.logFile); }
    const contacts=Object.entries(this.watermarks.contacts).filter(([id])=>this.policy.allowlist.some(item=>item.id===id)).map(([id,mark])=>{
      // 第③步口径统一：contacts[].unanswered 改为只含 open 记录并附服务端派生五态（消除展示口径分裂）；
      // 历史已结案记录不再混入本字段（与 /api/chat/unanswered 同口径），需要全量历史的场景用该接口。
      const queue=mark.autoBacklog,escalated=mark.autoBacklogEscalated===true;
      const open=(mark.unanswered||[]).filter(isOpenBacklogRecord).map(record=>({archiveId:record.archiveId,phase:record.phase||'unknown',at:record.at||record.skippedAt||null,...deriveBacklogState(record,{queue,escalated})}));
      const groups={autoRecovering:0,needsManual:0,uncertain:0};
      for(const entry of open){const key=entry.backlogState==='replying'||entry.backlogState==='retrying'?'autoRecovering':entry.backlogState==='needs-manual'?'needsManual':entry.backlogState==='uncertain'?'uncertain':null;if(key)groups[key]++;}
      return{id,status:mark.status==='inflight'&&worker?.alive?'inflight':['inflight','delivery-uncertain'].includes(mark.status)?'auto-readback':mark.status,reason:mark.accountActionRequired?mark.reason||'':mark.identityReviewRequired?'会话身份暂未重新核实，正在等待。':mark.autoBacklog?.state==='waiting'&&mark.autoBacklog.reason?`${mark.reason||'正在自动整理待答。'}${backlogWaitReason(mark.autoBacklog.reason)}${mark.autoBacklogEscalated===true?'；已连续多次等待，建议人工核对。':''}；不会自动补发不确定的结果。`:autoPendingCount(mark)?'正在自动整理待答。':mark.reason||'',...(mark.identityReviewRequired?{identityReviewRequired:true}:{}),pending:mark.pending||null,unanswered:open,unansweredAll:mark.unanswered||[],backlogGroups:groups,lastCheckedAt:mark.lastCheckedAt,recovery:{pendingManualCount:unresolvedManual(mark),requiresUserAction:mark.accountActionRequired===true,autoPendingCount:autoPendingCount(mark),autoRetryCount:autoPendingCount(mark)?mark.autoBacklog?.retryCount||0:0,recoverableCount:mark.recoveryQueue||mark.pending?.restartAllowed?1:0}};
    });
    const totals=contacts.reduce((sum,item)=>({autoRecovering:sum.autoRecovering+item.backlogGroups.autoRecovering,needsManual:sum.needsManual+item.backlogGroups.needsManual,uncertain:sum.uncertain+item.backlogGroups.uncertain}),{autoRecovering:0,needsManual:0,uncertain:0});
    const unansweredFingerprint = contacts.flatMap(c => (c.unanswered || []).map(u => `${u.archiveId || ''}:${u.backlogState || ''}${u.escalated ? '!' : ''}`)).sort().join(';') || 'none';
    return { running: this.running || Boolean(worker?.alive && worker.status === 'running'), starting: Boolean(this.starting || worker?.status === 'starting'), busy: this.busy || sharedVideos?.running === true, worker, coordination: { protocol: 'guard-v1', guardPresent: fs.existsSync(this.guardFile) }, pollSeconds: this.pollIntervalMs / 1000, fullScanSeconds: this.fullScanIntervalMs / 1000, replyTokens: this.agent.replyTokens ?? 512, policy: this.policy, daily: { date: dayKey(), requests: this.watermarks.days[dayKey()] ?? 0, limit: null, remaining: null },unansweredCount:totals.autoRecovering+totals.needsManual+totals.uncertain,unansweredGroups:totals,unansweredFingerprint,contacts,recovery:{pendingManualCount:contacts.reduce((sum,item)=>sum+item.recovery.pendingManualCount,0),requiresUserAction:contacts.some(item=>item.recovery.requiresUserAction),autoPendingCount:contacts.reduce((sum,item)=>sum+item.recovery.autoPendingCount,0),autoRetryCount:contacts.reduce((sum,item)=>sum+item.recovery.autoRetryCount,0),recoverableCount:contacts.reduce((sum,item)=>sum+item.recovery.recoverableCount,0)}, ...(sharedVideos ? { sharedVideos } : {}), events: this.events.slice(-30) };
  }
  unanswered() {
    const policy=validatePolicy(load(this.policyFile,this.policy)),watermarks=load(this.watermarkFile,this.watermarks),records=unansweredItems(watermarks,policy).filter(entry=>isOpenBacklogRecord(entry.item));
    records.sort((left,right)=>(Date.parse(left.item.at||left.item.skippedAt)||0)-(Date.parse(right.item.at||right.item.skippedAt)||0)||left.recordId.localeCompare(right.recordId));
    const items=records.map(({contact,item,recordId})=>{const preview=unansweredPreview(item),types=[...new Set((item.incoming||[]).map(messageKind))];const mark=watermarks.contacts?.[contact.id];const derived=deriveBacklogState(item,{queue:mark?.autoBacklog,escalated:mark?.autoBacklogEscalated===true});const nextRetryAt=derived.backlogState==='retrying'&&mark?.autoBacklog?.state==='waiting'&&typeof mark?.autoBacklog?.nextRetryAt==='string'?mark.autoBacklog.nextRetryAt:null;return{recordId,archiveId:item.archiveId||null,contactId:contact.id,contactName:contact.name||'许可会话',at:Number.isFinite(Date.parse(item.at||item.skippedAt))?new Date(item.at||item.skippedAt).toISOString():null,lastCheckedAt:mark?.lastCheckedAt||null,nextRetryAt,reason:redact(unansweredReason(item),[this.config?.apiKey]).slice(0,200),phase:item.phase||'unknown',messageCount:Array.isArray(item.incoming)?item.incoming.length:0,types,...preview,canResolve:true,...derived};});
    const worker=this.worker();
    const groups={autoRecovering:0,needsManual:0,uncertain:0};
    for(const item of items){const key=item.backlogState==='replying'||item.backlogState==='retrying'?'autoRecovering':item.backlogState==='needs-manual'?'needsManual':item.backlogState==='uncertain'?'uncertain':null;if(key)groups[key]++;}
    const today = dayKey();
    let todayAutoResolved = 0, todayManualEnded = 0;
    const historyItems = [];
    for (const contact of policy.allowlist) {
      const mark = watermarks.contacts?.[contact.id];
      for (const item of mark?.unanswered || []) {
        const isAuto = item.autoHandled === true && typeof item.autoHandledAt === 'string' && item.autoHandledAt.startsWith(today);
        const isManual = Boolean(item.handledByUserAt && typeof item.handledByUserAt === 'string' && item.handledByUserAt.startsWith(today));
        if (isAuto) todayAutoResolved++;
        if (isManual) todayManualEnded++;
        if (isAuto || isManual) {
          const at = item.autoHandledAt || item.handledByUserAt;
          const timeStr = at ? new Date(at).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '';
          const methodText = isAuto ? '已自动回复，平台确认送达' : (item.handledNote || '用户已在待答面板人工结束');
          historyItems.push({
            recordId: item.archiveId || item.archiveKey || at,
            contactName: contact.name || '许可会话',
            at,
            timeStr,
            summary: `${contact.name || '许可会话'} · ${methodText}`,
            isAuto,
            isManual
          });
        }
      }
    }
    historyItems.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
    const resolvedHistory = { todayAutoResolved, todayManualEnded, items: historyItems.slice(0, 10) };
    return{protocol:'chat-unanswered-v2',checkedAt:new Date().toISOString(),count:items.length,snapshot:unansweredSnapshot(records),running:Boolean(worker?.alive&&['running','starting'].includes(worker.status)),worker:worker?{alive:worker.alive,status:worker.status,heartbeatAt:worker.heartbeatAt}:null,groups,resolvedHistory,items};
  }
  // D3「结束待答，不再回复」服务端入口：运行中走 withChatPaused 协调在途任务，写入→persist→回读确认→才返回成功。
  async endUnanswered({recordIds,snapshot}={},{reason='panel'}={}){
    if(!Array.isArray(recordIds)||!recordIds.length||recordIds.length>200||recordIds.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))||new Set(recordIds).size!==recordIds.length)throw Object.assign(new Error('待处理消息标识无效。'),{status:400});
    if(snapshot!==undefined&&(typeof snapshot!=='string'||!/^[a-f0-9]{64}$/.test(snapshot)))throw Object.assign(new Error('待处理列表快照无效。'),{status:400});
    const apply=()=>{
      this.policy=validatePolicy(load(this.policyFile,this.policy));this.watermarks=load(this.watermarkFile,this.watermarks);
      const all=unansweredItems(this.watermarks,this.policy),byId=new Map(all.map(entry=>[entry.recordId,entry])),targets=recordIds.map(id=>byId.get(id));
      if(targets.some(entry=>!entry))throw Object.assign(new Error('待处理消息不存在或已更新，请刷新列表。'),{status:404});
      const open=targets.filter(entry=>isOpenBacklogRecord(entry.item));
      if(!open.length)return{resolved:0,alreadyHandled:true,checkedAt:new Date().toISOString()};
      for(const entry of open){
        const queue=this.watermarks.contacts?.[entry.contact.id]?.autoBacklog;
        const escalated=this.watermarks.contacts?.[entry.contact.id]?.autoBacklogEscalated===true;
        const derived=deriveBacklogState(entry.item,{queue,escalated});
        if(!derived.availableActions.includes('end'))throw Object.assign(new Error('待答消息发送结果尚未确认，只读回核对，不能人工结束。'),{status:400});
      }
      if(snapshot!==undefined&&snapshot!==unansweredSnapshot(all))throw Object.assign(new Error('待处理列表已变化，请刷新后确认；新到达的消息不会被本次处理。'),{status:409});
      const at=new Date().toISOString();
      for(const {item} of open){item.handledByUserAt=at;item.handledBy='user';item.handledMethod='end-unanswered-no-resend';item.handledNote='用户在待答面板结束该待答，不再回复。';item.resolvedVia=reason;delete item.needsManual;}
      for(const contactId of [...new Set(open.map(entry=>entry.contact.id))]){const mark=this.watermarks.contacts[contactId];if(mark?.autoBacklog&&Array.isArray(mark.autoBacklog.archiveIds)){mark.autoBacklog.archiveIds=mark.autoBacklog.archiveIds.filter(id=>!open.some(entry=>entry.item.archiveId===id));if(!mark.autoBacklog.archiveIds.length)mark.autoBacklog=null;}}
      save(this.watermarkFile,this.watermarks);
      // 回读确认：从磁盘重新加载核对标记在位，失败则保留原态报错。
      const verified=load(this.watermarkFile,this.watermarks);
      for(const {item,contact} of open){const stored=verified.contacts?.[contact.id]?.unanswered?.find(entry=>entry.archiveId===item.archiveId);if(!stored?.handledByUserAt||stored.resolvedVia!==reason)throw Object.assign(new Error('结束待答写入未确认，记录保持原状，请重试。'),{status:500});}
      return{resolved:open.length,alreadyHandled:false,checkedAt:at};
    };
    const active=Boolean(this.running||this.starting||this.busy||this.worker()?.alive);
    const result=active?await this.control(apply):this.control(apply);
    this.log('unanswered.ended',{recordIds,resolved:result.resolved,via:reason,message:'用户在待答面板结束待答，不再回复；结束后的记录不进入补答扫描。'});
    return result;
  }
  // retry-now 安全重新检查：只触发重新映射核对并更新状态与事件，不调用发送。
  retryUnanswered({recordIds}={}){
    if(!Array.isArray(recordIds)||!recordIds.length||recordIds.length>50||recordIds.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id)))throw Object.assign(new Error('待处理消息标识无效。'),{status:400});
    return this.control(()=>{
      this.policy=validatePolicy(load(this.policyFile,this.policy));this.watermarks=load(this.watermarkFile,this.watermarks);
      const all=unansweredItems(this.watermarks,this.policy),byId=new Map(all.map(entry=>[entry.recordId,entry])),targets=recordIds.map(id=>byId.get(id));
      if(targets.some(entry=>!entry))throw Object.assign(new Error('待处理消息不存在或已更新，请刷新列表。'),{status:404});
      const at=new Date().toISOString();
      for(const {item,contact} of targets){if(!isOpenBacklogRecord(item))continue;item.recheckRequestedAt=at;}
      for(const contactId of [...new Set(targets.filter(entry=>isOpenBacklogRecord(entry.item)).map(entry=>entry.contact.id))]){const mark=this.watermarks.contacts[contactId];if(mark?.autoBacklog?.nextRetryAt)mark.autoBacklog.nextRetryAt=new Date(0).toISOString();}
      save(this.watermarkFile,this.watermarks);
      this.log('unanswered.recheck_requested',{recordIds,message:'请求安全重新检查待答：仅重新映射核对并更新状态，不直接发送。'});
      return{rechecked:targets.filter(entry=>isOpenBacklogRecord(entry.item)).length,checkedAt:at};
    });
  }
  markUnansweredHandled({recordIds,snapshot}={}) {
    if(this.running||this.starting||this.busy||this.worker()?.alive)throw Object.assign(new Error('请先停止自动回复，再标记待处理消息。'),{status:409});
    if(!Array.isArray(recordIds)||!recordIds.length||recordIds.length>200||recordIds.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))||new Set(recordIds).size!==recordIds.length)throw Object.assign(new Error('待处理消息标识无效。'),{status:400});
    if(snapshot!==undefined&&(typeof snapshot!=='string'||!/^[a-f0-9]{64}$/.test(snapshot)))throw Object.assign(new Error('待处理消息快照无效。'),{status:400});
    if(recordIds.length>1&&snapshot===undefined)throw Object.assign(new Error('批量处理必须核对当前列表快照。'),{status:400});
    return this.control(()=>{
      this.policy=validatePolicy(load(this.policyFile,this.policy));this.watermarks=load(this.watermarkFile,this.watermarks);
      const all=unansweredItems(this.watermarks,this.policy),byId=new Map(all.map(entry=>[entry.recordId,entry])),targets=recordIds.map(id=>byId.get(id));
      if(targets.some(entry=>!entry))throw Object.assign(new Error('待处理消息不存在或已更新，请刷新列表。'),{status:404});
      const unresolved=targets.filter(entry=>isOpenBacklogRecord(entry.item));
      if(!unresolved.length)return{resolved:0,alreadyHandled:true,checkedAt:new Date().toISOString()};
      if(snapshot!==undefined&&snapshot!==unansweredSnapshot(all))throw Object.assign(new Error('待处理列表已变化，请刷新后确认；新到达的消息不会被本次处理。'),{status:409});
      const at=new Date().toISOString();
      for(const {item} of unresolved){item.handledByUserAt=at;item.handledBy='user';item.handledMethod='mark-handled-no-resend';item.handledNote='用户在当前界面标为已处理，不补发。';}
      save(this.watermarkFile,this.watermarks);
      this.log('unanswered.marked_handled',{recipientIds:[...new Set(unresolved.map(entry=>entry.contact.id))],recordIds,count:unresolved.length,method:'mark-handled-no-resend'});
      return{resolved:unresolved.length,alreadyHandled:false,checkedAt:at};
    });
  }
  async listContacts({ signal } = {}) { return this.browser.listContacts({ signal }); }
  async prepareChat({ signal, automatic = false, authorizePrepare } = {}) {
    if (automatic && (typeof this.browser.prepareChat !== 'function' || typeof authorizePrepare !== 'function')) throw Object.assign(new Error('自动准备入口不支持可信准备保护，未读取或新建页面。'), { code: 'CHAT_PREPARE_UNSUPPORTED' });
    const policy = validatePolicy(load(this.policyFile, this.policy));
    if (!policy.allowlist.length) throw new Error('请先保存已核对的许可名单，再准备回复通道。');
    const result = typeof this.browser.prepareChat === 'function'
      ? await this.browser.prepareChat({ signal, ...(automatic ? { automatic: true, authorizePrepare } : {}) })
      : await this.browser.listContacts({ signal, backgroundOnly: false, verifyFollowing: false });
    if (result?.blocked || result?.loginRequired || result?.verificationRequired) return { prepared: false, blocked: result.blocked === true, loginRequired: result.loginRequired === true, verificationRequired: result.verificationRequired === true };
    if (result?.prepared === false) throw new Error('回复通道准备未完成，未读取或改动其他页面。');
    const count = Number.isSafeInteger(result?.count) ? result.count : Array.isArray(result?.contacts) ? result.contacts.length : 0;
    let prepareCleanup;
    if(automatic&&result?.prepared===true&&count>0&&this.onPrepared){
      signal?.throwIfAborted();await authorizePrepare();signal?.throwIfAborted();
      try{const cleanup=await this.onPrepared({signal,authorizePrepare});prepareCleanup={closed:cleanup?.closed===true,reasonCode:typeof cleanup?.reasonCode==='string'&&/^[A-Z_]{3,64}$/.test(cleanup.reasonCode)?cleanup.reasonCode:'PREPARE_RECLAIM_SKIPPED'};}
      catch(error){signal?.throwIfAborted();await authorizePrepare();prepareCleanup={closed:false,reasonCode:'PREPARE_RECLAIM_UNAVAILABLE'};}
    }
    this.log('chat.prepared', { count });
    return { prepared: true, count, ...(prepareCleanup?{prepareCleanup}:{}) };
  }
  async readConversation(id, { signal } = {}) {
    const policy = validatePolicy(load(this.policyFile, this.policy));
    const contact=policy.allowlist.find((item) => item.id === id);
    if (!contact) throw new Error('联系人不在已核对白名单，未读取私信。');
    const snapshot=await this.browser.readConversation(id, { allowed: true, signal, weak: ['manual', 'existing-conversation', 'existing-group'].includes(contact.authorizationKind), backgroundOnly: true });
    assertConversationSnapshot(contact,snapshot); this.rememberReplyQualifications(contact, messagesOf(snapshot)); return snapshot;
  }
  startGroupVideos() {
    if (!this.groupVideos || !this.running || this.busy || this.starting || this.groupVideos.running || this.groupVideoDrain || this.abort?.signal.aborted) return;
    const authorize = () => {
      this.abort?.signal.throwIfAborted(); this.assertOwned();
      if (!this.running || !readFriendInteractionsEnabled(this.stateDir) || !validatePolicy(load(this.policyFile, this.policy)).enabled) throw Object.assign(new Error('群视频许可已撤回。'), { code: 'GROUP_VIDEO_REVOKED' });
    };
    const resolve = async (item, signal) => {
      authorize(); const policy=validatePolicy(load(this.policyFile,this.policy)),contact=policy.allowlist.find(contact=>contact.id===item.recipientId&&contact.isGroup===true);
      if (!contact) throw Object.assign(new Error('群视频的会话许可已撤回。'), { code:'GROUP_VIDEO_REVOKED' });
      const snapshot=await this.readConversation(contact.id,{signal});authorize();
      const message=messagesOf(snapshot).find(message=>message.id===item.messageId);
      if(!message)throw Object.assign(new Error('群视频卡片已经变化或不在当前可核对窗口。'),{code:'GROUP_VIDEO_SOURCE_CHANGED'});
      return {contact,message};
    };
    const task=this.groupVideos.drain({signal:this.abort.signal,authorize,canPersist:()=>this.worker()?.owned===true,
      canRun:()=>this.videoLimits.state(),resolve,
      observe:(contact,message,signal,{onObservation}={})=>this.observeMessage(contact.id,message.id,{signal,includeWork:true,onVideoObservation:onObservation}),
      reserve:()=>this.videoLimits.reserveRequest({source:this.browser.controller?.source==='dsh-chat'?'dsh':'api'}),
      inspect:(message,observation,signal,watching)=>this.agent.inspectSharedVideo({message,observation,signal,watching}),
      log:(type,fields)=>this.log(type,{recipientId:this.groupVideos.active?.recipientId,...fields}),
    });
    this.groupVideoDrain=task;
    void task.catch(()=>{if(this.runId&&!this.ownershipLost)this.log('group_video.worker_deferred',{code:'GROUP_VIDEO_WORKER_UNAVAILABLE'});}).finally(()=>{if(this.groupVideoDrain===task)this.groupVideoDrain=null;if(!this.running)this.release();});
  }
  async videoInspector() {
    this.inspectorPromise??=import('./core.mjs?v=9').then(({BrowserController})=>new BrowserController({source:this.browser.controller?.source==='dsh-chat'?'dsh':'api'}));
    return this.inspectorPromise;
  }
  async chatMediaAdapter() {
    if(this.mediaAdapter) return this.mediaAdapter;
    this.mediaAdapterPromise??=import('./media/index.mjs').then(({MediaAdapter})=>new MediaAdapter());
    return this.mediaAdapterPromise;
  }
  async transcribeMessage(id,message,{signal}={}) {
    const adapter=await this.chatMediaAdapter(), settings=await adapter.settings(); signal?.throwIfAborted();
    if(settings?.enabled!==true || settings.backend!=='local-whisper') throw new Error('语音消息需要本人开启本地 Whisper 转写；当前会话已暂停，未猜测语音内容。');
    const status=await adapter.status(); signal?.throwIfAborted();
    if(status?.enabled!==true || status.backend!=='local-whisper' || status.backends?.['local-whisper']?.available!==true) throw new Error('本地 Whisper 尚不可用，语音未转写；当前会话已暂停，请本人查看。');
    if(typeof this.browser.captureVoiceMessage!=='function'||typeof this.browser.releaseVoiceCapture!=='function') throw new Error('指定语音消息的采集适配尚未就绪，当前会话已暂停。');
    let captured;
    try {
      captured=await this.browser.captureVoiceMessage(id,message.id,{allowed:true,signal}); signal?.throwIfAborted();
      const audio=captured?.audio, seconds=captured?.media?.durationSeconds;
      const mime=audio?.mimeType?.split(';')[0].trim().toLowerCase();
      if(captured?.conversation?.id!==id || captured.messageId!==message.id || !/^voice:[a-f0-9]{64}$/.test(captured.captureId||'') || captured.understandingScope!=='single-message-audio' || captured.media?.type!=='voice' || captured.interval?.scope!=='single-message-audio' || captured.interval.startSeconds!==0 || !Number.isFinite(seconds) || seconds<=0 || seconds>120 || captured.interval.durationSeconds!==seconds || !audio || !path.isAbsolute(audio.path||'') || !Number.isSafeInteger(audio.bytes) || audio.bytes<1 || audio.bytes>25*1024*1024 || !['audio/wav','audio/x-wav','audio/wave','audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/ogg','audio/webm','audio/aac','audio/amr'].includes(mime)) throw new Error('指定语音消息的身份、时长或采集范围未核实，当前会话已暂停。');
      const stat=fs.lstatSync(audio.path);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==audio.bytes) throw new Error('指定语音的临时文件未通过核对，当前会话已暂停。');
      const result=await adapter.transcribeAudio({source:audio.path,startSeconds:0,durationSeconds:seconds,backend:'local-whisper',language:'auto'},{signal}); signal?.throwIfAborted();
      const intervalValid=result?.interval?.startSeconds===0 && Number.isFinite(result.interval.durationSeconds) && result.interval.durationSeconds>0 && result.interval.durationSeconds<=Math.min(120,seconds+1/16000);
      if(result?.ok===false && result.status==='no-speech' && result.backend==='local-whisper' && result.kind==='transcription' && typeof result.text==='string' && !result.text.trim() && Array.isArray(result.segments) && result.segments.length===0 && intervalValid) return {messageId:message.id,media:{type:'voice',durationSeconds:seconds},frames:[],audioStatus:'no-recognized-speech',understandingScope:'single-message-audio-no-speech',backend:'local-whisper',interval:{startSeconds:0,durationSeconds:result.interval.durationSeconds},note:'本地识别未识别到对白，不能据此确定是否静音、声音太轻或听不清；没有推断说话内容或环境声。'};
      if(result?.ok!==true || result.backend!=='local-whisper' || result.kind!=='transcription' || typeof result.text!=='string' || !result.text.trim() || result.text.length>16_000 || !intervalValid) throw new Error('语音转写失败或未返回有效文字和有界时长，当前会话已暂停，请本人查看，未猜测内容。');
      return {messageId:message.id,media:{type:'voice',durationSeconds:seconds},frames:[],transcription:{text:result.text.trim(),backend:'local-whisper',interval:{startSeconds:0,durationSeconds:result.interval.durationSeconds}},understandingScope:'single-message-audio-transcription',note:'仅转写这条许可会话中的语音消息，未写入全局视频记忆。'};
    } finally { if(/^voice:[a-f0-9]{64}$/.test(captured?.captureId||'')) await this.browser.releaseVoiceCapture(captured.captureId); }
  }
  async observeMessage(id,messageId,{signal,includeWork=true,onVideoObservation}={}) {
    if(onVideoObservation!==undefined&&typeof onVideoObservation!=='function')throw new TypeError('分享视频续看须由本机队列提供。');
    const snapshot=await this.readConversation(id,{signal});
    const message=messagesOf(snapshot).find(item=>item.id===messageId);
    if(!message?.media || message.unsupported) throw new Error('指定消息没有可核对的图片、表情、作品卡片或语音。');
    if(message.media.type==='voice') {
      const result=await this.transcribeMessage(id,message,{signal});
      const after=messagesOf(await this.readConversation(id,{signal})).find(item=>item.id===messageId);
      if(!after || messageFingerprint(after)!==messageFingerprint(message)) throw new Error('语音采集或转写期间消息已变化，当前会话已暂停，未回复。');
      return result;
    }
    if(typeof this.browser.captureMessage!=='function') throw new Error('私信画面适配尚未加载，请重新加载插件。');
    let captured;
    try { captured=await this.browser.captureMessage(id,messageId,{allowed:true,signal}); }
    catch(error) {
      if(message.media.type!=='shared-work' || /登录|验证/.test(String(error?.message||''))) throw error;
      captured={messageId,frames:[],imageStatus:'分享卡片没有可截取画面，继续核对作品链接。'};
    }
    if(captured.loginRequired||captured.verificationRequired||captured.blocked) throw new Error('没有取得指定消息的画面，请核对登录或验证。');
    if(captured.messageId!==messageId) throw new Error('指定消息的画面身份未通过核对，未回复。');
    const after=messagesOf(await this.readConversation(id,{signal})).find(item=>item.id===messageId);
    if(!after || messageFingerprint(after)!==messageFingerprint(message)) throw new Error('截图期间指定消息已变化，未回复。');
    const result={...captured,messageId,frames:(captured.frames??[]).slice(0,message.media.animatedHint === true ? 2 : 1)};
    if(includeWork && message.media.type==='shared-work') {
      const limits=(this.videoLimits ?? (await this.videoInspector()).limits()).state();
      if(!limits.allowed) {result.note=`当前只读取分享卡片封面和网页元数据，未播放作品：${limits.reason}`;return result;}
      let inspector, openedByInspector = false;
      try {
        const resolved=await this.browser.openSharedVideo(id,messageId,{allowed:true,signal});
        result.sharedWork=resolved;
        if(!resolved.url) {result.note=resolved.reason||'分享作品链接未核实，只读取卡片。';return result;}
        if(resolved.isPhotoGallery===true) {result.note='分享的是图文作品；本次只读取卡片封面及核实公开链接，没有播放视频。';return result;}
        const acceptObserved=async observed=>{
          signal?.throwIfAborted();
          const nativeProof=observed?.frameProof!==undefined&&(await import('./core.mjs')).verifySharedVideoFrameProof(observed,resolved.videoId);
          if(observed?.frameProof!==undefined?!nativeProof:!verifiedSharedVideoSample(observed,resolved.videoId))throw new Error('未确认同一分享作品的实际视频帧和播放时间推进，只保留卡片信息。');
          const afterSampling=messagesOf(await this.readConversation(id,{signal})).find(item=>item.id===messageId);
          if(!afterSampling||messageFingerprint(afterSampling)!==messageFingerprint(message))throw new Error('作品采样期间分享消息已经变化，未采用这次视频画面。');
          const frames=nativeProof?observed.frames:observed.frames.filter(frame=>frame.videoId===resolved.videoId&&Number.isFinite(frame.time)&&frame.time>=observed.observation.beforeTime-0.25&&frame.time<=observed.observation.afterTime+0.25);
          return {...result,frames:[...result.frames.slice(0,1),...frames.slice(0,3)],sharedWork:{...resolved,state:observed.state,observation:observed.observation},understandingScope:nativeProof?'card-cover-and-timed-video-sampling':'card-cover-and-three-second-video-sampling',
            ...(observed.watchOutcome?{watchOutcome:observed.watchOutcome}:{}),note:nativeProof?`以下是本批实际视频分时画面，宿主采集历时${observed.observation.actualWallSeconds.toFixed(2)}秒；没有音频，整条是否结束由连续观看回执说明。`:'以下是实际作品的有限采样，没有音频，不证明看完整条。'};
        };
        let observed;
        if (this.observeSharedWork) observed = await this.observeSharedWork({ url: resolved.url, videoId: resolved.videoId, signal,
          ...(onVideoObservation?{onObservation:async(raw,progress)=>onVideoObservation(await acceptObserved(raw),progress)}:{}) });
        else {
          inspector = await this.videoInspector();
          await inspector.execute('douyin_open_video',{url:resolved.url},{signal});
          openedByInspector = true;
          await inspector.execute('douyin_play', {}, {signal});
          observed=await inspector.execute('douyin_observe',{seconds:3},{signal});
        }
        Object.assign(result,await acceptObserved(observed));
      }catch(error) {signal?.throwIfAborted();if(onVideoObservation)throw error;result.note=`分享卡片已读取，作品观察未完成：${redact(error.message,[this.config.apiKey])}`;}
      finally { if (openedByInspector) await inspector.execute('douyin_pause', {}, { signal }).catch(() => {}); }
    }
    return result;
  }

  async configure({ recipientIds, dailyReplyLimit: _legacyDailyReplyLimit, allowConversationOnly = false, groupMentionNames = this.policy.groupMentionNames } = {}) {
    if (this.running || this.starting || this.busy || this.worker()?.alive) throw new Error('请先停止私信自动回复，再修改白名单或预算。');
    if (!Array.isArray(recipientIds) || recipientIds.some((id) => typeof id !== 'string') || new Set(recipientIds).size!==recipientIds.length) throw new Error('请选择已核对的个人或群聊会话，不能重复选择。');
    if (typeof allowConversationOnly !== 'boolean') throw new Error('已有会话授权必须由本人明确勾选。');
    const result = await this.browser.listContacts({});
    if (result.blocked || result.loginRequired || result.verificationRequired) throw new Error('请在专用 Edge 完成登录或验证。');
    const allowlist = recipientIds.map((id) => {
      const contact = result.contacts?.find((item) => item.id === id);
      if (['identityVersion', 'identityKind', 'identityHash'].some(key => contact?.[key] !== undefined) && !hasStableConversationIdentity(contact)) throw new Error('所选会话的稳定身份信息不完整或冲突，请重新核对。');
      const following = contact?.followed === true && contact.isGroup === false;
      const manual = allowConversationOnly === true && typeof contact?.isGroup === 'boolean';
      if (!following && !manual) throw new Error('所选会话尚未核对。请勾选“我已核对所选会话”，再选择个人或群聊会话。');
      const verifiedManual = manual && canAuthorizeConversation(contact);
      return { id, name: contact.name || contact.displayName || '联系人', followed: following ? true : null, isGroup: contact.isGroup, verifiedAt: new Date().toISOString(), authorizationKind: following ? 'following' : verifiedManual ? (contact.isGroup ? 'existing-group' : 'existing-conversation') : 'manual', ...(contact.identityVerified === true && contact.identityBinding ? { identityVerified: true, identityBinding: contact.identityBinding } : {}), ...(hasStableConversationIdentity(contact) ? { identityVersion: 2, identityKind: contact.identityKind, identityHash: contact.identityHash } : {}), ...(manual ? { relationshipStatus: 'unavailable' } : {}), relationshipEvidence: following ? contact.relationshipEvidence || '浏览器关系回读' : verifiedManual ? (contact.isGroup ? '本人核对群聊稳定身份并明确授权。' : '本人核对稳定会话身份后明确授权；网页未提供关注关系。') : '本人勾选现有会话并确认按' + (contact.isGroup ? '群聊' : '个人') + '处理；未取得稳定身份时发送前仍核对显示名和类型。' };
    });
    const policy = validatePolicy({ version: 1, enabled: false, allowlist, dailyReplyLimit: null, groupMentionNames });
    this.acquire();
    try { this.control(() => { this.assertOwned(); this.policy = policy; save(this.policyFile, this.policy); }); this.log('policy.updated', { recipientIds, dailyReplyLimit: null }); }
    finally { this.release(); }
    return this.state();
  }

  async start({ schedule = true, signal } = {}) {
    signal?.throwIfAborted();
    if (this.running) return this.state();
    if (this.starting) return this.starting;
    this.starting = this.begin(schedule, signal);
    try { return await this.starting; } finally { this.starting = null; if (!this.running) this.release(); }
  }
  async resumeAfterMaintenance() {
    this.clearReplyQualifications();
    if (!readFriendInteractionsEnabled(this.stateDir)) return this.state();
    const policy = validatePolicy(load(this.policyFile, this.policy));
    if (!policy.allowlist.length) return this.state();
    this.acquire();
    try {
      this.abort = new AbortController();
      this.stopContext = null;
      this.starting = null;
      this.busy = false;
      this.control(() => {
        this.assertOwned();
        const next = validatePolicy(load(this.policyFile, this.policy));
        next.enabled = true;
        this.policy = next;
        save(this.policyFile, next);
        save(this.lockFile, { pid: process.pid, runId: this.runId, heartbeatAt: new Date().toISOString(), status: 'running' });
      });
      this.running = true;
      this.startPolling({ immediate: false });
      this.log('service.resumed_without_baseline', { message: '待处理消息处理完成后恢复检查，没有重建基线或读取会话。' });
      return this.state();
    } catch (error) {
      this.running = false;
      this.stopPolling();
      try { this.release(); } catch { /* 保留原错误和文件锁，交给下一入口核对。 */ }
      throw error;
    }
  }
  setReplyProvider(provider) {
    if (provider !== undefined && typeof provider !== 'function') throw new TypeError('私信回复提供器必须是本机函数。');
    if (this.running || this.starting || this.busy) throw new Error('请先停止私信自动回复，再修改回复提供器。');
    this.agent.replyProvider = provider;
  }
  notifyIncoming(recipientId) {
    if (recipientId !== undefined && !this.policy.allowlist.some(contact => contact.id === recipientId)) return false;
    if (!this.running || this.abort?.signal.aborted) return false;
    if (recipientId !== undefined) this.incomingPriority.add(recipientId);
    return this.requestPoll();
  }
  requestPoll() {
    if (!this.running || this.abort?.signal.aborted || !this.runId) return false;
    this.pollRequested = true;
    // 新通知与定时检查合并；生成或发送中到达的消息只留下一个补扫请求。
    if (this.busy || this.pollScheduled) return true;
    const scheduled = { runId: this.runId };
    this.pollScheduled = scheduled;
    queueMicrotask(() => {
      if (this.pollScheduled !== scheduled) return;
      this.pollScheduled = null;
      if (!this.running || this.runId !== scheduled.runId || this.abort?.signal.aborted) return;
      this.pollRequested = false;
      void this.poll().catch(() => {});
    });
    return true;
  }
  startPolling({ immediate = true } = {}) {
    this.stopPolling();
    this.lastFullScanAt = 0;
    this.unreadProbeUnavailable = false;
    const runId = this.runId, signal = this.abort.signal;
    this.timer = setInterval(() => this.requestPoll(), this.pollIntervalMs); this.timer.unref?.();
    if (typeof this.browser.subscribeIncoming === 'function') {
      try {
        const subscription = this.browser.subscribeIncoming(event => {
          if (this.runId !== runId || signal.aborted) return;
          this.notifyIncoming(typeof event === 'string' ? event : event?.recipientId);
        }, { recipientIds: this.policy.allowlist.map(contact => contact.id), signal });
        this.notificationsTask = Promise.resolve(subscription).then(unsubscribe => {
          if (typeof unsubscribe !== 'function') return;
          if (this.running && this.runId === runId && !signal.aborted) this.incomingUnsubscribe = unsubscribe;
          else return unsubscribe();
        }).catch(() => { if (this.running && this.runId === runId) this.log('service.notifications_unavailable', { message: '消息通知暂不可用，继续使用定时检查。' }); });
      } catch { this.log('service.notifications_unavailable', { message: '消息通知暂不可用，继续使用定时检查。' }); }
    }
    if (immediate) this.requestPoll();
  }
  stopPolling() {
    clearInterval(this.timer); this.timer = null;
    this.incomingPriority.clear();
    this.pollRequested = false; this.pollScheduled = null;
    const unsubscribe = this.incomingUnsubscribe; this.incomingUnsubscribe = null;
    if (typeof unsubscribe === 'function') {
      try { this.notificationCleanup = Promise.resolve(unsubscribe()).catch(() => {}); } catch { /* 关闭订阅失败不恢复服务或重复发送。 */ }
    }
  }
  async begin(schedule, externalSignal) {
    this.clearReplyQualifications();
    if(!readFriendInteractionsEnabled(this.stateDir))throw new Error('好友互动总开关已关闭，未启动私信回复。');
    if (!this.config?.apiKey && typeof this.agent.replyProvider !== 'function') throw new Error('没有找到 DeepSeek API Key。');
    this.acquire();
    this.policy = validatePolicy(load(this.policyFile, this.policy));
    const authorizedBefore = JSON.stringify(this.policy.allowlist);
    if (!this.policy.allowlist.length) throw new Error('请先保存核对后的白名单。');
    this.abort = new AbortController();
    this.stopContext=null;
    const externalAbort = () => this.abort.abort(externalSignal.reason || new Error('启动任务已停止。'));
    if (externalSignal?.aborted) externalAbort(); else externalSignal?.addEventListener('abort', externalAbort, { once: true });
    const signal = this.abort.signal;
    try {
      const contacts = await this.browser.listContacts({ signal, backgroundOnly: true }); signal.throwIfAborted();
      if (contacts.blocked || contacts.loginRequired || contacts.verificationRequired) throw new Error('抖音私信页面需要手动处理。');
      const verifiedAllowlist = [];
      for (const stored of this.policy.allowlist) {
        const current = contacts.contacts?.find((item) => item.id === stored.id);
        let contact = verifiedAuthorizedContact(stored, current);
        const old = this.watermarks.contacts[contact.id];
        // 旧发送不明仅进入自动读回，不据此重发。
        if (old?.identityReviewRequired) { verifiedAllowlist.push(contact); continue; }
        let snapshot;
        try { snapshot = await this.browser.readConversation(contact.id, { allowed: true, signal, weak: ['manual', 'existing-conversation', 'existing-group'].includes(contact.authorizationKind), backgroundOnly: true }); }
        catch (error) {
          signal.throwIfAborted();
          if (error.code !== 'CHAT_CONVERSATION_IDENTITY_MISMATCH') throw error;
          this.watermarks.contacts[contact.id] = { seen: [], context: [], unanswered: [], ...old, status: 'paused', identityReviewRequired: true, reason: '会话身份未通过核对，已单独暂停；请核对后在助手内解除暂停。', lastCheckedAt: new Date().toISOString() };
          verifiedAllowlist.push(contact);
          this.watermarks.contacts[contact.id].autoBacklog={version:1,source:'authorized-unsent-backlog-v1',retryCount:1,state:'waiting',nextRetryAt:new Date(Date.now()+30_000).toISOString()};this.log('contact.identity_review_required', { recipientId: contact.id, code: error.code });
          continue;
        }
        signal.throwIfAborted();
        const messages = messagesOf(snapshot);
        assertConversationSnapshot(contact, snapshot);
        contact = verifiedAuthorizedContact(contact, snapshot.contact);
        verifiedAllowlist.push(contact);
        this.qualifyNativeBacklog(contact, old, snapshot, messages);
        const next={status:'ready',seen:messages.map(item=>item.id).slice(-2000),context:[],unanswered:structuredClone(old?.unanswered||[]),autoBacklog:structuredClone(old?.autoBacklog||null),startedAt:new Date().toISOString(),lastCheckedAt:new Date().toISOString()};
        const pending=old?.recoveryQueue||old?.pending;
        if(['inflight','delivery-uncertain'].includes(old?.status)&&!pending?.incoming?.length)archivePending(next,{...(pending||{}),phase:'delivery-uncertain',incoming:pending?.incoming||[],legacyUncertain:true},'原发送不明证据不完整，保留自动读回，不重发。');
        if (Array.isArray(old?.retry) && old.retry.length && !pending?.incoming?.length) archivePending(next, { phase: 'superseded', incoming: structuredClone(old.retry) }, '旧重答队列缺少完整恢复证据，仅留人工待答，不自动补发。');
        if(pending?.incoming?.length&&pending.phase!=='handled-by-user'&&!pending.backlogAuthorization){
          const restored=recoverableIncoming(pending,contact,messages,load(this.stopFile,null));
          if(restored){next.recoveryQueue=structuredClone(pending);this.log('recovery.queued',{recipientId:contact.id,messageIds:restored.map(item=>item.id),message:'维护中断前已核对且未开始发送的消息进入恢复队列，未修改旧消息水位。'});}
          else if(certainUnsentPending(pending)){const queueEntry=structuredClone(pending);allowMaintenanceRecovery(queueEntry);next.recoveryQueue=queueEntry;this.log('recovery.queued_certain_unsent',{recipientId:contact.id,phase:pending.phase,message:'崩溃或停止前处于发送前阶段且保留完整未发送证据，进入恢复队列；回读资格核对通过后才自动恢复。'});}
          else{archivePending(next,pending,'重启时缺少完整未发送与消息资格证据，或消息/会话已变化；仅留人工待答，不自动补发。');this.log('baseline.skipped_pending',{recipientId:contact.id,message:'未答消息保留在本机清单，不自动补发。'});}
        }
        this.watermarks.contacts[contact.id]=next;
      }
      signal.throwIfAborted();
      this.control(() => {
        this.assertOwned();
        const policy = validatePolicy(load(this.policyFile, this.policy));
        if (JSON.stringify(policy.allowlist) !== authorizedBefore) throw new Error('启动核对期间许可名单已变化，未覆盖新设置或启动回复。');
        this.policy = { ...policy, allowlist: verifiedAllowlist, enabled: true };
        this.persist(); save(this.policyFile, this.policy); save(this.lockFile, { pid: process.pid, runId: this.runId, heartbeatAt: new Date().toISOString(), status: 'running' });
      }); this.running = true;
      this.log('service.started', { message: '已建立现有消息基线，只回复此后新收到的私信。' });
      if (schedule) this.startPolling();
      return this.state();
    } catch (error) {
      this.running = false; this.stopPolling(); this.policy.enabled = false;
      const deferred = ['CHAT_FOREGROUND', 'BROWSER_NOT_RUNNING', 'CHAT_PAGE_NOT_OPEN', 'CHAT_PAGE_LEFT_DOUYIN'].includes(error.code);
      this.log(deferred ? 'service.deferred' : 'service.start_failed', { code: error.code || '', message: error.message });
      throw error;
    }
    finally { externalSignal?.removeEventListener('abort', externalAbort); }
  }
  stop({preservePending=false,reason='user-stop'}={}) {
    this.clearReplyQualifications();
    if(preservePending){try{const master=load(path.join(this.stateDir,'friend-interactions-policy.json'),{version:1,enabled:true});if(master?.version!==1||master.enabled!==true)preservePending=false;}catch{preservePending=false;}}
    if (this.ownershipLost) return this.state();
    const worker = this.worker();
    if (this.runId && worker?.owned !== true) { this.loseOwnership(); return this.state(); }
    if (worker?.alive && !worker.owned) {
      if (!worker.runId) throw new Error('另一个入口正在取得锁，请稍后停止。');
      save(this.stopFile, { targetRunId: worker.runId, requestId: randomUUID(), requestedAt: new Date().toISOString(),preservePending:preservePending===true,reason });
      return { ...this.state(), stopping: true, message: '已向当前回复进程发送停止请求。' };
    }
    if(!this.runId&&!preservePending)this.acquire();
    this.stopContext={preservePending:preservePending===true,reason};if(this.runId){for(const mark of Object.values(this.watermarks.contacts)){delete mark.retry;if(!preservePending){if(mark.pending)mark.pending.restartAllowed=false;if(mark.recoveryQueue)mark.recoveryQueue.restartAllowed=false;}else if(mark.pending?.recoveryEvidence?.beforeDispatch===true&&['model','observing','superseded','outbound-wait','stopped-before-send'].includes(mark.pending.phase))allowMaintenanceRecovery(mark.pending);}this.persist();}this.running = false; this.stopPolling(); this.groupVideos?.interrupt();this.abort?.abort(new Error('用户停止私信自动回复。')); this.policy.enabled = false; this.log('service.stopped',{preservePending:preservePending===true,reason}); this.release(); return this.state();
  }
  resumeContact(id) {
    if (this.running || this.starting || this.busy || this.worker()?.alive) throw new Error('请先停止自动回复，再人工解除联系人暂停。');
    this.acquire();
    try { this.control(() => { this.assertOwned(); this.policy = validatePolicy(load(this.policyFile, this.policy)); this.watermarks = load(this.watermarkFile, this.watermarks);
      if (!this.policy.allowlist.some((item) => item.id === id)) throw new Error('联系人不在白名单。');
      const mark = this.watermarks.contacts[id]; if (mark) {const at=new Date().toISOString();for(const item of mark.unanswered||[])if(!item.handledByUserAt)item.handledByUserAt=at;if(mark.pending)archivePending(mark,mark.pending,'用户明确核对后解除暂停，保留审计，不重发旧消息。',{handledByUserAt:at});if(mark.recoveryQueue)archivePending(mark,mark.recoveryQueue,'用户明确核对后结束恢复队列，不自动补发。',{handledByUserAt:at});delete mark.pending;delete mark.recoveryQueue;delete mark.retry;this.clearReplyQualifications();delete mark.identityReviewRequired;mark.status = 'ready'; mark.reason = ''; this.persist(); }
    }); this.log('contact.manually_resolved', { recipientId: id, message: '用户确认已核对发送结果；下次启动将重新建立基线，不重发旧消息。' }); }
    finally { this.release(); }
    return this.state();
  }

  autoRecords(mark) { return (mark.unanswered || []).filter(isOpenBacklogRecord); }
  // C3 需人工终态：后台触发原因收敛为一个「需人工」态 + 原因码（mapping-stale=映射失效、media-unobservable=缺媒体观察、identity-unverifiable=身份不可核对）。
  // 记录保留在待答清单（isOpenBacklogRecord 口径不变，第③步展示与人工结束都从清单来）；状态机扫描跳过它们，退出空转。
  markNeedsManual(record, reasonCode) {
    if (record.needsManual) return;
    record.needsManual = true; record.needsManualReason = reasonCode; record.needsManualAt = new Date().toISOString();
    if (reasonCode === 'media-unobservable') { record.mediaNeedsManual = true; record.mediaNeedsManualAt ??= record.needsManualAt; }
    if (reasonCode === 'identity-unverifiable') record.identityUnverifiableAt ??= record.needsManualAt;
  }
  needsManualRecords(mark) { return this.autoRecords(mark).filter(record => record.needsManual === true); }
  // P1-1 目标粒度子状态：持久化文字/媒体目标的处理结果（reserved/uncertain/confirmed），混合记录的读回与恢复按目标核对，
  // 不因媒体部分转人工而中断文字目标的发送结果核对。persist 落盘，非内存 transient。
  setTargetState(record, messageId, state, extra = {}) {
    record.targetStates ??= [];
    const existing = record.targetStates.find(item => item.messageId === messageId);
    if (existing) Object.assign(existing, { state, at: new Date().toISOString(), ...extra });
    else record.targetStates.push({ messageId, state, at: new Date().toISOString(), ...extra });
  }
  targetStatesOf(record) { return Array.isArray(record.targetStates) ? record.targetStates : []; }
  // 混合记录（含媒体目标）中文字目标是否仍在发送/读回流程：reserved/uncertain/未定论的发送都要继续核对。
  mixedRecordHasTextInFlight(record) {
    if (!record.incoming?.some(message => message.media || (message.kind && message.kind !== 'text'))) return false;
    const textIds = record.incoming.filter(message => !message.media && (!message.kind || message.kind === 'text')).map(message => message.id);
    return this.targetStatesOf(record).some(item => textIds.includes(item.messageId) && ['reserved', 'uncertain'].includes(item.state));
  }
  // P1-1：混合记录文字目标的读回核对（needs-manual 状态下也不中断）：按 targetStates 的文字目标在当前窗口找
  // 已发出的同文 outgoing（identitySource=dom-message-id）。P1-2：reserved 与 uncertain 都要求正文与
  // expectedText 严格一致才转 confirmed——绝不把无关消息（人工另发等）当发送成功；正文不一致保持原态等待。
  readbackMixedRecordText(record, mark, messages) {
    for (const item of this.targetStatesOf(record)) {
      if (!['reserved', 'uncertain'].includes(item.state)) continue;
      const message = record.incoming?.find(entry => entry.id === item.messageId);
      if (!message || message.media || (message.kind && message.kind !== 'text')) continue;
      const known = new Set(record.recoveryEvidence?.expectedContent?.map(entry => entry.id) ?? []);
      // 三审 P2：sent=false 的 outgoing 是「未发出」的状态矛盾候选，正文再匹配也不得用于确认（与 restoreBacklogReceipt 路径核对对齐）。
      const candidates = messages.filter(row => row.sender === 'outgoing' && row.identitySource === 'dom-message-id' && !known.has(row.id) && row.failed !== true && row.pending !== true && row.sent !== false);
      const expectedText = item.text ?? record.autoAttempt?.text ?? record.generatedText ?? '';
      const match = candidates.find(row => row.text?.trim() === String(expectedText).trim());
      if (match) { this.setTargetState(record, item.messageId, 'confirmed', { method: 'uncertain-matching-native-outgoing', proofMessageId: match.id }); if (mark) this.recordProgressed(mark); this.log('backlog.text_target_confirmed', { archiveId: record.archiveId, messageId: item.messageId, message: '混合待答的文字发送结果经读回确认，媒体目标仍由人工处理。' }); }
      else if (item.state === 'reserved') { this.setTargetState(record, item.messageId, 'uncertain'); this.log('backlog.text_target_uncertain', { archiveId: record.archiveId, messageId: item.messageId, message: 'reserved 目标未在当前窗口找到与生成文本一致的已发出消息，降为 uncertain 继续等待读回。' }); }
    }
  }
  qualifyNativeBacklog(contact, mark, snapshot, messages) {
    if (!mark || !hasStableConversationIdentity(contact) || !hasStableConversationIdentity(snapshot.contact) || !matchesAuthorizedContact(contact, snapshot.contact) || snapshot.conversation?.id !== contact.id) return;
    const stopRequest = load(this.stopFile, null);
    for (const record of mark.unanswered || []) {
      const evidence = qualifyNativeUnanswered(record, mark, messages, snapshot, contact, stopRequest);
      if (evidence) { record.recoveryEvidence = evidence; mark.autoBacklog = null; this.log('backlog.native_arrival_qualified', { recipientId: contact.id, count: 1 }); }
    }
  }
  autoDue(mark) { return Boolean(mark && (this.autoRecords(mark).some(record => record.needsManual !== true) || this.autoRecords(mark).some(record => this.mixedRecordHasTextInFlight(record)) || mark.autoBacklog?.receipt?.confirmed === true || ['inflight', 'delivery-uncertain'].includes(mark.status) && mark.pending?.incoming?.length) && Date.now() >= (Date.parse(mark.autoBacklog?.nextRetryAt) || 0)); }
  backlogPause(mark, reason) {
    const queue = mark.autoBacklog ??= { version: 1, source: 'authorized-unsent-backlog-v1', retryCount: 0 };
    queue.retryCount = Math.min(20, (queue.retryCount || 0) + 1); queue.state = 'waiting'; queue.reason = reason;
    // C3/P2 临时失败升级：连续等待计数按「记录语义批次」累计——所有 open 记录均无进展时递增；
    // 任一记录推进成功（结案/进入发送）即重置计数并解除升级标记（recordProgressed），新任务失败可再次完整退避并再次升级。
    mark.autoBacklogWaits = (mark.autoBacklogWaits || 0) + 1;
    if (mark.autoBacklogWaits >= 6 && mark.autoBacklogEscalated !== true) { mark.autoBacklogEscalated = true; queue.escalated = true; this.log('backlog.escalated', { reason, waits: mark.autoBacklogWaits, message: '同一联系人的补答连续多次等待，建议人工核对待答清单。' }); }
    queue.nextRetryAt = new Date(Date.now() + Math.min(300_000, 5_000 * 2 ** Math.min(queue.retryCount - 1, 6))).toISOString();
    this.persist();
  }
  settleBacklog(record, messageId, method) {
    record.autoHandled = true; record.autoHandledAt = new Date().toISOString(); record.autoHandledBy = 'dafeiyu';
    record.autoHandledProof = { version: 1, source: 'authorized-unsent-backlog-v1', method, messageId, confirmed: true };
    if (record.autoAttempt) record.autoAttempt.state = 'confirmed';
  }
  // P2：记录推进成功（结案或文字目标进入发送/确认）即重置等待计数与升级标记——升级语义绑定"当前批次无进展"，
  // 新任务失败可再次走完整退避并再次升级，不被旧标记压制。
  recordProgressed(mark) {
    if (mark.autoBacklogWaits) mark.autoBacklogWaits = 0;
    if (mark.autoBacklogEscalated) mark.autoBacklogEscalated = false;
  }  restoreBacklogReceipt(contact, mark) {
    const queue = mark.autoBacklog, receipt = queue?.receipt;
    if (receipt?.confirmed !== true || receipt.key !== queue.key || !Array.isArray(receipt.archiveIds) || !Array.isArray(receipt.targets) || !matchesAuthorizedContact(queue.authorizationContact, contact) || !matchesAuthorizedContact(contact, queue.authorizationContact)) { console.error('RESTORE-GATE1 fail:',JSON.stringify({confirmed:receipt?.confirmed,keyMatch:receipt?.key===queue?.key,ids:Array.isArray(receipt?.archiveIds),targets:Array.isArray(receipt?.targets),fwd:receipt?matchesAuthorizedContact(receipt&&queue.authorizationContact,contact):null,bwd:receipt?matchesAuthorizedContact(contact,queue.authorizationContact):null})); return false; }
    const key = createHash('sha256').update(JSON.stringify([contact.id, receipt.archiveIds.slice().sort(), receipt.targets.map(item => [item.id, item.fingerprint])])).digest('hex');
    if (key !== receipt.key || !this.outbound.history(contact.id).some(item => item.confirmed === true && item.kind === 'reply' && item.messageId === receipt.messageId)) return false;
    let settled = false;
    for (const id of receipt.archiveIds) {
      const record = this.autoRecords(mark).find(item => item.archiveId === id);
      const source = record?.recoveryEvidence?.qualifiedIncoming;
      if (!Array.isArray(source) || !source.length || source.some(item => !validBacklogQualification(record, item))) continue;
      const sourceHash = createHash('sha256').update(JSON.stringify(source.map(item => [item.message.id, item.fingerprint]))).digest('hex');
      if (record.autoAttempt?.queueKey === key && record.autoAttempt.sourceHash === sourceHash && JSON.stringify(record.autoAttempt.targets) === JSON.stringify(receipt.targets) && matchesAuthorizedContact(record.recoveryEvidence.contact, contact) && matchesAuthorizedContact(contact, record.recoveryEvidence.contact)) {
        // P1-1：恢复路径同样受「混合记录不整条结案」约束——含媒体目标的记录只把本次回执覆盖的文字目标标 confirmed，
        // 媒体目标保持 open + needs-manual；纯文字记录才整条结案。
        const hasMediaTarget = record.incoming?.some(message => message.media || (message.kind && message.kind !== 'text'));
        if (hasMediaTarget) {
          const receiptTextIds = new Set(receipt.targets.map(item => item.id).filter(targetId => { const message = record.incoming.find(entry => entry.id === targetId); return message && !message.media && (!message.kind || message.kind === 'text'); }));
          for (const targetId of receiptTextIds) this.setTargetState(record, targetId, 'confirmed', { method: 'persisted-platform-and-outbound-receipt', proofMessageId: receipt.messageId });
          if (record.needsManual !== true) this.markNeedsManual(record, 'media-unobservable');
          settled = true;
        } else { this.settleBacklog(record, receipt.messageId, 'persisted-platform-and-outbound-receipt'); settled = true; }
      }
    }
    if (settled) { this.recordProgressed(mark); this.persist(); } return settled;
  }
  reserveBacklogDispatch(mark) {
    const queue = mark.autoBacklog;
    if (!queue || queue.source !== 'authorized-unsent-backlog-v1' || !queue.text || !Array.isArray(queue.archiveIds)) throw new Error('自动补答缺少独立来源记录，未输入。');
    for (const id of queue.archiveIds) {
      const record = this.autoRecords(mark).find(item => item.archiveId === id);
      if (!record || ['reserved', 'uncertain'].includes(record.autoAttempt?.state)) throw new Error('自动补答记录已有未确认输入，未重复输入。');
      const sourceHash = createHash('sha256').update(JSON.stringify(record.recoveryEvidence?.qualifiedIncoming?.map(item => [item.message?.id, item.fingerprint]))).digest('hex');
      record.autoAttempt = { version: 1, source: 'authorized-unsent-backlog-v1', queueKey: queue.key, sourceHash, targets: queue.targets, state: 'reserved', text: queue.text, at: new Date().toISOString() };
      // P1-1：可能开始发送前同步把文字目标子状态置 reserved（含 expectedText）并落盘——混合记录任何时刻崩溃后
      // mixedRecordHasTextInFlight 都为真，读回核对不会因崩溃窗口丢失。
      for (const target of queue.targets) {
        const message = record.incoming?.find(entry => entry.id === target.id);
        if (message && !message.media && (!message.kind || message.kind === 'text')) this.setTargetState(record, target.id, 'reserved', { text: queue.text });
      }
    }
    queue.state = 'sending'; this.persist();
  }
  async processAutoBacklog(contact, mark, snapshot, messages, signal) {
    signal.throwIfAborted(); if (!this.running || !this.runId) return; this.assertOwned();
    if (!this.autoDue(mark)) return;
    let migratedArchiveIds = false;
    const archiveIdsInUse = new Set(this.autoRecords(mark).map(record => record.archiveId).filter(id => typeof id === 'string' && id.trim()));
    for (const record of this.autoRecords(mark)) if (typeof record.archiveId !== 'string' || !record.archiveId.trim()) {
      let id; do { id = randomUUID(); } while (archiveIdsInUse.has(id));
      record.archiveId = id; archiveIdsInUse.add(id); migratedArchiveIds = true;
    }
    if (migratedArchiveIds) this.persist();
    if (hasStableConversationIdentity(contact) && matchesAuthorizedContact(contact,snapshot.contact)) this.restoreBacklogReceipt(contact,mark);
    const allRecords = this.autoRecords(mark); if (!allRecords.length) return;
    const start = (mark.autoBacklogScanCursor || 0) % allRecords.length, records = [...allRecords.slice(start),...allRecords.slice(0,start)].slice(0,32);
    mark.autoBacklogScanCursor = (start + records.length) % allRecords.length;
    const evidence = snapshot.dayEvidence ?? snapshot;
    if (!hasStableConversationIdentity(contact) || !matchesAuthorizedContact(contact, snapshot.contact) || !hasStableConversationIdentity(snapshot.contact) || snapshot.conversation?.id !== contact.id || evidence.chronology !== 'oldest-first' || evidence.latestEndVerified !== true || !messages.length || messages.some(message => message.latestEndVerified !== true || message.sender === 'unknown')) { this.backlogPause(mark, 'waiting-reliable-conversation'); return; }
    let ready = [], unmappedUncertain = allRecords.some(record=>!records.includes(record)&&(record.legacyUncertain||record.recoveryEvidence?.beforeDispatch===false||['sending','delivery-uncertain'].includes(record.phase)||['reserved','uncertain'].includes(record.autoAttempt?.state))); const uncertainTargets = new Set(), uncertainSources = new Set();
    for (const record of records) {
      // C3：needs-manual 终态记录退出状态机扫描（保留在待答清单供展示与人工结束），不空转。
      // P1-1 例外：混合记录的文字目标已进入发送/读回流程（targetStates 有 reserved/uncertain）时，读回核对不能因媒体部分转人工而中断。
      if (record.needsManual === true) {
        if (this.mixedRecordHasTextInFlight(record)) { this.readbackMixedRecordText(record, mark, messages); }
        continue;
      }
      const isUncertain = record.legacyUncertain === true || record.recoveryEvidence?.beforeDispatch === false || ['sending', 'delivery-uncertain'].includes(record.phase) || ['reserved', 'uncertain'].includes(record.autoAttempt?.state);
      const savedContact = record.recoveryEvidence?.contact;
      // 身份凭据无法双向核对的记录不得静默跳过——那是用户不可见的永久卡死（漏答形态之一）。转 needs-manual 终态并补事件。
      if (!matchesAuthorizedContact(savedContact, contact) || !matchesAuthorizedContact(contact, savedContact)) {
        if (isUncertain) unmappedUncertain = true;
        this.markNeedsManual(record, 'identity-unverifiable');
        this.log('backlog.identity_unverifiable', { recipientId: contact.id, archiveId: record.archiveId, phase: record.phase, hasContact: Boolean(savedContact), verifiedAt: savedContact?.verifiedAt ?? null, message: '待答记录的身份凭据无法与当前许可会话双向核对，已转需人工终态，不再自动推进。' });
        this.persist();
        continue;
      }
      if (isUncertain) for (const item of record.recoveryEvidence.qualifiedIncoming || []) uncertainSources.add(item.message?.id + '\0' + item.fingerprint);
      const mapped = mapBacklogMessages(record, messages);
      if (!mapped.ready) {
        // C3：结构性映射失败（目标挤出窗口/资格证据失效）是永久态——转 needs-manual 终态退出空转，不再每 300s 空扫描。
        if (isUncertain) unmappedUncertain = true;
        else if (['native-target-unavailable', 'legacy-native-target-unavailable', 'target-context-unavailable', 'qualification-evidence-unavailable', 'complete-context-suffix-unavailable', 'context-evidence-unavailable', 'context-not-unique', 'legacy-adjacency-insufficient', 'legacy-context-incomplete', 'duplicate-target', 'current-direction-or-identity'].includes(mapped.reason)) { this.markNeedsManual(record, 'mapping-stale'); this.log('backlog.mapping_stale', { recipientId: contact.id, archiveId: record.archiveId, reason: mapped.reason, message: '待答记录的映射证据已失效（消息挤出窗口或上下文不可核对），已转需人工终态，保留在待答清单。' }); }
        continue;
      }
      if (mapped.uncertain) { mapped.targets.forEach(item => uncertainTargets.add(item.message.id)); for (const item of record.recoveryEvidence.qualifiedIncoming) uncertainSources.add(item.message.id + '\0' + item.fingerprint); }
      if (contact.isGroup) { mapped.targets = mapped.targets.filter(item => groupMessageAddressesFish(item.message,this.policy.groupMentionNames)); if(!mapped.targets.length)continue; if(messages.slice(Math.max(...mapped.targets.map(item=>item.index))+1).some(message=>message.sender==='outgoing'))mapped.canSend=false; }
      let expectedText; try { expectedText = normalizeChatReplyText(record.autoAttempt?.text ?? record.generatedText ?? record.text); } catch {}
      const outgoing = backlogOutgoingReadback(record, mapped, messages, expectedText);
      if (outgoing) { this.settleBacklog(record, outgoing.id, mapped.uncertain ? 'uncertain-matching-native-outgoing' : 'observed-native-outgoing'); continue; }
      if (mapped.canSend) ready.push({ record, mapped });
    }
    ready = unmappedUncertain ? [] : ready.filter(item => item.mapped.targets.every(target => !uncertainTargets.has(target.message.id)) && item.record.recoveryEvidence.qualifiedIncoming.every(target => !uncertainSources.has(target.message.id + '\0' + target.fingerprint)));
    // C2 拆分：媒体门槛只拦媒体，不再连坐纯文本。媒体观察不持久化、补答无法重采画面，是设计事实——
    // 含媒体目标的记录标「缺媒体观察·需人工」（结构性），纯文本记录解出照常生成发送。
    // 引用关系保留：文本记录显式引用（quote）或文本指向同批媒体目标时，跟随媒体转人工，不脱离媒体盲答。
    const mediaTargetIds = new Set(ready.flatMap(item => item.mapped.targets.filter(target => target.message.media || target.message.kind !== 'text' || !target.message.text?.trim()).map(target => target.message.id)));
    const textRefersTo = (record, mapped) => mapped.targets.some(target => typeof target.message.text === 'string' && /这个|那条|上面|刚才|发你|分享|视频|作品/.test(target.message.text) && typeof target.message.reference?.text === 'string' && target.message.reference.text.trim()) || mapped.targets.some(target => typeof target.message.reference?.text === 'string' && target.message.reference.text.trim());
    const manualMedia = new Set(), textReady = [];
    for (const item of ready) {
      const mediaTargets = item.mapped.targets.filter(target => target.message.media || target.message.kind !== 'text' || !target.message.text?.trim());
      const textTargets = item.mapped.targets.filter(target => !target.message.media && target.message.kind === 'text' && target.message.text?.trim());
      // 引用跟随：文本目标带 quote 引用且同批存在媒体目标时，文本跟随媒体转人工，不脱离媒体盲答。
      // 误判风险：仅按 reference 字段与指向性关键词判定；无 quote 的纯指向性文本（“刚才那个视频”）不识别为引用——
      // 这类保持自动推进但回复上下文里本就含该媒体前文，风险可接受；有 quote 的不会漏。
      const refersMedia = textTargets.length > 0 && mediaTargetIds.size > 0 && textTargets.some(target => typeof target.message.reference?.text === 'string' && target.message.reference.text.trim());
      if (mediaTargets.length && textTargets.length) {
        // 混合记录：媒体目标转人工（标记），文字目标解出按目标粒度推进，记录保持 open。
        manualMedia.add(item.record.archiveId);
        if (!refersMedia) textReady.push({ ...item, mapped: { ...item.mapped, targets: textTargets, canSend: true } });
      } else if (mediaTargets.length) {
        manualMedia.add(item.record.archiveId);
      } else if (!refersMedia) {
        textReady.push(item);
      } else {
        manualMedia.add(item.record.archiveId);
      }
    }
    for (const id of manualMedia) {
      const item = ready.find(entry => entry.record.archiveId === id);
      this.markNeedsManual(item.record, 'media-unobservable');
      this.log('backlog.media_needs_manual', { recipientId: contact.id, archiveId: id, targets: item.mapped.targets.map(target => target.message.kind), message: '该待答含媒体目标（媒体观察不持久化，补答无法重采画面），已转需人工终态，不再阻塞纯文本待答。' });
    }
    if (manualMedia.size && !textReady.length) { this.backlogPause(mark, 'waiting-media-manual'); return; }
    ready = textReady;
    if (!ready.length) { this.backlogPause(mark, 'waiting-backlog-evidence-or-outgoing'); return; }
    let archiveIds = ready.map(item => item.record.archiveId);
    if (archiveIds.some(id => typeof id !== 'string' || !id) || new Set(archiveIds).size !== archiveIds.length) { this.backlogPause(mark, 'waiting-archive-identity'); return; }
    let targets = [...new Map(ready.flatMap(item => item.mapped.targets).map(item => [item.message.id, item])).values()].sort((left, right) => left.index - right.index);
    let key = createHash('sha256').update(JSON.stringify([contact.id, archiveIds.slice().sort(), targets.map(item => [item.message.id, item.fingerprint])])).digest('hex');
    let queue = mark.autoBacklog;
    if (queue?.key !== key) queue = mark.autoBacklog = { version: 1, source: 'authorized-unsent-backlog-v1', key, archiveIds, generationAttempts: 0, retryCount: 0 };
    queue.targets = targets.map(item=>({id:item.message.id,fingerprint:item.fingerprint})); queue.authorizationContact = structuredClone(contact);
    const cachedMatches = queue.text && queue.watermark && compareMessageWatermark(queue.watermark, messages, snapshot).matches;
    if (!cachedMatches) {
      queue.text = null;
      // 已生成未发送的回复直接复用：唯一来信仍是窗口最新消息时沿用原语义；媒体分享目标无法在受界上下文内
      // 重新生成，只要其后没有已发出的消息（本人未接手），复用旧文本是唯一不漏答路径。
      const lastIncoming = messages.findLastIndex(message => message.sender === 'incoming');
      const candidate = targets.at(-1);
      const targetIsLatest = targets.length === 1 && candidate && candidate.index === lastIncoming;
      const mediaTargetStale = targets.length === 1 && candidate && Boolean(candidate.message.media) && candidate.index >= 0 && !messages.slice(candidate.index + 1).some(item => item.sender === 'outgoing');
      if ((targetIsLatest || mediaTargetStale) && !queue.generationAttempts) {
        try { queue.text = normalizeChatReplyText(ready[0].record.generatedText ?? ready[0].record.text); queue.replySource = 'existing-matching-generated-text'; } catch {}
      }
      if (!queue.text) {
        const ids = new Set(targets.map(item => item.message.id));
        const eligibleContext = messages.slice(0,targets.at(-1).index+1).filter(message => (!message.kind || message.kind === 'text') && !message.media && typeof message.text === 'string' && message.text.trim());
        const currentTail = eligibleContext.at(-1);
        // C2 后此处 targets 已不含媒体目标（媒体记录在上方拆出）；媒体条件保留为不变量守护，命中即防御性等待而非连坐。
        if (targets.length > 6 || !currentTail || currentTail.sender !== 'incoming' || contact.isGroup && !groupMessageAddressesFish(currentTail, this.policy.groupMentionNames) || targets.some(item => item.message.media || item.message.kind !== 'text' || !item.message.text?.trim())) { this.backlogPause(mark, 'waiting-bounded-generation-evidence'); return; }
        // P1-2 无引用框媒体追问跟随：有界生成上下文不含媒体（eligibleContext 已滤掉媒体），若文本目标与被标
        // needs-manual(media-unobservable) 的媒体记录存在语义关联（引用 / 时间相邻 / 同批归档），跟随转人工，
        // 不脱离媒体盲答。宁可多转人工不可盲答；误判代价是文本被转人工（可见、可人工结束），盲答代价是虚构媒体内容。
        // 判定规则：①文本带 quote 引用且引用文本与 needs-manual 媒体记录的 incoming 相同；②文本与媒体消息在窗口中
        // 时间相邻（媒体消息之后的下一条 incoming 即该文本，或间隔 ≤1 条）；③同批归档（本批 manualMedia 中）。
        // 混合记录的文字子集是 C2 审核允许的目标粒度推进（不脱离媒体——媒体目标仍在该记录上由人工处理），不适用本判定；
        // 只拦「纯文本记录指向同批/相邻 needs-manual 媒体」的盲答。
        const manualMediaRecords = mark.unanswered?.filter(entry => entry.needsManual === true && entry.needsManualReason === 'media-unobservable' && !ready.some(item => item.record.archiveId === entry.archiveId)) ?? [];
        const manualMediaMessageIds = new Set(manualMediaRecords.flatMap(entry => (entry.incoming ?? []).map(message => message.id)));
        // P2-1 连坐收窄：判定按目标粒度进行——只有「targets 中命中关联判定」的记录跟随转人工，无关记录照常推进；
        // 一条记录的多个 target 部分命中时按该记录整体转人工（记录是不可拆的整体，只完成部分目标再结案会破坏语义）。
        // 三判据不变：①quote 引用文本一致；②时间相邻（双向 ≤1 条 incoming）；③同批归档记录。
        const targetFollowsMedia = target => {
          if (typeof target.message.reference?.text === 'string' && target.message.reference.text.trim() && manualMediaRecords.some(entry => (entry.incoming ?? []).some(message => message.media && typeof message.reference?.text === 'string' && message.reference.text === target.message.reference.text))) return true;
          const mediaIndex = messages.findIndex(message => message.id && manualMediaMessageIds.has(message.id));
          if (mediaIndex < 0) return false;
          // 时间相邻（双向）：媒体与文本直接相邻（中间无其他 incoming）——紧邻追问才关联；
          // 隔 1 条以上 incoming 的独立问题不关联（P2-1 连坐收窄：远处独立问题照常推进）。
          const betweenAfter = target.index > mediaIndex ? messages.slice(mediaIndex + 1, target.index).filter(message => message.sender === 'incoming').length : 0;
          const betweenBefore = target.index < mediaIndex ? messages.slice(target.index + 1, mediaIndex).filter(message => message.sender === 'incoming').length : 0;
          return betweenAfter === 0 && betweenBefore === 0;
        };
        const followItems = ready.filter(item => item.mapped.targets.some(targetFollowsMedia));
        if (followItems.length) {
          ready = ready.filter(item => !followItems.includes(item));
          for (const hit of followItems) {
            this.markNeedsManual(hit.record, 'media-unobservable');
            this.log('backlog.media_needs_manual', { recipientId: contact.id, archiveId: hit.record.archiveId, message: '该待答的文本指向已转人工的媒体内容（时间相邻、同批或引用关联），跟随转人工，不脱离媒体盲答。' });
          }
          // 三审 P1：过滤完成后统一重建队列凭据——archiveIds/targets/key/pending.backlogAuthorization 全部以
          // 剩余 ready 重算，保证回执命中时 restoreBacklogReceipt 不会把已转人工的追问一起 settle。
          const rebuiltArchiveIds = ready.map(item => item.record.archiveId);
          if (!rebuiltArchiveIds.length) { this.backlogPause(mark, 'waiting-media-manual'); return; }
          const rebuiltTargets = [...new Map(ready.flatMap(item => item.mapped.targets).map(item => [item.message.id, item])).values()].sort((left, right) => left.index - right.index);
          const rebuiltKey = createHash('sha256').update(JSON.stringify([contact.id, rebuiltArchiveIds.slice().sort(), rebuiltTargets.map(item => [item.message.id, item.fingerprint])])).digest('hex');
          archiveIds = rebuiltArchiveIds; targets = rebuiltTargets; key = rebuiltKey;
          queue = mark.autoBacklog = { version: 1, source: 'authorized-unsent-backlog-v1', key: rebuiltKey, archiveIds: rebuiltArchiveIds, generationAttempts: 0, retryCount: 0 };
          queue.targets = rebuiltTargets.map(item => ({ id: item.message.id, fingerprint: item.fingerprint })); queue.authorizationContact = structuredClone(contact);
          if (mark.pending?.backlogAuthorization) { mark.pending.backlogAuthorization.archiveIds = [...rebuiltArchiveIds]; mark.pending.backlogAuthorization.targets = queue.targets.map(item => ({ ...item })); }
          this.persist();
        }
        if (!ready.length && manualMediaMessageIds.size > 0) { this.backlogPause(mark, 'waiting-media-manual'); return; }
        const chosen = new Set([...targets.map(item => item.message.id), ...eligibleContext.slice(-(12 - targets.length)).map(item => item.id)]);
        const context = eligibleContext.filter(message => chosen.has(message.id)).map(message => structuredClone(message));
        if (context.length > 12 || targets.some(item => !context.some(message => message.id === item.message.id))) { this.backlogPause(mark, 'waiting-target-context-capacity'); return; }
        const contextKey = createHash('sha256').update(JSON.stringify(messageContent(context))).digest('hex');
        queue.generationContexts ??= {};
        const budget = queue.generationContexts[contextKey] ??= { attempts: 0, windowStartedAt: Date.now() };
        if (!Number.isFinite(budget.windowStartedAt)) budget.windowStartedAt = Date.now();
        if (Number.isFinite(budget.windowStartedAt) && Date.now() - budget.windowStartedAt >= 30 * 60_000) { budget.attempts = 0; budget.windowStartedAt = Date.now(); }
        if (budget.attempts >= 3) { this.backlogPause(mark, 'waiting-context-after-bounded-generation'); return; }
        budget.attempts++; queue.generationAttempts = (queue.generationAttempts || 0) + 1; queue.state = 'model';
        while (Object.keys(queue.generationContexts).length > 32) delete queue.generationContexts[Object.keys(queue.generationContexts)[0]];
        this.watermarks.days[dayKey()] = (this.watermarks.days[dayKey()] || 0) + 1; this.persist();
        try { const reply = await this.agent.reply({ messages: context, mediaObservations: [], conversation: { displayName: contact.name, isGroup: contact.isGroup }, signal }); signal.throwIfAborted(); queue.text = normalizeChatReplyText(reply.text); queue.usage = reply.usage; queue.replySource = 'one-current-context-regeneration'; }
        catch (error) { if (signal.aborted) throw error; this.backlogPause(mark, 'bounded-generation-failed'); return; }
      }
      queue.watermark = messageWatermark(messages, snapshot); this.persist();
    }
    if (typeof queue.text !== 'string' || !queue.text || [...queue.text].length > 1000) { this.backlogPause(mark, 'waiting-generated-text'); return; }
    mark.pending = { phase: 'auto-backlog', incoming: targets.map(item => structuredClone(item.message)), generatedText: queue.text, at: new Date().toISOString(), backlogAuthorization: { version: 1, source: 'authorized-unsent-backlog-v1', contact: structuredClone(contact), archiveIds, targets: targets.map(item => ({ id: item.message.id, fingerprint: item.fingerprint })) } };
    queue.state = 'ready'; this.persist();
    let delivery;
    try { delivery = await this.deliverReply(contact, mark, { text: queue.text, usage: queue.usage }, messages, signal, snapshot, { backlog: true }); }
    catch (error) { if (signal.aborted) throw error; delivery = { confirmed: false, deliveryUncertain: ready.some(item => ['reserved', 'uncertain'].includes(item.record.autoAttempt?.state)) }; }
    if (delivery?.confirmed === true && delivery.messageId) {
      queue.receipt = { confirmed: true, messageId: delivery.messageId, key, at: new Date().toISOString(), archiveIds, targets: targets.map(item => ({ id: item.message.id, fingerprint: item.fingerprint })) }; this.recordProgressed(mark); this.persist();
      // C2：混合记录（targets 含媒体，媒体部分已拆给人工）的文字目标随本次发送结案时，只按本次队列实际覆盖的
      // 文字目标粒度结案；若记录还有媒体目标未处理，不得整条结案——标记媒体需人工并保持 open。
      // P1-1：文字目标的发送结果持久化到 targetStates（混合记录读回与恢复都按目标粒度核对）。
      for (const item of ready) {
        const recordMediaTargets = item.record.incoming?.filter(message => message.media || (message.kind && message.kind !== 'text')) ?? [];
        const mediaStillOpen = recordMediaTargets.length > 0;
        for (const target of item.mapped.targets) this.setTargetState(item.record, target.message.id, 'confirmed', { method: 'confirmed-platform-reply', messageId: delivery.messageId });
        if (mediaStillOpen) {
          this.markNeedsManual(item.record, 'media-unobservable');
          this.log('backlog.media_needs_manual', { recipientId: contact.id, archiveId: item.record.archiveId, message: '混合待答的文字目标已随本次回复结案，媒体目标无法自动补答（媒体观察不持久化），保持待答并由人工处理。' });
          this.persist();
          continue;
        }
        this.settleBacklog(item.record, delivery.messageId, 'confirmed-platform-reply');
      }
      queue.state = 'complete'; queue.nextRetryAt = null; queue.retryCount = 0;
    } else {
      for (const item of ready) {
        // P1-1：发送不明/未点击——文字目标子状态持久化（uncertain=发送不明，zero-click=未发送可重试），恢复流程按此继续核对文字。
        if (item.record.autoAttempt || delivery?.deliveryUncertain === true) item.record.autoAttempt = { ...(item.record.autoAttempt || { version: 1, source: 'authorized-unsent-backlog-v1', text: queue.text, at: new Date().toISOString() }), state: delivery?.deliveryUncertain === true ? 'uncertain' : 'zero-click' };
        for (const target of item.mapped.targets) this.setTargetState(item.record, target.message.id, delivery?.deliveryUncertain === true ? 'uncertain' : 'zero-click', { text: queue.text });
      }
      this.backlogPause(mark, delivery?.deliveryUncertain === true ? 'waiting-native-outgoing-readback' : 'waiting-zero-click-retry');
    }
    if (mark.pending?.backlogAuthorization) delete mark.pending;
    mark.status = 'ready'; mark.reason = ''; this.persist();
  }

  async deliverReply(contact, mark, reply, latest, signal, evidence = {}, { backlog = false } = {}) {
    reply={...reply,text:normalizeChatReplyText(reply?.text)};
    const expectedWatermark = messageWatermark(latest, evidence), expectedContent = expectedWatermark.content;
    let entered = false, delivery, imageAsset = null, imageActive = false, imageDelivered = false;
    try {
      delivery = await this.outbound.run({ recipientId: contact.id, purpose: 'reply', signal }, async () => {
        signal.throwIfAborted(); this.assertOwned();
        const currentPolicy = validatePolicy(load(this.policyFile, this.policy));
        const authorized = currentPolicy.allowlist.find(item => item.id === contact.id);
        if(!readFriendInteractionsEnabled(this.stateDir))throw revokeError(this.stateDir);
        if (!currentPolicy.enabled || !matchesAuthorizedContact(contact, authorized)) throw new Error('回复许可或会话绑定已变化，未发送。');
        if(backlog){const disk=load(this.watermarkFile,this.watermarks).contacts?.[contact.id];if(disk?.autoBacklog?.key!==mark.autoBacklog?.key||mark.autoBacklog.archiveIds.some(id=>!disk.unanswered?.some(item=>item.archiveId===id&&isOpenBacklogRecord(item)&&!['reserved','uncertain'].includes(item.autoAttempt?.state))))return {confirmed:false,deliveryUncertain:false,superseded:true};}
        const current = await this.browser.readConversation(contact.id, { allowed: true, signal, weak: ['manual', 'existing-conversation', 'existing-group'].includes(contact.authorizationKind), backgroundOnly: true });
        const messages = messagesOf(current);
        assertConversationSnapshot(contact, current);
        if (!compareMessageWatermark(expectedWatermark, messages, current).matches) {
          if (!backlog) this.queueSuperseded(contact, mark, mark.pending?.incoming || [], messages); this.persist();
          return { confirmed: false, deliveryUncertain: false, superseded: true };
        }
        const checkAuthorization=phase=>{signal.throwIfAborted();this.assertOwned();const policy=validatePolicy(load(this.policyFile,this.policy));if(!readFriendInteractionsEnabled(this.stateDir))throw revokeError(this.stateDir,phase);if(!policy.enabled||!matchesAuthorizedContact(contact,policy.allowlist.find(item=>item.id===contact.id)))throw new Error('回复许可或会话绑定已撤回，未继续发送。');if(imageActive&&phase==='before-click'&&this.outputAssets?.read(reply.stickerId)?.sha256!==imageAsset?.sha256)throw new Error('表情公开许可或内容已变化。');return true;};
        const authorize=({recipientId,phase}={})=>{if(recipientId!==contact.id||!['prepare','monitor','before-click'].includes(phase))throw new Error('回复发送核对的会话或阶段无效。');return checkAuthorization(phase);};
        authorize.beginDispatch=()=>{const release=acquireFriendInteractionDispatch(this.stateDir);try{checkAuthorization();if(backlog)this.reserveBacklogDispatch(mark);}catch(error){release();throw error;}return release;};
        checkAuthorization();entered = true; mark.status = 'inflight'; mark.pending = { ...mark.pending,phase:'sending',text:reply.text,recoveryEvidence:mark.pending.recoveryEvidence?{...mark.pending.recoveryEvidence,beforeDispatch:false}:null,at:new Date().toISOString() }; this.persist();
        const args = { allowed: true, signal, expectedContact: contact, expectedMessageIds: latest.map(item => item.id), expectedMessageContent: expectedContent, expectedMessageEvidence: { chronology: expectedWatermark.chronology, latestEndVerified: expectedWatermark.latestEndVerified }, authorize, weak: ['manual', 'existing-conversation', 'existing-group'].includes(contact.authorizationKind), backgroundOnly: true };
        if (!backlog && /^sticker:[a-f0-9]{64}$/.test(reply.stickerId || '') && this.outputAssets && typeof this.browser.sendImageMessage === 'function') {
          try { imageAsset = this.outputAssets.read(reply.stickerId); } catch { this.log('reply.sticker_unavailable', { recipientId: contact.id }); }
          if (imageAsset) {
            imageActive = true;
            const image = await this.browser.sendImageMessage(contact.id, imageAsset, args);
            imageActive = false;
            if (image?.confirmed === true) { imageDelivered = true; return image; }
            if (this.browser.canFallbackFromImage?.(image, contact.id) !== true) return image;
            this.log('reply.sticker_zero_input_fallback', { recipientId: contact.id, failureCode: image.failureCode });
          }
        }
        checkAuthorization();
        return this.browser.sendMessage(contact.id, reply.text, args);
      });
    } catch (error) {
      if (!entered && error.beforeDelivery && error.code === 'OUTBOUND_BUSY') {
        mark.status = 'ready'; mark.pending = { ...mark.pending, phase: 'outbound-wait', generatedText: reply.text, ...(reply.stickerId?{stickerId:reply.stickerId}:{}), expectedContent, expectedWatermark, usage: reply.usage, at: new Date().toISOString() }; this.persist(); this.log('reply.waiting_for_sender', { recipientId: contact.id }); return {confirmed:false,deliveryUncertain:false,waiting:true};
      }
      if (!entered) throw error;
      if(error.code==='CHAT_MAINTENANCE_REVOKED'&&error.safeBeforeDispatch&&mark.pending?.recoveryEvidence){mark.pending.recoveryEvidence.beforeDispatch=true;mark.pending.phase='stopped-before-send';allowMaintenanceRecovery(mark.pending);mark.status='ready';mark.reason='维护前未开始发送，待核对消息恢复。';this.persist();return;}
      mark.status = 'delivery-uncertain'; mark.reason = '发送中断或失败，需人工核对；不会自动重发。'; this.persist(); this.log('delivery.uncertain', { recipientId: contact.id, message: error.message }); return {confirmed:false,deliveryUncertain:true};
    }
    if (delivery?.superseded) { this.log('reply.superseded', { recipientId: contact.id }); return delivery; }
    if (delivery?.confirmed !== true || typeof delivery.messageId !== 'string' || !delivery.messageId.trim()) {
      const notSent = delivery?.confirmed === false && delivery.deliveryUncertain === false;
      mark.status = notSent ? 'paused' : 'delivery-uncertain'; mark.reason = notSent ? '发送前检查未通过，未点击发送；请核对会话与输入框状态。' : '未取得发送确认，需人工核对；不会自动重发。';
      if (notSent) {mark.pending.phase = 'not-sent';if(mark.pending.recoveryEvidence)mark.pending.recoveryEvidence.beforeDispatch=true;}
      this.persist(); this.log(notSent ? 'reply.not_sent' : 'delivery.uncertain', { recipientId: contact.id, failureCode: delivery?.failureCode || null, failureStage: delivery?.failureStage || null }); return delivery;
    }
    mark.status = 'ready'; mark.reason = ''; mark.context.push(imageDelivered ? { id: delivery.messageId, sender: 'outgoing', text: '', kind: 'image', media: { type: 'image', label: imageAsset.remark, understandingScope: 'confirmed-outgoing-public-sticker' } } : { id: delivery.messageId, sender: 'outgoing', text: reply.text }); mark.context = mark.context.slice(-12);
    mark.seen.push(delivery.messageId); delete mark.pending; this.persist();
    this.recordProgressed(mark);
      this.log('reply.sent', { recipientId: contact.id, text: imageDelivered ? '' : reply.text, ...(imageDelivered?{mediaType:'image'}:{}), messageId: delivery.messageId, usage: reply.usage, ...(reply.memoryEvidence?{memoryEvidence:reply.memoryEvidence}:{}) }); return delivery;
  }
  async poll() {
    if (!this.running) return;
    if(!readFriendInteractionsEnabled(this.stateDir)){const maintenance=maintenanceActive(this.stateDir);this.stop({preservePending:maintenance,reason:maintenance?'settings-update':'master-off'});return;}
    if (this.busy) { this.pollRequested = true; return; }
    this.assertOwned();
    this.pollRequested = false; this.busy = true; const signal = this.abort.signal;
    try {
      const prioritized = [...this.policy.allowlist].sort((left, right) => Number(this.incomingPriority.has(right.id)) - Number(this.incomingPriority.has(left.id)));
      const dueBacklog=new Set(prioritized.filter(contact=>this.autoDue(this.watermarks.contacts[contact.id])).map(contact=>contact.id));
      // 带恢复队列的会话必须读取：恢复核对不依赖未读角标，漏掉会让重启恢复条件失效。
      const recovering=new Set(prioritized.filter(contact=>this.watermarks.contacts[contact.id]?.recoveryQueue).map(contact=>contact.id));
      let toRead = new Set(prioritized.map(contact => contact.id));
      if (typeof this.browser.unreadCounts === 'function') {
        const now = Date.now(), fullScan = !this.lastFullScanAt || now - this.lastFullScanAt >= this.fullScanIntervalMs;
        if (fullScan) { this.lastFullScanAt = now; this.unreadProbeUnavailable = false; }
        else if (this.unreadProbeUnavailable) { if(!dueBacklog.size&&!recovering.size)return;toRead=new Set([...dueBacklog,...recovering]); }
        else {
          try {
            const hints = await this.browser.unreadCounts(prioritized.map(contact => contact.id), { signal });
            if (hints.available === true && hints.counts && typeof hints.counts === 'object') {
              this.unreadProbeUnavailable = false;
              const unread = new Set(Object.entries(hints.counts).filter(([, count]) => Number(count) > 0).map(([id]) => id));
              toRead = new Set([...this.incomingPriority, ...unread, ...dueBacklog, ...recovering]);
              if (!toRead.size) return;
            } else { this.lastFullScanAt = now; this.unreadProbeUnavailable = true; }
          } catch { this.lastFullScanAt = now; this.unreadProbeUnavailable = true; }
        }
      }
      for (let contact of prioritized) {
        if (!toRead.has(contact.id)) continue;
        this.incomingPriority.delete(contact.id);
        signal.throwIfAborted(); this.assertOwned(); const mark = this.watermarks.contacts[contact.id];
        if(!mark)continue;
        if(['inflight','delivery-uncertain'].includes(mark.status)&&mark.pending){archivePending(mark,mark.pending,'发送不明保留原审计，自动读回，不重复发送。');delete mark.pending;mark.status='ready';this.persist();}
        if(mark.status==='paused'){
          if(mark.identityReviewRequired&&Date.now()<(Date.parse(mark.autoBacklog?.nextRetryAt)||0))continue;
          if(mark.pending?.phase==='sending'||mark.pending?.recoveryEvidence?.beforeDispatch===false)continue;
          if(mark.pending&&!mark.identityReviewRequired){archivePending(mark,mark.pending,'先前未完成的待答进入自动整理，继续接收可靠新消息。');delete mark.pending;}
          mark.status='ready';mark.reason='';this.persist();
        }
        if(mark.status!=='ready')continue;
        try {
          const snapshot = await this.browser.readConversation(contact.id, { allowed: true, signal, weak: ['manual', 'existing-conversation', 'existing-group'].includes(contact.authorizationKind), backgroundOnly: true }); signal.throwIfAborted();
          // 消息链路证据：页面就绪、消息读取时间戳、会话身份核对与消息集合变化。浏览器层未提供证据时记为 null，
          // 如实标注“无法证明”，不冒充已核对；仅在首读、集合变化、证据明确缺失或距上次记录满5分钟时写事件，避免刷日志。
          if (snapshot.contact && Array.isArray(snapshot.messages)) {
            const rows = snapshot.messages, messageSet = rows.map(item => item?.id).join(','), nowMs = Date.now();
            const previousEvidence = this.readEvidence.get(contact.id);
            const evidence = { pageReady: snapshot.pageReadyEvidence ? snapshot.pageReadyEvidence.pageReady === true : null, pageUrlSource: snapshot.pageReadyEvidence?.pageUrlSource ?? null, conversationIdentityChecked: snapshot.pageReadyEvidence ? snapshot.pageReadyEvidence.conversationIdentityChecked === true : null, identitySamples: snapshot.pageReadyEvidence?.identitySamples ?? null, clickSkipped: snapshot.pageReadyEvidence?.clickSkipped ?? null, observedAt: snapshot.readEvidence?.observedAt ?? snapshot.dayEvidence?.observedAt ?? null, readAt: snapshot.readEvidence?.readAt ?? new Date().toISOString(), messageCount: snapshot.readEvidence?.messageCount ?? rows.length, nativeIdCount: snapshot.readEvidence?.nativeIdCount ?? null, latestEndVerified: snapshot.dayEvidence?.latestEndVerified ?? null, chronology: snapshot.dayEvidence?.chronology ?? null, messageSetChanged: previousEvidence ? previousEvidence.messageSet !== messageSet : true, messageSet };
            const shouldLog = !previousEvidence || evidence.messageSetChanged || evidence.pageReady === false || evidence.conversationIdentityChecked === false || nowMs - (previousEvidence.lastLoggedAt ?? 0) >= 300_000;
            this.readEvidence.set(contact.id, { ...evidence, lastLoggedAt: shouldLog ? nowMs : previousEvidence.lastLoggedAt });
            if (shouldLog) this.log('message.read_evidence', { recipientId: contact.id, pageReady: evidence.pageReady, pageUrlSource: evidence.pageUrlSource, conversationIdentityChecked: evidence.conversationIdentityChecked, identitySamples: evidence.identitySamples, clickSkipped: evidence.clickSkipped, observedAt: evidence.observedAt, readAt: evidence.readAt, messageCount: evidence.messageCount, nativeIdCount: evidence.nativeIdCount, latestEndVerified: evidence.latestEndVerified, chronology: evidence.chronology, messageSetChanged: evidence.messageSetChanged });
          }
          const verified = verifiedAuthorizedContact(contact, snapshot.contact);
          assertConversationSnapshot(verified, snapshot);
          contact = this.refreshAuthorizedContact(contact, verified);delete mark.identityReviewRequired;delete mark.accountActionRequired;
          const messages = messagesOf(snapshot);this.rememberReplyQualifications(contact, messages);let restored=[],restoreEvidence;
          this.qualifyNativeBacklog(contact, mark, snapshot, messages);
          if(mark.recoveryQueue){restoreEvidence=mark.recoveryQueue.recoveryEvidence;restored=recoverableIncoming(mark.recoveryQueue,contact,messages,load(this.stopFile,null))||[];if(!restored.length){if(certainUnsentPending(mark.recoveryQueue)){this.log('recovery.certain_unsent_recheck_failed',{recipientId:contact.id,phase:mark.recoveryQueue.phase,message:'确定未发送的待答回读资格未通过（消息或会话已变化），转人工待答，不补发。'});archivePending(mark,mark.recoveryQueue,'重启前确定未发送，但回读时消息、会话或停止许可已经变化；宁可不发也不重复发。');}else archivePending(mark,mark.recoveryQueue,'维护恢复前消息、会话或停止许可已经变化，未补发旧待答。');}delete mark.recoveryQueue;this.persist();}
          if (hasStableConversationIdentity(contact) && mark.pending && mark.pending.phase !== 'handled-by-user' && (!matchesAuthorizedContact(mark.pending.recoveryEvidence?.contact, contact) || !matchesAuthorizedContact(contact, mark.pending.recoveryEvidence?.contact))) {
            archivePending(mark, mark.pending, '待答记录的旧身份凭据无法与当前稳定身份双向核对，仅留人工待答。'); delete mark.pending; this.persist();
          }
          if (mark.pending?.phase === 'outbound-wait') {
            const latest = messagesOf(snapshot);
            if (compareMessageWatermark(mark.pending.expectedWatermark ?? { content: mark.pending.expectedContent, chronology: 'unknown', latestEndVerified: false }, latest, snapshot).matches) {
              await this.deliverReply(contact, mark, { text: mark.pending.generatedText, usage: mark.pending.usage, stickerId: mark.pending.stickerId }, latest, signal, snapshot); continue;
            }
            this.queueSuperseded(contact, mark, mark.pending?.incoming || [], messages); this.persist();
          }
          const seen = new Set(mark.seen);
          const retry = this.takeSuperseded(contact, messages), retried = retry.incoming; delete mark.retry;
          const qualified = this.qualifiedEvidence(contact, messages), qualifiedIds = new Set([...qualified.map(item => item.message.id), ...retry.qualifiedIncoming.map(item => item.message.id)]);
          restoreEvidence = { ...restoreEvidence, qualifiedIncoming: [...(restoreEvidence?.qualifiedIncoming || []), ...qualified, ...retry.qualifiedIncoming] };
          const discovered = messages.filter((item) => !seen.has(item.id));
          const oldHistory = discovered.filter((item) => ['baseline', 'known-old-window', 'old-history'].includes(item.arrivalClassification) && !qualifiedIds.has(item.id));
          const restoredIds=new Set(restored.map(item=>item.id));const fresh=[...new Map([...restored,...retried,...discovered.filter(item=>!oldHistory.includes(item)&&!restoredIds.has(item.id))].map(item=>[item.id,item])).values()];
          if (fresh.some((item) => item.sender === 'unknown')) { mark.pending = { phase: 'unclassified', incoming: fresh.map((item) => ({ id: item.id, sender: item.sender, text: item.text || '' })), at: new Date().toISOString() }; throw new Error('新消息方向未确认，联系人已暂停，消息未计入已处理水位。'); }
          mark.seen = [...seen, ...discovered.map((item) => item.id)].slice(-2000); mark.lastCheckedAt = new Date().toISOString(); this.persist();
          // P1-1：needs-manual 记录的文字目标在途时，即使本轮有新消息（含新 outgoing）也要继续读回核对，不能被 fresh 阻塞。
          for (const record of this.autoRecords(mark)) if (record.needsManual === true && this.mixedRecordHasTextInFlight(record)) this.readbackMixedRecordText(record, mark, messages);
          if (oldHistory.length) this.log('message.old_history_skipped', { recipientId: contact.id, messageIds: oldHistory.map((item) => item.id), message: '已知旧窗口或加载的历史行只更新水位，不回复。' });
          if (!fresh.length) {await this.processAutoBacklog(contact,mark,snapshot,messages,signal);continue;}
          const supported=isReplyableMessage;
          const unsupported = fresh.filter((item) => item.sender === 'incoming' && !supported(item));
          if (unsupported.length) this.log('message.unsupported', { recipientId: contact.id, messageIds: unsupported.map((item) => item.id), message: '没有可靠消息采集证据的附件、撤回或未知消息已跳过。' });
          const needsManual=unsupported.filter(item=>item.nonReplyableNotice!==true&&!['recalled','withdrawn','system','system-notice'].includes(item.kind)&&!['recalled','withdrawn','system','system-notice'].includes(item.type)&&(contact.isGroup!==true||groupMessageAddressesFish(item,this.policy.groupMentionNames)));
          if(needsManual.length){archivePending(mark,{phase:'unsupported-media',incoming:needsManual.map(item=>({id:item.id,kind:item.kind||null,type:item.type||null,mediaType:item.media?.type||null,unsupported:true}))},'新消息包含尚未可靠采集的附件，未编造内容或假装已理解，请人工查看。');this.persist();}
          mark.context = [...mark.context, ...fresh.filter((item) => ['incoming', 'outgoing'].includes(item.sender) && !unsupported.includes(item) && supported(item) && !mark.context.some(previous => previous.id === item.id))].slice(-12); this.persist();
          const incoming = fresh.filter((item) => item.sender === 'incoming' && !unsupported.includes(item) && (contact.isGroup !== true || groupMessageAddressesFish(item, this.policy.groupMentionNames)));
          if (this.groupVideos && contact.isGroup === true) { try { const added=this.groupVideos.enqueue(contact,fresh.filter(item=>!unsupported.includes(item)));if(added)this.log('group_video.queued',{recipientId:contact.id,count:added}); } catch { this.log('group_video.queue_unavailable',{recipientId:contact.id,code:'GROUP_VIDEO_JOURNAL_UNAVAILABLE'}); } }
          if (!incoming.length) { if (fresh.some((item) => item.sender === 'outgoing') && mark.pending?.phase === 'superseded') { mark.pending.phase = 'handled-by-user'; this.persist(); this.log('reply.handled_by_user', { recipientId: contact.id }); } await this.processAutoBacklog(contact,mark,snapshot,messages,signal);continue; }
          this.groupVideos?.interrupt();
          if (incoming.some((item) => item.eligibleForReply !== true&&!restoredIds.has(item.id)&&!qualifiedIds.has(item.id))) { mark.pending = { phase: 'unqualified', incoming: incoming.map((item) => ({ id: item.id, text: item.text })), at: new Date().toISOString() }; throw new Error('新消息尚未取得可靠的新到达资格，联系人已暂停。'); }
          const lastIncoming = messages.findLastIndex((item) => incoming.some((freshItem) => freshItem.id === item.id));
          if (messages.slice(lastIncoming + 1).some((item) => item.sender === 'outgoing')) { this.log('message.handled_by_user', { recipientId: contact.id, messageIds: incoming.map((item) => item.id) }); mark.pending = { phase: 'handled-by-user', incoming: incoming.map((item) => ({ id: item.id, text: item.text })), at: new Date().toISOString() }; this.persist(); continue; }
          const date = dayKey();
          const evidence=recoveryEvidence(contact,incoming,messages,restoreEvidence,load(this.stopFile,null));const pendingIncoming=structuredClone(incoming);
          const mediaObservations=[];
          const referenced = referencedSharedWork(contact, incoming, mark.context, messages);
          let replyContext = mark.context;
          if (referenced.some(message => !replyContext.some(item => item.id === message.id))) {
            const chosen = new Map([...replyContext.slice(-11), ...referenced].map(message => [message.id, message]));
            replyContext = [...chosen.values()].sort((left, right) => messages.findIndex(message => message.id === left.id) - messages.findIndex(message => message.id === right.id));
          }
          const mediaMessages = [...incoming.filter(item=>item.media && !isMetadataMessage(item)), ...referenced];
          if(mediaMessages.length) {mark.pending={phase:'observing',incoming:pendingIncoming,recoveryEvidence:evidence,at:new Date().toISOString()};this.persist();}
          for(const item of mediaMessages) {
            if (referenced.includes(item) && mediaObservations.reduce((count,entry)=>count+entry.frames.length,0)>=4) continue;
            if(item.media.type!=='voice' && mediaObservations.reduce((count,entry)=>count+entry.frames.length,0)>=4) {
              mediaObservations.push({messageId:item.id,media:{type:item.media.type},frames:[],understandingScope:'message-not-observed-budget',note:'同批附件较多，本条未采集画面；不能声称看懂其内容，可自然请对方指出要讨论的那一条。'}); continue;
            }
            let observed;
            try { observed=this.groupVideos?.previousObservation(contact,item) || await this.observeMessage(contact.id,item.id,{signal}); }
            catch(error) {
              if(item.media.type!=='shared-work') throw error;
              signal.throwIfAborted();
              this.log('message.media_skipped',{recipientId:contact.id,messageIds:[item.id],message:'分享卡片没有可核对的画面或链接，跳过本次媒体观察，继续回复。'});
              observed = { messageId: item.id, media: { type: 'shared-work', title: item.media.title, author: item.media.author }, frames: [], understandingScope: 'card-metadata-only', note: '分享作品观察没有完成，没有视频画面证据，不能声称已经看过。' };
            }
            const remaining=4-mediaObservations.reduce((count,entry)=>count+entry.frames.length,0);
            mediaObservations.push({...observed,frames:observed.frames.slice(0,remaining),...(observed.frames.length>remaining?{note:(observed.note||'')+' 本轮只附上其中部分画面，未附画面不能当作已看见。'}:{})});
          }
          this.watermarks.days[date] = (this.watermarks.days[date] ?? 0) + 1;
          mark.pending = { phase: 'model', incoming:pendingIncoming,recoveryEvidence:evidence, at: new Date().toISOString() }; this.persist();
          this.log('message.received', { recipientId: contact.id, messages: incoming.map((item) => ({ id: item.id, text: item.text })) });
          const outputCatalog = this.outputAssets?.catalog() ?? [];
          const reply = await this.agent.reply({ messages: replyContext, mediaObservations, outputCatalog, conversation: { displayName: contact.name, isGroup: contact.isGroup }, signal }); signal.throwIfAborted();
          if(this.groupVideos&&contact.isGroup===true)for(const item of mediaMessages){const observed=mediaObservations.find(value=>value.messageId===item.id);if(observed)try{this.groupVideos.adoptReplyObservation(contact,item,observed,reply.text);}catch{this.log('group_video.note_unavailable',{recipientId:contact.id,code:'GROUP_VIDEO_JOURNAL_UNAVAILABLE'});}}
          mark.pending.generatedText = reply.text; if(reply.stickerId)mark.pending.stickerId=reply.stickerId; this.persist();
          // 生成期间若用户已经回复，或对方又发消息，跳过本次发送。
          const latestSnapshot = await this.browser.readConversation(contact.id, { allowed: true, signal, weak: ['manual', 'existing-conversation', 'existing-group'].includes(contact.authorizationKind), backgroundOnly: true }); signal.throwIfAborted();
          assertConversationSnapshot(contact, latestSnapshot);
          const latest = messagesOf(latestSnapshot);this.rememberReplyQualifications(contact, latest);
          if (latest.some((item) => item.sender === 'unknown') || incoming.some((item) => !latest.some((current) => current.id === item.id && current.sender === 'incoming' && messageFingerprint(current)===messageFingerprint(item)))) { mark.pending.phase = 'superseded'; mark.pending.readback = latest.filter((item) => incoming.some((before) => before.id === item.id)).map((item) => ({ id: item.id, sender: item.sender, kind: item.kind, text: item.text })); throw new Error('待回复消息在生成期间被撤回、改动或方向不明，未发送。'); }
          if (!compareMessageWatermark(messageWatermark(messages, snapshot), latest, latestSnapshot).matches) {
            this.queueSuperseded(contact, mark, incoming, latest);
            this.persist(); this.log('reply.superseded', { recipientId: contact.id }); continue;
          }
          await this.deliverReply(contact, mark, reply, latest, signal, latestSnapshot);
        } catch (error) {
          if (error.code === 'CHAT_SNAPSHOT_CHANGED' && !mark.pending && mark.status !== 'inflight') {
            mark.status = 'ready'; mark.reason = '消息列表正在更新，等待下一次可靠快照。'; this.persist();
            this.log('message.snapshot_changed', { recipientId: contact.id, message: mark.reason });
            continue;
          }
          if (error.code === 'CHAT_PAGE_NOT_OPEN') {
            mark.status = 'ready'; mark.reason = '消息页未打开；打开抖音消息页后继续检查。'; this.persist();
            this.log('message.page_closed', { recipientId: contact.id, message: '消息页未打开，未切换页面，等待本人打开消息页。' });
            continue;
          }
          if (error.code === 'CHAT_FOREGROUND') {
            mark.status = 'ready'; mark.reason = '专用浏览器在前台；切到后台或最小化后继续检查。'; this.persist();
            this.log('message.foreground', { recipientId: contact.id, message: '专用浏览器在前台，未切换私信页。' });
            continue;
          }
          if (error.code === 'BROWSER_NOT_RUNNING') {
            mark.status = 'ready'; mark.reason = '专用浏览器未运行；打开抖音后继续检查。'; this.persist();
            this.log('message.browser_closed', { recipientId: contact.id, message: '专用浏览器未运行，未自动打开。' });
            continue;
          }
          if (mark.status === 'inflight') { mark.status = 'delivery-uncertain'; mark.reason = '发送被中断，需要人工核对。'; }
          else if(signal.aborted||error.code==='CHAT_MAINTENANCE_REVOKED'){mark.status='ready';mark.reason='';if(mark.pending){mark.pending.phase='stopped-before-send';mark.pending.restartAllowed=(this.stopContext?.preservePending===true||error.code==='CHAT_MAINTENANCE_REVOKED')&&mark.pending.recoveryEvidence?.beforeDispatch===true;if(mark.pending.restartAllowed)allowMaintenanceRecovery(mark.pending);mark.reason=mark.pending.restartAllowed?'维护前未开始发送，待核对消息恢复。':'停止前的未答消息已保留，默认不补发。';}}
          else { mark.status='paused';mark.reason=redact(error.message,[this.config?.apiKey]);mark.accountActionRequired=error.needsUserAction===true; if(error.code==='CHAT_CONVERSATION_IDENTITY_MISMATCH')mark.identityReviewRequired=true;this.backlogPause(mark,'waiting-contact-recheck'); }
          this.persist(); if (!signal.aborted) this.log('contact.paused', { recipientId: contact.id, message: mark.reason });
        }
      }
    } finally { this.busy = false; if (!this.running) this.release(); else { if (this.pollRequested) this.requestPoll();this.startGroupVideos(); } }
  }
  async close() { this.stopPolling(); if (this.runId) this.stop(); while (this.busy || this.starting || this.groupVideos?.running) await new Promise((resolve) => setTimeout(resolve, 20));await this.groupVideoDrain?.catch(()=>{}); await Promise.allSettled([this.notificationsTask, this.notificationCleanup]); await this.browser.close?.(); if(this.inspectorPromise) await this.inspectorPromise.then(inspector=>inspector.close()).catch(()=>{}); }
}
