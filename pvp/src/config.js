const path = require('path');

const base = require('./experiments/_base/config');
const experiment = process.env.EXPERIMENT || 'distance';

let overrides = {};
try {
  // eslint-disable-next-line import/no-dynamic-require
  overrides = require(path.join(__dirname, 'experiments', experiment, 'config'));
} catch (err) {
  if (process.env.EXPERIMENT) {
    console.warn(`Unknown experiment \"${experiment}\", falling back to base config.`);
  }
}

module.exports = { ...base, ...overrides, experiment };
