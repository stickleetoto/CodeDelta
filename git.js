'use strict';

function emptyCounter() {
  return { added: 0, removed: 0, languages: {}, files: {}, fileOps: { created: 0, deleted: 0, renamed: 0 } };
}

function safeInt(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function cleanActivity(value) {
  const v = value && typeof value === 'object' ? value : {};
  return {
    created: safeInt(v.created),
    deleted: safeInt(v.deleted),
    renamed: safeInt(v.renamed),
    modified: Boolean(v.modified),
  };
}

function cleanFile(value, fallbackKey = '') {
  if (!value || typeof value !== 'object') return null;
  const key = String(value.key || fallbackKey || value.uri || '');
  if (!key) return null;
  return {
    ...value,
    key,
    added: safeInt(value.added),
    removed: safeInt(value.removed),
    activity: cleanActivity(value.activity),
    languageId: String(value.languageId || 'plaintext'),
  };
}

function filterCounter(counter, predicate) {
  const result = emptyCounter();
  for (const [key, raw] of Object.entries((counter && counter.files) || {})) {
    const file = cleanFile(raw, key);
    if (!file || !predicate(file)) continue;
    result.files[file.key] = file;
    result.added += file.added;
    result.removed += file.removed;
    const language = file.languageId || 'plaintext';
    if (!result.languages[language]) result.languages[language] = { added: 0, removed: 0 };
    result.languages[language].added += file.added;
    result.languages[language].removed += file.removed;
    result.fileOps.created += file.activity.created;
    result.fileOps.deleted += file.activity.deleted;
    result.fileOps.renamed += file.activity.renamed;
  }
  return result;
}

function subtractCounters(current, baseline) {
  const result = emptyCounter();
  const baseFiles = (baseline && baseline.files) || {};
  const usedBaselineKeys = new Set();
  for (const [key, raw] of Object.entries((current && current.files) || {})) {
    const file = cleanFile(raw, key);
    if (!file) continue;
    const match = findBaselineMatch(file, key, baseFiles, usedBaselineKeys);
    if (match.key) usedBaselineKeys.add(match.key);
    const base = match.file || { added: 0, removed: 0, activity: cleanActivity(null) };
    const added = Math.max(0, file.added - base.added);
    const removed = Math.max(0, file.removed - base.removed);
    const activity = {
      created: Math.max(0, file.activity.created - base.activity.created),
      deleted: Math.max(0, file.activity.deleted - base.activity.deleted),
      renamed: Math.max(0, file.activity.renamed - base.activity.renamed),
      modified: Boolean(added || removed || (file.activity.modified && !base.activity.modified)),
    };
    if (!added && !removed && !activity.created && !activity.deleted && !activity.renamed && !activity.modified) continue;
    result.files[file.key] = { ...file, added, removed, activity };
    result.added += added;
    result.removed += removed;
    const language = file.languageId || 'plaintext';
    if (!result.languages[language]) result.languages[language] = { added: 0, removed: 0 };
    result.languages[language].added += added;
    result.languages[language].removed += removed;
    result.fileOps.created += activity.created;
    result.fileOps.deleted += activity.deleted;
    result.fileOps.renamed += activity.renamed;
  }
  return result;
}

function findBaselineMatch(file, key, baseFiles, usedKeys) {
  const exact = cleanFile(baseFiles[key], key);
  if (exact) return { key, file: exact };

  // Core CodeDelta preserves cumulative counters when a file is renamed, but
  // changes the map key to the new URI. A renamed successor may also receive
  // additional edits before the next UI refresh, so match monotonic successors
  // rather than requiring byte-for-byte identical cumulative totals.
  let candidate = null;
  let candidateScore = Infinity;
  let ambiguous = false;
  for (const [baseKey, raw] of Object.entries(baseFiles || {})) {
    if (usedKeys.has(baseKey)) continue;
    const base = cleanFile(raw, baseKey);
    if (!base) continue;
    if (base.languageId !== file.languageId) continue;
    if (base.workspaceKey && file.workspaceKey && base.workspaceKey !== file.workspaceKey) continue;
    if (base.added > file.added || base.removed > file.removed) continue;
    if (base.activity.created > file.activity.created || base.activity.deleted > file.activity.deleted) continue;
    if (base.activity.renamed >= file.activity.renamed) continue; // require evidence of a rename/move

    const score = (file.added - base.added) + (file.removed - base.removed) +
      ((file.activity.renamed - base.activity.renamed) * 4);
    if (score < candidateScore) {
      candidate = { key: baseKey, file: base };
      candidateScore = score;
      ambiguous = false;
    } else if (score === candidateScore) {
      ambiguous = true;
    }
  }
  return candidate && !ambiguous ? candidate : { key: '', file: null };
}

function mergeCounters(counters) {
  const result = emptyCounter();
  for (const counter of counters || []) {
    result.added += safeInt(counter && counter.added);
    result.removed += safeInt(counter && counter.removed);
    for (const [language, leaf] of Object.entries((counter && counter.languages) || {})) {
      if (!result.languages[language]) result.languages[language] = { added: 0, removed: 0 };
      result.languages[language].added += safeInt(leaf.added);
      result.languages[language].removed += safeInt(leaf.removed);
    }
    for (const [key, raw] of Object.entries((counter && counter.files) || {})) {
      const file = cleanFile(raw, key);
      if (!file) continue;
      if (!result.files[key]) {
        result.files[key] = file;
      } else {
        const target = result.files[key];
        target.added += file.added;
        target.removed += file.removed;
        target.activity.created += file.activity.created;
        target.activity.deleted += file.activity.deleted;
        target.activity.renamed += file.activity.renamed;
        target.activity.modified = Boolean(target.activity.modified || file.activity.modified);
      }
    }
    result.fileOps.created += safeInt(counter && counter.fileOps && counter.fileOps.created);
    result.fileOps.deleted += safeInt(counter && counter.fileOps && counter.fileOps.deleted);
    result.fileOps.renamed += safeInt(counter && counter.fileOps && counter.fileOps.renamed);
  }
  return result;
}

function isCounterMonotonic(current, baseline) {
  if (!baseline) return true;
  if (safeInt(current && current.added) < safeInt(baseline.added)) return false;
  if (safeInt(current && current.removed) < safeInt(baseline.removed)) return false;

  const baseFiles = (baseline && baseline.files) || {};
  const usedBaselineKeys = new Set();
  for (const [key, rawCurrent] of Object.entries((current && current.files) || {})) {
    const now = cleanFile(rawCurrent, key);
    if (!now) continue;
    const match = findBaselineMatch(now, key, baseFiles, usedBaselineKeys);
    if (!match.file) continue;
    usedBaselineKeys.add(match.key);
    const base = match.file;
    if (now.added < base.added || now.removed < base.removed) return false;
    if (now.activity.created < base.activity.created || now.activity.deleted < base.activity.deleted || now.activity.renamed < base.activity.renamed) return false;
  }

  for (const [key, rawBase] of Object.entries(baseFiles)) {
    if (usedBaselineKeys.has(key)) continue;
    const base = cleanFile(rawBase, key);
    if (!base) continue;
    if (base.added || base.removed || base.activity.created || base.activity.deleted || base.activity.renamed) return false;
  }
  return true;
}

function activitySummary(counter) {
  const files = Object.values((counter && counter.files) || {}).map((file) => cleanFile(file)).filter(Boolean);
  return {
    created: safeInt(counter && counter.fileOps && counter.fileOps.created),
    deleted: safeInt(counter && counter.fileOps && counter.fileOps.deleted),
    renamed: safeInt(counter && counter.fileOps && counter.fileOps.renamed),
    modified: files.filter((file) => file.activity.modified).length,
    tracked: files.length,
  };
}

function shortSha(value, length = 7) {
  const sha = String(value || '').trim();
  return sha ? sha.slice(0, Math.max(4, Math.min(12, length))) : '';
}

function normalizeBranch(value, detached = false) {
  const branch = String(value || '').trim();
  if (branch) return branch;
  return detached ? 'detached HEAD' : 'unknown';
}

function compactHistory(history, limit = 30) {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit || 30)));
  return (Array.isArray(history) ? history : []).slice(-safeLimit);
}

module.exports = {
  emptyCounter,
  filterCounter,
  subtractCounters,
  mergeCounters,
  isCounterMonotonic,
  activitySummary,
  shortSha,
  normalizeBranch,
  compactHistory,
};
