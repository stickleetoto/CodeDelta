'use strict';

const core = require('./extension');
const git = require('./git-addon');

function activate(context) {
  core.activate(context);
  git.activate(context);
}

function deactivate() {
  git.deactivate?.();
  core.deactivate?.();
}

module.exports = { activate, deactivate };
