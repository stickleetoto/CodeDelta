'use strict';

const vscode = require('vscode');
const path = require('node:path');
const {
  emptyCounter,
  sanitizeCounter,
  addDelta,
  renameFile,
  fileActivitySummary,
  deltaFromChanges,
  textDelta,
  sortedLanguages,
  sortedFiles,
  sortedFolders,
  filesForFolder,
  localDateKey,
  formatCompact,
  formatNumber,
  matchesAnyGlob,
} = require('./stats');
const { dashboardHtml } = require('./dashboard');
const { panelHtml } = require('./panel');
const { isDevelopmentResource, isDevelopmentLanguage } = require('./development');

const GLOBAL_TODAY_KEY = 'codedelta.today.v1';
const GLOBAL_ALL_TIME_KEY = 'codedelta.allTime.v1';
const WORKSPACE_KEY = 'codedelta.workspace.v1';
const SNAPSHOT_CONCURRENCY = 24;

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  const addedStatus = vscode.window.createStatusBarItem(
    'codedelta.status.added',
    vscode.StatusBarAlignment.Left,
    101
  );
  const removedStatus = vscode.window.createStatusBarItem(
    'codedelta.status.removed',
    vscode.StatusBarAlignment.Left,
    100
  );

  addedStatus.name = 'CodeDelta Added';
  removedStatus.name = 'CodeDelta Removed';
  addedStatus.command = 'codedelta.openPanel';
  removedStatus.command = 'codedelta.openPanel';
  addedStatus.color = new vscode.ThemeColor('gitDecoration.addedResourceForeground');
  removedStatus.color = new vscode.ThemeColor('gitDecoration.deletedResourceForeground');

  const todayStored = context.globalState.get(GLOBAL_TODAY_KEY);
  const todayKey = localDateKey();

  const state = {
    session: emptyCounter(),
    today: {
      date: todayKey,
      ...sanitizeCounter(todayStored && todayStored.date === todayKey ? todayStored : null),
    },
    workspace: sanitizeCounter(context.workspaceState.get(WORKSPACE_KEY)),
    allTime: sanitizeCounter(context.globalState.get(GLOBAL_ALL_TIME_KEY)),
  };

  /** @type {Map<string, {text: string, languageId: string}>} */
  const diskSnapshots = new Map();
  /** @type {Map<string, {text: string, languageId: string}>} */
  const editorSnapshots = new Map();
  let diskSnapshotBytes = 0;
  const snapshotHealth = { priming: false, partial: false, reason: '' };
  /** @type {Map<string, NodeJS.Timeout>} */
  const watcherTimers = new Map();
  /** @type {Map<string, {uri: vscode.Uri, snapshot: {text: string, languageId: string}, timer: NodeJS.Timeout, queuedAt: number}>} */
  const pendingDeletes = new Map();
  /** @type {Map<string, number>} */
  const suppressedWatcherUris = new Map();
  /** @type {Map<string, number>} */
  const internalCreateUris = new Map();
  let persistTimer;
  let uiTimer;
  let snapshotGeneration = 0;
  /** @type {vscode.WebviewPanel | undefined} */
  let dashboardPanel;
  /** @type {vscode.WebviewView | undefined} */
  let panelView;

  function config() {
    return vscode.workspace.getConfiguration('codeDelta');
  }

  function ensureToday() {
    const nowKey = localDateKey();
    if (state.today.date !== nowKey) {
      state.today = { date: nowKey, ...emptyCounter() };
      schedulePersist();
    }
  }

  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => void persist(), 900);
  }

  async function persist() {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = undefined;
    }

    await Promise.all([
      context.globalState.update(GLOBAL_TODAY_KEY, state.today),
      context.globalState.update(GLOBAL_ALL_TIME_KEY, state.allTime),
      context.workspaceState.update(WORKSPACE_KEY, state.workspace),
    ]);
  }

  function currentScope() {
    return config().get('displayScope', 'session');
  }

  function counterFor(scope) {
    ensureToday();
    switch (scope) {
      case 'today': return state.today;
      case 'workspace': return state.workspace;
      case 'allTime': return state.allTime;
      case 'session':
      default: return state.session;
    }
  }

  function scopeLabel(scope) {
    switch (scope) {
      case 'today': return 'Today';
      case 'workspace': return 'Workspace';
      case 'allTime': return 'All Time';
      default: return 'Session';
    }
  }

  function updateStatusBar() {
    const scope = currentScope();
    const counter = counterFor(scope);
    const showIcon = config().get('showIcon', true);
    const icon = showIcon ? '$(edit) ' : '';

    addedStatus.text = `${icon}+${formatCompact(counter.added)}`;
    removedStatus.text = `${icon}-${formatCompact(counter.removed)}`;

    addedStatus.show();
    removedStatus.show();
    scheduleUiUpdate();
  }

  function scheduleUiUpdate(delay = 140) {
    if (uiTimer) clearTimeout(uiTimer);
    uiTimer = setTimeout(() => {
      uiTimer = undefined;
      const scope = currentScope();
      const counter = counterFor(scope);
      const tooltip = buildTooltip(scope, counter);
      addedStatus.tooltip = tooltip;
      removedStatus.tooltip = tooltip;
      renderDashboard();
      renderPanelView();
    }, Math.max(0, delay));
  }

  function buildTooltip(scope, counter) {
    const languages = sortedLanguages(counter).slice(0, 5);
    const languageLines = languages.length
      ? `\n\n**Top languages**\n\n${languages.map((entry) =>
          `${prettyLanguage(entry.languageId)}: **+${formatNumber(entry.added)}** / **-${formatNumber(entry.removed)}**`
        ).join('  \n')}`
      : '';

    const activity = fileActivitySummary(counter);
    return new vscode.MarkdownString(
      `**CodeDelta — ${scopeLabel(scope)}**

` +
      `Added: **+${formatNumber(counter.added)}** chars  
` +
      `Removed: **-${formatNumber(counter.removed)}** chars  
` +
      `Net: **${signed(counter.added - counter.removed)}** chars  

` +
      `Files: **${formatNumber(activity.modified)} edited** · **${formatNumber(activity.created)} created** · ` +
      `**${formatNumber(activity.deleted)} deleted** · **${formatNumber(activity.renamed)} renamed**` +
      languageLines +
      `

Development tracking is fixed: source code, project config/build files, and project docs. Generic text/data and common generated artifacts are ignored.`
    );
  }

  function isCountableDocument(document) {
    if (document.uri.scheme === 'untitled') {
      return config().get('countUntitled', true) && isDevelopmentLanguage(document.languageId);
    }
    if (document.uri.scheme !== 'file') return false;
    return isCountableUri(document.uri, document.languageId);
  }

  function isCountableUri(uri, languageId = '') {
    if (!uri || uri.scheme !== 'file') return false;
    const patterns = config().get('exclude', []);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    const candidatePath = workspaceFolder
      ? vscode.workspace.asRelativePath(uri, false)
      : uri.fsPath;
    if (matchesAnyGlob(candidatePath, patterns)) return false;
    return isDevelopmentResource(uri.fsPath, languageId);
  }

  function addToAllCounters(delta, languageId, resource = null, changeKind = 'modified') {
    ensureToday();
    const fileMeta = fileMetaForResource(resource);
    addDelta(state.session, delta.added, delta.removed, languageId, fileMeta, changeKind);
    addDelta(state.today, delta.added, delta.removed, languageId, fileMeta, changeKind);
    addDelta(state.workspace, delta.added, delta.removed, languageId, fileMeta, changeKind);
    addDelta(state.allTime, delta.added, delta.removed, languageId, fileMeta, changeKind);
    updateStatusBar();
    schedulePersist();
  }

  function renameAcrossCounters(oldUri, newUri, languageId = 'plaintext') {
    ensureToday();
    const oldKey = oldUri.toString();
    const newMeta = fileMetaForResource(newUri);
    if (!newMeta) return;
    renameFile(state.session, oldKey, newMeta, languageId);
    renameFile(state.today, oldKey, newMeta, languageId);
    renameFile(state.workspace, oldKey, newMeta, languageId);
    renameFile(state.allTime, oldKey, newMeta, languageId);
    updateStatusBar();
    schedulePersist();
  }

  function fileMetaForResource(resource) {
    if (!resource) return null;
    const uri = resource.uri || resource;
    if (!uri || !uri.scheme) return null;

    if (uri.scheme === 'untitled') {
      const label = resource.fileName ? path.basename(resource.fileName) : (uri.path || 'Untitled');
      return {
        key: uri.toString(),
        uri: uri.toString(),
        displayPath: label,
        relativePath: label,
        workspaceName: '',
        workspaceKey: '',
      };
    }

    if (uri.scheme !== 'file') return null;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (folder) {
      const relativePath = path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, '/');
      return {
        key: uri.toString(),
        uri: uri.toString(),
        displayPath: `${folder.name}/${relativePath}`,
        relativePath,
        workspaceName: folder.name,
        workspaceKey: folder.uri.toString(),
      };
    }

    const parent = path.dirname(uri.fsPath);
    return {
      key: uri.toString(),
      uri: uri.toString(),
      displayPath: uri.fsPath,
      relativePath: path.basename(uri.fsPath),
      workspaceName: path.basename(parent) || parent,
      workspaceKey: vscode.Uri.file(parent).toString(),
    };
  }

  function applyTextChange(event) {
    if (!event.contentChanges || event.contentChanges.length === 0) return;
    if (!isCountableDocument(event.document)) return;

    const key = event.document.uri.scheme === 'file' ? event.document.uri.toString() : event.document.uri.toString();
    const newText = event.document.getText();
    const delta = deltaFromChanges(event.contentChanges);
    if (delta.added === 0 && delta.removed === 0) return;

    addToAllCounters(delta, event.document.languageId || 'plaintext', event.document);
    editorSnapshots.set(key, { text: newText, languageId: event.document.languageId || 'plaintext' });

    // A clean document change usually reflects an on-disk reload (or an edit that
    // was immediately persisted). Advance the disk baseline so the watcher does not
    // count the same final state a second time. Dirty editor changes wait for save.
    if (event.document.uri.scheme === 'file' && !event.document.isDirty) {
      setDiskSnapshot(event.document.uri, newText, event.document.languageId || 'plaintext', { allowNew: true });
      suppressWatcherUri(event.document.uri, 900);
    }
  }

  function trackingStatus() {
    const external = externalTrackingEnabled();
    const budget = config().get('externalSnapshotBudgetBytes', 67108864);
    const maxFiles = config().get('externalMaxFiles', 3000);
    let detail;
    if (!external) detail = 'External disk tracking is disabled; editor changes are still counted.';
    else if (snapshotHealth.priming) detail = `Indexing workspace files… ${formatNumber(diskSnapshots.size)} cached.`;
    else if (snapshotHealth.partial) detail = `Partial external tracking: ${snapshotHealth.reason || 'snapshot limit reached'} · ${formatNumber(diskSnapshots.size)}/${formatNumber(maxFiles)} files · ${formatBytes(diskSnapshotBytes)}/${formatBytes(budget)} cache.`;
    else detail = `Live external tracking · ${formatNumber(diskSnapshots.size)} files · ${formatBytes(diskSnapshotBytes)} snapshot cache.`;
    return { external, priming: snapshotHealth.priming, partial: snapshotHealth.partial, files: diskSnapshots.size, bytes: diskSnapshotBytes, detail };
  }

  function uiPayload(scope, full = false) {
    const counter = counterFor(scope);
    const activity = fileActivitySummary(counter);
    const languages = sortedLanguages(counter).slice(0, full ? 8 : 5).map((entry) => ({
      name: prettyLanguage(entry.languageId), added: entry.added, removed: entry.removed,
    }));
    const files = sortedFiles(counter).slice(0, full ? 12 : 6).map((entry) => ({
      name: entry.displayPath, uri: entry.uri, added: entry.added, removed: entry.removed,
      detail: `${prettyLanguage(entry.languageId)} · Net ${signed(entry.added - entry.removed)}`,
    }));
    const folders = full ? sortedFolders(counter).slice(0, 8).map((entry) => ({
      name: entry.displayPath, added: entry.added, removed: entry.removed,
      detail: `${formatNumber(entry.fileKeys.length)} tracked file${entry.fileKeys.length === 1 ? '' : 's'} · Net ${signed(entry.added - entry.removed)}`,
    })) : [];

    const withPercent = (rows) => {
      const max = Math.max(1, ...rows.map((row) => row.added + row.removed));
      return rows.map((row) => ({ ...row, percent: Math.max(3, Math.min(100, Math.round(((row.added + row.removed) / max) * 100))) }));
    };

    return {
      scope,
      scopeLabel: scopeLabel(scope),
      added: counter.added,
      removed: counter.removed,
      activity,
      tracking: trackingStatus(),
      languages: withPercent(languages),
      folders: withPercent(folders),
      files: withPercent(files),
    };
  }

  function renderPanelView() {
    if (!panelView || !panelView.visible) return;
    void panelView.webview.postMessage({ type: 'state', payload: uiPayload(currentScope(), false) });
  }

  async function openPanel() {
    try {
      await vscode.commands.executeCommand('codedelta.panelView.focus');
    } catch {
      try {
        await vscode.commands.executeCommand('workbench.view.extension.codedeltaPanel');
      } catch {
        void vscode.window.showWarningMessage('CodeDelta: Unable to open the bottom panel.');
      }
    }
    renderPanelView();
  }

  async function openTrackedFile(uriString) {
    if (typeof uriString !== 'string' || !uriString) return;
    try {
      const uri = vscode.Uri.parse(uriString);
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, { preview: true, preserveFocus: false });
    } catch {
      void vscode.window.showWarningMessage('CodeDelta: That file is no longer available.');
    }
  }

  function renderDashboard() {
    if (!dashboardPanel || !dashboardPanel.visible) return;
    const scope = currentScope();
    dashboardPanel.title = `CodeDelta — ${scopeLabel(scope)}`;
    void dashboardPanel.webview.postMessage({ type: 'state', payload: uiPayload(scope, true) });
  }

  function showDashboard() {
    if (dashboardPanel) {
      dashboardPanel.reveal(vscode.ViewColumn.Active, false);
      renderDashboard();
      return;
    }

    dashboardPanel = vscode.window.createWebviewPanel(
      'codedelta.dashboard',
      `CodeDelta — ${scopeLabel(currentScope())}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [],
        retainContextWhenHidden: false,
      }
    );

    dashboardPanel.webview.html = dashboardHtml({ cspSource: dashboardPanel.webview.cspSource });
    dashboardPanel.onDidDispose(() => { dashboardPanel = undefined; }, null, context.subscriptions);
    dashboardPanel.webview.onDidReceiveMessage(async (message) => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'ready') { renderDashboard(); return; }
      if (message.type === 'scope' && ['session', 'today', 'workspace', 'allTime'].includes(message.scope)) {
        await setDisplayScope(message.scope);
        renderDashboard();
        return;
      }
      if (message.type === 'openFile' && typeof message.uri === 'string') {
        await openTrackedFile(message.uri);
      }
    }, null, context.subscriptions);

    renderDashboard();
  }

  async function showStats() {
    ensureToday();
    const scope = currentScope();
    const items = [
      statItem('session', state.session),
      statItem('today', state.today),
      statItem('workspace', state.workspace),
      statItem('allTime', state.allTime),
      {
        label: '$(folder) Folder breakdown',
        description: scopeLabel(scope),
        action: 'folders',
      },
      {
        label: '$(file-code) File breakdown',
        description: scopeLabel(scope),
        action: 'files',
      },
      {
        label: '$(symbol-keyword) Language breakdown',
        description: scopeLabel(scope),
        action: 'languages',
      },
      {
        label: '$(files) File activity',
        description: scopeLabel(scope),
        action: 'activity',
      },
      { label: '$(settings-gear) Change status bar scope', action: 'scope' },
      { label: '$(debug-restart) Reset a counter…', action: 'reset' },
    ];

    const selected = await vscode.window.showQuickPick(items, {
      title: 'CodeDelta — code change counters',
      placeHolder: 'Inspect totals, folders, files, languages, or file activity',
    });

    if (!selected) return;
    if (selected.action === 'folders') return showFolderStats(currentScope());
    if (selected.action === 'files') return showFileStats(currentScope());
    if (selected.action === 'languages') return showLanguageStats(currentScope());
    if (selected.action === 'activity') return showFileActivity(currentScope());
    if (selected.action === 'scope') return selectDisplayScope();
    if (selected.action === 'reset') return chooseReset();
    if (selected.scope) await setDisplayScope(selected.scope);
  }

  function statItem(scope, counter) {
    const net = counter.added - counter.removed;
    return {
      label: `${scope === currentScope() ? '$(check) ' : ''}${scopeLabel(scope)}`,
      description: `+${formatNumber(counter.added)}  -${formatNumber(counter.removed)}  net ${signed(net)}`,
      scope,
    };
  }

  async function showLanguageStats(scope = currentScope()) {
    const entries = sortedLanguages(counterFor(scope));
    if (!entries.length) {
      void vscode.window.showInformationMessage(`CodeDelta: No ${scopeLabel(scope).toLowerCase()} language data yet.`);
      return;
    }

    await vscode.window.showQuickPick(
      entries.map((entry) => ({
        label: prettyLanguage(entry.languageId),
        description: `+${formatNumber(entry.added)}  -${formatNumber(entry.removed)}`,
        detail: `Net ${signed(entry.added - entry.removed)} chars · VS Code language id: ${entry.languageId}`,
      })),
      {
        title: `CodeDelta — Languages · ${scopeLabel(scope)}`,
        placeHolder: 'Sorted by total change volume',
      }
    );
  }

  async function showFileActivity(scope = currentScope()) {
    const activity = fileActivitySummary(counterFor(scope));
    await vscode.window.showQuickPick([
      { label: '$(edit) Modified files', description: formatNumber(activity.modified), detail: 'Distinct tracked files with text edits in this scope' },
      { label: '$(new-file) Created', description: formatNumber(activity.created), detail: 'New text files; their initial text counts as +added' },
      { label: '$(trash) Deleted', description: formatNumber(activity.deleted), detail: 'Deleted text files; their last tracked text counts as -removed' },
      { label: '$(replace-all) Renamed / moved', description: formatNumber(activity.renamed), detail: 'Renames and moves count as zero character delta' },
      { label: '$(files) Tracked file records', description: formatNumber(activity.tracked) },
    ], {
      title: `CodeDelta — File activity · ${scopeLabel(scope)}`,
      placeHolder: 'File-system activity summary',
    });
  }

  async function showFolderStats(scope = currentScope()) {
    const counter = counterFor(scope);
    const entries = sortedFolders(counter);
    if (!entries.length) {
      void vscode.window.showInformationMessage(`CodeDelta: No ${scopeLabel(scope).toLowerCase()} folder data yet.`);
      return;
    }

    const selected = await vscode.window.showQuickPick(
      entries.map((entry) => ({
        label: `$(folder) ${entry.displayPath}`,
        description: `+${formatNumber(entry.added)}  -${formatNumber(entry.removed)}`,
        detail: `Net ${signed(entry.added - entry.removed)} chars · ${entry.fileKeys.length} tracked file${entry.fileKeys.length === 1 ? '' : 's'}`,
        folder: entry,
      })),
      {
        title: `CodeDelta — Folders · ${scopeLabel(scope)}`,
        placeHolder: 'Folder totals include all tracked descendant files',
      }
    );

    if (selected?.folder) await showFileStats(scope, selected.folder);
  }

  async function showFileStats(scope = currentScope(), folder = null) {
    const counter = counterFor(scope);
    const entries = folder ? filesForFolder(counter, folder) : sortedFiles(counter);
    if (!entries.length) {
      void vscode.window.showInformationMessage(`CodeDelta: No ${scopeLabel(scope).toLowerCase()} file data yet.`);
      return;
    }

    const selected = await vscode.window.showQuickPick(
      entries.map((entry) => ({
        label: `$(file-code) ${entry.displayPath}`,
        description: `+${formatNumber(entry.added)}  -${formatNumber(entry.removed)}`,
        detail: `Net ${signed(entry.added - entry.removed)} chars · ${prettyLanguage(entry.languageId)}${fileActivityLabel(entry)}`,
        file: entry,
      })),
      {
        title: `CodeDelta — Files · ${scopeLabel(scope)}${folder ? ` · ${folder.displayPath}` : ''}`,
        placeHolder: 'Sorted by total change volume · select a file to open it',
      }
    );

    if (!selected?.file?.uri) return;
    try {
      const uri = vscode.Uri.parse(selected.file.uri);
      if (uri.scheme === 'file' || uri.scheme === 'untitled') {
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document, { preview: true });
      }
    } catch {
      void vscode.window.showInformationMessage('CodeDelta: That file is no longer available to open.');
    }
  }

  async function selectDisplayScope() {
    const scopes = ['session', 'today', 'workspace', 'allTime'];
    const selected = await vscode.window.showQuickPick(
      scopes.map((scope) => ({ label: scopeLabel(scope), scope })),
      { title: 'CodeDelta — Status bar scope' }
    );
    if (selected) await setDisplayScope(selected.scope);
  }

  async function setDisplayScope(scope) {
    await config().update('displayScope', scope, vscode.ConfigurationTarget.Global);
    updateStatusBar();
  }

  async function chooseReset() {
    const selected = await vscode.window.showQuickPick([
      { label: 'Session', command: 'codedelta.resetSession' },
      { label: 'Today', command: 'codedelta.resetToday' },
      { label: 'Workspace', command: 'codedelta.resetWorkspace' },
      { label: 'All Time', command: 'codedelta.resetAllTime' },
    ], { title: 'CodeDelta — Reset counter' });

    if (selected) await vscode.commands.executeCommand(selected.command);
  }

  async function confirmReset(label) {
    return vscode.window.showWarningMessage(
      `Reset CodeDelta ${label} counter?`,
      { modal: true },
      'Reset'
    );
  }

  async function resetSession() {
    if (await confirmReset('Session') !== 'Reset') return;
    state.session = emptyCounter();
    updateStatusBar();
  }

  async function resetToday() {
    if (await confirmReset('Today') !== 'Reset') return;
    state.today = { date: localDateKey(), ...emptyCounter() };
    updateStatusBar();
    await persist();
  }

  async function resetWorkspace() {
    if (await confirmReset('Workspace') !== 'Reset') return;
    state.workspace = emptyCounter();
    updateStatusBar();
    await persist();
  }

  async function resetAllTime() {
    if (await confirmReset('All Time') !== 'Reset') return;
    state.allTime = emptyCounter();
    updateStatusBar();
    await persist();
  }

  function snapshotSize(text) {
    return Buffer.byteLength(String(text || ''), 'utf8');
  }

  function removeDiskSnapshot(key) {
    const existing = diskSnapshots.get(key);
    if (existing) diskSnapshotBytes = Math.max(0, diskSnapshotBytes - (existing.byteLength || snapshotSize(existing.text)));
    diskSnapshots.delete(key);
  }

  function setDiskSnapshot(uri, text, languageId = 'plaintext', options = {}) {
    const key = uri.toString();
    const byteLength = snapshotSize(text);
    const maxBytes = config().get('externalMaxFileBytes', 1048576);
    if (byteLength > maxBytes) {
      removeDiskSnapshot(key);
      return false;
    }

    const existing = diskSnapshots.get(key);
    const allowNew = options.allowNew !== false;
    if (!existing && !allowNew) return false;

    const maxFiles = config().get('externalMaxFiles', 3000);
    const budget = config().get('externalSnapshotBudgetBytes', 67108864);
    const existingSize = existing ? (existing.byteLength || snapshotSize(existing.text)) : 0;

    // Keep the most recently active file tracked. If capacity is exhausted, evict
    // older baselines and expose Partial tracking rather than silently growing RAM.
    if (!existing && diskSnapshots.size >= maxFiles) {
      const victim = diskSnapshots.keys().next().value;
      if (victim) removeDiskSnapshot(victim);
      snapshotHealth.partial = true;
      snapshotHealth.reason = `file limit reached (${formatNumber(maxFiles)})`;
    }

    let nextBytes = diskSnapshotBytes - existingSize + byteLength;
    while (nextBytes > budget && diskSnapshots.size > (existing ? 1 : 0)) {
      const victim = [...diskSnapshots.keys()].find((candidate) => candidate !== key);
      if (!victim) break;
      removeDiskSnapshot(victim);
      nextBytes = diskSnapshotBytes - (existing && diskSnapshots.has(key) ? existingSize : 0) + byteLength;
      snapshotHealth.partial = true;
      snapshotHealth.reason = `snapshot cache limit reached (${formatBytes(budget)})`;
    }

    if (nextBytes > budget) {
      removeDiskSnapshot(key);
      snapshotHealth.partial = true;
      snapshotHealth.reason = `snapshot cache limit reached (${formatBytes(budget)})`;
      return false;
    }

    if (existing) removeDiskSnapshot(key); // reinsert at the end as a simple LRU touch
    diskSnapshotBytes += byteLength;
    diskSnapshots.set(key, { text, languageId, byteLength });
    return true;
  }

  function externalTrackingEnabled() {
    return config().get('trackExternalChanges', true);
  }

  function suppressWatcherUri(uri, durationMs = 1200) {
    suppressedWatcherUris.set(uri.toString(), Date.now() + durationMs);
  }

  function isWatcherSuppressed(uri) {
    const key = uri.toString();
    const until = suppressedWatcherUris.get(key) || 0;
    if (until > Date.now()) return true;
    if (until) suppressedWatcherUris.delete(key);
    return false;
  }

  function markInternalCreate(uri, durationMs = 1500) {
    internalCreateUris.set(uri.toString(), Date.now() + durationMs);
  }

  function hasInternalCreate(uri) {
    const key = uri.toString();
    const until = internalCreateUris.get(key) || 0;
    if (until > Date.now()) return true;
    if (until) internalCreateUris.delete(key);
    return false;
  }

  function consumeInternalCreate(uri) {
    const key = uri.toString();
    const until = internalCreateUris.get(key) || 0;
    internalCreateUris.delete(key);
    return until > Date.now();
  }

  function clearWatcherTimer(key) {
    const timer = watcherTimers.get(key);
    if (timer) clearTimeout(timer);
    watcherTimers.delete(key);
  }

  function clearPendingDelete(key) {
    const pending = pendingDeletes.get(key);
    if (pending) clearTimeout(pending.timer);
    pendingDeletes.delete(key);
    return pending || null;
  }

  function hasTrackedDescendant(uri) {
    for (const snapshotKey of diskSnapshots.keys()) {
      let childUri;
      try { childUri = vscode.Uri.parse(snapshotKey); } catch { continue; }
      if (uriIsWithin(childUri, uri)) return true;
    }
    return false;
  }

  function scheduleExternalChange(uri, kind) {
    if (!externalTrackingEnabled() || isWatcherSuppressed(uri)) return;
    if (kind !== 'delete' && !isCountableUri(uri)) return;
    if (kind === 'delete' && !isCountableUri(uri) && !hasTrackedDescendant(uri)) return;
    const key = uri.toString();
    clearWatcherTimer(key);
    const delay = kind === 'create' ? 320 : 180;
    watcherTimers.set(key, setTimeout(() => {
      watcherTimers.delete(key);
      void processExternalChange(uri, kind);
    }, delay));
  }

  function queuePendingDelete(uri, snapshot) {
    const key = uri.toString();
    clearPendingDelete(key);
    const pending = {
      uri,
      snapshot,
      queuedAt: Date.now(),
      timer: setTimeout(() => commitPendingDelete(key), 750),
    };
    pendingDeletes.set(key, pending);
  }

  function commitPendingDelete(key) {
    const pending = pendingDeletes.get(key);
    if (!pending) return;
    pendingDeletes.delete(key);
    removeDiskSnapshot(key);
    const languageId = pending.snapshot.languageId || languageIdFromPath(pending.uri.fsPath);
    addToAllCounters({ added: 0, removed: pending.snapshot.text.length }, languageId, pending.uri, 'deleted');
  }

  function findExternalRenameCandidate(newUri, current) {
    if (!current.text.length) return null;
    const newFolder = vscode.workspace.getWorkspaceFolder(newUri)?.uri.toString() || '';
    let best = null;
    let bestScore = -1;

    for (const [key, pending] of pendingDeletes.entries()) {
      if (key === newUri.toString()) continue;
      if (Date.now() - pending.queuedAt > 1200) continue;
      if (pending.snapshot.text !== current.text) continue;
      const oldFolder = vscode.workspace.getWorkspaceFolder(pending.uri)?.uri.toString() || '';
      if (oldFolder !== newFolder) continue;

      let score = 0;
      if (path.dirname(pending.uri.fsPath) === path.dirname(newUri.fsPath)) score += 3;
      if (path.extname(pending.uri.fsPath).toLowerCase() === path.extname(newUri.fsPath).toLowerCase()) score += 2;
      score += Math.max(0, 1 - ((Date.now() - pending.queuedAt) / 1200));
      if (score > bestScore) {
        bestScore = score;
        best = pending;
      }
    }
    return best;
  }

  async function processExternalChange(uri, kind) {
    if (!externalTrackingEnabled() || isWatcherSuppressed(uri)) return;
    const key = uri.toString();
    const before = diskSnapshots.get(key);

    if (kind === 'delete') {
      if (before) {
        queuePendingDelete(uri, before);
        return;
      }

      // A folder deletion can be coalesced into a single watcher event. Expand it over known child diskSnapshots.
      let queuedChild = false;
      for (const [snapshotKey, snapshot] of diskSnapshots.entries()) {
        let childUri;
        try { childUri = vscode.Uri.parse(snapshotKey); } catch { continue; }
        if (childUri.toString() === key || !uriIsWithin(childUri, uri)) continue;
        queuePendingDelete(childUri, snapshot);
        queuedChild = true;
      }
      if (queuedChild) return;
      return;
    }

    if (!isCountableUri(uri)) return;
    const current = await readTextSnapshot(uri);
    if (!current) {
      if (kind !== 'create') removeDiskSnapshot(key);
      return;
    }
    const internalCreate = kind === 'create' ? consumeInternalCreate(uri) : false;

    // Some tools replace a file through delete+create at the same path. Treat that as a modification.
    const samePathDelete = clearPendingDelete(key);
    if (samePathDelete) {
      const delta = textDelta(samePathDelete.snapshot.text, current.text);
      setDiskSnapshot(uri, current.text, current.languageId, { allowNew: true });
      if (delta.added || delta.removed) {
        addToAllCounters(delta, current.languageId || samePathDelete.snapshot.languageId, uri, 'modified');
      }
      return;
    }

    if (!before) {
      if (kind === 'create') {
        const renameCandidate = findExternalRenameCandidate(uri, current);
        if (renameCandidate) {
          const oldKey = renameCandidate.uri.toString();
          clearPendingDelete(oldKey);
          removeDiskSnapshot(oldKey);
          setDiskSnapshot(uri, current.text, current.languageId, { allowNew: true });
          suppressWatcherUri(renameCandidate.uri);
          suppressWatcherUri(uri);
          renameAcrossCounters(renameCandidate.uri, uri, current.languageId || renameCandidate.snapshot.languageId);
          return;
        }
      }

      setDiskSnapshot(uri, current.text, current.languageId, { allowNew: true });
      if (kind === 'create') {
        addToAllCounters({ added: current.text.length, removed: 0 }, current.languageId, uri, 'created');
      }
      return;
    }

    if (before.text === current.text) {
      setDiskSnapshot(uri, current.text, current.languageId, { allowNew: true });
      if (kind === 'create') {
        const added = internalCreate ? 0 : current.text.length;
        addToAllCounters({ added, removed: 0 }, current.languageId || before.languageId, uri, 'created');
      }
      return;
    }

    if (kind === 'create' && before) {
      // If VS Code already delivered text-edit events for an internal create, don't count those chars twice.
      if (internalCreate) {
        setDiskSnapshot(uri, current.text, current.languageId, { allowNew: true });
        addToAllCounters({ added: 0, removed: 0 }, current.languageId || before.languageId, uri, 'created');
        return;
      }
      // For an external create that somehow became visible before the watcher ran, count the whole created file.
      setDiskSnapshot(uri, current.text, current.languageId, { allowNew: true });
      addToAllCounters({ added: current.text.length, removed: 0 }, current.languageId || before.languageId, uri, 'created');
      return;
    }

    const delta = textDelta(before.text, current.text);
    setDiskSnapshot(uri, current.text, current.languageId, { allowNew: true });
    if (delta.added || delta.removed) addToAllCounters(delta, current.languageId || before.languageId, uri, 'modified');
  }

  function uriIsWithin(candidate, parent) {
    if (candidate.scheme !== 'file' || parent.scheme !== 'file') return false;
    const relative = path.relative(parent.fsPath, candidate.fsPath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }

  function movedUri(oldParent, newParent, oldChild) {
    const relative = path.relative(oldParent.fsPath, oldChild.fsPath);
    return relative ? vscode.Uri.file(path.join(newParent.fsPath, relative)) : newParent;
  }

  async function handleKnownRename(oldUri, newUri) {
    if (!externalTrackingEnabled()) return;

    const moves = [];
    for (const [key, snapshot] of diskSnapshots.entries()) {
      let candidate;
      try { candidate = vscode.Uri.parse(key); } catch { continue; }
      if (!uriIsWithin(candidate, oldUri)) continue;
      const target = movedUri(oldUri, newUri, candidate);
      moves.push({ oldUri: candidate, newUri: target, snapshot });
    }

    // An exact file may have been opened/created too recently to be in the initial snapshot set.
    if (!moves.length && isCountableUri(newUri)) {
      const current = await readTextSnapshot(newUri);
      if (current) moves.push({ oldUri, newUri, snapshot: current });
    }

    for (const move of moves) {
      const oldKey = move.oldUri.toString();
      const newKey = move.newUri.toString();
      clearWatcherTimer(oldKey);
      clearWatcherTimer(newKey);
      clearPendingDelete(oldKey);
      clearPendingDelete(newKey);
      suppressWatcherUri(move.oldUri);
      suppressWatcherUri(move.newUri);
      removeDiskSnapshot(oldKey);
      setDiskSnapshot(move.newUri, move.snapshot.text, move.snapshot.languageId, { allowNew: true });
      renameAcrossCounters(move.oldUri, move.newUri, languageIdFromPath(move.newUri.fsPath) || move.snapshot.languageId);
    }
  }

  function handleCreateEvent(event) {
    for (const uri of event.files || []) {
      if (!isCountableUri(uri)) continue;
      markInternalCreate(uri);
      scheduleExternalChange(uri, 'create');
    }
  }

  function handleDeleteEvent(event) {
    for (const uri of event.files || []) {
      // A VS Code folder delete can arrive as one operation for the directory itself.
      // Expand it over cached child files before applying the Development file filter.
      let expanded = false;
      const children = [];
      for (const snapshotKey of diskSnapshots.keys()) {
        let childUri;
        try { childUri = vscode.Uri.parse(snapshotKey); } catch { continue; }
        if (!uriIsWithin(childUri, uri)) continue;
        children.push(childUri);
      }
      for (const childUri of children) {
        const snapshot = diskSnapshots.get(childUri.toString());
        if (snapshot) queuePendingDelete(childUri, snapshot);
        expanded = true;
      }
      if (!expanded && isCountableUri(uri)) {
        const snapshot = diskSnapshots.get(uri.toString());
        if (snapshot) queuePendingDelete(uri, snapshot);
        else scheduleExternalChange(uri, 'delete');
      }
    }
  }

  async function handleRenameEvent(event) {
    for (const pair of event.files || []) {
      await handleKnownRename(pair.oldUri, pair.newUri);
    }
  }

  async function readTextSnapshot(uri) {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      const maxBytes = config().get('externalMaxFileBytes', 1048576);
      if (stat.type !== vscode.FileType.File || stat.size > maxBytes) return null;

      const bytes = await vscode.workspace.fs.readFile(uri);
      if (looksBinary(bytes)) return null;

      const text = Buffer.from(bytes).toString('utf8');
      let languageId = languageIdFromPath(uri.fsPath);
      const open = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());
      if (open) languageId = open.languageId || languageId;
      if (!isDevelopmentResource(uri.fsPath, languageId)) return null;
      return { text, languageId, byteLength: bytes.byteLength };
    } catch {
      return null;
    }
  }

  async function primeExternalSnapshots() {
    const generation = ++snapshotGeneration;
    if (!externalTrackingEnabled() || !vscode.workspace.workspaceFolders?.length) return;

    snapshotHealth.priming = true;
    snapshotHealth.partial = false;
    snapshotHealth.reason = '';
    scheduleUiUpdate(0);

    const maxFiles = config().get('externalMaxFiles', 3000);
    const exclude = buildFindFilesExclude(config().get('exclude', []));
    const scanLimit = Math.min(50000, Math.max(maxFiles + 1, maxFiles * 8));
    let uris;
    try {
      // Scan beyond the snapshot cap because a workspace may contain many generic
      // non-Development files. The cap applies to tracked Development files, not to
      // arbitrary paths returned by findFiles.
      uris = await vscode.workspace.findFiles('**/*', exclude, scanLimit + 1);
    } catch {
      snapshotHealth.priming = false;
      snapshotHealth.partial = true;
      snapshotHealth.reason = 'workspace scan failed';
      scheduleUiUpdate(0);
      return;
    }

    const scanTruncated = uris.length > scanLimit;
    if (scanTruncated) uris = uris.slice(0, scanLimit);
    uris = uris.filter((uri) => isCountableUri(uri));
    if (uris.length > maxFiles) {
      snapshotHealth.partial = true;
      snapshotHealth.reason = `file limit reached (${formatNumber(maxFiles)})`;
      uris = uris.slice(0, maxFiles);
    } else if (scanTruncated) {
      snapshotHealth.partial = true;
      snapshotHealth.reason = `workspace scan cap reached (${formatNumber(scanLimit)} paths)`;
    }

    let cursor = 0;
    async function worker() {
      while (cursor < uris.length && generation === snapshotGeneration && externalTrackingEnabled()) {
        const index = cursor++;
        const uri = uris[index];
        if (diskSnapshots.has(uri.toString())) continue;
        const current = await readTextSnapshot(uri);
        if (current) setDiskSnapshot(uri, current.text, current.languageId, { allowNew: true });
      }
    }

    await Promise.all(Array.from({ length: Math.min(SNAPSHOT_CONCURRENCY, uris.length || 1) }, worker));
    if (generation === snapshotGeneration) {
      snapshotHealth.priming = false;
      scheduleUiUpdate(0);
    }
  }

  function restartExternalSnapshots() {
    snapshotGeneration += 1;
    diskSnapshots.clear();
    diskSnapshotBytes = 0;
    snapshotHealth.priming = false;
    snapshotHealth.partial = false;
    snapshotHealth.reason = '';
    for (const pending of pendingDeletes.values()) clearTimeout(pending.timer);
    pendingDeletes.clear();
    suppressedWatcherUris.clear();
    internalCreateUris.clear();
    if (externalTrackingEnabled()) void primeExternalSnapshots();
    else scheduleUiUpdate(0);
  }

  const panelProvider = vscode.window.registerWebviewViewProvider(
    'codedelta.panelView',
    {
      resolveWebviewView(webviewView) {
        panelView = webviewView;
        webviewView.webview.options = {
          enableScripts: true,
          localResourceRoots: [],
        };
        webviewView.webview.html = panelHtml({ cspSource: webviewView.webview.cspSource });

        webviewView.onDidDispose(() => {
          if (panelView === webviewView) panelView = undefined;
        }, null, context.subscriptions);

        webviewView.webview.onDidReceiveMessage(async (message) => {
          if (!message || typeof message !== 'object') return;
          if (message.type === 'ready') { renderPanelView(); return; }
          if (message.type === 'scope' && ['session', 'today', 'workspace', 'allTime'].includes(message.scope)) {
            await setDisplayScope(message.scope);
            return;
          }
          if (message.type === 'openFile') {
            await openTrackedFile(message.uri);
            return;
          }
          if (message.type === 'fullDashboard') {
            showDashboard();
          }
        }, null, context.subscriptions);

        renderPanelView();
      },
    },
    { webviewOptions: { retainContextWhenHidden: true } }
  );

  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  watcher.onDidChange((uri) => scheduleExternalChange(uri, 'change'), null, context.subscriptions);
  watcher.onDidCreate((uri) => scheduleExternalChange(uri, 'create'), null, context.subscriptions);
  watcher.onDidDelete((uri) => scheduleExternalChange(uri, 'delete'), null, context.subscriptions);

  context.subscriptions.push(
    addedStatus,
    removedStatus,
    watcher,
    panelProvider,
    vscode.workspace.onDidChangeTextDocument(applyTextChange),
    vscode.workspace.onDidCreateFiles(handleCreateEvent),
    vscode.workspace.onDidDeleteFiles(handleDeleteEvent),
    vscode.workspace.onDidRenameFiles((event) => void handleRenameEvent(event)),
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (!isCountableDocument(document)) return;
      editorSnapshots.set(document.uri.toString(), { text: document.getText(), languageId: document.languageId || 'plaintext' });
      if (document.uri.scheme === 'file' && !document.isDirty) {
        setDiskSnapshot(document.uri, document.getText(), document.languageId || 'plaintext', { allowNew: true });
      }
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.uri.scheme !== 'file' || !isCountableDocument(document)) return;
      const text = document.getText();
      editorSnapshots.set(document.uri.toString(), { text, languageId: document.languageId || 'plaintext' });
      setDiskSnapshot(document.uri, text, document.languageId || 'plaintext', { allowNew: true });
      // Let a pending VS Code create event finish so file activity gets its one
      // Created record. Ordinary saves suppress the watcher to avoid recounting.
      if (!hasInternalCreate(document.uri)) {
        clearWatcherTimer(document.uri.toString());
        clearPendingDelete(document.uri.toString());
        suppressWatcherUri(document.uri, 1400);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      editorSnapshots.delete(document.uri.toString());
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('codeDelta')) return;
      updateStatusBar();
      if (
        event.affectsConfiguration('codeDelta.trackExternalChanges') ||
        event.affectsConfiguration('codeDelta.externalMaxFileBytes') ||
        event.affectsConfiguration('codeDelta.externalMaxFiles') ||
        event.affectsConfiguration('codeDelta.externalSnapshotBudgetBytes') ||
        event.affectsConfiguration('codeDelta.exclude')
      ) restartExternalSnapshots();
    }),
    vscode.commands.registerCommand('codedelta.openPanel', openPanel),
    vscode.commands.registerCommand('codedelta.showDashboard', showDashboard),
    vscode.commands.registerCommand('codedelta.showStats', showStats),
    vscode.commands.registerCommand('codedelta.showLanguageStats', () => showLanguageStats(currentScope())),
    vscode.commands.registerCommand('codedelta.showFolderStats', () => showFolderStats(currentScope())),
    vscode.commands.registerCommand('codedelta.showFileStats', () => showFileStats(currentScope())),
    vscode.commands.registerCommand('codedelta.showFileActivity', () => showFileActivity(currentScope())),
    vscode.commands.registerCommand('codedelta.selectDisplayScope', selectDisplayScope),
    vscode.commands.registerCommand('codedelta.resetSession', resetSession),
    vscode.commands.registerCommand('codedelta.resetToday', resetToday),
    vscode.commands.registerCommand('codedelta.resetWorkspace', resetWorkspace),
    vscode.commands.registerCommand('codedelta.resetAllTime', resetAllTime),
    {
      dispose: () => {
        if (persistTimer) clearTimeout(persistTimer);
        if (uiTimer) clearTimeout(uiTimer);
        for (const timer of watcherTimers.values()) clearTimeout(timer);
        watcherTimers.clear();
        for (const pending of pendingDeletes.values()) clearTimeout(pending.timer);
        pendingDeletes.clear();
        suppressedWatcherUris.clear();
        internalCreateUris.clear();
        void persist();
      },
    }
  );

  updateStatusBar();
  void primeExternalSnapshots();
}

function buildFindFilesExclude(patterns) {
  const clean = (patterns || []).filter(Boolean).map(String);
  if (!clean.length) return undefined;
  if (clean.length === 1) return clean[0];
  return `{${clean.join(',')}}`;
}

function looksBinary(bytes) {
  const length = Math.min(bytes.length, 8192);
  if (!length) return false;
  let suspicious = 0;
  for (let i = 0; i < length; i += 1) {
    const value = bytes[i];
    if (value === 0) return true;
    if (value < 7 || (value > 13 && value < 32)) suspicious += 1;
  }
  return suspicious / length > 0.1;
}

function languageIdFromPath(filePath) {
  const normalized = String(filePath || '').toLowerCase();
  const name = normalized.split(/[\\/]/).pop() || normalized;

  const exact = {
    'dockerfile': 'dockerfile',
    'makefile': 'makefile',
    'cmakelists.txt': 'cmake',
    '.gitignore': 'ignore',
    '.env': 'dotenv',
  };
  if (exact[name]) return exact[name];

  const index = name.lastIndexOf('.');
  const ext = index >= 0 ? name.slice(index) : '';
  const map = {
    '.py': 'python', '.pyw': 'python', '.pyi': 'python',
    '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.jsx': 'javascriptreact', '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'typescriptreact',
    '.c': 'c', '.h': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hh': 'cpp',
    '.cs': 'csharp', '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin',
    '.rs': 'rust', '.go': 'go', '.swift': 'swift', '.dart': 'dart', '.lua': 'lua', '.rb': 'ruby', '.php': 'php',
    '.sh': 'shellscript', '.bash': 'shellscript', '.zsh': 'shellscript', '.ps1': 'powershell', '.bat': 'bat', '.cmd': 'bat',
    '.html': 'html', '.htm': 'html', '.css': 'css', '.scss': 'scss', '.sass': 'sass', '.less': 'less',
    '.vue': 'vue', '.svelte': 'svelte',
    '.json': 'json', '.jsonc': 'jsonc', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.xml': 'xml',
    '.md': 'markdown', '.mdx': 'mdx', '.txt': 'plaintext', '.csv': 'csv',
    '.sql': 'sql', '.graphql': 'graphql', '.gql': 'graphql',
  };
  return map[ext] || (ext ? ext.slice(1) : 'plaintext');
}

function prettyLanguage(languageId) {
  const names = {
    plaintext: 'Plain Text', python: 'Python', javascript: 'JavaScript', javascriptreact: 'JavaScript React',
    typescript: 'TypeScript', typescriptreact: 'TypeScript React', c: 'C', cpp: 'C++', csharp: 'C#',
    java: 'Java', kotlin: 'Kotlin', rust: 'Rust', go: 'Go', swift: 'Swift', dart: 'Dart', lua: 'Lua', ruby: 'Ruby', php: 'PHP',
    shellscript: 'Shell', powershell: 'PowerShell', bat: 'Batch', html: 'HTML', css: 'CSS', scss: 'SCSS', sass: 'Sass', less: 'Less',
    vue: 'Vue', svelte: 'Svelte', json: 'JSON', jsonc: 'JSON with Comments', yaml: 'YAML', toml: 'TOML', xml: 'XML',
    markdown: 'Markdown', mdx: 'MDX', csv: 'CSV', sql: 'SQL', graphql: 'GraphQL', dockerfile: 'Dockerfile', makefile: 'Makefile', cmake: 'CMake',
  };
  return names[languageId] || languageId;
}

function fileActivityLabel(entry) {
  const activity = entry && entry.activity || {};
  const labels = [];
  if (activity.modified) labels.push('modified');
  if (activity.created) labels.push(activity.created > 1 ? `created ×${activity.created}` : 'created');
  if (activity.deleted) labels.push(activity.deleted > 1 ? `deleted ×${activity.deleted}` : 'deleted');
  if (activity.renamed) labels.push(activity.renamed > 1 ? `renamed ×${activity.renamed}` : 'renamed');
  return labels.length ? ` · ${labels.join(', ')}` : '';
}

function signed(value) {
  return value >= 0 ? `+${formatNumber(value)}` : `-${formatNumber(Math.abs(value))}`;
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${Math.floor(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round((bytes / 1024) * 10) / 10} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MiB`;
  return `${Math.round((bytes / (1024 * 1024 * 1024)) * 10) / 10} GiB`;
}

function deactivate() {}

module.exports = { activate, deactivate, looksBinary, languageIdFromPath, buildFindFilesExclude };
