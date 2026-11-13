import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ScheduledWatch, scheduledSlot } from '../scheduled-watch.mjs';
import { savePlan } from '../watch-plan.mjs';
import { VideoLimits } from '../video-limits.mjs';
import { AutonomousWatch } from '../autonomous-watch.mjs';
import { interactionStatus } from '../interaction-status.mjs';
function fixture(t,time='2026-10-23T00:59:00Z') {const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'douyin-scheduled-'));let clock=Date.parse(time);const video=new VideoLimits({stateDir,now:()=>clock});t.after(()=>{assert.equal(path.dirname(stateDir),path.resolve(os.tmpdir()));fs.rmSync(stateDir,{recursive:true,force:true});});let starts=0;const options={stateDir,getVideoLimits:async()=>video,getWatchState:async()=>({running:false}),startRound:async()=>{starts++;return{sessionId:'synthetic-session'};},now:()=>clock};return{stateDir,video,options,setTime:value=>{clock=Date.parse(value);},starts:()=>starts};}

test('聊天采样持有手动锁时等待，释放后自动继续且不记失败', async t => {
 const f=fixture(t),schedule=new ScheduledWatch(f.options);f.video.savePolicy({windows:['00:00-24:00'],dailyMinutes:10,dailyRequests:30},{explicit:true});schedule.configure({enabled:true},{explicit:true});
 const manual=path.join(f.stateDir,'watch-manual.lock');fs.writeFileSync(manual,JSON.stringify({pid:process.pid,token:'synthetic-chat-lock',kind:'chat-shared-video'}));
 await schedule.tick();assert.equal(f.starts(),0);assert.equal(schedule.state().last,null);
 fs.unlinkSync(manual);await schedule.tick();assert.equal(f.starts(),1);assert.equal(schedule.state().last.status,'started');
});

