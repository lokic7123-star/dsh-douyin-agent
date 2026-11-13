import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveRuntimePaths } from './runtime-paths.mjs';
import { ensurePlan, planSession, closeSession, savePlan, cooldownMinutes, resumePlan, loadPlan, planDate, roundCandidates, recoveredPlan, creditedSessionKeys, creditSession, sessionDate } from './watch-plan.mjs';

const DAY=86400000, defaultPolicy={enabled:false};
const load=(file,fallback)=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw new Error('自动启动记录无法读取，未重置原记录。');}};
const write=(file,value)=>{const temporary=`${file}.${randomUUID()}.tmp`;try{fs.writeFileSync(temporary,JSON.stringify(value,null,2),{flag:'wx',mode:0o600});fs.renameSync(temporary,file);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}};
const explain=error=>String(error?.message||error||'自动观看未完成，请检查模型、浏览器和运行记录。').replace(/Bearer\s+[^\s"']+/gi,'Bearer [隐藏]').replace(/\bsk-[A-Za-z0-9_-]+/g,'[凭据已隐藏]').replace(/https?:\/\/[^\s"<>]+/g,raw=>{try{const url=new URL(raw);url.search='';url.hash='';url.username='';url.password='';return url.href;}catch{return'[地址已省略]';}}).slice(0,600);
export function scheduledSlot(policy,now) {
  const shifted=new Date(now+8*3600000), midnight=Date.UTC(shifted.getUTCFullYear(),shifted.getUTCMonth(),shifted.getUTCDate())-8*3600000, intervals=[];
  for(const offset of [-1,0,1]){const day=new Date(midnight+offset*DAY+8*3600000).getUTCDay();for(const value of ([0,6].includes(day)?policy.weekendWindows||policy.windows:policy.windows)) {const[a,b,c,d]=value.split(/[:-]/).map(Number),start=a*60+b;let end=c*60+d;if(end<start)end+=1440;intervals.push({startAt:midnight+offset*DAY+start*60000,expiresAt:midnight+offset*DAY+end*60000});}}
  const merged=[];for(const interval of intervals.sort((a,b)=>a.startAt-b.startAt)){const old=merged.at(-1);if(old&&interval.startAt<old.expiresAt)old.expiresAt=Math.max(old.expiresAt,interval.expiresAt);else merged.push({...interval});}
  const slot=merged.find(item=>item.startAt<=now&&now<item.expiresAt);return slot?{...slot,key:`${slot.startAt}:${slot.expiresAt}`}:null;
}
function policyOf(value){if(!value||Array.isArray(value)||Object.keys(value).some(key=>!['enabled','maxRequests'].includes(key))||typeof value.enabled!=='boolean')throw new Error('允许观看只接受开关。');return{enabled:value.enabled};}

