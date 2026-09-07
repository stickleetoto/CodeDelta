# Changelog

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
