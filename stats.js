'use strict';

function emptyCounter() {
  return {
    added: 0,
    removed: 0,
    languages: {},
    files: {},
    fileOps: { created: 0, deleted: 0, renamed: 0 },
  };
}

function emptyFileActivity() {
  return { created: 0, deleted: 0, renamed: 0, modified: false };
}

function sanitizeFileActivity(value) {
  if (!value || typeof value !== 'object') return emptyFileActivity();
  return {
    created: Number.isFinite(value.created) && value.created >= 0 ? Math.floor(value.created) : 0,
    deleted: Number.isFinite(value.deleted) && value.deleted >= 0 ? Math.floor(value.deleted) : 0,
    renamed: Number.isFinite(value.renamed) && value.renamed >= 0 ? Math.floor(value.renamed) : 0,
    modified: Boolean(value.modified),
  };
}

function sanitizeFileOps(value) {
  if (!value || typeof value !== 'object') return { created: 0, deleted: 0, renamed: 0 };
  return {
    created: Number.isFinite(value.created) && value.created >= 0 ? Math.floor(value.created) : 0,
    deleted: Number.isFinite(value.deleted) && value.deleted >= 0 ? Math.floor(value.deleted) : 0,
    renamed: Number.isFinite(value.renamed) && value.renamed >= 0 ? Math.floor(value.renamed) : 0,
  };
}

function sanitizeLeafCounter(value) {
  if (!value || typeof value !== 'object') return { added: 0, removed: 0 };
  return {
    added: Number.isFinite(value.added) && value.added >= 0 ? Math.floor(value.added) : 0,
    removed: Number.isFinite(value.removed) && value.removed >= 0 ? Math.floor(value.removed) : 0,
  };
}

function sanitizeFileMeta(value, fallbackKey = '') {
  if (!value || typeof value !== 'object') return null;
  const leaf = sanitizeLeafCounter(value);
  const activity = sanitizeFileActivity(value.activity);
  const key = String(value.key || fallbackKey || value.uri || '');
  const hasActivity = activity.created || activity.deleted || activity.renamed || activity.modified;
  if (!key || (!leaf.added && !leaf.removed && !hasActivity)) return null;
  return {
    key,
    ...leaf,
    activity,
    languageId: String(value.languageId || 'plaintext'),
    uri: String(value.uri || ''),
    displayPath: String(value.displayPath || value.relativePath || value.uri || key),
    relativePath: String(value.relativePath || value.displayPath || ''),
    workspaceName: String(value.workspaceName || ''),
    workspaceKey: String(value.workspaceKey || ''),
  };
}

function sanitizeCounter(value) {
  const root = sanitizeLeafCounter(value);
  const languages = {};
  const files = {};
  const fileOps = sanitizeFileOps(value && value.fileOps);

  if (value && value.languages && typeof value.languages === 'object') {
    for (const [languageId, counter] of Object.entries(value.languages)) {
      if (!languageId) continue;
      const clean = sanitizeLeafCounter(counter);
      if (clean.added || clean.removed) languages[languageId] = clean;
    }
  }

  if (value && value.files && typeof value.files === 'object') {
    for (const [key, file] of Object.entries(value.files)) {
      const clean = sanitizeFileMeta(file, key);
      if (clean) files[clean.key] = clean;
    }
  }

  return { ...root, languages, files, fileOps };
}

function addDelta(counter, added, removed, languageId = 'plaintext', fileMeta = null, changeKind = 'modified') {
  const safeAdded = Math.max(0, Math.floor(added || 0));
  const safeRemoved = Math.max(0, Math.floor(removed || 0));

  counter.added += safeAdded;
  counter.removed += safeRemoved;

  if (!counter.languages || typeof counter.languages !== 'object') counter.languages = {};
  const languageKey = String(languageId || 'plaintext');
  if ((safeAdded || safeRemoved) && !counter.languages[languageKey]) counter.languages[languageKey] = { added: 0, removed: 0 };
  if (counter.languages[languageKey]) {
    counter.languages[languageKey].added += safeAdded;
    counter.languages[languageKey].removed += safeRemoved;
  }

  if (!counter.fileOps || typeof counter.fileOps !== 'object') counter.fileOps = { created: 0, deleted: 0, renamed: 0 };

  if (fileMeta && fileMeta.key) {
    const file = ensureFile(counter, fileMeta, languageKey);
    file.added += safeAdded;
    file.removed += safeRemoved;
    file.languageId = languageKey;
    applyFileMeta(file, fileMeta);

    if (changeKind === 'created') {
      file.activity.created += 1;
      counter.fileOps.created += 1;
    } else if (changeKind === 'deleted') {
      file.activity.deleted += 1;
      counter.fileOps.deleted += 1;
    } else if (changeKind === 'modified' && (safeAdded || safeRemoved)) {
      file.activity.modified = true;
    }
  }

  return counter;
}

