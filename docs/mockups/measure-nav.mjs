// 导航换行实测脚本：加载真实 client.js（未修改），在多档容器宽度下测量设置页导航行为。
// 复用 tests/native-client.test.mjs 的合成服务 + esbuild + Edge 基建；只读，不改 client.js。
// 运行：node docs/mockups/measure-nav.mjs  （产物写入 docs/mockups/measure/）
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('../..', import.meta.url));
const outDir = path.join(root, 'docs', 'mockups', 'measure');
await fs.mkdir(outDir, { recursive: true });
const require_ = createRequire(new URL('../../desktop/package.json', import.meta.url));
const local = createRequire(new URL('../../desktop/ui-api/package.json', import.meta.url));
let build, chromium;
try { ({ build } = require_('esbuild')); ({ chromium } = await import(new URL('../../playwright-runtime.mjs', import.meta.url))); local.resolve('react'); }
catch (error) { console.error('缺构建依赖：', error.message); process.exit(1); }

const source = await fs.readFile(path.join(root, 'client.js'), 'utf8');
const assets = await fs.mkdtemp(path.join(os.tmpdir(), 'douyin-nav-measure-'));
try {
  const upstream = path.join(root, 'desktop/.cache/upstream/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/client');
  await build({
    stdin: { sourcefile: 'nav-measure-harness.jsx', resolveDir: root, loader: 'jsx', contents: `import React from 'react';import{createRoot}from'react-dom/client';import * as primitives from '@native/primitives';import '@native/theme/base.css';import '@native/theme/design-platform.css';window.__ModuleLoader__={load({factory}){const plugin=factory(name=>name==='react'?React:name==='@deepseek-ai/dsh-client-ui-primitives'?primitives:(()=>{throw Error('意外依赖')})());plugin.apply({slots:{inject(name,action){action()},register(options,Component){createRoot(document.getElementById('root')).render(<Component/>);return()=>{}}}})}};const original=setInterval;window.setInterval=(fn,ms)=>original(fn,Math.min(ms,100));const script=document.createElement('script');script.src='/client.js';document.body.appendChild(script);` },
    outfile: path.join(assets, 'harness.js'), bundle: true, format: 'esm', platform: 'browser', target: 'chrome120', jsx: 'automatic',
    alias: { '@native/primitives': path.join(upstream, 'ui-primitives/src/index.ts'), '@native/theme': path.join(upstream, 'ui-theme/src/styles'), ...Object.fromEntries(['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client'].map(name => [name, local.resolve(name)])) },
    nodePaths: [path.join(root, 'desktop/ui-api/node_modules')], tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } }, loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' }, assetNames: 'assets/[name]-[hash]', minify: true,
  });
  const state = {
    token: 'nav-measure-token', persona: { manualText: '合成人格正文。', revision: 'r1', personaFolder: 'C:/合成/persona' },
    model: { configured: true, providers: [{ id: 'synthetic', name: '合成提供商' }], models: [{ provider: 'synthetic', id: 'synthetic-vision', name: '合成视觉模型' }], provider: 'synthetic', model: 'synthetic-vision' },
    video: { allowed: true, reason: '', policy: { windows: ['00:00-24:00'], dailyMinutes: 10, dailyRequests: 30 }, daily: { usedSeconds: 12, requests: 2 }, session: null },
    watch: { running: false }, schedule: { policy: { enabled: true } }, mode: { silent: false },
    comments: { enabled: false, policy: { dailyLimit: 3, perSessionLimit: 1 }, daily: { attempts: 0 }, needsReview: [] },
    share: { enabled: false, needsReview: [], unavailableRecipients: [], recent: [] },
    chat: { running: false, policy: { allowlist: [] }, contacts: [], daily: { requests: 0 } },
    media: { enabled: false, backend: 'local-whisper', backends: { mimo: { credential: { configured: false } }, minimax: { credential: { configured: false } } } },
    reports: { date: '2026-11-06', folder: 'C:/合成/reports', reports: [] },
    watchOptions: { policy: { mode: 'recommend', topics: [], exclude: [] } },
    usage: { today: { requests: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cacheReportedRequests: 0, unknownRequests: 0 }, groups: [], days: [], note: '' },
    interactions: { policy: { enabled: true }, friend: {}, presence: { status: 'online', online: true, label: '在线 · 等待消息', reason: '合成后端确认许可会话全部就绪', checkedAt: new Date().toISOString() } },
  };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost'), reply = (value, status = 200) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (url.pathname === '/') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return response.end('<!doctype html><html lang="zh-CN" data-ds-dark-theme><head><meta charset="utf-8"></head><body style="background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);padding:24px"><div id="root"></div><script type="module" src="/harness.js"></script></body></html>'); }
    if (url.pathname === '/harness.js') { response.writeHead(200, { 'content-type': 'text/javascript' }); return response.end(await fs.readFile(path.join(assets, 'harness.js'))); }
    if (url.pathname === '/client.js') { response.writeHead(200, { 'content-type': 'text/javascript' }); return response.end(source); }
    if (url.pathname === '/api/douyin-browser/state') return reply(state);
    response.writeHead(404); response.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const rows = [];
  for (const width of [1100, 900, 720, 560, 440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForSelector('[role="tablist"]');
    await page.waitForTimeout(120);
    const data = await page.evaluate(() => {
      const tablist = document.querySelector('[role="tablist"]');
      const tabs = [...tablist.querySelectorAll('[role="tab"]')];
      const tops = [...new Set(tabs.map(item => Math.round(item.getBoundingClientRect().top)))];
      const cs = getComputedStyle(tablist);
      const overflow = [];
      document.querySelectorAll('body *').forEach(item => { if (item.scrollWidth > item.clientWidth + 1) overflow.push({ tag: item.tagName, cls: (item.className && String(item.className).slice(0, 60)) || item.getAttribute('aria-label') || '', scroll: item.scrollWidth, client: item.clientWidth }); });
      return {
        viewport: document.documentElement.clientWidth,
        tabCount: tabs.length,
        tabRows: tops.length,
        tabTops: tops,
        tabWidths: tabs.map(item => `${(item.textContent || '').trim()}=${Math.round(item.getBoundingClientRect().width)}`),
        tablistWidth: Math.round(tablist.getBoundingClientRect().width),
        tablistScroll: tablist.scrollWidth,
        flexWrap: cs.flexWrap,
        overflowX: cs.overflowX,
        documentScrollW: document.documentElement.scrollWidth,
        documentClientW: document.documentElement.clientWidth,
        pageHasHScrollbar: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        overflowChain: overflow.slice(0, 8),
      };
    });
    rows.push({ width, ...data });
    await page.screenshot({ path: path.join(outDir, `nav-${width}.png`), clip: { x: 0, y: 0, width, height: 420 } });
    await page.close();
  }
  // 自然溢出滚动探针：nowrap + overflow-x，先允许压缩再看禁止压缩后的内容自然宽度
  for (const probeWidth of [720, 560, 440]) {
    const page = await browser.newPage({ viewport: { width: probeWidth, height: 900 } });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForSelector('[role="tablist"]');
    const probe = await page.evaluate(() => {
      const tablist = document.querySelector('[role="tablist"]');
      const tabs = [...tablist.querySelectorAll('[role="tab"]')];
      const before = { rows: [...new Set(tabs.map(item => Math.round(item.getBoundingClientRect().top)))].length, width: Math.round(tablist.getBoundingClientRect().width) };
      tablist.style.flexWrap = 'nowrap'; tablist.style.overflowX = 'auto';
      const squeezed = { rows: [...new Set(tabs.map(item => Math.round(item.getBoundingClientRect().top)))].length, hScroll: tablist.scrollWidth > tablist.clientWidth, scroll: tablist.scrollWidth, client: tablist.clientWidth };
      tabs.forEach(item => { item.style.flexShrink = '0'; });
      const noSqueeze = { rows: [...new Set(tabs.map(item => Math.round(item.getBoundingClientRect().top)))].length, hScroll: tablist.scrollWidth > tablist.clientWidth, scroll: tablist.scrollWidth, client: tablist.clientWidth };
      return { before, squeezed, noSqueeze, naturalContentWidth: noSqueeze.scroll };
    });
    await page.screenshot({ path: path.join(outDir, `nav-${probeWidth}-nowrap-probe.png`), clip: { x: 0, y: 0, width: probeWidth, height: 420 } });
    rows.push({ width: probeWidth, probe: 'nowrap+overflow-x 探针', ...probe });
    await page.close();
  }
  await browser.close();
  server.closeAllConnections(); server.close();
  await fs.writeFile(path.join(outDir, 'nav-measure-data.json'), JSON.stringify(rows, null, 2) + '\n');
  console.log('done');
} finally { await fs.rm(assets, { recursive: true, force: true }).catch(() => {}); }
