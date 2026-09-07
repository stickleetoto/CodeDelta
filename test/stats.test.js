'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  emptyCounter,
  sanitizeCounter,
  addDelta,
  renameFile,
  fileActivitySummary,
  deltaFromChanges,
  textDelta,
  boundedMyersCharDelta,
  sortedLanguages,
  sortedFiles,
  sortedFolders,
  filesForFolder,
  formatCompact,
  globToRegExp,
  matchesAnyGlob,
  localDateKey,
} = require('../stats');

function fileMeta(key, displayPath, relativePath, workspaceName = 'demo', workspaceKey = 'file:///demo') {
  return {
    key,
    uri: key,
    displayPath,
    relativePath,
    workspaceName,
    workspaceKey,
  };
}

test('counts inserted and removed UTF-16 text units', () => {
  const result = deltaFromChanges([
    { text: 'hello', rangeLength: 0 },
    { text: 'world', rangeLength: 3 },
    { text: '', rangeLength: 2 },
  ]);
  assert.deepEqual(result, { added: 10, removed: 5 });
});

test('supports multiple edits from one VS Code change event', () => {
  const result = deltaFromChanges([
    { text: 'a', rangeLength: 1 },
    { text: 'bc', rangeLength: 0 },
  ]);
  assert.deepEqual(result, { added: 3, removed: 1 });
});

test('tracks language counters alongside aggregate totals', () => {
  const counter = emptyCounter();
  addDelta(counter, 12, 3, 'python');
  addDelta(counter, 5, 8, 'typescript');
  addDelta(counter, 2, 1, 'python');
  assert.deepEqual(counter, {
    added: 19,
    removed: 12,
    languages: {
      python: { added: 14, removed: 4 },
      typescript: { added: 5, removed: 8 },
    },
    files: {},
    fileOps: { created: 0, deleted: 0, renamed: 0 },
  });
});

test('tracks per-file totals without changing aggregate behavior', () => {
  const counter = emptyCounter();
  const meta = fileMeta('file:///demo/src/a.py', 'demo/src/a.py', 'src/a.py');
  addDelta(counter, 10, 2, 'python', meta);
  addDelta(counter, 4, 1, 'python', meta);
  assert.equal(counter.added, 14);
  assert.equal(counter.removed, 3);
  assert.deepEqual(counter.files[meta.key], {
    ...meta,
    added: 14,
    removed: 3,
    activity: { created: 0, deleted: 0, renamed: 0, modified: true },
    languageId: 'python',
  });
});

test('migrates v0.1/v0.2 counters without file data', () => {
  assert.deepEqual(sanitizeCounter({ added: 123, removed: 45, languages: { python: { added: 10, removed: 2 } } }), {
    added: 123,
    removed: 45,
    languages: { python: { added: 10, removed: 2 } },
    files: {},
    fileOps: { created: 0, deleted: 0, renamed: 0 },
  });
});

test('sorts languages by total change volume', () => {
  const counter = emptyCounter();
  addDelta(counter, 3, 2, 'c');
  addDelta(counter, 20, 1, 'python');
  addDelta(counter, 8, 4, 'typescript');
  assert.deepEqual(sortedLanguages(counter).map((x) => x.languageId), ['python', 'typescript', 'c']);
});

test('sorts files by total change volume', () => {
  const counter = emptyCounter();
  addDelta(counter, 2, 1, 'python', fileMeta('file:///demo/a.py', 'demo/a.py', 'a.py'));
  addDelta(counter, 20, 4, 'typescript', fileMeta('file:///demo/src/b.ts', 'demo/src/b.ts', 'src/b.ts'));
  assert.deepEqual(sortedFiles(counter).map((x) => x.displayPath), ['demo/src/b.ts', 'demo/a.py']);
});

test('folder totals recursively include descendant file changes', () => {
  const counter = emptyCounter();
  const a = fileMeta('file:///demo/src/utils/a.py', 'demo/src/utils/a.py', 'src/utils/a.py');
  const b = fileMeta('file:///demo/src/main.py', 'demo/src/main.py', 'src/main.py');
  const c = fileMeta('file:///demo/tests/test_main.py', 'demo/tests/test_main.py', 'tests/test_main.py');
  addDelta(counter, 10, 2, 'python', a);
  addDelta(counter, 5, 1, 'python', b);
  addDelta(counter, 3, 0, 'python', c);

  const folders = sortedFolders(counter);
  const byPath = Object.fromEntries(folders.map((x) => [x.displayPath, x]));
  assert.deepEqual([byPath.demo.added, byPath.demo.removed], [18, 3]);
  assert.deepEqual([byPath['demo/src'].added, byPath['demo/src'].removed], [15, 3]);
  assert.deepEqual([byPath['demo/src/utils'].added, byPath['demo/src/utils'].removed], [10, 2]);
  assert.deepEqual([byPath['demo/tests'].added, byPath['demo/tests'].removed], [3, 0]);
  assert.equal(filesForFolder(counter, byPath['demo/src']).length, 2);
});