function ensureFile(counter, fileMeta, languageId = 'plaintext') {
  if (!counter.files || typeof counter.files !== 'object') counter.files = {};
  const key = String(fileMeta.key);
  if (!counter.files[key]) {
    counter.files[key] = {
      key,
      added: 0,
      removed: 0,
      activity: emptyFileActivity(),
      languageId: String(languageId || 'plaintext'),
      uri: String(fileMeta.uri || ''),
      displayPath: String(fileMeta.displayPath || fileMeta.relativePath || fileMeta.uri || key),
      relativePath: String(fileMeta.relativePath || fileMeta.displayPath || ''),
      workspaceName: String(fileMeta.workspaceName || ''),
      workspaceKey: String(fileMeta.workspaceKey || ''),
    };
  }
  if (!counter.files[key].activity) counter.files[key].activity = emptyFileActivity();
  return counter.files[key];
}

function applyFileMeta(file, fileMeta) {
  if (fileMeta.uri) file.uri = String(fileMeta.uri);
  if (fileMeta.displayPath) file.displayPath = String(fileMeta.displayPath);
  if (fileMeta.relativePath) file.relativePath = String(fileMeta.relativePath);
  if (fileMeta.workspaceName) file.workspaceName = String(fileMeta.workspaceName);
  if (fileMeta.workspaceKey) file.workspaceKey = String(fileMeta.workspaceKey);
}

function renameFile(counter, oldKey, newMeta, languageId = 'plaintext') {
  if (!counter.fileOps || typeof counter.fileOps !== 'object') counter.fileOps = { created: 0, deleted: 0, renamed: 0 };
  if (!counter.files || typeof counter.files !== 'object') counter.files = {};

  const sourceKey = String(oldKey || '');
  const targetKey = String(newMeta && newMeta.key || '');
  if (!targetKey) return counter;

  const oldFile = sourceKey ? counter.files[sourceKey] : null;
  const existingTarget = counter.files[targetKey];
  let file;

  if (oldFile && sourceKey !== targetKey) {
    delete counter.files[sourceKey];
    file = oldFile;
    file.key = targetKey;
    if (existingTarget && existingTarget !== oldFile) file = mergeFiles(existingTarget, oldFile);
    counter.files[targetKey] = file;
  } else {
    file = existingTarget || ensureFile(counter, newMeta, languageId);
  }

  if (!file.activity) file.activity = emptyFileActivity();
  file.activity.renamed += 1;
  counter.fileOps.renamed += 1;
  file.languageId = String(languageId || file.languageId || 'plaintext');
  applyFileMeta(file, newMeta);
  return counter;
}

function mergeFiles(target, source) {
  const merged = {
    ...target,
    added: Math.max(0, Math.floor((target.added || 0) + (source.added || 0))),
    removed: Math.max(0, Math.floor((target.removed || 0) + (source.removed || 0))),
    activity: {
      created: (target.activity?.created || 0) + (source.activity?.created || 0),
      deleted: (target.activity?.deleted || 0) + (source.activity?.deleted || 0),
      renamed: (target.activity?.renamed || 0) + (source.activity?.renamed || 0),
      modified: Boolean(target.activity?.modified || source.activity?.modified),
    },
  };
  return merged;
}

function fileActivitySummary(counter) {
  const files = Object.values((counter && counter.files) || {}).map((value) => sanitizeFileMeta(value)).filter(Boolean);
  const ops = sanitizeFileOps(counter && counter.fileOps);
  return {
    created: ops.created,
    deleted: ops.deleted,
    renamed: ops.renamed,
    modified: files.filter((file) => file.activity && file.activity.modified).length,
    tracked: files.length,
  };
}

function deltaFromChanges(contentChanges) {
  let added = 0;
  let removed = 0;

  for (const change of contentChanges || []) {
    added += typeof change.text === 'string' ? change.text.length : 0;
    removed += Number.isFinite(change.rangeLength) ? Math.max(0, change.rangeLength) : 0;
  }

  return { added, removed };
}

function textDelta(oldText, newText) {
  if (oldText === newText) return { added: 0, removed: 0 };

  const oldLines = splitLinesKeepEnds(String(oldText || ''));
  const newLines = splitLinesKeepEnds(String(newText || ''));
  return diffLineSegments(oldLines, 0, oldLines.length, newLines, 0, newLines.length, 0);
}

