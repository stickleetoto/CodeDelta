'use strict';

const vscode = require('vscode');
const path = require('node:path');
const {
  sanitizeCounter,
  formatCompact,
  formatNumber,
} = require('./stats');
const {
  emptyCounter,
  filterCounter,
  subtractCounters,
  mergeCounters,
  isCounterMonotonic,
  activitySummary,
  shortSha,
  normalizeBranch,
  compactHistory,
} = require('./git');
const { gitPanelHtml } = require('./git-panel');

const CORE_WORKSPACE_KEY = 'codedelta.workspace.v1';
const GIT_STATE_KEY = 'codedelta.git.v1';
const BOUNDARY_SETTLE_MS = 1050;
const UI_SETTLE_MS = 1100;

let activeController;

function activate(context) {
  const controller = new GitAwarenessController(context);
  activeController = controller;
  context.subscriptions.push(controller);
  void controller.start();
  return controller;
}

function deactivate() {
  activeController?.dispose();
  activeController = undefined;
}

class GitAwarenessController {
  constructor(context) {
    this.context = context;
    this.store = sanitizeStore(context.workspaceState.get(GIT_STATE_KEY));
    this.repositories = new Map();
    this.repoDisposables = new Map();
    this.boundaryTimers = new Map();
    this.generalDisposables = [];
    this.persistTimer = undefined;
    this.uiTimer = undefined;
    this.gitAvailable = false;
    this.gitError = '';
    this.gitApi = undefined;
    this.panelView = undefined;
    this.dashboardPanel = undefined;

    this.status = vscode.window.createStatusBarItem(
      'codedelta.git.sinceCommit',
      vscode.StatusBarAlignment.Left,
      99
    );
    this.status.name = 'CodeDelta Git Since Commit';
    this.status.command = 'codedelta.showGitStats';
    this.status.color = new vscode.ThemeColor('gitDecoration.modifiedResourceForeground');
    this.generalDisposables.push(this.status);

    this.registerSurface();
  }

  config() {
    return vscode.workspace.getConfiguration('codeDelta');
  }

