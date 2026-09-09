# Changelog

## 0.6.0

- Add **Git Awareness** as a separate layer on top of the existing v0.5 tracking core.
- Add a Git-aware **Since Commit** counter derived from CodeDelta's observed Workspace activity rather than raw `git diff` output.
- Use VS Code's built-in Git extension API for repository, branch, and HEAD context without adding runtime npm dependencies.
- Add independent checkpoints for multi-repository workspaces; tracked files are assigned to the most specific containing Git root.
- Record recent observed HEAD boundaries with CodeDelta added/removed/activity totals when meaningful work occurred.
- Handle detached HEAD and Git-unavailable environments without breaking the main CodeDelta tracker.
- Rebase Git checkpoints automatically when the core Workspace counter is explicitly reset and becomes non-monotonic.
- Add rename-aware checkpoint subtraction so cumulative file records do not normally reappear as fresh work after a move.
- Add a dedicated Git status-bar counter, bottom-panel Git Awareness view, full Git dashboard, and manual checkpoint-reset command.
- Add `codeDelta.showGitStatus` and bounded `codeDelta.gitHistoryLimit` settings.
- Add Git calculation and graceful-fallback tests, and extend CI syntax checks to all v0.6 modules.
- Switch the extension entry point to `bootstrap.js`, which composes the unchanged core tracker with the Git Awareness addon.

## 0.5.4

- Improve external same-line diff accuracy with bounded Myers insert/delete distance.
- Fix folder-delete expansion so tracked child files are processed before Development filtering rejects the directory URI.
- Separate editor baselines from on-disk snapshots and synchronize disk state on save/clean reload to reduce double counting.
- Add a 64 MiB default total external snapshot cache budget and visible Live/Indexing/Partial/Editor-only health state.
- Debounce UI aggregation and update panel/dashboard through `postMessage` instead of replacing the entire webview HTML per edit.
- Rename the UI's distinct `Modified` file count to `Edited files` for clarity.
- Increase persistence debounce to reduce write churn while typing.
- Keep test sources out of the packaged VSIX and remove duplicate license payloads.

## 0.5.3

- Lock tracking policy to **Development**; there is no mode selector.
- Count source code, project configuration/build files, and project documentation.
- Ignore generic Plain Text / CSV / log-style files by default.
- Ignore common generated artifacts such as lockfiles, minified JS/CSS, and source maps.
- Untitled documents count only when VS Code assigns a development language such as Python, C, Rust, or TypeScript.
- Preserve all existing CodeDelta counters and dashboard data; the Development filter applies to new changes after upgrading.
