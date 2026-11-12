import assert from 'node:assert/strict';
import test from 'node:test';

import { IDLE_HOST_REAP_MS, idleHostDecision } from '../browser-host.mjs';

const page = (url, { closed = false, visible = false } = {}) => ({
  isClosed: () => closed,
  url: () => url,
  isVisible: () => visible,
});

test('空闲回收：没有打开的页面且超过时限才回收', () => {
  const now = Date.now();
  const decision = idleHostDecision({ pages: [], idleSince: now - IDLE_HOST_REAP_MS - 1_000, now });
  assert.equal(decision.reap, true);
  assert.equal(decision.active, false);
  assert.match(decision.reason, /回收/);
});

test('空闲回收：还没到时限不回收', () => {
  const now = Date.now();
  const decision = idleHostDecision({ pages: [], idleSince: now - 1_000, now });
  assert.equal(decision.reap, false);
  assert.equal(decision.active, false);
  assert.match(decision.reason, /还没到空闲时限/);
});

test('空闲回收：还有打开的页面就不回收，并视为活跃', () => {
  const now = Date.now();
  const decision = idleHostDecision({
    pages: [page('about:blank'), page('https://www.douyin.com/video/123')],
    idleSince: now - IDLE_HOST_REAP_MS - 1_000,
    now,
  });
  assert.equal(decision.reap, false);
  assert.equal(decision.active, true);
  assert.match(decision.reason, /打开的页面/);
});

test('空闲回收：只有 about:blank 时仍按无页面处理，但可见页面不算空闲', () => {
  const now = Date.now();
  const blank = idleHostDecision({ pages: [page('about:blank')], idleSince: now - IDLE_HOST_REAP_MS - 1_000, now });
  assert.equal(blank.reap, true);
  const visible = idleHostDecision({
    pages: [page('about:blank', { visible: true })],
    idleSince: now - IDLE_HOST_REAP_MS - 1_000,
    now,
    isVisible: candidate => candidate.isVisible() === true,
  });
  assert.equal(visible.reap, false);
  assert.equal(visible.active, true);
});

test('空闲回收：关闭的页面不算打开的页面，时限外仍可回收', () => {
  const now = Date.now();
  const decision = idleHostDecision({
    pages: [page('https://www.douyin.com/video/123', { closed: true })],
    idleSince: now - IDLE_HOST_REAP_MS - 1_000,
    now,
  });
  assert.equal(decision.reap, true);
});

test('空闲回收：关闭空闲回收开关后永不回收', () => {
  const now = Date.now();
  const decision = idleHostDecision({ pages: [], idleMs: 0, idleSince: now - 10 * IDLE_HOST_REAP_MS, now });
  assert.equal(decision.reap, false);
  assert.match(decision.reason, /未启用空闲回收/);
});