  registerSurface() {
    const panelProvider = vscode.window.registerWebviewViewProvider(
      'codedelta.gitPanelView',
      {
        resolveWebviewView: (webviewView) => {
          this.panelView = webviewView;
          webviewView.webview.options = { enableScripts: true, localResourceRoots: [] };
          webviewView.webview.html = gitPanelHtml({ cspSource: webviewView.webview.cspSource, full: false });
          const disposeView = webviewView.onDidDispose(() => {
            if (this.panelView === webviewView) this.panelView = undefined;
          });
          const receive = webviewView.webview.onDidReceiveMessage(async (message) => {
            if (!message || typeof message !== 'object') return;
            if (message.type === 'ready') this.render();
            else if (message.type === 'full') this.showDashboard();
          });
          this.generalDisposables.push(disposeView, receive);
          this.render();
        },
      },
      { webviewOptions: { retainContextWhenHidden: true } }
    );

    this.generalDisposables.push(
      panelProvider,
      vscode.commands.registerCommand('codedelta.showGitStats', () => this.showQuickStats()),
      vscode.commands.registerCommand('codedelta.showGitDashboard', () => this.showDashboard()),
      vscode.commands.registerCommand('codedelta.resetGitCheckpoint', () => this.resetCheckpoints()),
      vscode.workspace.onDidChangeTextDocument(() => this.scheduleUiRefresh()),
      vscode.workspace.onDidCreateFiles(() => this.scheduleUiRefresh()),
      vscode.workspace.onDidDeleteFiles(() => this.scheduleUiRefresh()),
      vscode.workspace.onDidRenameFiles(() => this.scheduleUiRefresh()),
      vscode.workspace.onDidSaveTextDocument(() => this.scheduleUiRefresh()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('codeDelta')) return;
        this.updateStatus();
        this.trimAllHistory();
        this.schedulePersist();
        this.render();
      })
    );

    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    watcher.onDidChange(() => this.scheduleUiRefresh(1250));
    watcher.onDidCreate(() => this.scheduleUiRefresh(1250));
    watcher.onDidDelete(() => this.scheduleUiRefresh(1250));
    this.generalDisposables.push(watcher);
  }

  async start() {
    try {
      const extension = vscode.extensions?.getExtension?.('vscode.git');
      if (!extension) {
        this.gitAvailable = false;
        this.gitError = 'VS Code Git extension is unavailable.';
        this.render();
        return;
      }
      const exports = extension.isActive ? extension.exports : await extension.activate();
      const api = exports?.getAPI?.(1);
      if (!api) {
        this.gitAvailable = false;
        this.gitError = 'VS Code Git API is unavailable.';
        this.render();
        return;
      }

      this.gitApi = api;
      this.gitAvailable = true;
      this.gitError = '';
      for (const repo of api.repositories || []) this.attachRepository(repo);
      if (typeof api.onDidOpenRepository === 'function') {
        this.generalDisposables.push(api.onDidOpenRepository((repo) => this.attachRepository(repo)));
      }
      if (typeof api.onDidCloseRepository === 'function') {
        this.generalDisposables.push(api.onDidCloseRepository((repo) => this.detachRepository(repo)));
      }
      this.render();
    } catch (error) {
      this.gitAvailable = false;
      this.gitError = `Git integration failed: ${error && error.message ? error.message : String(error)}`;
      this.render();
    }
  }

  attachRepository(repo) {
    if (!repo?.rootUri) return;
    const key = repo.rootUri.toString();
    if (this.repositories.has(key)) {
      this.syncRepositoryContext(key);
      return;
    }

    this.repositories.set(key, {
      repo,
      key,
      rootUri: repo.rootUri,
      rootFsPath: repo.rootUri.fsPath,
      name: path.basename(repo.rootUri.fsPath) || repo.rootUri.fsPath,
      head: '',
      branch: 'unknown',
      detached: false,
    });

    if (repo.state && typeof repo.state.onDidChange === 'function') {
      const disposable = repo.state.onDidChange(() => this.scheduleBoundaryCheck(key));
      this.repoDisposables.set(key, disposable);
    }

    this.syncRepositoryContext(key, true);
  }

  detachRepository(repo) {
    if (!repo?.rootUri) return;
    const key = repo.rootUri.toString();
    this.repoDisposables.get(key)?.dispose?.();
    this.repoDisposables.delete(key);
    const timer = this.boundaryTimers.get(key);
    if (timer) clearTimeout(timer);
    this.boundaryTimers.delete(key);
    this.repositories.delete(key);
    this.render();
  }

  scheduleBoundaryCheck(key) {
    const previous = this.boundaryTimers.get(key);
    if (previous) clearTimeout(previous);
    this.boundaryTimers.set(key, setTimeout(() => {
      this.boundaryTimers.delete(key);
      this.syncRepositoryContext(key, false);
    }, BOUNDARY_SETTLE_MS));
  }

  syncRepositoryContext(key, initial = false) {
    const runtime = this.repositories.get(key);
    if (!runtime) return;
    const head = String(runtime.repo.state?.HEAD?.commit || '');
    const rawBranch = String(runtime.repo.state?.HEAD?.name || '');
    const detached = Boolean(head && !rawBranch);
    const branch = normalizeBranch(rawBranch, detached);
    runtime.head = head;
    runtime.branch = branch;
    runtime.detached = detached;

    if (!head) {
      this.render();
      return;
    }

    const current = this.repoCounter(key);
    let record = this.store.repos[key];
    if (!record || !record.head) {
      record = {
        root: key,
        head,
        branch,
        detached,
        baseline: current,
        history: compactHistory(record?.history, this.historyLimit()),
        observedAt: Date.now(),
      };
      this.store.repos[key] = record;
      this.schedulePersist();
      this.render();
      return;
    }

    if (record.head !== head) {
      const previousDelta = subtractCounters(current, record.baseline || emptyCounter());
      const activity = activitySummary(previousDelta);
      if (previousDelta.added || previousDelta.removed || activity.created || activity.deleted || activity.renamed || activity.modified) {
        record.history = compactHistory([
          ...(record.history || []),
          {
            repo: runtime.name,
            root: key,
            head: shortSha(record.head),
            fullHead: record.head,
            branch: record.branch || 'unknown',
            endedAt: Date.now(),
            added: previousDelta.added,
            removed: previousDelta.removed,
            activity,
          },
        ], this.historyLimit());
      }
      const previousBranch = record.branch;
      record.head = head;
      record.branch = branch;
      record.detached = detached;
      record.baseline = current;
      record.lastBoundaryAt = Date.now();
      record.boundaryKind = previousBranch !== branch ? 'checkout' : 'head-change';
      this.schedulePersist();
      this.render();
      return;
    }

    if (!isCounterMonotonic(current, record.baseline || emptyCounter())) {
      // Core workspace counters can be explicitly reset. Rebase the Git checkpoint
      // rather than waiting for cumulative totals to climb back above the old baseline.
      record.baseline = current;
      record.rebasedAt = Date.now();
      this.schedulePersist();
    }
    record.branch = branch;
    record.detached = detached;
    if (!initial) this.schedulePersist();
    this.render();
  }

  historyLimit() {
    return Math.max(5, Math.min(200, Math.floor(this.config().get('gitHistoryLimit', 30))));
  }

  trimAllHistory() {
    for (const record of Object.values(this.store.repos)) {
      record.history = compactHistory(record.history, this.historyLimit());
    }
  }

  workspaceCounter() {
    return sanitizeCounter(this.context.workspaceState.get(CORE_WORKSPACE_KEY));
  }

  repositoryKeyForFile(file) {
    if (!file?.uri) return '';
    let filePath;
    try {
      const uri = vscode.Uri.parse(file.uri);
      if (uri.scheme !== 'file') return '';
      filePath = uri.fsPath;
    } catch {
      return '';
    }

    let winner = '';
    let winnerLength = -1;
    for (const runtime of this.repositories.values()) {
      if (!pathIsWithin(filePath, runtime.rootFsPath)) continue;
      if (runtime.rootFsPath.length > winnerLength) {
        winner = runtime.key;
        winnerLength = runtime.rootFsPath.length;
      }
    }
    return winner;
  }

  repoCounter(key, workspaceCounter = undefined) {
    const source = workspaceCounter || this.workspaceCounter();
    return filterCounter(source, (file) => this.repositoryKeyForFile(file) === key);
  }

  repoSince(key, workspaceCounter = undefined) {
    const current = this.repoCounter(key, workspaceCounter);
    const record = this.store.repos[key];
    if (!record?.head) return emptyCounter();
    if (!isCounterMonotonic(current, record.baseline || emptyCounter())) return emptyCounter();
    return subtractCounters(current, record.baseline || emptyCounter());
  }

  payload() {
    const workspace = this.workspaceCounter();
    const repos = [];
    const sinceCounters = [];
    for (const runtime of this.repositories.values()) {
      const since = this.repoSince(runtime.key, workspace);
      sinceCounters.push(since);
      const activity = activitySummary(since);
      repos.push({
        key: runtime.key,
        root: runtime.rootFsPath,
        name: runtime.name,
        branch: runtime.branch,
        head: shortSha(runtime.head),
        detached: runtime.detached,
        added: since.added,
        removed: since.removed,
        ...activity,
      });
    }

    const aggregate = mergeCounters(sinceCounters);
    const activity = activitySummary(aggregate);
    const primary = this.primaryRepository(repos);
    const history = [];
    for (const runtime of this.repositories.values()) {
      for (const item of this.store.repos[runtime.key]?.history || []) history.push(item);
    }
    history.sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));

    return {
      available: this.gitAvailable,
      error: this.gitError,
      repoCount: repos.length,
      primary,
      added: aggregate.added,
      removed: aggregate.removed,
      activity,
      repos: sortRepos(repos, primary?.key),
      history: history.slice(0, Math.min(12, this.historyLimit())),
      note: repos.length
        ? 'Since Commit is derived from CodeDelta observed workspace counters. Each repository resets independently when its HEAD changes.'
        : 'Open a Git-backed workspace to enable per-commit CodeDelta activity.',
    };
  }

  primaryRepository(repos) {
    const activeUri = vscode.window.activeTextEditor?.document?.uri;
    if (activeUri?.scheme === 'file') {
      const matches = repos.filter((repo) => pathIsWithin(activeUri.fsPath, repo.root));
      matches.sort((a, b) => b.root.length - a.root.length);
      if (matches.length) return matches[0];
    }
    return repos[0] || null;
  }

  scheduleUiRefresh(delay = UI_SETTLE_MS) {
    if (this.uiTimer) clearTimeout(this.uiTimer);
    this.uiTimer = setTimeout(() => {
      this.uiTimer = undefined;
      this.reconcileResetBaselines();
      this.render();
    }, Math.max(0, delay));
  }

  reconcileResetBaselines() {
    const workspace = this.workspaceCounter();
    let changed = false;
    for (const runtime of this.repositories.values()) {
      const record = this.store.repos[runtime.key];
      if (!record?.head) continue;
      const current = this.repoCounter(runtime.key, workspace);
      if (!isCounterMonotonic(current, record.baseline || emptyCounter())) {
        record.baseline = current;
        record.rebasedAt = Date.now();
        changed = true;
      }
    }
    if (changed) this.schedulePersist();
  }

  render() {
    this.updateStatus();
    const payload = this.payload();
    if (this.panelView?.visible) void this.panelView.webview.postMessage({ type: 'state', payload });
    if (this.dashboardPanel?.visible) void this.dashboardPanel.webview.postMessage({ type: 'state', payload });
  }

  updateStatus() {
    if (!this.config().get('showGitStatus', true)) {
      this.status.hide();
      return;
    }
    const data = this.payload();
    if (!data.available || !data.repoCount) {
      this.status.hide();
      return;
    }
    this.status.text = `$(git-commit) +${formatCompact(data.added)} -${formatCompact(data.removed)}`;
    const primary = data.primary;
    this.status.tooltip = new vscode.MarkdownString(
      `**CodeDelta — Since Commit**\n\n` +
      `${primary ? `**${primary.branch}** · \`${primary.head || 'no HEAD'}\`  \n` : ''}` +
      `Added: **+${formatNumber(data.added)}**  \n` +
      `Removed: **-${formatNumber(data.removed)}**  \n` +
      `Edited files: **${formatNumber(data.activity.modified)}**  \n\n` +
      `${data.repoCount} Git repositor${data.repoCount === 1 ? 'y' : 'ies'} tracked.`
    );
    this.status.show();
  }

  async showQuickStats() {
    const data = this.payload();
    if (!data.available) {
      void vscode.window.showInformationMessage(`CodeDelta: ${data.error || 'Git integration is unavailable.'}`);
      return;
    }
    if (!data.repos.length) {
      void vscode.window.showInformationMessage('CodeDelta: No Git repository detected in this workspace.');
      return;
    }

    const items = [
      {
        label: '$(git-commit) Since Commit · All repositories',
        description: `+${formatNumber(data.added)}  -${formatNumber(data.removed)}`,
        detail: `${formatNumber(data.activity.modified)} edited files · ${formatNumber(data.activity.created)} created · ${formatNumber(data.activity.deleted)} deleted`,
        action: 'dashboard',
      },
      ...data.repos.map((repo) => ({
        label: `$(repo) ${repo.name}`,
        description: `${repo.branch} · ${repo.head || 'no HEAD'}`,
        detail: `+${formatNumber(repo.added)}  -${formatNumber(repo.removed)} · ${formatNumber(repo.modified)} edited files`,
        action: 'dashboard',
      })),
      { label: '$(dashboard) Open Git dashboard', action: 'dashboard' },
      { label: '$(debug-restart) Reset Git checkpoint', action: 'reset' },
    ];
    const picked = await vscode.window.showQuickPick(items, { title: 'CodeDelta — Git Awareness', placeHolder: 'Observed activity since the current HEAD boundary' });
    if (picked?.action === 'dashboard') this.showDashboard();
    else if (picked?.action === 'reset') await this.resetCheckpoints();
  }

  showDashboard() {
    if (this.dashboardPanel) {
      this.dashboardPanel.reveal(vscode.ViewColumn.Active, false);
      this.render();
      return;
    }
    this.dashboardPanel = vscode.window.createWebviewPanel(
      'codedelta.gitDashboard',
      'CodeDelta — Git Awareness',
      vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: false }
    );
    this.dashboardPanel.webview.html = gitPanelHtml({ cspSource: this.dashboardPanel.webview.cspSource, full: true });
    const dispose = this.dashboardPanel.onDidDispose(() => { this.dashboardPanel = undefined; });
    const receive = this.dashboardPanel.webview.onDidReceiveMessage(async (message) => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'ready') this.render();
      else if (message.type === 'reset') await this.resetCheckpoints();
    });
    this.generalDisposables.push(dispose, receive);
    this.render();
  }

  async resetCheckpoints() {
    const choice = await vscode.window.showWarningMessage(
      'Reset CodeDelta Git checkpoints to the current observed counters?',
      { modal: true },
      'Reset checkpoint'
    );
    if (choice !== 'Reset checkpoint') return;
    const workspace = this.workspaceCounter();
    for (const runtime of this.repositories.values()) {
      const record = this.store.repos[runtime.key];
      if (!record?.head) continue;
      record.baseline = this.repoCounter(runtime.key, workspace);
      record.rebasedAt = Date.now();
    }
    await this.persistNow();
    this.render();
  }

  schedulePersist() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => void this.persistNow(), 450);
  }

  async persistNow() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    this.trimAllHistory();
    await this.context.workspaceState.update(GIT_STATE_KEY, this.store);
  }

  dispose() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    if (this.uiTimer) clearTimeout(this.uiTimer);
    for (const timer of this.boundaryTimers.values()) clearTimeout(timer);
    this.boundaryTimers.clear();
    for (const disposable of this.repoDisposables.values()) disposable?.dispose?.();
    this.repoDisposables.clear();
    for (const disposable of this.generalDisposables.splice(0)) disposable?.dispose?.();
    void this.persistNow();
  }
}

function sanitizeStore(value) {
  const result = { version: 1, repos: {} };
  if (!value || typeof value !== 'object' || !value.repos || typeof value.repos !== 'object') return result;
  for (const [key, record] of Object.entries(value.repos)) {
    if (!record || typeof record !== 'object') continue;
    result.repos[key] = {
      root: String(record.root || key),
      head: String(record.head || ''),
      branch: String(record.branch || 'unknown'),
      detached: Boolean(record.detached),
      baseline: sanitizeCounter(record.baseline),
      history: Array.isArray(record.history) ? record.history.filter((entry) => entry && typeof entry === 'object') : [],
      observedAt: Number(record.observedAt) || 0,
      lastBoundaryAt: Number(record.lastBoundaryAt) || 0,
      rebasedAt: Number(record.rebasedAt) || 0,
    };
  }
  return result;
}

function pathIsWithin(candidate, root) {
  if (!candidate || !root) return false;
  let child = path.resolve(candidate);
  let parent = path.resolve(root);
  if (process.platform === 'win32') {
    child = child.toLowerCase();
    parent = parent.toLowerCase();
  }
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function sortRepos(repos, primaryKey) {
  return [...repos].sort((a, b) => {
    if (a.key === primaryKey) return -1;
    if (b.key === primaryKey) return 1;
    return a.name.localeCompare(b.name);
  });
}

module.exports = { activate, deactivate, GitAwarenessController, sanitizeStore, pathIsWithin };