test('检查后才被聊天占用时保留等待回执，下一次检查仍可继续', async t => {
 const f=fixture(t);let busy=true;const schedule=new ScheduledWatch({...f.options,startRound:async()=>{if(busy)throw Object.assign(new Error('合成聊天采样占用'),{code:'WATCH_MANUAL_OCCUPIED'});return f.options.startRound();}});
 f.video.savePolicy({windows:['00:00-24:00'],dailyMinutes:10,dailyRequests:30},{explicit:true});schedule.configure({enabled:true},{explicit:true});await schedule.tick();assert.equal(schedule.state().last.status,'occupied');assert.equal(schedule.state().lastError,'');busy=false;await schedule.tick();assert.equal(f.starts(),1);
});
test('未允许或时段外不启动，健康空闲时自动继续且两个入口不重复同时启动',async t=>{
 const f=fixture(t);f.video.savePolicy({windows:['09:00-10:00','20:00-21:00'],dailyMinutes:60,dailyRequests:30},{explicit:true});let running=false;
 const options={...f.options,random:()=>0,getWatchState:async()=>({running}),startRound:async()=>{running=true;return f.options.startRound();}},a=new ScheduledWatch({...options,source:'api'}),b=new ScheduledWatch({...options,source:'dsh'});
 await a.tick();assert.equal(f.starts(),0);a.configure({enabled:true},{explicit:true});await a.tick();assert.equal(f.starts(),0);f.setTime('2026-10-23T01:00:00Z');await Promise.all([a.tick(),b.tick()]);assert.equal(f.starts(),1);await b.tick();assert.equal(f.starts(),1);
 running=false;await a.tick();assert.equal(f.starts(),1,'刚看完不会立刻开下一场');
  f.setTime('2026-10-23T01:21:00Z');await a.tick();assert.equal(f.starts(),2);assert.equal(a.state().last.status,'started');
});
test('全天按上海日期每天一轮，跨夜时段保持同一编号，周末全天单独按天处理',()=>{const all={windows:['00:00-24:00']};assert.notEqual(scheduledSlot(all,Date.parse('2026-10-23T15:59:00Z')).key,scheduledSlot(all,Date.parse('2026-10-23T16:00:00Z')).key);const night={windows:['23:00-01:00']};assert.equal(scheduledSlot(night,Date.parse('2026-10-23T15:30:00Z')).key,scheduledSlot(night,Date.parse('2026-10-23T16:30:00Z')).key);const weekend={windows:['18:00-24:00'],weekendWindows:['00:00-24:00']};assert.notEqual(scheduledSlot(weekend,Date.parse('2026-10-24T02:00:00Z')).key,scheduledSlot(weekend,Date.parse('2026-10-25T02:00:00Z')).key);});
test('启动失败保留回执，同一时段不循环重试；已有观看也不另开轮次',async t=>{const f=fixture(t);let starts=0;const schedule=new ScheduledWatch({...f.options,startRound:async()=>{starts++;throw new Error('合成模型尚未配置');}});schedule.configure({enabled:true,maxRequests:30},{explicit:true});await schedule.tick();await schedule.tick();assert.equal(starts,1);assert.equal(schedule.state().last.status,'failed');f.setTime('2026-10-24T01:00:00Z');const second=new ScheduledWatch({...f.options,getWatchState:async()=>({running:true})});await second.tick();assert.equal(second.state().last.status,'failed');assert.equal(f.starts(),0);});
test('关闭许可可撤回尚未真正启动的异步操作，损坏回执不清空、不抢占残留锁',async t=>{const f=fixture(t);let release,entered;const gate=new Promise(resolve=>{release=resolve;}),entry=new Promise(resolve=>{entered=resolve;});let started=false;const schedule=new ScheduledWatch({...f.options,startRound:async({signal})=>{entered();await gate;signal.throwIfAborted();started=true;}});schedule.configure({enabled:true,maxRequests:30},{explicit:true});const pending=schedule.tick();await entry;schedule.configure({enabled:false,maxRequests:30},{explicit:true});release();await pending;assert.equal(started,false);assert.equal(schedule.state().last.status,'failed');fs.writeFileSync(schedule.ledgerFile,'{');await schedule.tick();assert.equal(fs.readFileSync(schedule.ledgerFile,'utf8'),'{');fs.writeFileSync(schedule.guardFile,'合成残留锁');
// 坏掉的残留锁不该永远堵住入口：把它改名归档（内容原样保留），把位置腾出来。
// 账本本身仍是坏的，所以这一步仍会因账本损坏报错——但错因不再是「被残留锁挡住」。
const stale=Date.now()/1000-10;fs.utimesSync(schedule.guardFile,stale,stale);
assert.throws(()=>schedule.configure({enabled:false,maxRequests:30},{explicit:true}),/无法读取|回执损坏/);
assert.equal(fs.existsSync(schedule.guardFile),false,'坏锁已被归档腾出位置');
const archived=fs.readdirSync(f.stateDir).filter(name=>name.startsWith('watch-schedule.guard.corrupt-'));
assert.equal(archived.length,1,'坏锁留了一份归档');
assert.equal(fs.readFileSync(path.join(f.stateDir,archived[0]),'utf8'),'合成残留锁','归档内容一字不改');
assert.equal(fs.readFileSync(schedule.ledgerFile,'utf8'),'{','坏账本依旧不被覆盖');});
test('调度接入自主观看循环，达到每日请求上限后同日不再自动启动',async t=>{const f=fixture(t);f.video.savePolicy({windows:['00:00-24:00'],dailyMinutes:10,dailyRequests:1},{explicit:true});const id='7579432563794584933',state={video:{id,title:'合成作品',time:0,duration:60,paused:false,readyState:4}};let decisions=0,paused=0;const controller={async execute(name){if(name==='douyin_observe')return{state,frames:[{videoId:id,mimeType:'image/jpeg',data:'eA=='}],personaEvidenceId:'synthetic-evidence'};return state;},async pauseForLimits(){paused++;}};
  const watch=new AutonomousWatch({controller,videoLimits:f.video,stateDir:f.stateDir,now:f.options.now,personaMemory:{context:()=>'',recordViewing:()=>null},config:{apiKey:'synthetic-key'},agent:{async decideWatch(){decisions++;return{decision:{action:'stop',reason:'合成观察已完成',reflection:'仅使用合成画面',topics:[]},usage:{totalTokens:1}};}}});
  const scheduler=new ScheduledWatch({...f.options,getWatchState:async()=>watch.state(),startRound:async()=>watch.start({startSession:true},{explicit:true})});scheduler.configure({enabled:true},{explicit:true});await scheduler.tick();await watch.completion;assert.equal(decisions,1);assert.equal(watch.state().running,false);assert.equal(f.video.state().session.startedBy,'api');assert.equal(scheduler.state().last.status,'started');await scheduler.tick();assert.equal(decisions,1);assert.ok(paused>0);await watch.close();
});
test('好友状态区分许可与运行，分享等待自主观看，续火入口已移除',()=>{const initial=interactionStatus({modelReady:true,chat:{policy:{allowlist:[{id:'synthetic'}]}},spark:{enabled:true},share:{enabled:true},comments:{enabled:true}});assert.ok(initial.rows.every(item=>!item.running));assert.match(initial.rows[0].message,/未启动/);assert.match(initial.rows[1].message,/等待自主观看/);const active=interactionStatus({modelReady:true,chat:{running:true,policy:{allowlist:[{}]}},spark:{enabled:true,running:true,inWindow:true},share:{enabled:true},comments:{enabled:true},watch:{running:true}});assert.ok(active.rows.every(item=>item.running));});


test('自动观看失败理由跨软件插件与重构实例可回读，重新明确开启后旧错误清除',async t=>{
 const f=fixture(t);const schedule=new ScheduledWatch({...f.options,startRound:async()=>{throw new Error('合成浏览器占用 https://example.invalid/work?token=synthetic-secret');}});schedule.configure({enabled:true},{explicit:true});await schedule.tick();
 const other=new ScheduledWatch({...f.options,source:'dsh'});assert.equal(other.state().last.status,'failed');assert.match(other.state().lastError,/合成浏览器占用/);assert.doesNotMatch(JSON.stringify(other.state()),/synthetic-secret/);
 other.configure({enabled:true},{explicit:true});assert.equal(other.state().lastError,'');assert.equal(schedule.state().lastError,'');assert.equal(schedule.state().last.status,'acknowledged');
});

