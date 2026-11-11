window.__ModuleLoader__.load({
  id: 'dsh-douyin-browser-local',
  factory: require => {
    const React = require('react');
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    const { createElement: h, useEffect, useRef, useState } = React;
    const Button = primitives.Button, Input = primitives.Input || 'input', MarkdownText = primitives.MarkdownText;
    const markdownLabels = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '脚注' };
    const PREFIX = '/api/douyin-browser';
    const routes = new Set(['/interactions/configure', '/state', '/diagnostics', '/diagnostics/repair', '/watch/schedule', '/watch/options', '/video/configure', '/video/start', '/video/stop', '/browser/open', '/browser/navigate', '/persona/configure', '/persona/context-observations', '/persona/interest/forget', '/memory/search', '/memory/forget', '/model/configure', '/mode/configure', '/watch/start', '/watch/stop', '/spark/configure', '/spark/start', '/spark/stop', '/spark/resolve', '/comments/configure', '/comments/resolve', '/share/configure', '/share/resolve', '/chat/contacts', '/chat/configure', '/chat/start', '/chat/stop', '/chat/prepare', '/chat/resolve', '/chat/unanswered', '/chat/unanswered/resolve', '/chat/unanswered/end', '/chat/unanswered/retry', '/media/configure', '/media/credentials', '/reports/generate', '/watched', '/thumb']);
    const column = { display: 'flex', flexDirection: 'column', gap: 12 };
    const row = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' };
    // 导航胶囊窄面板折行显示（用户裁决 2026-11-09：被右缘截掉不如断行），旧单行滚动方案废弃。
    const tabRow = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', overflowX: 'auto', scrollbarWidth: 'thin', paddingBottom: 2 };
    const tab = { flex: 'none', whiteSpace: 'nowrap' };
    const muted = { color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, margin: 0 };
    const formControl = { font: 'inherit', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-base)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: 9, maxWidth: '100%', width: '100%', boxSizing: 'border-box' };
    const videoPolicyKey = policy => policy && JSON.stringify([Array.isArray(policy.windows) ? [...new Set(policy.windows)] : null, policy.weekendWindows || null, policy.sessionMinutes]);
    const fallbackCategories = { '基础设置': ['人格与兴趣', 'DSH 模型'], '视频观看': ['观看主题', '视频时间与自主观看'], '自检与用量': ['自检与用量'], '好友互动': ['好友互动'], '观看足迹': ['观看足迹'], '记忆管理': ['记忆管理'], '公开评论': ['自主公开视频评论'], '音频与密钥': ['可选音频'], '观看日报': ['观看日报'], '分享记录': ['分享记录'] };
    // 用量分组按 kind 区分场景，同一模型会拆成多行；补中文标签才看得出三行同名分别是什么。
    const USAGE_KIND_LABELS = { watch: '自主观看', chat: '好友回复', comment: '公开评论', spark: '火花', task: '任务' };
    // 面板样式：class 体系 + 单 <style> 注入（与 dsh-plugin-wallpaper-engine / dsh-qq-tts 同模式）。
    // CSS 与 docs/mockups/panel-redesign-v6.html 预览稿逐字一致（v6.2 已获用户批准）；实装用 dsw-alias 令牌，深色主题自动适配。
    const PANEL_CSS = `
.dy-wrap{display:flex;flex-direction:column;gap:12px;min-width:0}
/* 派生描边色必须声明在 body 上：宿主的 --dsw-alias-* 令牌声明在 body 作用域，
   若把派生变量放在 :root，color-mix 在 :root 求值时取不到 dsw-alias 令牌，
   派生变量变成空值，随后 border 简写整条失效（计算值 0px none），控件就成了没有边框的裸元素。 */
body{--dy-surface:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,var(--dsw-alias-bg-base));
  --dy-stroke:color-mix(in srgb,var(--dsw-alias-label-primary) 16%,transparent);
  --dy-stroke-strong:color-mix(in srgb,var(--dsw-alias-label-primary) 30%,transparent)}
.dy-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dy-head h2{margin:0;font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dy-head .sp{flex:1}
.dy-statusline{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:4px 2px 12px;min-width:0}
.dy-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-success-primary);flex:none}
.dy-dot.warn{background:var(--dsw-alias-state-warn-primary)}
.dy-dot.err{background:var(--dsw-alias-state-error-primary)}
.dy-dot.idle{background:var(--dsw-alias-label-tertiary)}
.dy-num{font-size:13px;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}
.dy-cap{font-size:11.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dy-foot{font-size:11.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}
.dy-note{font-size:11.5px;line-height:1.45;color:var(--dsw-alias-label-tertiary);margin:0;overflow-wrap:anywhere}
.dy-strong{color:var(--dsw-alias-label-primary);font-weight:600}
.dy-sep{width:1px;height:14px;background:var(--dsw-alias-border-l2);flex:none}
.dy-sp{flex:1;min-width:4px}
.dy-btn{font:inherit;font-size:12.5px;font-weight:500;line-height:1.2;padding:5px 13px;border-radius:999px;
  border:1px solid var(--dy-stroke-strong);background:var(--dy-surface);color:var(--dsw-alias-label-primary);
  box-shadow:0 1px 1px color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);
  cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:4px;flex:none;
  transition:background .12s ease,border-color .12s ease,box-shadow .12s ease}
.dy-btn:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-label-primary) 38%,transparent)}
.dy-btn:active:not(:disabled){box-shadow:none;transform:translateY(.5px)}
.dy-btn.primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-label-primary-foreground);font-weight:600;box-shadow:0 1px 2px color-mix(in srgb,var(--dsw-alias-label-primary) 22%,transparent)}
.dy-btn.primary:hover:not(:disabled){opacity:.92}
.dy-btn.danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);background:transparent}
.dy-btn.danger:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}
.dy-btn.tiny{font-size:11.5px;padding:3px 10px;border-radius:999px}
.dy-btn:disabled{opacity:.45;cursor:default;box-shadow:none}
.dy-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:500;
  white-space:nowrap;flex:none;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent)}
.dy-chip .d{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.dy-chip.ok{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent)}
.dy-chip.warn{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 15%,transparent)}
.dy-chip.err{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent)}
.dy-chip.info{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent)}
.dy-chip.violet{color:var(--dsw-alias-label-secondary)}
.status-top-box{background:var(--dy-surface);border:.5px solid var(--dy-stroke);border-radius:12px;padding:10px 16px;display:flex;flex-direction:column;gap:8px}
.dy-summary{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-bottom:8px;border-bottom:.5px solid var(--dy-stroke)}
.dy-summary:last-child{padding-bottom:0;border-bottom:none}
.dy-summary .dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-warn-primary);flex:none}
.dy-summary .dot.bad{background:var(--dsw-alias-state-error-primary)}
.dy-summary .dot.good{background:var(--dsw-alias-state-success-primary)}
.dy-summary .lb{font-size:13px;font-weight:600;flex:none;color:var(--dsw-alias-label-primary)}
.dy-summary .dt{font-size:12px;color:var(--dsw-alias-label-secondary);flex:1;min-width:160px;overflow-wrap:anywhere}
.dy-stat2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.dy-stat{background:var(--dsw-alias-bg-base);border:.5px solid var(--dy-stroke);border-radius:10px;padding:8px 12px;display:flex;flex-direction:column;gap:2px;min-width:0}
.dy-stat-head{display:flex;align-items:baseline;justify-content:space-between;gap:6px;flex-wrap:wrap;min-width:0}
.dy-stat .v{font-size:16.5px;font-weight:700;font-variant-numeric:tabular-nums;white-space:normal;overflow-wrap:anywhere}
.dy-stat .k{font-size:11.5px;font-weight:500;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dy-stat .sub{font-size:11px;line-height:1.35;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dy-meter{height:4px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);margin-top:3px;overflow:hidden}
.dy-meter i{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary)}
.dy-meter i.warn{background:var(--dsw-alias-state-warn-primary)}
.dy-meter i.ok{background:var(--dsw-alias-state-success-primary)}
.nav-box{background:var(--dy-surface);border:.5px solid var(--dy-stroke);border-radius:12px;padding:8px 12px 10px}
.dy-nav{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}
.dy-nav .grp{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 4px 0;
  font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.dy-nav button{font:inherit;font-size:12px;font-weight:500;padding:6px 4px;border-radius:999px;border:.5px solid var(--dy-stroke);
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);cursor:pointer;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dy-nav button:hover{color:var(--dsw-alias-label-primary)}
.dy-nav button[aria-selected="true"]{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-label-primary-foreground);font-weight:600}
.dy-seg{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:999px;background:var(--dsw-alias-bg-base);border:.5px solid var(--dy-stroke);flex:none}
.dy-seg button{font:inherit;font-size:11.5px;font-weight:500;padding:3px 11px;border-radius:999px;border:none;
  background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}
.dy-seg button[aria-selected="true"]{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}
.ios-section{display:flex;flex-direction:column;gap:4px}
.ios-sec-head{display:flex;align-items:center;gap:8px;padding:0 16px;min-height:22px;font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.ios-sec-foot{padding:0 16px;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.ios-card{background:var(--dy-surface);border:.5px solid var(--dy-stroke);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
.ios-card-head{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:8px 16px;min-height:44px;border-bottom:.5px solid var(--dy-stroke)}
.ios-card-head h4{margin:0;font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap}
.ios-row{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:8px 16px;min-height:46px;border-top:.5px solid var(--dy-stroke)}
.ios-card > .ios-row:first-child,.ios-card-head + .ios-row{border-top:none}
.ios-main{flex:1 1 200px;display:flex;flex-direction:column;gap:2px;min-width:0}
.ios-t{font-size:13.5px;font-weight:500;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ios-s{font-size:11.5px;line-height:1.35;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.ios-right{flex:0 1 auto;max-width:100%;flex-wrap:wrap;display:inline-flex;align-items:center;gap:8px;min-width:0;font-variant-numeric:tabular-nums}
.ios-v{font-size:13px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.ios-chev{font-size:15px;color:var(--dsw-alias-label-tertiary);flex:none}
details.ios-interest{border-top:.5px solid var(--dy-stroke)}
.ios-card > details.ios-interest:first-child{border-top:none}
details.ios-interest > summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 16px;min-height:48px;cursor:pointer}
details.ios-interest > summary::-webkit-details-marker{display:none}
details.ios-interest[open] > summary .ios-chev{transform:rotate(90deg)}
.interest-drawer{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 16px 10px;
  background:var(--dsw-alias-bg-base);border-top:.5px solid var(--dy-stroke)}
.interest-drawer-info{flex:1;font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.interest-drawer-actions{display:inline-flex;gap:6px;flex:none;white-space:nowrap;margin-left:auto}
.dy-dayhead{display:flex;align-items:center;gap:8px;padding:4px 16px 12px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dy-dayhead b{color:var(--dsw-alias-label-primary);font-weight:600}
.dy-dayhead .ln{flex:1;height:.5px;background:var(--dy-stroke)}
.dy-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding:8px 16px 12px}
.dy-vitem{display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);border:.5px solid var(--dy-stroke);
  border-radius:10px;overflow:hidden;text-decoration:none;color:inherit}
.dy-thumb{width:100%;aspect-ratio:16/9;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);display:flex;align-items:center;justify-content:space-between;
  padding:6px 8px;font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden}
.dy-thumb-img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block}
.dy-vbody{padding:7px 9px 9px;display:flex;flex-direction:column;gap:3px}
.dy-vt{font-size:12px;font-weight:500;color:var(--dsw-alias-label-primary);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.dy-vn{font-size:11px;line-height:1.35;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.dy-input{font:inherit;font-size:13px;width:100%;max-width:100%;min-width:0;color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-base);border:1px solid var(--dy-stroke-strong);border-radius:8px;padding:5px 10px;height:32px;box-sizing:border-box}
.dy-input.w-lg{width:240px}
.dy-input.w-md{width:170px;max-width:100%;min-width:96px}
.dy-input.w-sm{width:88px;text-align:right;font-variant-numeric:tabular-nums}
.dy-textarea{font:inherit;font-size:13px;line-height:1.5;width:100%;max-width:100%;box-sizing:border-box;resize:vertical;
  color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dy-stroke-strong);border-radius:9px;padding:8px 10px;display:block}
textarea.dy-big{min-height:110px}
.dy-switch{width:46px;height:24px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);border:1px solid var(--dy-stroke-strong);
  position:relative;flex:none;cursor:pointer}
.dy-switch::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;
  background:var(--dsw-alias-label-primary);box-shadow:0 1px 2px color-mix(in srgb,var(--dsw-alias-label-primary) 28%,transparent);transition:transform .15s}
.dy-switch.on{background:var(--dsw-alias-state-success-primary);border-color:transparent}
.dy-switch.on::after{background:var(--dsw-alias-label-primary-foreground);transform:translateX(22px)}
.dy-wrap input[type=checkbox]{appearance:none;-webkit-appearance:none;width:18px;height:18px;margin:0;flex:none;cursor:pointer;
  border:1.5px solid var(--dy-stroke-strong);border-radius:5px;background:var(--dsw-alias-bg-base);display:inline-grid;place-content:center;
  transition:background .12s ease,border-color .12s ease}
.dy-wrap input[type=checkbox]::before{content:'';width:10px;height:10px;clip-path:polygon(14% 44%,0 62%,40% 100%,100% 18%,84% 6%,38% 72%);
  background:var(--dsw-alias-label-primary-foreground);transform:scale(0);transition:transform .12s ease-in-out}
.dy-wrap input[type=checkbox]:checked{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.dy-wrap input[type=checkbox]:checked::before{transform:scale(1)}
.dy-wrap input[type=checkbox]:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary)}
.dy-wrap input[type=checkbox]:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dy-wrap input[type=checkbox]:disabled{opacity:.45;cursor:not-allowed}
.dy-wrap input[type=number]{-moz-appearance:textfield;appearance:textfield}
.dy-wrap input[type=number]::-webkit-inner-spin-button,.dy-wrap input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
.dy-card{background:var(--dy-surface);border:.5px solid var(--dy-stroke);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;min-width:0}
.dy-card-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.dy-card-top h3{margin:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dy-card-top .sp{flex:1}
.dy-inner{background:var(--dsw-alias-bg-base);border:.5px solid var(--dy-stroke);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;min-width:0}
.dy-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.dy-row .sp{flex:1}
.dy-label{font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.dy-kv{display:flex;gap:8px;font-size:12.5px;flex-wrap:wrap;min-width:0;margin:0}
.dy-kv .k{color:var(--dsw-alias-label-tertiary);flex:none}
.dy-sel{position:relative;display:inline-flex;flex:none;min-width:0}
.dy-sel::after{content:'';position:absolute;right:10px;top:50%;transform:translateY(-50%);
  border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid var(--dsw-alias-label-tertiary);pointer-events:none}
.dy-sel select{-webkit-appearance:none;appearance:none;padding-right:26px;cursor:pointer;text-overflow:ellipsis}
select.dy-input option{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.dy-empty{padding:18px 10px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12.5px}
.dy-rowline{display:flex;gap:10px;align-items:baseline;font-size:12.5px;min-width:0;overflow-wrap:anywhere;margin:0}
.dy-rowline .t{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11.5px;font-variant-numeric:tabular-nums}
.dy-checkrow{display:flex;align-items:flex-start;gap:10px;padding:6px 0;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.dy-checkrow:last-child{border-bottom:none}
.dy-checkmsg{flex:1;min-width:0;font-size:12.5px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.dy-wall{display:flex;flex-direction:column;gap:12px}
.dy-tl{display:flex;flex-direction:column;gap:6px}
.dy-tl-item{display:flex;gap:8px;align-items:flex-start;padding:7px 10px;border-radius:8px;background:var(--dsw-alias-bg-base);min-width:0}
.dy-tl-bar{width:3px;border-radius:2px;align-self:stretch;flex:none;background:var(--dsw-alias-brand-primary)}
.dy-tl-bar.fact{background:var(--dsw-alias-state-success-primary)}
.dy-tl-bar.habit{background:var(--dsw-alias-brand-primary)}
.dy-tl-bar.mention{background:var(--dsw-alias-state-warn-primary)}
.dy-tl-bar.pref{background:var(--dsw-alias-brand-primary)}
.dy-tl-main{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}
.dy-tl-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.dy-tl-topic{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dy-tl-count{font-size:11.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dy-tl-meta{font-size:11px;color:var(--dsw-alias-label-tertiary);flex:none;margin-left:auto}
details.dy-inner{border-radius:10px;padding:8px 12px;margin-top:6px}
details.dy-inner summary{font-size:12.5px;color:var(--dsw-alias-label-secondary);cursor:pointer;font-weight:500}
`;
    function injectStyles() {
      if (typeof document === 'undefined') return;
      const tag = 'dsh-douyin-browser-local/panel.css#2';
      if (document.querySelector(`style[data-plugin-css="${tag}"]`)) return;
      const node = document.createElement('style');
      node.dataset.plugin = 'dsh-douyin-browser-local';
      node.dataset.pluginCss = tag;
      node.textContent = PANEL_CSS;
      document.head.appendChild(node);
    }
    // 模块加载即注入样式：不在 render 里做 DOM 副作用，首帧不因样式迟到重排闪烁。
    injectStyles();
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
    // 面板状态缓存（对标官方插件 store 常驻模式）：重开面板/重启 DSH 首帧即渲染上次内容，后台刷新覆盖。
    // 只缓存展示用的稳定子集（去掉用量、在线状态、每日计数等易变字段），数据仍以 /state 回读为准；令牌永不落缓存。
    const STATE_CACHE_KEY = 'douyin-state-cache-v1';
    let stateCacheSig = '';
    const readStateCache = () => { try { const value = JSON.parse(globalThis.localStorage?.getItem(STATE_CACHE_KEY) || 'null'); return value && value.protocol === 'douyin-state-cache-v1' ? value : null; } catch { return null; } };
    const cacheableState = value => {
      if (!value || typeof value !== 'object') return null;
      const interests = (value.persona?.interests || []).map(({ evidence, ...item }) => item);
      return { protocol: 'douyin-state-cache-v1',
        persona: value.persona ? { ...value.persona, interests } : null,
        model: value.model ?? null,
        video: value.video ? { allowed: value.video.allowed, reason: value.video.reason ?? '', policy: value.video.policy ?? null } : null,
        watchOptions: value.watchOptions ?? null, schedule: value.schedule ?? null, mode: value.mode ?? null,
        comments: value.comments ? { enabled: value.comments.enabled, policy: value.comments.policy ?? null } : null,
        media: value.media ?? null, reports: value.reports ? { date: value.reports.date ?? '', folder: value.reports.folder ?? '' } : null,
        chat: value.chat ? { policy: value.chat.policy ?? null, unansweredCount: value.chat.unansweredCount ?? 0, unansweredGroups: value.chat.unansweredGroups ?? null } : null,
        share: value.share ? { enabled: value.share.enabled, recent: value.share.recent ?? [] } : null };
    };
    let stateStore = readStateCache();
    const persistStateCache = value => { try { const next = JSON.stringify(cacheableState(value)); if (next && next !== stateCacheSig) { stateCacheSig = next; globalThis.localStorage?.setItem(STATE_CACHE_KEY, next); } } catch { /* 隐私模式或超限就存不进，行为退回直连。 */ } };

    // 足迹封面（D3）：从本机缓存取观察首帧；无缓存时保持续占位，不伪造封面。
    function ThumbImg({ api, videoId }) {
      const [src, setSrc] = useState(null);
      const holder = useRef(null);
      useEffect(() => {
        let alive = true, url = null, observer = null;
        const token = api.tokenOf();
        // 封面按需加载：滚动到可见时才去本机取帧，避免一次铺几百张图把首帧卡住。
        const load = () => {
          if (!token || url) return;
          url = `${PREFIX}/thumb?videoId=${videoId}&token=${token}`;
          const probe = new Image();
          probe.onload = () => { if (alive) setSrc(url); };
          probe.onerror = () => {};
          probe.src = url;
        };
        if (!token) return undefined;
        if (typeof globalThis.IntersectionObserver === 'function' && holder.current) {
          observer = new globalThis.IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); load(); } }, { rootMargin: '160px' });
          observer.observe(holder.current);
        } else load();
        return () => { alive = false; observer?.disconnect(); };
      }, [api, videoId]);
      return h('div', { className: 'dy-thumb', ref: holder }, src ? h('img', { className: 'dy-thumb-img', src, alt: '' }) : h('span', { 'aria-hidden': 'true' }, '暂无封面'));
    }

    const OPERATIONS = {
      '/bootstrap': '连接本机服务', '/state': '刷新运行状态', '/interactions/state': '读取好友在线状态', '/interactions/configure': '设置好友互动',
      '/browser/open': '打开抖音', '/watch/state': '读取自主观看状态', '/watch/schedule': '设置自动观看', '/watch/options': '保存观看主题', '/watch/start': '开始自主观看', '/watch/stop': '停止自主观看',
      '/video/status': '读取观看时段与用量', '/video/configure': '保存观看时段与额度', '/video/start': '开始观看', '/video/stop': '结束观看',
      '/chat/state': '读取自动回复状态', '/chat/contacts': '读取当前会话列表', '/chat/configure': '保存许可名单', '/chat/start': '启动自动回复', '/chat/stop': '停止自动回复', '/chat/prepare': '准备回复通道', '/chat/resolve': '解除会话暂停', '/chat/unanswered': '读取遗留待处理消息', '/chat/unanswered/resolve': '标记遗留待处理消息', '/chat/unanswered/end': '结束待答，不再回复', '/chat/unanswered/retry': '安全重新检查',
      '/share/state': '读取分享状态', '/share/configure': '设置自主分享', '/share/resolve': '核对分享结果', '/comments/state': '读取评论状态', '/comments/configure': '保存评论设置', '/comments/resolve': '核对评论结果',
      '/mode/state': '读取静默观看设置', '/mode/configure': '保存静默观看设置', '/media/state': '读取音频设置', '/media/configure': '保存音频设置', '/media/credentials': '保存音频密钥',
      '/persona': '读取人格', '/persona/card': '保存人格', '/persona/configure': '保存人格', '/persona/context-observations': '切换观察注入上下文', '/persona/interest/forget': '修改兴趣记忆', '/memory/search': '搜索记忆', '/memory/forget': '删除记忆', '/model/configure': '保存模型设置', '/task/limits': '读取任务额度', '/task/limits/configure': '保存任务额度',
      '/task': '提交对话任务', '/stop': '停止对话任务', '/forward/contacts': '读取转发会话', '/forward': '转发作品', '/memory': '检索共享记忆',
      '/usage': '读取用量', '/watched': '读取观看足迹', '/diagnostics': '一键自检', '/diagnostics/repair': '修复自检问题', '/reports/generate': '生成观看日报', '/reports/read': '读取观看日报', '/reports/state': '读取日报目录',
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
          if (!routes.has(route) && !/^\/reports\/read\?date=\d{4}-\d{2}-\d{2}$/.test(route) && !/^\/watched\?days=\d{1,2}$/.test(route)) throw new Error('只允许本插件的原生设置接口。');
          if (!fetcher && typeof rpc?.call !== 'function') throw new Error('当前 DSH 页面没有可用的插件设置通信接口。请更新插件后完全退出并重开 DSH；若仍失败，请核对 DSH 版本与来源。可点击“刷新插件状态”重试。');
          // 令牌来自 /state：还没取到就说明插件状态尚未就绪（首次加载失败或会话过期），写操作一律先拦住，不要发出无令牌的请求。
          if (input !== undefined && !token) throw new Error('插件状态还没取到，写操作暂时不能发：请点击右上角「刷新插件状态」按钮重试；若刷新后仍报这句，说明 DSH 还没连上插件服务。');
          if (route === '/chat/unanswered' && !token) throw new Error('插件状态还没取到，待答列表暂时读不了：请点击右上角「刷新插件状态」按钮重试。');
          if (route.startsWith('/watched') && !token) throw new Error('插件状态还没取到，观看足迹暂时读不了：请点击右上角「刷新插件状态」按钮重试。');
          // 只读接口里也有一批要令牌（/chat/unanswered、/watched）：后端按令牌校验身份，缺头就回 403。
          const needsToken = input !== undefined || route === '/chat/unanswered' || route.startsWith('/watched');
          const operation = requestOperation(route, input), write = input !== undefined, timeoutMs = route === '/state' ? 20_000 : 65_000;
          if (write && writing.has(route)) throw Object.assign(new Error(`${operation}正在处理，请等待当前请求完成。`), { operation, code: 'UI_OPERATION_BUSY' });
          if (write) writing.add(route);
          const signal = AbortSignal.timeout(timeoutMs);
          try {
          let response;
          if (!fetcher && typeof rpc?.call === 'function') {
            const reply = await rpc.call('/douyin-settings', 'request', { path: route, ...(input === undefined ? (needsToken ? { token } : {}) : { input, token }) }, signal);
            if (!reply?.ok) throw new Error(reply?.error?.message || 'DSH 设置通信失败，请确认插件后端已加载新版；操作不会自动重试。');
            const outcome = reply.value;
            if (!Number.isInteger(outcome?.status) || !outcome.body || typeof outcome.body !== 'object') throw new Error('DSH 设置接口版本不匹配，请完全退出后重开 DSH。');
            response = { status: outcome.status, ok: outcome.status >= 200 && outcome.status < 300, json: async () => outcome.body };
          } else response = await fetcher(PREFIX + route, { method: input === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal, headers: { 'content-type': 'application/json', ...(needsToken ? { 'x-douyin-settings-token': token } : {}) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
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
      const [interestConfirm, setInterestConfirm] = useState('');
      const [usageScope, setUsageScope] = useState('today');
      useEffect(() => { if (category === '观看足迹' && ready) { void loadWatched(watchedDays); } }, [category, ready, watchedDays]);
      const existingAuthorization = useRef(false); const alive = useRef(true), refreshing = useRef(null), refreshAgain = useRef(false), locks = useRef(new Set()), submitted = useRef(new Set()), keyValues = useRef(credentials);
      const active = value => value?.running || value?.starting || value?.busy || value?.worker?.alive;
      const operationActive = active(state?.watch) || state?.chat?.starting || state?.chat?.busy || state?.share?.busy;
      // refresh 只做拉取与应用（friend-ui-races 按源码抽取验证单飞语义，不得引用沙箱外变量）；
      // 状态缓存落库由 syncState 包装负责，所有调用点统一走它。
      async function refresh(fresh = false) {
        if (refreshing.current) { if (fresh) refreshAgain.current = true; return refreshing.current; }
        const work = (async () => {
          let latest;
          do {
            refreshAgain.current = false;
            try { const value = await api.request('/state'); if (alive.current && !refreshAgain.current) { latest = value; setState(value); setReady(true); setConnectionError(''); } }
            catch (failure) { if (alive.current && !refreshAgain.current) { if (!stateStore) setReady(false); setConnectionError(failure.message); } }
          } while (alive.current && refreshAgain.current);
          return latest;
        })();
        refreshing.current = work; try { return await work; } finally { if (refreshing.current === work) refreshing.current = null; }
      }
      useEffect(() => { alive.current = true; void syncState(); const timer = setInterval(() => { void syncState(); }, 2500); return () => { alive.current = false; clearInterval(timer); }; }, [api]);
      // syncState：拉取成功后落模块级缓存与 localStorage（展示用），失败不清空已渲染内容。
      // 放在首个 useEffect 之后——friend-ui-races 按源码抽取 refresh→首个 useEffect 段验证单飞语义，其间只能有 refresh 本体。
      const syncState = async (fresh = false) => { const value = await refresh(fresh); if (value) { stateStore = value; setTimeout(() => persistStateCache(value), 0); } return value; };
      useEffect(() => { if (!reportDate && state?.reports?.date) setReportDate(state.reports.date); }, [state]);
      const write = route => async payload => { const result = await api.request(route, payload); void syncState(true); return result; };
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
      const readVideo = snapshot => { const policy = snapshot?.policy || {}, minutes = Object.hasOwn(policy, 'dailyMinutes') ? policy.dailyMinutes : Object.hasOwn(policy, 'sessionMinutes') ? policy.sessionMinutes : 10, requests = Object.hasOwn(policy, 'dailyRequests') ? policy.dailyRequests : 30; return { windows: (policy.windows || ['00:00-24:00']).join(' / '), weekendAll: policy.weekendWindows?.join() === '00:00-24:00', dailyMinutes: minutes ?? '', unlimitedMinutes: minutes === null, dailyRequests: requests ?? '', unlimitedRequests: requests === null }; };
      const encodeVideo = value => { const windows = list(value.windows, true); if (!windows.length || windows.some(item => !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(item))) throw new Error('时段请填写完整的 HH:MM-HH:MM。'); return { windows, weekendWindows: value.weekendAll ? ['00:00-24:00'] : null, dailyMinutes: value.unlimitedMinutes ? null : positive(value.dailyMinutes, '每日观看分钟数'), dailyRequests: value.unlimitedRequests ? null : positive(value.dailyRequests, '每日模型请求次数') }; };
      const video = useAutosave({ value: state?.video, initial: readVideo(null), read: readVideo, encode: encodeVideo, write: write('/video/configure'), canonical: (saved, payload) => saved?.policy ? encodeVideo(readVideo(saved)) : payload, available: ready });
      const readTopics = value => ({ mode: value?.policy?.mode || 'recommend', topics: (value?.policy?.topics || []).join(' / '), exclude: (value?.policy?.exclude || []).join(' / ') });
      const topics = useAutosave({ value: state?.watchOptions, initial: readTopics(null), read: readTopics, encode: value => ({ mode: value.mode, topics: list(value.topics, true), exclude: list(value.exclude, true) }), write: write('/watch/options'), canonical: (saved, payload) => saved?.policy ? { mode: saved.policy.mode, topics: saved.policy.topics || [], exclude: saved.policy.exclude || [] } : payload, available: ready });
      const mode = useAutosave({ value: state?.mode, initial: { silent: false }, read: value => ({ silent: value?.silent === true }), encode: value => value, write: write('/mode/configure'), canonical: (saved, payload) => typeof saved?.silent === 'boolean' ? { silent: saved.silent } : payload, available: ready });
      const comments = useAutosave({ value: state?.comments, initial: { enabled: false, dailyLimit: 3, perSessionLimit: 1 }, read: value => ({ enabled: value.enabled === true, dailyLimit: value.policy?.dailyLimit ?? 3, perSessionLimit: value.policy?.perSessionLimit ?? 1 }), encode: value => ({ enabled: value.enabled, dailyLimit: positive(value.dailyLimit, '每日评论次数'), perSessionLimit: positive(value.perSessionLimit, '每次观看评论次数') }), write: write('/comments/configure'), canonical: (saved, payload) => saved?.policy ? { enabled: saved.enabled === true, dailyLimit: saved.policy.dailyLimit, perSessionLimit: saved.policy.perSessionLimit } : payload, available: ready });
      const media = useAutosave({ value: state?.media, initial: { enabled: false, backend: 'local-whisper' }, read: value => ({ enabled: value.enabled === true, backend: value.backend || 'local-whisper' }), encode: value => value, write: write('/media/configure'), available: ready });
      const readChat = value => ({ recipientIds: (value?.policy?.allowlist || []).map(item => item.id), allowConversationOnly: existingAuthorization.current || (value?.policy?.allowlist || []).some(item => ['existing-conversation', 'existing-group'].includes(item.authorizationKind)), groupMentionNamesText: (value?.policy?.groupMentionNames || ['大肥鱼']).join(', ') });
      const encodeChat = value => ({ recipientIds: value.recipientIds, allowConversationOnly: value.allowConversationOnly, groupMentionNames: list(value.groupMentionNamesText) });
      const chat = useAutosave({ value: state?.chat, initial: readChat(null), read: readChat, encode: encodeChat, write: write('/chat/configure'), canonical: (saved, payload) => saved?.policy ? encodeChat(readChat(saved)) : payload, available: ready });
      const shownContacts = [...new Map([...(state?.chat?.policy?.allowlist || []).map(item => ({ ...item, notListed: Boolean(contacts) && !contacts.some(found => found.id === item.id) })), ...(contacts || [])].map(item => [item.id, item])).values()];
      async function perform(key, action) {
        if (!ready || locks.current.has(key)) return; locks.current.add(key); setBusy(new Set(locks.current)); setNotice('');
        setOperationErrors(old => { const next = { ...old }; delete next[key]; return next; });
        try { const value = await action(); if (alive.current) setNotice(`${operationLabel(key)}已完成。`); await syncState(true); return value; }
        catch (failure) { if (alive.current) { const detail = requestFailure(failure, operationLabel(key)); setOperationErrors(old => ({ ...old, [key]: { message: detail.message, requestError: detail.requestError === true, unconfirmed: detail.unconfirmed === true } })); } await syncState(true); }
        finally { locks.current.delete(key); if (alive.current) setBusy(new Set(locks.current)); }
      }
      const button = (label, key, action, disabled = false, needsReady = true, variant = 'outline') => h('button', { type: 'button', className: `dy-btn${variant === 'primary' ? ' primary' : ''}`, disabled: (needsReady && !ready) || busy.has(key) || disabled, onClick: action }, busy.has(key) ? '处理中…' : label);
      // 手动刷新走轻量 busy 包装而不是 perform：refresh 键需要未就绪时也可点击（needsReady=false），且要有「处理中…」反馈。
      // 放在 button 之后——ui-request-feedback 按 perform→const button 切片验证，期间不能插入其他声明。
      const manualRefresh = () => { if (locks.current.has('refresh')) return; locks.current.add('refresh'); setBusy(new Set(locks.current)); void syncState(true).finally(() => { locks.current.delete('refresh'); if (alive.current) setBusy(new Set(locks.current)); }); };
      const note = text => text ? h('p', { style: muted }, text) : null;
      const status = form => form.status.message && h('p', { role: form.status.kind === 'error' ? 'alert' : 'status', style: muted }, form.status.message);
      const section = (title, ...children) => h('section', { role: 'tabpanel', 'aria-label': title, style: { ...column, marginBottom: 24 } }, h('h3', null, title), ...children);
      const field = (label, form, key, extra = {}) => h('label', { style: column }, h('span', null, label), h(Input, { 'aria-label': label, value: form.draft[key], disabled: !ready, onChange: event => form.edit({ [key]: event.target.value }), ...extra }));
      const area = (label, form, key, rows = 2, blurOnly = false, disabled = false) => h('label', { style: column }, label, h('textarea', { 'aria-label': label, rows, value: form.draft[key], disabled: !ready || disabled, style: formControl, onChange: event => form.edit({ [key]: event.target.value }, { blurOnly }), onBlur: blurOnly ? () => { void form.flush(); } : undefined }));
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
      // v6.2：视频状态用中文短句；下一个允许时段从 policy.windows 里取今天还没到的第一个起点。
      const nextWindowStart = (() => {
        const windows = state?.video?.policy?.windows || [];
        if (!windows.length) return '';
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
        const now = Number(parts.find(item => item.type === 'hour')?.value || 0) * 60 + Number(parts.find(item => item.type === 'minute')?.value || 0);
        const starts = windows.map(item => String(item).split('-')[0]).filter(Boolean).map(value => { const [h, m] = value.split(':').map(Number); return h * 60 + m; }).filter(value => Number.isSafeInteger(value)).sort((a, b) => a - b);
        if (!starts.length) return '';
        const chosen = starts.find(value => value > now) ?? starts[0];
        return `${String(Math.floor(chosen / 60)).padStart(2, '0')}:${String(chosen % 60).padStart(2, '0')}`;
      })();
      // v4：标题只说真实原因（按 reasonCode 分开「开关关闭」「不在时段」「额度用完」「浏览器没跑」），细节留下一行。
      const summary = (() => {
        if (!ready) return null;
        if (state?.model?.configured !== true) return { label: '模型未配置', tone: 'bad', detail: '还没有选择 DSH 提供商和模型，自动能力都不会运行。', tab: '基础设置', action: { label: '去处理', run: () => setCategory('基础设置') } };
        if (replyPresence?.status === 'attention' && /浏览器未运行/.test(`${replyPresence?.label || ''} ${presenceReason || ''}`)) return { label: '浏览器未运行', tone: 'bad', detail: '专用浏览器没在运行。有待回复的消息时后台会自己拉起来；点「打开抖音」可立即恢复。', tab: '好友互动', action: { label: '打开抖音', run: () => { void perform('browser', () => api.request('/browser/open', {})); } } };
        if (state?.video?.allowed === false && state.video.reason) {
          const code = state.video.reasonCode;
          const closed = code === 'disabled';
          const label = closed ? '允许观看已关闭' : code === 'daily-time' ? '今天的观看时长已用完' : code === 'daily-requests' ? '今天的模型请求已用完' : '不在允许观看时段';
          const notSentCount = (state?.comments?.notSent || []).length;
          const detail = closed
            ? state?.watch?.lastError
              ? `开关是关的（${state.watch.lastError}）。打开后按当天的随机日程自己看，不会一开就开抖音。`
              : '开关是关的。打开后按当天的随机日程自己看，不会一开就开抖音。'
            : code === 'outside-window'
              ? `下一个允许时段 ${nextWindowStart || '稍后'} 开始${notSentCount ? `；另有 ${notSentCount} 条公开评论未发出` : ''}`
              : state.video.reason;
          const action = code === 'outside-window' ? { label: '查看时段', run: () => setCategory('视频观看') } : { label: '去处理', run: () => setCategory('视频观看') };
          return { label, tone: closed ? 'bad' : '', detail, tab: '视频观看', action };
        }
        if (state?.watch?.lastError) return { label: '上次自主观看中断', tone: '', detail: state.watch.lastError, tab: '视频观看', action: { label: '去处理', run: () => setCategory('视频观看') } };
        if (Number.isSafeInteger(state?.chat?.unansweredCount) && state.chat.unansweredCount > 0) { const g = state.chat.unansweredGroups || {}, manual = (g.needsManual ?? 0) + (g.uncertain ?? 0), auto = g.autoRecovering ?? (state.chat.unansweredCount - manual); return { label: manual > 0 ? `${manual} 条待答已转人工` : `${auto} 条待答自动恢复中`, tone: manual > 0 ? 'bad' : '', detail: manual > 0 ? `另有 ${auto} 条在自动恢复；转人工的条目需要你判断是否还要回复，不会自动补发。` : '这些消息在自动恢复流程中，无需人工操作；不会自动补发。', tab: '好友互动', action: { label: '查看待答', run: () => setCategory('好友互动') } }; }
        if (replyPresence?.status === 'attention') return { label: '回复服务异常', tone: 'bad', detail: presenceReason, tab: '好友互动', action: { label: '去处理', run: () => setCategory('好友互动') } };
        return { label: '一切正常', tone: 'good', detail: [replyPresence?.label, watchState?.active ? watchState.label : ''].filter(Boolean).join(' · ') || '各能力按当前设置运行。' };
      })();
      return h('div', { className: 'dy-wrap', style: { maxWidth: 900, paddingBottom: 32 } },
        h('div', { className: 'dy-head' }, h('h2', null, '大肥鱼抖音助手'), h('span', { className: 'sp' }),
          h('span', { className: 'dy-cap' }, ready ? '已连上本机插件' : '正在连本机插件'),
          button('刷新插件状态', 'refresh', manualRefresh, false, false),
          button('打开抖音', 'browser', () => { void perform('browser', () => api.request('/browser/open', {})); })),
        // 「刷新插件状态」到底做什么：只是重新读一次本机插件的真实状态，不改任何设置。
        h('p', { className: 'dy-note', style: { margin: '0 0 8px' } }, '「刷新插件状态」= 重新读取一次本机插件的当前状态（开关、额度、待答、未发出记录），不改动任何设置；页面本来每 2.5 秒也会自动读一次。'),
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
        summary && h('div', { className: 'status-top-box', role: 'region', 'aria-label': '今日概览与数字块' },
          h('div', { role: 'status', 'aria-label': '当前状态摘要', className: 'dy-summary', title: summary.detail },
            h('span', { className: `dot ${summary.tone || ''}`, 'aria-hidden': 'true' }),
            h('span', { className: 'lb' }, summary.label),
            h('span', { className: 'dt' }, summary.detail),
            summary.action && button(summary.action.label, 'statusGoto', summary.action.run)),
          h('div', { className: 'dy-stat2' },
            h('div', { className: 'dy-stat' },
              h('div', { className: 'dy-stat-head' }, h('span', { className: 'k' }, '今日观看分钟'), h('span', { className: 'v' }, `${Math.floor((state?.video?.daily?.usedSeconds || 0) / 60)} / ${state?.video?.policy?.dailyMinutes ?? '不限'} 分钟`)),
              h('div', { className: 'sub' }, `今日剩余 ${state?.video?.daily?.remainingSeconds === null || state?.video?.daily?.remainingSeconds === undefined ? '不限' : `${Math.floor(state.video.daily.remainingSeconds / 60)} 分钟`}`),
              typeof state?.video?.policy?.dailyMinutes === 'number' && state.video.policy.dailyMinutes > 0 ? h('div', { className: 'dy-meter' }, h('i', { className: (state?.video?.daily?.usedSeconds || 0) >= state.video.policy.dailyMinutes * 60 ? 'warn' : '', style: { width: `${Math.min(100, Math.round((state?.video?.daily?.usedSeconds || 0) * 100 / (state.video.policy.dailyMinutes * 60)))}%` } })) : null),
            h('div', { className: 'dy-stat' },
              h('div', { className: 'dy-stat-head' }, h('span', { className: 'k' }, '今日模型次数'), h('span', { className: 'v' }, `${state?.video?.daily?.requests || 0} / ${state?.video?.policy?.dailyRequests ?? '不限'} 次`)),
              h('div', { className: 'sub' }, `全场景累计 ${state?.usage?.total?.requests || 0} 次 · ${state?.usage?.total?.totalTokens || 0} Token`),
              typeof state?.video?.policy?.dailyRequests === 'number' && state.video.policy.dailyRequests > 0 ? h('div', { className: 'dy-meter' }, h('i', { className: (state?.video?.daily?.requests || 0) >= state.video.policy.dailyRequests ? 'warn' : '', style: { width: `${Math.min(100, Math.round((state?.video?.daily?.requests || 0) * 100 / state.video.policy.dailyRequests))}%` } })) : null),
            h('div', { className: 'dy-stat' },
              h('div', { className: 'dy-stat-head' }, h('span', { className: 'k' }, '今日好友回复'), h('span', { className: 'v' }, `${state?.chat?.daily?.requests || 0} 次`)),
              h('div', { className: 'sub' }, `待答 ${state?.chat?.unansweredCount || 0} 条 · 自动恢复 ${state?.chat?.unansweredGroups?.autoRecovering || 0} 条`),
              h('div', { className: 'dy-meter' }, h('i', { className: 'ok', style: { width: `${Math.min(100, Math.round((state?.chat?.daily?.requests || 0) * 100 / Math.max(1, state?.chat?.unansweredGroups?.autoRecovering || 0 || (state?.chat?.daily?.requests || 0) || 1)))}%` } }))),
            h('div', { className: 'dy-stat' },
              h('div', { className: 'dy-stat-head' }, h('span', { className: 'k' }, '今日分享与评论'), h('span', { className: 'v' }, `分享 ${state?.share?.daily?.attempts || 0} · 评论 ${state?.comments?.daily?.attempts || 0}`)),
              h('div', { className: 'sub' }, `${(state?.comments?.notSent || []).length ? `${state.comments.notSent.length} 条公开评论未发出` : '没有未发出的公开评论'}`),
              h('div', { className: 'dy-meter' }, h('i', { style: { width: `${Math.min(100, Math.round(((state?.share?.daily?.attempts || 0) + (state?.comments?.daily?.attempts || 0)) * 100 / Math.max(1, (state?.share?.daily?.attempts || 0) + (state?.comments?.daily?.attempts || 0) || 1)))}%` } })))),
        ),
        h('nav', { className: 'dy-nav', role: 'tablist', 'aria-label': '抖音设置分类', tabIndex: 0 },
          h('span', { className: 'grp' }, '日常'),
          ...['基础设置', '视频观看', '好友互动', '公开评论', '音频与密钥'].filter(name => fallbackCategories[name]).map(name => h('button', { key: name, role: 'tab', type: 'button', 'aria-selected': category === name, onClick: () => setCategory(name) }, name)),
          h('span', { className: 'grp' }, '数据与记录'),
          ...['自检与用量', '观看足迹', '记忆管理', '观看日报', '分享记录'].filter(name => fallbackCategories[name]).map(name => h('button', { key: name, role: 'tab', type: 'button', 'aria-selected': category === name, onClick: () => setCategory(name) }, name))),
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
            h('div', { className: 'dy-card-top' }, h('h3', null, '人格与兴趣'), h('span', { className: 'sp' }), persona.status.kind === 'error' && button('载入最新人格（替换草稿）', 'personaReload', () => { void perform('personaReload', async () => { const latest = await syncState(true); if (!latest?.persona?.revision) throw new Error('未读到最新人格，原草稿已保留。'); persona.edit({ content: latest.persona.manualText || '', expectedRevision: latest.persona.revision }, { blurOnly: true }); return latest.persona; }); })),
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
            h('p', { className: 'dy-note' }, '开关打开后按当天的随机日程自己看：不会一开开关就开抖音，每场看多久、两场之间歇多久都随机；每日上限是天花板，不是要刷满的额度。'),
            // 开关关着时把「为什么关着」说清楚：上一次是本人停的就说本人停的，不是「被系统关掉」。
            !watchEnabled && h('p', { role: 'status', className: 'dy-note' }, state?.watch?.lastError
              ? `现在没在自动看：${state.watch.lastError}想继续就把上面的开关打开，或点「开始自主观看」。`
              : '现在没在自动看：开关是关的。打开它就会按当天的随机日程自己看。'),
            note(state?.video?.reason), note(state?.schedule?.lastError), state?.watch?.lastError && h('p', { role: 'status', className: 'dy-note' }, `上次自主观看停止原因：${state.watch.lastError}`)
          ),
          dyCard(
            h('div', { className: 'dy-card-top' }, h('h3', null, '观看时段'), h('span', { className: 'sp' }), h('span', { className: 'dy-foot' }, `周末${video.draft.weekendAll ? '全天允许' : '按工作日'}`)),
            h('div', { className: 'dy-row' },
              button('全天', 'all', () => video.edit({ windows: '00:00-24:00', weekendAll: false }, { immediate: true }), false, false, String(video.draft.windows).trim() === '00:00-24:00' && video.draft.weekendAll === false ? 'primary' : 'outline'),
              button('谷时段（DeepSeek）', 'valley', () => video.edit({ windows: '00:00-09:00 / 12:00-14:00 / 18:00-24:00', weekendAll: true }, { immediate: true }), false, false, String(video.draft.windows).trim() === '00:00-09:00 / 12:00-14:00 / 18:00-24:00' && video.draft.weekendAll === true ? 'primary' : 'outline'),
              button('晚间 20–22 点', 'evening', () => video.edit({ windows: '20:00-22:00', weekendAll: false }, { immediate: true }), false, false, String(video.draft.windows).trim() === '20:00-22:00' && video.draft.weekendAll === false ? 'primary' : 'outline')),
            h('div', { className: 'dy-row' }, h('span', { className: 'dy-label' }, '时段'), h('input', { className: 'dy-input', style: { width: 260, flex: 'none' }, 'aria-label': '每日允许视频时段', value: video.draft.windows, disabled: !ready, onChange: event => video.edit({ windows: event.target.value }), onBlur: () => { void video.flush(); } }), h('span', { className: 'dy-cap' }, '可多段，斜杠或空格分隔，如 09:00-12:00 / 14:00-18:00')),
            h('div', { className: 'dy-row' }, h('span', { className: 'dy-label' }, '周末全天'), dySwitch(video.draft.weekendAll, { 'aria-label': '周末全天允许', onClick: () => video.edit({ weekendAll: !video.draft.weekendAll }, { immediate: true }) })),
            h('div', { className: 'dy-row' },
              h('span', { className: 'dy-label' }, '每日观看上限'), h('input', { className: 'dy-input', style: { width: 90, flex: 'none' }, type: 'number', min: 1, 'aria-label': '每日观看上限（分钟）', value: video.draft.unlimitedMinutes ? '' : video.draft.dailyMinutes, placeholder: video.draft.unlimitedMinutes ? '不限' : '分钟数', disabled: !ready, onChange: event => video.edit({ dailyMinutes: event.target.value, ...(event.target.value !== '' ? { unlimitedMinutes: false } : {}) }) }), h('span', { className: 'dy-cap' }, `分钟${video.draft.unlimitedMinutes ? '（不限）' : ''}`),
              h('span', { className: 'dy-label' }, '模型请求'), h('input', { className: 'dy-input', style: { width: 90, flex: 'none' }, type: 'number', min: 1, 'aria-label': '每日观看模型请求上限', value: video.draft.unlimitedRequests ? '' : video.draft.dailyRequests, placeholder: video.draft.unlimitedRequests ? '不限' : '次数', disabled: !ready, onChange: event => video.edit({ dailyRequests: event.target.value, ...(event.target.value !== '' ? { unlimitedRequests: false } : {}) }) }), h('span', { className: 'dy-cap' }, `次${video.draft.unlimitedRequests ? '（不限）' : ''}`)),
            h('div', { className: 'dy-row' },
              h('span', { className: 'dy-label' }, '不限每日观看时长'), dySwitch(video.draft.unlimitedMinutes, { 'aria-label': '不限每日观看时长', onClick: () => video.edit({ unlimitedMinutes: !video.draft.unlimitedMinutes }, { immediate: true }) }),
              h('span', { className: 'dy-label' }, '不限每日模型请求次数'), dySwitch(video.draft.unlimitedRequests, { 'aria-label': '不限每日模型请求次数', onClick: () => video.edit({ unlimitedRequests: !video.draft.unlimitedRequests }, { immediate: true }) }), h('span', { className: 'dy-cap' }, '开启后上方数字框停用')),
            status(video)
          ),
          dyCard(
            h('div', { className: 'dy-card-top' }, h('h3', null, '观看主题'), h('span', { className: 'sp' }), h('span', { className: `dy-chip ${topics.draft.mode === 'topic' ? 'info' : 'ok'}` }, h('span', { className: 'd', 'aria-hidden': 'true' }), topics.draft.mode === 'topic' ? '围绕指定主题观看' : '自主挑选推荐')),
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
            contacts?.some(item => item.relationshipStatus === 'unavailable' || item.isGroup === true || typeof item.isGroup !== 'boolean') && h('div', { className: 'dy-row' }, h('span', { className: 'dy-label' }, '授权已核对的现有会话'), dySwitch(chat.draft.allowConversationOnly, { 'aria-label': '授权已核对的现有会话', onClick: () => { const value = !chat.draft.allowConversationOnly; existingAuthorization.current = value; chat.edit({ allowConversationOnly: value, ...(!value ? { recipientIds: chat.draft.recipientIds.filter(id => shownContacts.some(item => item.id === id && item.followed === true && item.isGroup === false)) } : {}) }, value ? { blurOnly: true } : { immediate: true }); } }), h('span', { className: 'dy-cap' }, '开启后群聊和旧类型会话也可勾选')),
            ...[false, true, null].flatMap(kind => { const items = shownContacts.filter(item => item.isGroup === kind || kind === null && typeof item.isGroup !== 'boolean'); return items.length ? [note(kind === false ? '个人会话' : kind === true ? '群聊（仅被 @ 或叫到响应昵称时回复）' : '旧记录类型待核对（暂不可选）'), ...items.map(item => h('label', { key: item.id, style: row }, h('input', { type: 'checkbox', 'aria-label': `许可联系人 ${item.name || item.displayName || '联系人'}`, checked: chat.draft.recipientIds.includes(item.id), disabled: !ready || !chat.draft.recipientIds.includes(item.id) && (item.notListed || !(item.followed === true && item.isGroup === false || chat.draft.allowConversationOnly === true && typeof item.isGroup === 'boolean')), onChange: event => chat.edit({ recipientIds: event.target.checked ? [...chat.draft.recipientIds, item.id] : chat.draft.recipientIds.filter(id => id !== item.id) }, { immediate: true }) }), item.name || item.displayName || '许可会话'))] : []; }),
            h('div', { className: 'dy-row' }, h('span', { className: 'dy-label' }, '群聊响应昵称'), h('input', { className: 'dy-input', style: { flex: 1, minWidth: 200 }, 'aria-label': '群聊响应昵称（逗号或换行分隔）', value: chat.draft.groupMentionNamesText, disabled: !ready, onChange: event => chat.edit({ groupMentionNamesText: event.target.value }, { blurOnly: true }), onBlur: () => { void chat.flush(); } })),
            note(`今日回复模型请求 ${state?.chat?.daily?.requests || 0} 次 · 今日分享 ${state?.share?.daily?.attempts || 0} 次。未确认发送会暂停，不自动重发。`),
            ...(state?.chat?.contacts || []).filter(item => item.identityReviewRequired === true || item.recovery?.requiresUserAction === true || /登录|验证码|未授权|许可.*(?:不足|失效|撤销)|身份.*(?:变化|不一致|未通过|不明|不足)/.test(item.reason || '') || ['paused', 'delivery-uncertain'].includes(item.status) && !(item.recovery?.autoPendingCount > 0 || item.recovery?.autoRetryCount > 0)).map(item => h('div', { key: item.id }, note(item.reason || '该会话暂缓处理，状态会继续更新。'), item.identityReviewRequired === true && note('请重新读取联系人并确认许可名单；身份未通过前不会发送。'))),
            ...(state?.share?.unavailableRecipients || []).map(item => note(`暂不能自主分享：${item.name || '许可会话'} · ${item.reason}`)),
            ...reviewList('share')
          ),
          ...unansweredView,
          // 回复处理记录（v3 预览稿已确认）：每会话一张状态卡，事件流收进运行日志折叠。
          h('div', { className: 'dy-card' },
            h('div', { className: 'dy-card-top' }, h('h3', null, '回复处理记录'), h('span', { className: 'sp' }),
              (() => { const r = state?.chat?.recovery; return r ? h('span', { className: 'dy-cap' }, `自动恢复中 ${r.autoPendingCount || 0} · 等待人工 ${r.pendingManualCount || 0} · 可自动恢复 ${r.recoverableCount || 0}`) : null; })()),
            ...(state?.chat?.contacts || []).slice(0, 12).map(item => h('div', { key: item.id, className: 'dy-inner', style: { borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 8, marginTop: 4 } },
              h('div', { className: 'dy-card-top', style: { marginBottom: 4 } },
                h('h3', { style: { fontSize: 13, margin: 0 } }, item.name || state?.chat?.policy?.allowlist?.find(c => c.id === item.id)?.name || '许可会话'),
                h('span', { className: `dy-chip ${item.status === 'ready' ? 'ok' : item.status === 'paused' ? 'warn' : 'info'}` }, h('span', { className: 'd', 'aria-hidden': 'true' }), ({ ready: '正常接收', paused: '已暂停', 'delivery-uncertain': '发送结果待核对' }[item.status]) || item.status || '状态未知'),
                h('span', { className: 'sp' }),
                h('span', { className: 'dy-cap' }, `待答 ${item.unanswered?.length || 0} 条${item.lastCheckedAt ? ` · 检查 ${new Date(item.lastCheckedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : ''}`)),
              item.reason && h('p', { className: 'dy-note', style: { margin: 0 } }, item.reason),
              h('details', { style: { marginTop: 4 } }, h('summary', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer' } }, '运行日志（最近 20 条）'),
                h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)', lineHeight: 1.9, marginTop: 4, overflowWrap: 'anywhere' } },
                  ...(state?.chat?.events || []).filter(event => !event.recipientId || event.recipientId === item.id).slice(-20).reverse().map((event, index) => h('div', { key: index }, `${event.at ? new Date(event.at).toLocaleTimeString('zh-CN', { hour12: false }) : ''} ${event.message || event.type || '运行事件'}`)))))),
            !(state?.chat?.contacts || []).length && h('p', { className: 'dy-note' }, '暂无处理记录；启动自动回复后会在这里显示每个会话的处理情况。'),
            h('div', { className: 'dy-card' },
              h('div', { className: 'dy-card-top' }, h('h3', null, '运行数据'), h('span', { className: 'sp' }),
                h('details', { className: 'dy-inner' }, h('summary', null, '复制原始数据（排查用，界面不展示）'), h('div', null,
                  h('p', { className: 'dy-note' }, '点下面按钮把完整运行数据复制到剪贴板，粘给排查工具或 Agent 用。'),
                  h('div', { className: 'dy-row' }, button('复制原始数据', 'copyChatDebug', () => { copyData(() => JSON.stringify({ recovery: state?.chat?.recovery, contacts: state?.chat?.contacts, events: state?.chat?.events }, null, 2)); })))))
        ),
        ),
        ),
        // 观看足迹（吞噬新增）：读取 /watched 聚合，按日分组卡片墙；点击在专用浏览器打开原作品。
        category === '观看足迹' && h('div', { className: 'dy-wrap' },
          h('div', { className: 'dy-card' },
            h('div', { className: 'dy-card-top' }, h('h3', null, '观看足迹'), h('span', { className: 'sp' }),
              dySel({ 'aria-label': '足迹范围', value: watchedDays, onChange: event => setWatchedDays(event.target.value) }, [['14', '最近 14 天'], ['30', '最近 30 天']]),
              button('刷新足迹', 'watched', () => { void loadWatched(); })),
            watched ? h('p', { className: 'dy-note' }, `共 ${watched.total} 条已看记录${watched.generatedAt ? ` · 更新于 ${new Date(watched.generatedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : ''}。封面来自本机帧缓存（观察首帧，3 天过期），旧记录可能显示占位；点击卡片在专用浏览器打开原作品。`) : h('p', { className: 'dy-note' }, '正在读取观看足迹…'),
            watchedError && h('p', { role: 'alert', className: 'dy-note', style: { color: 'var(--dsw-alias-state-error-primary,#dc2626)' } }, watchedError)),
          watched && !watched.groups.length && dyCard(h3Card('还没有观看记录'), h('p', { className: 'dy-note' }, '开启自主观看后，看过的作品会按日期出现在这里。')),
          watched && !!watched.groups.length && h('div', { className: 'dy-wall' }, ...watched.groups.map(group => h('div', { key: group.day },
            h('div', { className: 'dy-dayhead' }, h('b', null, group.day), h('span', { className: 'dy-cap' }, `${group.count} 条`), h('span', { className: 'ln' })),
            h('div', { className: 'dy-grid' }, ...group.items.map(item => h('a', { key: item.videoId + item.at, className: 'dy-vitem', href: item.url || '#', onClick: event => { event.preventDefault(); if (item.url) void perform('browser', () => api.request('/browser/navigate', { url: item.url })); } },
              h(ThumbImg, { api, videoId: item.videoId }),
              h('div', { className: 'dy-vbody' }, h('div', { className: 'dy-vt' }, item.title || '无文案作品'), h('div', { className: 'dy-vn' }, `${item.tier}${item.watchedSeconds ? ` · ${item.watchedSeconds} 秒` : ''} · ${new Date(item.at).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })}${item.videoId ? ` · 编号 ${item.videoId}` : ''}`)))))))),
          watched && !!watched.groups.length && h('p', { className: 'dy-note' }, '分层来自实际观看行为：转发 > 停留观看 > 短暂停留 / 跳过；「跳过·超过 60 分钟」类长视频保留跳过标记。')),
        // 记忆管理（v6.2 视觉稿已确认）：iOS 分组列表 + 兴趣单行抽屉；删除级联并自动快照。
        category === '记忆管理' && h('div', { className: 'dy-wrap' },
          h('div', { className: 'ios-section' },
            h('div', { className: 'ios-sec-head' }, h('span', null, '记忆分区'), h('span', { className: 'sp' }), h('span', { className: 'dy-cap' }, state?.persona?.personaFolder ? '本地记忆库已就绪' : '本地记忆库读取中')),
            h('div', { className: 'ios-card' },
              h('div', { className: 'ios-row' },
                h('div', { className: 'ios-main' },
                  h('div', { className: 'dy-seg', role: 'tablist', 'aria-label': '记忆分区' },
                    ...[['interests', '兴趣'], ['character', '角色卡'], ['observations', '最近观察'], ['raw', '原始记录']].map(([key, label]) => h('button', { key, role: 'tab', type: 'button', 'aria-selected': memTab === key, onClick: () => setMemTab(key) }, label)))),
                h('div', { className: 'ios-right' },
                  state?.persona?.personaFolder && button('打开抖音', 'openMemory', () => { try { void api.request('/browser/open', {}); } catch {} }))),
              memTab === 'interests' && h('div', null,
                ...(state?.persona?.interests || []).map(item => h('details', { key: item.topic, className: 'ios-interest' },
                  h('summary', null,
                    h('span', { className: 'ios-main' },
                      h('span', { className: 'ios-t' }, item.topic),
                      h('span', { className: 'ios-s' }, `${item.counts?.like ?? 0} 正向 · ${item.counts?.dislike ?? 0} 负向 · ${item.counts?.neutral ?? 0} 待观察 · 最近：${(item.evidence || []).slice(-1).map(row => row.title || row.videoId).join('') || '暂无证据摘要'}`)),
                    h('span', { className: 'ios-right' },
                      h('span', { className: `dy-chip ${item.signal === 'like' ? 'ok' : item.signal === 'dislike' ? 'err' : 'info'}` }, h('span', { className: 'd', 'aria-hidden': 'true' }), ({ like: '感兴趣', dislike: '不感兴趣', neutral: '待观察' })[item.signal] || item.signal),
                      h('span', { className: 'ios-chev', 'aria-hidden': 'true' }, '›'))),
                  h('div', { className: 'interest-drawer' },
                    h('span', { className: 'interest-drawer-info' }, item.privacy === 'internal-reference' ? '内部参考，不对外' : '本地记录'),
                    h('span', { className: 'interest-drawer-actions' },
                      h('button', { type: 'button', className: 'dy-btn tiny', disabled: busy.has('interestForget'), onClick: () => { setMemTab('raw'); setMemoryQuery(item.topic); void perform('memorySearch', () => api.request('/memory/search', { query: item.topic }).then(value => { setMemoryResults(value); return value; })); } }, '看证据'),
                      h('button', { type: 'button', className: 'dy-btn tiny', disabled: busy.has('interestForget'), onClick: () => { void perform('interestForget', async () => { const result = await api.request('/persona/interest/forget', { topic: item.topic, signal: 'dislike' }); void refresh(true); return result; }); } }, '不感兴趣'),
                      item.signal === 'neutral' && h('button', { type: 'button', className: 'dy-btn tiny primary', disabled: busy.has('interestForget'), onClick: () => { void perform('interestForget', async () => { const result = await api.request('/persona/interest/forget', { topic: item.topic, signal: 'like' }); void refresh(true); return result; }); } }, '感兴趣'),
                      interestConfirm === item.topic ? h('button', { type: 'button', className: 'dy-btn tiny danger', disabled: busy.has('interestForget'), onClick: () => { setInterestConfirm(''); void perform('interestForget', async () => { const result = await api.request('/persona/interest/forget', { topic: item.topic }); void refresh(true); return result; }); } }, '确认删除') : h('button', { type: 'button', className: 'dy-btn tiny danger', disabled: busy.has('interestForget'), onClick: () => setInterestConfirm(item.topic) }, '删除'))))),
                !(state?.persona?.interests || []).length && h('div', { className: 'ios-row' }, h('div', { className: 'ios-main' }, h('span', { className: 'ios-t' }, '暂无兴趣记忆'), h('span', { className: 'ios-s' }, '观看并互动后会自动整理。'))),
                interestConfirm && h('p', { className: 'dy-note' }, '再点一次「确认删除」才会执行。')),
              memTab === 'character' && h('div', null,
                h('div', { className: 'ios-row' },
                  h('div', { className: 'ios-main' },
                    h('span', { className: 'ios-t' }, '人格卡正文'),
                    h('span', { className: 'ios-s' }, '这是注入给模型的人格设定；正文在「基础设置 → 人格与兴趣」里编辑。')),
                  h('div', { className: 'ios-right' }, h('span', { className: 'dy-cap' }, state?.persona?.revision ? `版本 ${String(state.persona.revision).slice(0, 8)}` : ''))),
                (state?.persona?.personaText || state?.persona?.manualText || '').trim()
                  ? h('div', { className: 'dy-inner' }, h('p', { className: 'dy-note', style: { whiteSpace: 'pre-wrap', margin: 0 } }, (state?.persona?.personaText || state?.persona?.manualText || '').trim()))
                  : h('div', { className: 'ios-row' }, h('div', { className: 'ios-main' }, h('span', { className: 'ios-t' }, '人格卡还没有正文'), h('span', { className: 'ios-s' }, '去「基础设置 → 人格与兴趣」写一段，或点「载入最新人格」。'))),
                h('div', { className: 'ios-row' },
                  h('div', { className: 'ios-main' },
                    h('span', { className: 'ios-t' }, '兴趣汇总'),
                    h('span', { className: 'ios-s' }, '观看与互动自动整理出的选题倾向；点「兴趣」分区可展开逐条处理。'))),
                ...(state?.persona?.interests || []).slice(0, 12).map(item => h('div', { key: item.topic, className: 'ios-row' },
                  h('div', { className: 'ios-main' },
                    h('span', { className: 'ios-t' }, item.topic),
                    h('span', { className: 'ios-s' }, item.basis || '按不同作品汇总的观看与互动记录。')),
                  h('div', { className: 'ios-right' },
                    h('span', { className: `dy-chip ${item.signal === 'like' ? 'ok' : item.signal === 'dislike' ? 'err' : 'info'}` }, h('span', { className: 'd', 'aria-hidden': 'true' }), ({ like: '感兴趣', dislike: '不感兴趣', neutral: '待观察' })[item.signal] || item.signal),
                    h('span', { className: 'dy-cap' }, item.privacy === 'internal-reference' ? '内部参考' : ''))))),
              memTab === 'observations' && h('div', null,
                ...(() => { const rows = (state?.persona?.recentObservations || []).slice(-20).reverse(); return rows.map(item => h('div', { key: item.evidenceId || item.videoId, className: 'ios-row' },
                  h('div', { className: 'ios-main' },
                    h('span', { className: 'ios-t' }, item.title || '无文案作品'),
                    h('span', { className: 'ios-s' }, `${item.observedAt ? new Date(item.observedAt).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}${item.author ? ` · @${item.author}` : ''}${item.videoId ? ` · 编号 ${item.videoId}` : ''}`)),
                  h('div', { className: 'ios-right' }, h('span', { className: 'ios-chev', 'aria-hidden': 'true' }, '›')))); })(),
                !(state?.persona?.recentObservations || []).length && h('div', { className: 'ios-row' }, h('div', { className: 'ios-main' }, h('span', { className: 'ios-t' }, '暂无观察记录'), h('span', { className: 'ios-s' }, '开启自主观看后，最近看过的作品会出现在这里。')))),
              memTab === 'raw' && h('div', null,
                h('div', { className: 'ios-row' },
                  h('div', { className: 'ios-main' },
                    h('span', { className: 'ios-t' }, '记忆文件夹'),
                    h('span', { className: 'ios-s' }, state?.persona?.personaFolder || '读取中…')),
                  h('div', { className: 'ios-right' }, button('复制记忆快照', 'copyMemory', () => { copyData(() => JSON.stringify({ interests: state?.persona?.interests, recentObservations: state?.persona?.recentObservations }, null, 2)); }))),
                h('div', { className: 'ios-row' },
                  h('div', { className: 'ios-main' },
                    h('span', { className: 'ios-t' }, '搜索记忆'),
                    h('span', { className: 'ios-s' }, '按文案、作者或作品编号检索本地记录')),
                  h('div', { className: 'ios-right' },
                    h('input', { className: 'dy-input w-md', 'aria-label': '记忆搜索关键词', value: memoryQuery, placeholder: '文案 / 作者 / 作品编号', disabled: !ready, onChange: event => setMemoryQuery(event.target.value), onKeyDown: event => { if (event.key === 'Enter') void perform('memorySearch', () => api.request('/memory/search', { query: memoryQuery }).then(value => { setMemoryResults(value); return value; })); } }),
                    button('搜索', 'memorySearch', () => { void perform('memorySearch', () => api.request('/memory/search', { query: memoryQuery }).then(value => { setMemoryResults(value); return value; })); }))),
                ...(memoryResults?.items || []).map(item => h('div', { key: item.evidenceId, className: 'ios-row' },
                  h('div', { className: 'ios-main' },
                    h('span', { className: 'ios-t' }, item.title || '无标题记录'),
                    h('span', { className: 'ios-s' }, `${item.author ? `@${item.author}` : ''}${item.tier ? ` · ${item.tier}` : ''}${item.videoId ? ` · 编号 ${item.videoId}` : ''}`)),
                  h('div', { className: 'ios-right' },
                    memoryConfirm === item.evidenceId ? h('button', { type: 'button', className: 'dy-btn tiny danger', disabled: busy.has('memoryForget'), onClick: () => { setMemoryConfirm(''); void perform('memoryForget', async () => { const result = await api.request('/memory/forget', { evidenceId: item.evidenceId }); setMemoryResults(old => old ? { ...old, items: old.items.filter(row => row.evidenceId !== item.evidenceId) } : old); void refresh(true); return result; }); } }, '确认删除') : h('button', { type: 'button', className: 'dy-btn tiny danger', disabled: busy.has('memoryForget'), onClick: () => setMemoryConfirm(item.evidenceId) }, '删除')))),
                memoryResults && !memoryResults.items.length && h('div', { className: 'ios-row' }, h('div', { className: 'ios-main' }, h('span', { className: 'ios-t' }, '没有匹配的记忆记录'), h('span', { className: 'ios-s' }, '换个关键词再搜一次。'))),
                memoryConfirm && h('p', { className: 'dy-note' }, '再点一次「确认删除」才会执行；删除前自动写快照到 forget-snapshots。'),
                h('div', { className: 'ios-row' }, h('div', { className: 'ios-main' }, h('span', { className: 'ios-s' }, '删除会级联清理该作品关联的兴趣证据与观看/互动样本，并同步人格卡生成区；快照保留在记忆文件夹里可查。'))))))),
        category === '公开评论' && h('div', { className: 'dy-wrap' },
          dyCard(
            h('div', { className: 'dy-card-top' }, h('h3', null, '公开评论'), dySwitch(comments.draft.enabled, { 'aria-label': '允许自主发布评论', onClick: () => comments.edit({ enabled: !comments.draft.enabled }, { immediate: true }) }), h('span', { className: 'dy-cap' }, '默认关闭')),
            h('div', { className: 'dy-row' }, h('span', { className: 'dy-label' }, '每日尝试'), h('input', { className: 'dy-input', style: { width: 70, flex: 'none' }, type: 'number', min: 1, 'aria-label': '评论每日尝试上限', value: comments.draft.dailyLimit, disabled: !ready, onChange: event => comments.edit({ dailyLimit: event.target.value }) }), h('span', { className: 'dy-cap' }, '次'),
              h('span', { className: 'dy-label' }, '每次观看'), h('input', { className: 'dy-input', style: { width: 70, flex: 'none' }, type: 'number', min: 1, 'aria-label': '评论每次观看尝试上限', value: comments.draft.perSessionLimit, disabled: !ready, onChange: event => comments.edit({ perSessionLimit: event.target.value }) }), h('span', { className: 'dy-cap' }, '次')),
            status(comments), h('p', { className: 'dy-note' }, `今日已尝试 ${state?.comments?.daily?.attempts || 0} 次。开启后按实际观察决定是否评论；不使用人格原文、私信或 QQ 内容。`),
            (state?.comments?.notSent || []).length ? h('div', { className: 'dy-tl' },
              // 这不是待办列表：这些评论已经确认没发出去，留在这里是给你看当时为什么没发。
              h('p', { className: 'dy-note', style: { margin: '0 0 6px' } }, `下面 ${state.comments.notSent.length} 条是已经确认没发出去的公开评论，附上当时的原因，不需要你再点确认。`),
              ...state.comments.notSent.slice(-10).reverse().map(item => h('div', { key: item.operationId, className: 'dy-tl-item' },
                h('span', { className: 'dy-tl-bar mention', 'aria-hidden': 'true' }),
                h('span', { className: 'dy-tl-main' },
                  h('span', { className: 'dy-tl-head' },
                    h('b', { className: 'dy-tl-topic', style: { fontWeight: 500 } }, item.title || (item.videoId ? `作品 ${item.videoId}` : '评论')),
                    h('span', { className: 'dy-chip err' }, h('span', { className: 'd', 'aria-hidden': 'true' }), '未发出'),
                    h('span', { className: 'dy-tl-meta' }, item.completedAt ? new Date(item.completedAt).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')),
                  h('span', { className: 'dy-tl-count' }, `${item.author ? `@${item.author}` : ''}${item.author && item.videoId ? ' · ' : ''}${item.videoId ? `编号 ${item.videoId}` : ''}${item.author || item.videoId ? ' · ' : ''}${item.reason || '确认未发出，未改用其他发送方式。'}`))))) : null,
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
        category === '分享记录' && h('div', { className: 'dy-wrap' },
          h('div', { className: 'ios-section' },
            h('div', { className: 'ios-sec-head' }, h('span', null, '分享过的作品列表'), h('span', { className: 'sp' }), h('span', { className: 'dy-cap' }, `今日分享 ${state?.share?.daily?.attempts || 0} 次`)),
            h('div', { className: 'ios-card' },
              // 只有「送达结果还不确定」的记录才需要人工核对；其余状态由系统自己记账，
              // 给每条都挂「已核对…」按钮只会点出后端的「没有这条待核对记录」。
              h('p', { className: 'dy-note', style: { margin: '0 0 6px' } }, '「送达未确认」「已预留，待核对」「处理中，待核对」这几种才需要你人工核对一次；「已确认送达」「未发出」是系统自己记的结果，不需要再点确认。'),
              ...(state?.share?.recent || []).slice().reverse().slice(0, 10).map(item => h('div', { key: item.operationId || item.videoId || item.startedAt, className: 'ios-row' },
                h('div', { className: 'ios-main' },
                  h('span', { className: 'ios-t' }, item.title || '没有记录标题的作品'),
                  h('span', { className: 'ios-s' }, `${item.recipientName ? `分享给 ${item.recipientName}` : '分享对象未记录'}${item.completedAt || item.startedAt ? ` · ${new Date(item.completedAt || item.startedAt).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}${shareFailureMessage(item) ? ` · ${shareFailureMessage(item)}` : ''}${item.videoId ? ` · 编号 ${item.videoId}` : ''}`)),
                h('div', { className: 'ios-right' },
                  h('span', { className: `dy-chip ${item.status === 'confirmed' ? 'ok' : ['not-sent', 'resolved-not-sent'].includes(item.status) ? 'err' : 'info'}` }, h('span', { className: 'd', 'aria-hidden': 'true' }), `${state?.share?.inProgress && state.share.activity?.operationId === item.operationId ? '正在分享' : ({ confirmed: '已确认送达', 'not-sent': '未发出', uncertain: '送达未确认', reserved: '已预留，待核对', clicking: '处理中，待核对', 'resolved-confirmed': '人工已确认送达', 'resolved-not-sent': '人工已确认未送达' }[item.status] || item.status)}`),
                  // 只有「送达结果还不确定」的记录才需要人工核对；已确认未发出的记录不需要再核对，
                  // 给它挂「已核对发送成功／已核对未发送」按钮只会点出后端的「没有这条待核对记录」。
                  ['uncertain', 'reserved', 'clicking'].includes(item.status) ? h('div', { className: 'dy-row', style: { justifyContent: 'flex-end' } },
                    h('button', { type: 'button', className: 'dy-btn tiny', onClick: () => { void perform(`shareResolve:${item.operationId}`, () => api.request('/share/resolve', { operationId: item.operationId, outcome: 'confirmed' })); } }, '已核对发送成功'),
                    h('button', { type: 'button', className: 'dy-btn tiny danger', onClick: () => { void perform(`shareResolve:${item.operationId}`, () => api.request('/share/resolve', { operationId: item.operationId, outcome: 'not-sent' })); } }, '已核对未发送')) : null)),
              !(state?.share?.recent || []).length && h('div', { className: 'ios-row' },
                h('div', { className: 'ios-main' }, h('span', { className: 'ios-t' }, '还没有分享记录'), h('span', { className: 'ios-s' }, '自主观看中看到值得分享的作品时，会发给许可名单里的好友。'))))))
        ),
        category === '自检与用量' && h('div', { className: 'dy-wrap' },
          dyCard(
            h('div', { className: 'dy-card-top' }, h('h3', null, '自检'), h('span', { className: 'sp' }), button('一键自检', 'diagnostics', () => { void perform('diagnostics', async () => { const value = await api.request('/diagnostics', {}); setDiagnostics(value); setRepairResult(''); return value; }); }), button('复制完整报告', 'copyDiagnostics', () => { copyData(() => JSON.stringify(diagnostics, null, 2)); })),
            h('p', { className: 'dy-note' }, '完整报告（含原始数据）只进剪贴板，不在界面铺开。'),
            diagnostics && h('div', { className: 'dy-inner' },
              ...((diagnostics.checks || []).map(item => h('div', { key: item.id, className: 'dy-checkrow' },
                h('span', { className: `dy-chip ${item.status === 'pass' ? 'ok' : item.status === 'warning' ? 'warn' : 'err'}` }, h('span', { className: 'd', 'aria-hidden': 'true' }), item.label),
                h('span', { className: 'dy-checkmsg' }, item.message),
                item.code ? h('span', { className: 'dy-cap' }, `（${item.code}）`) : null))),
              ...(item => (item?.resolution?.steps || []).length ? [h('p', { className: 'dy-note' }, item.resolution.steps.join('；'))] : [])((diagnostics.checks || []).find(item => item.status === 'fail')),
              ...(diagnostics.repairableActions || []).map(action => button(`修复：${action.label}`, 'diagnostics', () => { void perform('diagnostics', async () => { const value = await api.request('/diagnostics/repair', { reportId: diagnostics.reportId, action: action.id }); setDiagnostics(value.after); setRepairResult(value.message); return value; }); })),
              repairResult && h('p', { className: 'dy-note' }, repairResult),
              h('p', { className: 'dy-note' }, diagnostics?.note || '')),
          dyCard(
            h('div', { className: 'dy-card-top' }, h('h3', null, '最近前端错误'), h('span', { className: 'sp' }), button('清空', 'clearErrors', () => { try { globalThis.sessionStorage?.setItem('douyin-panel-errors', '[]'); } catch {} setPanelErrorsTick(x => x + 1); }), h('span', { className: 'dy-cap' }, '本地环形缓存 · 最近 20 条')),
            ...((() => { try { return JSON.parse(globalThis.sessionStorage?.getItem('douyin-panel-errors') || '[]'); } catch { return []; } })()).slice(0, 8).map((err, index) => dyRow(err.at ? new Date(err.at).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '', err.message)),
            !(() => { try { return JSON.parse(globalThis.sessionStorage?.getItem('douyin-panel-errors') || '[]').length; } catch { return 0; } })() && h('p', { className: 'dy-note' }, '暂无前端错误记录。')),
          dyCard(
            h('div', { className: 'dy-card-top' }, h('h3', null, '今日预算'), h('span', { className: 'sp' }), h('span', { className: 'dy-foot' }, state?.usage?.today?.date || '')),
            h('div', { className: 'dy-kv' }, h('span', { className: 'k' }, '观看时长'), (() => { const used = Math.floor((state?.video?.daily?.usedSeconds || 0) / 60), cap = state?.video?.policy?.dailyMinutes; return h('span', { style: { flex: 1, minWidth: 0 } }, h('span', { style: { fontWeight: 600 } }, String(used)), ` / ${cap ?? '不限'} 分钟`, typeof cap === 'number' && cap > 0 ? h('div', { className: 'dy-meter' }, h('i', { className: used >= cap ? 'warn' : '', style: { width: `${Math.min(100, Math.round(used * 100 / cap))}%` } })) : null); })()),
            h('div', { className: 'dy-kv' }, h('span', { className: 'k' }, '模型请求'), (() => { const used = state?.video?.daily?.requests || 0, cap = state?.video?.policy?.dailyRequests; return h('span', { style: { flex: 1, minWidth: 0 } }, h('span', { style: { fontWeight: 600 } }, String(used)), ` / ${cap ?? '不限'} 次`, typeof cap === 'number' && used >= cap ? '（已达上限，等待次日恢复）' : '', typeof cap === 'number' && cap > 0 ? h('div', { className: 'dy-meter' }, h('i', { className: used >= cap ? 'warn' : '', style: { width: `${Math.min(100, Math.round(used * 100 / cap))}%` } })) : null); })())),
          dyCard(
            h('div', { className: 'dy-card-top' }, h('h3', null, 'Token 明细'), h('span', { className: 'sp' }),
              h('div', { className: 'dy-seg', role: 'tablist', 'aria-label': '用量范围' },
                h('button', { type: 'button', role: 'tab', 'aria-selected': usageScope === 'today', onClick: () => setUsageScope('today') }, '今日'),
                h('button', { type: 'button', role: 'tab', 'aria-selected': usageScope === 'total', onClick: () => setUsageScope('total') }, '累计')),
              h('span', { className: 'dy-cap' }, '只统计本助手发起的模型响应')),
            h('div', { className: 'dy-stat2' },
              h('div', { className: 'dy-stat' }, h('div', { className: 'dy-stat-head' }, h('span', { className: 'k' }, 'Token 合计'), h('span', { className: 'v' }, String(usageScope === 'total' ? (state?.usage?.total?.totalTokens || 0) : (state?.usage?.today?.totalTokens || 0)))), h('div', { className: 'sub' }, usageScope === 'total' ? '最近 30 个有记录的日期合计' : (state?.usage?.today?.date || '今天'))),
              h('div', { className: 'dy-stat' }, h('div', { className: 'dy-stat-head' }, h('span', { className: 'k' }, '模型响应（次）'), h('span', { className: 'v' }, String(usageScope === 'total' ? (state?.usage?.total?.requests || 0) : (state?.usage?.today?.requests || 0)))), h('div', { className: 'sub' }, usageScope === 'total' ? '累计响应次数' : '今天发起的响应次数'))),
            h('div', { className: 'dy-kv' }, h('span', { className: 'k' }, '输入'), h('span', { className: 'v' }, String(usageScope === 'total' ? (state?.usage?.total?.promptTokens || 0) : (state?.usage?.today?.promptTokens || 0)))),
            h('div', { className: 'dy-kv' }, h('span', { className: 'k' }, '输出'), h('span', { className: 'v' }, String(usageScope === 'total' ? (state?.usage?.total?.completionTokens || 0) : (state?.usage?.today?.completionTokens || 0)))),
            h('div', { className: 'dy-kv' }, h('span', { className: 'k' }, '缓存命中'), h('span', { className: 'v' }, (usageScope === 'total' ? state?.usage?.total?.cacheReportedRequests : state?.usage?.today?.cacheReportedRequests) ? `${usageScope === 'total' ? (state?.usage?.total?.cachedTokens || 0) : (state?.usage?.today?.cachedTokens || 0)}（${usageScope === 'total' ? state.usage.total.cacheReportedRequests : state.usage.today.cacheReportedRequests} 次报告）` : '未逐次报告')),
            h('div', { className: 'dy-kv' }, h('span', { className: 'k' }, '用量未知'), h('span', { className: 'v' }, `${usageScope === 'total' ? (state?.usage?.total?.unknownRequests || 0) : (state?.usage?.today?.unknownRequests || 0)} 次 · 未报告的请求不按零消耗计`)),
            state?.usage?.inFlight > 0 && h('p', { className: 'dy-note' }, `请求中 ${state.usage.inFlight} 次，Token 等模型返回后记录。`),
            (state?.usage?.days || []).length ? h('div', { className: 'dy-inner', style: { marginTop: 8 } },
              h('div', { className: 'dy-card-top', style: { marginBottom: 4 } }, h('h3', { style: { fontSize: 12.5, margin: 0 } }, '按日明细'), h('span', { className: 'sp' }), h('span', { className: 'dy-cap' }, `最近 ${state.usage.days.length} 天`)),
              ...state.usage.days.slice().reverse().map(day => h('div', { key: day.date, className: 'ios-row' },
                h('div', { className: 'ios-main' },
                  h('span', { className: 'ios-t' }, day.date),
                  h('span', { className: 'ios-s' }, `${day.requests || 0} 次响应 · 输入 ${day.promptTokens || 0} · 输出 ${day.completionTokens || 0}`)),
                h('div', { className: 'ios-right' },
                  h('span', { className: 'ios-v' }, `${day.totalTokens || 0} Token`))))) : null,
            ...((state?.usage?.groups || []).length ? [h('div', { className: 'dy-inner', style: { marginTop: 8 } },
              h('div', { className: 'dy-card-top', style: { marginBottom: 4 } }, h('h3', { style: { fontSize: 12.5, margin: 0 } }, '分模型'), h('span', { className: 'sp' }), h('span', { className: 'dy-cap' }, '同名按场景分行')),
              ...state.usage.groups.map(item => h('div', { className: 'dy-kv' }, h('span', { className: 'k' }, item.model), h('span', { className: 'v' }, h('b', null, USAGE_KIND_LABELS[item.kind] || item.kind || '其他'), ` · ${item.requests} 次响应 · ${item.totalTokens} Token`))))] : []),
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
