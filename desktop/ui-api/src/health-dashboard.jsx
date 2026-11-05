import React, { useEffect, useRef, useState } from 'react';
import { Button, Input, Tag } from '@dsh/primitives';
import { useAutoSave, AutoSaveStatus } from './use-auto-save.jsx';
import { watchIsActive } from './api.mjs';

const number = value => Number(value || 0).toLocaleString('zh-CN');
const kinds = { watch: '自主观看', task: '手动任务', comment: '评论生成', spark: '自动问候', chat: '私信回复' };
const watchStates = { running: '运行中', stopping: '正在停止', stopped: '未运行', limited: '已到限制', failed: '运行中断', needs_user: '等待手动操作' };

export function StatusSummary({ connected, configured, watchReady, browser, video, videoTimeEnabled, watch, share, chat, interactions, actions }) {
  // 三分口径优先（chat.state.unansweredGroups，与 client.js 同构）；旧字段未带 groups 时按条目回退计算。
  const groups = chat?.unansweredGroups, manual = groups ? (groups.needsManual ?? 0) + (groups.uncertain ?? 0) : null, autoRecovering = groups ? groups.autoRecovering ?? 0 : null;
  const openBacklog = groups ? (manual ?? 0) + (autoRecovering ?? 0) : (chat?.contacts || []).reduce((sum, item) => sum + (item.unanswered || []).filter(entry => !entry.handledByUserAt && entry.autoHandled !== true && !entry.autoHandledAt).length, 0);
  const shareReview = share?.needsReview?.length || 0;
  const blockers = [
    !connected && { label: '本机服务未连接', detail: '正在自动重试；数据可能不是最新。' },
    connected && !configured && { label: '模型未配置', detail: '还没有配置模型与 API Key，任何自动能力都不会运行。', action: '去配置模型', onClick: actions.openSettings },
    browser?.loginRequired === true && { label: '抖音需要登录', detail: '专用浏览器停在登录页；登录前不能观看、回复或分享。', action: '打开抖音', onClick: actions.openDouyin },
    !browser?.loginRequired && browser?.verificationRequired === true && { label: '抖音需要安全验证', detail: '验证码需要本人在专用浏览器完成。', action: '打开抖音', onClick: actions.openDouyin },
    connected && configured && watchReady === false && { label: '观看状态尚未核实', detail: '等待本机服务回读；核实前不能开始观看或任务。' },
    videoTimeEnabled && video?.allowed === false && { label: '不在允许观看时段', detail: video.reason || '当前时间不在每日允许时段内。' },
    Boolean(watch?.lastError) && { label: '上次自主观看中断', detail: watch.lastError },
    shareReview > 0 && { label: `${shareReview} 条分享收据待核对`, detail: '分享是否送达尚未确认；不会自动重发。', action: '查看分享收据', onClick: actions.openReceipts },
    manual > 0 && { label: `${manual} 条待答已转人工`, detail: `另有 ${autoRecovering} 条在自动恢复；转人工的条目需要你判断是否还要回复，不会自动补发。`, action: '查看待答', onClick: actions.openFriends },
    manual === 0 && autoRecovering > 0 && { label: `${autoRecovering} 条待答自动恢复中`, detail: '这些消息在自动恢复流程中，无需人工操作；不会自动补发。', action: '查看待答', onClick: actions.openFriends },
    Boolean(interactions?.friend?.lastError) && { label: '回复服务异常', detail: interactions.friend.lastError, action: '查看待答', onClick: actions.openFriends },
  ].filter(Boolean);
  const current = blockers[0], presence = interactions?.presence, watching = watchIsActive(watch);
  const detail = current ? current.detail : [presence?.label, watching ? '自主观看运行中' : ''].filter(Boolean).join(' · ') || '各能力按当前设置运行。';
  return <section className="status-summary" aria-label="当前状态摘要">
    <div className="status-row"><span aria-hidden="true">{current ? '●' : '○'}</span><strong>{current ? current.label : '一切正常'}</strong><span className="status-detail-text">{detail}</span>{current?.action && <Button size="sm" variant="outline" onClick={current.onClick}>{current.action}</Button>}</div>
    <details className="status-detail"><summary>技术详情</summary>
      <p>连接：{connected ? '已连接' : '未连接'} · 模型：{configured ? '已配置' : '未配置'} · 观看核实：{watchReady === false ? '未完成' : '已完成'}</p>
      <p>浏览器：{browser ? [browser.loginRequired ? '需要登录' : '', browser.verificationRequired ? '需要验证' : ''].filter(Boolean).join('、') || '已打开抖音' : '未打开'}</p>
      <p>自主观看：{watch ? watchStates[watch.status] || watch.status || '未知' : '状态未读取'}{watch?.lastError ? ` · ${watch.lastError}` : ''}</p>
      <p>好友回复：{presence ? `${presence.label || '状态待核实'}${presence.reason ? ` · ${presence.reason}` : ''}` : '状态未读取'}</p>
      <p>分享：{share ? [shareReview > 0 ? `${shareReview} 条收据待核对` : '', share.paused ? '已暂停' : '', share.recoveryRequired ? '需要恢复核对' : ''].filter(Boolean).join('、') || '无待核对收据' : '状态未读取'}</p>
      <p>遗留待答：{openBacklog} 条{groups ? `（自动恢复中 ${autoRecovering} · 需人工核对 ${manual}）` : ''}</p>
    </details>
  </section>;
}

