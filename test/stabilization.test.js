'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const extension = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');

test('live UI uses debounced postMessage updates instead of per-edit HTML replacement', () => {
  assert.match(extension, /function scheduleUiUpdate\(delay = 140\)/);
  assert.match(extension, /webview\.postMessage\(\{ type: 'state'/);
  const htmlAssignments = extension.match(/webview\.html\s*=/g) || [];
  assert.equal(htmlAssignments.length, 2, 'only initial panel and dashboard shells should assign webview.html');
});

test('folder delete expands cached descendants before applying file filtering', () => {
  const start = extension.indexOf('function handleDeleteEvent(event)');
  const end = extension.indexOf('async function handleRenameEvent', start);
  const body = extension.slice(start, end);
  assert.ok(body.indexOf('for (const snapshotKey of diskSnapshots.keys())') < body.indexOf('isCountableUri(uri)'), body);
  assert.match(body, /queuePendingDelete\(childUri, snapshot\)/);
});

test('editor and disk baselines are separate and saves synchronize disk state', () => {
  assert.match(extension, /const diskSnapshots = new Map\(\)/);
  assert.match(extension, /const editorSnapshots = new Map\(\)/);
  assert.match(extension, /onDidSaveTextDocument/);
  assert.match(extension, /suppressWatcherUri\(document\.uri, 1400\)/);
});

test('external snapshot cache has explicit bounded-health reporting', () => {
  assert.match(extension, /externalSnapshotBudgetBytes/);
  assert.match(extension, /snapshotHealth\.partial/);
  assert.match(extension, /Partial external tracking/);
});