test('启动后watch异步失败会持久显示原因，保持失败回执且不在每tick重复开新运行',async t=>{
 const f=fixture(t);let watch={running:false,status:'stopped'};const schedule=new ScheduledWatch({...f.options,getWatchState:async()=>watch});schedule.configure({enabled:true},{explicit:true});await schedule.tick();assert.equal(f.starts(),1);watch={running:false,status:'failed',lastError:'合成同一入口锁超时'};await schedule.tick();await schedule.tick();assert.equal(f.starts(),1);const other=new ScheduledWatch({...f.options,source:'dsh'});assert.equal(other.state().last.status,'failed');assert.equal(other.state().lastError,'合成同一入口锁超时');
});
test('needs_user停止后本时段永不自动重试，多次tick保持一次启动',async t=>{
 const f=fixture(t);let watch={running:false,status:'stopped'};const schedule=new ScheduledWatch({...f.options,getWatchState:async()=>watch});schedule.configure({enabled:true},{explicit:true});await schedule.tick();assert.equal(f.starts(),1);
 watch={running:false,status:'needs_user',lastError:'合成登录需要人工处理'};
 // 推进越过 15 分钟退避窗口并多次检查，启动次数不得从 1 变 2。
 f.setTime('2026-10-23T01:25:00Z');await schedule.tick();await schedule.tick();f.setTime('2026-10-23T02:30:00Z');await schedule.tick();
 assert.equal(f.starts(),1);assert.equal(schedule.state().last.status,'occupied');assert.doesNotMatch(JSON.stringify(schedule.state().runs??schedule.state()),/"status":"failed"/);
});
test('本人显式重新开启允许观看后，同一时段可以再次启动',async t=>{
 const f=fixture(t);let watch={running:false,status:'stopped'};const schedule=new ScheduledWatch({...f.options,getWatchState:async()=>watch});schedule.configure({enabled:true},{explicit:true});await schedule.tick();assert.equal(f.starts(),1);
 watch={running:false,status:'needs_user',lastError:'合成登录需要人工处理'};f.setTime('2026-10-23T01:25:00Z');await schedule.tick();assert.equal(f.starts(),1);assert.equal(schedule.state().last.status,'occupied');
 watch={running:false,status:'stopped'};schedule.configure({enabled:true},{explicit:true});assert.equal(schedule.state().last.status,'acknowledged');
 await schedule.tick();assert.equal(f.starts(),2);assert.equal(schedule.state().last.status,'started');
});
test('跨过零点后上一场仍能结清：按它所属的那天写回日程，不留悬空账',async t=>{
  // 15:59Z = 上海 23:59，16:05Z = 上海次日 00:05。
  const f=fixture(t,'2026-10-23T15:59:00Z');
  f.video.savePolicy({windows:['00:00-24:00'],dailyMinutes:60,dailyRequests:30},{explicit:true});
  const schedule=new ScheduledWatch({...f.options,getWatchState:async()=>({running:false,status:'stopped'})});
  schedule.configure({enabled:true,maxRequests:30},{explicit:true});
  await schedule.tick();
  assert.equal(f.starts(),1,'先开一场');
  const before=JSON.parse(fs.readFileSync(schedule.ledgerFile,'utf8'));
  const opened=before.runs.at(-1);
  assert.equal(opened.status,'started');
  assert.equal(opened.settledAt,undefined,'这一场还没结账');
  f.setTime('2026-10-23T16:05:00Z');
  await schedule.tick();
  const after=JSON.parse(fs.readFileSync(schedule.ledgerFile,'utf8'));
  const settled=after.runs.find(item=>item.key===opened.key);
  assert.ok(settled.settledAt,'跨过零点后上一场已结清');
  const plan=JSON.parse(fs.readFileSync(path.join(f.stateDir,'watch-schedule-plan.json'),'utf8'));
  assert.ok(plan.days['2026-10-23'],'10-23 的日程仍在');
  assert.equal(plan.days['2026-10-23'].plan.roundSession,null,'结清后不再挂着场次');
});
test('普通failed退避重试不回归：15分钟内不重试，越过退避后同一天至多三次',async t=>{
 const f=fixture(t);let watch={running:false,status:'stopped'};const schedule=new ScheduledWatch({...f.options,getWatchState:async()=>watch});schedule.configure({enabled:true},{explicit:true});await schedule.tick();assert.equal(f.starts(),1);
 watch={running:false,status:'failed',lastError:'合成异常停止'};f.setTime('2026-10-23T01:10:00Z');await schedule.tick();assert.equal(f.starts(),1,'退避窗口内不重试');
 f.setTime('2026-10-23T01:25:00Z');await schedule.tick();assert.equal(f.starts(),2,'越过退避后重试');assert.equal(schedule.state().last.status,'started');
 watch={running:false,status:'failed'};f.setTime('2026-10-23T02:40:00Z');await schedule.tick();assert.equal(f.starts(),2);f.setTime('2026-10-23T03:55:00Z');await schedule.tick();assert.equal(f.starts(),3,'同一天至多三次');f.setTime('2026-10-23T05:10:00Z');await schedule.tick();assert.equal(f.starts(),3,'第三次失败后当日不再重试');
});
test('日程写盘失败一次后按原分钟数补记，不被当成零分钟覆盖',async t=>{
  const f=fixture(t,'2026-10-23T15:59:00Z');
  f.video.savePolicy({windows:['00:00-24:00'],dailyMinutes:60,dailyRequests:30},{explicit:true});
  let failed=false;
  // 第一次结账写盘失败：这一场仍然挂在计划里，等下一轮按账本里的分钟数补记。
  const savePlanImpl=args=>{
    if(!failed&&args.plan?.roundSession===null&&(args.plan?.sessions||[]).length>0){failed=true;return false;}
    return savePlan(args);
  };
  const schedule=new ScheduledWatch({...f.options,getWatchState:async()=>({running:false,status:'stopped'}),savePlanImpl});
  schedule.configure({enabled:true,maxRequests:30},{explicit:true});
  await schedule.tick();
  assert.equal(f.starts(),1,'先开一场');
  const opened=JSON.parse(fs.readFileSync(schedule.ledgerFile,'utf8')).runs.at(-1);
  assert.equal(opened.status,'started');
  f.setTime('2026-10-23T16:05:00Z');
  await schedule.tick();
  assert.equal(failed,true,'第一次结账确实写盘失败');
  const ledger=JSON.parse(fs.readFileSync(schedule.ledgerFile,'utf8'));
  const settledRun=ledger.runs.find(item=>item.key===opened.key);
  assert.ok(settledRun.settledAt,'回执已结清');
  assert.equal(settledRun.usedMinutes,6,'回执记下了 6 分钟');
  const pendingPlan=JSON.parse(fs.readFileSync(path.join(f.stateDir,'watch-schedule-plan.json'),'utf8'));
  assert.ok(pendingPlan.days['2026-10-23'].plan.roundSession,'写盘失败时这一场仍挂在计划里');
  await schedule.tick();
  const plan=JSON.parse(fs.readFileSync(path.join(f.stateDir,'watch-schedule-plan.json'),'utf8'));
  assert.equal(plan.days['2026-10-23'].plan.roundSession,null,'补记后不再挂着场次');
  assert.equal(plan.days['2026-10-23'].plan.spentMinutes,6,'按原来的 6 分钟记账，没有被当成 0 分钟');
});
test('关闭允许观看后仍然把上一场结清，跨零点不留悬空账',async t=>{
  const f=fixture(t,'2026-10-23T15:59:00Z');
  f.video.savePolicy({windows:['00:00-24:00'],dailyMinutes:60,dailyRequests:30},{explicit:true});
  const schedule=new ScheduledWatch({...f.options,getWatchState:async()=>({running:false,status:'stopped'})});
  schedule.configure({enabled:true,maxRequests:30},{explicit:true});
  await schedule.tick();
  assert.equal(f.starts(),1,'先开一场');
  const opened=JSON.parse(fs.readFileSync(schedule.ledgerFile,'utf8')).runs.at(-1);
  f.setTime('2026-10-23T16:05:00Z');
  schedule.configure({enabled:false,maxRequests:30},{explicit:true});
  await schedule.tick();
  const ledger=JSON.parse(fs.readFileSync(schedule.ledgerFile,'utf8'));
  const settledRun=ledger.runs.find(item=>item.key===opened.key);
  assert.ok(settledRun?.settledAt,'关闭许可后这一场也结清了');
  const plan=JSON.parse(fs.readFileSync(path.join(f.stateDir,'watch-schedule-plan.json'),'utf8'));
  assert.equal(plan.days['2026-10-23'].plan.roundSession,null,'结清后不再挂着场次');
});
test('两个入口先后回收同一把坏锁时，不许把对方新建的有效锁归档',async t=>{
  const f=fixture(t);
  const schedule=new ScheduledWatch(f.options);
  fs.writeFileSync(schedule.guardFile,'合成残留锁');
  const stale=Date.now()/1000-10;fs.utimesSync(schedule.guardFile,stale,stale);
  const staleStat=fs.lstatSync(schedule.guardFile);
  // 另一个入口抢先把这把锁换成了自己的新锁。
  const mine=JSON.stringify({pid:process.pid,token:'synthetic-other-owner'});
  fs.writeFileSync(schedule.guardFile,mine);
  assert.equal(schedule.archiveCorruptGuard(staleStat),false,'用旧检查结果不该动别人的新锁');
  assert.equal(fs.readFileSync(schedule.guardFile,'utf8'),mine,'对方的新锁完好');
  assert.equal(fs.readdirSync(f.stateDir).some(name=>name.startsWith('watch-schedule.guard.corrupt-')),false,'没有产生归档');
});
test('开场写盘失败就不开这一场，不会白看一场',async t=>{
  const f=fixture(t,'2026-10-23T15:59:00Z');
  f.video.savePolicy({windows:['00:00-24:00'],dailyMinutes:60,dailyRequests:30},{explicit:true});
  // 开场那一场要落盘（日程里没有它，账本里的分钟数跨天后就没有落脚点）。
  // 写不下去时不开这一场：不看就没有分钟数要记。
  const savePlanImpl=args=>{if(args.plan?.roundSession)return false;return savePlan(args);};
  const schedule=new ScheduledWatch({...f.options,getWatchState:async()=>({running:false,status:'stopped'}),savePlanImpl});
  schedule.configure({enabled:true,maxRequests:30},{explicit:true});
  await schedule.tick();
  assert.equal(f.starts(),0,'写盘失败就不该开始看');
  assert.match(schedule.error||'',/日程没能写入/,'写盘失败要看得见');
});
test('回执里有、日程里没有的那一场，跨天后也能补记进当天的日程',async t=>{
  const f=fixture(t,'2026-10-23T15:59:00Z');
  f.video.savePolicy({windows:['00:00-24:00'],dailyMinutes:60,dailyRequests:30},{explicit:true});
  const schedule=new ScheduledWatch({...f.options,getWatchState:async()=>({running:false,status:'stopped'})});
  schedule.configure({enabled:true,maxRequests:30},{explicit:true});
  // 这一场从未落盘（日程文件被换掉过），只有账本里留着回执。
  fs.writeFileSync(schedule.ledgerFile,JSON.stringify({version:1,runs:[{
    key:'2026-10-23#0',round:0,id:'synthetic-receipt',source:'api',pid:process.pid,
    startAt:Date.parse('2026-10-23T15:59:00Z'),expiresAt:Date.parse('2026-10-23T16:05:00Z'),
    minutes:6,startedAt:new Date(Date.parse('2026-10-23T15:59:00Z')).toISOString(),status:'started',
  }]},null,2));
  f.setTime('2026-10-23T16:05:00Z');
  await schedule.tick();
  const plan=JSON.parse(fs.readFileSync(path.join(f.stateDir,'watch-schedule-plan.json'),'utf8'));
  const day=plan.days['2026-10-23'].plan;
  assert.equal(day.spentMinutes,6,'回执里的 6 分钟被补记回当天日程');
  assert.ok(day.sessions.some(item=>item.key==='2026-10-23#0'),'这一场被记进当天的场次列表');
  assert.equal(day.roundSession,null,'补记不会挂起正在跑的场次');
});
test('回收死进程留下的锁时对方换上了新锁，既不删掉也不覆盖',async t=>{
  const f=fixture(t);
  const schedule=new ScheduledWatch(f.options);
  const mine=JSON.stringify({pid:process.pid,owner:'synthetic-other-owner'});
  fs.writeFileSync(schedule.guardFile,JSON.stringify({pid:2147483647,owner:'synthetic-dead-owner'}));
  // 就在回收读到内容的那一刻，对方把锁换成了自己的新锁。
  const originalRead=fs.readFileSync;
  fs.readFileSync=(file,...rest)=>{
    const text=originalRead(file,...rest);
    if(String(file)===schedule.guardFile&&text&&text.includes('synthetic-dead-owner')){
      fs.writeFileSync(schedule.guardFile,mine);
      fs.readFileSync=originalRead;
    }
    return text;
  };
  try{assert.equal(schedule.reclaimStaleGuard(),false,'换锁之后不该回收');}
  finally{fs.readFileSync=originalRead;}
  assert.equal(fs.readFileSync(schedule.guardFile,'utf8'),mine,'对方的新锁完好');
  assert.equal(fs.readdirSync(f.stateDir).some(name=>name.startsWith('watch-schedule.guard.corrupt-')),false,'没有产生归档');
});
test('回收坏锁时对方换上了新锁，既不删掉也不覆盖',async t=>{
  const f=fixture(t);
  const schedule=new ScheduledWatch(f.options);
  const mine=JSON.stringify({pid:process.pid,owner:'synthetic-other-owner'});
  fs.writeFileSync(schedule.guardFile,'合成残留锁');
  const stale=Date.now()/1000-10;fs.utimesSync(schedule.guardFile,stale,stale);
  const originalRead=fs.readFileSync;
  fs.readFileSync=(file,...rest)=>{
    const text=originalRead(file,...rest);
    if(String(file)===schedule.guardFile&&text==='合成残留锁'){
      fs.writeFileSync(schedule.guardFile,mine);
      fs.readFileSync=originalRead;
    }
    return text;
  };
  try{assert.equal(schedule.reclaimStaleGuard(),false,'换锁之后不该回收');}
  finally{fs.readFileSync=originalRead;}
  assert.equal(fs.readFileSync(schedule.guardFile,'utf8'),mine,'对方的新锁完好');
  assert.equal(fs.readdirSync(f.stateDir).some(name=>name.startsWith('watch-schedule.guard.corrupt-')),false,'没有产生归档');
});
test('回收期间原锁路径一直被占着，别的入口进不来临界区',async t=>{
  const f=fixture(t);
  const schedule=new ScheduledWatch(f.options);
  fs.writeFileSync(schedule.guardFile,JSON.stringify({pid:2147483647,owner:'synthetic-dead-owner'}));
  // 回收读内容的那一刻，原锁必须还在原处：一旦被挪走，这个空隙就够别的入口拿锁。
  const originalRead=fs.readFileSync;
  let thirdEntry=null;
  fs.readFileSync=(file,...rest)=>{
    const text=originalRead(file,...rest);
    if(String(file)===schedule.guardFile&&text&&text.includes('synthetic-dead-owner')){
      try{fs.openSync(schedule.guardFile,'wx',0o600);thirdEntry='拿到了锁';}
      catch(error){thirdEntry=error.code==='EEXIST'?'拿不到锁':`意外错误 ${error.code}`;}
      fs.readFileSync=originalRead;
    }
    return text;
  };
  try{assert.equal(schedule.reclaimStaleGuard(),true,'死进程留下的锁该被回收');}
  finally{fs.readFileSync=originalRead;}
  assert.equal(thirdEntry,'拿不到锁','回收期间原锁路径不能被腾空');
  assert.equal(fs.existsSync(schedule.guardFile),false,'回收完成后位置被腾出来');
});
test('补记写盘失败之后，下一轮会按原分钟数再补一次',async t=>{
  const f=fixture(t,'2026-10-23T15:59:00Z');
  f.video.savePolicy({windows:['00:00-24:00'],dailyMinutes:60,dailyRequests:30},{explicit:true});
  let failed=false;
  // 第一次补记写不下去：之后必须还会再试，不能就这么算了。
  const savePlanImpl=args=>{
    if(!failed&&args.plan?.sessions?.length){failed=true;return false;}
    return savePlan(args);
  };
  const schedule=new ScheduledWatch({...f.options,getWatchState:async()=>({running:false,status:'stopped'}),savePlanImpl});
  schedule.configure({enabled:true,maxRequests:30},{explicit:true});
  fs.writeFileSync(schedule.ledgerFile,JSON.stringify({version:1,runs:[{
    key:'2026-10-23#0',round:0,id:'synthetic-receipt',source:'api',pid:process.pid,
    startAt:Date.parse('2026-10-23T15:59:00Z'),expiresAt:Date.parse('2026-10-23T16:05:00Z'),
    minutes:6,startedAt:new Date(Date.parse('2026-10-23T15:59:00Z')).toISOString(),status:'started',
  }]},null,2));
  f.setTime('2026-10-23T16:05:00Z');
  await schedule.tick();
  assert.equal(failed,true,'第一次补记确实写失败了');
  let plan=JSON.parse(fs.readFileSync(path.join(f.stateDir,'watch-schedule-plan.json'),'utf8'));
  assert.equal(plan.days['2026-10-23']?.plan?.spentMinutes||0,0,'写失败的那一轮还没记进去');
  // 账本里这笔不能被当成已经结清：下一轮要按同样的分钟数再补一次。
  await schedule.tick();
  plan=JSON.parse(fs.readFileSync(path.join(f.stateDir,'watch-schedule-plan.json'),'utf8'));
  assert.equal(plan.days['2026-10-23'].plan.spentMinutes,6,'下一轮按原分钟数补记回来了');
  assert.ok(plan.days['2026-10-23'].plan.sessions.some(item=>item.key==='2026-10-23#0'),'这一场被记进当天的场次列表');
});
test('同一天的两笔历史回执都要记进去，不能只留最后一笔',async t=>{
  const f=fixture(t,'2026-10-23T15:59:00Z');
  f.video.savePolicy({windows:['00:00-24:00'],dailyMinutes:60,dailyRequests:30},{explicit:true});
  const schedule=new ScheduledWatch({...f.options,getWatchState:async()=>({running:false,status:'stopped'})});
  schedule.configure({enabled:true,maxRequests:30},{explicit:true});
  // 两笔都发生在前一天：那一天的日程压根不存在，只能靠补记把它补出来。
  // 补出来的那份是空的（recovered），第二笔必须接着往上加，不能把第一笔冲掉。
  fs.writeFileSync(schedule.ledgerFile,JSON.stringify({version:1,runs:[
    {key:'2026-10-22#0',round:0,id:'synthetic-first',source:'api',pid:process.pid,
      startAt:Date.parse('2026-10-22T15:50:00Z'),expiresAt:Date.parse('2026-10-22T15:53:00Z'),
      minutes:3,startedAt:new Date(Date.parse('2026-10-22T15:50:00Z')).toISOString(),status:'started'},
    {key:'2026-10-22#1',round:1,id:'synthetic-second',source:'api',pid:process.pid,
      startAt:Date.parse('2026-10-22T15:55:00Z'),expiresAt:Date.parse('2026-10-22T15:57:00Z'),
      minutes:2,startedAt:new Date(Date.parse('2026-10-22T15:55:00Z')).toISOString(),status:'started'},
  ]},null,2));
  f.setTime('2026-10-23T16:05:00Z');
  await schedule.tick();
  await schedule.tick();
  const plan=JSON.parse(fs.readFileSync(path.join(f.stateDir,'watch-schedule-plan.json'),'utf8'));
  const day=plan.days['2026-10-22'].plan;
  assert.equal(day.spentMinutes,5,'两笔都要记：3 分钟加 2 分钟');
  assert.ok(day.sessions.some(item=>item.key==='2026-10-22#0'),'第一笔在账里');
  assert.ok(day.sessions.some(item=>item.key==='2026-10-22#1'),'第二笔也在账里');
});
test('两个回收方抢同一把残留旁路锁，只有一个能拿到回收权',async t=>{
  const f=fixture(t);
  const first=new ScheduledWatch(f.options);
  const second=new ScheduledWatch(f.options);
  // 残留的旁路锁：上一个回收方已经死了（pid 2147483647 不会活着）。
  fs.writeFileSync(first.reclaimLockFile(),JSON.stringify({pid:2147483647,owner:'synthetic-dead-reclaimer'}));
  const stale=Date.now()/1000-10;fs.utimesSync(first.reclaimLockFile(),stale,stale);
  // A（first）判断旧持有者已死、正要动手的那一刻，B（second）抢先清掉残留并拿到新锁。
  const originalWrite=fs.writeFileSync;
  let hooked=false;
  fs.writeFileSync=(file,...rest)=>{
    if(hooked&&String(file)===second.reclaimLockFile()){
      fs.writeFileSync=originalWrite;
      hooked=false;
      // B 趁 A 的间隙把残留清掉、写进自己的新锁。
      fs.unlinkSync(second.reclaimLockFile());
      return originalWrite(file,...rest);
    }
    return originalWrite(file,...rest);
  };
  try{
    const a=first.takeReclaimLock();
    hooked=true;
    const b=second.takeReclaimLock();
    assert.equal(a&&b,false,'两个回收方不能同时拿到回收权');
    assert.notEqual(a,b,'总有且只有一个成功');
  }finally{fs.writeFileSync=originalWrite;}
  // 拿到回收权的那位能正常释放；没拿到的不能删掉对方的锁。
  if(first.reclaimOwner){first.releaseReclaimLock();assert.equal(fs.existsSync(second.reclaimLockFile()),false,'持有者释放后旁路锁被清掉');}
  else{second.releaseReclaimLock();assert.equal(fs.existsSync(second.reclaimLockFile()),false,'持有者释放后旁路锁被清掉');}
});
test('补记重试沿用首次结算的分钟数，不会越重算越多',async t=>{
  const f=fixture(t,'2026-10-23T15:59:00Z');
  f.video.savePolicy({windows:['00:00-24:00'],dailyMinutes:60,dailyRequests:30},{explicit:true});
  let failed=false;
  const savePlanImpl=args=>{
    if(!failed&&args.plan?.sessions?.length){failed=true;return false;}
    return savePlan(args);
  };
  const schedule=new ScheduledWatch({...f.options,getWatchState:async()=>({running:false,status:'stopped'}),savePlanImpl});
  schedule.configure({enabled:true,maxRequests:30},{explicit:true});
  // 原回执在首次结算时已经算出 3 分钟（startAt 15:59Z、settle 时钟 16:02Z）。
  fs.writeFileSync(schedule.ledgerFile,JSON.stringify({version:1,runs:[{
    key:'2026-10-23#0',round:0,id:'synthetic-receipt',source:'api',pid:process.pid,
    startAt:Date.parse('2026-10-23T15:59:00Z'),expiresAt:Date.parse('2026-10-23T16:05:00Z'),
    minutes:6,startedAt:new Date(Date.parse('2026-10-23T15:59:00Z')).toISOString(),status:'started',
  }]},null,2));
  f.setTime('2026-10-23T16:02:00Z');
  await schedule.tick();
  assert.equal(failed,true,'首次补记写失败');
  let ledger=JSON.parse(fs.readFileSync(schedule.ledgerFile,'utf8'));
  assert.equal(ledger.runs[0].usedMinutes,3,'账本留住了首次结算的 3 分钟');
  // 时钟推进 3 分钟后重试：必须仍按首次结算的 3 分钟补记，不能用新时钟重算成 6 分钟。
  f.setTime('2026-10-23T16:05:00Z');
  await schedule.tick();
  const plan=JSON.parse(fs.readFileSync(path.join(f.stateDir,'watch-schedule-plan.json'),'utf8'));
  assert.equal(plan.days['2026-10-23'].plan.spentMinutes,3,'重试沿用首次结算值，不重算');
  ledger=JSON.parse(fs.readFileSync(schedule.ledgerFile,'utf8'));
  assert.equal(ledger.runs[0].usedMinutes,3,'账本里的分钟数也没有被改大');
});
test('补写日程和撤回结清标记都失败时，重建实例后仍能按标记补记',async t=>{
  const f=fixture(t,'2026-10-23T15:59:00Z');
  f.video.savePolicy({windows:['00:00-24:00'],dailyMinutes:60,dailyRequests:30},{explicit:true});
  let failed=false;
  const savePlanImpl=args=>{
    if(!failed&&args.plan?.sessions?.length){failed=true;return false;}
    return savePlan(args);
  };
  const schedule=new ScheduledWatch({...f.options,getWatchState:async()=>({running:false,status:'stopped'}),savePlanImpl});
  schedule.configure({enabled:true,maxRequests:30},{explicit:true});
  // 直接构造上一轮失败后留下的状态：回执已结清（settledAt 在）、分钟数已算好（6 分钟）、
  // 待补记标记也在——正是「补记写盘失败、连撤回结清标记也失败」之后账本里该有的样子。
  fs.writeFileSync(schedule.ledgerFile,JSON.stringify({version:1,runs:[{
    key:'2026-10-23#0',round:0,id:'synthetic-receipt',source:'api',pid:process.pid,
    startAt:Date.parse('2026-10-23T15:59:00Z'),expiresAt:Date.parse('2026-10-23T16:05:00Z'),
    minutes:6,startedAt:new Date(Date.parse('2026-10-23T15:59:00Z')).toISOString(),status:'started',
    settledAt:new Date(Date.parse('2026-10-23T16:05:00Z')).toISOString(),
    usedMinutes:6,creditPending:true,
  }]},null,2));
  await schedule.tick();
  assert.equal(failed,true,'补记确实尝试写盘但失败');
  // 补记写盘失败后撤回结清标记（下一轮 pending 分支会沿用账本里的 6 分钟重试）；
  // 「待补记」标记持久留在账本里——这是认出这笔欠账的依据，撤回成败都不丢账。
  let ledger=JSON.parse(fs.readFileSync(schedule.ledgerFile,'utf8'));
  assert.equal(ledger.runs[0].settledAt,undefined,'补记失败后撤回结清，下一轮重试');
  assert.equal(ledger.runs[0].creditPending,true,'待补记标记已持久写进账本');
  let plan=JSON.parse(fs.readFileSync(path.join(f.stateDir,'watch-schedule-plan.json'),'utf8'));
  assert.equal(plan.days?.['2026-10-23']?.plan?.spentMinutes||0,0,'日程里仍然没有这笔');
  // 重建实例（换进程重启的场景）：不依赖任何内存状态，只看账本。
  const revived=new ScheduledWatch({...f.options,getWatchState:async()=>({running:false,status:'stopped'})});
  await revived.tick();
  plan=JSON.parse(fs.readFileSync(path.join(f.stateDir,'watch-schedule-plan.json'),'utf8'));
  assert.equal(plan.days['2026-10-23'].plan.spentMinutes,6,'重建实例后按标记补记成功');
  ledger=JSON.parse(fs.readFileSync(schedule.ledgerFile,'utf8'));
  assert.equal(ledger.runs[0].creditPending,undefined,'补记成功后标记被清掉');
});
test('清标记写入失败后，后续 tick 不再卡在这笔回执上',async t=>{
  const f=fixture(t,'2026-10-23T15:59:00Z');
  f.video.savePolicy({windows:['00:00-24:00'],dailyMinutes:60,dailyRequests:30},{explicit:true});
  const schedule=new ScheduledWatch({...f.options,getWatchState:async()=>({running:false,status:'stopped'})});
  schedule.configure({enabled:true,maxRequests:30},{explicit:true});
  // 已经补记成功（日程里 3 分钟），但清标记的写入失败了——标记残留在账本里。
  fs.writeFileSync(schedule.ledgerFile,JSON.stringify({version:1,runs:[{
    key:'2026-10-23#0',round:0,id:'synthetic-receipt',source:'api',pid:process.pid,
    startAt:Date.parse('2026-10-23T15:59:00Z'),expiresAt:Date.parse('2026-10-23T16:05:00Z'),
    minutes:6,startedAt:new Date(Date.parse('2026-10-23T15:59:00Z')).toISOString(),status:'started',
    settledAt:new Date(Date.parse('2026-10-23T16:02:00Z')).toISOString(),
    usedMinutes:3,creditPending:true,
  }]},null,2));
  fs.mkdirSync(path.join(f.stateDir),{recursive:true});
  fs.writeFileSync(path.join(f.stateDir,'watch-schedule-plan.json'),JSON.stringify({version:2,generatedAt:Date.now(),days:{'2026-10-23':{spentMinutes:3,plan:{version:2,date:'2026-10-23',targetMinutes:60,spentMinutes:3,lazy:false,firstStartAt:null,nextStartAt:null,round:1,roundSession:null,failedRounds:0,sessions:[{key:'2026-10-23#0',startAt:Date.parse('2026-10-23T15:59:00Z'),expiresAt:Date.parse('2026-10-23T16:05:00Z'),minutes:3,failed:false}]}}}},null,2));
  // 连跑四次 tick：每轮都要能走下来，不能一直卡在这笔回执上提前返回。
  let marksCleared=false;
  const originalWrite=fs.writeFileSync;
  for(let i=0;i<4;i++){
    await schedule.tick();
    const ledger=JSON.parse(fs.readFileSync(schedule.ledgerFile,'utf8'));
    if(ledger.runs[0].creditPending!==true)marksCleared=true;
  }
  assert.equal(marksCleared,true,'标记在几次 tick 内被清掉，调度不再卡住');
  const plan=JSON.parse(fs.readFileSync(path.join(f.stateDir,'watch-schedule-plan.json'),'utf8'));
  assert.equal(plan.days['2026-10-23'].plan.spentMinutes,3,'已入账的 3 分钟没有被重复记账');
  const ledger=JSON.parse(fs.readFileSync(schedule.ledgerFile,'utf8'));
  assert.equal(ledger.runs[0].settledAt!==undefined,true,'结清标记保留，不会被重新结算');
});
test('补记重试成功后，结清标记也一并恢复',async t=>{
  const f=fixture(t,'2026-10-23T15:59:00Z');
  f.video.savePolicy({windows:['00:00-24:00'],dailyMinutes:60,dailyRequests:30},{explicit:true});
  let failedOnce=false;
  const savePlanImpl=args=>{
    if(!failedOnce&&args.plan?.sessions?.length){failedOnce=true;return false;}
    return savePlan(args);
  };
  const schedule=new ScheduledWatch({...f.options,getWatchState:async()=>({running:false,status:'stopped'}),savePlanImpl});
  schedule.configure({enabled:true,maxRequests:30},{explicit:true});
  // 回执已结清、分钟数已算好、待补记标记在——补记失败后留下的状态。
  fs.writeFileSync(schedule.ledgerFile,JSON.stringify({version:1,runs:[{
    key:'2026-10-23#0',round:0,id:'synthetic-receipt',source:'api',pid:process.pid,
    startAt:Date.parse('2026-10-23T15:59:00Z'),expiresAt:Date.parse('2026-10-23T16:05:00Z'),
    minutes:6,startedAt:new Date(Date.parse('2026-10-23T15:59:00Z')).toISOString(),status:'started',
    settledAt:new Date(Date.parse('2026-10-23T16:05:00Z')).toISOString(),
    usedMinutes:6,creditPending:true,
  }]},null,2));
  await schedule.tick();
  let ledger=JSON.parse(fs.readFileSync(schedule.ledgerFile,'utf8'));
  assert.equal(ledger.runs[0].settledAt,undefined,'首次补记失败撤回了结清标记');
  assert.equal(ledger.runs[0].creditPending,true,'待补记标记还在');
  // 重试成功：标记清掉的同时，结清标记也要恢复回去——否则下一轮 pending 分支会重新结算一次。
  await schedule.tick();
  ledger=JSON.parse(fs.readFileSync(schedule.ledgerFile,'utf8'));
  assert.equal(ledger.runs[0].creditPending,undefined,'重试成功后标记被清掉');
  assert.ok(ledger.runs[0].settledAt,'结清标记已恢复回去');
  assert.equal(ledger.runs[0].usedMinutes,6,'分钟数仍是首次结算值');
});