test('external text delta handles a small single-line replacement', () => {
  assert.deepEqual(textDelta('const n = 10;\n', 'const n = 200;\n'), { added: 2, removed: 1 });
});

test('external text delta preserves unchanged anchor lines between edits', () => {
  const oldText = 'alpha = 1\nkeep one\nbeta = 2\nkeep two\ngamma = 3\n';
  const newText = 'alpha = 100\nkeep one\nbeta = 22\nkeep two\ngamma = 3\n';
  assert.deepEqual(textDelta(oldText, newText), { added: 3, removed: 0 });
});


test('external text delta does not inflate multiple small edits on one line', () => {
  assert.deepEqual(textDelta('a=1; b=2; c=3;', 'a=10; b=2; c=30;'), { added: 2, removed: 0 });
  assert.deepEqual(textDelta('aaaaaaaaabaaaaaaaaac', 'aaaaaaaaaBaaaaaaaaaC'), { added: 2, removed: 2 });
});

test('bounded Myers delta returns minimal insert/delete counts for replacements', () => {
  assert.deepEqual(boundedMyersCharDelta('abcXYZdef', 'abc123def'), { added: 3, removed: 3 });
  assert.deepEqual(boundedMyersCharDelta('kitten', 'sitting'), { added: 3, removed: 2 });
});
test('external text delta handles full insert and delete', () => {
  assert.deepEqual(textDelta('', 'abc\n'), { added: 4, removed: 0 });
  assert.deepEqual(textDelta('abc\n', ''), { added: 0, removed: 4 });
});

test('tracks create and delete operations while counting file text', () => {
  const counter = emptyCounter();
  const meta = fileMeta('file:///demo/src/new.py', 'demo/src/new.py', 'src/new.py');
  addDelta(counter, 25, 0, 'python', meta, 'created');
  addDelta(counter, 0, 25, 'python', meta, 'deleted');

  assert.equal(counter.added, 25);
  assert.equal(counter.removed, 25);
  assert.deepEqual(counter.fileOps, { created: 1, deleted: 1, renamed: 0 });
  assert.deepEqual(counter.files[meta.key].activity, { created: 1, deleted: 1, renamed: 0, modified: false });
});

test('rename moves the file record without adding or removing characters', () => {
  const counter = emptyCounter();
  const oldMeta = fileMeta('file:///demo/src/a.py', 'demo/src/a.py', 'src/a.py');
  const newMeta = fileMeta('file:///demo/src/b.py', 'demo/src/b.py', 'src/b.py');
  addDelta(counter, 10, 2, 'python', oldMeta, 'modified');
  renameFile(counter, oldMeta.key, newMeta, 'python');

  assert.equal(counter.added, 10);
  assert.equal(counter.removed, 2);
  assert.equal(counter.files[oldMeta.key], undefined);
  assert.equal(counter.files[newMeta.key].added, 10);
  assert.equal(counter.files[newMeta.key].removed, 2);
  assert.equal(counter.files[newMeta.key].activity.renamed, 1);
  assert.equal(counter.fileOps.renamed, 1);
});

test('file activity summary reports unique modified files and operation counts', () => {
  const counter = emptyCounter();
  const a = fileMeta('file:///demo/a.py', 'demo/a.py', 'a.py');
  const b = fileMeta('file:///demo/b.py', 'demo/b.py', 'b.py');
  addDelta(counter, 1, 0, 'python', a, 'modified');
  addDelta(counter, 2, 0, 'python', a, 'modified');
  addDelta(counter, 3, 0, 'python', b, 'created');

  assert.deepEqual(fileActivitySummary(counter), {
    created: 1,
    deleted: 0,
    renamed: 0,
    modified: 1,
    tracked: 2,
  });
});

test('formats compact status values', () => {
  assert.equal(formatCompact(999), '999');
  assert.equal(formatCompact(1000), '1k');
  assert.equal(formatCompact(1250), '1.3k');
  assert.equal(formatCompact(1_000_000), '1m');
});

test('glob matcher excludes nested generated directories', () => {
  const patterns = ['**/node_modules/**', '**/.git/**', '**/dist/**'];
  assert.equal(matchesAnyGlob('src/main.js', patterns), false);
  assert.equal(matchesAnyGlob('node_modules/a/index.js', patterns), true);
  assert.equal(matchesAnyGlob('apps/web/node_modules/a/index.js', patterns), true);
  assert.equal(matchesAnyGlob('pkg/dist/app.js', patterns), true);
  assert.equal(matchesAnyGlob('.git/config', patterns), true);
});

test('globToRegExp supports star and question mark', () => {
  const re = globToRegExp('src/*.?s');
  assert.equal(re.test('src/a.js'), true);
  assert.equal(re.test('src/deep/a.js'), false);
});

test('localDateKey uses local calendar date', () => {
  const d = new Date(2026, 8, 7, 12, 0, 0);
  assert.equal(localDateKey(d), '2026-09-07');
});
