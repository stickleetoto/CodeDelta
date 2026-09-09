'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  filterCounter,
  subtractCounters,
  mergeCounters,
  isCounterMonotonic,
  activitySummary,
  shortSha,
  normalizeBranch,
  compactHistory,
} = require('../git');

function file(key, added, removed, languageId='javascript', activity={}) {
  return { key, uri:key, added, removed, languageId, activity: { created:0, deleted:0, renamed:0, modified:false, ...activity } };
}

test('filterCounter rebuilds repository-local totals from file records', () => {
  const source = { files: {
    a: file('file:///repo/a.js', 10, 2, 'javascript', { modified:true }),
    b: file('file:///other/b.py', 20, 4, 'python', { created:1 }),
  }};
  const result = filterCounter(source, (entry) => entry.uri.includes('/repo/'));
  assert.equal(result.added, 10);
  assert.equal(result.removed, 2);
  assert.deepEqual(result.languages.javascript, { added:10, removed:2 });
  assert.equal(result.fileOps.created, 0);
});

test('subtractCounters calculates observed activity since a checkpoint', () => {
  const baseline = filterCounter({ files: { a: file('file:///repo/a.js', 10, 2, 'javascript', { modified:true, created:1 }) } }, () => true);
  const current = filterCounter({ files: { a: file('file:///repo/a.js', 18, 7, 'javascript', { modified:true, created:1, renamed:1 }) } }, () => true);
  const delta = subtractCounters(current, baseline);
  assert.equal(delta.added, 8);
  assert.equal(delta.removed, 5);
  assert.equal(delta.fileOps.created, 0);
  assert.equal(delta.fileOps.renamed, 1);
  assert.equal(activitySummary(delta).modified, 1);
});

test('subtractCounters recognizes a renamed cumulative file record', () => {
  const baseline = filterCounter({ files: {
    old: file('file:///repo/old.js', 30, 8, 'javascript', { modified:true, renamed:0 }),
  }}, () => true);
  const current = filterCounter({ files: {
    next: file('file:///repo/new.js', 30, 8, 'javascript', { modified:true, renamed:1 }),
  }}, () => true);
  const delta = subtractCounters(current, baseline);
  assert.equal(delta.added, 0);
  assert.equal(delta.removed, 0);
  assert.equal(delta.fileOps.renamed, 1);
});

test('mergeCounters combines independent repositories', () => {
  const a = filterCounter({ files: { a: file('a', 3, 1, 'rust', { modified:true }) } }, () => true);
  const b = filterCounter({ files: { b: file('b', 7, 2, 'python', { created:1 }) } }, () => true);
  const merged = mergeCounters([a,b]);
  assert.equal(merged.added, 10);
  assert.equal(merged.removed, 3);
  assert.equal(Object.keys(merged.files).length, 2);
  assert.equal(merged.fileOps.created, 1);
});

test('monotonic check detects workspace counter reset', () => {
  const before = filterCounter({ files: { a: file('a', 20, 3) } }, () => true);
  const after = filterCounter({ files: { a: file('a', 2, 1) } }, () => true);
  assert.equal(isCounterMonotonic(after, before), false);
  assert.equal(isCounterMonotonic(before, after), true);
});

test('git display helpers are bounded and deterministic', () => {
  assert.equal(shortSha('0123456789abcdef'), '0123456');
  assert.equal(normalizeBranch('', true), 'detached HEAD');
  assert.deepEqual(compactHistory([1,2,3,4], 2), [3,4]);
});