// 「允许观看」开着的时候，按当天随机日程自己刷：
// 启动本身不构成「想刷」——第一次看要等一个随机点；每场看多久、两场之间歇多久都随机；
// 一天可能看不满，也可能一场都不看。异常保留到人工处理。
export class ScheduledWatch {
  constructor({stateDir=resolveRuntimePaths().stateDir,getVideoLimits,getWatchState,startRound,source='api',now=Date.now,intervalMs=5000,random=Math.random,firstDelayMinutes=null,allowLazy=true,savePlanImpl=null}={}){Object.assign(this,{stateDir,getVideoLimits,getWatchState,startRound,source,now,intervalMs,random,firstDelayMinutes,allowLazy});this.policyFile=path.join(stateDir,'watch-schedule-policy.json');this.ledgerFile=path.join(stateDir,'watch-schedule-runs.json');this.guardFile=path.join(stateDir,'watch-schedule.guard');this.closed=false;this.savePlanImpl=savePlanImpl||savePlan;}
  policy(){return policyOf(load(this.policyFile,{...defaultPolicy}));}
  ledger(){const value=load(this.ledgerFile,{version:1,runs:[]});if(value?.version!==1||!Array.isArray(value.runs)||value.runs.some(item=>!item?.key||!['starting','started','failed','occupied','completed','acknowledged'].includes(item.status)))throw new Error('自动观看回执损坏，未覆盖或重试。');return value;}
  // 自动观看回执只增不减：保留最近 30 天与最近 200 条，超出的旧回执清掉。
  // 未结束的（starting/started/failed/occupied）永远保留，否则会丢掉正在跑或等人处理的那一场。
  pruneLedger(ledger){if(!Array.isArray(ledger?.runs))return ledger;const cutoff=this.now()-30*86400000,pending=new Set(['starting','started','failed','occupied']);
    const kept=ledger.runs.filter(item=>{if(pending.has(item?.status))return true;const at=Date.parse(item?.startedAt||'');return !Number.isFinite(at)||at>=cutoff;});
    if(kept.length>200){const removable=kept.filter(item=>!pending.has(item?.status));while(kept.length>200&&removable.length)kept.splice(kept.indexOf(removable.shift()),1);}
    ledger.runs=kept;return ledger;}
  state(){const policy=this.policy(),ledger=this.ledger(),last=ledger.runs.at(-1)||null,lastError=Object.hasOwn(ledger,'lastError')?ledger.lastError:last?.status==='failed'?last.error||this.error||'自主观看异常停止，请检查后重新开启允许观看。':this.error||'';return{protocol:'scheduled-watch-v2',policy,last,busy:Boolean(this.pending),lastError,note:'允许观看后，按当天的随机日程自己看：不会一开开关就开抖音，每场看多久、两场之间歇多久都随机；登录、验证或运行异常需要处理后重新开启允许观看。'};}
  // 回收空壳锁与死进程留下的锁：只动确定没人持有的。
  // 内容坏掉的锁也不能永远堵在这里：改名归档（内容原样保留在归档文件里），把位置腾出来。
  //
  // 回收本身也要互斥：两个回收方各自把对方的锁换掉，等于谁也没锁住。
  // 所以先抢一把旁路锁（.reclaim），抢到之后再重新读一次原锁，
  // 确认要动的还是刚才读到的那一把，才动它。
  //
  // 关键：原锁从头到尾不挪走。挪走的那一瞬间原路径是空的，
  // 第三个入口就能在这空隙里拿到锁，进入还在临界区里的那个持有者所在的区。
  // 锁只在「确定没人持有」的时候原地删掉，绝不搬到别处再放回来。
  // 持有者还活着的锁一律不碰。
  reclaimLockFile(){return `${this.guardFile}.reclaim`;}
  takeReclaimLock(){
    const file=this.reclaimLockFile();
    for(let attempt=0;attempt<2;attempt++){
      let fd;
      try{fd=fs.openSync(file,'wx',0o600);}
      catch(error){
        if(error.code!=='EEXIST')return false;
        let stat;try{stat=fs.lstatSync(file);}catch{continue;}
        // 刚建好、内容还没写进去：对方正在拿这把锁，让路。
        if(stat.size===0&&Date.now()-Math.floor(stat.mtimeMs)<500)return false;
        let record=null;try{record=JSON.parse(fs.readFileSync(file,'utf8'));}catch{record=null;}
        if(record&&Number.isSafeInteger(record.pid)&&record.pid>0){
          try{process.kill(record.pid,0);return false;}catch(error){if(error.code!=='ESRCH')return false;}
        }
        // 上一位回收方已经不在了：把残骸原子地搬到自己手里，再腾出原路径建新锁。
        // rename 只有一个调用方能成功——没抢到的（残骸已被对方搬走）只能让路；
        // 绝不能按路径去删别人的新锁，那是上一版互斥失效的根源。
        const taken=`${file}.taken-${randomUUID()}`;
        try{fs.renameSync(file,taken);}catch{continue;}
        try{fs.unlinkSync(taken);}catch{}
        continue;
      }
      // 拿到 fd 只是「我先创建了文件」，还要确认自己是唯一持有者：
      // 立刻写上自己的 owner 并关掉 fd，读回内容比对 token，
      // 对不上说明有另一个回收方同时拿到了这把锁，让路。
      const owner={pid:process.pid,token:randomUUID()};
      try{
        fs.writeFileSync(fd,JSON.stringify(owner));
      }finally{fs.closeSync(fd);}
      let current=null;try{current=JSON.parse(fs.readFileSync(file,'utf8'));}catch{current=null;}
      if(current?.token!==owner.token)return false;
      this.reclaimOwner=owner;return true;
    }
    return false;
  }
  releaseReclaimLock(){
    const file=this.reclaimLockFile(),owner=this.reclaimOwner;
    if(!owner)return;
    this.reclaimOwner=null;
    let current=null;try{current=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
    if(current?.token===owner.token){try{fs.unlinkSync(file);}catch{}}
  }
  reclaimStaleGuard(){
    // 没有回收独占权就不动原锁：让正在回收的那位先把该清的清掉。
    if(!this.takeReclaimLock())return false;
    try{
      // 拿到回收独占权之后要重新读一次：动手前看到的内容可能已经是别人的新锁了。
      let stat;try{stat=fs.lstatSync(this.guardFile);}catch(error){return error.code==='ENOENT';}
      if(!stat.isFile()||stat.isSymbolicLink())return false;
      if(stat.size===0){
        // 刚建好还没写内容的那一瞬间先放过对方：超过半秒还是空的，才当成空壳。
        if(Date.now()-Math.floor(stat.mtimeMs)<500)return false;
        // 动手前再核一次：期间被换成了别的锁就不动它。
        let nowStat;try{nowStat=fs.lstatSync(this.guardFile);}catch(error){return error.code==='ENOENT';}
        if(nowStat.size!==0||nowStat.ino!==stat.ino)return false;
        try{fs.unlinkSync(this.guardFile);return true;}catch(error){return error.code==='ENOENT';}
      }
      let content;try{content=fs.readFileSync(this.guardFile,'utf8');}catch{content=null;}
      let record=null;try{record=JSON.parse(content);}catch{record=null;}
      if(!record||!Number.isSafeInteger(record.pid)||record.pid<1){
        // 正在写的那一瞬间（刚落盘、内容还没写全）先放过对方。
        if(Date.now()-Math.floor(stat.mtimeMs)<2000)return false;
        // 坏锁：内容原样归档，把位置腾出来给下一个入口。
        // 归档前再核一次内容：期间被换成有效锁就别动它。
        let current;try{current=fs.readFileSync(this.guardFile,'utf8');}catch{return false;}
        if(current!==content)return false;
        const archive=`${this.guardFile}.corrupt-${Date.now()}-${randomUUID()}`;
        try{fs.renameSync(this.guardFile,archive);return true;}catch(error){return error.code==='ENOENT';}
      }
      try{process.kill(record.pid,0);return false;}catch(error){if(error.code==='EPERM')return false;if(error.code!=='ESRCH')return false;}
      // 死进程留下的锁：原地删掉，位置让给下一个入口（不用搬到别处，搬走的空隙会放进别人）。
      // 动手前再核一次内容：期间被换成有效锁就别动它。
      let current;try{current=fs.readFileSync(this.guardFile,'utf8');}catch{return false;}
      if(current!==content)return false;
      try{fs.unlinkSync(this.guardFile);return true;}catch(error){return error.code==='ENOENT';}
    }finally{this.releaseReclaimLock();}
  }
  // 坏掉的锁改名归档：内容一个字都不改，留给本人核对，但不再挡住所有入口。
  archiveCorruptGuard(stat){
    if(!this.takeReclaimLock())return false;
    try{
      let statNow;try{statNow=fs.lstatSync(this.guardFile);}catch{return false;}
      // 正在写的那一瞬间（刚落盘、内容还没写全）先放过对方。
      if(Date.now()-Math.floor(statNow.mtimeMs)<2000)return false;
      let content;try{content=fs.readFileSync(this.guardFile,'utf8');}catch{return false;}
      let parsed=null;try{parsed=JSON.parse(content);}catch{parsed=null;}
      if(parsed&&Number.isSafeInteger(parsed.pid)&&parsed.pid>0)return false;
      const archive=`${this.guardFile}.corrupt-${Date.now()}-${randomUUID()}`;
      try{fs.renameSync(this.guardFile,archive);return true;}catch{return false;}
    }finally{this.releaseReclaimLock();}
  }
  control(action){
    fs.mkdirSync(this.stateDir,{recursive:true});
    const owner={pid:process.pid,token:randomUUID()};
    for(let attempt=0;attempt<3;attempt++){
      let fd;
      try{fd=fs.openSync(this.guardFile,'wx',0o600);}
      catch(error){
        if(error.code!=='EEXIST')throw error;
        // 空壳或死进程留下的锁可以回收；内容坏掉的锁不动，等本人核对。
        if(this.reclaimStaleGuard())continue;
        throw Object.assign(new Error('另一个入口正在检查自动观看。'),{code:'SCHEDULE_BUSY'});
      }
      try{fs.writeFileSync(fd,JSON.stringify(owner));return action();}
      finally{
        fs.closeSync(fd);
        let current=null;
        try{current=load(this.guardFile,null);}catch{}
        if(current?.pid===owner.pid&&current.token===owner.token){try{fs.unlinkSync(this.guardFile);}catch{}}
      }
    }
    throw Object.assign(new Error('另一个入口正在检查自动观看。'),{code:'SCHEDULE_BUSY'});
  }
  configure(value,{explicit=false}={}){if(!explicit)throw new Error('允许观看需要本人明确保存。');const policy=policyOf(value);this.control(()=>{
    const previous=load(this.policyFile,defaultPolicy),videoFile=path.join(this.stateDir,'video-policy.json'),video=load(videoFile,null),legacy=previous.maxRequests??value.maxRequests;
    if(video&&video.dailyRequests===undefined&&legacy!==undefined){if(legacy!==null&&(!Number.isSafeInteger(legacy)||legacy<1))throw new Error('旧每日请求设置损坏，未覆盖。');write(videoFile,{...video,dailyRequests:legacy});}
    write(this.policyFile,policy);if(policy.enabled){const ledger=this.ledger();for(const item of ledger.runs)if(['failed','occupied'].includes(item.status))item.status='acknowledged';ledger.lastError='';write(this.ledgerFile,ledger);this.error='';this.resumeToday(video||{});}
  });if(!policy.enabled)this.abort?.abort(new Error('已关闭允许观看。'));return this.state();}
  // 本人明确开启允许观看：当天日程从现在开始（第一次看的等待不算），冷却与出错计数一并清掉。
  resumeToday(policy={}){const now=this.now(),date=planDate(now);const existing=loadPlan({stateDir:this.stateDir,date});
    const plan=existing||ensurePlan({stateDir:this.stateDir,date,policy,now,random:this.random,firstDelayMinutes:0,allowLazy:false});
    return resumePlan({stateDir:this.stateDir,date,plan,now});}
  // 刚启动时如果当天还没开始看，把第一次看的时刻往后挪：启动本身不构成「想刷」。
  deferFirstStart(){const now=this.now(),date=planDate(now),plan=loadPlan({stateDir:this.stateDir,date});if(!plan||(plan.sessions||[]).length||!Number.isFinite(plan.firstStartAt)||plan.firstStartAt>now)return;
    const delay=this.randomFirstDelay();savePlan({stateDir:this.stateDir,date,plan:{...plan,firstStartAt:now+delay},now});}
  randomFirstDelay(){const minutes=Number.isFinite(this.firstDelayMinutes)?Math.max(0,Math.floor(this.firstDelayMinutes)):10+Math.floor(this.random()*36);return minutes*60000;}
  start(){if(!this.timer){this.deferFirstStart();this.timer=setInterval(()=>{void this.tick();},this.intervalMs);this.timer.unref?.();void this.tick();}return this;}
  tick(){if(this.closed||this.pending)return this.pending||Promise.resolve(this.state());this.pending=this.perform().catch(error=>{if(error.code!=='SCHEDULE_BUSY'){this.error=explain(error);try{this.control(()=>{const ledger=this.ledger();ledger.lastError=this.error;write(this.ledgerFile,ledger);});}catch{}}}).finally(()=>{this.pending=null;});return this.pending;}
  async perform(){const limits=await this.getVideoLimits();
    const time=limits.state();
    const watch=await this.getWatchState();
    const now=this.now(),date=planDate(now),windowEnd=Number.isFinite(time.window?.expiresAt)?time.window.expiresAt:null;
    // 关闭允许观看时也要把上一场结清：结账是记账，不是播放。
    // 少了这一步，跨过零点后回执会一直悬着，那一笔账永远记不上。
    if(!this.policy().enabled){
      this.settleRound({watch,now,date});
      this.abort?.abort(new Error('已关闭允许观看。'));
      limits.settleWatching?.();
      return;
    }
    const manual=load(path.join(this.stateDir,'watch-manual.lock'),null);
    if(manual){if(!Number.isSafeInteger(manual.pid)||manual.pid<1||typeof manual.token!=='string')throw new Error('手动视频操作锁无法核对，未启动自主观看。');try{process.kill(manual.pid,0);return;}catch(error){if(error.code==='EPERM')return;if(error.code!=='ESRCH')throw error;}}
    const plan=ensurePlan({stateDir:this.stateDir,date,policy:time.policy,now,random:this.random,firstDelayMinutes:this.firstDelayMinutes,allowLazy:this.allowLazy});
    // 上一场的结局先结清：自主观看已经停了（看完了、异常了、还是等着本人处理），
    // 就把这一场记掉，再决定歇多久开下一场——随机日程不能盖掉真实结局。
    // 结清是记账，不是播放，所以即便现在不在允许时段、额度也已用尽，也要先把上一场记掉：
    // 否则一场中途结束的观看会永远停在「进行中」，跨天后也不会进账。
    if(this.settleRound({plan,watch,now,date}))return;
    if(!time.allowed)return;
    if(watch?.running||watch?.busy||watch?.pendingRequests>0)return;
    const session=planSession({plan,now,random:this.random,windowEnd});if(!session)return;
    if(plan.roundSession?.key!==session.key){
      // 开场这一场必须先落盘：日程里没有它，账本记下来的分钟数跨天后就没有落脚点。
      // 写不下去就不开这一场——不看就没有分钟数要记，比看完记不上账干净。
      const opened=this.savePlanImpl({stateDir:this.stateDir,date,plan:{...plan,roundSession:session},now});
      if(!opened){this.error='自动观看日程没能写入，这一轮没有开始看。';return;}
    }
    const key=session.key;let operation;this.control(()=>{if(!this.policy().enabled)return;const ledger=this.ledger();
      const entries=ledger.runs.filter(item=>item.key===key),last=entries.at(-1);
      if(last?.status==='occupied'&&last.requiresUser===true){
        // 需要人工处理（登录、验证等）之后不再自动重试，仍等本人处理；
        // 只有本人显式重新开启允许观看（configure 翻成 acknowledged）后才能再次开始。
        return;
      }
      if(last?.status==='failed'){
        // 普通失败同一场不永久趴窝：15 分钟退避后再试。
        const failedAt=Date.parse(last.completedAt||'');
        if(Number.isSafeInteger(failedAt)&&now-failedAt<15*60_000)return;
        const attempts=entries.filter(item=>['failed','acknowledged'].includes(item.status)).length;
        // 用户裁决（2026-11-09）：24/7 单时段策略下固定 3 次会让全天趴窝；上限随时段时长缩放
        //（每 15 分钟退避一次、覆盖整个时段），短时段仍不低于原 3 次。
        const maxAttempts=Math.max(3,Math.floor((session.expiresAt-session.startAt)/(15*60_000)));
        if(attempts>=maxAttempts)return;
      }
      // 这一场已经开过（还在跑，或刚跑完正在记账）：不再开第二轮。
      if(last?.status==='started'||last?.status==='starting')return;
      operation={...session,id:randomUUID(),source:this.source,pid:process.pid,startedAt:new Date(now).toISOString(),status:'starting'};ledger.runs.push(operation);this.pruneLedger(ledger);write(this.ledgerFile,ledger);
    });if(!operation)return;this.abort=new AbortController();
    try{if(!this.policy().enabled)throw new Error('允许观看已关闭');const result=await this.startRound({signal:this.abort.signal,expiresAt:session.expiresAt});this.finish(operation.id,'started',result?.sessionId||null);this.error='';}
    catch(error){if(error.code==='WATCH_MANUAL_OCCUPIED'){this.finish(operation.id,'occupied',null);return;}this.finish(operation.id,'failed',null,explain(error));throw error;}finally{this.abort=null;}
  }
  // 结清上一场：自主观看停了才记账。看完了就记今天看了多久并歇一阵；
  // 出错或要人工处理就把这一场标成 failed / occupied，轮次不推进，
  // 同一场的编号不变——回执与重试仍落在同一场里。
  //
  // 找的是「账本里还没结清的场次」，不是「当天的计划里挂着的那一场」：
  // 跨过零点后当天的计划里没有昨天那一场，只看当天就永远结不掉昨天的账。
  settleRound({plan,watch,now,date}){
    const candidates=roundCandidates({stateDir:this.stateDir}).sort((a,b)=>a.session.expiresAt-b.session.expiresAt);
    let settled=false,failed=false,usedMinutes=0,owner=null,session=null;
    this.control(()=>{
      const ledger=this.ledger();
      // 「账本已结清、日程还没入账」的回执：直接按账本里留住的首次结算值补记。
      // 不依赖日程里挂着的那一场（开场就没落盘的场根本不在日程里），
      // 也不依赖这一轮有没有待结的新回执——上一轮补记写盘失败时留下的
      // creditPending 标记，每一轮 tick 都要认出来接着补。
      const owed=ledger.runs.find(item=>item.settledAt&&item.creditPending===true)
        ||ledger.runs.filter(item=>item.creditPending===true)
          .sort((a,b)=>Number(a.startAt||0)-Number(b.startAt||0))[0]||null;
      if(owed){
        session={key:owed.key,round:owed.round,startAt:owed.startAt,expiresAt:owed.expiresAt,minutes:owed.minutes};
        owner=null;settled=true;
        failed=owed.status==='failed'||owed.status==='occupied';
        usedMinutes=failed?0:(Number.isFinite(owed.usedMinutes)?owed.usedMinutes:0);
        return;
      }
      // 还没结清的回执：这一场已经跑完，但账还没记上。最早的那场先结。
      const pending=ledger.runs.filter(item=>item.status==='started'&&!item.settledAt)
        .sort((a,b)=>Number(a.startAt||0)-Number(b.startAt||0))[0]||null;
      if(pending){
        session={key:pending.key,round:pending.round,startAt:pending.startAt,expiresAt:pending.expiresAt,minutes:pending.minutes};
        owner=candidates.find(item=>item.plan.roundSession?.key===pending.key)||null;
        const status=watch?.status;
        if(status==='failed'||status==='needs_user'){
          const needsUser=status==='needs_user';
          pending.status=needsUser?'occupied':'failed';
          if(needsUser)pending.requiresUser=true;
          pending.completedAt=new Date(now).toISOString();
          pending.error=explain(watch.lastError||(needsUser?'自主观看等待人工处理，请处理后重新开启允许观看。':'自主观看异常停止，请处理后重新开启允许观看。'));
          ledger.lastError=pending.error;write(this.ledgerFile,ledger);this.error=pending.error;
          settled=true;failed=true;return;
        }
        if(!watch?.running){
          // 这一场已经结束：先按实际时长把账记上。
          // 记下的分钟数要跟着这场走：重试补记时沿用首次结算值，
          // 不能用现在的时钟重算——时钟推进后重算会把 3 分钟算成 6 分钟。
          const used=Number.isFinite(pending.usedMinutes)
            ? pending.usedMinutes
            : Math.max(0,Math.min(Number.isFinite(session.minutes)?session.minutes:0,Math.round((now-session.startAt)/60000)));
          pending.settledAt=new Date(now).toISOString();
          // 首次结算值要留在账本里：补记重试沿用它，不用推进后的时钟重算。
          pending.usedMinutes=used;
          // 补记（把分钟数落进日程）可能写不进去：打上「待补记」标记，
          // 之后的每一轮 tick 都能从账本里认出这笔账还没落到日程，
          // 不依赖日程里还挂着的那一场（开场就没落盘的场根本不在日程里）。
          pending.creditPending=true;
          write(this.ledgerFile,ledger);
          settled=true;failed=false;usedMinutes=used;return;
        }
        return;
      }
      // 没有待结的回执，但有一场已经结过账、日程却还没写回去：
      // 说明上一次写盘失败。按账本里已记下的分钟数补记一次，不按 0 分钟覆盖。
      // 注意「占用」分两种：等本人处理的（requiresUser）这一场就此结束；
      // 只是被聊天采样占住的（没有 requiresUser）这一场还要留着继续用，不能在这里结掉。
      const writtenRuns=ledger.runs.filter(item=>(item.settledAt||item.status==='failed'||(item.status==='occupied'&&item.requiresUser===true))&&item.key);
      const unwritten=candidates.find(item=>writtenRuns.some(run=>run.key===item.plan.roundSession?.key));
      if(unwritten){
        const run=writtenRuns.find(item=>item.key===unwritten.plan.roundSession?.key);
        session=unwritten.session;owner=unwritten;settled=true;
        failed=run?.status==='failed'||run?.status==='occupied';
        usedMinutes=failed?0:(Number.isFinite(run?.usedMinutes)?run.usedMinutes:0);
        return;
      }
      // 没有待结的回执，但场次时间已经过去（换了实例或进程重启过，没开起来）：按没看成记账，不占今天的时长。
      const expired=candidates.find(item=>Number.isFinite(item.session.expiresAt)&&now>=item.session.expiresAt);
      if(expired){session=expired.session;owner=expired;settled=true;failed=false;usedMinutes=0;}
    });
    if(!settled)return false;
    if(owner?.plan&&owner?.date){
      // 记账写回这一场所属的那一天（可能不是今天）。
      const written=this.savePlanImpl({stateDir:this.stateDir,date:owner.date,plan:closeSession({plan:owner.plan,session,cooldown:failed?0:cooldownMinutes(this.random),failed,usedMinutes,now}),now});
      // 日程写不下去时，这场仍然挂在计划里，等下一轮按账本里已记下的分钟数再记一次：
      // 不会被当成「没看成」按 0 分钟覆盖掉。这一轮到此为止，不再开新的一场。
      if(!written)this.planWriteFailed=true;
      else{
        this.planWriteFailed=false;
        // 这一场的账已经真的落进日程了：把「待补记」标记清掉，
        // 不然下一轮 tick 会把它当成欠账再补一次。
        this.control(()=>{
          const ledger=this.ledger();
          const entry=ledger.runs.find(item=>item.key===session.key);
          if(!entry||entry.creditPending!==true)return;
          delete entry.creditPending;write(this.ledgerFile,ledger);
        });
      }
      return true;
    }
    // 这一场从来没落盘过（开场写盘失败）：日程里没有它，只能按场次编号把它属于的那天找回来，
    // 给那天补一份日程，把这一场记进去——不然账本里记下的分钟数永远没有落脚点。
    const derived=sessionDate(session);
    if(!derived)return true;
    // 已经补记过的不能补两次。
    if(creditedSessionKeys({stateDir:this.stateDir}).has(session.key))return true;
    const existing=loadPlan({stateDir:this.stateDir,date:derived});
    // 同一天可能要补好几场：一律在当天已有的日程上继续累加，
    // 不能因为这份日程是补记出来的（recovered）就丢掉前面已经记下的时长和场次。
    const base=existing||recoveredPlan(derived);
    const credited=creditSession({plan:base,session,usedMinutes,failed,now});
    // 这场如果还挂在日程里（结账写回失败过的那一场），补记完就要把它摘下来：
    // 账已经记进 sessions 了，再挂着会让下一轮的结账分支把同一场再记一次。
    if(credited.roundSession?.key===session.key)credited.roundSession=null;
    const written=this.savePlanImpl({stateDir:this.stateDir,date:derived,plan:credited,now});
    if(!written){
      this.planWriteFailed=true;
      // 补记没写回去：待补记标记必须留在账本里，下一轮要靠它认出这笔账还没落到日程；
      // 同时把结清标记撤掉，下一轮按账本里同样的分钟数再补一次，不会永远漏掉这一笔。
      this.reopenSettledRun(session.key);
    }else{
      // 只有真的写进去了才能清标记：写失败就清，下一轮就再也认不出这笔欠账了。
      this.control(()=>{
        const ledger=this.ledger();
        const entry=ledger.runs.find(item=>item.key===session.key);
        if(!entry||entry.creditPending!==true)return;
        delete entry.creditPending;write(this.ledgerFile,ledger);
      });
      this.planWriteFailed=false;
    }
    return true;
  }
  // 撤回结清标记：这笔账还没落到日程里，等下一轮重试。
  reopenSettledRun(key){
    this.control(()=>{
      const ledger=this.ledger();
      const entry=ledger.runs.find(item=>item.key===key);
      if(!entry||!entry.settledAt)return;
      delete entry.settledAt;
      write(this.ledgerFile,ledger);
    });
  }
  finish(id,status,sessionId,error=''){this.control(()=>{const ledger=this.ledger(),entry=ledger.runs.find(item=>item.id===id);if(!entry)throw new Error('自动观看回执丢失');Object.assign(entry,{status,sessionId,completedAt:new Date(this.now()).toISOString(),...(error?{error}:{})});ledger.lastError=status==='failed'?error:'';this.pruneLedger(ledger);write(this.ledgerFile,ledger);});}
  async close(){this.closed=true;clearInterval(this.timer);this.abort?.abort(new Error('自动观看入口已关闭。'));await this.pending;}
}
