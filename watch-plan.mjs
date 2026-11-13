import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveRuntimePaths } from './runtime-paths.mjs';

const DAY = 86400000;
const MINUTE = 60000;
const HOUR = 3600000;
const SHANGHAI_OFFSET = 8 * HOUR;
const PLAN_VERSION = 2;
// 「像人一样」的观看节奏常量：
const MIN_SESSION_MINUTES = 8;       // 一场至少看 8 分钟（除非今天额度只剩一点点）
const MAX_SESSION_MINUTES = 45;      // 一场最多 45 分钟
const MIN_GAP_MINUTES = 10;          // 两场之间的冷却，最少 10 分钟
const MAX_GAP_MINUTES = 60;         // 冷却最多 1 小时
const FIRST_DELAY_MINUTES = [10, 45]; // 刚启动时第一次检查的随机等待：不会一启动就开抖音
const LAZY_DAY_CHANCE = 0.2;         // 一天里彻底不想刷的概率
const MAX_FAILED_ROUNDS = 3;         // 一天里连续出错的场次上限：错太多就不再自己开

export function planDate(now = Date.now()) {
  return new Date(now + SHANGHAI_OFFSET).toISOString().slice(0, 10);
}

export function shiftDate(date, days) {
  const base = Date.parse(`${date}T00:00:00+08:00`);
  return new Date(base + days * DAY + SHANGHAI_OFFSET).toISOString().slice(0, 10);
}

function parseWindow(value) {
  const [start, end] = String(value).split('-');
  const toMinutes = text => {
    const [hour, minute] = text.split(':').map(Number);
    return hour * 60 + minute;
  };
  return { start: toMinutes(start), end: toMinutes(end) };
}

function windowsFor(date, policy = {}) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const weekend = weekday === 0 || weekday === 6;
  const list = weekend && Array.isArray(policy.weekendWindows) && policy.weekendWindows.length
    ? policy.weekendWindows
    : policy.windows;
  return Array.isArray(list) ? list : [];
}

// 某一天真正可用的时间区间（毫秒）。跨零点的时段把前半段归到当天、后半段归到次日。
export function dayIntervals(date, policy = {}) {
  const base = Date.parse(`${date}T00:00:00+08:00`);
  const intervals = [];
  const previous = shiftDate(date, -1);
  for (const raw of windowsFor(previous, policy)) {
    const { start, end } = parseWindow(raw);
    if (end <= start) intervals.push({ startAt: base, expiresAt: base + end * MINUTE });
  }
  for (const raw of windowsFor(date, policy)) {
    const { start, end } = parseWindow(raw);
    if (end > start) intervals.push({ startAt: base + start * MINUTE, expiresAt: base + end * MINUTE });
    else intervals.push({ startAt: base + start * MINUTE, expiresAt: base + DAY });
  }
  return intervals.sort((left, right) => left.startAt - right.startAt);
}

function randomInt(random, min, max) {
  const span = Math.max(1, max - min + 1);
  const value = Math.floor(random() * span);
  return min + Math.min(span - 1, Math.max(0, value));
}

// 当天日程：只记「今天想刷多少分钟」，每一场具体看多久到点再摇。
// 插件设置的每日时长是上限，不是必须填满的配额；一天也可能一场都不刷。
export function buildPlan({ date, intervals = [], budgetMinutes = 0, random = Math.random, now = Date.now(), firstDelayMinutes = null, allowLazy = true } = {}) {
  const budget = Number.isFinite(budgetMinutes) && budgetMinutes > 0 ? Math.floor(budgetMinutes) : 0;
  const plan = {
    version: PLAN_VERSION,
    date,
    generatedAt: new Date().toISOString(),
    targetMinutes: 0,
    spentMinutes: 0,
    lazy: false,
    firstStartAt: null,
    nextStartAt: null,
    round: 0,
    roundSession: null,
    failedRounds: 0,
    sessions: [],
  };
  if (!budget || !intervals.length) return plan;
  // 懒得刷的一天：今天一场都不看。
  if (allowLazy && random() < LAZY_DAY_CHANCE) { plan.lazy = true; return plan; }
  // 今日想看的总时长：在上限的两成到上限之间随机，且不超过上限。
  const target = Math.round(budget * (0.2 + 0.8 * random()));
  plan.targetMinutes = Math.min(budget, Math.max(1, target));
  // 今天第一次看的时刻：不是一开开关就刷，等一个随机的点；不跨到第二天。
  const delay = Number.isFinite(firstDelayMinutes)
    ? Math.max(0, Math.floor(firstDelayMinutes)) * MINUTE
    : randomInt(random, FIRST_DELAY_MINUTES[0], FIRST_DELAY_MINUTES[1]) * MINUTE;
  const dayEnd = Date.parse(`${date}T00:00:00+08:00`) + DAY;
  plan.firstStartAt = Math.min(now + delay, dayEnd);
  return plan;
}

