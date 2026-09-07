'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function disposable() { return { dispose() {} }; }

class FakeUri {
  constructor(value) {
    this.value = value;
    this.scheme = value.startsWith('file:') ? 'file' : 'untitled';
    this.fsPath = value.replace(/^file:\/\//, '');
    this.path = this.fsPath;
  }
  toString() { return this.value; }
  static file(value) { return new FakeUri(`file://${value}`); }
  static parse(value) { return new FakeUri(value); }
}

test('extension activates with the expected VS Code surface', async () => {
  const originalLoad = Module._load;
  const values = {
    displayScope: 'session', showIcon: true, countUntitled: true, exclude: [],
    trackExternalChanges: true, externalMaxFileBytes: 1048576, externalMaxFiles: 3000,
    externalSnapshotBudgetBytes: 67108864,
  };
  const vscode = {
    StatusBarAlignment: { Left: 1 },
    ThemeColor: class ThemeColor { constructor(id) { this.id = id; } },
    MarkdownString: class MarkdownString { constructor(value) { this.value = value; } },
    Uri: FakeUri,
    FileType: { File: 1 }, ConfigurationTarget: { Global: 1 }, ViewColumn: { Active: 1 },
    window: {
      createStatusBarItem() { return { show() {}, dispose() {} }; },
      registerWebviewViewProvider() { return disposable(); },
      showWarningMessage: async () => undefined,
      showInformationMessage: async () => undefined,
      showQuickPick: async () => undefined,
      createWebviewPanel() { return { visible: true, title: '', webview: { cspSource: 'x', postMessage: async () => true }, reveal() {}, onDidDispose() { return disposable(); } }; },
      showTextDocument: async () => undefined,
    },
    workspace: {
      workspaceFolders: [], textDocuments: [],
      getConfiguration() { return { get: (key, fallback) => Object.hasOwn(values, key) ? values[key] : fallback, update: async (key, value) => { values[key] = value; } }; },
      getWorkspaceFolder() { return undefined; }, asRelativePath: (uri) => uri.fsPath,
      createFileSystemWatcher() { return { onDidChange() {}, onDidCreate() {}, onDidDelete() {}, dispose() {} }; },
      onDidChangeTextDocument: disposable, onDidCreateFiles: disposable, onDidDeleteFiles: disposable,
      onDidRenameFiles: disposable, onDidOpenTextDocument: disposable, onDidSaveTextDocument: disposable,
      onDidCloseTextDocument: disposable, onDidChangeConfiguration: disposable,
      findFiles: async () => [], openTextDocument: async () => ({}),
      fs: { stat: async () => ({ type: 1, size: 0 }), readFile: async () => Buffer.alloc(0) },
    },
    commands: { registerCommand() { return disposable(); }, executeCommand: async () => undefined },
  };

  Module._load = function patched(request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return originalLoad.call(this, request, parent, isMain);
  };

  const store = { get() { return undefined; }, update: async () => undefined };
  const context = { globalState: store, workspaceState: store, subscriptions: [] };
  try {
    delete require.cache[require.resolve('../extension')];
    const extension = require('../extension');
    extension.activate(context);
    await new Promise((resolve) => setTimeout(resolve, 180));
    assert.ok(context.subscriptions.length >= 20);
  } finally {
    for (const item of context.subscriptions) item.dispose?.();
    Module._load = originalLoad;
  }
});
