'use strict';

const path = require('node:path');

// CodeDelta intentionally uses one fixed tracking policy: Development.
// It includes source code, project configuration, build scripts and project docs,
// while excluding generic prose/data files and common generated artifacts.

const DEVELOPMENT_EXTENSIONS = new Set([
  // Python / JS / TS
  '.py', '.pyw', '.pyi', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx',
  // C family / JVM / native
  '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx', '.cs', '.java', '.kt', '.kts',
  '.rs', '.go', '.swift', '.dart', '.m', '.mm',
  // Scripting / shells
  '.lua', '.rb', '.php', '.pl', '.pm', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  // Web / UI
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.vue', '.svelte', '.astro',
  // Data/config that is normally hand-authored as part of a project
  '.json', '.jsonc', '.yaml', '.yml', '.toml', '.xml', '.ini', '.cfg', '.conf', '.properties',
  // Project documentation
  '.md', '.mdx', '.rst', '.adoc',
  // Query/schema/build languages
  '.sql', '.graphql', '.gql', '.proto', '.tf', '.tfvars', '.hcl',
  // Functional / systems / other common source formats
  '.scala', '.sc', '.clj', '.cljs', '.cljc', '.ex', '.exs', '.erl', '.hrl', '.fs', '.fsx', '.fsi', '.vb',
  '.r', '.jl', '.sol', '.nim', '.zig', '.v', '.sv', '.svh', '.vhd', '.vhdl',
  // Assembly / shader / wasm text
  '.asm', '.s', '.wat', '.glsl', '.vert', '.frag', '.geom', '.comp', '.hlsl', '.wgsl',
]);

const DEVELOPMENT_BASENAMES = new Set([
  'dockerfile', 'containerfile', 'makefile', 'gnumakefile', 'cmakelists.txt',
  'meson.build', 'meson_options.txt', 'justfile', 'rakefile', 'gemfile', 'procfile',
  'pipfile', 'pyproject.toml', 'setup.py', 'setup.cfg', 'tox.ini',
  'package.json', 'tsconfig.json', 'jsconfig.json', 'deno.json', 'deno.jsonc',
  'cargo.toml', 'go.mod', 'go.work', 'composer.json', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts',
  '.gitignore', '.gitattributes', '.gitmodules', '.dockerignore', '.editorconfig',
  '.env', '.env.example', '.env.sample', '.npmrc', '.yarnrc', '.yarnrc.yml', '.prettierrc', '.eslintrc',
  'requirements.txt', 'constraints.txt',
  'readme', 'license', 'licence', 'changelog', 'contributing', 'security', 'code_of_conduct', 'codeowners',
]);

const GENERATED_BASENAMES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb',
  'cargo.lock', 'poetry.lock', 'pdm.lock', 'uv.lock', 'composer.lock', 'gemfile.lock',
]);

const DEVELOPMENT_LANGUAGE_IDS = new Set([
  'python', 'javascript', 'javascriptreact', 'typescript', 'typescriptreact',
  'c', 'cpp', 'cuda-cpp', 'csharp', 'java', 'kotlin', 'rust', 'go', 'swift', 'dart', 'objective-c', 'objective-cpp',
  'lua', 'ruby', 'php', 'perl', 'shellscript', 'powershell', 'bat', 'fish',
  'html', 'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'astro',
  'json', 'jsonc', 'yaml', 'toml', 'xml', 'ini', 'properties', 'dotenv',
  'markdown', 'mdx', 'restructuredtext', 'asciidoc',
  'sql', 'graphql', 'protobuf', 'terraform', 'hcl',
  'scala', 'clojure', 'elixir', 'erlang', 'fsharp', 'vb', 'r', 'julia', 'solidity', 'nim', 'zig',
  'verilog', 'systemverilog', 'vhdl', 'asm', 'wasm', 'glsl', 'hlsl', 'wgsl',
  'dockerfile', 'makefile', 'cmake', 'meson',
]);

function normalizedBasename(filePath) {
  return path.basename(String(filePath || '')).toLowerCase();
}

function isGeneratedDevelopmentArtifact(filePath) {
  const name = normalizedBasename(filePath);
  if (!name) return false;
  if (GENERATED_BASENAMES.has(name)) return true;
  if (name.endsWith('.min.js') || name.endsWith('.min.css')) return true;
  if (name.endsWith('.js.map') || name.endsWith('.css.map') || name.endsWith('.map')) return true;
  return false;
}

function matchesProjectDocBasename(name) {
  // README.md etc. are already accepted by extension, but extensionless variants
  // and conventional suffixed docs are useful too.
  return /^(readme|license|licence|changelog|contributing|security|code_of_conduct)(\..+)?$/i.test(name);
}

function isDevelopmentPath(filePath) {
  const raw = String(filePath || '');
  const name = normalizedBasename(raw);
  if (!name || isGeneratedDevelopmentArtifact(raw)) return false;
  if (DEVELOPMENT_BASENAMES.has(name) || matchesProjectDocBasename(name)) return true;

  // .env.local / .env.development / .env.production, etc.
  if (name.startsWith('.env.')) return true;

  return DEVELOPMENT_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function isDevelopmentLanguage(languageId) {
  return DEVELOPMENT_LANGUAGE_IDS.has(String(languageId || '').toLowerCase());
}

function isDevelopmentResource(filePath, languageId = '') {
  // Path is authoritative for known generated artifacts even when VS Code assigns
  // them a generic JSON/YAML language id.
  if (filePath && isGeneratedDevelopmentArtifact(filePath)) return false;
  return isDevelopmentPath(filePath) || isDevelopmentLanguage(languageId);
}

module.exports = {
  DEVELOPMENT_EXTENSIONS,
  DEVELOPMENT_BASENAMES,
  GENERATED_BASENAMES,
  DEVELOPMENT_LANGUAGE_IDS,
  isGeneratedDevelopmentArtifact,
  isDevelopmentPath,
  isDevelopmentLanguage,
  isDevelopmentResource,
};
