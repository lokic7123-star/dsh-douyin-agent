// 样稿截图自检：暗色独立页（#dark，1000 与 560 宽）+ 浅色宿主弹窗内嵌（#light）分段截图到 measure/。
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../..', import.meta.url));
const { chromium } = await import(new URL('../../playwright-runtime.mjs', import.meta.url));
const file = pathToFileURL(path.join(root, 'docs', 'mockups', 'backlog-ui-mockup.html')).href;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const dark = await browser.newPage({ viewport: { width: 1000, height: 900 } });
await dark.goto(file);
await dark.waitForTimeout(200);
await dark.locator('#dark').screenshot({ path: path.join(root, 'docs', 'mockups', 'measure', 'mockup-dark-1000.png') });
await dark.close();
const darkNarrow = await browser.newPage({ viewport: { width: 560, height: 900 } });
await darkNarrow.goto(file);
await darkNarrow.waitForTimeout(200);
await darkNarrow.locator('#dark').screenshot({ path: path.join(root, 'docs', 'mockups', 'measure', 'mockup-dark-560.png') });
await darkNarrow.close();
const light = await browser.newPage({ viewport: { width: 760, height: 900 } });
await light.goto(file);
await light.waitForTimeout(200);
await light.locator('#light').screenshot({ path: path.join(root, 'docs', 'mockups', 'measure', 'mockup-light-dialog.png') });
// 验收用全量截图：临时解除弹窗内容区滚动高度（HTML 本身保留滚动行为），展示全部卡片
await light.addStyleTag({ content: '.dialog-body{max-height:none!important;overflow:visible!important}' });
await light.waitForTimeout(120);
await light.locator('#light').screenshot({ path: path.join(root, 'docs', 'mockups', 'measure', 'mockup-light-dialog-full.png') });
await light.close();
await browser.close();
console.log('done');