export function HealthDashboard({ api, run, busy, connected }) {
  const [usage, setUsage] = useState(null), [diagnostics, setDiagnostics] = useState(null), [error, setError] = useState(''), [repairResult, setRepairResult] = useState(''), [updatedAt, setUpdatedAt] = useState(''), [refreshing, setRefreshing] = useState(false);
  const latestApi = useRef(api), lifecycle = useRef({ mounted: false, connected: false, epoch: 0, pending: null, queued: false }); latestApi.current = api;
  async function refresh(manual = true) {
    const life = lifecycle.current;
    if (!life.mounted || !life.connected) return;
    if (life.pending) { if (manual) { life.pending.discard = true; life.queued = true; } return life.pending.promise; }
    const ticket = { epoch: life.epoch, discard: false }; life.pending = ticket; setRefreshing(true);
    ticket.promise = (async () => {
      try {
        const value = await latestApi.current('/api/usage');
        if (life.mounted && life.connected && life.epoch === ticket.epoch && !ticket.discard) { setUsage(value); setUpdatedAt(value.checkedAt || new Date().toISOString()); setError(''); }
      } catch (failure) { if (life.mounted && life.connected && life.epoch === ticket.epoch && !ticket.discard) setError(failure.message); }
      finally {
        if (life.pending === ticket) life.pending = null;
        if (life.mounted) setRefreshing(false);
        if (life.mounted && life.connected && life.queued) { life.queued = false; void refresh(false); }
      }
    })();
    return ticket.promise;
  }
  useEffect(() => {
    const life = lifecycle.current; life.mounted = true; life.connected = connected; life.epoch += 1;
    if (connected) void refresh(true);
    const timer = connected ? setInterval(() => { void refresh(false); }, 1500) : null;
    return () => { clearInterval(timer); life.mounted = false; life.connected = false; life.epoch += 1; life.queued = false; };
  }, [connected]);
  return <div className="memory-view"><div className="section-heading"><h1>自检与用量</h1><p>插件与软件共用本机用量记录，数据来自模型实际返回值。</p></div>
    <div className="actions"><Button disabled={!connected || busy.has('diagnostics')} onClick={() => { void run('diagnostics', async () => { setRepairResult(''); setDiagnostics(await api('/api/diagnostics', {})); await refresh(); }); }}>{busy.has('diagnostics') ? '正在检查或修复…' : '一键自检'}</Button><Button disabled={!connected} onClick={() => { void refresh(); }}>刷新用量</Button></div>
    <p className="muted" role="status">{updatedAt ? `上次更新：${new Date(updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : '正在读取用量…'}{refreshing ? ' · 正在刷新' : ''} · 连接时每1.5秒刷新</p>
    <p className="notice" role="status">{Number(usage?.inProgress?.total || 0) > 0 ? `${number(usage.inProgress.total)}个请求中，Token待平台返回。` : '每次模型响应完成后更新Token，不必等整轮观看结束。'} 未返回用量的请求不能当作零消耗。</p>
    {error && <p role="alert">{error}</p>}{diagnostics && <section className="persona-records"><h2>自检结果</h2>{diagnostics.checks.map(item => <div key={item.id}><p><Tag>{{ pass: '通过', warning: '待核对', fail: '未通过' }[item.status]}</Tag> <strong>{item.label}</strong> · {item.message} <small>{item.code}</small></p>{item.resolution?.steps?.map((step, index) => <p className="muted" key={index}>{step}</p>)}</div>)}
      {(diagnostics.repairableActions || []).map(action => <Button key={action.id} disabled={!connected || busy.has('diagnostics')} onClick={() => { void run('diagnostics', async () => { const result = await api('/api/diagnostics/repair', { reportId: diagnostics.reportId, action: action.id }); setDiagnostics(result.after); setRepairResult(result.message); }); }}>修复：{action.label}</Button>)}
      {repairResult && <p role="status">{repairResult}</p>}<p className="muted">{diagnostics.note}</p><details><summary>查看或复制诊断报告</summary><textarea aria-label="诊断报告" readOnly rows={12} value={JSON.stringify(diagnostics, null, 2)} /></details></section>}
    {usage && <><section className="persona-records"><h2>今日用量 · {usage.date}</h2><div className="usage-grid">{[['模型响应', 'requests'],['已报告 Token', 'totalTokens'],['输入 Token', 'promptTokens'],['输出 Token', 'completionTokens'],['缓存命中 Token', 'cachedTokens'],['用量未知的响应', 'unknownRequests']].map(([label, key]) => <div className="interest-card" key={key}><small>{label}</small><h2>{key === 'cachedTokens' && !usage.today.cacheReportedRequests ? '未报告' : number(usage.today[key])}</h2></div>)}</div></section>
      <section className="persona-records"><h2>{usage.period} · {number(usage.total.totalTokens)} Token</h2><div className="usage-scroll"><table><thead><tr><th>入口 / 用途</th><th>模型</th><th>响应数</th><th>已报告 Token</th><th>未知用量</th></tr></thead><tbody>{usage.groups.map((item, index) => <tr key={index}><td>{item.source === 'dsh' ? '插件' : '软件'} / {kinds[item.kind]}</td><td>{item.model}</td><td>{number(item.requests)}</td><td>{number(item.totalTokens)}</td><td>{number(item.unknownRequests)}</td></tr>)}</tbody></table></div>{!usage.groups.length && <p className="muted">暂时没有本版记录。</p>}<p className="muted">{usage.note}</p>{usage.damagedRecords > 0 && <p role="alert">有异常记录，请运行自检。原记录已保留。</p>}</section>
      <section className="persona-records"><h2>按日记录</h2>{usage.days.slice().reverse().map(item => <p key={item.date}>{item.date} · {number(item.requests)} 次响应 · {number(item.totalTokens)} Token · {item.unknownRequests} 次用量未知</p>)}</section></>}
  </div>;
}

export function TopicPanel({ state, active, api, run, busy, connected }) {
  const list = text => text.split(/[\n,，;；]+/).map(item => item.trim()).filter(Boolean);
  const save = useAutoSave({ value: state, initial: { mode: 'recommend', topics: '', exclude: '' }, read: value => ({ mode: value.mode, topics: value.topics.join('\n'), exclude: value.exclude.join('\n') }), encode: draft => {
    const payload = { mode: draft.mode, topics: [...new Set(list(draft.topics))], exclude: [...new Set(list(draft.exclude))] };
    if (payload.mode === 'topic' && !payload.topics.length) throw new Error('填写至少一个主题后自动生效。');
    if ([payload.topics, payload.exclude].some(values => values.length > 20 || values.some(value => value.length > 100 || /[\0\r\n]/.test(value)))) throw new Error('主题和排除词各最多20项，每项最多100字。');
    return payload;
  }, write: payload => api('/api/watch/options', payload), available: connected && !active });
  return <section className="watch-controls"><h3>主题观看</h3><label className="field"><span>观看方式</span><select aria-label="观看方式" value={save.draft.mode} disabled={!connected || active} onChange={event => save.edit({ mode: event.target.value })}><option value="recommend">自主挑选推荐</option><option value="topic">围绕指定主题观看</option></select></label>
    <label className="field"><span>想看的主题，每行一个</span><textarea aria-label="想看的主题" rows={3} value={save.draft.topics} maxLength={2200} disabled={!connected || active} onChange={event => save.edit({ topics: event.target.value })} placeholder="例如：猫咪、天文、做饭" /></label>
    <label className="field"><span>排除关键词，每行一个</span><textarea aria-label="排除关键词" rows={2} value={save.draft.exclude} maxLength={2200} disabled={!connected || active} onChange={event => save.edit({ exclude: event.target.value })} /></label>
    <AutoSaveStatus status={save.status} /><p className="notice">修改后自动保存，插件与软件共用，下次自主观看生效。主题模式先搜索真实作品，再按人格挑片。排除词按作品标题匹配，不能保证识别画面内全部内容。</p>
  </section>;
}
