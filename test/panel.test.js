'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { panelHtml } = require('../panel');

test('compact panel is a stable postMessage-driven webview shell', () => {
  const html = panelHtml({ cspSource: 'vscode-webview://test' });
  assert.match(html, /id="added"/);
  assert.match(html, /id="tracking"/);
  assert.match(html, /Edited files/);
  assert.match(html, /Full dashboard/);
  assert.match(html, /window\.addEventListener\('message'/);
  assert.match(html, /vscode\.postMessage\(\{type:'ready'\}\)/);
  assert.doesNotMatch(html, /demo\/main\.py/);
});

test('package contributes a webview view in a bottom panel container', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.version, '0.5.4');
  const containers = pkg.contributes.viewsContainers.panel;
  assert.ok(containers.some((entry) => entry.id === 'codedeltaPanel'));
  const views = pkg.contributes.views.codedeltaPanel;
  assert.ok(views.some((entry) => entry.id === 'codedelta.panelView' && entry.type === 'webview'));
  assert.ok(pkg.contributes.commands.some((entry) => entry.command === 'codedelta.openPanel'));
  assert.equal(pkg.contributes.configuration.properties['codeDelta.externalSnapshotBudgetBytes'].default, 67108864);
});
