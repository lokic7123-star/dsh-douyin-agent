window.__ModuleLoader__.load({
  id: 'dsh-douyin-browser-local',
  factory: require => {
    const React = require('react');
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    const { createElement: h, useEffect, useRef, useState } = React;
    const Button = primitives.Button, Input = primitives.Input || 'input', MarkdownText = primitives.MarkdownText;
    const markdownLabels = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '脚注' };
    const PREFIX = '/api/douyin-browser';
    const routes = new Set(['/interactions/configure', '/state', '/diagnostics', '/diagnostics/repair', '/watch/schedule', '/watch/options', '/video/configure', '/video/start', '/video/stop', '/browser/open', '/browser/navigate', '/persona/configure', '/persona/context-observations', '/memory/search', '/memory/forget', '/model/configure', '/mode/configure', '/watch/start', '/watch/stop', '/spark/configure', '/spark/start', '/spark/stop', '/spark/resolve', '/comments/configure', '/comments/resolve', '/share/configure', '/share/resolve', '/chat/contacts', '/chat/configure', '/chat/start', '/chat/stop', '/chat/prepare', '/chat/resolve', '/chat/unanswered', '/chat/unanswered/resolve', '/chat/unanswered/end', '/chat/unanswered/retry', '/media/configure', '/media/credentials', '/reports/generate', '/watched', '/thumb']);
    const column = { display: 'flex', flexDirection: 'column', gap: 12 };
    const row = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' };
    // 导航行与通用 row 解耦：单行自然溢出滚动（内容自然宽约 559px，见 docs/mockups/nav-measurement.md），不折行不硬编码断点。
    const tabRow = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', overflowX: 'auto', scrollbarWidth: 'thin', paddingBottom: 2 };
    const tab = { flex: 'none', whiteSpace: 'nowrap' };
    const muted = { color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, margin: 0 };
    const formControl = { font: 'inherit', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-base)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: 9, maxWidth: '100%', width: '100%', boxSizing: 'border-box' };
    const videoPolicyKey = policy => policy && JSON.stringify([Array.isArray(policy.windows) ? [...new Set(policy.windows)] : null, policy.weekendWindows || null, policy.sessionMinutes]);
    const fallbackCategories = { '基础设置': ['人格与兴趣', 'DSH 模型'], '视频观看': ['观看主题', '视频时间与自主观看'], '自检与用量': ['自检与用量'], '好友互动': ['好友互动'], '观看足迹': ['观看足迹'], '记忆管理': ['记忆管理'], '公开评论': ['自主公开视频评论'], '音频与密钥': ['可选音频'], '观看日报': ['观看日报'] };
    // 面板样式：class 体系 + 单 <style> 注入（与 dsh-plugin-wallpaper-engine / dsh-qq-tts 同模式）。
    // CSS 与 docs/mockups/panel-redesign-v2.html 预览稿逐字一致（v2.4 已获用户批准）；实装用 dsw-alias 令牌，深色主题自动适配。
    const PANEL_CSS = `
.dy-wrap{display:flex;flex-direction:column;gap:12px;min-width:0}
.dy-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dy-head h2{margin:0;font-size:17px;font-weight:600}
.dy-head .sp{flex:1}
.dy-statusline{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:6px 2px;min-width:0}
.dy-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#16a34a);flex:none}
.dy-dot.warn{background:var(--dsw-alias-state-warn-primary,#d97706)}
.dy-dot.err{background:var(--dsw-alias-state-error-primary,#dc2626)}
.dy-dot.idle{background:var(--dsw-alias-label-tertiary,#6b7280)}
.dy-num{font-size:13px;font-weight:600;white-space:nowrap}
.dy-cap{color:var(--dsw-alias-label-tertiary,#6b7280);font-size:12px;white-space:nowrap}
.dy-sep{width:1px;height:14px;background:var(--dsw-alias-border-l2);flex:none}
.dy-nav{display:flex;gap:6px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}
.dy-nav::-webkit-scrollbar{display:none}
.dy-nav button{flex:none;font:inherit;font-size:12px;padding:4px 12px;border-radius:999px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary,#4b5563)}
.dy-nav button:hover{background:var(--dsw-alias-bg-layer-1,#f7f8fa)}
.dy-nav button[aria-selected="true"]{background:var(--dsw-alias-brand-primary,var(--dy-accent,#2563eb));border-color:var(--dsw-alias-brand-primary,var(--dy-accent,#2563eb));color:#fff;font-weight:500}
.dy-card{background:var(--dsw-alias-bg-layer-1,#f7f8fa);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;min-width:0}
.dy-card-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.dy-card-top h3{margin:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dy-card-top .sp{flex:1}
.dy-inner{background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-l1));border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;min-width:0}
.dy-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.dy-row .sp{flex:1}
.dy-label{font-size:12.5px;color:var(--dsw-alias-label-secondary,#4b5563)}
.dy-note{color:var(--dsw-alias-label-tertiary,#6b7280);font-size:12px;margin:0;overflow-wrap:anywhere}
.dy-strong{color:var(--dsw-alias-label-primary);font-weight:600}
.dy-input{font:inherit;font-size:12.5px;width:100%;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);
  border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 9px;height:30px}
.dy-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary,var(--dy-accent,#2563eb))}
.dy-sel{position:relative;display:inline-flex;flex:none;min-width:0}
.dy-sel::after{content:'';position:absolute;right:10px;top:50%;transform:translateY(-50%);
  border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid var(--dsw-alias-label-tertiary,#6b7280);pointer-events:none}
.dy-sel select{-webkit-appearance:none;appearance:none;padding-right:26px;cursor:pointer;text-overflow:ellipsis}
select.dy-input option{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.dy-textarea{font:inherit;font-size:12.5px;width:100%;max-width:100%;box-sizing:border-box;min-height:0;resize:vertical;color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 9px;line-height:1.5;display:block}
textarea.dy-big{min-height:110px}
.dy-btn{font:inherit;font-size:12.5px;padding:5px 13px;border-radius:999px;cursor:pointer;white-space:nowrap;
  border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary)}
.dy-btn:hover{background:var(--dsw-alias-bg-layer-1,#f7f8fa)}
.dy-btn.primary{background:var(--dsw-alias-brand-primary,var(--dy-accent,#2563eb));border-color:var(--dsw-alias-brand-primary,var(--dy-accent,#2563eb));color:#fff}
.dy-btn.primary:hover{opacity:.88;background:var(--dsw-alias-brand-primary,var(--dy-accent,#2563eb))}
.dy-btn:disabled{opacity:.45;cursor:default}
.dy-chip{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:2px 10px;font-size:11.5px;font-weight:500;white-space:nowrap}
.dy-chip .d{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.dy-chip.ok{color:var(--dsw-alias-state-success-primary,#16a34a);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#16a34a) 10%,transparent)}
.dy-chip.warn{color:var(--dsw-alias-state-warn-primary,#d97706);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d97706) 12%,transparent)}
.dy-chip.err{color:var(--dsw-alias-state-error-primary,#dc2626);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#dc2626) 10%,transparent)}
.dy-chip.info{color:var(--dsw-alias-brand-primary,var(--dy-accent,#2563eb));background:color-mix(in srgb,var(--dsw-alias-brand-primary,var(--dy-accent,#2563eb)) 10%,transparent)}
.dy-chip.violet{color:#7c3aed;background:color-mix(in srgb,#7c3aed 10%,transparent)}
.dy-kv{display:flex;gap:8px;font-size:12.5px;flex-wrap:wrap;min-width:0}
.dy-kv .k{color:var(--dsw-alias-label-tertiary,#6b7280);flex:none}
.dy-rowline{display:flex;gap:10px;align-items:baseline;font-size:12.5px;min-width:0;overflow-wrap:anywhere}
.dy-rowline .t{flex:none;color:var(--dsw-alias-label-tertiary,#6b7280);font-size:11.5px;font-variant-numeric:tabular-nums}
.dy-perm{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-l2));min-width:0}
.dy-perm:last-child{border-bottom:0}
.dy-perm .nm{font-weight:500;font-size:13px;width:150px;flex:none;overflow-wrap:anywhere}
.dy-switch{width:34px;height:20px;border-radius:999px;background:var(--dsw-alias-border-l2);position:relative;flex:none;cursor:pointer}
.dy-switch::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s}
.dy-switch.on{background:var(--dsw-alias-state-success-primary,#16a34a)}
.dy-switch.on::after{left:16px}
.dy-foot{color:var(--dsw-alias-label-tertiary,#6b7280);font-size:11.5px;font-variant-numeric:tabular-nums}
.dy-wall{display:flex;flex-direction:column;gap:12px}
.dy-dayhead{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--dsw-alias-label-secondary,#4b5563)}
.dy-dayhead b{color:var(--dsw-alias-label-primary);font-weight:600}
.dy-dayhead .ln{flex:1;height:1px;background:var(--dsw-alias-border-l1,var(--dsw-alias-border-l2))}
.dy-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.dy-vitem{display:flex;flex-direction:column;gap:6px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-l2));
  border-radius:10px;overflow:hidden;text-decoration:none;color:inherit}
.dy-vitem:hover{border-color:var(--dsw-alias-border-l2)}
.dy-thumb{width:100%;aspect-ratio:16/9;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1,#f7f8fa));display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary,#6b7280);font-size:11px}
.dy-thumb-img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px;display:block}
.dy-vbody{padding:0 10px 10px;display:flex;flex-direction:column;gap:3px}
.dy-vt{font-size:12px;font-weight:500;color:var(--dsw-alias-label-primary);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.dy-vn{font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280)}
.dy-mtabs{display:flex;gap:6px;flex-wrap:wrap}
.dy-mtab{font:inherit;font-size:12px;padding:3px 11px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);cursor:pointer}
.dy-mtab[aria-selected="true"]{background:var(--dsw-alias-brand-primary,var(--dy-accent,#2563eb));border-color:var(--dsw-alias-brand-primary,var(--dy-accent,#2563eb));color:#fff;font-weight:500}
.dy-tl{display:flex;flex-direction:column;gap:6px}
.dy-tl-item{display:flex;gap:8px;align-items:flex-start;padding:7px 10px;border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-l2));border-radius:8px;background:var(--dsw-alias-bg-base);min-width:0}
.dy-tl-bar{width:3px;border-radius:2px;align-self:stretch;flex:none;background:var(--dsw-alias-brand-primary,var(--dy-accent,#2563eb))}
.dy-tl-bar.pref{background:#f0a35e}.dy-tl-bar.fact{background:var(--dsw-alias-state-success-primary,#16a34a)}
.dy-tl-bar.habit{background:#7c3aed}.dy-tl-bar.mention{background:var(--dsw-alias-state-warn-primary,#d97706)}
.dy-tl-text{font-size:12.5px;min-width:0;overflow-wrap:anywhere}
.dy-tl-meta{font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280);flex:none;margin-left:auto}
.dy-stat2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.dy-stat{background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-l2));border-radius:10px;padding:10px 12px}
.dy-stat .v{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
.dy-stat .k{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#6b7280)}
`;
    function injectStyles() {
      if (typeof document === 'undefined') return;
      const tag = 'dsh-douyin-browser-local/panel.css';
      if (document.querySelector(`style[data-plugin-css="${tag}"]`)) return;
      const node = document.createElement('style');
      node.dataset.plugin = 'dsh-douyin-browser-local';
      node.dataset.pluginCss = tag;
      node.textContent = PANEL_CSS;
      document.head.appendChild(node);
    }
    // 面板通用积木（对应预览稿 dy-* 规格 v2.4）。dyCard 只接 children；带 key 的用法直接写 h('div', {className:'dy-card', key}) 。
    const dyCard = (...children) => h('div', { className: 'dy-card' }, ...children);
    const dyChip = (kind, text) => h('span', { className: `dy-chip ${kind}` }, h('span', { className: 'd', 'aria-hidden': 'true' }), text);
    const dyKv = (key, value) => h('p', { className: 'dy-kv' }, key ? h('span', { className: 'k' }, key) : null, h('span', null, value));
    const dyRow = (time, text) => h('p', { className: 'dy-rowline' }, time ? h('span', { className: 't' }, time) : null, h('span', null, text));
    const dySel = (props, options) => h('span', { className: 'dy-sel' }, h('select', { className: 'dy-input', ...props }, ...options.map(([key, text]) => h('option', { key, value: key }, text))));
    const dySwitch = (on, props) => h('span', { className: `dy-switch${on ? ' on' : ''}`, role: 'switch', 'aria-checked': on === true, ...props });
    const copyData = (build) => { try { void navigator.clipboard?.writeText(build()); } catch {} };
    const h3Card = text => h('h3', { style: { margin: 0, fontSize: 13, fontWeight: 600 } }, text);
    // 前端错误环：window.onerror 收集最近 20 条渲染/运行异常，自检页展示、可清空；不含个人信息。
    const ERR_KEY = 'douyin-panel-errors';
    const recordPanelError = message => { try { const list = JSON.parse(globalThis.sessionStorage?.getItem(ERR_KEY) || '[]'); list.unshift({ at: new Date().toISOString(), message: String(message).slice(0, 300) }); globalThis.sessionStorage?.setItem(ERR_KEY, JSON.stringify(list.slice(0, 20))); } catch {} };
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && !window.__douyinPanelErrHooked) { window.__douyinPanelErrHooked = true; window.addEventListener('error', ev => recordPanelError(ev?.message || '未知脚本错误')); }
    // 模块级状态缓存（对标官方插件 store 常驻模式）：面板关闭后数据仍在，重开面板首帧即渲染上次内容，后台刷新——不再每次冷启动空白等 /state 往返。
    let stateStore = null;

    // 足迹封面（D3）：从本机缓存取观察首帧；无缓存时保持续占位，不伪造封面。
    function ThumbImg({ api, videoId }) {
      const [src, setSrc] = useState(null);
      useEffect(() => {
        let alive = true, url = null;
        const token = api.tokenOf();
        if (token) {
          url = `${PREFIX}/thumb?videoId=${videoId}&token=${token}`;
          const probe = new Image();
          probe.onload = () => { if (alive) setSrc(url); };
          probe.onerror = () => {};
          probe.src = url;
        }
        return () => { alive = false; };
      }, [api, videoId]);
      return src ? h('img', { className: 'dy-thumb-img', src, alt: '' }) : h('div', { className: 'dy-thumb', 'aria-hidden': 'true' }, '暂无封面');
    }

    const OPERATIONS = {
      '/bootstrap': '连接本机服务', '/state': '刷新运行状态', '/interactions/state': '读取好友在线状态', '/interactions/configure': '设置好友互动',
      '/browser/open': '打开抖音', '/watch/state': '读取自主观看状态', '/watch/schedule': '设置自动观看', '/watch/options': '保存观看主题', '/watch/start': '开始自主观看', '/watch/stop': '停止自主观看',
      '/video/status': '读取观看时段与用量', '/video/configure': '保存观看时段与额度', '/video/start': '开始观看', '/video/stop': '结束观看',
      '/chat/state': '读取自动回复状态', '/chat/contacts': '读取当前会话列表', '/chat/configure': '保存许可名单', '/chat/start': '启动自动回复', '/chat/stop': '停止自动回复', '/chat/prepare': '准备回复通道', '/chat/resolve': '解除会话暂停', '/chat/unanswered': '读取遗留待处理消息', '/chat/unanswered/resolve': '标记遗留待处理消息', '/chat/unanswered/end': '结束待答，不再回复', '/chat/unanswered/retry': '安全重新检查',
      '/share/state': '读取分享状态', '/share/configure': '设置自主分享', '/share/resolve': '核对分享结果', '/comments/state': '读取评论状态', '/comments/configure': '保存评论设置', '/comments/resolve': '核对评论结果',
      '/mode/state': '读取静默观看设置', '/mode/configure': '保存静默观看设置', '/media/state': '读取音频设置', '/media/configure': '保存音频设置', '/media/credentials': '保存音频密钥',
      '/persona': '读取人格', '/persona/card': '保存人格', '/persona/configure': '保存人格', '/persona/context-observations': '切换观察注入上下文', '/memory/search': '搜索记忆', '/memory/forget': '删除记忆', '/model/configure': '保存模型设置', '/task/limits': '读取任务额度', '/task/limits/configure': '保存任务额度',
      '/task': '提交对话任务', '/stop': '停止对话任务', '/forward/contacts': '读取转发会话', '/forward': '转发作品', '/memory': '检索共享记忆',
      '/usage': '读取用量', '/diagnostics': '一键自检', '/diagnostics/repair': '修复自检问题', '/reports/generate': '生成观看日报', '/reports/read': '读取观看日报', '/reports/state': '读取日报目录',
    };

    function requestOperation(route, body) {
      const path = route.split('?')[0].replace(/^\/api/, '');
      if (path === '/task/limits' && body !== undefined) return '保存任务额度';
      if (path === '/watch/schedule' && typeof body?.enabled === 'boolean') return body.enabled ? '开始自主观看' : '暂停观看';
      return OPERATIONS[path] || '本机操作';
    }

    function requestFailure(failure, operation, { timeoutMs, write = false, signal } = {}) {
      failure = failure || new Error('操作未完成。');
      if (failure.operation) return failure;
      const timedOut = !Number.isInteger(failure.status) && (failure.name === 'TimeoutError' || signal?.reason?.name === 'TimeoutError' || /^(?:signal timed out|the operation was aborted due to timeout)\.?$/i.test(failure.message || ''));
      const cancelled = failure.name === 'AbortError';
      const transport = timedOut || cancelled || Boolean(timeoutMs && (failure instanceof TypeError || failure.name === 'TypeError'));
      const detail = timedOut ? `等待本机服务超时${timeoutMs ? `（${Math.round(timeoutMs / 1000)} 秒）` : ''}。` : cancelled ? '请求已取消。' : transport ? '未能连接本机服务。' : /^signal timed out\.?$/i.test(failure.message || '') ? `服务处理超时（${failure.message}）。` : failure.message || '操作未完成。';
      const error = new Error(`${operation}：${detail}${transport && write ? '请求结果尚未确认，请先刷新状态核对，勿重复提交。' : ''}`);
      error.operation = operation; error.requestError = transport; error.unconfirmed = transport && write;
      if (failure.status !== undefined) error.status = failure.status;
      if (failure.code !== undefined) error.code = failure.code;
      return error;
    }

    function operationLabel(name) {
      return ({ browserOpen:'打开抖音', browser:'打开抖音', refresh:'刷新连接', task:'提交对话任务', stop:'停止对话任务', settings:'保存模型设置', clearKey:'移除模型密钥', openMemory:'打开抖音', memory:'检索共享记忆', watchSchedule:'设置自动观看', schedule:'设置自动观看', interactions:'设置好友互动', chatList:'读取当前会话列表', chatPrepare:'准备回复通道', forwardList:'读取转发会话', forward:'转发作品', personaReload:'载入最新人格', diagnostics:'一键自检或修复', reportGenerate:'生成观看日报', reportRead:'读取观看日报' })[name] || (/^resolve-|^chatResolve:/.test(name) ? '解除会话暂停' : name.startsWith('key:') ? '保存音频密钥' : '本机操作');
    }

    function createSettingsTransport(globals = globalThis, rpc = globals.__DSH_TRANSPORT__?.rpc) {
      const carrier = globals.__DSH_TRANSPORT__;
      const address = globals.location;
      const http = address && ['http:', 'https:'].includes(address.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(address.hostname);
      const desktop = ['dsh-app:', 'dsh:'].includes(address?.protocol) && address.hostname === 'app';
      const fetcher = typeof carrier?.fetch === 'function' ? carrier.fetch.bind(carrier) : (http || desktop) && typeof globals.fetch === 'function' ? globals.fetch.bind(globals) : null;
      let token = '';
      const writing = new Set();
      return {
        async request(route, input) {
          if (!routes.has(route) && !/^\/reports\/read\?date=\d{4}-\d{2}-\d{2}$/.test(route)) throw new Error('只允许本插件的原生设置接口。');
          if (!fetcher && typeof rpc?.call !== 'function') throw new Error('当前 DSH 页面没有可用的插件设置通信接口。请更新插件后完全退出并重开 DSH；若仍失败，请核对 DSH 版本与来源。可点击“刷新插件状态”重试。');
          if (input !== undefined && !token) throw new Error('请先刷新原生设置页，核实当前状态。');
          if (route === '/chat/unanswered' && !token) throw new Error('请先刷新原生设置页，核实当前状态。');
          const operation = requestOperation(route, input), write = input !== undefined, timeoutMs = route === '/state' ? 20_000 : 65_000;
          if (write && writing.has(route)) throw Object.assign(new Error(`${operation}正在处理，请等待当前请求完成。`), { operation, code: 'UI_OPERATION_BUSY' });
          if (write) writing.add(route);
          const signal = AbortSignal.timeout(timeoutMs);
          try {
          let response;
          if (!fetcher && typeof rpc?.call === 'function') {
            const reply = await rpc.call('/douyin-settings', 'request', { path: route, ...(input === undefined ? (route === '/chat/unanswered' ? { token } : {}) : { input, token }) }, signal);
            if (!reply?.ok) throw new Error(reply?.error?.message || 'DSH 设置通信失败，请确认插件后端已加载新版；操作不会自动重试。');
            const outcome = reply.value;
            if (!Number.isInteger(outcome?.status) || !outcome.body || typeof outcome.body !== 'object') throw new Error('DSH 设置接口版本不匹配，请完全退出后重开 DSH。');
            response = { status: outcome.status, ok: outcome.status >= 200 && outcome.status < 300, json: async () => outcome.body };
          } else response = await fetcher(PREFIX + route, { method: input === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal, headers: { 'content-type': 'application/json', ...(input !== undefined || route === '/chat/unanswered' ? { 'x-douyin-settings-token': token } : {}) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
          let value;
          try { value = await response.json(); }
          catch (failure) { if (signal.aborted || failure.name === 'TimeoutError') throw failure; const error = new Error(`插件设置接口未返回 JSON（HTTP ${response.status || '未知'}）。请检查插件后端是否启用、DSH 的 WebServer 服务及版本兼容性。`); error.status = response.status; throw error; }
          if (!response.ok) { const error = new Error(value.error || '原生设置操作未完成。'); error.status = response.status; throw error; }
          if (route === '/state') { if (typeof value.token !== 'string' || !value.token) throw new Error('原生设置未取得有效会话。'); token = value.token; const { token: hidden, ...state } = value; return state; }
          return value;
          } catch (failure) { throw requestFailure(failure, operation, { timeoutMs, write, signal }); }
          finally { if (write) writing.delete(route); }
        },
        tokenOf: () => token,
      };
    }

    function useAutosave({ value, initial, read, encode, write, canonical = (_result, payload) => payload, available = true }) {
      const [draft, setDraft] = useState(() => value ? read(value) : initial), [status, setStatus] = useState({});
      const current = useRef(draft), dirty = useRef(false), version = useRef(0), ack = useRef(null), timer = useRef(null), writing = useRef(false), queued = useRef(false), requested = useRef(false), alive = useRef(true), options = useRef(null);
      options.current = { read, encode, write, canonical, available };
      const schedule = immediate => { requested.current = true; clearTimeout(timer.current); timer.current = setTimeout(() => { void flush(); }, immediate ? 0 : 600); };
      async function flush() {
        requested.current = true; clearTimeout(timer.current); if (!alive.current || !dirty.current || !options.current.available) return;
        if (writing.current) { queued.current = true; return; }
        let payload; try { payload = options.current.encode(current.current); } catch (error) { setStatus({ kind: 'editing', message: error.message || '填写完整后自动生效。' }); return; }
        const submitted = version.current; writing.current = true; queued.current = false; requested.current = false; setStatus({ kind: 'saving', message: '正在保存…' });
        try { const result = await options.current.write(payload), expected = options.current.canonical(result, payload); if (alive.current && submitted === version.current) { ack.current = { version: submitted, key: JSON.stringify(expected) }; setStatus({ kind: 'saved', message: '已保存，等待状态同步。' }); } }
        catch (error) { if (alive.current) setStatus({ kind: 'error', message: `${error.message || '保存失败。'} 草稿已保留。` }); }
        finally { writing.current = false; if (alive.current && queued.current) schedule(true); }
      }
      function edit(patch, { immediate = false, blurOnly = false } = {}) {
        current.current = { ...current.current, ...patch }; version.current++; dirty.current = true; ack.current = null; setDraft(current.current); setStatus({ kind: 'editing', message: blurOnly ? '离开输入框后自动保存。' : '修改后自动保存。' }); clearTimeout(timer.current); requested.current = !blurOnly; if (blurOnly) queued.current = false; else schedule(immediate);
      }
      useEffect(() => {
        if (!value) return; let incoming, key; try { incoming = options.current.read(value); key = JSON.stringify(options.current.encode(incoming)); } catch { return; }
        if (ack.current?.version === version.current && ack.current.key === key) { dirty.current = false; ack.current = null; setStatus({ kind: 'saved', message: '已生效。' }); }
        if (!dirty.current && !writing.current) { current.current = incoming; setDraft(incoming); }
      }, [value]);
      useEffect(() => { if (available && requested.current && dirty.current) schedule(true); }, [available]);
      useEffect(() => { alive.current = true; return () => { alive.current = false; clearTimeout(timer.current); }; }, []);
      return { draft, edit, flush, status };
    }

    function SettingsPage({ rpc } = {}) {
      const [api] = useState(() => createSettingsTransport(globalThis, rpc));
      const [state, setState] = useState(stateStore), [ready, setReady] = useState(stateStore !== null), [connectionError, setConnectionError] = useState(''), [notice, setNotice] = useState(''), [category, setCategory] = useState('基础设置');
      const [operationErrors, setOperationErrors] = useState({});
      const [busy, setBusy] = useState(new Set()), [contacts, setContacts] = useState(null), [discovery, setDiscovery] = useState(null), [diagnostics, setDiagnostics] = useState(null), [repairResult, setRepairResult] = useState(''), [report, setReport] = useState(null), [reportDate, setReportDate] = useState('');
      const [credentials, setCredentials] = useState({ mimo: '', minimax: '' }), [keyStatus, setKeyStatus] = useState({}), [reviews, setReviews] = useState(new Set());
      // 观看足迹与记忆管理（吞噬新增栏目）的本地状态；足迹数据懒加载，进入栏目时拉取。
      const [watched, setWatched] = useState(null), [watchedError, setWatchedError] = useState(''), [watchedDays, setWatchedDays] = useState('14'), [memTab, setMemTab] = useState('character'), [panelErrorsTick, setPanelErrorsTick] = useState(0);
      const [memoryQuery, setMemoryQuery] = useState(''), [memoryResults, setMemoryResults] = useState(null), [memoryConfirm, setMemoryConfirm] = useState('');
      useEffect(() => { if (category === '观看足迹' && ready) { void loadWatched(watchedDays); } }, [category, ready, watchedDays]);
      const existingAuthorization = useRef(false); const alive = useRef(true), refreshing = useRef(null), refreshAgain = useRef(false), locks = useRef(new Set()), submitted = useRef(new Set()), keyValues = useRef(credentials);
      const active = value => value?.running || value?.starting || value?.busy || value?.worker?.alive;
      const operationActive = active(state?.watch) || state?.chat?.starting || state?.chat?.busy || state?.share?.busy;
      async function refresh(fresh = false) {
        if (refreshing.current) { if (fresh) refreshAgain.current = true; return refreshing.current; }
        const work = (async () => {
          let latest;
          do {
            refreshAgain.current = false;
            try { const value = await api.request('/state'); if (alive.current && !refreshAgain.current) { latest = value; stateStore = value; setState(value); setReady(true); setConnectionError(''); } }
            catch (failure) { if (alive.current && !refreshAgain.current) { setReady(false); setConnectionError(failure.message); } }
          } while (alive.current && refreshAgain.current);
          return latest;
        })();
        refreshing.current = work; try { return await work; } finally { if (refreshing.current === work) refreshing.current = null; }
      }
      useEffect(() => { alive.current = true; void refresh(); const timer = setInterval(() => { void refresh(); }, 2500); return () => { alive.current = false; clearInterval(timer); }; }, [api]);
      useEffect(() => { if (!reportDate && state?.reports?.date) setReportDate(state.reports.date); }, [state]);
      const write = route => async payload => { const result = await api.request(route, payload); void refresh(true); return result; };
      const loadWatched = async (days = watchedDays) => {
        if (!ready) return;
        try { setWatchedError(''); setWatched(await api.request(`/watched?days=${days}`)); }
        catch (failure) { setWatchedError(failure.message || '观看足迹未读取，稍后重试。'); }
      };
      // wide=按方案 v2 的单行分隔语义（斜杠/空格/逗号/换行均切）；昵称等窄语义保持逗号/分号/换行。
      const list = (text, wide = false) => String(text || '').split(wide ? /[\s,;，；\/]+/ : /[\n,;，；]+/).map(item => item.trim()).filter(Boolean);
      const positive = (value, label) => { const number = Number(value); if (String(value).trim() === '' || !Number.isSafeInteger(number) || number < 1) throw new Error(`${label}请填写正整数。`); return number; };
      const model = useAutosave({ value: state?.model, initial: { provider: '', model: '' }, read: value => ({ provider: value.provider || '', model: value.model || '' }), encode: value => { if (!value.provider || !value.model) throw new Error('请选择提供商和模型。'); return value; }, write: write('/model/configure'), available: ready && !operationActive });
      const persona = useAutosave({ value: state?.persona, initial: { content: '', expectedRevision: null }, read: value => ({ content: value.manualText || '', expectedRevision: value.revision }), encode: value => value, write: write('/persona/configure'), canonical: (saved, payload) => saved?.revision ? { content: saved.manualText || '', expectedRevision: saved.revision } : payload, available: ready && !operationActive });
      const readVideo = snapshot => { const policy = snapshot?.policy || {}, minutes = Object.hasOwn(policy, 'dailyMinutes') ? policy.dailyMinutes : Object.hasOwn(policy, 'sessionMinutes') ? policy.sessionMinutes : 10, requests = Object.hasOwn(policy, 'dailyRequests') ? policy.dailyRequests : 30; return { windows: (policy.windows || ['00:00-24:00']).join('\n'), weekendAll: policy.weekendWindows?.join() === '00:00-24:00', dailyMinutes: minutes ?? '', unlimitedMinutes: minutes === null, dailyRequests: requests ?? '', unlimitedRequests: requests === null }; };
      const encodeVideo = value => { const windows = list(value.windows, true); if (!windows.length || windows.some(item => !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(item))) throw new Error('时段请填写完整的 HH:MM-HH:MM。'); return { windows, weekendWindows: value.weekendAll ? ['00:00-24:00'] : null, dailyMinutes: value.unlimitedMinutes ? null : positive(value.dailyMinutes, '每日观看分钟数'), dailyRequests: value.unlimitedRequests ? null : positive(value.dailyRequests, '每日模型请求次数') }; };
      const video = useAutosave({ value: state?.video, initial: readVideo(null), read: readVideo, encode: encodeVideo, write: write('/video/configure'), canonical: (saved, payload) => saved?.policy ? encodeVideo(readVideo(saved)) : payload, available: ready });
      const readTopics = value => ({ mode: value?.policy?.mode || 'recommend', topics: (value?.policy?.topics || []).join('\n'), exclude: (value?.policy?.exclude || []).join('\n') });
      const topics = useAutosave({ value: state?.watchOptions, initial: readTopics(null), read: readTopics, encode: value => ({ mode: value.mode, topics: list(value.topics, true), exclude: list(value.exclude, true) }), write: write('/watch/options'), canonical: (saved, payload) => saved?.policy ? { mode: saved.policy.mode, topics: saved.policy.topics || [], exclude: saved.policy.exclude || [] } : payload, available: ready });
      const mode = useAutosave({ value: state?.mode, initial: { silent: false }, read: value => ({ silent: value?.silent === true }), encode: value => value, write: write('/mode/configure'), canonical: (saved, payload) => typeof saved?.silent === 'boolean' ? { silent: saved.silent } : payload, available: ready });
      const comments = useAutosave({ value: state?.comments, initial: { enabled: false, dailyLimit: 3, perSessionLimit: 1 }, read: value => ({ enabled: value.enabled === true, dailyLimit: value.policy?.dailyLimit ?? 3, perSessionLimit: value.policy?.perSessionLimit ?? 1 }), encode: value => ({ enabled: value.enabled, dailyLimit: positive(value.dailyLimit, '每日评论次数'), perSessionLimit: positive(value.perSessionLimit, '每次观看评论次数') }), write: write('/comments/configure'), canonical: (saved, payload) => saved?.policy ? { enabled: saved.enabled === true, dailyLimit: saved.policy.dailyLimit, perSessionLimit: saved.policy.perSessionLimit } : payload, available: ready });
      const media = useAutosave({ value: state?.media, initial: { enabled: false, backend: 'local-whisper' }, read: value => ({ enabled: value.enabled === true, backend: value.backend || 'local-whisper' }), encode: value => value, write: write('/media/configure'), available: ready });
      const readChat = value => ({ recipientIds: (value?.policy?.allowlist || []).map(item => item.id), allowConversationOnly: existingAuthorization.current || (value?.policy?.allowlist || []).some(item => ['existing-conversation', 'existing-group'].includes(item.authorizationKind)), groupMentionNamesText: (value?.policy?.groupMentionNames || ['大肥鱼']).join('\n') });
      const encodeChat = value => ({ recipientIds: value.recipientIds, allowConversationOnly: value.allowConversationOnly, groupMentionNames: list(value.groupMentionNamesText) });
      const chat = useAutosave({ value: state?.chat, initial: readChat(null), read: readChat, encode: encodeChat, write: write('/chat/configure'), canonical: (saved, payload) => saved?.policy ? encodeChat(readChat(saved)) : payload, available: ready });
      const shownContacts = [...new Map([...(state?.chat?.policy?.allowlist || []).map(item => ({ ...item, notListed: Boolean(contacts) && !contacts.some(found => found.id === item.id) })), ...(contacts || [])].map(item => [item.id, item])).values()];
      async function perform(key, action) {
        if (!ready || locks.current.has(key)) return; locks.current.add(key); setBusy(new Set(locks.current)); setNotice('');
        setOperationErrors(old => { const next = { ...old }; delete next[key]; return next; });
        try { const value = await action(); if (alive.current) setNotice(`${operationLabel(key)}已完成。`); await refresh(true); return value; }
        catch (failure) { if (alive.current) { const detail = requestFailure(failure, operationLabel(key)); setOperationErrors(old => ({ ...old, [key]: { message: detail.message, requestError: detail.requestError === true, unconfirmed: detail.unconfirmed === true } })); } await refresh(true); }
        finally { locks.current.delete(key); if (alive.current) setBusy(new Set(locks.current)); }
      }
      const button = (label, key, action, disabled = false, needsReady = true, variant = 'outline') => h('button', { type: 'button', className: `dy-btn${variant === 'primary' ? ' primary' : ''}`, disabled: (needsReady && !ready) || busy.has(key) || disabled, onClick: action }, busy.has(key) ? '处理中…' : label);
      const note = text => text ? h('p', { style: muted }, text) : null;
      const status = form => form.status.message && h('p', { role: form.status.kind === 'error' ? 'alert' : 'status', style: muted }, form.status.message);
      const section = (title, ...children) => h('section', { role: 'tabpanel', 'aria-label': title, style: { ...column, marginBottom: 24 } }, h('h3', null, title), ...children);
      const field = (label, form, key, extra = {}) => h('label', { style: column }, h('span', null, label), h(Input, { 'aria-label': label, value: form.draft[key], disabled: !ready, onChange: event => form.edit({ [key]: event.target.value }), ...extra }));
      const area = (label, form, key, rows = 2, blurOnly = false, disabled = false) => h('label', { style: column }, label, h('textarea', { 'aria-label': label, rows, value: form.draft[key], disabled: !ready || disabled, style: formControl, onChange: event => form.edit({ [key]: event.target.value }, { blurOnly }), onBlur: blurOnly ? () => { void form.flush(); } : undefined }));
      const toggle = (label, checked, onChange, disabled = false) => h('label', { style: row }, h('input', { type: 'checkbox', 'aria-label': label, checked: checked === true, disabled: !ready || disabled, onChange: event => onChange(event.target.checked) }), label);
      const select = (label, value, options, onChange, disabled = false) => h('label', { style: column }, label, h('select', { 'aria-label': label, value, style: formControl, disabled: !ready || disabled, onChange: event => onChange(event.target.value) }, ...options.map(([key, text]) => h('option', { key, value: key }, text))));
      const reviewList = kind => (state?.[kind]?.needsReview || []).map(item => { const key = `${kind}:${item.operationId}`; return h('div', { key, style: column }, note(`待核对：${item.videoId ? `作品 ${item.videoId}` : '消息'} · ${item.status || ''}`), submitted.current.has(key) ? note('核对结果已提交，等待回读。') : h('div', { style: row }, ...[['confirmed', '已核对发送成功'], ['not-sent', '已核对未发送']].map(([outcome, label]) => button(label, key, () => { submitted.current.add(key); setReviews(new Set(submitted.current)); void perform(key, async () => { try { return await api.request(`/${kind}/resolve`, { operationId: item.operationId, outcome }); } catch (error) { submitted.current.delete(key); setReviews(new Set(submitted.current)); throw error; } }); }, state?.[kind]?.busy)))); });
      const shareFailureMessage = item => typeof item?.failure?.message === 'string' && item.failure.message.trim() ? item.failure.message : item?.status === 'not-sent' ? '旧记录没有保存详细失败原因。' : '';
      function credentialForm(backend, label) {
        return h('div', { style: column }, h('label', { style: column }, `${label} API Key`, h(Input, { 'aria-label': `${label} API Key`, type: 'password', autoComplete: 'off', maxLength: 4096, value: credentials[backend], disabled: !ready || operationActive || busy.has(`key:${backend}`), onChange: event => { keyValues.current = { ...keyValues.current, [backend]: event.target.value }; setCredentials(keyValues.current); }, onBlur: () => { const secret = keyValues.current[backend].trim(); if (!secret) return; void perform(`key:${backend}`, async () => { const result = await api.request('/media/credentials', { backend, apiKey: secret }); if (keyValues.current[backend].trim() === secret) { keyValues.current = { ...keyValues.current, [backend]: '' }; setCredentials(keyValues.current); } setKeyStatus(old => ({ ...old, [backend]: 'Key 已保存，不回显。' })); return result; }); } })), note(keyStatus[backend] || (state?.media?.backends?.[backend]?.credential?.configured ? '已配置；填写新 Key 后离开输入框即可替换。' : '填写 Key，离开输入框后保存。')));
      }
      const friendEnabled = state?.interactions?.policy?.enabled === true, watchEnabled = state?.schedule?.policy?.enabled === true;
      const presence = ready ? state?.interactions?.presence : null, replyPresence = presence?.reply || presence, watchState = presence?.watch, presenceLabel = replyPresence?.label || '状态待核实', presenceReason = replyPresence?.reason || '正在读取好友回复服务状态。', watchLabel = watchState?.active ? watchState.label : '';
      // 待答五态（与后端 deriveBacklogState 对齐；两入口共用同一套文案，desktop/ui-api 侧实现保持同构）。
      const STATE_LABELS = { replying: '自动补答中', retrying: '等待自动恢复', 'needs-manual': '已转人工处理', uncertain: '发送结果不明', resolved: '已结束' };
      // 五态胶囊配色（v2 预览稿语义）：replying=info 蓝 / retrying=warn 橙 / needs-manual=err 红 / uncertain=violet 紫
      const STATE_CHIP = { replying: 'info', retrying: 'warn', 'needs-manual': 'err', uncertain: 'violet' };
      const chatActive = Boolean(active(state?.chat));
      // P2-3 跨面板生命周期缓存：client.js 跑在 DSH 宿主页面里，sessionStorage 随宿主页面会话存续——
      // 重开设置面板立即呈现上次真实内容，数据仍以接口回读为准（展示用缓存，不用于放行任何操作）。
      // 不用 localStorage：待答是短生命周期状态，跨 DSH 重启展示旧数据弊大于利。
      const CACHE_KEY = 'douyin-unanswered-cache';
      const readCache = () => { try { const value = JSON.parse(globalThis.sessionStorage?.getItem(CACHE_KEY) || 'null'); return value && value.protocol === 'chat-unanswered-v2' ? value : null; } catch { return null; } };
      const writeCache = value => { try { if (value) globalThis.sessionStorage?.setItem(CACHE_KEY, JSON.stringify(value)); } catch { /* 隐私模式等存不进就不缓存，行为退回直连。 */ } };
      const [unanswered, setUnanswered] = useState(readCache), [unansweredError, setUnansweredError] = useState(''), [stale, setStale] = useState(() => Boolean(readCache()));
      // P2-1 状态指纹：unansweredCount+chatActive 之外再加 items 的 backlogState+escalated 拼接，
      // 总数不变、状态变化（如补答完成转结案、升级提示置位）也能触发重拉；
      // 另加 30s 轻量兜底重拉（与 2.5s 状态轮询错开，避免每拍都打待答接口），拿不到指纹时也有兜底。
      const stateFingerprint = (unanswered?.items || []).map(item => `${item.backlogState ?? ''}${item.escalated ? '!' : ''}`).join(',') + `#${unanswered?.count ?? 0}`;
      useEffect(() => {
        if (!unanswered) { const cached = readCache(); if (cached) { setUnanswered(cached); setStale(true); } }
        if (!ready) return; let aliveView = true;
        const load = () => { void api.request('/chat/unanswered').then(value => { if (aliveView && value?.protocol === 'chat-unanswered-v2') { setUnanswered(value); setUnansweredError(''); setStale(false); writeCache(value); } }).catch(failure => { if (aliveView) { setUnansweredError(failure.message && failure.message !== 'undefined' ? failure.message : '待答列表未读取，稍后自动重试。'); setStale(true); } }); };
        load();
        const slow = setInterval(load, 30_000);
        return () => { aliveView = false; clearInterval(slow); };
      }, [api, ready, state?.chat?.unansweredFingerprint || state?.chat?.unansweredCount, chatActive, stateFingerprint]);
      const workerActive = chatActive;
      const cardKey = recordId => `unanswered:${recordId.slice(0, 8)}`;
      const endUnanswered = (recordId, snapshot) => perform(cardKey(recordId), async () => {
        const value = await api.request('/chat/unanswered/end', { recordIds: [recordId], snapshot }); setUnanswered(value.unanswered || null); setUnansweredError(''); setStale(false); writeCache(value.unanswered || null); return value;
      });
      const retryUnanswered = recordId => perform(`recheck:${recordId.slice(0, 8)}`, async () => {
        const value = await api.request('/chat/unanswered/retry', { recordIds: [recordId] }); setUnanswered(value.unanswered || null); setUnansweredError(''); setStale(false); writeCache(value.unanswered || null); return value;
      });
      // 五态卡片：dy-card 容器 + 彩色状态胶囊 + 一行摘要 + 一句原因 + 按态按钮（availableActions 由服务端裁剪）；细节收进「详情」。
      const unansweredCard = item => {
        const key = cardKey(item.recordId), state = item.backlogState || 'retrying', done = busy.has(key);
        const summary = item.preview ? `「${item.preview.slice(0, 40)}」` : item.previewNote || '（没有可显示的文字正文）';
        const when = item.at ? new Date(item.at).toLocaleTimeString('zh-CN', { hour12: false }) : '';
        const chipText = done ? '正在处理' : STATE_LABELS[state] || '等待自动恢复';
        const escalate = item.escalated === true;
        const reason = item.progressNote || item.reason || '';
        const actions = Array.isArray(item.availableActions) ? item.availableActions : ['open-chat'];
        return h('div', { key: item.recordId, className: 'dy-card' },
          h('div', { className: 'dy-card-top' },
            dyChip(STATE_CHIP[state] || 'retry', chipText),
            h('span', { className: 'sp' }),
            h('span', { className: 'dy-cap' }, `${item.contactName}${item.messageCount > 1 ? ` · ${item.messageCount} 条消息` : ''}`),
            when && h('span', { className: 'dy-foot' }, `${when} 到达`)),
          h('p', { className: 'dy-note' }, summary),
          h('p', { className: 'dy-note' }, escalate && state === 'retrying' ? h('b', { className: 'dy-strong' }, `${reason}（已连续多次等待，建议人工核对）`) : reason),
          // 方案承诺的「已等待时长 + 下次尝试」：nextRetryAt 由 chat-service 在 retrying 态透出，at 为到达时间。
          state === 'retrying' && (item.nextRetryAt || item.at) && h('p', { className: 'dy-note' }, [item.at ? `已等待 ${Math.max(0, Math.round((Date.now() - new Date(item.at).getTime()) / 60_000))} 分钟` : '', item.nextRetryAt ? `下次尝试 ${new Date(item.nextRetryAt).toLocaleTimeString('zh-CN', { hour12: false })}` : ''].filter(Boolean).join(' · ')),
          h('div', { className: 'dy-row' },
            actions.includes('open-chat') && button('打开抖音', 'browser', () => { void perform('browser', () => api.request('/browser/open', {})); }, false, false),
            actions.includes('open-chat') && h('span', { className: 'dy-cap' }, '（打开抖音后请手动查找原会话核对）'),
            actions.includes('retry-now') && button('安全重新检查', `recheck:${item.recordId.slice(0, 8)}`, () => { void retryUnanswered(item.recordId); }, workerActive),
            // 结束待答不在运行时禁用：后端 endUnanswered 有 withChatPaused(resume:'preserve') 协调运行中写入；
            // 保留的保护裁剪只在服务端 availableActions（uncertain 态无 end、混合记录文字目标未核对完不给 end），前端跟随不再造禁用。
            actions.includes('end') && !done && button('结束待答，不再回复', key, () => { void endUnanswered(item.recordId, unanswered.snapshot); }, item.canResolve === false),
            done && h('span', { className: 'dy-cap' }, '正在结束待答…'),
            state === 'uncertain' && h('span', { className: 'dy-cap' }, '只读回核对；在原会话核实前不重发。')),
          (item.attempts > 0 || item.retryCount > 0 || item.blockerCode || item.lastCheckedAt) && h('details', null, h('summary', null, '详情'), h('div', null,
            item.lastCheckedAt && dyRow(`最后检查 ${new Date(item.lastCheckedAt).toLocaleTimeString('zh-CN', { hour12: false })}`, reason ? '' : '状态在后台持续更新'),
            item.reason && item.reason !== reason && h('p', { className: 'dy-note' }, item.reason),
            h('p', { className: 'dy-note' }, '本地保留的文字预览仅用于核对；不会自动补发。'))));
      };
      const groups = unanswered?.groups;
      const checkedAt = unanswered?.checkedAt ? new Date(unanswered.checkedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '';
      const staleNotice = `显示的是 ${checkedAt || '上次'} 的缓存数据，正在后台刷新；刷新失败会保留内容，不会清空。`;
      const history = unanswered?.resolvedHistory;
      const historyView = history && (history.todayAutoResolved > 0 || history.todayManualEnded > 0) ? h('details', null,
        h('summary', null, `处理历史 · 今天已自动补答 ${history.todayAutoResolved} 条，人工结束 ${history.todayManualEnded} 条（不计入待处理）`),
        h('div', null,
          ...(history.items || []).map(entry => dyRow(entry.timeStr, entry.summary)),
          h('p', { className: 'dy-note', style: { opacity: 0.7, margin: '6px 0 0' } }, '历史只保留结果与核对方式，不重复展示正文。')
        )
      ) : null;
      const unansweredView = !unanswered ? (unansweredError ? [h('p', { role: 'alert', style: muted }, unansweredError)] : []) : [
        unanswered.count > 0 && h('div', { role: 'alert', className: 'dy-card-top' }, h('span', { className: 'dy-num', style: { fontSize: 15 } }, `待答消息 · ${unanswered.count} 条`), h('span', { className: 'dy-cap' }, `${groups?.autoRecovering ?? 0} 条自动恢复中 · ${(groups?.needsManual ?? 0) + (groups?.uncertain ?? 0)} 条已转人工，需要你判断`), h('span', { className: 'sp' }), h('span', { className: 'dy-foot' }, checkedAt ? `更新于 ${checkedAt}` : '')),
        stale && h('p', { role: 'status', style: muted }, staleNotice),
        unansweredError && h('p', { role: 'alert', style: { ...muted, color: 'var(--dsw-alias-signal-danger, #d93025)' } }, unansweredError),
        ...unanswered.items.map(unansweredCard),
        historyView,
      ].filter(Boolean);
      const summary = (() => {
        if (!ready) return null;
        if (state?.model?.configured !== true) return { label: '模型未配置', detail: '还没有选择 DSH 提供商和模型，自动能力都不会运行。', tab: '基础设置' };
        if (state?.video?.allowed === false && state.video.reason) return { label: '不在允许观看时段', detail: state.video.reason, tab: '视频观看' };
        if (state?.watch?.lastError) return { label: '上次自主观看中断', detail: state.watch.lastError, tab: '视频观看' };
        if (Number.isSafeInteger(state?.chat?.unansweredCount) && state.chat.unansweredCount > 0) { const g = state.chat.unansweredGroups || {}, manual = (g.needsManual ?? 0) + (g.uncertain ?? 0), auto = g.autoRecovering ?? (state.chat.unansweredCount - manual); return { label: manual > 0 ? `${manual} 条待答已转人工` : `${auto} 条待答自动恢复中`, detail: manual > 0 ? `另有 ${auto} 条在自动恢复；转人工的条目需要你判断是否还要回复，不会自动补发。` : '这些消息在自动恢复流程中，无需人工操作；不会自动补发。', tab: '好友互动' }; }
        if (replyPresence?.status === 'attention') return { label: '回复服务异常', detail: presenceReason, tab: '好友互动' };
        return { label: '一切正常', detail: [replyPresence?.label, watchState?.active ? watchState.label : ''].filter(Boolean).join(' · ') || '各能力按当前设置运行。' };
      })();
      return h('div', { className: 'dy-wrap', style: { maxWidth: 900, paddingBottom: 32 } },
        injectStyles(),
        h('div', { className: 'dy-head' }, h('h2', null, '大肥鱼抖音助手'), h('span', { className: 'sp' }), button('刷新插件状态', 'refresh', () => { void refresh(); }, false, false), button('打开抖音', 'browser', () => { void perform('browser', () => api.request('/browser/open', {})); })),
        !ready && h('p', { role: 'status' }, '正在核实插件状态。'), connectionError && h('p', { role: 'alert' }, connectionError),
        ...Object.entries(operationErrors).map(([key, failure]) => h('div', { key, role: 'alert', className: 'dy-row' }, h('span', null, `${failure.requestError ? '上次操作：' : ''}${failure.message}${failure.requestError && ready ? failure.unconfirmed ? ' 本机服务当前已连接；请核对上述操作是否生效。' : ' 本机服务当前已连接。' : ''}`), h('button', { type: 'button', 'aria-label': `清除${operationLabel(key)}提示`, onClick: () => setOperationErrors(old => { const next = { ...old }; delete next[key]; return next; }) }, '×'))), notice && h('p', { role: 'status' }, notice),
        h('div', { role: 'status', 'aria-live': 'polite', className: 'dy-statusline', style: { position: 'sticky', top: 0, zIndex: 5, background: 'var(--dsw-alias-bg-base, #fff)' }, title: [presenceReason, watchState?.active ? watchState.reason : ''].filter(Boolean).join(' ') },
          h('span', { 'aria-label': '好友互动状态', title: presenceReason },
            h('span', { className: `dy-dot ${replyPresence?.online === true ? '' : 'idle'}`, 'aria-hidden': 'true' }),
            h('span', { className: 'dy-num' }, presenceLabel)),
          (state?.chat?.unansweredGroups?.autoRecovering > 0) && h('span', null, h('span', { className: 'dy-dot warn', 'aria-hidden': 'true' }), ' ', h('span', { className: 'dy-num' }, String(state.chat.unansweredGroups.autoRecovering)), ' ', h('span', { className: 'dy-cap' }, '自动恢复中')),
          (((state?.chat?.unansweredGroups?.needsManual ?? 0) + (state?.chat?.unansweredGroups?.uncertain ?? 0)) > 0) && h('span', null, h('span', { className: 'dy-dot err', 'aria-hidden': 'true' }), ' ', h('span', { className: 'dy-num' }, String((state.chat.unansweredGroups.needsManual ?? 0) + (state.chat.unansweredGroups.uncertain ?? 0))), ' ', h('span', { className: 'dy-cap' }, '已转人工')),
          watchState?.active && h('span', { role: 'status', 'aria-label': '自主观看状态', title: watchState.reason }, h('span', { className: 'dy-dot', 'aria-hidden': 'true' }), ' ', h('span', { className: 'dy-cap' }, `◉ ${watchLabel}`)),
          (['attention', 'preparing'].includes(replyPresence?.status) || watchState?.active && replyPresence?.online !== true) && h('small', { role: replyPresence?.status === 'attention' ? 'alert' : 'status', className: 'dy-cap', style: { whiteSpace: 'normal' } }, presenceReason)),
        summary && h('div', { role: 'status', 'aria-label': '当前状态摘要', className: 'dy-card', title: summary.detail },
          h('div', { className: 'dy-card-top' },
            h('span', { className: `dy-dot ${summary.label === '一切正常' ? '' : 'warn'}`, 'aria-hidden': 'true' }),
            h('span', { className: 'dy-num' }, summary.label),
            h('span', { style: { flex: 1 } }),
            summary.tab && summary.label !== '一切正常' && button(summary.tab === '好友互动' ? '查看待答' : '去处理', 'statusGoto', () => setCategory(summary.tab))),
          h('p', { className: 'dy-note' }, summary.detail)),
        h('nav', { className: 'dy-nav', role: 'tablist', 'aria-label': '抖音设置分类', tabIndex: 0 }, ...Object.keys(fallbackCategories).map(name => h('button', { key: name, role: 'tab', type: 'button', 'aria-selected': category === name, onClick: () => setCategory(name) }, name))),
        category === '基础设置' && h('div', { className: 'dy-wrap' },
          dyCard(
            h('div', { className: 'dy-card-top' }, h('h3', null, '模型连接'), h('span', { className: 'sp' }), h('span', { className: `dy-chip ${state?.model?.configured ? 'ok' : 'err'}` }, h('span', { className: 'd', 'aria-hidden': 'true' }), state?.model?.configured ? '已配置' : '未配置')),
            h('div', { className: 'dy-row' },
              h('span', { className: 'dy-label' }, '提供商'),
              dySel({ 'aria-label': '模型提供商', value: model.draft.provider, disabled: !ready || operationActive, onChange: event => model.edit({ provider: event.target.value, model: '' }, { immediate: true }) }, [['', '请选择 DSH 提供商'], ...(state?.model?.providers || []).map(item => [item.id, item.name || item.id])]),
              h('span', { className: 'dy-label' }, '模型'),
              dySel({ 'aria-label': '模型名称', value: model.draft.model, disabled: !ready || operationActive, onChange: event => model.edit({ model: event.target.value }, { immediate: true }) }, [['', '请选择模型'], ...(state?.model?.models || []).filter(item => item.provider === model.draft.provider).map(item => [item.id, item.name || item.id])])),
            status(model),
            h('p', { className: 'dy-note' }, '选择已配置的 DSH 模型。配置后观看、回复、分享等自动能力按各自的开关运行。')
          ),
          dyCard(
            h('div', { className: 'dy-card-top' }, h('h3', null, '人格与兴趣'), h('span', { className: 'sp' }), persona.status.kind === 'error' && button('载入最新人格（替换草稿）', 'personaReload', () => { void perform('personaReload', async () => { const latest = await refresh(true); if (!latest?.persona?.revision) throw new Error('未读到最新人格，原草稿已保留。'); persona.edit({ content: latest.persona.manualText || '', expectedRevision: latest.persona.revision }, { blurOnly: true }); return latest.persona; }); })),
            h('textarea', { className: 'dy-textarea dy-big', 'aria-label': '大肥鱼人格正文', rows: 9, value: persona.draft.content, disabled: !ready || operationActive, onChange: event => persona.edit({ content: event.target.value }, { blurOnly: true }), onBlur: () => { void persona.flush(); } }),
            h('div', { className: 'dy-row' }, h('p', { className: 'dy-note', style: { margin: 0 } }, '离开输入框后保存。插件与软件共用人格，未保存草稿不会被轮询覆盖。'), h('span', { style: { flex: 1 } }), h('span', { className: 'dy-foot' }, `${[...persona.draft.content].length} 字`)),
            // 字数/token 预算条（方案 §三 + 预览稿）：2000 转黄、3000 转红，不阻断保存；token 为字符数估算。
            (() => { const chars = [...persona.draft.content].length, tone = chars > 3000 ? 'err' : chars > 2000 ? 'warn' : 'ok'; return h('div', { className: 'dy-inner' },
              h('div', { className: 'dy-row' }, h('span', { className: 'dy-label' }, '上下文预算'), h('span', { className: 'dy-strong' }, `${chars.toLocaleString('zh-CN')} / 2,000 字`), h('span', { className: 'sp' }), dyChip(tone, chars > 3000 ? '过长' : chars > 2000 ? '偏长' : '健康')),
              h('div', { style: { height: 6, borderRadius: 3, background: 'var(--dsw-alias-bg-layer-1)', overflow: 'hidden' } }, h('div', { style: { width: `${Math.min(100, Math.round(chars / 2000 * 100))}%`, height: '100%', borderRadius: 3, background: `var(--dsw-alias-state-${tone === 'ok' ? 'success' : tone === 'warn' ? 'warn' : 'error'}-primary)` } })),
              h('p', { className: 'dy-note', style: { margin: 0 } }, `约 ${Math.round(chars * 2 / 3).toLocaleString('zh-CN')} token。超过 2,000 字开始压缩回复质量（转黄），超过 3,000 字前端提示精简（转红），不阻断保存——内容去留由你决定。`)); })(),
            status(persona),
            h('div', { className: 'dy-inner' },
              h('div', { className: 'dy-row' }, h('span', { className: 'dy-label' }, '观察注入上下文'), dySwitch(state?.persona?.contextObservations !== false, { 'aria-label': '观察注入上下文', onClick: () => { void perform('contextObservations', () => api.request('/persona/context-observations', { enabled: state?.persona?.contextObservations === false })); } }), h('span', { style: { flex: 1 } }), h('span', { className: 'dy-cap' }, '默认开启')),
              h('p', { className: 'dy-note', style: { margin: 0 } }, '开启=最近的抖音作品观察与兴趣证据随人设进入模型上下文；关闭=只保留手编正文与兴趣要点，观察留在本机不喂给模型。')),
            h('p', { className: 'dy-note' }, state?.persona?.personaFolder)
          )
        ),
        category === '视频观看' && h('div', { className: 'dy-wrap' },
          dyCard(
            h('div', { className: 'dy-card-top' }, h('h3', null, '自主观看'), dySwitch(watchEnabled, { 'aria-label': '允许自动观看', onClick: () => { if (typeof state?.schedule?.policy?.enabled === 'boolean' && !busy.has('schedule')) void perform('schedule', () => api.request('/watch/schedule', { enabled: !watchEnabled })); } }),
              h('span', { style: { flex: 1 } }), h('span', { className: 'dy-foot' }, `今日 ${Math.floor((state?.video?.daily?.usedSeconds || 0) / 60)} 分钟 · 请求 ${state?.video?.daily?.requests || 0} 次`)),
            h('div', { className: 'dy-row' },
              button('开始自主观看', 'schedule', () => { void perform('schedule', () => api.request('/watch/schedule', { enabled: true })); }, typeof state?.schedule?.policy?.enabled !== 'boolean' || typeof state?.watch?.running !== 'boolean' || !state?.model?.configured || active(state?.watch) || state?.schedule?.busy),
              button('暂停观看', 'schedule', () => { void perform('schedule', () => api.request('/watch/schedule', { enabled: false })); }, typeof state?.schedule?.policy?.enabled !== 'boolean' || typeof state?.watch?.running !== 'boolean' || !watchEnabled && !active(state?.watch) && !state?.schedule?.busy),
              h('span', { className: 'sp' }), h('span', { className: 'dy-cap' }, '离开时段或用完每日预算会停止；时长与请求不因开关重置')),
            note(state?.video?.reason), note(state?.schedule?.lastError), state?.watch?.lastError && h('p', { role: 'status', className: 'dy-note' }, `上次自主观看停止原因：${state.watch.lastError}`)
          ),
          dyCard(
            h('div', { className: 'dy-card-top' }, h('h3', null, '观看时段'), h('span', { className: 'sp' }), h('span', { className: 'dy-foot' }, `周末${video.draft.weekendAll ? '全天允许' : '按工作日'}`)),
            h('div', { className: 'dy-row' },
              button('全天', 'all', () => video.edit({ windows: '00:00-24:00', weekendAll: false }, { immediate: true }), false, false, String(video.draft.windows).trim() === '00:00-24:00' && video.draft.weekendAll === false ? 'primary' : 'outline'),
              button('谷时段（DeepSeek）', 'valley', () => video.edit({ windows: '00:00-09:00\n12:00-14:00\n18:00-24:00', weekendAll: true }, { immediate: true }), false, false, String(video.draft.windows).trim() === '00:00-09:00\n12:00-14:00\n18:00-24:00' && video.draft.weekendAll === true ? 'primary' : 'outline'),
              button('晚间 20–22 点', 'evening', () => video.edit({ windows: '20:00-22:00', weekendAll: false }, { immediate: true }), false, false, String(video.draft.windows).trim() === '20:00-22:00' && video.draft.weekendAll === false ? 'primary' : 'outline')),
            h('div', { className: 'dy-row' }, h('span', { className: 'dy-label' }, '时段'), h('input', { className: 'dy-input', style: { width: 260, flex: 'none' }, 'aria-label': '每日允许视频时段', value: video.draft.windows, disabled: !ready, onChange: event => video.edit({ windows: event.target.value }), onBlur: () => { void video.flush(); } }), h('span', { className: 'dy-cap' }, '可多段，斜杠或空格分隔，如 09:00-12:00 / 14:00-18:00')),
            h('div', { className: 'dy-row' }, h('span', { className: 'dy-label' }, '周末全天'), dySwitch(video.draft.weekendAll, { 'aria-label': '周末全天允许', onClick: () => video.edit({ weekendAll: !video.draft.weekendAll }, { immediate: true }) })),
            h('div', { className: 'dy-row' },
              h('span', { className: 'dy-label' }, '每日观看上限'), h('input', { className: 'dy-input', style: { width: 90, flex: 'none' }, type: 'number', min: 1, 'aria-label': '每日观看上限（分钟）', value: video.draft.unlimitedMinutes ? '' : video.draft.dailyMinutes, placeholder: video.draft.unlimitedMinutes ? '不限' : '分钟数', disabled: !ready, onChange: event => video.edit({ dailyMinutes: event.target.value, ...(event.target.value !== '' ? { unlimitedMinutes: false } : {}) }) }), h('span', { className: 'dy-cap' }, `分钟${video.draft.unlimitedMinutes ? '（不限）' : ''}`),
              h('span', { className: 'dy-label' }, '模型请求'), h('input', { className: 'dy-input', style: { width: 90, flex: 'none' }, type: 'number', min: 1, 'aria-label': '每日观看模型请求上限', value: video.draft.unlimitedRequests ? '' : video.draft.dailyRequests, placeholder: video.draft.unlimitedRequests ? '不限' : '次数', disabled: !ready, onChange: event => video.edit({ dailyRequests: event.target.value, ...(event.target.value !== '' ? { unlimitedRequests: false } : {}) }) }), h('span', { className: 'dy-cap' }, `次${video.draft.unlimitedRequests ? '（不限）' : ''}`)),
            toggle('不限每日观看时长', video.draft.unlimitedMinutes, value => video.edit({ unlimitedMinutes: value }, { immediate: true })),
            toggle('不限每日模型请求次数', video.draft.unlimitedRequests, value => video.edit({ unlimitedRequests: value }, { immediate: true })),
            status(video)
          ),
          dyCard(
            h('div', { className: 'dy-card-top' }, h('h3', null, '观看主题'), h('span', { className: 'sp' }), h('span', { className: `dy-chip ${topics.draft.mode === 'topic' ? 'info' : 'ok'}` }, h('span', { className: 'd', 'aria-hidden': 'true' }), topics.draft.mode === 'topic' ? '围绕指定主题' : '自主挑选推荐')),
            h('div', { className: 'dy-row' }, h('span', { className: 'dy-label' }, '观看方式'), dySel({ 'aria-label': '观看方式', value: topics.draft.mode, onChange: event => topics.edit({ mode: event.target.value }, { immediate: true }) }, [['recommend', '自主挑选推荐'], ['topic', '围绕指定主题观看']])),
            h('div', { className: 'dy-row' }, h('span', { className: 'dy-label' }, '主题'), h('input', { className: 'dy-input', style: { flex: 1, minWidth: 200 }, 'aria-label': '想看的主题', value: topics.draft.topics, disabled: !ready, onChange: event => topics.edit({ topics: event.target.value }), onBlur: () => { void topics.flush(); } })),
            h('div', { className: 'dy-row' }, h('span', { className: 'dy-label' }, '排除'), h('input', { className: 'dy-input', style: { flex: 1, minWidth: 200 }, 'aria-label': '排除关键词', value: topics.draft.exclude, disabled: !ready, onChange: event => topics.edit({ exclude: event.target.value }), onBlur: () => { void topics.flush(); } })),
            h('p', { className: 'dy-note' }, '主题之间用斜杠或空格分隔（也可逗号、换行），不按行占位。只推荐与主题相关的视频，找不到时回落推荐流。'),
            status(topics)
          ),
          dyCard(
            h('div', { className: 'dy-card-top' }, h('h3', null, '静默观看'), dySwitch(mode.draft.silent, { 'aria-label': '静默观看', onClick: () => mode.edit({ silent: !mode.draft.silent }, { immediate: true }) })),
            h('p', { className: 'dy-note' }, '静音播放，核实窗口归属后尝试最小化；仍使用有窗口 Edge。'), status(mode), note(state?.mode?.application?.message || state?.mode?.note)
          )
        ),
        category === '好友互动' && h('div', { className: 'dy-wrap' },
          dyCard(
            h('div', { className: 'dy-card-top' }, h('h3', null, '好友互动'), dySwitch(friendEnabled, { 'aria-label': '允许好友互动', onClick: () => { if (typeof state?.interactions?.policy?.enabled === 'boolean' && !busy.has('interactions')) void perform('interactions', () => api.request('/interactions/configure', { enabled: !friendEnabled })); } }), h('span', { className: 'dy-cap' }, '默认关闭')),
            h('p', { className: 'dy-note' }, '只与下方许可的好友和群聊互动，不设人数和次数上限。模型和名单就绪后自动准备回复；观看中可自主分享。群聊仅在被 @ 或叫到响应昵称时回复。'),
            note(state?.interactions?.friend?.message),
            state?.interactions?.friend?.lastError && h('p', { role: 'alert' }, state.interactions.friend.lastError),
            state?.interactions?.friend?.waitReason && note(`${state.interactions.friend.preparing ? '正在准备：' : '等待准备：'}${state.interactions.friend.waitReason}${state.interactions.friend.lastErrorCode ? `（${state.interactions.friend.lastErrorCode}）` : ''}${state.interactions.friend.nextRetryAt ? ` · 下次自动检查 ${new Date(state.interactions.friend.nextRetryAt).toLocaleString('zh-CN', { hour12: false })}` : ''}`),
            state?.interactions?.friend?.waitReason && h('div', { className: 'dy-row' }, h('button', { type: 'button', className: 'dy-btn', disabled: !ready || busy.has('chatPrepare') || state.interactions.friend.canPrepare === false, onClick: () => { void perform('chatPrepare', () => api.request('/chat/prepare', {})); } }, busy.has('chatPrepare') || state.interactions.friend.preparing ? '正在准备…' : '准备回复通道/重新连接并重试')),
            status(chat)
          ),
          dyCard(
            h('div', { className: 'dy-card-top' }, h('h3', null, '许可名单'), h('span', { className: 'sp' }), button('读取联系人与群聊', 'chatList', () => { void perform('chatList', async () => { const result = await api.request('/chat/contacts', {}); if (result.blocked || result.loginRequired || result.verificationRequired || !Array.isArray(result.contacts)) throw new Error('请在专用浏览器完成登录或验证。'); setContacts(result.contacts); setDiscovery(result.listDiscovery || null); return result; }); }, chat.status.kind === 'saving')),
            note('读取范围是抖音网页版当前会话，不代表全部关注好友或所有群。要授权群聊，请先让群会话出现在抖音消息列表，再刷新。'),
            contacts && note(`本次读取：个人 ${contacts.filter(item => item.isGroup === false).length} 个 · 群聊 ${contacts.filter(item => item.isGroup === true).length} 个。${discovery?.scannedToEnd === false ? ` 当前列表尚未完整读取。${discovery.reason || ''}` : ''}`),
            contacts?.some(item => item.relationshipStatus === 'unavailable' || item.isGroup === true || typeof item.isGroup !== 'boolean') && toggle('授权已核对的现有会话', chat.draft.allowConversationOnly, value => { existingAuthorization.current = value; chat.edit({ allowConversationOnly: value, ...(!value ? { recipientIds: chat.draft.recipientIds.filter(id => shownContacts.some(item => item.id === id && item.followed === true && item.isGroup === false)) } : {}) }, value ? { blurOnly: true } : { immediate: true }); }),
            ...[false, true, null].flatMap(kind => { const items = shownContacts.filter(item => item.isGroup === kind || kind === null && typeof item.isGroup !== 'boolean'); return items.length ? [note(kind === false ? '个人会话' : kind === true ? '群聊（仅被 @ 或叫到响应昵称时回复）' : '旧记录类型待核对（暂不可选）'), ...items.map(item => h('label', { key: item.id, style: row }, h('input', { type: 'checkbox', 'aria-label': `许可联系人 ${item.name || item.displayName || '联系人'}`, checked: chat.draft.recipientIds.includes(item.id), disabled: !ready || !chat.draft.recipientIds.includes(item.id) && (item.notListed || !(item.followed === true && item.isGroup === false || chat.draft.allowConversationOnly === true && typeof item.isGroup === 'boolean')), onChange: event => chat.edit({ recipientIds: event.target.checked ? [...chat.draft.recipientIds, item.id] : chat.draft.recipientIds.filter(id => id !== item.id) }, { immediate: true }) }), item.name || item.displayName || '许可会话'))] : []; }),
            h('div', { className: 'dy-row' }, h('span', { className: 'dy-label' }, '群聊响应昵称'), h('input', { className: 'dy-input', style: { flex: 1, minWidth: 200 }, 'aria-label': '群聊响应昵称（逗号或换行分隔）', value: chat.draft.groupMentionNamesText, disabled: !ready, onChange: event => chat.edit({ groupMentionNamesText: event.target.value }, { blurOnly: true }), onBlur: () => { void chat.flush(); } })),
            note(`今日回复模型请求 ${state?.chat?.daily?.requests || 0} 次 · 今日分享 ${state?.share?.daily?.attempts || 0} 次。未确认发送会暂停，不自动重发。`),
            ...(state?.chat?.contacts || []).filter(item => item.identityReviewRequired === true || item.recovery?.requiresUserAction === true || /登录|验证码|未授权|许可.*(?:不足|失效|撤销)|身份.*(?:变化|不一致|未通过|不明|不足)/.test(item.reason || '') || ['paused', 'delivery-uncertain'].includes(item.status) && !(item.recovery?.autoPendingCount > 0 || item.recovery?.autoRetryCount > 0)).map(item => h('div', { key: item.id }, note(item.reason || '该会话暂缓处理，状态会继续更新。'), item.identityReviewRequired === true && note('请重新读取联系人并确认许可名单；身份未通过前不会发送。'))),
            ...(state?.share?.unavailableRecipients || []).map(item => note(`暂不能自主分享：${item.name || '许可会话'} · ${item.reason}`)),
            ...reviewList('share')
          ),
          ...unansweredView,
          h('details', { className: 'dy-inner' }, h('summary', null, '回复处理记录'), h('div', { className: 'dy-wrap' },
            (() => { const r = state?.chat?.recovery; if (!r) return null; return dyKv('恢复队列', `自动恢复中 ${r.autoPendingCount || 0} · 等待人工 ${r.pendingManualCount || 0} · 可自动恢复 ${r.recoverableCount || 0}${r.requiresUserAction ? ' · 有会话需要你处理' : ''}`); })(),
            ...(state?.chat?.contacts || []).slice(0, 12).map(item => dyKv(item.name || state?.chat?.policy?.allowlist?.find(c => c.id === item.id)?.name || '许可会话', `${({ ready: '正常接收', paused: '已暂停', 'delivery-uncertain': '发送结果待核对' }[item.status]) || item.status || '状态未知'} · 待答 ${(item.unanswered?.length) || 0} 条${item.lastCheckedAt ? ` · 检查 ${new Date(item.lastCheckedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : ''}${item.reason ? ` · ${item.reason}` : ''}`)),
            ...(state?.chat?.events || []).slice(-12).reverse().map((event, index) => dyRow(event.at ? new Date(event.at).toLocaleTimeString('zh-CN', { hour12: false }) : '', event.message || event.type || '运行事件')),
            !(state?.chat?.contacts || []).length && !(state?.chat?.events || []).length && h('p', { className: 'dy-note' }, '暂无处理记录；启动自动回复后会在这里显示每个会话的处理情况。'),
            h('details', { className: 'dy-inner' }, h('summary', null, '复制原始数据（排查用，界面不展示）'), h('div', null,
              h('p', { className: 'dy-note' }, '点下面按钮把完整运行数据复制到剪贴板，粘给排查工具或 Agent 用。'),
              h('div', { className: 'dy-row' }, button('复制原始数据', 'copyChatDebug', () => { copyData(() => JSON.stringify({ recovery: state?.chat?.recovery, contacts: state?.chat?.contacts, events: state?.chat?.events }, null, 2)); })))))),
          h('details', { className: 'dy-inner' }, h('summary', null, '最近分享记录'), ...(state?.share?.recent || []).slice().reverse().map(item => dyRow(item.videoId ? `作品 ${item.videoId}` : '消息', `${state?.share?.inProgress && state.share.activity?.operationId === item.operationId ? '正在分享' : ({ confirmed: '已确认送达', 'not-sent': '未发出', uncertain: '送达未确认', reserved: '已预留，待核对', clicking: '处理中，待核对', 'resolved-confirmed': '人工已确认送达', 'resolved-not-sent': '人工已确认未送达' }[item.status] || item.status)}${shareFailureMessage(item) ? ` · 原因：${shareFailureMessage(item)}` : ''}`)))
        ),
        // 观看足迹（吞噬新增）：读取 /watched 聚合，按日分组卡片墙；点击在专用浏览器打开原作品。
        category === '观看足迹' && h('div', { className: 'dy-wrap' },
          h('div', { className: 'dy-card' },
            h('div', { className: 'dy-card-top' }, h('h3', null, '观看足迹'), h('span', { className: 'sp' }),
              dySel({ 'aria-label': '足迹范围', value: watchedDays, onChange: event => setWatchedDays(event.target.value) }, [['14', '最近 14 天'], ['30', '最近 30 天']]),
              button('刷新足迹', 'watched', () => { void loadWatched(); })),
            watched ? h('p', { className: 'dy-note' }, `共 ${watched.total} 条已看记录${watched.generatedAt ? ` · 更新于 ${new Date(watched.generatedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : ''}。封面缓存尚未接入，缩略图暂显示占位；点击卡片在专用浏览器打开原作品。`) : h('p', { className: 'dy-note' }, '正在读取观看足迹…'),
            watchedError && h('p', { role: 'alert', className: 'dy-note', style: { color: 'var(--dsw-alias-state-error-primary,#dc2626)' } }, watchedError)),
          watched && !watched.groups.length && dyCard(h3Card('还没有观看记录'), h('p', { className: 'dy-note' }, '开启自主观看后，看过的作品会按日期出现在这里。')),
          watched && !!watched.groups.length && h('div', { className: 'dy-wall' }, ...watched.groups.map(group => h('div', { key: group.day },
            h('div', { className: 'dy-dayhead' }, h('b', null, group.day), h('span', { className: 'dy-cap' }, `${group.count} 条`), h('span', { className: 'ln' })),
            h('div', { className: 'dy-grid' }, ...group.items.map(item => h('a', { key: item.videoId + item.at, className: 'dy-vitem', href: item.url || '#', onClick: event => { event.preventDefault(); if (item.url) void perform('browser', () => api.request('/browser/navigate', { url: item.url })); } },
              h(ThumbImg, { api, videoId: item.videoId }),
              h('div', { className: 'dy-vbody' }, h('div', { className: 'dy-vt' }, item.title), h('div', { className: 'dy-vn' }, `${item.tier}${item.watchedSeconds ? ` · ${item.watchedSeconds} 秒` : ''} · ${new Date(item.at).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })}`)))))))),
          watched && !!watched.groups.length && h('p', { className: 'dy-note' }, '分层来自实际观看行为：转发 > 停留观看 > 短暂停留 / 跳过；「跳过·超过 60 分钟」类长视频保留跳过标记。')),
        // 记忆管理（吞噬新增）：走宿主 memory.* RPC（与参考项目同构）；本端只读浏览，清理入口后续按需接入 memory.forget。
        category === '记忆管理' && h('div', { className: 'dy-wrap' },
          h('div', { className: 'dy-card' },
            h('div', { className: 'dy-card-top' }, h('h3', null, '记忆管理'), h('span', { className: 'sp' }),
              state?.persona?.personaFolder && button('打开抖音', 'openMemory', () => { try { void api.request('/browser/open', {}); } catch {} }), h('span', { className: 'dy-cap' }, '记忆文件在抖音页面旁的本机目录'),
              h('div', { className: 'dy-mtabs', role: 'tablist', 'aria-label': '记忆分区' },
                ...[['character', '角色卡'], ['interests', '兴趣'], ['observations', '最近观察'], ['raw', '原始记录']].map(([key, label]) => h('button', { key, className: 'dy-mtab', role: 'tab', type: 'button', 'aria-selected': memTab === key, onClick: () => setMemTab(key) }, label)))),
            memTab === 'character' && h('div', { className: 'dy-inner' },
              h('p', { className: 'dy-note' }, '角色卡在「基础设置 → 人格与兴趣」编辑；这里展示记忆侧的自动生成段（agentInterests 的机器可读层），修改仍以人格卡为准。'),
              ...(state?.persona?.interests || []).slice(0, 12).map(item => dyRow(item.topic, `${({ like: '感兴趣', dislike: '不感兴趣', neutral: '待观察' })[item.signal] || item.signal} · ${item.basis || ''}`)),
              !(state?.persona?.interests || []).length && h('p', { className: 'dy-note' }, '暂无兴趣记忆；观看并互动后会自动整理。')),
            memTab === 'interests' && h('div', { className: 'dy-tl' },
              ...(state?.persona?.interests || []).map(item => { const kindClass = item.signal === 'like' ? 'fact' : item.signal === 'dislike' ? 'mention' : 'pref'; return h('div', { key: item.topic, className: 'dy-tl-item' }, h('span', { className: `dy-tl-bar ${kindClass}`, 'aria-hidden': 'true' }), h('span', { className: 'dy-tl-text' }, `${({ like: '感兴趣：', dislike: '不感兴趣：', neutral: '待观察：' })[item.signal] || ''}${item.topic} · 正向 ${item.counts?.like ?? 0} / 负向 ${item.counts?.dislike ?? 0} / 待观察 ${item.counts?.neutral ?? 0}`), h('span', { className: 'dy-tl-meta' }, item.privacy === 'internal-reference' ? '内部参考' : '')); }),
              !(state?.persona?.interests || []).length && h('p', { className: 'dy-note' }, '暂无记录。')),
            memTab === 'observations' && h('div', { className: 'dy-tl' },
              ...(state?.persona?.recentObservations || []).slice(-12).reverse().map(item => dyRow(item.observedAt ? new Date(item.observedAt).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '', `${item.title || '无文案作品'}${item.author ? ` · @${item.author}` : ''}`)),
              !(state?.persona?.recentObservations || []).length && h('p', { className: 'dy-note' }, '暂无观察记录。')),
            memTab === 'raw' && h('div', { className: 'dy-inner' },
              h('p', { className: 'dy-note' }, `记忆文件夹：${state?.persona?.personaFolder || '读取中…'}`),
              h('div', { className: 'dy-row' }, button('复制记忆快照', 'copyMemory', () => { copyData(() => JSON.stringify({ interests: state?.persona?.interests, recentObservations: state?.persona?.recentObservations }, null, 2)); })),
              h('div', { className: 'dy-row' }, h('span', { className: 'dy-label' }, '搜索记忆'), h('input', { className: 'dy-input', style: { flex: 1, minWidth: 160 }, 'aria-label': '记忆搜索关键词', value: memoryQuery, placeholder: '文案 / 作者 / 作品编号', disabled: !ready, onChange: event => setMemoryQuery(event.target.value), onKeyDown: event => { if (event.key === 'Enter') void perform('memorySearch', () => api.request('/memory/search', { query: memoryQuery }).then(value => { setMemoryResults(value); return value; })); } }), button('搜索', 'memorySearch', () => { void perform('memorySearch', () => api.request('/memory/search', { query: memoryQuery }).then(value => { setMemoryResults(value); return value; })); })),
              ...(memoryResults?.items || []).map(item => h('div', { key: item.evidenceId, className: 'dy-row' },
                h('span', { className: 'dy-note', style: { flex: 1, minWidth: 0 } }, `${item.title}${item.author ? ` · @${item.author}` : ''} · ${item.tier}`),
                memoryConfirm === item.evidenceId ? h('button', { type: 'button', className: 'dy-btn primary', disabled: busy.has('memoryForget'), onClick: () => { setMemoryConfirm(''); void perform('memoryForget', async () => { const result = await api.request('/memory/forget', { evidenceId: item.evidenceId }); setMemoryResults(old => old ? { ...old, items: old.items.filter(row => row.evidenceId !== item.evidenceId) } : old); void refresh(true); return result; }); } }, '确认删除') : h('button', { type: 'button', className: 'dy-btn', disabled: busy.has('memoryForget'), onClick: () => setMemoryConfirm(item.evidenceId) }, '删除'))),
              memoryResults && !memoryResults.items.length && h('p', { className: 'dy-note' }, '没有匹配的记忆记录。'),
              memoryConfirm && h('p', { className: 'dy-note' }, '再点一次「确认删除」才会执行；删除前自动写快照到 forget-snapshots。'),
              h('p', { className: 'dy-note' }, '删除会级联清理该作品关联的兴趣证据与观看/互动样本，并同步人格卡生成区；快照保留在记忆文件夹里可查。')))),
        category === '公开评论' && h('div', { className: 'dy-wrap' },
          dyCard(
            h('div', { className: 'dy-card-top' }, h('h3', null, '公开评论'), dySwitch(comments.draft.enabled, { 'aria-label': '允许自主发布评论', onClick: () => comments.edit({ enabled: !comments.draft.enabled }, { immediate: true }) }), h('span', { className: 'dy-cap' }, '默认关闭')),
            h('div', { className: 'dy-row' }, h('span', { className: 'dy-label' }, '每日尝试'), h('input', { className: 'dy-input', style: { width: 70, flex: 'none' }, type: 'number', min: 1, 'aria-label': '评论每日尝试上限', value: comments.draft.dailyLimit, disabled: !ready, onChange: event => comments.edit({ dailyLimit: event.target.value }) }), h('span', { className: 'dy-cap' }, '次'),
              h('span', { className: 'dy-label' }, '每次观看'), h('input', { className: 'dy-input', style: { width: 70, flex: 'none' }, type: 'number', min: 1, 'aria-label': '评论每次观看尝试上限', value: comments.draft.perSessionLimit, disabled: !ready, onChange: event => comments.edit({ perSessionLimit: event.target.value }) }), h('span', { className: 'dy-cap' }, '次')),
            status(comments), h('p', { className: 'dy-note' }, `今日已尝试 ${state?.comments?.daily?.attempts || 0} 次。开启后按实际观察决定是否评论；不使用人格原文、私信或 QQ 内容。`),
            (state?.comments?.needsReview || []).length ? h('div', { className: 'dy-inner' }, h('h3', { style: { margin: 0, fontSize: 13, fontWeight: 600 } }, '待核对评论'), ...reviewList('comments')) : [])
        ),
        category === '音频与密钥' && h('div', { className: 'dy-wrap' },
          dyCard(
            h('div', { className: 'dy-card-top' }, h('h3', null, '音频理解'), dySwitch(media.draft.enabled, { 'aria-label': '读取视频声音', onClick: () => media.edit({ enabled: !media.draft.enabled }, { immediate: true }) }), h('span', { className: 'dy-cap' }, '关闭时密钥区收起')),
            h('div', { className: 'dy-row' }, h('span', { className: 'dy-label' }, '后端'), dySel({ 'aria-label': '音频后端', value: media.draft.backend, onChange: event => media.edit({ backend: event.target.value }, { immediate: true }) }, [['local-whisper', '本机 Whisper'], ['mimo', 'MiMo'], ['minimax', 'MiniMax']]), h('span', { className: 'sp' }), h('span', { className: 'dy-cap' }, 'Key 密文保存在本机，不回显')),
            status(media),
            media.draft.backend !== 'local-whisper' && credentialForm(media.draft.backend === 'mimo' ? 'mimo' : 'minimax', media.draft.backend === 'mimo' ? 'MiMo' : 'MiniMax'),
            h('p', { className: 'dy-note' }, '保存 Key 不会开启音频或下载模型。')),
        ),
        category === '观看日报' && h('div', { className: 'dy-wrap' },
          dyCard(
            h('div', { className: 'dy-card-top' }, h('h3', null, '观看日报'), h('span', { className: 'sp' }), button('生成今天日报', 'reportGenerate', () => { void perform('reportGenerate', async () => { const value = await api.request('/reports/generate', {}); setReport(value); return value; }); })),
            h('div', { className: 'dy-row' }, h('span', { className: 'dy-label' }, '日报日期'), h('input', { className: 'dy-input', type: 'date', style: { width: 150, flex: 'none' }, 'aria-label': '日报日期', value: reportDate, onChange: event => setReportDate(event.target.value) }), button('读取所选日报', 'reportRead', () => { void perform('reportRead', async () => { if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) throw new Error('请选择有效日期。'); const value = await api.request(`/reports/read?date=${reportDate}`); setReport(value); return value; }); }), h('span', { className: 'sp' }), h('span', { className: 'dy-cap' }, '正文见下方')),
            h('p', { className: 'dy-note' }, state?.reports?.folder),
            report && h('div', { className: 'dy-inner', 'aria-label': '日报内容' }, MarkdownText
              ? h(MarkdownText, { text: report.markdown || '暂无内容', labels: markdownLabels })
              : h('p', { className: 'dy-note', style: { whiteSpace: 'pre-wrap', margin: 0 } }, report.markdown || '暂无内容')))
        ),
        category === '自检与用量' && h('div', { className: 'dy-wrap' },
          dyCard(
            h('div', { className: 'dy-card-top' }, h('h3', null, '自检'), h('span', { className: 'sp' }), button('一键自检', 'diagnostics', () => { void perform('diagnostics', async () => { const value = await api.request('/diagnostics', {}); setDiagnostics(value); setRepairResult(''); return value; }); }), button('复制完整报告', 'copyDiagnostics', () => { copyData(() => JSON.stringify(diagnostics, null, 2)); })),
            h('p', { className: 'dy-note' }, '完整报告（含原始数据）只进剪贴板，不在界面铺开。'),
            diagnostics && h('div', { className: 'dy-inner' },
              ...((diagnostics.checks || []).map(item => h('div', { key: item.id, className: 'dy-row' },
                h('span', { className: `dy-chip ${item.status === 'pass' ? 'ok' : item.status === 'warning' ? 'warn' : 'err'}` }, h('span', { className: 'd', 'aria-hidden': 'true' }), item.label),
                h('span', { style: { flex: 1 } }),
                h('span', { className: 'dy-cap' }, `${item.message}${item.code ? `（${item.code}）` : ''}`)))),
              ...(item => (item?.resolution?.steps || []).length ? [h('p', { className: 'dy-note' }, item.resolution.steps.join('；'))] : [])((diagnostics.checks || []).find(item => item.status === 'fail')),
              ...(diagnostics.repairableActions || []).map(action => button(`修复：${action.label}`, 'diagnostics', () => { void perform('diagnostics', async () => { const value = await api.request('/diagnostics/repair', { reportId: diagnostics.reportId, action: action.id }); setDiagnostics(value.after); setRepairResult(value.message); return value; }); })),
              repairResult && h('p', { className: 'dy-note' }, repairResult),
              h('p', { className: 'dy-note' }, diagnostics?.note || '')),
          dyCard(
            h('div', { className: 'dy-card-top' }, h('h3', null, '最近前端错误'), h('span', { className: 'sp' }), button('清空', 'clearErrors', () => { try { globalThis.sessionStorage?.setItem('douyin-panel-errors', '[]'); } catch {} setPanelErrorsTick(x => x + 1); }), h('span', { className: 'dy-cap' }, '本地环形缓存 · 最近 20 条')),
            ...((() => { try { return JSON.parse(globalThis.sessionStorage?.getItem('douyin-panel-errors') || '[]'); } catch { return []; } })()).slice(0, 8).map((err, index) => dyRow(err.at ? new Date(err.at).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '', err.message)),
            !(() => { try { return JSON.parse(globalThis.sessionStorage?.getItem('douyin-panel-errors') || '[]').length; } catch { return 0; } })() && h('p', { className: 'dy-note' }, '暂无前端错误记录。')),
          dyCard(
            h('div', { className: 'dy-card-top' }, h('h3', null, '今日用量'), h('span', { className: 'sp' }), h('span', { className: 'dy-foot' }, state?.usage?.today?.date || '')),
            h('div', { className: 'dy-stat2' },
              h('div', { className: 'dy-stat' }, h('div', { className: 'v' }, String(state?.usage?.today?.requests || 0)), h('div', { className: 'k' }, '模型响应（次）')),
              h('div', { className: 'dy-stat' }, h('div', { className: 'v' }, String(state?.usage?.today?.totalTokens || 0)), h('div', { className: 'k' }, 'Token')),
              h('div', { className: 'dy-stat' }, h('div', { className: 'v' }, `${Math.floor((state?.video?.daily?.usedSeconds || 0) / 60)} / ${state?.video?.policy?.dailyMinutes ?? '∞'}`), h('div', { className: 'k' }, '观看分钟')),
              h('div', { className: 'dy-stat' }, h('div', { className: 'v' }, `${state?.video?.daily?.requests || 0} / ${state?.video?.policy?.dailyRequests ?? '∞'}`), h('div', { className: 'k' }, '模型请求'))),
            h('p', { className: 'dy-note' }, `输入 ${state?.usage?.today?.promptTokens || 0} · 输出 ${state?.usage?.today?.completionTokens || 0} · 缓存命中 ${state?.usage?.today?.cacheReportedRequests ? state.usage.today.cachedTokens : '未报告'} · 用量未知 ${state?.usage?.today?.unknownRequests || 0} 次。未报告的用量标为未知，不能据此当作零消耗。`),
            state?.usage?.inFlight > 0 && h('p', { className: 'dy-note' }, `请求中 ${state.usage.inFlight} 次，Token 等模型返回后记录。`),
            ...(state?.usage?.groups || []).map(item => dyRow(item.model, `${item.requests} 次响应 · ${item.totalTokens} Token`)),
            note(state?.usage?.note))))
      );
    }

    function apply(ctx) {
      let rpc;
      try { rpc = (ctx.get?.('connection') || ctx.connection)?.rpc; } catch {}
      const Page = rpc ? () => h(SettingsPage, { rpc }) : SettingsPage;
      ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'douyin-browser', order: 16, label: () => '刷抖音' }, Page));
    }
    return { name: 'douyin-browser-settings', inject: ['slots', 'connection'], apply, SettingsPage, createSettingsTransport };
  },
});
