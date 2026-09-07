# CodeDelta

**See how much your code actually changes.**

CodeDelta is a lightweight VS Code extension that tracks development-focused text changes from both **VS Code** and external coding tools such as **Codex** and **Claude Code**.

It records added/removed characters, file activity, language totals, folders, files, and multiple time scopes without requiring a cloud service.

![CodeDelta dashboard](media/dashboard.png)

## Highlights

- Separate `+added` and `-removed` counters in the VS Code status bar.
- Compact bottom panel for quick stats and a full dashboard for deeper breakdowns.
- Session, Today, Workspace, and All Time scopes.
- Per-language, per-folder, and per-file statistics.
- Tracks created, edited, deleted, and renamed files.
- New text files count their full initial text as added characters.
- Deleted tracked text files count their last known text as removed characters.
- Renames/moves contribute zero character delta.
- Tracks edits applied inside VS Code by formatters, refactors, extensions, and coding agents.
- Optional on-disk watcher tracks direct external edits from CLI tools and coding agents.
- Bounded snapshot cache and visible tracking-health state to avoid silent partial coverage.
- Fixed **Development** policy: source code, project config/build files, and project documentation are counted; generic text/data and common generated artifacts are ignored.

## What it looks like

The status bar stays minimal:

```text
✎ +12.4k    ✎ -3.1k
```

Click either counter to open the compact bottom panel. Use **Full dashboard** for detailed language, folder, file, activity, and total breakdowns.

## Counting rules

| Change | CodeDelta behavior |
| --- | --- |
| Type/edit text in VS Code | Counts the actual inserted/removed text |
| Formatter/refactor/agent edit in VS Code | Counts through VS Code document changes |
| New external text file | Entire initial text counts as `+added` once |
| Deleted tracked text file | Last cached text counts as `-removed` |
| Rename/move | `0` character delta; rename activity increments |
| Direct CLI/agent disk edit | Diffed against the tracked disk baseline |

### Development files

Counted examples include source code, JSON/YAML/TOML/XML, `.env*`, Dockerfile, Makefile/CMake, Terraform, `package.json`, `pyproject.toml`, Markdown/MDX, README, CHANGELOG, CONTRIBUTING, and similar development files.

Ignored examples include arbitrary notes, CSV/log files, binary/media/archive files, common generated lockfiles, minified JS/CSS, source maps, and excluded build/dependency directories.

## Install from VSIX

Until CodeDelta is published to the VS Code Marketplace:

1. Download the `.vsix` from the GitHub **Releases** page.
2. In VS Code, open **Extensions**.
3. Open the `...` menu and choose **Install from VSIX...**.
4. Select the downloaded file.

## Development

No runtime npm dependencies are required by the extension.

```bash
npm test
```

For interactive testing, open this repository in VS Code and press `F5` to launch an Extension Development Host.

## Configuration

Useful settings include:

- `codeDelta.displayScope` — status-bar scope (`session`, `today`, `workspace`, `allTime`).
- `codeDelta.showIcon` — show/hide the edit icons.
- `codeDelta.exclude` — glob-like path exclusions.
- `codeDelta.trackExternalChanges` — enable direct on-disk change tracking.
- `codeDelta.externalMaxFileBytes` — per-file external snapshot limit.
- `codeDelta.externalMaxFiles` — maximum external files to snapshot.
- `codeDelta.externalSnapshotBudgetBytes` — total snapshot memory budget.

When snapshot coverage hits a configured limit, the UI reports **Partial** instead of silently pretending full coverage.

## Privacy

CodeDelta's current statistics are stored locally through VS Code extension storage. The extension does not need to upload your source code or statistics to a remote service to provide its current functionality.

## Current status

**v0.5.4 — Beta / stabilization release**

This release focuses on external-diff accuracy, folder-delete correctness, editor/disk baseline separation, bounded memory usage, and lower-cost live UI updates.

See [CHANGELOG.md](CHANGELOG.md) for details.

## Roadmap

Potential next steps:

- local Git commit/branch awareness;
- per-commit CodeDelta statistics;
- optional GitHub / pull-request integration;
- daily/weekly activity history and heatmaps.

## License

MIT. See [LICENSE](LICENSE).
