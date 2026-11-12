import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { PersonaMemory } from '../persona-memory.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-persona-panel-'));
  t.after(() => {
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('douyin-persona-panel-')) throw new Error('合成测试清理路径不符。');
    fs.rmSync(root, { recursive: true, force: true });
  });
  const memoryDir = path.join(root, 'memory');
  const store = new PersonaMemory({ memoryDir, legacyRoleCardFile: path.join(root, 'legacy-card.md') });
  return { root, memoryDir, store };
}

function state(id = '100001') {
  return { url: `https://www.douyin.com/video/${id}`, loginRequired: false, verificationRequired: false, privateChatVisible: false,
    video: { id, url: `https://www.douyin.com/video/${id}`, title: '合成抖音作品：蓝色纸船', author: '合成作者', time: 1.25, duration: 12, readyState: 4, paused: false } };
}

test('面板快照只保留每个兴趣的最后一条证据标题，且不外发完整 reflection', t => {
  const f = fixture(t); f.store.initialize();
  const receipt = f.store.recordObservation(state('100001'), { source: 'api', kind: 'dom' });
  f.store.updateAgentInterests({ evidenceId: receipt.evidenceId, topics: [{ topic: '纸船', signal: 'like' }], reflection: '很长的推理说明'.repeat(80) }, { source: 'api' });
  const full = f.store.snapshot();
  assert.ok(full.interests[0].evidence.length >= 1);
  assert.ok(full.interests[0].evidence[0].reflection.length > 500, '完整快照应保留完整 reflection');

  const panel = f.store.panelSnapshot();
  assert.equal(panel.interests[0].topic, '纸船');
  assert.equal(panel.interests[0].evidence.length, 1, '面板快照每个兴趣只保留一条证据');
  assert.equal(panel.interests[0].evidence[0].title, '合成抖音作品：蓝色纸船');
  assert.equal(panel.interests[0].evidence[0].videoId, '100001');
  assert.equal(panel.interests[0].evidence[0].reflection, undefined, '面板快照不外发 reflection');
  assert.equal(panel.interests[0].evidenceCount, full.interests[0].evidenceCount);
  assert.ok(panel.personaText.length > 0);
  assert.ok(panel.revision);
  assert.ok(Array.isArray(panel.recentObservations));
  assert.equal(panel.recentObservations[0].title, '合成抖音作品：蓝色纸船');
});

test('删除前快照只保留最近若干份，超额的旧快照自动清掉', t => {
  const f = fixture(t); f.store.initialize();
  const receipt = f.store.recordObservation(state('100001'), { source: 'api', kind: 'dom' });
  const folder = path.join(f.memoryDir, 'persona', 'forget-snapshots');
  fs.mkdirSync(folder, { recursive: true });
  for (let index = 0; index < 9; index += 1) fs.writeFileSync(path.join(folder, `2020-01-0${index + 1}-old.json`), '{}');
  const result = f.store.forgetObservation({ evidenceId: receipt.evidenceId }, { explicit: true });
  assert.equal(result.forgotten, true);
  const names = fs.readdirSync(folder).filter(name => name.endsWith('.json'));
  assert.ok(names.length <= 6, `快照份数应被裁到上限附近，实际 ${names.length}`);
  assert.ok(names.filter(name => name.includes('-old')).length <= 4, '旧快照在超额时应被清理');
});
