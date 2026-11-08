import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveRuntimePaths } from './runtime-paths.mjs';

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

// 总允许开关保持开启时，在允许时段和每日额度内自动继续；异常保留到人工处理。
export class ScheduledWatch {
  constructor({stateDir=resolveRuntimePaths().stateDir,getVideoLimits,getWatchState,startRound,source='api',now=Date.now,intervalMs=5000}={}){Object.assign(this,{stateDir,getVideoLimits,getWatchState,startRound,source,now,intervalMs});this.policyFile=path.join(stateDir,'watch-schedule-policy.json');this.ledgerFile=path.join(stateDir,'watch-schedule-runs.json');this.guardFile=path.join(stateDir,'watch-schedule.guard');this.closed=false;}
  policy(){return policyOf(load(this.policyFile,{...defaultPolicy}));}
  ledger(){const value=load(this.ledgerFile,{version:1,runs:[]});if(value?.version!==1||!Array.isArray(value.runs)||value.runs.some(item=>!item?.key||!['starting','started','failed','occupied','acknowledged'].includes(item.status)))throw new Error('自动观看回执损坏，未覆盖或重试。');return value;}
  state(){const policy=this.policy(),ledger=this.ledger(),last=ledger.runs.at(-1)||null,lastError=Object.hasOwn(ledger,'lastError')?ledger.lastError:last?.status==='failed'?last.error||this.error||'自主观看异常停止，请检查后重新开启允许观看。':this.error||'';return{protocol:'scheduled-watch-v2',policy,last,busy:Boolean(this.pending),lastError,note:'允许观看后，在设置时段和每日时长、模型次数范围内自动观看；登录、验证或运行异常需要处理后重新开启允许观看。'};}
  control(action){fs.mkdirSync(this.stateDir,{recursive:true});let fd;const owner={pid:process.pid,token:randomUUID()};try{fd=fs.openSync(this.guardFile,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw Object.assign(new Error('另一个入口正在检查自动观看。'),{code:'SCHEDULE_BUSY'});throw error;}try{fs.writeFileSync(fd,JSON.stringify(owner));return action();}finally{fs.closeSync(fd);const current=load(this.guardFile,null);if(current?.pid===owner.pid&&current.token===owner.token)fs.unlinkSync(this.guardFile);}}
  configure(value,{explicit=false}={}){if(!explicit)throw new Error('允许观看需要本人明确保存。');const policy=policyOf(value);this.control(()=>{
    const previous=load(this.policyFile,defaultPolicy),videoFile=path.join(this.stateDir,'video-policy.json'),video=load(videoFile,null),legacy=previous.maxRequests??value.maxRequests;
    if(video&&video.dailyRequests===undefined&&legacy!==undefined){if(legacy!==null&&(!Number.isSafeInteger(legacy)||legacy<1))throw new Error('旧每日请求设置损坏，未覆盖。');write(videoFile,{...video,dailyRequests:legacy});}
    write(this.policyFile,policy);if(policy.enabled){const ledger=this.ledger();for(const item of ledger.runs)if(['failed','occupied'].includes(item.status))item.status='acknowledged';ledger.lastError='';write(this.ledgerFile,ledger);this.error='';}
  });if(!policy.enabled)this.abort?.abort(new Error('已关闭允许观看。'));return this.state();}
  start(){if(!this.timer){this.timer=setInterval(()=>{void this.tick();},this.intervalMs);this.timer.unref?.();void this.tick();}return this;}
  tick(){if(this.closed||this.pending)return this.pending||Promise.resolve(this.state());this.pending=this.perform().catch(error=>{if(error.code!=='SCHEDULE_BUSY'){this.error=explain(error);try{this.control(()=>{const ledger=this.ledger();ledger.lastError=this.error;write(this.ledgerFile,ledger);});}catch{}}}).finally(()=>{this.pending=null;});return this.pending;}
  async perform(){const limits=await this.getVideoLimits();if(!this.policy().enabled){this.abort?.abort(new Error('已关闭允许观看。'));limits.settleWatching?.();return;}
    const time=limits.state(),slot=scheduledSlot(time.policy,this.now());if(!slot||!time.allowed)return;
    const manual=load(path.join(this.stateDir,'watch-manual.lock'),null);
    if(manual){if(!Number.isSafeInteger(manual.pid)||manual.pid<1||typeof manual.token!=='string')throw new Error('手动视频操作锁无法核对，未启动自主观看。');try{process.kill(manual.pid,0);return;}catch(error){if(error.code==='EPERM')return;if(error.code!=='ESRCH')throw error;}}
    const watch=await this.getWatchState();if(watch?.running||watch?.busy||watch?.pendingRequests>0)return;
    let operation;this.control(()=>{if(!this.policy().enabled)return;const ledger=this.ledger(),last=ledger.runs.at(-1);
      if(ledger.runs.some(item=>item.key===slot.key&&item.status==='occupied'&&item.requiresUser===true)){
        // needs_user（登录/验证等需人工处理）停止本时段永不自动重试，仍等人工处理；
        // 只有本人显式重新开启允许观看（configure 翻成 acknowledged）后才能再次开始。
        // 聊天采样等临时占用（WATCH_MANUAL_OCCUPIED，无 requiresUser 标记）释放后按既有契约自动继续。
        return;
      }
      if(ledger.runs.some(item=>item.key===slot.key&&item.status==='failed')){
        // 普通失败同时段不永久趴窝：15 分钟退避后再试。
        const failedAt=Date.parse(ledger.runs.filter(item=>item.key===slot.key&&item.status==='failed').at(-1)?.completedAt||'');
        if(Number.isSafeInteger(failedAt)&&this.now()-failedAt<15*60_000)return;
        const attempts=ledger.runs.filter(item=>item.key===slot.key&&['failed','acknowledged'].includes(item.status)).length;
        // 用户裁决（2026-11-09）：24/7 单时段策略下固定 3 次会让全天趴窝；上限随时段时长缩放
        //（每 15 分钟退避一次、覆盖整个时段），短时段仍不低于原 3 次。
        const maxAttempts=Math.max(3,Math.floor((slot.expiresAt-slot.startAt)/(15*60_000)));
        if(attempts>=maxAttempts)return;
      }
      if(last?.key===slot.key&&last.status==='starting')return;
      if(last?.key===slot.key&&last.status==='started'&&['failed','needs_user'].includes(watch?.status)){const needsUser=watch?.status==='needs_user';last.status=needsUser?'occupied':'failed';if(needsUser)last.requiresUser=true;last.completedAt=new Date(this.now()).toISOString();last.error=explain(watch.lastError||(needsUser?'自主观看等待人工处理，请处理后重新开启允许观看。':'自主观看异常停止，请处理后重新开启允许观看。'));ledger.lastError=last.error;write(this.ledgerFile,ledger);this.error=last.error;return;}
      operation={...slot,id:randomUUID(),source:this.source,pid:process.pid,startedAt:new Date(this.now()).toISOString(),status:'starting'};ledger.runs.push(operation);write(this.ledgerFile,ledger);
    });if(!operation)return;this.abort=new AbortController();
    try{if(!this.policy().enabled)throw new Error('允许观看已关闭');const result=await this.startRound({signal:this.abort.signal});this.finish(operation.id,'started',result?.sessionId||null);this.error='';}
    catch(error){if(error.code==='WATCH_MANUAL_OCCUPIED'){this.finish(operation.id,'occupied',null);return;}this.finish(operation.id,'failed',null,explain(error));throw error;}finally{this.abort=null;}
  }
  finish(id,status,sessionId,error=''){this.control(()=>{const ledger=this.ledger(),entry=ledger.runs.find(item=>item.id===id);if(!entry)throw new Error('自动观看回执丢失');Object.assign(entry,{status,sessionId,completedAt:new Date(this.now()).toISOString(),...(error?{error}:{})});ledger.lastError=status==='failed'?error:'';write(this.ledgerFile,ledger);});}
  async close(){this.closed=true;clearInterval(this.timer);this.abort?.abort(new Error('自动观看入口已关闭。'));await this.pending;}
}
