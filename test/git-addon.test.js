'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function disposable() { return { dispose() {} }; }

test('Git addon degrades safely when the built-in Git extension is unavailable', async () => {
  const originalLoad = Module._load;
  const commands = [];
  const vscode = {
    StatusBarAlignment: { Left: 1 },
    ThemeColor: class ThemeColor { constructor(id) { this.id = id; } },
    MarkdownString: class MarkdownString { constructor(value) { this.value = value; } },
    ViewColumn: { Active: 1 },
    Uri: { parse(value) { return { scheme: value.startsWith('file:') ? 'file' : 'other', fsPath: value.replace(/^file:\/\//, '') }; } },
    extensions: { getExtension() { return undefined; } },
    window: {
      activeTextEditor: undefined,
      createStatusBarItem() { return { show() {}, hide() {}, dispose() {} }; },
      registerWebviewViewProvider() { return disposable(); },
      showInformationMessage: async () => undefined,
      showWarningMessage: async () => undefined,
      showQuickPick: async () => undefined,
      createWebviewPanel() { throw new Error('not expected'); },
    },
    workspace: {
      getConfiguration() { return { get(_key, fallback) { return fallback; } }; },
      createFileSystemWatcher() { return { onDidChange() {}, onDidCreate() {}, onDidDelete() {}, dispose() {} }; },
      onDidChangeTextDocument: () => disposable(),
      onDidCreateFiles: () => disposable(),
      onDidDeleteFiles: () => disposable(),
      onDidRenameFiles: () => disposable(),
      onDidSaveTextDocument: () => disposable(),
      onDidChangeConfiguration: () => disposable(),
    },
    commands: { registerCommand(name) { commands.push(name); return disposable(); } },
  };
  const statsStub = {
    sanitizeCounter(value) { return value && typeof value === 'object' ? value : { added:0, removed:0, languages:{}, files:{}, fileOps:{created:0,deleted:0,renamed:0} }; },
    formatCompact(value) { return String(value || 0); },
    formatNumber(value) { return String(value || 0); },
  };

  Module._load = function patched(request, parent, isMain) {
    if (request === 'vscode') return vscode;
    if (request === './stats' && parent?.filename?.endsWith('git-addon.js')) return statsStub;
    return originalLoad.call(this, request, parent, isMain);
  };

  const state = new Map();
  const workspaceState = {
    get(key) { return state.get(key); },
    async update(key, value) { state.set(key, value); },
  };
  const context = { workspaceState, subscriptions: [] };

  try {
    delete require.cache[require.resolve('../git-addon')];
    const addon = require('../git-addon');
    const controller = addon.activate(context);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(controller.gitAvailable, false);
    assert.match(controller.gitError, /unavailable/i);
    assert.ok(commands.includes('codedelta.showGitStats'));
    assert.ok(commands.includes('codedelta.resetGitCheckpoint'));
  } finally {
    for (const item of context.subscriptions) item.dispose?.();
    Module._load = originalLoad;
  }
});
