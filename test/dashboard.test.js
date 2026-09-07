'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { dashboardHtml } = require('../dashboard');

test('dashboard is a stable live-update shell', () => {
  const html = dashboardHtml({ cspSource: 'vscode-webview://test' });
  assert.match(html, /CodeDelta/);
  assert.match(html, /Edited files/);
  assert.match(html, /id="languages"/);
  assert.match(html, /id="folders"/);
  assert.match(html, /id="files"/);
  assert.match(html, /window\.addEventListener\('message'/);
  assert.match(html, /vscode\.postMessage\(\{type:'ready'\}\)/);
  assert.match(html, /New files: full initial text/);
});
