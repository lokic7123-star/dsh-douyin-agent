import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ApiAgent, redact, watchDecisionMessages, parseWatchDecision } from './api-agent.mjs?v=13';
import { resolveRuntimePaths } from './runtime-paths.mjs';
import { AutonomousShare, isSharePreflightNotSent } from './autonomous-share.mjs?v=9';
import { AutonomousComments } from './autonomous-comments.mjs?v=9';
import { PublicCommentAgent } from './public-comment-agent.mjs?v=9';
import { DailyReport } from './daily-report.mjs?v=9';

import { WatchOptions } from './watch-options.mjs';
import { UsageLedger } from './usage-ledger.mjs';

export const WATCH_LIMITS = Object.freeze({ sampleSeconds: 3, maxLiveSkips: 3 });
const alive = pid => { if (!Number.isSafeInteger(pid) || pid < 1) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error('自主观看状态文件损坏，未重置预算或运行锁。'); } };
const write = (file, value) => { const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`; try { fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, file); } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } };
const day = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
const failure = (message, watchStatus = 'failed') => Object.assign(new Error(message), { watchStatus });
// 可降级错误集：决策类（格式/截断/超时/许可不符）与运营类（控制器/观察/学习）都走 6 次换片 12 次停车；
// needs_user / limited / stopped 与运行锁丢失（WATCH_LOCK_LOST）不降级，立即终局。
const DEGRADABLE_CODES = ['WATCH_DECISION_FORMAT', 'WATCH_DECISION_INCOMPLETE', 'WATCH_DECISION_TIMEOUT', 'WATCH_DECISION_PERMISSION'];
const NON_DEGRADABLE_CODES = ['WATCH_LOCK_LOST', 'WATCH_SHARE_SERVICE_ERROR'];
const isDegradable = error => DEGRADABLE_CODES.includes(error?.code) || !NON_DEGRADABLE_CODES.includes(error?.code) && (!error?.watchStatus || error.watchStatus === 'failed');
export function readShareProgress(value) {
  const keys=['total','currentIndex','completed','confirmed','notSent','skipped'];
  if(!value||!keys.every(key=>Number.isSafeInteger(value[key])&&value[key]>=0)||value.total<1||value.currentIndex>value.total||value.completed>value.currentIndex||value.confirmed+value.notSent+value.skipped>value.completed||!['sharing','completed','paused'].includes(value.status))return null;
  return Object.fromEntries([...keys.map(key=>[key,value[key]]),['status',value.status]]);
}
const isLivePreview = state => state?.pageKind === 'live-preview' && state.livePreview?.recognized === true && state.livePreview.source === 'active-feed-live-link' && state.livePreview.scope === 'recommend-feed' && /^\d{4,30}$/.test(state.livePreview.roomId || '');
const readyVideo = state => !isLivePreview(state) && /^\d{10,30}$/.test(state?.video?.id || '') && state.video.readyState >= 2;

function switchFailureDiagnostic({ name, output, error, source, runId, now, startedAt, expectedVideoId, stage }) {
  const hash = value => typeof value === 'string' && value.length > 0 && value.length <= 128 ? createHash('sha256').update(value).digest('hex') : null;
  const idHash = value => typeof value === 'string' && /^\d{1,64}$/.test(value) ? hash(value) : null;
  const number = (value, min = 0, max = 1_000_000_000) => Number.isFinite(value) && value >= min && value <= max ? value : null;
  const geometry = value => value && typeof value === 'object' ? Object.fromEntries(['x','y','width','height'].map(key => [key,number(value[key],key === 'x' || key === 'y' ? -1_000_000 : 0,1_000_000)])) : null;
  const video = value => value && typeof value === 'object' ? { idHash:idHash(value.id),readyState:Number.isInteger(value.readyState) ? number(value.readyState,0,4) : null,paused:typeof value.paused === 'boolean' ? value.paused : null,time:number(value.time),duration:number(value.duration),viewport:geometry(value.viewport) } : null;
  const code = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(value) ? value : null;
  const state = output?.state || output || {},selection = state.videoSelection;
  return { version:1,kind:'video-switch-failure',at:new Date(now).toISOString(),source:['api','dsh'].includes(source)?source:null,runIdHash:hash(runId),tool:name,stage:stage==='autonomous-verification'?stage:error?'controller-exception':'controller-result',elapsedMs:number(now-startedAt,0,600_000),expectedVideoIdHash:idHash(expectedVideoId),changed:typeof output?.changed === 'boolean'?output.changed:null,reasonCode:code(output?.reasonCode)||code(error?.code),switchConfirm:['stable','id-seen'].includes(output?.switchConfirm)?output.switchConfirm:null,staleObservation:output?.staleObservation===true,before:video(output?.before),after:video(output?.after||state.video),selection:selection&&typeof selection==='object'?{candidateCount:Number.isSafeInteger(selection.candidateCount)?number(selection.candidateCount,0,512):null,ambiguous:selection.ambiguous===true,identityConflict:selection.identityConflict===true}:null,pageKind:['video','live-preview','search','unknown'].includes(state.pageKind)?state.pageKind:null,blocked:{loginRequired:state.loginRequired===true,verificationRequired:state.verificationRequired===true,privateChatVisible:state.privateChatVisible===true,unsupportedPage:state.unsupportedPage===true} };
}


function readSwitchDiagnostic(value) {
  if (!value || value.version !== 1 || value.kind !== 'video-switch-failure' || !['douyin_next','douyin_previous'].includes(value.tool)) return null;
  const number=(v,min=0,max=1_000_000_000)=>Number.isFinite(v)&&v>=min&&v<=max?v:null,hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)?v:null;
  const geometry=v=>v&&typeof v==='object'?Object.fromEntries(['x','y','width','height'].map(key=>[key,number(v[key],key==='x'||key==='y'?-1_000_000:0,1_000_000)])):null;
  const video=v=>v&&typeof v==='object'?{idHash:hash(v.idHash),readyState:Number.isInteger(v.readyState)?number(v.readyState,0,4):null,paused:typeof v.paused==='boolean'?v.paused:null,time:number(v.time),duration:number(v.duration),viewport:geometry(v.viewport)}:null;
  const at=typeof value.at==='string'&&value.at.length<=40&&Number.isFinite(Date.parse(value.at))?new Date(value.at).toISOString():null,selection=value.selection;
  return{version:1,kind:'video-switch-failure',at,source:['api','dsh'].includes(value.source)?value.source:null,runIdHash:hash(value.runIdHash),tool:value.tool,stage:['controller-result','controller-exception','autonomous-verification'].includes(value.stage)?value.stage:null,elapsedMs:number(value.elapsedMs,0,600_000),expectedVideoIdHash:hash(value.expectedVideoIdHash),changed:typeof value.changed==='boolean'?value.changed:null,reasonCode:typeof value.reasonCode==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(value.reasonCode)?value.reasonCode:null,switchConfirm:['stable','id-seen'].includes(value.switchConfirm)?value.switchConfirm:null,staleObservation:value.staleObservation===true,before:video(value.before),after:video(value.after),selection:selection&&typeof selection==='object'?{candidateCount:Number.isSafeInteger(selection.candidateCount)?number(selection.candidateCount,0,512):null,ambiguous:selection.ambiguous===true,identityConflict:selection.identityConflict===true}:null,pageKind:['video','live-preview','search','unknown'].includes(value.pageKind)?value.pageKind:null,blocked:Object.fromEntries(['loginRequired','verificationRequired','privateChatVisible','unsupportedPage'].map(key=>[key,value.blocked?.[key]===true]))};
}
// API 与原生入口通过同一锁、有限视频轮次和持久预算协调，不在重启时恢复循环。
export class AutonomousWatch {
  constructor({ controller, config = {}, videoLimits, personaMemory, agent, shareService, commentService, commentAgent, reportService, decisionProvider, memoryStore = null, stateDir = resolveRuntimePaths().stateDir, source = 'api', fetchImpl = fetch, now = Date.now, delayImpl = (ms, signal) => delay(ms, undefined, { signal }), onEvent = () => {} } = {}) {
    if (!controller?.execute || !videoLimits?.state || !personaMemory?.context || !['api', 'dsh'].includes(source)) throw new Error('自主观看缺少浏览器、时限或共同人格接口。');
    Object.assign(this, { controller, config, videoLimits, personaMemory, shareService, decisionProvider, memoryStore, stateDir, source, now, delayImpl, onEvent });
    this.optionsService = new WatchOptions({ stateDir });
    this.usageLedger = new UsageLedger({ stateDir, now });
    // 观看决策带 4 帧图 + 2 万字上下文，GLM 经网关常超 60 秒；观看回合单独放宽到 180 秒（硬上限 600 秒）。
    this.agent = agent || new ApiAgent({ controller, config, personaMemory, fetchImpl, apiTimeoutMs: 180_000 });
    Object.assign(this, { commentService, reportService });
    this.agent.usageLedger = this.usageLedger; this.agent.source = source;
    this.commentAgent = commentAgent || new PublicCommentAgent({ config, fetchImpl });
    this.commentAgent.usageLedger = this.usageLedger; this.commentAgent.source = source;
    fs.mkdirSync(stateDir, { recursive: true });
    this.files = Object.fromEntries(['lock', 'guard', 'budget', 'state', 'stop'].map(name => [name, path.join(stateDir, `watch-${name === 'lock' ? 'loop.lock' : name === 'guard' ? 'control.guard' : name === 'stop' ? 'stop.request.json' : name + '.json'}`)]));
    this.files.manual = path.join(stateDir, 'watch-manual.lock');
    this.running = false; this.completion = null; this.abort = null; this.runId = null; this.sessionId = null;
  }
  // 回收空壳锁与死进程留下的锁：只动确定没人持有的。
  // 内容坏掉的锁也不能永远堵在这里：改名归档（内容原样保留在归档文件里），把位置腾出来。
  reclaimStaleGuard() {
    let stat; try { stat = fs.lstatSync(this.files.guard); } catch (error) { return error.code === 'ENOENT'; }
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    if (stat.size === 0) {
      // 刚建好还没写内容的那一瞬间先放过对方：超过半秒还是空的，才当成空壳。
      if (Date.now() - Math.floor(stat.mtimeMs) < 500) return false;
      try { fs.unlinkSync(this.files.guard); return true; } catch { return false; }
    }
    let record; try { record = JSON.parse(fs.readFileSync(this.files.guard, 'utf8')); } catch { return this.archiveCorruptGuard(stat); }
    if (!record || !Number.isSafeInteger(record.pid) || record.pid < 1) return this.archiveCorruptGuard(stat);
    try { process.kill(record.pid, 0); return false; } catch (error) { if (error.code === 'EPERM') return false; if (error.code !== 'ESRCH') return false; }
    try { fs.unlinkSync(this.files.guard); return true; } catch { return false; }
  }
  // 坏掉的锁改名归档：内容一个字都不改，留给本人核对，但不再挡住所有入口。
  archiveCorruptGuard(stat) {
    // 正在写的那一瞬间（刚落盘、内容还没写全）先放过对方。
    if (stat && Date.now() - Math.floor(stat.mtimeMs) < 2000) return false;
    try { fs.renameSync(this.files.guard, `${this.files.guard}.corrupt-${Date.now()}`); return true; } catch { return false; }
  }
  control(action) {
    const token = randomUUID();
    for (let attempt = 0; attempt < 3; attempt++) {
      let descriptor;
      try { descriptor = fs.openSync(this.files.guard, 'wx', 0o600); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        // 锁在「文件建好、内容还没写进去」这一步崩掉，会留下 0 字节空壳，
        // 让所有入口从此一直 409。空壳和死进程留下的锁可以回收；内容坏掉的锁不动，等本人核对。
        if (this.reclaimStaleGuard()) continue;
        throw Object.assign(new Error('自主观看控制记录正被使用，请稍后重试。'), { status: 409, code: 'WATCH_CONTROL_BUSY' });
      }
      try { fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token })); } finally { fs.closeSync(descriptor); }
      try { return action(); }
      finally { let current = null; try { current = read(this.files.guard, null); } catch {} if (current?.token === token && current.pid === process.pid) { try { fs.unlinkSync(this.files.guard); } catch {} } }
    }
    throw Object.assign(new Error('自主观看控制记录正被使用，请稍后重试。'), { status: 409, code: 'WATCH_CONTROL_BUSY' });
  }
  worker() {
    const worker = read(this.files.lock, null);
    if (!worker) return null;
    if (worker.version !== 1 || typeof worker.runId !== 'string' || typeof worker.sessionId !== 'string' || !['api', 'dsh'].includes(worker.source) || !Number.isSafeInteger(worker.pid)) throw new Error('自主观看锁格式无效，请核对原记录。');
    return { ...worker, alive: alive(worker.pid), owned: worker.runId === this.runId && worker.pid === process.pid };
  }
  budget() {
    const value = read(this.files.budget, { version: 1, sessions: {}, days: {} });
    if (!value || value.version !== 1 || !value.sessions || typeof value.sessions !== 'object' || Array.isArray(value.sessions) || !value.days || typeof value.days !== 'object' || Array.isArray(value.days) || Object.values(value.sessions).some(item => !item || !Number.isSafeInteger(item.requests) || item.requests < 0) || Object.values(value.days).some(count => !Number.isSafeInteger(count) || count < 0)) throw new Error('自主观看预算损坏，未重新计数。');
    return value;
  }
  state() {
    const worker = this.worker(), saved = read(this.files.state, {}), time = this.videoLimits.state();
    const historicalSession = typeof saved.sessionId === 'string' && saved.sessionId ? saved.sessionId : null;
    const sessionId = worker?.sessionId || historicalSession || time.session?.id || null;
    const savedMatches = worker ? saved.runId === worker.runId && saved.sessionId === worker.sessionId && saved.source === worker.source : Boolean(historicalSession && saved.sessionId === sessionId);
    const selectedSaved = savedMatches ? saved : {};
    const budget = this.budget(), counts = budget.sessions[sessionId] || { requests: 0 };
    const request = read(this.files.stop, null), stopping = worker?.alive && request?.runId === worker.runId;
    const savedRunMatches = savedMatches && worker?.alive && Number.isFinite(worker.heartbeatAt) && this.now() - worker.heartbeatAt >= 0 && this.now() - worker.heartbeatAt < 5000;
    const ownRun = this.running && worker?.owned && worker.sessionId === this.sessionId && worker.source === this.source;
    return redact({ protocol: 'autonomous-watch-v1', running: Boolean(worker?.alive), owned: Boolean(worker?.owned), worker, status: stopping ? 'stopping' : worker?.alive ? 'running' : ['running', 'stopping'].includes(selectedSaved.status) ? 'stopped' : selectedSaved.status || 'stopped', sessionId, counts: { ...counts, maxRequests:null, dailyRequests: time.daily?.requests ?? budget.days[day(this.now())] ?? 0, dailyLimit: time.policy.dailyRequests ?? null }, phase: ownRun ? this.phase || 'waiting' : savedRunMatches ? selectedSaved.phase || 'waiting' : 'idle', pendingRequests: ownRun ? this.pendingRequests || 0 : savedRunMatches && selectedSaved.pendingRequests === 1 ? 1 : 0, shareProgress: ownRun ? this.shareProgress || null : savedRunMatches ? readShareProgress(selectedSaved.shareProgress) : null, options: this.optionsService.state().policy, lastDecision: selectedSaved.lastDecision || null, lastError: selectedSaved.lastError || '', lastSwitchDiagnostic: readSwitchDiagnostic(selectedSaved.lastSwitchDiagnostic), remainingSeconds: time.allowed && time.session?.id === sessionId ? time.remainingSeconds : 0 }, [this.config.apiKey]);
  }
  save(value) { write(this.files.state, redact({ ...read(this.files.state, {}), ...value, source: this.source, sessionId: this.sessionId, runId:this.runId, updatedAt: new Date(this.now()).toISOString() }, [this.config.apiKey])); }
  assertAllowed() {
    this.abort?.signal.throwIfAborted();
    const worker = this.worker(); if (!worker?.owned) throw Object.assign(failure('自主观看已失去运行锁，停止操作。'), { code: 'WATCH_LOCK_LOST' });
    const time = this.videoLimits.state();
    if ((!time.allowed && !(this.pendingRequests===1 && time.reasonCode==='daily-requests')) || time.session?.id !== this.sessionId || time.session?.status!=='active') throw failure(time.reason || '内部观看运行已结束或改变，原自主观看已停止。', 'limited');
    return time;
  }
  reserveRequest() {
    return this.control(() => {this.assertAllowed();return this.videoLimits.reserveRequest({sessionId:this.sessionId,source:this.source}).requests;});
  }
  claimManual(kind) {
    const token = randomUUID();
    this.control(() => {
      if (this.worker()) throw Object.assign(new Error('请先停止共享自主观看，再执行手动任务。'), { status: 409 });
      const manual = read(this.files.manual, null);
      if (manual && alive(manual.pid)) throw Object.assign(new Error('另一个入口的手动任务或转发仍在执行。'), { status: 409 });
      write(this.files.manual, { pid: process.pid, token, kind });
    });
    return async () => {
      for (let attempt = 0; ; attempt++) {
        try { return this.control(() => { const manual = read(this.files.manual, null); if (manual?.pid === process.pid && manual.token === token) fs.unlinkSync(this.files.manual); }); }
        catch (error) { if (error.code !== 'WATCH_CONTROL_BUSY' || attempt >= 100) throw error; await delay(20); }
      }
    };
  }
  start({ startSession = true, maxRequests: _legacyMaxRequests, expiresAt = null } = {}, { explicit = false } = {}) {
    if (!explicit) throw Object.assign(new Error('自主观看只能由用户明确启动。'), { status: 403 });
    if (expiresAt !== null && expiresAt !== undefined && !Number.isFinite(expiresAt)) throw Object.assign(new Error('自主观看截止时间格式无效。'), { status: 400 });
    if (typeof startSession !== 'boolean') throw Object.assign(new Error('内部启动选项格式无效。'), { status: 400 });
    if (!this.decisionProvider && !this.config.apiKey) throw Object.assign(new Error('请先配置 API Key，再启动自主观看。'), { status: 400 });
    if (this.running || this.completion) throw Object.assign(new Error('当前自主观看正在执行或结束。'), { status: 409 });
    this.optionsService.state();
    read(this.files.state, {});
    this.control(() => {
      const worker = this.worker(); if (worker) throw Object.assign(new Error(worker.alive ? '另一个入口已有自主观看运行。' : '上次自主观看留下运行锁，请先点击停止清理残留。'), { status: 409 });
      const manual = read(this.files.manual, null); if (manual && alive(manual.pid)) throw Object.assign(new Error('另一个入口正在运行手动任务或转发。'), { status: 409, code: 'WATCH_MANUAL_OCCUPIED' });
      let time = this.videoLimits.state();
      if(!time.allowed&&startSession&&time.reasonCode==='disabled'&&!fs.existsSync(path.join(this.stateDir,'watch-schedule-policy.json')))time=this.videoLimits.markSession(this.source,{explicit:true});
      if (time.allowed && (!time.session || time.session.status!=='active')) time=this.videoLimits.markSession(this.source,{explicit:true});
      if (!time.allowed) throw Object.assign(new Error(time.reason || '请先开启有限视频轮次。'), { status: 409 });
      this.personaMemory.initialize?.({ importLegacy: false });
      this.runId = randomUUID(); this.sessionId = time.session.id;
      write(this.files.lock, { version: 1, pid: process.pid, runId: this.runId, sessionId: this.sessionId, source: this.source, status: 'running', heartbeatAt: this.now() });
    });
    this.abort = new AbortController(); this.running = true; this.playbackClosed=false;this.phase='waiting';this.pendingRequests=0;this.startedDate = day(this.now());
    // 一场随机日程有截止时间：到点就收尾，不让这一场无限拖下去。
    this.expiresAt = Number.isFinite(expiresAt) ? expiresAt : null;
    if (this.expiresAt !== null) {
      this.deadline = setTimeout(() => { this.abort?.abort(failure('本场自主观看已到随机日程的结束时间，自动收尾。', 'stopped')); }, Math.max(0, this.expiresAt - this.now()));
      this.deadline.unref?.();
    }
    try {
    this.save({ status: 'running', phase:'waiting',pendingRequests:0,lastError: '', lastDecision: null });
    this.heartbeat = setInterval(() => {
      try {
        const request = read(this.files.stop, null); if (request?.runId === this.runId) this.abort.abort(failure('用户停止自主观看。', 'stopped'));
        this.assertAllowed();
        if(!this.playbackChecking&&typeof this.controller.state==='function'){this.playbackChecking=true;void Promise.resolve(this.controller.state({record:false})).then(state=>{if(this.running&&!this.playbackClosed)this.videoLimits.notePlayback?.(this.source,state,{ownerId:this.runId});}).catch(()=>{}).finally(()=>{this.playbackChecking=false;});}
        this.control(() => { const worker = this.worker(); if (!worker?.owned) throw failure('自主观看锁已改变。'); write(this.files.lock, { ...worker, heartbeatAt: this.now() }); });
      } catch (error) { if (error.code !== 'WATCH_CONTROL_BUSY') this.abort.abort(error); }
    }, 500); this.heartbeat.unref?.();
    // 心跳持续核对最新时段和截止时间，支持不限时长及超过定时器范围的长轮次。
    this.completion = Promise.resolve().then(() => this.run()).catch(error => { this.onEvent({ type: 'watch.failed', message: redact(error.message || String(error), [this.config.apiKey]) }); return { running: false, status: 'failed' }; }).finally(() => { this.completion = null; });
    return this.state();
    } catch (error) {
      clearInterval(this.heartbeat); clearTimeout(this.deadline); this.running = false;
      this.control(() => { if (this.worker()?.owned) fs.unlinkSync(this.files.lock); }); this.runId = null;
      throw error;
    }
  }
  recordSwitchFailure(name, output, {error,startedAt=this.now(),expectedVideoId,stage}={}) {
    if (!['douyin_next','douyin_previous'].includes(name)) return;
    try {
      if (!this.worker()?.owned) return;
      this.save({lastSwitchDiagnostic:switchFailureDiagnostic({name,output,error,source:this.source,runId:this.runId,now:this.now(),startedAt,expectedVideoId,stage})});
    } catch { try { this.onEvent({type:'watch.diagnostic_failed',message:'换片诊断未能保存。'}); } catch {} }
  }
  async execute(name, args = {}, { expectedVideoId } = {}) {
    this.assertAllowed();
    const startedAt = this.now();
    let output;
    try { output = await this.controller.execute(name, args, { signal: this.abort.signal, autonomousRunId: this.runId, ...(expectedVideoId === undefined ? {} : { expectedVideoId }) }); }
    catch (error) { this.recordSwitchFailure(name,null,{error,startedAt,expectedVideoId}); throw error; }
    if (output?.changed !== true) this.recordSwitchFailure(name,output,{startedAt,expectedVideoId});
    this.assertAllowed();
    const state = output?.state || output;
    this.videoLimits.notePlayback?.(this.source,state,{ownerId:this.runId});
    if (state?.loginRequired || state?.verificationRequired || state?.blocked || state?.privateChatVisible || state?.unsupportedPage) throw failure('抖音页面需要手动处理，已停止自主观看。', 'needs_user');
    this.onEvent(redact({ type: 'watch.tool', tool: name, result: output }, [this.config.apiKey]));
    return output;
  }
  async readyAfterModel(current) {
    const deadline = this.now() + 4000;
    for (let attempt = 0; ; attempt++) {
      this.assertAllowed();
      const state = current.state || current;
      let origin; try { origin = new URL(state.url).origin; } catch { /* 暂缺页面资料只作有界回读，不据此输入。 */ }
      if (origin && origin !== 'https://www.douyin.com') throw failure('模型等待后已离开抖音，未执行旧决策。', 'needs_user');
      if (state.video?.paused === true) throw failure('模型等待后播放已暂停，未继续执行旧决策。', 'needs_user');
      if (attempt > 0 && this.now() > deadline) throw failure('模型等待后的作品状态仍未稳定，已停止自主观看。', 'needs_user');
      if (readyVideo(state) && state.video.paused === false) return current;
      if (attempt >= 16 || this.now() >= deadline) throw failure('模型等待后的作品状态仍未稳定，已停止自主观看。', 'needs_user');
      await this.delayImpl(Math.min(250, deadline - this.now()), this.abort.signal); this.assertAllowed();
      current = await this.execute('douyin_status');
    }
  }
  cancel(reason = failure('自主观看已取消。', 'stopped')) { if (this.worker()?.owned) this.abort?.abort(reason); }
  getShareService() {
    if (!this.shareService && this.personaMemory.snapshot) { this.shareService = new AutonomousShare({ controller: this.controller, videoLimits: this.videoLimits, personaMemory: this.personaMemory, stateDir: this.stateDir, source: this.source, now: this.now }); this.ownsShareService = true; }
    return this.shareService;
  }
  shareContext(videoId) { return this.getShareService()?.context({ videoId }) ?? { enabled: false, paused: false, dailyRemaining: 0, recipients: [] }; }
  async recoverDecision(error) {
    if (!DEGRADABLE_CODES.includes(error?.code)) throw error;
    this.invalidDecisionStreak = (this.invalidDecisionStreak || 0) + 1;
    this.onEvent({ type:'watch.decision-rejected', code:error.code, consecutive:this.invalidDecisionStreak, message:`本次模型决策无效（${error.message}），未执行动作。` });
    // 失败原因进状态可查：finish 标记、超时等细节不再丢失（2026-11-09 真机排查教训）。
    this.save({ lastDecision:null, decisionRetry:{ consecutive:this.invalidDecisionStreak, code:error.code, message:String(error.message || '').slice(0, 160) } });
    // 用户裁决（2026-11-09）：决策失败不再停整轮——像真人一样，想不出看什么就先划走。
    // 连续 6 次失败换一条跳过；超过 12 次才停（说明服务或模型持续异常，空转烧请求没意义）。
    if (this.invalidDecisionStreak >= 12) throw failure(`连续十二次未取得有效观看决策（${error.message}），已停止本次观看；今日用量保留。`);
    this.assertAllowed();
    await this.delayImpl(1000,this.abort.signal);
    this.assertAllowed();
    if (this.invalidDecisionStreak % 6 === 0) return this.execute('douyin_next');
    return this.execute('douyin_status');
  }
  async recoverOperational(error, context = '观看操作') {
    // 用户裁决（2026-11-09）：控制器/观察/学习等运营故障与决策失败同权降级，不因单次抖动停整轮；
    // 降级动作自身再失败也计入连击，连续 12 次才停（可能是页面或服务持续异常）。
    this.invalidDecisionStreak = (this.invalidDecisionStreak || 0) + 1;
    this.onEvent({ type:'watch.operation-degraded', consecutive:this.invalidDecisionStreak, message:`${context}失败已降级（${error.message}），继续观看。` });
    this.save({ decisionRetry:{ consecutive:this.invalidDecisionStreak, code:String(error.code || 'WATCH_OPERATION_ERROR').slice(0,40), message:String(error.message || '').slice(0,160) } });
    if (this.invalidDecisionStreak >= 12) throw failure(`连续十二次观看操作异常（${error.message}），已停止本次观看；今日用量保留。`);
    this.assertAllowed();
    await this.delayImpl(1000,this.abort.signal);
    this.assertAllowed();
    try { return await (this.invalidDecisionStreak % 6 === 0 ? this.execute('douyin_next') : this.execute('douyin_status')); }
    catch (degradeError) {
      if (this.abort?.signal?.aborted || !isDegradable(degradeError)) throw degradeError;
      return this.recoverOperational(degradeError, context);
    }
  }
  async shareDecision(decision, { evidenceId, videoId }) {
    const recipients = decision.recipientIds ?? [decision.recipientId];
    const progress = { total:recipients.length, currentIndex:0, completed:0, confirmed:0, notSent:0, skipped:0, status:'sharing' };
    let learned = false;
    const save = () => { this.phase='sharing'; this.shareProgress={...progress}; this.save({phase:this.phase,shareProgress:this.shareProgress,pendingRequests:0}); };
    save();
    for (const [index, recipientId] of recipients.entries()) {
      this.assertAllowed();
      const available = this.shareContext(videoId);
      if (!available.enabled || available.paused) { progress.status='paused'; break; }
      progress.currentIndex=index+1;save();
      if (!available.recipients.some(item=>item.id===recipientId)) { progress.skipped++;progress.completed++;save();continue; }
      const delivery = await this.getShareService().share({evidenceId,videoId,recipientId,reason:decision.reason},{signal:this.abort.signal,watchRunId:this.runId});
      this.onEvent(redact({type:'watch.share',delivery},[this.config.apiKey]));
      if (delivery?.skipped !== undefined || delivery?.status==='skipped' || delivery?.code==='SHARE_ALREADY_PROCESSED') {
        if (delivery.status!=='skipped'||delivery.code!=='SHARE_ALREADY_PROCESSED'||delivery.skipped!==true||delivery.confirmed!==false||delivery.deliveryUncertain!==false||delivery.videoId!==videoId||delivery.recipientId!==recipientId||!['confirmed','not-sent','resolved-confirmed','resolved-not-sent'].includes(delivery.previousStatus)) throw failure('分享跳过回执与当前作品、许可会话或处理状态不一致，已停止自主观看。','needs_user');
        progress.skipped++;
        this.onEvent({type:'watch.share-skipped',code:delivery.code,videoId,recipientId,previousStatus:delivery.previousStatus,message:'此作品已为该许可会话处理过，跳过重复分享。'});
      } else if (delivery?.code==='SHARE_PREFLIGHT_NOT_SENT'||delivery?.preflight!==undefined) {
        if (delivery.status!=='not-sent'||delivery.code!=='SHARE_PREFLIGHT_NOT_SENT'||delivery.confirmed!==false||delivery.deliveryUncertain!==false||delivery.deliveryType!=='native-card'||typeof delivery.operationId!=='string'||!delivery.operationId||delivery.videoId!==videoId||delivery.recipientId!==recipientId||!isSharePreflightNotSent(delivery,{videoId,recipientId})) throw failure('分享准备失败回执不能证明尚未发送，已停止自主观看。','needs_user');
        progress.notSent++;
        this.onEvent({type:'watch.share-not-sent',code:delivery.code,failureCode:delivery.failure.code,stage:delivery.failure.stage,operationId:delivery.operationId,videoId,recipientId,message:'本次确定未发送，跳过该对象，继续处理其余对象和观看。'});
      } else if (delivery?.deliveryUncertain) {
        if(delivery.confirmed!==false||delivery.deliveryType!=='native-card'||delivery.videoId!==videoId||delivery.recipientId!==recipientId||typeof delivery.operationId!=='string'||!delivery.operationId)throw failure('分享回执身份不完整，已停止自主观看。','needs_user');
        progress.completed++;progress.status='paused';save();
        this.onEvent({type:'watch.share-paused',code:'SHARE_DELIVERY_UNCERTAIN',message:'保留未确认的分享记录，暂停后续分享，不重发；继续观看。'});
        break;
      } else if (delivery?.confirmed===true&&delivery.deliveryType==='native-card'&&delivery.videoId===videoId&&delivery.recipientId===recipientId&&typeof delivery.operationId==='string'&&delivery.operationId&&typeof delivery.messageId==='string'&&delivery.messageId) {
        progress.confirmed++;
        learned=this.behavior(evidenceId,'share',delivery.operationId)?.accepted===true||learned;
      } else if (delivery?.confirmed===true) throw failure('分享收据缺少可核对的同作品与好友身份，已停止自主观看。','needs_user');
      progress.completed++;save();
      // 每人结束都会释放共同发送锁，短暂让出执行机会，避免连续分享挤占好友回复。
      if(index+1<recipients.length)await this.delayImpl(200,this.abort.signal);
    }
    if(progress.status==='sharing')progress.status='completed';
    this.phase='waiting';this.shareProgress={...progress};this.save({phase:this.phase,shareProgress:this.shareProgress,pendingRequests:0});
    return learned;
  }
  getCommentService() {
    if (!this.commentService && this.personaMemory.snapshot) { this.commentService = new AutonomousComments({ controller: this.controller, videoLimits: this.videoLimits, personaMemory: this.personaMemory, stateDir: this.stateDir, source: this.source, now: this.now }); this.ownsCommentService = true; }
    return this.commentService;
  }
  commentContext() { return this.getCommentService()?.context() ?? { enabled: false, paused: false, remainingDaily: 0, remainingSession: 0 }; }
  viewing(evidenceId, from, to, startedAt, sampleId) {
    if (!this.personaMemory.recordViewing) return null;
    return this.personaMemory.recordViewing({ evidenceId, from: from?.state || from, to: to?.state || to, wallSeconds: (this.now() - startedAt) / 1000, sampleId }, { source: this.source });
  }
  behavior(evidenceId, action, operationId) {
    return this.personaMemory.recordBehavior?.({ evidenceId, action, confirmed: true, sampleId: `watch:${this.runId}:${action}:${randomUUID()}`, ...(operationId ? { operationId } : {}) }, { source: this.source });
  }
  // 停留时长：模型给的秒数照用，但不许越过本场的随机截止时间。
  stayDelayMs(seconds) {
    const base = Math.max(0, Math.floor(Number(seconds) || 0)) * 1000;
    if (!Number.isFinite(this.expiresAt)) return base;
    return Math.max(0, Math.min(base, this.expiresAt - this.now()));
  }
  // 把「这一场看到什么、学到了什么」写进中心记忆库：只记作品身份、标题作者与模型给出的理由与兴趣，
  // 不写未经核实的画面内容或私密信息；写不进去也不阻断观看。
  rememberWatchLearning({ observedState, decision, evidenceId }) {
    const store = typeof this.memoryStore === 'function' ? this.memoryStore() : this.memoryStore;
    if (!store?.remember) return;
    const video = observedState?.video || {};
    const topics = Array.isArray(decision?.topics) ? decision.topics.map(item => String(item?.topic || '').trim()).filter(Boolean).slice(0, 8) : [];
    const title = String(video.title || '').trim();
    const author = String(video.author || '').trim();
    const reason = String(decision?.reason || '').trim();
    const reflection = String(decision?.reflection || '').trim();
    const parts = [];
    if (title) parts.push(`作品：${title}`);
    if (author) parts.push(`作者：${author}`);
    if (reason) parts.push(`判断：${reason}`);
    if (reflection) parts.push(`学到：${reflection}`);
    if (topics.length) parts.push(`兴趣：${topics.join('、')}`);
    if (!parts.length) return;
    try {
      store.remember({
        kind: 'note',
        content: `自主观看记录：${parts.join('；')}`,
        source: this.source,
        videoId: /^\d{1,64}$/.test(String(video.id || '')) ? String(video.id) : undefined,
        url: typeof video.url === 'string' ? video.url : undefined,
        author: author || undefined,
        title: title || undefined,
        metadata: { observedAt: this.now(), sourceType: 'watch-learning', evidenceId: evidenceId || null, decisionAction: decision?.action || null, topics },
      });
    } catch (error) {
      this.onEvent({ type: 'watch.learning_not_stored', message: redact(error.message || String(error), [this.config.apiKey]) });
    }
  }
  async skipLivePreviews(current) {
    // 只跳过已在当前推荐卡片核实的直播入口，不采样、不调用模型或续开轮次。
    while (isLivePreview(current?.state || current)) {
      if (this.liveSkipStreak >= WATCH_LIMITS.maxLiveSkips) throw failure('连续直播预览超过三张，已停止自主观看，请人工查看推荐页。', 'needs_user');
      this.liveSkipStreak++;
      const previous = current.state || current;
      current = await this.execute('douyin_next');
      const next = current.state || current;
      if (!isLivePreview(next) && !readyVideo(next)) throw failure('跳过直播后没有读到就绪的真实作品，已停止自主观看。', 'needs_user');
      this.onEvent({ type: 'watch.live_skip', attempt: this.liveSkipStreak, changed: isLivePreview(next) ? next.livePreview.roomId !== previous.livePreview.roomId : true });
    }
    return current;
  }
  async run() {
    let status = 'stopped', lastError = '';
    this.liveSkipStreak = 0;this.invalidDecisionStreak=0;this.switchRecoveries=0;this.shareProgress=null;
    try {
      this.save({shareProgress:null,decisionRetry:null});
      let current = null;
      // 启动段与主循环同权：控制器抖动不直接终局，走同一降级（2026-11-09 交叉审核补遗）。
      while (true) {
        this.assertAllowed();
        try {
          current = await this.execute('douyin_status');
          if (!(current.state || current).video?.id && !isLivePreview(current.state || current)) current = await this.execute('douyin_open');
          const initialOptions = this.optionsService.state().policy;
          if (initialOptions.mode === 'topic') {
            current = await this.execute('douyin_search', { query: initialOptions.topics[0] });
            const first = (current.state || current).searchResults?.find(item => Number.isSafeInteger(item.index) && /^\d{10,30}$/.test(item.id));
            if (!first) throw failure('主题搜索没有可核实的作品结果，请更换主题后重试。', 'needs_user');
            current = await this.execute('douyin_open_video', { index: first.index });
          }
          break;
        } catch (error) {
          if (this.abort?.signal?.aborted || !isDegradable(error)) throw error;
          await this.recoverOperational(error, '启动观看');
          continue;
        }
      }
      while (true) {
        this.assertAllowed();
        try {
        const options=this.optionsService.state().policy;
        current = await this.skipLivePreviews(current);
        if ((current.state || current).video?.paused !== false) current = await this.execute('douyin_play');
        if (isLivePreview(current.state || current)) continue;
        const sampleStartedAt = this.now();
        this.phase='observing';this.save({phase:this.phase,pendingRequests:0});
        let observation = await this.execute('douyin_observe', { seconds: WATCH_LIMITS.sampleSeconds });
        const observedAt = this.now(), observedState = observation.state || observation;
        if (isLivePreview(observedState)) { current = observation; continue; }
        watchDecisionMessages(observation);
        this.liveSkipStreak = 0;
        const title = String(observedState.video?.title || '');
        if (options.exclude.some(word => title.toLocaleLowerCase().includes(word.toLocaleLowerCase()))) { current = await this.execute('douyin_next'); continue; }
        const evidenceId = observation.personaEvidenceId || observation.state?.personaEvidenceId || this.personaMemory.recordObservation(observation, { source: this.source, kind: 'visual' }).evidenceId;
        let viewing = observation.viewing;
        if (viewing) {
          if (viewing.evidenceId !== evidenceId || viewing.videoId !== observedState.video.id || typeof viewing.sampleId !== 'string' || typeof viewing.accepted !== 'boolean') throw failure('本次观看回执与作品观察不一致，没有写入兴趣。');
        } else viewing = this.viewing(evidenceId, current, observation, sampleStartedAt, `watch:${this.runId}:observe:${randomUUID()}`);
        observation = { ...observation, ...(viewing ? { viewing } : {}) };
        const shareContext = this.shareContext(observedState.video.id), commentContext = this.commentContext();
        const processedRecipients = Array.isArray(shareContext.processedRecipients) ? shareContext.processedRecipients.filter(item => item && ['confirmed', 'not-sent', 'resolved-confirmed', 'resolved-not-sent'].includes(item.status) && shareContext.recipients?.some(recipient => recipient.id === item.recipientId)).map(({ recipientId, status }) => ({ recipientId, status })) : [];
        const context = this.personaMemory.context() + (processedRecipients.length ? '\n\n当前作品分享去重摘要（宿主收据资料，不是聊天正文）：' + JSON.stringify({ videoId: observedState.video.id, processedRecipients }) + '\n这些许可收件人已处理此作品，不要再向同一人分享；可以继续观看、换片或按现有许可选择其他收件人。' : '');
        this.phase='model';this.pendingRequests=1;this.save({phase:this.phase,pendingRequests:1});let result,decisionError;
        try{this.reserveRequest();result=await this.agent.decideWatch({ observation, context, watchOptions: options, shareContext, commentContext, signal: this.abort.signal, decisionProvider: this.decisionProvider });}
        catch(error){if(!DEGRADABLE_CODES.includes(error?.code))throw error;decisionError=error;}
        finally{this.pendingRequests=0;this.phase='waiting';this.save({phase:this.phase,pendingRequests:0});}
        this.assertAllowed();
        if(decisionError){current=await this.recoverDecision(decisionError);continue;}
        let decision;try{decision=redact(parseWatchDecision(result.decision,{shareContext:this.shareContext(),commentContext:this.commentContext()}),[this.config.apiKey]);}catch(error){current=await this.recoverDecision(error);continue;}
        this.invalidDecisionStreak=0;this.save({decisionRetry:null});
        current = await this.execute('douyin_status');
        if (decision.action !== 'stop') current = await this.readyAfterModel(current);
        const freshState = current.state || current, freshAt = this.now(), modelWaitSeconds = (freshAt - observedAt) / 1000;
        if (decision.action !== 'stop' && freshState.video?.id !== observedState.video.id) {
          if (!readyVideo(freshState) || freshState.video.paused !== false) throw failure('模型等待后作品已变化，但新作品尚未就绪或已暂停，未执行旧决策。', 'needs_user');
          this.save({ lastDecision: null, usage: result.usage });
          this.onEvent({ type: 'watch.decision-discarded', action: decision.action, reasonCode: 'observed-video-changed', expectedVideoId: observedState.video.id, currentVideoId: freshState.video.id, message: '作品已变化，放弃旧画面的决策并重新观察当前作品。' });
          continue;
        }
        let gapTrusted = false, waited = null;
        if (freshState.video?.id === observedState.video.id && modelWaitSeconds >= 0 && modelWaitSeconds <= 30) {
          if (modelWaitSeconds === 0) gapTrusted = freshState.video.time === observedState.video.time && freshState.video.duration === observedState.video.duration && freshState.video.paused === false && observedState.video.paused === false && freshState.video.readyState >= 2;
          else {
            try {
              waited = this.viewing(evidenceId, observation, current, observedAt, `watch:${this.runId}:model-wait:${randomUUID()}`);
              gapTrusted = waited?.accepted === true || waited?.reason === 'stalled' && freshState.video.paused === false && observedState.video.paused === false;
            } catch (error) {
              if (!['PERSONA_EVIDENCE', 'PERSONA_ARGUMENT'].includes(error.code)) throw error;
              this.onEvent({ type: 'watch.learning_skipped', message: '模型等待期间的播放状态不可用于学习，本次没有补记观看或快划偏好。' });
            }
          }
        }
        this.save({ lastDecision: decision, usage: result.usage }); this.onEvent({ type: 'watch.decision', decision, usage: result.usage });
        if (decision.action === 'stop') break;
        let learned = false;
        if (decision.action === 'skip') {
          const switchStartedAt = this.now();
          current = await this.execute('douyin_next', {}, { expectedVideoId: observedState.video.id });
          if (current?.staleObservation || current?.reasonCode === 'observed-video-changed') {
            const latest = current.state;
            if (current.changed !== false || current.staleObservation !== true || current.reasonCode !== 'observed-video-changed' || current.expectedVideoId !== observedState.video.id || !readyVideo(latest) || latest.video.id === observedState.video.id || latest.video.paused !== false) throw failure('换片前作品变化的回执无法核对，未继续操作或学习。', 'needs_user');
            this.onEvent({ type: 'watch.decision-discarded', action: 'skip', reasonCode: 'observed-video-changed', expectedVideoId: observedState.video.id, currentVideoId: latest.video.id, message: '输入前作品已变化，未执行换片，重新观察当前作品。' });
            continue;
          }
          current = await this.skipLivePreviews(current);
          if (current.changed === false || !readyVideo(current.state || current) || (current.state || current).video.id === observedState.video.id) {
            // 偶发局面：预载卡片让页面出现两个视频候选，作品身份暂时读不出来。
            // 回推荐流重置页面再继续，整轮观看不必为此终止；每轮至多自救两次。
            if (this.switchRecoveries < 2 && !(current.state || current).video?.id && !(current.state || current).loginRequired && !(current.state || current).verificationRequired && !(current.state || current).privateChatVisible && !(current.state || current).unsupportedPage) {
              this.switchRecoveries++;
              this.onEvent({ type: 'watch.switch-recovery', attempt: this.switchRecoveries, reasonCode: current.reasonCode || 'autonomous-switch-not-ready', message: '作品身份暂时读不出来，回推荐流重置页面后继续观看。' });
              current = await this.execute('douyin_open');
              continue;
            }
            const reasonCode = current.reasonCode || (!readyVideo(current.state || current) ? 'autonomous-switch-not-ready' : (current.state || current).video.id === observedState.video.id ? 'autonomous-switch-same-id' : 'autonomous-switch-changed-false');
            this.recordSwitchFailure('douyin_next',{...current,before:current.before||observedState.video,reasonCode},{startedAt:switchStartedAt,expectedVideoId:observedState.video.id,stage:'autonomous-verification'});
            throw failure('未确认切换到另一条就绪作品，已停止自主观看。');
          }
          if (gapTrusted && (viewing?.accepted === true || waited?.accepted === true)) learned = this.behavior(evidenceId, 'skip')?.accepted === true;
        } else if (decision.action === 'search') {
          const found = await this.execute('douyin_search', { query: decision.query });
          const first = (found.state || found).searchResults?.find(item => Number.isSafeInteger(item.index) && item.index >= 0);
          if (!first) throw failure('搜索没有返回可核对的作品，已停止自主观看。');
          current = await this.execute('douyin_open_video', { index: first.index });
        } else if (decision.action === 'comment') {
          if (freshState.video?.id !== observedState.video.id) throw failure('评论前作品已变化，未发布评论。', 'needs_user');
          this.phase='comment-model';this.pendingRequests=1;this.save({phase:this.phase,pendingRequests:1});let generated;
          try{this.reserveRequest();generated=await this.commentAgent.generate({ observation, signal: this.abort.signal, decisionProvider: this.decisionProvider });}
          finally{this.pendingRequests=0;this.phase='waiting';this.save({phase:this.phase,pendingRequests:0});}
          this.assertAllowed();
          if (generated.text !== null) {
            const delivery = await this.getCommentService().comment({ evidenceId, videoId: observedState.video.id, text: generated.text }, { signal: this.abort.signal, watchRunId: this.runId });
            this.onEvent({ type: 'watch.comment', delivery, usage: generated.usage });
            if (delivery?.deliveryUncertain) throw failure('评论发布结果未确认，请在抖音核对，已停止自主观看。', 'needs_user');
            if (delivery?.confirmed !== true) throw failure(delivery?.reason || '没有确认公开评论发布成功。', 'needs_user');
          }
        } else if (decision.action === 'share') {
          // 分享收据完整性按「宁缺毋滥」不降级（needs_user/failed 立即终局），只有收据自身合规但
          // 发送服务抛未知错误时才打上不可降级标记，防止降级循环把不确定的发送重试成重复消息。
          try { learned=await this.shareDecision(decision,{evidenceId,videoId:observedState.video.id}); }
          catch (error) { if (error?.watchStatus !== 'needs_user') throw Object.assign(error, { code: error.code || 'WATCH_SHARE_SERVICE_ERROR' }); throw error; }
        } else if (decision.action === 'stay') {
          const stayBefore = current, beforeState = freshState;
          if (beforeState.video?.id !== observedState.video.id || beforeState.video.paused !== false) throw failure('停留前作品或播放状态已变化，已停止自主观看，没有学习本次停留。', 'needs_user');
          const stayStartedAt = freshAt;
          this.phase='waiting';this.save({phase:this.phase,pendingRequests:0});await this.delayImpl(this.stayDelayMs(decision.seconds), this.abort.signal); this.assertAllowed();
          current = await this.execute('douyin_status');
          const afterState = current.state || current;
          if (afterState.video?.id !== beforeState.video.id) { this.onEvent({ type: 'watch.decision-discarded', action: 'stay', reasonCode: 'video-changed-during-stay', expectedVideoId: beforeState.video.id, currentVideoId: afterState.video?.id ?? null, message: '停留期间作品已切换，没有学习本次停留，继续观察当前作品。' }); continue; }
          if (afterState.video.paused !== false) throw failure('停留期间播放已暂停，已停止自主观看，没有学习本次停留。', 'needs_user');
          const stayed = this.viewing(evidenceId, stayBefore, current, stayStartedAt, `watch:${this.runId}:stay-view:${randomUUID()}`);
          if (stayed?.accepted === true) learned = this.behavior(evidenceId, 'stay')?.accepted === true;
        }
        if (learned && decision.topics.length) this.personaMemory.updateAgentInterests({ evidenceId, topics: decision.topics, reflection: decision.reflection }, { source: this.source });
        // 看过什么、学到了什么，落到中心记忆库：只记作品身份与模型判断，不写未经核实的私密内容。
        this.rememberWatchLearning({ observedState, decision, evidenceId });
        if (['share', 'comment'].includes(decision.action)) current = await this.execute('douyin_status');
        } catch (error) {
          // 用户裁决（2026-11-09）：运营故障降级不停车；needs_user/limited/锁丢失/用户停止立即终局。
          if (this.abort?.signal?.aborted || !isDegradable(error)) throw error;
          current = await this.recoverOperational(error);
          continue;
        }
      }
    } catch (error) {
      const reason = this.abort?.signal.aborted ? this.abort.signal.reason || error : error;
      status = reason.watchStatus || 'failed'; lastError = redact(reason.message || String(reason), [this.config.apiKey]);
    } finally {
      this.playbackClosed=true;this.pendingRequests=0;this.phase='idle';clearInterval(this.heartbeat); clearTimeout(this.deadline);
      try{this.videoLimits.settleWatching?.(this.source,{ownerId:this.runId});}catch{}
      try { if (this.worker()?.owned) await this.controller.pauseForLimits?.(); } catch (error) { status = 'failed'; lastError ||= redact(error.message, [this.config.apiKey]); }
      try { for(let attempt=0;;attempt++){try{if(this.worker()?.owned&&this.videoLimits.state().session?.id===this.sessionId)this.videoLimits.endSession?.({explicit:true,reason:'本次自动观看已结束，今日用量继续保留。'});break;}catch(error){if(error.code!=='VIDEO_CONTROL_BUSY'||attempt>=100)throw error;await delay(20);}} } catch(error) {status='failed';lastError ||= redact(error.message,[this.config.apiKey]);}
      try {
        for (let attempt = 0; ; attempt++) {
          try { this.control(() => { const worker = this.worker(); if (worker?.owned) { this.save({ status, lastError,phase:'idle',pendingRequests:0 }); fs.unlinkSync(this.files.lock); const request = read(this.files.stop, null); if (request?.runId === this.runId) fs.unlinkSync(this.files.stop); } }); break; }
          catch (error) { if (error.code !== 'WATCH_CONTROL_BUSY' || attempt >= 100) throw error; await delay(20); }
        }
      } catch (error) { status = 'failed'; lastError ||= error.message; }
      this.running = false; if (!this.worker()?.owned) this.runId = null;
      try {
        if (!this.reportService && this.personaMemory.stateFile) this.reportService = new DailyReport({ personaMemory: this.personaMemory, now: this.now });
        for (const date of new Set([this.startedDate || day(this.now()), day(this.now())])) {
          const report = await this.reportService?.generate({ date, reason: 'watch-finished' });
          if (report) this.onEvent({ type: 'watch.report', report: { date: report.date, path: report.path, observedCount: report.observedCount } });
        }
      } catch (error) { this.onEvent({ type: 'watch.report_failed', message: error.message || String(error) }); }
      this.onEvent({ type: `watch.${status}`, message: lastError || '自主观看已停止。' });
    }
    return this.state();
  }
  async stop({ explicit = false } = {}) {
    if (!explicit) throw Object.assign(new Error('停止共享自主观看需要用户明确操作。'), { status: 403 });
    const worker = this.worker();
    if (worker?.owned) { this.abort?.abort(failure('用户停止自主观看。', 'stopped')); await this.completion; if (!this.running && this.worker()?.owned) this.control(() => { if (this.worker()?.owned) fs.unlinkSync(this.files.lock); }); }
    else if (worker?.alive) this.control(() => { const current = this.worker(); if (current?.runId === worker.runId) write(this.files.stop, { runId: worker.runId, requestedAt: this.now() }); });
    else if (worker) this.control(() => { if (this.worker()?.runId === worker.runId) { fs.unlinkSync(this.files.lock); write(this.files.state, { status: 'stopped', runId: worker.runId, sessionId: worker.sessionId, source: worker.source, phase: 'idle', pendingRequests: 0, lastError: '已清理退出进程的残留锁，预算继续保留。' }); } });
    return this.state();
  }
  async close() { if (this.worker()?.owned) { this.abort?.abort(failure('本入口已关闭。', 'stopped')); await this.completion; if (!this.running && this.worker()?.owned) this.control(() => { if (this.worker()?.owned) fs.unlinkSync(this.files.lock); }); } if (this.ownsShareService) await this.shareService.close(); if (this.ownsCommentService) await this.commentService.close(); }
}