export function planFile(stateDir = resolveRuntimePaths().stateDir) {
  return path.join(stateDir, 'watch-schedule-plan.json');
}

function loadFile(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || parsed.version !== PLAN_VERSION || !parsed.days || typeof parsed.days !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeFile(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function entryFor(stored, date) {
  const entry = stored?.days?.[date];
  if (!entry || typeof entry !== 'object') return null;
  const plan = entry.plan;
  if (!plan || plan.version !== PLAN_VERSION || typeof plan !== 'object') return null;
  return {
    plan: {
      ...plan,
      targetMinutes: Number.isFinite(plan.targetMinutes) ? plan.targetMinutes : 0,
      spentMinutes: Number.isFinite(plan.spentMinutes) ? plan.spentMinutes : 0,
      lazy: plan.lazy === true,
      firstStartAt: Number.isFinite(plan.firstStartAt) ? plan.firstStartAt : null,
      nextStartAt: Number.isFinite(plan.nextStartAt) ? plan.nextStartAt : null,
      round: Number.isFinite(plan.round) ? plan.round : 0,
      roundSession: plan.roundSession && typeof plan.roundSession === 'object' ? plan.roundSession : null,
      failedRounds: Number.isFinite(plan.failedRounds) ? plan.failedRounds : 0,
      sessions: Array.isArray(plan.sessions) ? plan.sessions : [],
      // 补记出来的空日程要标出来：本人重新打开允许观看时，那一天的额度要重新算。
      recovered: plan.recovered === true,
    },
    spentMinutes: Number.isFinite(entry.spentMinutes) ? entry.spentMinutes : 0,
  };
}

// 取当天日程。今天已经有日程就直接沿用（重启不会重新摇一次）；没有才按今天的额度生成一份。
export function ensurePlan({ stateDir = resolveRuntimePaths().stateDir, date = planDate(), policy = {}, now = Date.now(), random = Math.random, budgetMinutes = null, firstDelayMinutes = null, allowLazy = true } = {}) {
  const file = planFile(stateDir);
  const stored = loadFile(file);
  const entry = entryFor(stored, date);
  // 补记出来的空日程（recovered）不算真的日程：本人重新打开允许观看时，
  // 那一天的额度要重新算，不能被这份空日程卡住。已经记过的时长与场次要留着。
  if (entry && entry.plan.recovered !== true) return entry.plan;

  // 额度按「今天还剩多少」算：手动看过的部分不能再算进自主观看。
  const cap = Number.isFinite(budgetMinutes)
    ? Math.max(0, Math.floor(budgetMinutes))
    : (Number.isFinite(policy.dailyMinutes) && policy.dailyMinutes > 0 ? Math.floor(policy.dailyMinutes) : 0);
  const plan = buildPlan({ date, intervals: dayIntervals(date, policy), budgetMinutes: cap, random, now, firstDelayMinutes, allowLazy });
  if (entry) {
    plan.spentMinutes = Number.isFinite(entry.plan.spentMinutes) ? entry.plan.spentMinutes : 0;
    plan.sessions = Array.isArray(entry.plan.sessions) ? entry.plan.sessions : [];
    plan.failedRounds = Number.isFinite(entry.plan.failedRounds) ? entry.plan.failedRounds : 0;
    // 轮次要接着走：补记过的那一场已经占掉一个编号，重来一遍会撞号。
    plan.round = Number.isFinite(entry.plan.round) ? entry.plan.round : 0;
  }
  const days = { ...(stored?.days ?? {}) };
  days[date] = { plan, spentMinutes: plan.spentMinutes };
  persistDays(file, days, now);
  return plan;
}

// 补记用的空日程：某一场的开场没能落盘时，账本里仍然有它的回执，
// 需要按它所属的那天补一份日程，把这一场记进去。
// 这份日程不带额度（recovered）：等本人重新打开允许观看时，那一天的额度要重新算。
export function recoveredPlan(date) {
  return {
    version: PLAN_VERSION,
    date,
    generatedAt: new Date().toISOString(),
    targetMinutes: 0,
    spentMinutes: 0,
    lazy: false,
    firstStartAt: null,
    nextStartAt: null,
    round: 0,
    roundSession: null,
    failedRounds: 0,
    sessions: [],
    recovered: true,
  };
}

// 所有日程里已经记过账的场次：sessions 里的 key。
// 账本里已结清、但日程里从没记过的那一场（开场写盘失败、日程文件被换掉），
// 靠它判断是否已经补记过——补过的不能再补一次。
export function creditedSessionKeys({ stateDir = resolveRuntimePaths().stateDir } = {}) {
  const stored = loadFile(planFile(stateDir));
  const keys = new Set();
  if (!stored?.days || typeof stored.days !== 'object') return keys;
  for (const date of Object.keys(stored.days)) {
    const plan = entryFor(stored, date)?.plan;
    for (const session of plan?.sessions || []) if (session?.key) keys.add(session.key);
  }
  return keys;
}

// 场次属于哪一天：场次编号就是「日期#轮次」。
// 开场写盘失败时，日程里根本没有这一场，只能从编号里把它属于的那天找回来。
export function sessionDate(session) {
  const key = typeof session?.key === 'string' ? session.key : '';
  const hash = key.indexOf('#');
  if (hash <= 0) return null;
  const date = key.slice(0, hash);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

// 把一场记进日程：加时长、加场次、把轮次推到这一场之后。
// 只加账，不动日程里当前挂着的场次——补记的是另一场（开场没落盘的那场），
// 把正在跑的那一场清掉会误伤。
export function creditSession({ plan, session, usedMinutes = null, failed = false, now = Date.now() } = {}) {
  if (!plan || !session) return plan;
  const used = failed
    ? 0
    : (Number.isFinite(usedMinutes) ? Math.max(0, Math.floor(usedMinutes)) : (Number.isFinite(session.minutes) ? session.minutes : 0));
  const round = Number.isFinite(session.round) ? session.round : 0;
  return {
    ...plan,
    spentMinutes: (Number.isFinite(plan.spentMinutes) ? plan.spentMinutes : 0) + used,
    failedRounds: (Number.isFinite(plan.failedRounds) ? plan.failedRounds : 0) + (failed ? 1 : 0),
    // 轮次不能倒退：这一场已经占掉一个编号，后面的场次要接着往后排。
    round: Math.max(Number.isFinite(plan.round) ? plan.round : 0, round + (failed ? 0 : 1)),
    sessions: [...(plan.sessions || []), { key: session.key, startAt: session.startAt, expiresAt: session.expiresAt, minutes: used, failed: failed === true }],
  };
}

// 保存当天的最新日程（每场结束后记账）。
// 返回 true 表示这次真的落盘了。写不下去时必须让调用方知道：
// 结账写回失败若被悄悄吞掉，下一轮就会按 0 分钟把已经记过的时长覆盖掉。
export function savePlan({ stateDir = resolveRuntimePaths().stateDir, date = planDate(), plan, now = Date.now() } = {}) {
  if (!plan) return false;
  const file = planFile(stateDir);
  const stored = loadFile(file);
  const days = { ...(stored?.days ?? {}) };
  days[date] = { plan, spentMinutes: Number.isFinite(plan.spentMinutes) ? plan.spentMinutes : 0 };
  return persistDays(file, days, now);
}

function persistDays(file, days, now) {
  const trimmed = {};
  // 挂着的场次（还没结清的那一场）所在的日期必须留着：只按日期排序截断会把
  // 昨天没结清的场次连同它的日程一起丢掉，之后就再也结不掉那笔账了。
  const keep = new Set(Object.keys(days).sort().slice(-3));
  for (const [date, entry] of Object.entries(days)) {
    if (keep.has(date) || entry?.plan?.roundSession) trimmed[date] = entry;
  }
  try {
    writeFile(file, { version: PLAN_VERSION, updatedAt: new Date(now).toISOString(), days: trimmed });
    return true;
  } catch {
    // 日程写不下去时仍然按内存里的计划执行，不因为记录失败而阻断观看；
    // 但要如实告诉调用方「这次没写进去」，好让结账留在待结状态等下一轮补记。
    return false;
  }
}

// 今天还能再看多少分钟。
export function remainingPlanMinutes(plan) {
  if (!plan || !Number.isFinite(plan.targetMinutes)) return 0;
  const spent = Number.isFinite(plan.spentMinutes) ? plan.spentMinutes : 0;
  return Math.max(0, plan.targetMinutes - spent);
}

// 这一场什么时候开始、持续多久。到点才摇时长：人不会提前知道自己会看多久。
// 同一场在结束前一直返回同一个场次（编号固定），重试与回执才不会散成不同场。
export function planSession({ plan, now = Date.now(), random = Math.random, windowEnd = null, maxMinutes = null } = {}) {
  if (!plan) return null;
  // 今天决定不刷：一场都不开。
  if (plan.lazy === true) return null;
  // 一天里错太多次就不再自己开，等本人处理。
  if ((Number.isFinite(plan.failedRounds) ? plan.failedRounds : 0) >= MAX_FAILED_ROUNDS) return null;
  if (plan.roundSession && Number.isFinite(plan.roundSession.expiresAt) && plan.roundSession.expiresAt > now) return plan.roundSession;
  const remaining = remainingPlanMinutes(plan);
  if (remaining <= 0) return null;
  // 今天第一次看之前有一个随机等待：刚打开开关不会立刻开抖音。
  if (Number.isFinite(plan.firstStartAt) && now < plan.firstStartAt) return null;
  if (Number.isFinite(plan.nextStartAt) && now < plan.nextStartAt) return null;
  const ceiling = Math.min(MAX_SESSION_MINUTES, remaining, Number.isFinite(maxMinutes) ? Math.max(0, Math.floor(maxMinutes)) : Infinity);
  if (ceiling <= 0) return null;
  const minutes = ceiling < MIN_SESSION_MINUTES
    ? ceiling
    : randomInt(random, MIN_SESSION_MINUTES, ceiling);
  const startAt = now;
  const hardEnd = Number.isFinite(windowEnd) ? windowEnd : startAt + MAX_SESSION_MINUTES * MINUTE;
  const expiresAt = Math.min(startAt + minutes * MINUTE, hardEnd);
  if (expiresAt <= startAt) return null;
  const round = Number.isFinite(plan.round) ? plan.round : 0;
  return { key: `${plan.date || planDate(now)}#${round}`, round, startAt, expiresAt, minutes: Math.round((expiresAt - startAt) / MINUTE) };
}

// 一场结束：记账、顺延到冷却之后，等下一场。
// failed=true 表示这一场没有真正看下去：不占今天的时长，但要记一次出错；
// 而且轮次不推进——这样同一场的编号不变，回执与重试才落在同一场里。
export function closeSession({ plan, session, cooldown = 0, failed = false, usedMinutes = null, now = null } = {}) {
  if (!plan || !session) return plan;
  const used = failed
    ? 0
    : (Number.isFinite(usedMinutes) ? Math.max(0, Math.floor(usedMinutes)) : (Number.isFinite(session.minutes) ? session.minutes : 0));
  const base = Math.max(Number.isFinite(now) ? now : session.expiresAt, session.expiresAt);
  return {
    ...plan,
    spentMinutes: (Number.isFinite(plan.spentMinutes) ? plan.spentMinutes : 0) + used,
    failedRounds: (Number.isFinite(plan.failedRounds) ? plan.failedRounds : 0) + (failed ? 1 : 0),
    round: (Number.isFinite(plan.round) ? plan.round : 0) + (failed ? 0 : 1),
    roundSession: null,
    // 第一次看已经过去，之后不再受首次等待限制。
    firstStartAt: null,
    // 失败的那场不排冷却：改由回执里的十五分钟退避决定何时再试。
    nextStartAt: failed ? null : base + Math.max(0, cooldown) * MINUTE,
    sessions: [...(plan.sessions || []), { key: session.key, startAt: session.startAt, expiresAt: session.expiresAt, minutes: used, failed: failed === true }],
  };
}

// 读取当天的日程（不新建）。本人重开允许观看时用它把冷却和失败计数清掉。
export function loadPlan({ stateDir = resolveRuntimePaths().stateDir, date = planDate() } = {}) {
  const stored = loadFile(planFile(stateDir));
  return entryFor(stored, date)?.plan ?? null;
}

// 所有还挂着「当前场次」的日程（含前几天）。
// 跨过零点后，当天的日程里没有昨天那一场，只看当天就永远结不掉昨天的账——
// 所以结账时要把前几天挂着的场次一起找出来，按它们各自的那天写回去。
export function roundCandidates({ stateDir = resolveRuntimePaths().stateDir } = {}) {
  const stored = loadFile(planFile(stateDir));
  if (!stored?.days || typeof stored.days !== 'object') return [];
  const candidates = [];
  for (const date of Object.keys(stored.days).sort()) {
    const entry = entryFor(stored, date);
    const session = entry?.plan?.roundSession;
    if (!entry || !session || typeof session !== 'object') continue;
    if (!Number.isFinite(session.startAt) || !Number.isFinite(session.expiresAt)) continue;
    candidates.push({ date, plan: entry.plan, session });
  }
  return candidates;
}

// 两场之间的冷却：接着刷是「意犹未尽」，但人也要歇一会儿。
export function cooldownMinutes(random = Math.random) {
  return randomInt(random, MIN_GAP_MINUTES, MAX_GAP_MINUTES);
}

// 本人重新开启允许观看后，不必再等冷却：今天还剩多少额度就从现在开始。
// 出错的计数一并清掉——本人已经接手处理过，就不该再按「今天错太多」停摆。
// firstStartAt 保留：今天第一次看的随机时刻不因为重开而取消（还没看过就仍然先等那个点）。
export function resumePlan({ stateDir = resolveRuntimePaths().stateDir, date = planDate(), plan, now = Date.now() } = {}) {
  if (!plan) return plan;
  const updated = {
    ...plan,
    failedRounds: 0,
    nextStartAt: null,
  };
  savePlan({ stateDir, date, plan: updated, now });
  return updated;
}