function diffLineSegments(oldLines, oldStart, oldEnd, newLines, newStart, newEnd, depth) {
  while (oldStart < oldEnd && newStart < newEnd && oldLines[oldStart] === newLines[newStart]) {
    oldStart += 1;
    newStart += 1;
  }
  while (oldStart < oldEnd && newStart < newEnd && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  if (oldStart === oldEnd) return { added: sumLengths(newLines, newStart, newEnd), removed: 0 };
  if (newStart === newEnd) return { added: 0, removed: sumLengths(oldLines, oldStart, oldEnd) };

  if (depth < 32) {
    const anchors = uniqueAnchors(oldLines, oldStart, oldEnd, newLines, newStart, newEnd);
    if (anchors.length) {
      let added = 0;
      let removed = 0;
      let prevOld = oldStart;
      let prevNew = newStart;

      for (const [oldIndex, newIndex] of anchors) {
        const delta = diffLineSegments(oldLines, prevOld, oldIndex, newLines, prevNew, newIndex, depth + 1);
        added += delta.added;
        removed += delta.removed;
        prevOld = oldIndex + 1;
        prevNew = newIndex + 1;
      }

      const tail = diffLineSegments(oldLines, prevOld, oldEnd, newLines, prevNew, newEnd, depth + 1);
      return { added: added + tail.added, removed: removed + tail.removed };
    }
  }

  return middleCharDelta(oldLines.slice(oldStart, oldEnd).join(''), newLines.slice(newStart, newEnd).join(''));
}

function uniqueAnchors(oldLines, oldStart, oldEnd, newLines, newStart, newEnd) {
  const oldMap = new Map();
  const newMap = new Map();

  for (let i = oldStart; i < oldEnd; i += 1) {
    const line = oldLines[i];
    const current = oldMap.get(line);
    oldMap.set(line, current ? { count: current.count + 1, index: current.index } : { count: 1, index: i });
  }
  for (let i = newStart; i < newEnd; i += 1) {
    const line = newLines[i];
    const current = newMap.get(line);
    newMap.set(line, current ? { count: current.count + 1, index: current.index } : { count: 1, index: i });
  }

  const pairs = [];
  for (const [line, oldInfo] of oldMap.entries()) {
    const newInfo = newMap.get(line);
    if (oldInfo.count === 1 && newInfo && newInfo.count === 1) pairs.push([oldInfo.index, newInfo.index]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  return longestIncreasingPairs(pairs);
}

function longestIncreasingPairs(pairs) {
  if (!pairs.length) return [];
  const tails = [];
  const tailIndices = [];
  const previous = new Array(pairs.length).fill(-1);

  for (let i = 0; i < pairs.length; i += 1) {
    const value = pairs[i][1];
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previous[i] = tailIndices[lo - 1];
    tails[lo] = value;
    tailIndices[lo] = i;
  }

  const result = [];
  let index = tailIndices[tails.length - 1];
  while (index >= 0) {
    result.push(pairs[index]);
    index = previous[index];
  }
  result.reverse();
  return result;
}

function middleCharDelta(oldText, newText) {
  let prefix = 0;
  const minLength = Math.min(oldText.length, newText.length);
  while (prefix < minLength && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix += 1;

  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > prefix && newEnd > prefix && oldText.charCodeAt(oldEnd - 1) === newText.charCodeAt(newEnd - 1)) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  const oldMiddle = oldText.slice(prefix, oldEnd);
  const newMiddle = newText.slice(prefix, newEnd);
  if (!oldMiddle.length) return { added: newMiddle.length, removed: 0 };
  if (!newMiddle.length) return { added: 0, removed: oldMiddle.length };

  // Find a minimal insert/delete edit distance for ordinary code-sized changed regions.
  // This fixes the old "one big replacement" over-count when several small edits happen
  // on the same line. The bounded worker falls back safely for pathological rewrites.
  const precise = boundedMyersCharDelta(oldMiddle, newMiddle);
  if (precise) return precise;

  return { added: newMiddle.length, removed: oldMiddle.length };
}

function boundedMyersCharDelta(oldText, newText, options = {}) {
  const n = oldText.length;
  const m = newText.length;
  if (!n) return { added: m, removed: 0 };
  if (!m) return { added: 0, removed: n };

  const maxDistance = Math.min(
    n + m,
    Math.max(Math.abs(n - m), Number.isFinite(options.maxDistance) ? options.maxDistance : 4096)
  );
  if (Math.abs(n - m) > maxDistance) return null;

  const maxWork = Number.isFinite(options.maxWork) ? Math.max(1000, options.maxWork) : 4_000_000;
  const offset = maxDistance + 2;
  const v = new Int32Array((maxDistance * 2) + 5);
  v.fill(-1);
  v[offset + 1] = 0;
  let work = 0;

  for (let d = 0; d <= maxDistance; d += 1) {
    for (let k = -d; k <= d; k += 2) {
      work += 1;
      if (work > maxWork) return null;

      const index = offset + k;
      let x;
      if (k === -d || (k !== d && v[index - 1] < v[index + 1])) x = v[index + 1];
      else x = v[index - 1] + 1;
      let y = x - k;

      while (x < n && y < m && oldText.charCodeAt(x) === newText.charCodeAt(y)) {
        x += 1;
        y += 1;
        work += 1;
        if (work > maxWork) return null;
      }
      v[index] = x;

      if (x >= n && y >= m) {
        const lengthDiff = m - n;
        const added = (d + lengthDiff) / 2;
        const removed = (d - lengthDiff) / 2;
        if (Number.isInteger(added) && Number.isInteger(removed) && added >= 0 && removed >= 0) {
          return { added, removed };
        }
        return null;
      }
    }
  }
  return null;
}

function splitLinesKeepEnds(text) {
  if (!text) return [];
  const lines = text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) || [];
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function sumLengths(lines, start, end) {
  let total = 0;
  for (let i = start; i < end; i += 1) total += lines[i].length;
  return total;
}

function sortedLanguages(counter) {
  return Object.entries((counter && counter.languages) || {})
    .map(([languageId, values]) => ({ languageId, ...sanitizeLeafCounter(values) }))
    .filter((entry) => entry.added || entry.removed)
    .sort((a, b) => (b.added + b.removed) - (a.added + a.removed) || a.languageId.localeCompare(b.languageId));
}

function sortedFiles(counter) {
  return Object.entries((counter && counter.files) || {})
    .map(([key, value]) => sanitizeFileMeta(value, key))
    .filter(Boolean)
    .sort((a, b) => (b.added + b.removed) - (a.added + a.removed) || a.displayPath.localeCompare(b.displayPath));
}

function sortedFolders(counter) {
  const folders = new Map();

  for (const file of sortedFiles(counter)) {
    if (!file.workspaceKey || !file.workspaceName) continue;
    const relative = normalizePath(file.relativePath);
    const parts = relative.split('/').filter(Boolean);
    if (!parts.length) continue;

    addFolderAggregate(folders, {
      key: `${file.workspaceKey}::`,
      workspaceKey: file.workspaceKey,
      workspaceName: file.workspaceName,
      relativePath: '',
      displayPath: file.workspaceName,
    }, file);

    let prefix = '';
    for (let i = 0; i < parts.length - 1; i += 1) {
      prefix = prefix ? `${prefix}/${parts[i]}` : parts[i];
      addFolderAggregate(folders, {
        key: `${file.workspaceKey}::${prefix}`,
        workspaceKey: file.workspaceKey,
        workspaceName: file.workspaceName,
        relativePath: prefix,
        displayPath: `${file.workspaceName}/${prefix}`,
      }, file);
    }
  }

  return [...folders.values()]
    .sort((a, b) => (b.added + b.removed) - (a.added + a.removed) || a.displayPath.localeCompare(b.displayPath));
}

function addFolderAggregate(folders, meta, file) {
  if (!folders.has(meta.key)) {
    folders.set(meta.key, { ...meta, added: 0, removed: 0, fileKeys: [] });
  }
  const folder = folders.get(meta.key);
  folder.added += file.added;
  folder.removed += file.removed;
  folder.fileKeys.push(file.key);
}

function filesForFolder(counter, folder) {
  const wanted = new Set((folder && folder.fileKeys) || []);
  return sortedFiles(counter).filter((file) => wanted.has(file.key));
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatCompact(value) {
  const abs = Math.abs(value);
  if (abs < 1000) return String(value);
  if (abs < 1_000_000) return `${trimOneDecimal(value / 1000)}k`;
  if (abs < 1_000_000_000) return `${trimOneDecimal(value / 1_000_000)}m`;
  return `${trimOneDecimal(value / 1_000_000_000)}b`;
}

function trimOneDecimal(value) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatNumber(value) {
  return Math.max(0, Math.floor(value || 0)).toLocaleString('en-US');
}

function globToRegExp(pattern) {
  const normalized = String(pattern || '').replace(/\\/g, '/');
  let regex = '^';

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];

    if (char === '*') {
      const next = normalized[i + 1];
      if (next === '*') {
        i += 1;
        if (normalized[i + 1] === '/') {
          i += 1;
          regex += '(?:.*/)?';
        } else {
          regex += '.*';
        }
      } else {
        regex += '[^/]*';
      }
      continue;
    }

    if (char === '?') {
      regex += '[^/]';
      continue;
    }

    if ('\\.^$+{}()|[]'.includes(char)) regex += `\\${char}`;
    else regex += char;
  }

  regex += '$';
  return new RegExp(regex);
}

function matchesAnyGlob(path, patterns) {
  const normalized = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return (patterns || []).some((pattern) => {
    try {
      return globToRegExp(pattern).test(normalized);
    } catch {
      return false;
    }
  });
}

module.exports = {
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
  localDateKey,
  formatCompact,
  formatNumber,
  globToRegExp,
  matchesAnyGlob,
};
