'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isDevelopmentPath,
  isDevelopmentLanguage,
  isDevelopmentResource,
  isGeneratedDevelopmentArtifact,
} = require('../development');

test('Development mode includes source code', () => {
  for (const name of ['main.py', 'app.tsx', 'native.cpp', 'lib.rs', 'server.go', 'shader.wgsl']) {
    assert.equal(isDevelopmentPath(name), true, name);
  }
});

test('Development mode includes project config, build files and docs', () => {
  for (const name of ['package.json', 'pyproject.toml', 'Dockerfile', 'CMakeLists.txt', '.gitignore', '.env.local', 'README.md', 'CONTRIBUTING']) {
    assert.equal(isDevelopmentPath(name), true, name);
  }
});

test('Development mode ignores generic text and data files', () => {
  for (const name of ['notes.txt', 'dump.csv', 'app.log', 'photo.png', 'archive.zip']) {
    assert.equal(isDevelopmentPath(name), false, name);
  }
});

test('Development mode excludes common generated artifacts even when their extension is config-like', () => {
  for (const name of ['package-lock.json', 'pnpm-lock.yaml', 'Cargo.lock', 'bundle.min.js', 'bundle.js.map']) {
    assert.equal(isGeneratedDevelopmentArtifact(name), true, name);
    assert.equal(isDevelopmentResource(name, name.endsWith('.json') ? 'json' : ''), false, name);
  }
});

test('requirements.txt is included but arbitrary txt files are not', () => {
  assert.equal(isDevelopmentPath('requirements.txt'), true);
  assert.equal(isDevelopmentPath('ideas.txt'), false);
});

test('language id can include custom-associated development documents', () => {
  assert.equal(isDevelopmentLanguage('python'), true);
  assert.equal(isDevelopmentResource('script.custom', 'python'), true);
  assert.equal(isDevelopmentLanguage('plaintext'), false);
  assert.equal(isDevelopmentResource('notes.txt', 'plaintext'), false);
});
